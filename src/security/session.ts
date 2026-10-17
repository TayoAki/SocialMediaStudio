import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { appMode } from "@/src/config";

/**
 * Session bridge. Fixture mode uses a signed, HttpOnly dev cookie for a labelled fixture
 * owner. Connected mode must verify InsForge sessions; that bridge is an open M0 item and
 * deliberately refuses instead of trusting an unverified cookie.
 */
const COOKIE = "sas_session";
const secret = () => process.env.SESSION_SECRET ?? process.env.APP_ENCRYPTION_KEY ?? "";

function sign(v: string) { return createHmac("sha256", secret()).update(v).digest("base64url"); }

export async function setSession(userId: string) {
  const exp = Date.now() + 12 * 3600_000;
  const v = `${userId}.${exp}`;
  (await cookies()).set(COOKIE, `${v}.${sign(v)}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600 });
}
export async function clearSession() { (await cookies()).delete(COOKIE); (await cookies()).delete("sas_ws"); }

export async function currentUserId(): Promise<string | null> {
  if (appMode() !== "fixture") return null;
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw || !secret()) return null;
  const [id, exp, mac] = raw.split(".");
  const expected = sign(`${id}.${exp}`);
  if (!mac || mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now()) return null;
  return id;
}

export async function requireActor() {
  const userId = await currentUserId();
  if (!userId) redirect("/sign-in");
  return { kind: "user" as const, userId };
}
