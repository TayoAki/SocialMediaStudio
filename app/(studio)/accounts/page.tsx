import { appMode } from "@/src/config";
import { studio } from "../context";
import { listConnections } from "@/src/application/connections";
import { Tabs, PageHead, StateBadge } from "@/components/Tabs";
import { ActionForm } from "@/components/Form";
import { connectAction, toggleAccount, disconnectAction } from "../actions";
import { formatInZone } from "@/src/domain/time";

export default async function Accounts({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const tab = (await searchParams).tab ?? "accounts";
  const { actor, ws, workspace } = await studio();
  const { connections, accounts } = await listConnections(actor, ws);
  const fixture = appMode() === "fixture";
  return (
    <>
      <Tabs base="/accounts" active={tab} tabs={[{ id: "accounts", label: "Accounts", count: accounts.length }, { id: "connections", label: "Connections", count: connections.length }]} />
      <div className="p-4 md:p-6 max-w-4xl">
        <PageHead title="Accounts" sub="Publishing goes through your own Blotato account. Only allowlisted accounts can be used." />
        {tab === "accounts" && (
          <ul className="card divide-y divide-line">{accounts.map((a: any) => {
            const conn = connections.find((c: any) => c.id === a.connection_id);
            return (
              <li key={a.id} className="p-3 flex flex-wrap items-center justify-between gap-3">
                <div><p className="font-medium">{a.display_name}</p><p className="text-xs text-muted">{a.platform} · {a.capabilities.formats?.join(", ").replaceAll("_", " ")} · analytics {a.capabilities.analytics ? "available" : "unavailable"}</p></div>
                <div className="flex items-center gap-3"><StateBadge state={conn?.status ?? "unknown"} label={`connection ${conn?.status}`} />
                  <form action={toggleAccount}><input type="hidden" name="accountId" value={a.id} /><input type="hidden" name="allowed" value={String(!a.allowed)} />
                    <button className={a.allowed ? "btn btn-ghost text-sm" : "btn text-sm"} disabled={conn?.status !== "valid" && !a.allowed}>{a.allowed ? "Remove from allowlist" : "Allow for this workspace"}</button></form></div>
              </li>);
          })}{!accounts.length && <li className="p-3 text-sm text-muted">No accounts. Connect a provider key under Connections.</li>}</ul>
        )}
        {tab === "connections" && (
          <>
            <ul className="card divide-y divide-line mb-6">{connections.map((c: any) => (
              <li key={c.id} className="p-3 flex flex-wrap items-center justify-between gap-3">
                <div><p className="font-medium capitalize">{c.provider} <span className="font-mono text-xs text-muted">{c.fingerprint}</span></p><p className="text-xs text-muted">Validated {c.last_validated_at ? formatInZone(c.last_validated_at, workspace.timezone) : "never"}</p></div>
                <div className="flex items-center gap-3"><StateBadge state={c.status} />
                  {c.status === "valid" && <form action={disconnectAction}><input type="hidden" name="connectionId" value={c.id} /><button className="btn btn-ghost text-sm">Disconnect</button></form>}</div>
              </li>))}{!connections.length && <li className="p-3 text-sm text-muted">No connections yet.</li>}</ul>
            <section className="card p-4">
              <h2 className="font-semibold">Connect a provider key</h2>
              <p className="text-sm text-muted mt-1">Connect social profiles inside Blotato first, then paste a workspace API key here. Blotato API access requires a paid plan and creating a key may start billing. The key is validated server-side, stored encrypted and never shown again.</p>
              <p className="text-sm text-muted mt-1">Disconnecting stops new submissions and requests cancellation of future jobs; it does not by itself cancel schedules already held by the provider.</p>
              <ActionForm action={connectAction} submit="Validate and connect" pendingLabel="Validating…" className="grid gap-3 mt-3 max-w-md">
                <div><label className="label" htmlFor="provider">Provider</label><select id="provider" name="provider" className="field">{fixture && <option value="fixture">Fixture (no network)</option>}<option value="blotato">Blotato</option></select></div>
                <div><label className="label" htmlFor="secret">API key</label><input id="secret" name="secret" type="password" autoComplete="off" required className="field" /></div>
              </ActionForm>
            </section>
          </>
        )}
      </div>
    </>
  );
}
