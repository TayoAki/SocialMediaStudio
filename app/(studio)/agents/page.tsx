import Link from "next/link";
import { randomUUID } from "node:crypto";
import { studio } from "../context";
import { shellData } from "@/src/application/views";
import { conversation } from "@/src/application/conversation";
import { Tabs, PageHead, StateBadge } from "@/components/Tabs";
import { ActionForm } from "@/components/Form";
import { sendMessage, stopPlan } from "../actions";
import { formatInZone } from "@/src/domain/time";
import { OFFICE_ROLES } from "@/components/Office";

export default async function Agents({ searchParams }: { searchParams: Promise<{ tab?: string; campaign?: string; role?: string }> }) {
  const sp = await searchParams;
  const { actor, ws, workspace } = await studio();
  const shell = await shellData(actor, ws);
  const campaign = shell.campaigns.find((c: any) => c.id === sp.campaign) ?? shell.campaigns[0];
  const tab = sp.tab ?? (sp.role ? "tasks" : "chat");
  if (!campaign) return <div className="p-6"><PageHead title="Agents" /><p className="text-sm">Create a campaign first. <Link className="underline" href="/settings?tab=campaigns">New campaign</Link></p></div>;
  const conv = await conversation(actor, ws, campaign.id);
  const tasks = sp.role ? conv.tasks.filter((t: any) => t.role === sp.role) : conv.tasks;
  const openPlans = [...new Set(conv.tasks.filter((t: any) => ["queued", "running", "awaiting_input"].includes(t.state)).map((t: any) => t.plan_id))];
  const base = `/agents?campaign=${campaign.id}${sp.role ? `&role=${sp.role}` : ""}`;

  return (
    <>
      <Tabs base={base} active={tab} tabs={[{ id: "chat", label: "Coordinator" }, { id: "tasks", label: "Tasks", count: tasks.length }, { id: "team", label: "Specialists" }]} />
      <div className="p-4 md:p-6 max-w-4xl">
        <PageHead title="Agents" sub={`Campaign: ${campaign.name}${sp.role ? ` · showing ${sp.role}` : ""}`}>
          <form className="flex gap-2 items-end" action="/agents"><label className="sr-only" htmlFor="campaign">Campaign</label>
            <select id="campaign" name="campaign" defaultValue={campaign.id} className="field w-48">{shell.campaigns.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <button className="btn btn-ghost">Switch</button></form>
        </PageHead>

        {tab === "chat" && (
          <>
            <ol className="space-y-3 mb-6" aria-label="Conversation">
              {conv.messages.map((m: any, i: number) => (
                <li key={i} className={`card p-3 max-w-[85%] ${m.role === "user" ? "ml-auto bg-panel-2" : ""}`}>
                  <p className="text-xs text-muted capitalize">{m.role} · {formatInZone(m.created_at, workspace.timezone)}</p>
                  <p className="text-sm whitespace-pre-wrap mt-1">{m.body}</p>
                </li>))}
              {!conv.messages.length && <li className="text-sm text-muted">Try: “Create two Instagram image posts for our coffee-shop opening, one tomorrow and one the following day at 8am”.</li>}
            </ol>
            <ActionForm action={sendMessage} submit="Send to coordinator" pendingLabel="Sending…" className="card p-4">
              <input type="hidden" name="campaignId" value={campaign.id} /><input type="hidden" name="clientMessageId" value={randomUUID()} />
              <label className="label" htmlFor="text">Message</label>
              <textarea id="text" name="text" rows={3} required maxLength={4000} className="field" placeholder="What should the team prepare?" />
              <p className="text-xs text-muted mt-2">Drafts are always created for review. Nothing is published without your explicit approval.</p>
            </ActionForm>
            {openPlans.map((p) => <form key={p as string} action={stopPlan} className="mt-3"><input type="hidden" name="planId" value={p as string} /><button className="btn btn-ghost text-sm">Stop remaining work</button></form>)}
          </>
        )}

        {tab === "tasks" && (
          <ul className="card divide-y divide-line">
            {tasks.map((t: any) => (
              <li key={t.id} className="p-3 flex flex-wrap gap-2 justify-between">
                <span className="text-sm"><span className="capitalize font-medium">{t.role}</span> · {t.summary ?? t.plan_key}{t.error_code && <span className="text-bad"> ({t.error_code})</span>}</span>
                <span className="flex gap-3 items-center"><StateBadge state={t.state} /><span className="text-xs text-muted">{formatInZone(t.updated_at, workspace.timezone)}</span></span>
              </li>))}
            {!tasks.length && <li className="p-3 text-sm text-muted">No tasks{sp.role ? ` for ${sp.role}` : ""}.</li>}
          </ul>
        )}

        {tab === "team" && (
          <ul className="grid gap-3 sm:grid-cols-2">
            {OFFICE_ROLES.map((r) => (
              <li key={r.role} className="card p-4"><Link href={`/agents?campaign=${campaign.id}&role=${r.role}&tab=tasks`} className="font-medium underline">{r.label}</Link>
                <p className="text-sm text-muted mt-1">{({ coordinator: "Turns requests into a bounded plan; asks when facts are missing.", researcher: "Saves dated sources with URLs; no trend claims without evidence.", creator: "Writes captions, alt text and image briefs from your brand profile.", scheduler: "Proposes times; can only schedule what you approved.", analytics: "Reads available metrics and states coverage and freshness." } as Record<string, string>)[r.role]}</p></li>))}
          </ul>
        )}
      </div>
    </>
  );
}
