// bagw provider — talks to the local Browser Agent Gateway (https://github.com/xorvo/bagw).
// bagw runs your installed agent (Claude Code by default) using your existing
// config, so no credentials live in the browser. The token is obtained by
// pairing (the user approves this extension once); see options pairing flow.

export async function callBagw({ url, token, agent, model, system, user }) {
  const base = (url || "http://127.0.0.1:8765").replace(/\/+$/, "");

  let res;
  try {
    res = await fetch(`${base}/invoke`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        agent: agent || "claude",
        model: model || undefined,
        system,
        user,
      }),
    });
  } catch (e) {
    throw new Error(
      `Couldn't reach bagw at ${base}. Is it running?  (brew services start bagw, ` +
        `or: bagw start)  (${e?.message || e})`
    );
  }

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(
        "bagw hasn't approved this extension yet. Open settings and click Connect, then approve the request."
      );
    }
    let detail = "";
    try {
      const j = await res.json();
      detail = j?.error || JSON.stringify(j);
    } catch {
      detail = await res.text();
    }
    throw new Error(`bagw error (${res.status}): ${detail}`);
  }

  const data = await res.json();
  if (!data || typeof data.text !== "string") {
    throw new Error("bagw returned an unexpected response.");
  }
  return data.text;
}
