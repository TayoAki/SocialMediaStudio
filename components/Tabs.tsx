import Link from "next/link";

/** Tab strip at the top of the main content (wireframe "tabs"). Server-rendered links keep it keyboard and no-JS friendly. */
export function Tabs({ base, tabs, active }: { base: string; tabs: { id: string; label: string; count?: number }[]; active: string }) {
  return (
    <nav aria-label="Views" className="grid border-b border-line bg-panel" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0,1fr))` }}>
      {tabs.map((t) => (
        <Link key={t.id} href={`${base}${base.includes("?") ? "&" : "?"}tab=${t.id}`} aria-current={t.id === active ? "page" : undefined}
          className={`min-h-11 flex items-center justify-center gap-2 text-sm border-r border-line last:border-r-0 ${t.id === active ? "bg-panel-2 font-semibold" : "text-muted hover:bg-panel-2"}`}>
          {t.label}{t.count !== undefined && <span className="rounded-full bg-line px-2 text-xs">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div><h1 className="text-xl font-semibold">{title}</h1>{sub && <p className="text-sm text-muted mt-1">{sub}</p>}</div>
      {children}
    </div>
  );
}

export function StateBadge({ state, label }: { state: string; label?: string }) {
  const tone = /published|scheduled|succeeded|valid/.test(state) ? "text-ok" : /fail|bad|invalid|revoked/.test(state) ? "text-bad"
    : /needs|unknown|awaiting|pending|cancelling|change/.test(state) ? "text-warn" : "text-muted";
  return <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${tone}`}><span className="size-2 rounded-full bg-current" aria-hidden />{label ?? state.replaceAll("_", " ")}</span>;
}
