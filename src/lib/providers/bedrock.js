// AWS Bedrock provider — Claude via the Bedrock Runtime InvokeModel endpoint,
// signed with SigV4. Requires host permission for
// https://bedrock-runtime.*.amazonaws.com/*.

import { signRequest } from "../sigv4.js";

const BEDROCK_ANTHROPIC_VERSION = "bedrock-2023-05-31";

export async function callBedrock({
  region,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  modelId,
  system,
  user,
  maxTokens = 2048,
}) {
  if (!accessKeyId || !secretAccessKey)
    throw new Error("Missing AWS credentials. Open settings to add them.");
  if (!modelId) throw new Error("Missing Bedrock model ID. Open settings to add one.");

  const host = `bedrock-runtime.${region}.amazonaws.com`;
  // The model id contains "." and ":" — percent-encode it for the path.
  const path = `/model/${encodeURIComponent(modelId)}/invoke`;
  const url = `https://${host}${path}`;

  const body = JSON.stringify({
    anthropic_version: BEDROCK_ANTHROPIC_VERSION,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });

  const signedHeaders = await signRequest({
    method: "POST",
    url,
    region,
    service: "bedrock",
    accessKeyId,
    secretAccessKey,
    sessionToken,
    headers: { "content-type": "application/json" },
    body,
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { ...signedHeaders, Accept: "application/json" },
    body,
  });

  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err?.message || JSON.stringify(err);
    } catch {
      detail = await res.text();
    }
    throw new Error(`Bedrock error (${res.status}): ${detail}`);
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return text;
}
