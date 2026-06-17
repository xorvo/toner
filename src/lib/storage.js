// All settings live in chrome.storage.local — never synced, so API keys and AWS
// credentials stay on this device. This is a deliberate privacy choice.

export const DEFAULTS = {
  provider: "anthropic", // "anthropic" | "bedrock" | "claudecode"

  // Direct Anthropic API
  anthropicApiKey: "",
  anthropicModel: "claude-sonnet-4-6",

  // Local Claude Code bridge — reuses your local `claude` config (Bedrock,
  // AWS profile, valet refresh, model). See bridge/wyt-bridge.mjs.
  claudeCode: {
    bridgeUrl: "http://127.0.0.1:8765",
    token: "",
    model: "", // optional override; empty = use Claude Code's configured model
  },

  // AWS Bedrock (Claude via Bedrock)
  bedrock: {
    region: "us-east-1",
    accessKeyId: "",
    secretAccessKey: "",
    sessionToken: "", // optional, for temporary credentials
    modelId: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  },

  // Default persona applied to rewrites (see lib/personas.js)
  personaId: "none",

  // Personal style profile
  style: {
    tone: [], // e.g. ["concise", "kind", "direct"]
    avoid: [], // e.g. ["corporate jargon", "blame"]
    format: "", // freeform, e.g. "short slack-style message"
    preserveVoice: true,
    custom: "", // freeform extra guidance
  },

  // Optional context hints
  context: {
    autoDetectApp: true,
  },

  // Sites where the inline UI is disabled (hostnames)
  disabledSites: [],

  // Show the floating inline button on editable fields
  showInlineButton: true,
};

export async function getSettings() {
  const stored = await chrome.storage.local.get(null);
  // Deep-merge defaults so new fields appear for existing installs.
  return {
    ...DEFAULTS,
    ...stored,
    bedrock: { ...DEFAULTS.bedrock, ...(stored.bedrock || {}) },
    claudeCode: { ...DEFAULTS.claudeCode, ...(stored.claudeCode || {}) },
    style: { ...DEFAULTS.style, ...(stored.style || {}) },
    context: { ...DEFAULTS.context, ...(stored.context || {}) },
  };
}

export async function saveSettings(patch) {
  await chrome.storage.local.set(patch);
}

export async function isConfigured() {
  const s = await getSettings();
  if (s.provider === "anthropic") return Boolean(s.anthropicApiKey);
  if (s.provider === "bedrock")
    return Boolean(
      s.bedrock.accessKeyId && s.bedrock.secretAccessKey && s.bedrock.modelId
    );
  if (s.provider === "claudecode") return Boolean(s.claudeCode.bridgeUrl);
  return false;
}
