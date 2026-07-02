// OpenAI provider (and OpenAI-compatible endpoints via baseUrl override).
// Uses the Chat Completions API. Called from the background service worker, so
// host permissions cover CORS (same pattern as the Anthropic provider).

export async function callOpenAI({ apiKey, baseUrl, model, system, user, maxTokens = 2048 }) {
  if (!apiKey) throw new Error("Missing OpenAI API key. Open settings to add one.");
  const base = (baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_completion_tokens: maxTokens,
      // Our prompt asks for a JSON object; this makes the output reliably parseable.
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err?.error?.message || JSON.stringify(err);
    } catch {
      detail = await res.text();
    }
    throw new Error(`OpenAI API error (${res.status}): ${detail}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  if (!text) throw new Error("OpenAI returned an empty response.");
  return text;
}
