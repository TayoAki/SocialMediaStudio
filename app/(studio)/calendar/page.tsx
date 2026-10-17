import { DateTime } from "luxon";
import { studio } from "../context";
import { listDeliveries } from "@/src/application/deliveries";
import { Tabs, PageHead, StateBadge } from "@/components/Tabs";
import { ActionForm } from "@/components/Form";
import { rescheduleAction, cancelAction, refreshStatus, resolveAction } from "../actions";
import { DELIVERY_LABEL, type DeliveryState } from "@/src/domain/delivery";
import { formatInZone } from "@/src/domain/time";
import Link from "next/link";

export default async function Calendar({ searchParams }: { searchParams: Promise<{ tab?: string; month?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab ?? "agenda";
  const { actor, ws, workspace } = await studio();
  const tz = workspace.timezone;
  const ds = await listDeliveries(actor, ws);
  const month = sp.month ? DateTime.fromFormat(sp.month, "yyyy-LL", { zone: tz }) : DateTime.now().setZone(tz).startOf("month");
  const gridStart = month.startOf("month").startOf("week");
  const days = Array.from({ length: 42 }, (_, i) => gridStart.plus({ days: i }));
  const byDay = (d: DateTime) => ds.filter((x: any) => DateTime.fromJSDate(new Date(x.scheduled_utc), { zone: tz }).hasSame(d, "day"));

  return (
    <>
      <Tabs base="/calendar" active={tab} tabs={[{ id: "agenda", label: "Agenda", count: ds.length }, { id: "month", label: "Month" }]} />
      <div className="p-4 md:p-6">
        <PageHead title="Calendar" sub={`All times in ${tz}`} />
        {tab === "month" && (
          <>
            <div className="flex items-center gap-3 mb-3">
              <Link className="btn btn-ghost" href={`/calendar?tab=month&month=${month.minus({ months: 1 }).toFormat("yyyy-LL")}`}>Previous</Link>
              <h2 className="font-semibold">{month.toFormat("LLLL yyyy")}</h2>
              <Link className="btn btn-ghost" href={`/calendar?tab=month&month=${month.plus({ months: 1 }).toFormat("yyyy-LL")}`}>Next</Link>
            </div>
            <p className="text-sm text-muted md:hidden mb-3">On small screens, use the Agenda tab.</p>
            <div className="hidden md:grid grid-cols-7 gap-px bg-line card overflow-hidden" role="grid">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="bg-panel-2 text-xs font-semibold p-2" role="columnheader">{d}</div>)}
              {days.map((d) => (
                <div key={d.toISODate()} className={`bg-panel min-h-24 p-2 ${d.month !== month.month ? "opacity-50" : ""}`} role="gridcell">
                  <span className="text-xs text-muted">{d.day}</span>
                  {byDay(d).map((x: any) => <Link key={x.id} href="/calendar?tab=agenda" className="block text-xs mt-1 truncate rounded bg-panel-2 px-1">{DateTime.fromJSDate(new Date(x.scheduled_utc), { zone: tz }).toFormat("HH:mm")} {x.concept}</Link>)}
                </div>))}
            </div>
          </>
        )}
        {tab === "agenda" && (
          <ul className="space-y-3">
            {ds.map((d: any) => {
              const unknownOp = (d.operations ?? []).find((o: any) => o.state === "outcome_unknown");
              const pendingChange = (d.operations ?? []).find((o: any) => o.kind === "update" && ["pending", "in_flight"].includes(o.state));
              return (
                <li key={d.id} className="card p-4">
                  <div className="flex flex-wrap justify-between gap-2">
                    <div><p className="font-medium">{d.concept}</p><p className="text-sm text-muted">{d.platform} · {d.account_name} · revision {d.revision}</p></div>
                    <StateBadge state={d.state} label={DELIVERY_LABEL[d.state as DeliveryState]} />
                  </div>
                  <p className="text-sm mt-2">{formatInZone(d.scheduled_utc, tz)}{pendingChange && <span className="text-warn"> → requested {formatInZone(pendingChange.payload.scheduledUtc, tz)} (not yet confirmed)</span>}</p>
                  {d.observed_at && <p className="text-xs text-muted">Provider said “{d.observed_provider_state}” at {formatInZone(d.observed_at, tz)}</p>}
                  {d.remote_url && <a className="text-sm underline" href={d.remote_url} target="_blank" rel="noreferrer noopener">View post</a>}
                  <div className="flex flex-wrap gap-2 mt-3">
                    {d.provider_submission_id && !["published", "cancelled", "failed"].includes(d.state) &&
                      <form action={refreshStatus}><input type="hidden" name="deliveryId" value={d.id} /><button className="btn btn-ghost text-sm">Check status</button></form>}
                    {d.state === "scheduled" && <form action={cancelAction}><input type="hidden" name="deliveryId" value={d.id} /><input type="hidden" name="version" value={d.version} /><button className="btn btn-ghost text-sm">Request cancellation</button></form>}
                  </div>
                  {d.state === "scheduled" && d.provider_schedule_id && (
                    <details className="mt-3"><summary className="text-sm cursor-pointer min-h-11 flex items-center">Reschedule</summary>
                      <ActionForm action={rescheduleAction} submit="Confirm new time" className="mt-2 max-w-sm">
                        <input type="hidden" name="deliveryId" value={d.id} /><input type="hidden" name="version" value={d.version} />
                        <label className="label" htmlFor={`t-${d.id}`}>New local time ({tz})</label><input id={`t-${d.id}`} type="datetime-local" name="localTime" required defaultValue={d.local_time} className="field" />
                        <p className="text-xs text-muted mt-1">Old: {d.local_time}. The current time stays active until the provider confirms.</p>
                      </ActionForm></details>)}
                  {d.state === "scheduled" && !d.provider_schedule_id && <p className="text-xs text-warn mt-2">Provider confirmed the post, but its schedule ID could not be linked; edits and cancellation are blocked until reconciled.</p>}
                  {unknownOp && (
                    <details className="mt-3" open><summary className="text-sm font-medium text-warn cursor-pointer">Reconcile: the provider may or may not have accepted this</summary>
                      <p className="text-xs text-muted my-2">Check the provider’s queue/history. Do not resubmit unless you are sure it was not accepted. See docs/runbooks/reconciliation.md.</p>
                      <ActionForm action={resolveAction} submit="Record decision" className="grid gap-2 max-w-md">
                        <input type="hidden" name="operationId" value={unknownOp.id} />
                        <label className="label" htmlFor={`r-${d.id}`}>Finding</label>
                        <select id={`r-${d.id}`} name="resolution" className="field"><option value="attach">Found it — attach provider IDs</option><option value="not_accepted">Confirmed not accepted — allow one new attempt</option><option value="failed">Mark failed</option></select>
                        <input name="submissionId" placeholder="Provider submission ID (attach only)" className="field" />
                        <input name="scheduleId" placeholder="Provider schedule ID (attach only)" className="field" />
                        <textarea name="evidence" required minLength={5} placeholder="Evidence (what you checked and saw)" className="field" />
                      </ActionForm></details>)}
                </li>);
            })}
            {!ds.length && <li className="text-sm text-muted">Nothing scheduled. Approve a draft on the Posts page.</li>}
          </ul>
        )}
      </div>
    </>
  );
}
