// HMAC-SHA256 signing shared by both directions of the n8n integration.
// Signed string: `${timestamp}.${rawBody}`; header value: `sha256=<hex>`. Same scheme as Stripe/Slack webhooks.

export const SIGNATURE_HEADER = "x-lendloop-signature";
export const TIMESTAMP_HEADER = "x-lendloop-timestamp";
export const REPLAY_WINDOW_SECONDS = 300;

const encoder = new TextEncoder();

export async function sign(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
  return "sha256=" + Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Compares every byte regardless of where the first mismatch is, so timing does not leak the expected MAC.
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export async function verify(opts: {
  secret: string | undefined;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowSeconds?: number;
}): Promise<VerifyResult> {
  const { secret, timestamp, signature, body } = opts;
  if (!secret) return { ok: false, reason: "server secret not configured" };
  if (!timestamp || !signature) return { ok: false, reason: "missing signature headers" };
  if (!/^\d{10}$/.test(timestamp)) return { ok: false, reason: "malformed timestamp" };
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: "timestamp outside replay window" };
  }
  const expected = await sign(secret, timestamp, body);
  return timingSafeEqual(expected, signature) ? { ok: true } : { ok: false, reason: "bad signature" };
}
