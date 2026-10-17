export type Availability = "available" | "unavailable" | "stale" | "permission_expired";

export interface MetricCell {
  metric: string;
  value: number | null;
  availability: Availability;
  reason?: string | null;
  providerSnapshotAt?: string | null;
  fetchedAt: string;
}

/** Display rule (FR36, AT21): unavailable/null is never rendered as zero. */
export function displayMetric(c: MetricCell): string {
  if (c.availability === "unavailable") return "Unavailable";
  if (c.availability === "permission_expired") return "Permission expired";
  if (c.value === null) return "No data";
  return c.availability === "stale" ? `${c.value} (stale)` : String(c.value);
}

/** Platform metric support for the beta. LinkedIn engagement is unavailable via the selected provider. */
export const METRIC_SUPPORT: Record<string, { metrics: string[]; note: string }> = {
  instagram: { metrics: ["likes", "comments", "reach"], note: "Provider snapshots; collection cadence depends on plan (Starter after ~1 day)." },
  linkedin: { metrics: [], note: "Engagement metrics unavailable: provider documentation excludes LinkedIn analytics." },
};

/** Only sum a metric within a single platform; refuse cross-platform totals of incompatible metrics. */
export function sumSamePlatform(cells: (MetricCell & { platform: string })[], platform: string, metric: string) {
  const rel = cells.filter((c) => c.platform === platform && c.metric === metric && c.availability === "available" && c.value !== null);
  return rel.length ? rel.reduce((s, c) => s + (c.value as number), 0) : null;
}
