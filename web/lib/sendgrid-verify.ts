import { createVerify } from "crypto";

const REPLAY_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export function verifySendgridWebhook(
  publicKeyPem: string,
  signature: string,
  timestamp: string,
  rawBody: string
): { ok: true } | { ok: false; reason: string } {
  // replay guard: reject timestamps older than 10 minutes
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: "invalid_timestamp" };
  }
  const age = Date.now() - ts * 1000;
  if (age > REPLAY_WINDOW_MS || age < -REPLAY_WINDOW_MS) {
    return { ok: false, reason: "timestamp_expired" };
  }

  // ECDSA-SHA256 verify over timestamp + rawBody
  const payload = timestamp + rawBody;
  const verifier = createVerify("SHA256");
  verifier.update(payload);

  let verified: boolean;
  try {
    verified = verifier.verify(publicKeyPem, signature, "base64");
  } catch {
    return { ok: false, reason: "verification_error" };
  }

  return verified ? { ok: true } : { ok: false, reason: "bad_signature" };
}
