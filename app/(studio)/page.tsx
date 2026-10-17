import Link from "next/link";
import { studio } from "./context";
import { overview } from "@/src/application/views";
import { PageHead, StateBadge } from "@/components/Tabs";
import { DELIVERY_LABEL, type DeliveryState } from "@/src/domain/delivery";
import { formatInZone } from "@/src/domain/time";

export default async function Overview() {
  const { actor, ws, workspace } = await studio();
  const o = await overview(actor, ws);
  const steps = [
    { done: o.checklist.brand, label: "Complete the brand profile", href: "/settings?tab=brand" },
    { done: o.checklist.campaign, label: "Create a campaign", href: "/settings?tab=campaigns" },
    { done: o.checklist.draft, label: "Ask the coordinator for drafts", href: "/agents" },
    { done: o.checklist.connection, label: "Connect and allowlist a publishing account", href: "/accounts" },
  ];
  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <PageHead title="Overview" sub={workspace.name} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/posts?tab=drafts" className="card p-4 hover:border-accent"><p className="text-sm text-muted">Awaiting your review</p><p className="text-3xl font-semibold mt-1">{o.awaitingReview}</p></Link>
        <Link href="/calendar" className="card p-4 hover:border-accent"><p className="text-sm text-muted">Upcoming deliveries</p><p className="text-3xl font-semibold mt-1">{o.next.length}</p></Link>
        <Link href="/notifications" className="card p-4 hover:border-accent"><p className="text-sm text-muted">Need attention</p><p className={`text-3xl font-semibold mt-1 ${o.problems.length ? "text-bad" : ""}`}>{o.problems.length}</p></Link>
      </div>
      {steps.some((s) => !s.done) && (
        <section className="card p-4 mt-6"><h2 className="font-semibold mb-3">Get started</h2>
          <ol className="space-y-2">{steps.map((s, i) => (
            <li key={i} className="flex items-center gap-3 text-sm"><span aria-hidden className={`size-5 rounded-full grid place-items-center text-xs ${s.done ? "bg-ok text-white" : "border border-line"}`}>{s.done ? "✓" : i + 1}</span>
              {s.done ? <span className="text-muted line-through">{s.label}</span> : <Link href={s.href} className="underline">{s.label}</Link>}</li>))}</ol>
        </section>
      )}
      <section className="mt-6"><h2 className="font-semibold mb-2">Next posts</h2>
        <ul className="card divide-y divide-line">{o.next.map((d: any) => (
          <li key={d.id} className="p-3 flex flex-wrap justify-between gap-2"><span className="text-sm">{d.concept} <span className="text-muted">· {d.platform}</span></span>
            <span className="flex gap-3 items-center text-sm"><span>{formatInZone(d.scheduled_utc, workspace.timezone)}</span><StateBadge state={d.state} label={DELIVERY_LABEL[d.state as DeliveryState]} /></span></li>))}
          {!o.next.length && <li className="p-3 text-sm text-muted">Nothing scheduled yet.</li>}</ul>
      </section>
      {o.problems.length > 0 && <section className="mt-6"><h2 className="font-semibold mb-2">Needs attention</h2>
        <ul className="card divide-y divide-line">{o.problems.map((d: any) => (
          <li key={d.id} className="p-3 flex justify-between gap-2 text-sm"><span>{d.concept} · {d.platform}</span><Link href="/calendar?tab=agenda" className="underline"><StateBadge state={d.state} label={DELIVERY_LABEL[d.state as DeliveryState]} /></Link></li>))}</ul></section>}
    </div>
  );
}
