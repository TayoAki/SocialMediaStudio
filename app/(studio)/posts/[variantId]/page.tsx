import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { studio } from "../../context";
import { getVariant } from "@/src/application/posts";
import { listConnections } from "@/src/application/connections";
import { listDeliveries } from "@/src/application/deliveries";
import { PageHead, StateBadge, Tabs } from "@/components/Tabs";
import { ActionForm } from "@/components/Form";
import { saveVariant, approveAndSchedule } from "../../actions";
import { formatInZone } from "@/src/domain/time";
import { DELIVERY_LABEL, type DeliveryState } from "@/src/domain/delivery";

export default async function Editor({ params, searchParams }: { params: Promise<{ variantId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { variantId } = await params;
  const tab = (await searchParams).tab ?? "edit";
  const { actor, ws, workspace } = await studio();
  const v = await getVariant(actor, ws, variantId).catch(() => null);
  if (!v) notFound();
  const { accounts } = await listConnections(actor, ws);
  const eligible = accounts.filter((a: any) => a.allowed && a.platform === v.platform);
  const deliveries = (await listDeliveries(actor, ws)).filter((d: any) => d.variant_id === variantId);
  const defaultTime = v.proposed_local_time ?? DateTime.now().setZone(workspace.timezone).plus({ days: 1 }).set({ hour: 9, minute: 0 }).toFormat("yyyy-LL-dd'T'HH:mm");
  const published = v.editorial_state === "published";

  return (
    <>
      <Tabs base={`/posts/${variantId}`} active={tab} tabs={[{ id: "edit", label: "Edit & approve" }, { id: "sources", label: "Sources", count: v.sources.length }, { id: "history", label: "History", count: v.revisions.length }]} />
      <div className="p-4 md:p-6">
        <PageHead title={v.concept} sub={`${v.platform} · revision ${v.current_revision}${v.ai_generated ? " · AI-generated draft" : ""}`}>
          <Link href="/posts" className="text-sm underline">All posts</Link>
        </PageHead>

        {tab === "edit" && (
          <div className="grid gap-6 xl:grid-cols-2">
            <section className="card p-4">
              <h2 className="font-semibold mb-3">Draft</h2>
              {published ? <p className="text-sm text-muted">Published variants are immutable.</p> : (
                <ActionForm action={saveVariant} submit="Save revision" pendingLabel="Saving…" className="space-y-4">
                  <input type="hidden" name="variantId" value={variantId} /><input type="hidden" name="version" value={v.version} />
                  <div><label className="label" htmlFor="caption">Caption</label><textarea id="caption" name="caption" rows={7} maxLength={3000} defaultValue={v.caption} className="field" /></div>
                  <div><label className="label" htmlFor="altText">Image alt text</label><input id="altText" name="altText" maxLength={1000} defaultValue={v.alt_text} className="field" /></div>
                  <div><label className="label" htmlFor="image">Replace image (JPEG, PNG or WebP, up to 20MB)</label><input id="image" name="image" type="file" accept="image/jpeg,image/png,image/webp" className="field" />
                    <label className="flex items-center gap-2 text-sm mt-2"><input type="checkbox" name="rights" className="size-5" /> I have the rights to use this image</label></div>
                  <p className="text-xs text-muted">Saving creates a new revision and invalidates any unused approval. Version {v.version}.</p>
                </ActionForm>
              )}
            </section>
            <section className="space-y-6">
              <div className="card overflow-hidden">
                <h2 className="font-semibold p-4 pb-2">Preview</h2>
                {v.asset_id && <img src={`/api/assets/${v.asset_id}`} alt={v.alt_text} className="w-full max-h-96 object-cover" />}
                <p className="p-4 whitespace-pre-wrap text-sm">{v.caption}</p>
              </div>
              {!published && (
                <div className="card p-4">
                  <h2 className="font-semibold">Approve exact version and schedule</h2>
                  <p className="text-sm text-muted mb-3">You are approving revision {v.current_revision}{v.asset_id ? ", this image" : ""}, the accounts you tick, and the time below in {workspace.timezone}.</p>
                  {eligible.length ? (
                    <ActionForm action={approveAndSchedule} submit="Approve and schedule" pendingLabel="Submitting…" className="space-y-3">
                      <input type="hidden" name="variantId" value={variantId} /><input type="hidden" name="version" value={v.version} />
                      <fieldset><legend className="label">Accounts</legend>
                        {eligible.map((a: any) => <label key={a.id} className="flex items-center gap-2 text-sm min-h-11"><input type="checkbox" name="accountIds" value={a.id} defaultChecked={eligible.length === 1} className="size-5" />{a.display_name}</label>)}
                      </fieldset>
                      <div><label className="label" htmlFor="localTime">Local time ({workspace.timezone})</label><input id="localTime" name="localTime" type="datetime-local" required defaultValue={defaultTime} className="field" /></div>
                      <div><label className="label" htmlFor="offset">Only if the time repeats at a clock change: UTC offset in minutes</label><input id="offset" name="offset" inputMode="numeric" placeholder="e.g. 60 or 0" className="field" /></div>
                    </ActionForm>
                  ) : <p className="text-sm">No allowlisted {v.platform} account. <Link href="/accounts" className="underline">Connect accounts</Link></p>}
                </div>
              )}
              {deliveries.length > 0 && (
                <div className="card p-4"><h2 className="font-semibold mb-2">Deliveries</h2>
                  <ul className="space-y-2">{deliveries.map((d: any) => (
                    <li key={d.id} className="text-sm flex flex-wrap justify-between gap-2"><span>{d.account_name} · rev {d.revision} · {formatInZone(d.scheduled_utc, workspace.timezone)}</span>
                      <StateBadge state={d.state} label={DELIVERY_LABEL[d.state as DeliveryState]} />
                      {d.remote_url && <a href={d.remote_url} className="underline w-full" rel="noreferrer noopener" target="_blank">View published post</a>}</li>))}</ul>
                  {deliveries.some((d: any) => d.revision !== v.current_revision) && <p className="text-xs text-warn mt-2">A previously approved revision is still the one scheduled until you cancel or replace it.</p>}
                </div>
              )}
            </section>
          </div>
        )}

        {tab === "sources" && (
          <ul className="space-y-3">{v.sources.map((s: any) => (
            <li key={s.id} className="card p-4"><a href={s.canonical_url} className="font-medium underline" target="_blank" rel="noreferrer noopener">{s.title}</a>
              <p className="text-xs text-muted">Retrieved {formatInZone(s.retrieved_at, workspace.timezone)}{s.published_at ? ` · published ${formatInZone(s.published_at, workspace.timezone)}` : ""}</p>
              <p className="text-sm mt-2">{s.excerpt}</p></li>))}
            {!v.sources.length && <li className="text-sm text-muted">No research sources. This draft makes no sourced claims.</li>}</ul>
        )}

        {tab === "history" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <section><h2 className="font-semibold mb-2">Revisions</h2><ol className="card divide-y divide-line">{v.revisions.map((r: any) => (
              <li key={r.revision} className="p-3 text-sm"><p className="font-medium">Revision {r.revision}{r.ai_generated ? " · AI" : ""} <span className="text-muted font-normal">· {formatInZone(r.created_at, workspace.timezone)}</span></p><p className="text-muted line-clamp-2 mt-1">{r.caption}</p></li>))}</ol></section>
            <section><h2 className="font-semibold mb-2">Approvals</h2><ol className="card divide-y divide-line">{v.approvals.map((a: any) => (
              <li key={a.id} className="p-3 text-sm"><p>Revision {a.revision} for {a.tuple.localTime} ({a.tuple.timezone})</p>
                <StateBadge state={a.invalidated_reason ? "invalid" : a.consumed_at ? "succeeded" : "pending"} label={a.invalidated_reason ? `Invalidated: ${a.invalidated_reason.replace("_", " ")}` : a.consumed_at ? "Used" : "Not yet used"} /></li>))}
              {!v.approvals.length && <li className="p-3 text-sm text-muted">Not approved yet.</li>}</ol></section>
          </div>
        )}
      </div>
    </>
  );
}
