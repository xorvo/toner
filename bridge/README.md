# Watch Your Tone — local Claude Code bridge

A tiny localhost server that lets the extension use your **locally-installed
Claude Code** instead of a pasted API key or AWS credentials.

## Why this exists

Browser extensions run in a sandbox: they can't launch a CLI, read `~/.aws`, run
your `valet aws` refresh, or do SSO. So if your Bedrock access is profile/SSO-based
(e.g. `AWS_PROFILE` + `CLAUDE_CODE_USE_BEDROCK=1` + an `awsAuthRefresh` command),
there's no way for the extension to authenticate on its own.

This bridge solves that by running your `claude` CLI for the extension. Because it
shells out to `claude`, it inherits **everything** from your normal Claude Code
config (`~/.claude/settings.json`): Bedrock routing, AWS profile, credential
refresh, and model. The extension configures nothing about auth.

```
extension ──POST http://127.0.0.1:8765/invoke──▶ bridge ──spawn──▶ claude -p ──▶ Bedrock (your config)
```

No credentials are stored by the extension or the bridge.

## Requirements

- Node 18+
- The `claude` CLI installed and working (`claude -p "hi"` should respond).
  If it isn't on your `PATH`, set `CLAUDE_BIN=/full/path/to/claude`.

## Run it

```bash
node bridge/wyt-bridge.mjs
```

On startup it prints a **token**. Copy it.

Options:

```bash
node bridge/wyt-bridge.mjs --port 9000     # custom port
PORT=9000 node bridge/wyt-bridge.mjs       # same, via env
CLAUDE_BIN=/opt/claude/bin/claude node bridge/wyt-bridge.mjs
```

Check it's alive:

```bash
curl http://127.0.0.1:8765/health
```

## Connect the extension

1. Open the extension's **Settings**.
2. Provider → **Claude Code (local)**.
3. Bridge URL: `http://127.0.0.1:8765` (or your custom port).
4. Bridge token: paste the token the bridge printed.
5. (Optional) Model override — e.g. a faster model for quick rewrites. Leave blank
   to use whatever model your Claude Code config uses.
6. Click **Test connection**.

Keep the bridge running while you use the extension. Stop it with `Ctrl+C`.

## Security notes

- Binds to `127.0.0.1` only — not reachable from your network.
- Every request must carry the token (`Authorization: Bearer <token>`), so other
  local processes or web pages can't make it run `claude` (which costs money).
- The token is stored at `~/.wyt-bridge/token` (mode `600`) and is stable across
  restarts. Delete that file to rotate it.
- Responses are only readable by `chrome-extension://` origins.

## Run it on login (optional)

**macOS (launchd):** create `~/Library/LaunchAgents/com.wyt.bridge.plist` pointing
`node /full/path/to/bridge/wyt-bridge.mjs`, then
`launchctl load ~/Library/LaunchAgents/com.wyt.bridge.plist`.

Or just run it in a terminal / tmux pane when you want the extension active.
