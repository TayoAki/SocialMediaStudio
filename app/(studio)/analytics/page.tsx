import { studio } from "../context";
import { deliveryStats } from "@/src/application/views";
import { Tabs, PageHead } from "@/components/Tabs";
import { METRIC_SUPPORT } from "@/src/domain/metrics";
import { DELIVERY_LABEL, type DeliveryState } from "@/src/domain/delivery";

export default async function Analytics({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab ?? "health";
  const { actor, ws } = await studio();
  const stats = await deliveryStats(actor, ws);
  const platforms = [...new Set(stats.map((s: any) => s.platform))] as string[];
  return (
    <>
      <Tabs base="/analytics" active={tab} tabs={[{ id: "health", label: "Publishing health" }, { id: "engagement", label: "Engagement" }]} />
      <div className="p-4 md:p-6 max-w-4xl">
        <PageHead title="Analytics" sub="Counts come from our delivery records; engagement only where a verified source exists." />
        {tab === "health" && (platforms.length ? (
          <div className="grid gap-4 sm:grid-cols-2">{platforms.map((p) => (
            <section key={p} className="card p-4"><h2 className="font-semibold capitalize mb-2">{p}</h2>
              <table className="w-full text-sm"><tbody>{stats.filter((s: any) => s.platform === p).map((s: any) => (
                <tr key={s.state} className="border-t border-line"><td className="py-2">{DELIVERY_LABEL[s.state as DeliveryState]}</td><td className="py-2 text-right font-semibold">{s.n}</td></tr>))}</tbody></table>
            </section>))}</div>
        ) : <p className="text-sm text-muted">No deliveries yet.</p>)}
        {tab === "engagement" && (
          <div className="space-y-4">
            {Object.entries(METRIC_SUPPORT).map(([p, s]) => (
              <section key={p} className="card p-4"><h2 className="font-semibold capitalize">{p}</h2>
                <p className="text-sm text-muted mt-1">{s.note}</p>
                {s.metrics.length ? <p className="text-sm mt-2">Supported metrics: {s.metrics.join(", ")} — <span className="text-warn">not yet synced (provider analytics is an open connected-beta gate)</span>. Values show as “No data”, never zero.</p>
                  : <p className="text-sm mt-2 font-medium">Unavailable</p>}
              </section>))}
          </div>
        )}
      </div>
    </>
  );
}
