// "Claude Code (local)" provider.
// Talks to a tiny local bridge (see bridge/wyt-bridge.mjs) over 127.0.0.1.
// The bridge runs your locally-installed `claude` CLI, so it inherits ALL of
// your local config — Bedrock routing, AWS profile, `valet aws` refresh, model.
// No credentials ever live in the browser.

export async function callClaudeCode({ bridgeUrl, token, model, system, user }) {
  const base = (bridgeUrl || "http://127.0.0.1:8765").replace(/\/+$/, "");
  const url = `${base}/invoke`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ system, user, model: model || undefined }),
    });
  } catch (e) {
    throw new Error(
      `Couldn't reach the local Claude Code bridge at ${base}. ` +
        `Start it with: node bridge/wyt-bridge.mjs  (see bridge/README.md). ` +
        `(${e?.message || e})`
    );
  }

  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err?.error || JSON.stringify(err);
    } catch {
      detail = await res.text();
    }
    throw new Error(`Claude Code bridge error (${res.status}): ${detail}`);
  }

  const data = await res.json();
  if (!data || typeof data.text !== "string") {
    throw new Error("Claude Code bridge returned an unexpected response.");
  }
  return data.text;
}
