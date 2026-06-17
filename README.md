# Watch Your Tone

An AI writing coach that lives in your text box. Improve clarity, fix grammar,
and adjust tone **before** you hit send — in Slack, Gmail, Notion, Linear,
Google Docs, and most other web apps.

It works like a thoughtful communication coach, not a ghostwriter: it suggests,
you decide. Nothing is ever sent for you, and it only reads the text you ask it
to improve.

![Watch Your Tone icon](icons/icon128.png)

## Features

- **Inline refinement** — focus any text box and a small ✎ button appears, or
  press <kbd>Ctrl/Cmd</kbd>+<kbd>Shift</kbd>+<kbd>E</kbd>, or right-click a
  selection.
- **Quick actions** — Improve, Fix grammar, Make concise, Make clearer, Warmer,
  More direct, More professional, More diplomatic, Check tone, and Alternatives.
- **Personas** — pick a voice instead of a one-size-fits-all mode: Thoughtful
  manager, Friendly teammate, Executive, Customer support, Diplomat, Recruiter,
  Plain & clear, Wordsmith — or none.
- **Your style profile** — save preferred tone, things to avoid, format, and a
  "preserve my voice" toggle. Applied to every rewrite.
- **Tone check** — get a candid read on how a message may land before sending.
- **Before/after** — every suggestion is editable; replace, copy, or try again.
- **Popup scratchpad** — refine pasted text even on pages without a text box.
- **Three backends** — **Claude Code (local)** (reuse your existing Claude Code
  config via a tiny local bridge — great for SSO/profile-based Bedrock), your own
  **Anthropic API key**, or **AWS Bedrock** with static keys (SigV4). Pluggable
  provider layer.

## Install (load unpacked)

This is an unpacked Chrome extension — no build step.

1. Clone this repo.
2. Open `chrome://extensions` in Chrome (or any Chromium browser).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select this folder.
5. Click the Watch Your Tone toolbar icon → the ⚙ gear → **Settings** to add
   your credentials.

## Setup

Open **Settings** and choose a provider:

### Option A — Claude Code (local) — recommended if you already use Claude Code
Reuse your existing Claude Code setup (Bedrock, AWS profile, credential refresh,
model) without entering any keys. Requires running a small local bridge.

1. Start the bridge: `node bridge/wyt-bridge.mjs` (see [bridge/README.md](bridge/README.md)).
2. Copy the **token** it prints.
3. In Settings → provider **Claude Code (local)**, set the bridge URL
   (`http://127.0.0.1:8765`) and paste the token.
4. Optionally set a model override (e.g. a faster model for quick rewrites);
   leave blank to use your Claude Code model.
5. Click **Test connection**.

Why a bridge? A browser extension can't launch a CLI, read `~/.aws`, run a
credential-refresh command, or do SSO. The bridge runs your `claude` CLI on the
extension's behalf, inheriting all of your local config. Nothing is stored.

### Option B — Anthropic API key
1. Get a key from [console.anthropic.com](https://console.anthropic.com).
2. Paste it into **Anthropic API key**.
3. Pick a model (Sonnet 4.6 is a fast, capable default; Haiku 4.5 is cheapest;
   Opus 4.8 is the most capable).
4. Click **Test connection**.

### Option C — AWS Bedrock (static keys)
Use this only if you have long-lived IAM access keys. For SSO/profile-based
Bedrock (no static keys), use **Option A** instead.

1. Enter your **region**, **access key ID**, **secret access key**, and
   (if using temporary credentials) a **session token**.
2. Enter the Bedrock **model ID** or inference-profile ID for a Claude model,
   e.g. `us.anthropic.claude-sonnet-4-5-20250929-v1:0`. Copy the exact ID from
   your AWS Bedrock console — available models vary by account and region.
3. Click **Test connection**.

> The IAM principal needs `bedrock:InvokeModel` on the chosen model.

Your keys and credentials are stored with `chrome.storage.local` — **on this
device only, never synced**.

## How it works

```
Editable field ──(user clicks ✎ / shortcut)──▶ content script (shadow-DOM panel)
                                                      │  WYT_REWRITE
                                                      ▼
                                            background service worker
                                            (holds credentials, builds prompt)
                                                      │
                                       ┌──────────────┴──────────────┐
                                       ▼                             ▼
                              Anthropic /v1/messages          AWS Bedrock InvokeModel
                              (x-api-key)                      (SigV4-signed)
```

- The **content script** (`src/content/content.js`) detects editable fields,
  renders the panel inside a shadow root, and replaces text only after you click
  Replace. It never calls the AI directly.
- The **background service worker** (`src/background/service-worker.js`) is the
  only place that holds credentials and talks to a provider.
- The **provider layer** (`src/lib/providers/`) abstracts the backend. Anthropic
  and Bedrock speak the Messages API directly (Bedrock requests are SigV4-signed
  by `src/lib/sigv4.js`, Web Crypto, no dependencies). The Claude Code provider
  instead POSTs to the local bridge (`bridge/wyt-bridge.mjs`), which runs your
  `claude` CLI and inherits all of its config.
- **Personas** (`src/lib/personas.js`) and **actions** (`src/lib/actions.js`) are
  plain data, easy to extend. Prompts are assembled in `src/lib/prompt.js`, which
  asks the model for a small JSON object and parses it leniently.

## Project layout

```
manifest.json
icons/                     generated PNG icons
tools/make-icons.mjs       regenerate icons (node tools/make-icons.mjs)
bridge/                    local Claude Code bridge (wyt-bridge.mjs + README)
src/
  background/service-worker.js   message router + AI calls
  content/content.js             inline UI (shadow DOM)
  popup/                         toolbar popup (status, persona, scratchpad)
  options/                       settings page
  lib/
    personas.js  actions.js  prompt.js  storage.js  sigv4.js
    providers/   anthropic.js  bedrock.js  claudecode.js  index.js
```

## Development

- No bundler — edit files and hit **Reload** on `chrome://extensions`.
- Regenerate icons: `node tools/make-icons.mjs`.
- Syntax-check everything: `node --check` each file (CI-friendly).

## Privacy

See [PRIVACY.md](PRIVACY.md). In short: only the text you explicitly ask to
improve is sent to your chosen AI provider; messages are not stored; nothing is
sent on your behalf.

## Chrome Web Store

This loads unpacked today. For a store listing later, the main work is narrowing
host permissions (the current `<all_urls>` content-script match is broad for
convenience), adding a privacy policy URL, and packaging. Tracked as future work.

## License

MIT — see [LICENSE](LICENSE).
