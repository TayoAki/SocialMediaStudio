import { describe, expect, it } from "vitest";
import { resolveLocalTime } from "@/src/domain/time";
import { validatePlan } from "@/src/domain/plan";
import { canTransition } from "@/src/domain/delivery";
import { tupleDigest } from "@/src/domain/approval";
import { displayMetric, sumSamePlatform } from "@/src/domain/metrics";
import { inspectImage } from "@/src/security/upload";
import { isPrivateAddress } from "@/src/security/url";
import { fixturePng } from "@/src/providers/media/fixtureImage";
import { decryptSecret, encryptSecret, redact } from "@/src/security/crypto";
import "./setup";

describe("AT16 calendar time", () => {
  it("rejects spring-forward gap", () => {
    expect(resolveLocalTime("2026-03-29T01:30", "Europe/London").kind).toBe("nonexistent");
  });
  it("requires an explicit offset in the fall-back overlap", () => {
    const r = resolveLocalTime("2026-10-25T01:30", "Europe/London");
    expect(r).toMatchObject({ kind: "ambiguous", offsets: [60, 0] });
    const a = resolveLocalTime("2026-10-25T01:30", "Europe/London", 60);
    const b = resolveLocalTime("2026-10-25T01:30", "Europe/London", 0);
    expect(a.kind === "ok" && a.utc).toBe("2026-10-25T00:30:00.000Z");
    expect(b.kind === "ok" && b.utc).toBe("2026-10-25T01:30:00.000Z");
  });
  it("resolves ordinary times independent of server timezone", () => {
    const r = resolveLocalTime("2026-11-02T08:00", "America/New_York");
    expect(r.kind === "ok" && r.utc).toBe("2026-11-02T13:00:00.000Z");
  });
  it("rejects unknown zones", () => expect(resolveLocalTime("2026-11-02T08:00", "Mars/Base").kind).toBe("invalid"));
});

describe("AT04 plan validation", () => {
  const base = { intent: "create_posts", summary: "x", posts: [] };
  it("rejects cycles", () => {
    const r = validatePlan({ ...base, tasks: [
      { key: "a", role: "researcher", dependsOn: ["b"] }, { key: "b", role: "creator", dependsOn: ["a"] }] }, new Set());
    expect(r.ok).toBe(false);
  });
  it("rejects tools outside a role", () => {
    const r = validatePlan({ ...base, tasks: [{ key: "a", role: "researcher", tools: ["propose_times"] }] }, new Set());
    expect(r.ok === false && r.errors[0]).toMatch(/not allowed/);
  });
  it("rejects foreign accounts", () => {
    const r = validatePlan({ ...base, tasks: [], accountIds: ["7c9e6679-7425-40de-944b-e07fc1f90ae7"] }, new Set());
    expect(r.ok).toBe(false);
  });
  it("rejects excessive fan-out", () => {
    const posts = Array.from({ length: 26 }, () => ({ platform: "instagram", concept: "x" }));
    expect(validatePlan({ ...base, posts, tasks: [] }, new Set()).ok).toBe(false);
  });
});

describe("domain invariants", () => {
  it("never moves processing straight to scheduled or published back to anything", () => {
    expect(canTransition("published", "scheduled")).toBe(false);
    expect(canTransition("approved", "published")).toBe(false);
  });
  it("digest is order-insensitive for accounts but sensitive to content", () => {
    const t = { variantId: "v", revision: 1, platform: "instagram" as const, caption: "a", altText: "", assetChecksum: null, accountIds: ["1", "2"], localTime: "x", timezone: "UTC", scheduledUtc: "z", options: {} };
    expect(tupleDigest(t)).toBe(tupleDigest({ ...t, accountIds: ["2", "1"] }));
    expect(tupleDigest(t)).not.toBe(tupleDigest({ ...t, caption: "b" }));
  });
  it("AT21 unavailable metrics are never zero", () => {
    expect(displayMetric({ metric: "likes", value: null, availability: "unavailable", fetchedAt: "" })).toBe("Unavailable");
    expect(sumSamePlatform([{ platform: "linkedin", metric: "likes", value: null, availability: "unavailable", fetchedAt: "" }], "linkedin", "likes")).toBeNull();
  });
});

describe("AT18 upload security", () => {
  it("accepts a real PNG and reads dimensions", () => {
    expect(inspectImage(fixturePng("x", 32))).toMatchObject({ mime: "image/png", width: 32, height: 32 });
  });
  it("rejects SVG/HTML even if renamed", () => {
    expect(() => inspectImage(Buffer.from("<svg onload=alert(1)></svg>"))).toThrow(/Only JPEG/);
  });
  it("rejects decompression bombs by declared pixel count", () => {
    const png = fixturePng("x", 8);
    png.writeUInt32BE(20000, 16); png.writeUInt32BE(20000, 20);
    expect(() => inspectImage(png)).toThrow(/40 megapixels/);
  });
});

describe("AT19/AT25 security helpers", () => {
  it("blocks private and metadata addresses", () => {
    for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.1", "::1", "fd00::1"]) expect(isPrivateAddress(ip)).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
  });
  it("round-trips encrypted secrets and redacts headers", () => {
    expect(decryptSecret(encryptSecret("k-123"))).toBe("k-123");
    expect(redact('{"blotato-api-key":"abc123"}')).not.toContain("abc123");
  });
});
