import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function privateV4(ip: string) {
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
function privateV6(ip: string) {
  const s = ip.toLowerCase();
  return s === "::1" || s === "::" || s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe80") ||
    (s.startsWith("::ffff:") && privateV4(s.slice(7)));
}
export function isPrivateAddress(ip: string) {
  return isIP(ip) === 4 ? privateV4(ip) : isIP(ip) === 6 ? privateV6(ip) : true;
}

/** SSRF guard for research retrieval: https/http only, no credentials, public addresses only. */
export async function assertPublicUrl(raw: string) {
  const u = new URL(raw);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only http(s) URLs may be retrieved");
  if (u.username || u.password) throw new Error("URLs with credentials are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  if (addrs.some(isPrivateAddress)) throw new Error("Private, loopback and metadata addresses are blocked");
  return u;
}
