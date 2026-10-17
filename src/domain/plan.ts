import { z } from "zod";

export const ROLES = ["coordinator", "researcher", "creator", "scheduler", "analytics"] as const;
export const TOOLS_BY_ROLE: Record<(typeof ROLES)[number], string[]> = {
  coordinator: ["read_state", "plan"],
  researcher: ["search", "retrieve", "save_research"],
  creator: ["save_draft", "generate_image", "render_template"],
  scheduler: ["propose_times"],
  analytics: ["read_metrics"],
};

export const LIMITS = { maxTasks: 12, maxPosts: 25, maxSources: 20, maxToolCalls: 20 };

export const PlanTask = z.object({
  key: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  role: z.enum(ROLES),
  dependsOn: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  inputs: z.record(z.unknown()).default({}),
  estimatedCostMicros: z.number().int().nonnegative().default(0),
});

export const Plan = z.object({
  intent: z.enum(["create_posts", "revise_draft", "analyze", "clarify"]),
  summary: z.string().max(500),
  questions: z.array(z.string()).default([]),
  posts: z.array(z.object({
    platform: z.enum(["instagram", "linkedin"]),
    concept: z.string().max(300),
    localTime: z.string().optional(),
  })).max(LIMITS.maxPosts).default([]),
  tasks: z.array(PlanTask).max(LIMITS.maxTasks),
  accountIds: z.array(z.string().uuid()).default([]),
});
export type Plan = z.infer<typeof Plan>;

/** Server-side plan validation (FR06, AT04): cycles, unknown tools, foreign accounts, fan-out. */
export function validatePlan(raw: unknown, ownedAccountIds: Set<string>): { ok: true; plan: Plan } | { ok: false; errors: string[] } {
  const parsed = Plan.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const plan = parsed.data;
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const t of plan.tasks) {
    if (keys.has(t.key)) errors.push(`duplicate task ${t.key}`);
    keys.add(t.key);
    for (const tool of t.tools) if (!TOOLS_BY_ROLE[t.role].includes(tool)) errors.push(`tool ${tool} not allowed for ${t.role}`);
  }
  for (const t of plan.tasks) for (const d of t.dependsOn) if (!keys.has(d)) errors.push(`${t.key} depends on unknown ${d}`);
  for (const a of plan.accountIds) if (!ownedAccountIds.has(a)) errors.push(`account ${a} is not in this workspace`);

  // Cycle detection (DFS).
  const graph = new Map(plan.tasks.map((t) => [t.key, t.dependsOn]));
  const state = new Map<string, 1 | 2>();
  const visit = (k: string): boolean => {
    if (state.get(k) === 1) return true;
    if (state.get(k) === 2) return false;
    state.set(k, 1);
    for (const d of graph.get(k) ?? []) if (visit(d)) return true;
    state.set(k, 2);
    return false;
  };
  for (const k of graph.keys()) if (visit(k)) { errors.push("plan contains a dependency cycle"); break; }
  return errors.length ? { ok: false, errors } : { ok: true, plan };
}
