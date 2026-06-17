// Minimal AWS Signature Version 4 signer using Web Crypto (SubtleCrypto).
// Enough to sign Bedrock Runtime InvokeModel requests from the service worker.
// No external dependencies.

const enc = new TextEncoder();

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

async function sha256Hex(message) {
  const data = typeof message === "string" ? enc.encode(message) : message;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest);
}

async function hmac(keyBytes, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

// YYYYMMDD'T'HHMMSS'Z'
function amzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/**
 * Sign a request. Returns the headers object to send (including Authorization).
 *
 * @param {object} opts
 * @param {string} opts.method - e.g. "POST"
 * @param {string} opts.url - full https URL (path may be pre-encoded)
 * @param {string} opts.region
 * @param {string} opts.service - e.g. "bedrock"
 * @param {string} opts.accessKeyId
 * @param {string} opts.secretAccessKey
 * @param {string} [opts.sessionToken]
 * @param {object} [opts.headers] - extra headers (content-type, etc.)
 * @param {string} opts.body - request body string
 */
export async function signRequest({
  method,
  url,
  region,
  service,
  accessKeyId,
  secretAccessKey,
  sessionToken,
  headers = {},
  body = "",
}) {
  const u = new URL(url);
  const now = new Date();
  const amzdate = amzDate(now);
  const datestamp = amzdate.slice(0, 8);

  const payloadHash = await sha256Hex(body);

  // Assemble headers to sign (lowercase names, sorted).
  const baseHeaders = {
    host: u.host,
    "x-amz-date": amzdate,
    "x-amz-content-sha256": payloadHash,
  };
  if (headers["content-type"] || headers["Content-Type"]) {
    baseHeaders["content-type"] =
      headers["content-type"] || headers["Content-Type"];
  }
  if (sessionToken) baseHeaders["x-amz-security-token"] = sessionToken;

  const sortedHeaderNames = Object.keys(baseHeaders).sort();
  const canonicalHeaders =
    sortedHeaderNames.map((h) => `${h}:${baseHeaders[h]}\n`).join("");
  const signedHeaders = sortedHeaderNames.join(";");

  const canonicalRequest = [
    method,
    u.pathname, // already percent-encoded by caller
    u.search.slice(1), // canonical query string (empty for invoke)
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${datestamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    algorithm,
    amzdate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  // Derive signing key.
  let key = enc.encode(`AWS4${secretAccessKey}`);
  key = await hmac(key, datestamp);
  key = await hmac(key, region);
  key = await hmac(key, service);
  key = await hmac(key, "aws4_request");
  const signature = toHex(await hmac(key, stringToSign));

  const authorization =
    `${algorithm} Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const outHeaders = {
    Authorization: authorization,
    "x-amz-date": amzdate,
    "x-amz-content-sha256": payloadHash,
  };
  if (baseHeaders["content-type"])
    outHeaders["Content-Type"] = baseHeaders["content-type"];
  if (sessionToken) outHeaders["x-amz-security-token"] = sessionToken;
  return outHeaders;
}
