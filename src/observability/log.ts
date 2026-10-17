import { redact } from "@/src/security/crypto";

/** Structured log. Never pass prompts, captions or credentials here; IDs and codes only. */
export function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === "test" && level !== "error") return;
  const line = redact(JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields }));
  (level === "error" ? console.error : console.log)(line);
}
