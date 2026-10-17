import Link from "next/link";
import { studio } from "../context";
import { listPosts } from "@/src/application/posts";
import { shellData } from "@/src/application/views";
import { Tabs, PageHead, StateBadge } from "@/components/Tabs";
import { Icon } from "@/components/icons";
import { ActionForm } from "@/components/Form";
import { newManualPost } from "../actions";

const TABS = [
  { id: "drafts", label: "Drafts", match: ["draft", "in_review"] },
  { id: "approved", label: "Approved", match: ["approved"] },
  { id: "published", label: "Published", match: ["published"] },
];

export default async function Posts({ searchParams }: { searchParams: Promise<{ tab?: string; campaign?: string }> }) {
  const sp = await searchParams;
  const { actor, ws } = await studio();
  const [all, shell] = await Promise.all([listPosts(actor, ws), shellData(actor, ws)]);
  const scoped = sp.campaign ? all.filter((p: any) => shell.campaigns.find((c: any) => c.id === sp.campaign)?.name === p.campaign) : all;
  const tab = TABS.find((t) => t.id === sp.tab) ?? TABS[0];
  const rows = scoped.filter((p: any) => tab.match.includes(p.editorial_state));
  const campaign = shell.campaigns.find((c: any) => c.id === sp.campaign);

  return (
    <>
      <Tabs base={sp.campaign ? `/posts?campaign=${sp.campaign}` : "/posts"} active={tab.id}
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, count: scoped.filter((p: any) => t.match.includes(p.editorial_state)).length }))} />
      <div className="p-4 md:p-6">
        <PageHead title="Posts" sub={campaign ? `Campaign: ${campaign.name}` : "All campaigns"}>
          {campaign && <Link href="/posts" className="text-sm underline">Show all</Link>}
        </PageHead>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((p: any) => (
            <Link key={p.variant_id} href={`/posts/${p.variant_id}`} className="card overflow-hidden hover:border-accent flex flex-col">
              <div className="aspect-[4/3] bg-panel-2 grid place-items-center border-b border-line">
                {p.asset_id
                  ? <img src={`/api/assets/${p.asset_id}`} alt="" className="w-full h-full object-cover" />
                  : <Icon name="image" className="size-10 text-muted" />}
              </div>
              <div className="p-3 flex-1">
                <div className="flex justify-between gap-2 items-center"><span className="text-xs uppercase tracking-wide text-muted">{p.platform}</span><StateBadge state={p.editorial_state} /></div>
                <p className="font-medium mt-1 line-clamp-1">{p.concept}</p>
                <p className="text-sm text-muted line-clamp-2 mt-1">{p.caption || "No caption yet"}</p>
                <p className="text-xs text-muted mt-2">{p.campaign} · rev {p.current_revision}{p.ai_generated ? " · AI draft" : ""}</p>
              </div>
            </Link>
          ))}
        </div>
        {!rows.length && <p className="text-sm text-muted">No {tab.label.toLowerCase()} posts{campaign ? " in this campaign" : ""}. Ask the coordinator on the Agents page, or write one below.</p>}

        <section className="card p-4 mt-6 flex flex-col sm:flex-row gap-4">
          <span className="size-11 shrink-0 rounded-full bg-panel-2 border border-line grid place-items-center"><Icon name="plus" /></span>
          <div className="flex-1">
            <h2 className="font-semibold">Write a post yourself</h2>
            <p className="text-sm text-muted">Manual drafting works without AI.</p>
            {shell.campaigns.length ? (
              <ActionForm action={newManualPost} submit="Create draft" className="grid gap-3 sm:grid-cols-2 mt-3">
                <div><label className="label" htmlFor="campaignId">Campaign</label><select id="campaignId" name="campaignId" className="field" defaultValue={sp.campaign}>{shell.campaigns.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                <div><label className="label" htmlFor="platform">Platform</label><select id="platform" name="platform" className="field"><option value="instagram">Instagram (image post)</option><option value="linkedin">LinkedIn (text or image)</option></select></div>
                <div className="sm:col-span-2"><label className="label" htmlFor="concept">Working title</label><input id="concept" name="concept" required maxLength={300} className="field" /></div>
                <div className="sm:col-span-2"><label className="label" htmlFor="caption">Caption</label><textarea id="caption" name="caption" rows={3} maxLength={3000} className="field" /></div>
              </ActionForm>
            ) : <Link href="/settings?tab=campaigns" className="underline text-sm">Create a campaign first</Link>}
          </div>
        </section>
      </div>
    </>
  );
}
