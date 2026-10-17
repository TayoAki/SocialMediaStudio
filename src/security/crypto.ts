import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key() {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (!raw) throw new Error("APP_ENCRYPTION_KEY is required to store provider secrets");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes base64");
  return k;
}
export const keyVersion = () => Number(process.env.APP_ENCRYPTION_KEY_VERSION ?? 1);

/** AES-256-GCM. Output: v<keyVersion>.<iv>.<tag>.<ciphertext> (base64url parts). */
export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [`v${keyVersion()}`, iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptSecret(blob: string) {
  const [, iv, tag, ct] = blob.split(".");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

/** Non-reversible fingerprint for display: first 8 hex of sha256 plus last 4 chars masked. */
export function fingerprint(secret: string) {
  return `${createHash("sha256").update(secret).digest("hex").slice(0, 8)}…${secret.slice(-2).replace(/./g, "•")}`;
}

export function redact(s: string) {
  return s.replace(/(blotato-api-key|authorization)["']?\s*[:=]\s*["']?[^"',\s}]+/gi, "$1: [redacted]");
}
