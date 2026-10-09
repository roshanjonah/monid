import { createHmac } from "node:crypto";

/**
 * Compute the `X-Sendmux-Signature` header value for an outbound tenant
 * webhook delivery. Matches §15.13 spec exactly:
 *
 *     X-Sendmux-Signature: sha256=<hmac-sha256(body, secret)>
 *
 * The secret is the plaintext `whsec_<base64url>` string the Sendmux API
 * returns once at webhook-create / rotate-secret time. We compute over the
 * exact bytes we're about to POST so recipients can recompute byte-for-byte.
 *
 * Tenants MUST verify with constant-time comparison on their side; we
 * document that in the API reference. This helper is sign-only.
 */
export function signWebhookBody(
  body: string | Buffer,
  secret: string,
  opts: { format?: "sendmux-header" | "base64" } = {},
): string {
  const mac = createHmac("sha256", secret);
  mac.update(body);
  if (opts.format === "base64") return mac.digest("base64");
  return `sha256=${mac.digest("hex")}`;
}

export function signTimestampedWebhookBody(
  body: string | Buffer,
  secret: string,
  timestampSeconds = Math.floor(Date.now() / 1000),
): string {
  const mac = createHmac("sha256", secret);
  mac.update(`${timestampSeconds}.`);
  mac.update(body);
  return `t=${timestampSeconds},v1=${mac.digest("hex")}`;
}
