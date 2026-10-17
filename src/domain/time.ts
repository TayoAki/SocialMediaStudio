import { DateTime, IANAZone } from "luxon";

export type LocalResolution =
  | { kind: "ok"; utc: string; offsetMinutes: number }
  | { kind: "nonexistent"; message: string }
  | { kind: "ambiguous"; offsets: number[]; message: string }
  | { kind: "invalid"; message: string };

const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * Resolve a wall-clock time in an IANA zone to a UTC instant (FR34).
 * Never uses the server timezone. Spring-forward gaps are rejected; fall-back
 * overlaps require the caller to choose one of the returned offsets.
 */
export function resolveLocalTime(local: string, zone: string, chosenOffsetMinutes?: number): LocalResolution {
  if (!LOCAL.test(local)) return { kind: "invalid", message: "Use YYYY-MM-DDTHH:mm" };
  if (!IANAZone.isValidZone(zone)) return { kind: "invalid", message: `Unknown timezone ${zone}` };
  const [d, t] = local.split("T");
  const [year, month, day] = d.split("-").map(Number);
  const [hour, minute] = t.split(":").map(Number);

  const candidates = new Set<number>();
  // Probe offsets in effect around the wall time and keep those that round-trip exactly.
  const probe = DateTime.fromObject({ year, month, day, hour: 12 }, { zone });
  for (const h of [-36, -12, 0, 12, 36]) {
    const off = probe.plus({ hours: h }).offset;
    const utcMs = Date.UTC(year, month - 1, day, hour, minute) - off * 60_000;
    const back = DateTime.fromMillis(utcMs, { zone });
    if (back.offset === off && back.hour === hour && back.minute === minute && back.day === day) candidates.add(off);
  }
  const offsets = [...candidates].sort((a, b) => b - a);
  if (offsets.length === 0) return { kind: "nonexistent", message: `${local} does not exist in ${zone} (clock change). Choose another time.` };
  if (offsets.length > 1 && chosenOffsetMinutes === undefined)
    return { kind: "ambiguous", offsets, message: `${local} occurs twice in ${zone}. Choose an offset.` };
  const off = offsets.length > 1 ? chosenOffsetMinutes! : offsets[0];
  if (!offsets.includes(off)) return { kind: "invalid", message: "Chosen offset does not apply to that time" };
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute) - off * 60_000).toISOString();
  return { kind: "ok", utc, offsetMinutes: off };
}

export function formatInZone(utc: string | Date, zone: string) {
  const dt = DateTime.fromJSDate(new Date(utc), { zone });
  return dt.toFormat("ccc d LLL yyyy, HH:mm ZZZZ");
}
