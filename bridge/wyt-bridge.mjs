#!/usr/bin/env node
// Watch Your Tone — local bridge.
//
// A tiny localhost server that runs your locally-installed `claude` CLI. The
// browser extension can't spawn a process, so it POSTs the prompt here and this
// bridge runs Claude Code for it. Everything about auth and models is inherited
// from your normal Claude Code config (~/.claude/settings.json) — Bedrock
// routing, AWS profile, `valet aws` refresh, model, etc. No credentials are
// stored by the extension or by this bridge.
//
// Usage:
//   node bridge/wyt-bridge.mjs               # port 8765
//   node bridge/wyt-bridge.mjs --port 9000
//   PORT=9000 node bridge/wyt-bridge.mjs
//   CLAUDE_BIN=/path/to/claude node bridge/wyt-bridge.mjs
//
// On first run it prints a token — paste it into the extension's settings
// (Claude Code provider). Zero dependencies; Node 18+.

import http from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const HOST = "127.0.0.1";
const argPort = (() => {
  const i = process.argv.indexOf("--port");
  return i !== -1 ? Number(process.argv[i + 1]) : undefined;
})();
const PORT = argPort || Number(process.env.PORT) || 8765;
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

// ---- token (stable across restarts) ---------------------------------------
const dir = join(homedir(), ".wyt-bridge");
const tokenFile = join(dir, "token");
let TOKEN;
try {
  mkdirSync(dir, { recursive: true });
  if (existsSync(tokenFile)) {
    TOKEN = readFileSync(tokenFile, "utf8").trim();
  }
  if (!TOKEN) {
    TOKEN = randomBytes(24).toString("hex");
    writeFileSync(tokenFile, TOKEN, { mode: 0o600 });
  }
} catch (e) {
  TOKEN = randomBytes(24).toString("hex"); // fall back to ephemeral token
  console.warn(`Couldn't persist token (${e.message}); using an ephemeral one.`);
}

// ---- helpers ---------------------------------------------------------------
function corsOrigin(req) {
  const o = req.headers.origin || "";
  // Only allow the browser extension to read responses. Web pages are blocked
  // by the absence of these headers; the token gates side effects regardless.
  return o.startsWith("chrome-extension://") ? o : null;
}

function setCors(res, origin) {
  if (!origin) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
}

function send(res, status, obj, origin) {
  setCors(res, origin);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function authed(req) {
  const h = req.headers["authorization"] || "";
  const bearer = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  const alt = (req.headers["x-wyt-token"] || "").toString().trim();
  return bearer === TOKEN || alt === TOKEN;
}

// Run the local `claude` CLI in print mode and return its result text.
function runClaude({ system, user, model }) {
  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "json", "--max-turns", "1"];
    if (model) args.push("--model", model);

    const child = spawn(CLAUDE_BIN, args, {
      cwd: tmpdir(), // neutral cwd so no project CLAUDE.md influences the rewrite
      env: process.env,
    });

    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      if (e.code === "ENOENT")
        reject(
          new Error(
            `Couldn't find the 'claude' CLI on PATH. Install Claude Code, or set CLAUDE_BIN to its full path.`
          )
        );
      else reject(e);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || `claude exited with code ${code}`));
        return;
      }
      // --output-format json prints an object with a `result` string.
      let text = out.trim();
      try {
        const obj = JSON.parse(text);
        if (typeof obj.result === "string") text = obj.result;
        else if (obj.error) {
          reject(new Error(String(obj.error)));
          return;
        }
      } catch {
        // not JSON — pass the raw stdout through; the extension parses leniently
      }
      resolve(text);
    });

    // The full prompt (our system instructions + the user's message) goes on
    // stdin. We fold system into the prompt for maximum CLI-version compatibility.
    const prompt = system ? `${system}\n\n${user}` : user;
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// ---- server ----------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const origin = corsOrigin(req);

  if (req.method === "OPTIONS") {
    setCors(res, origin);
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    send(res, 200, { ok: true, service: "watch-your-tone-bridge" }, origin);
    return;
  }

  if (req.method === "POST" && req.url === "/invoke") {
    if (!authed(req)) {
      send(res, 401, { error: "Invalid or missing token." }, origin);
      return;
    }
    let body;
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      send(res, 400, { error: "Invalid JSON body." }, origin);
      return;
    }
    if (!body.user) {
      send(res, 400, { error: "Missing 'user' field." }, origin);
      return;
    }
    try {
      const text = await runClaude({
        system: body.system || "",
        user: body.user,
        model: body.model || "",
      });
      send(res, 200, { ok: true, text }, origin);
    } catch (e) {
      send(res, 500, { error: e?.message || String(e) }, origin);
    }
    return;
  }

  send(res, 404, { error: "Not found." }, origin);
});

server.listen(PORT, HOST, () => {
  console.log(`\nWatch Your Tone bridge listening at http://${HOST}:${PORT}`);
  console.log(`Health check:  curl http://${HOST}:${PORT}/health`);
  console.log(`\nPaste this token into the extension (Settings → Claude Code provider):\n`);
  console.log(`  ${TOKEN}\n`);
  console.log(`It runs your local '${CLAUDE_BIN}' CLI, inheriting your Bedrock/AWS config.`);
  console.log(`Stop with Ctrl+C.\n`);
});
