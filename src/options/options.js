import { getSettings, saveSettings } from "../lib/storage.js";
import { PERSONAS } from "../lib/personas.js";

const $ = (id) => document.getElementById(id);

function splitList(value) {
  return String(value || "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function setProviderVisibility(provider) {
  $("claudecode-section").classList.toggle("active", provider === "claudecode");
  $("anthropic-section").classList.toggle("active", provider === "anthropic");
  $("bedrock-section").classList.toggle("active", provider === "bedrock");
}

function selectedProvider() {
  const el = document.querySelector('input[name="provider"]:checked');
  return el ? el.value : "anthropic";
}

async function load() {
  const s = await getSettings();

  document.querySelectorAll('input[name="provider"]').forEach((r) => {
    r.checked = r.value === s.provider;
    r.addEventListener("change", () => setProviderVisibility(selectedProvider()));
  });
  setProviderVisibility(s.provider);

  $("ccBridgeUrl").value = s.claudeCode.bridgeUrl || "http://127.0.0.1:8765";
  $("ccToken").value = s.claudeCode.token || "";
  $("ccModel").value = s.claudeCode.model || "";

  $("anthropicApiKey").value = s.anthropicApiKey || "";
  $("anthropicModel").value = s.anthropicModel || "claude-sonnet-4-6";

  $("bedrockRegion").value = s.bedrock.region || "";
  $("bedrockAccessKeyId").value = s.bedrock.accessKeyId || "";
  $("bedrockSecretAccessKey").value = s.bedrock.secretAccessKey || "";
  $("bedrockSessionToken").value = s.bedrock.sessionToken || "";
  $("bedrockModelId").value = s.bedrock.modelId || "";

  // Persona dropdown
  const personaSel = $("persona");
  PERSONAS.forEach((p) => {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = `${p.emoji || ""} ${p.name}`;
    if (p.id === s.personaId) o.selected = true;
    personaSel.appendChild(o);
  });
  const updateDesc = () => {
    const p = PERSONAS.find((x) => x.id === personaSel.value);
    $("personaDesc").textContent = p ? p.description : "";
  };
  personaSel.addEventListener("change", updateDesc);
  updateDesc();

  $("styleTone").value = (s.style.tone || []).join(", ");
  $("styleAvoid").value = (s.style.avoid || []).join(", ");
  $("styleFormat").value = s.style.format || "";
  $("stylePreserveVoice").checked = s.style.preserveVoice !== false;
  $("styleCustom").value = s.style.custom || "";

  $("showInlineButton").checked = s.showInlineButton !== false;
  $("autoDetectApp").checked = s.context.autoDetectApp !== false;
  $("disabledSites").value = (s.disabledSites || []).join("\n");
}

function collect() {
  return {
    provider: selectedProvider(),
    claudeCode: {
      bridgeUrl: $("ccBridgeUrl").value.trim() || "http://127.0.0.1:8765",
      token: $("ccToken").value.trim(),
      model: $("ccModel").value.trim(),
    },
    anthropicApiKey: $("anthropicApiKey").value.trim(),
    anthropicModel: $("anthropicModel").value,
    bedrock: {
      region: $("bedrockRegion").value.trim() || "us-east-1",
      accessKeyId: $("bedrockAccessKeyId").value.trim(),
      secretAccessKey: $("bedrockSecretAccessKey").value.trim(),
      sessionToken: $("bedrockSessionToken").value.trim(),
      modelId: $("bedrockModelId").value.trim(),
    },
    personaId: $("persona").value,
    style: {
      tone: splitList($("styleTone").value),
      avoid: splitList($("styleAvoid").value),
      format: $("styleFormat").value.trim(),
      preserveVoice: $("stylePreserveVoice").checked,
      custom: $("styleCustom").value.trim(),
    },
    context: { autoDetectApp: $("autoDetectApp").checked },
    showInlineButton: $("showInlineButton").checked,
    disabledSites: splitList($("disabledSites").value),
  };
}

async function save() {
  await saveSettings(collect());
  const st = $("saveStatus");
  st.textContent = "Saved ✓";
  st.className = "save-status ok";
  // Tell open tabs to refresh their config.
  try {
    const tabs = await chrome.tabs.query({});
    tabs.forEach((t) => {
      if (t.id) chrome.tabs.sendMessage(t.id, { type: "WYT_CONFIG_UPDATED" }, () => void chrome.runtime.lastError);
    });
  } catch {}
  setTimeout(() => (st.textContent = ""), 2000);
}

function rewrite(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "WYT_REWRITE", payload }, (resp) => {
      if (chrome.runtime.lastError)
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(resp);
    });
  });
}

async function testConnection() {
  // Save first so the background uses the latest credentials.
  await saveSettings(collect());
  const st = $("testStatus");
  st.className = "test-status";
  st.innerHTML = `<span class="spinner"></span>Testing…`;
  const resp = await rewrite({
    actionId: "grammar",
    personaId: "none",
    text: "this is a quick conection test",
  });
  if (resp && resp.ok) {
    st.textContent = "Connection works ✓";
    st.className = "test-status ok";
  } else {
    st.textContent = resp?.error || "Connection failed.";
    st.className = "test-status err";
  }
}

$("save").addEventListener("click", save);
$("test").addEventListener("click", testConnection);
load();
