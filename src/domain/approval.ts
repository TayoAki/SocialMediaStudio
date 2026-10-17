import { createHash } from "node:crypto";

/** The exact publication tuple an approval binds (FR22). */
export interface PublicationTuple {
  variantId: string;
  revision: number;
  platform: "instagram" | "linkedin";
  caption: string;
  altText: string;
  assetChecksum: string | null;
  accountIds: string[];
  localTime: string;
  timezone: string;
  scheduledUtc: string;
  options: Record<string, unknown>;
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

export function tupleDigest(t: PublicationTuple) {
  return createHash("sha256").update(canonical({ ...t, accountIds: [...t.accountIds].sort() })).digest("hex");
}
