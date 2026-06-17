// Provider dispatch. Given settings + prompts, returns raw model text.
// Adding a new backend = add a case here and a file alongside.

import { callAnthropic } from "./anthropic.js";
import { callBedrock } from "./bedrock.js";
import { callClaudeCode } from "./claudecode.js";

export async function runProvider(settings, { system, user, maxTokens }) {
  if (settings.provider === "claudecode") {
    const cc = settings.claudeCode;
    return callClaudeCode({
      bridgeUrl: cc.bridgeUrl,
      token: cc.token,
      model: cc.model,
      system,
      user,
    });
  }

  if (settings.provider === "bedrock") {
    const b = settings.bedrock;
    return callBedrock({
      region: b.region,
      accessKeyId: b.accessKeyId,
      secretAccessKey: b.secretAccessKey,
      sessionToken: b.sessionToken,
      modelId: b.modelId,
      system,
      user,
      maxTokens,
    });
  }

  // default: anthropic
  return callAnthropic({
    apiKey: settings.anthropicApiKey,
    model: settings.anthropicModel,
    system,
    user,
    maxTokens,
  });
}
