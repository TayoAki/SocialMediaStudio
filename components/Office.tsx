import Link from "next/link";

type Role = "coordinator" | "researcher" | "creator" | "scheduler" | "analytics";
const DESKS: { role: Role; x: number; y: number; color: string; label: string }[] = [
  { role: "coordinator", x: 0.5, y: 0.3, color: "#8a4b2a", label: "Coordinator" },
  { role: "researcher", x: 0.2, y: 0.55, color: "#2d5f8b", label: "Researcher" },
  { role: "creator", x: 0.8, y: 0.55, color: "#7a3f86", label: "Creator" },
  { role: "scheduler", x: 0.3, y: 0.85, color: "#2f7a4a", label: "Scheduler" },
  { role: "analytics", x: 0.7, y: 0.85, color: "#9a6a00", label: "Analytics" },
];
const BADGE: Record<string, string> = {
  running: "Working", queued: "Queued", awaiting_input: "Waiting for you", awaiting_approval: "Awaiting approval",
  succeeded: "Completed", failed: "Failed", cancelled: "Cancelled", idle: "Idle",
};

/**
 * Original office art. Positions are normalised (0–1) so they stay stable as the panel
 * scales. A character animates only while its role has a persisted running task.
 */
export function Office({ states, selected }: { states: Record<string, { state: string; updated_at?: string; summary?: string }>; selected?: string }) {
  const W = 300, H = 220;
  return (
    <figure aria-label="Agent office" className="card overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-label="Five agent desks; status listed below">
        <rect width={W} height={H} fill="var(--panel-2)" />
        <rect y={H * 0.12} width={W} height={2} fill="var(--line)" />
        <rect x={W * 0.42} y={4} width={W * 0.16} height={H * 0.1} rx={3} fill="var(--line)" />
        {DESKS.map((d) => {
          const st = states[d.role]?.state ?? "idle";
          const cx = d.x * W, cy = d.y * H;
          return (
            <g key={d.role} className={st === "running" ? "agent-working" : ""}>
              <Link href={`/agents?role=${d.role}`} aria-label={`${d.label}: ${BADGE[st] ?? st}`}>
                {selected === d.role && <ellipse cx={cx} cy={cy + 6} rx={36} ry={22} fill="none" stroke="var(--accent)" strokeWidth={2} />}
                <g className="agent-body">
                  <circle cx={cx} cy={cy - 18} r={7} fill="#e9c9a8" />
                  <rect x={cx - 8} y={cy - 11} width={16} height={14} rx={4} fill={d.color} />
                  <rect className="agent-arm" x={cx + 6} y={cy - 8} width={3} height={9} rx={1.5} fill={d.color} />
                </g>
                <rect x={cx - 24} y={cy + 2} width={48} height={10} rx={2} fill="#b98a62" />
                <rect x={cx - 9} y={cy - 6} width={18} height={9} rx={1} fill={st === "running" ? "#9fd3ff" : "#5d6a75"} />
                <circle cx={cx + 20} cy={cy - 20} r={4} fill={st === "running" ? "var(--ok)" : st === "failed" ? "var(--bad)" : st.startsWith("awaiting") ? "var(--warn)" : "var(--muted)"} />
              </Link>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">Agent status list follows.</figcaption>
    </figure>
  );
}

export const OFFICE_ROLES = DESKS;
export const STATE_LABEL = BADGE;
