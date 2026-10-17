import { studio } from "../context";
import { getBrand } from "@/src/application/workspaces";
import { Tabs, PageHead } from "@/components/Tabs";
import { ActionForm } from "@/components/Form";
import { saveBrand, createCampaignAction } from "../actions";

export default async function Settings({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab ?? "brand";
  const { actor, ws, workspace } = await studio();
  const b = await getBrand(actor, ws);
  const F = ({ id, label, value, rows = 2, hint }: { id: string; label: string; value: string; rows?: number; hint?: string }) => (
    <div><label className="label" htmlFor={id}>{label}</label><textarea id={id} name={id} rows={rows} defaultValue={value ?? ""} className="field" />{hint && <p className="text-xs text-muted mt-1">{hint}</p>}</div>);
  return (
    <>
      <Tabs base="/settings" active={tab} tabs={[{ id: "brand", label: "Brand profile" }, { id: "campaigns", label: "Campaigns" }, { id: "data", label: "Budget & data" }]} />
      <div className="p-4 md:p-6 max-w-3xl">
        <PageHead title="Settings" sub={`${workspace.name} · ${workspace.timezone}`} />
        {tab === "brand" && (
          <ActionForm action={saveBrand} submit="Save brand profile" className="space-y-4">
            <input type="hidden" name="version" value={b.version} />
            <F id="business" label="What the business does" value={b.business_description} rows={3} />
            <F id="audience" label="Audience" value={b.audience} />
            <F id="offer" label="Products / offer" value={b.offer} hint="Agents only state facts that appear here or in cited sources." />
            <F id="voice" label="Voice rules" value={b.voice_rules} />
            <F id="prohibited" label="Prohibited claims" value={b.prohibited_claims} />
            <div><label className="label" htmlFor="website">Website</label><input id="website" name="website" type="url" defaultValue={b.website ?? ""} className="field" /></div>
            <p className="text-xs text-muted">Version {b.version}. Saving creates a new version; existing drafts keep the version they used.</p>
          </ActionForm>
        )}
        {tab === "campaigns" && (
          <ActionForm action={createCampaignAction} submit="Create campaign" className="space-y-4 card p-4">
            <div><label className="label" htmlFor="name">Campaign name <span className="text-bad">*</span></label><input id="name" name="name" required maxLength={120} className="field" /></div>
            <div><label className="label" htmlFor="objective">Objective</label><input id="objective" name="objective" maxLength={1000} className="field" /></div>
            <div><label className="label" htmlFor="brief">Brief</label><textarea id="brief" name="brief" rows={4} maxLength={4000} className="field" /></div>
          </ActionForm>
        )}
        {tab === "data" && (
          <div className="space-y-4 text-sm">
            <section className="card p-4"><h2 className="font-semibold">Generation budget</h2><p className="text-muted mt-1">A daily cap stops new expensive agent work. Editing, export and already-approved schedules keep working.</p></section>
            <section className="card p-4"><h2 className="font-semibold">Export and deletion</h2><p className="text-muted mt-1">JSON/CSV export and tracked workspace deletion are planned for M5 and not yet available in this build.</p></section>
          </div>
        )}
      </div>
    </>
  );
}
