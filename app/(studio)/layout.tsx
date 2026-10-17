import Link from "next/link";
import { headers } from "next/headers";
import { appMode } from "@/src/config";
import { studio } from "./context";
import { shellData } from "@/src/application/views";
import { Icon } from "@/components/icons";
import { Office, OFFICE_ROLES, STATE_LABEL } from "@/components/Office";
import { LiveRefresh } from "@/components/LiveRefresh";
import { switchWorkspace, signOut } from "./actions";
import { formatInZone } from "@/src/domain/time";

const RAIL = [
  { href: "/", icon: "home", label: "Overview" },
  { href: "/search", icon: "search", label: "Search" },
  { href: "/notifications", icon: "bell", label: "Notifications" },
  { href: "/posts", icon: "doc", label: "Posts" },
  { href: "/agents", icon: "agents", label: "Agents" },
  { href: "/calendar", icon: "calendar", label: "Calendar" },
  { href: "/analytics", icon: "chart", label: "Analytics" },
  { href: "/accounts", icon: "link", label: "Accounts" },
  { href: "/settings", icon: "gear", label: "Settings" },
];

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const { actor, ws, workspace, workspaces } = await studio();
  const data = await shellData(actor, ws);
  const path = (await headers()).get("x-pathname") ?? "";
  const roleStates = Object.fromEntries(data.tasks.map((t: any) => [t.role, t]));
  const busy = data.tasks.some((t: any) => ["running", "queued"].includes(t.state));
  const fixture = appMode() === "fixture";

  const sidebar = (
    <>
      <details className="relative group">
        <summary className="list-none cursor-pointer card bg-panel-2 min-h-11 px-3 flex items-center justify-between gap-2">
          <span className="truncate font-semibold text-sm">{workspace.name}</span><Icon name="chevron" className="size-4 group-open:rotate-90 transition-transform" />
        </summary>
        <div className="card absolute z-20 mt-1 w-full p-1 shadow-lg">
          {workspaces.map((w) => (
            <form key={w.id} action={switchWorkspace}><input type="hidden" name="id" value={w.id} />
              <button className="w-full text-left text-sm px-3 min-h-11 rounded hover:bg-panel-2" aria-current={w.id === ws}>{w.name}</button></form>
          ))}
          <Link href="/welcome" className="flex items-center gap-2 text-sm px-3 min-h-11 rounded hover:bg-panel-2"><Icon name="plus" className="size-4" />New workspace</Link>
        </div>
      </details>
      <h2 className="text-xs uppercase tracking-wide text-muted mt-5 mb-2 px-1">Campaigns</h2>
      <ul className="space-y-1">
        {data.campaigns.map((c: any) => (
          <li key={c.id}>
            <Link href={`/posts?campaign=${c.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-panel-2">
              <span className="size-8 shrink-0 rounded-full bg-panel-2 border border-line grid place-items-center text-xs font-semibold">{c.name.slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0"><span className="block text-sm truncate">{c.name}</span><span className="block text-xs text-muted">{c.posts} post{c.posts === 1 ? "" : "s"}{c.status === "archived" ? " · archived" : ""}</span></span>
            </Link>
          </li>
        ))}
        {!data.campaigns.length && <li className="text-sm text-muted px-2">No campaigns yet.</li>}
      </ul>
      <Link href="/settings?tab=campaigns" className="btn btn-ghost w-full mt-3 text-sm"><Icon name="plus" className="size-4" />New campaign</Link>
    </>
  );

  const rightbar = (
    <>
      <h2 className="text-sm font-semibold mb-1">Agent office</h2>
      <p className="text-xs text-muted mb-3">Reflects persisted task state only.</p>
      <Office states={roleStates} />
      <ul className="card mt-3 divide-y divide-line">
        {OFFICE_ROLES.map((r) => {
          const t = roleStates[r.role];
          return (
            <li key={r.role}><Link href={`/agents?role=${r.role}`} className="flex items-center gap-3 px-3 py-2 hover:bg-panel-2">
              <span className="size-3 rounded-full" style={{ background: r.color }} aria-hidden />
              <span className="text-sm flex-1">{r.label}</span><span className="text-xs text-muted">{STATE_LABEL[t?.state ?? "idle"]}</span>
            </Link></li>
          );
        })}
      </ul>
      <h2 className="text-sm font-semibold mt-6 mb-2">Recent activity</h2>
      <ul className="space-y-2">
        {data.activity.map((a: any) => (
          <li key={a.seq} className="flex gap-3 text-sm">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-line" aria-hidden />
            <span><span className="font-medium capitalize">{a.role}</span> — {a.message}<span className="block text-xs text-muted">{formatInZone(a.created_at, workspace.timezone)}</span></span>
          </li>
        ))}
        {!data.activity.length && <li className="text-sm text-muted">No agent work yet.</li>}
      </ul>
    </>
  );

  return (
    <div className="h-dvh grid grid-rows-[1fr_auto] overflow-hidden">
      <LiveRefresh active={busy} />
      <div className="grid grid-cols-[56px_1fr] md:grid-cols-[56px_240px_1fr] lg:grid-cols-[56px_240px_1fr_300px] min-h-0">
        {/* Left rail */}
        <nav aria-label="Primary" className="bg-panel border-r border-line flex flex-col items-center py-3 gap-1 overflow-y-auto">
          {RAIL.map((r) => {
            const active = r.href === "/" ? path === "/" : path.startsWith(r.href);
            return (
              <Link key={r.href} href={r.href} title={r.label} aria-label={r.label} aria-current={active ? "page" : undefined}
                className={`relative size-11 grid place-items-center rounded-lg ${active ? "bg-panel-2 text-accent" : "text-muted hover:bg-panel-2 hover:text-ink"}`}>
                <Icon name={r.icon} />
                {r.icon === "bell" && data.attention > 0 && <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-bad" aria-label={`${data.attention} need attention`} />}
              </Link>
            );
          })}
          <form action={signOut} className="mt-auto"><button title="Sign out" aria-label="Account: sign out" className="size-11 grid place-items-center rounded-full border border-line text-muted hover:text-ink"><Icon name="user" /></button></form>
        </nav>
        {/* Sidebar */}
        <aside aria-label="Workspace and campaigns" className="hidden md:block bg-panel border-r border-line p-3 overflow-y-auto">{sidebar}</aside>
        {/* Main */}
        <main className="min-w-0 overflow-y-auto">
          <details className="md:hidden border-b border-line bg-panel"><summary className="min-h-11 px-4 flex items-center gap-2 text-sm cursor-pointer"><Icon name="menu" className="size-4" />{workspace.name} · campaigns</summary><div className="p-3">{sidebar}</div></details>
          {children}
          <details className="lg:hidden border-t border-line bg-panel m-0"><summary className="min-h-11 px-4 flex items-center text-sm cursor-pointer">Agent office &amp; activity</summary><div className="p-4">{rightbar}</div></details>
        </main>
        {/* Right sidebar */}
        <aside aria-label="Agent office and activity" className="hidden lg:block bg-panel border-l border-line p-4 overflow-y-auto">{rightbar}</aside>
      </div>
      {/* Bottom bar */}
      <footer className="bg-panel border-t border-line px-4 min-h-8 flex items-center justify-between gap-4 text-xs text-muted">
        <span>{fixture ? <strong className="text-warn">FIXTURE MODE — no real publishing, research or AI calls</strong> : "Connected mode"}</span>
        <span className="flex gap-4"><span>{workspace.timezone}</span>{data.attention > 0 && <Link href="/notifications" className="text-bad">{data.attention} need attention</Link>}<span>{busy ? "Agents working" : "Idle"}</span></span>
      </footer>
    </div>
  );
}
