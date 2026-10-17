import Link from "next/link";
import { studio } from "../context";
import { listDeliveries } from "@/src/application/deliveries";
import { listPosts } from "@/src/application/posts";
import { listConnections } from "@/src/application/connections";
import { PageHead, StateBadge } from "@/components/Tabs";
import { DELIVERY_LABEL, type DeliveryState } from "@/src/domain/delivery";

/** In-app notifications derived from persisted state (FR39); email is P1. */
export default async function Notifications() {
  const { actor, ws } = await studio();
  const [ds, posts, conns] = await Promise.all([listDeliveries(actor, ws), listPosts(actor, ws), listConnections(actor, ws)]);
  const items = [
    ...ds.filter((d: any) => ["needs_reconciliation", "needs_connection", "needs_rescheduling", "failed"].includes(d.state))
      .map((d: any) => ({ key: d.id, state: d.state, text: `${d.concept} (${d.account_name}): ${DELIVERY_LABEL[d.state as DeliveryState]}`, href: "/calendar?tab=agenda" })),
    ...conns.connections.filter((c: any) => c.status === "invalid").map((c: any) => ({ key: c.id, state: "invalid", text: `${c.provider} connection failed — reconnect`, href: "/accounts?tab=connections" })),
    ...posts.filter((p: any) => p.editorial_state === "draft").map((p: any) => ({ key: p.variant_id, state: "awaiting_approval", text: `${p.concept} is ready for review`, href: `/posts/${p.variant_id}` })),
  ];
  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <PageHead title="Notifications" />
      <ul className="card divide-y divide-line">{items.map((i) => (
        <li key={i.key}><Link href={i.href} className="p-3 flex justify-between gap-3 hover:bg-panel-2"><span className="text-sm">{i.text}</span><StateBadge state={i.state} /></Link></li>))}
        {!items.length && <li className="p-3 text-sm text-muted">You’re all caught up.</li>}</ul>
    </div>
  );
}
