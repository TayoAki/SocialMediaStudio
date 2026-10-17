import { validatePlan, type Plan } from "@/src/domain/plan";
import { canTaskTransition, type TaskState } from "@/src/domain/task";
import { AppError } from "@/src/domain/errors";
import { one, withScope, type Tx } from "@/src/data/db";
import { reserve, settle } from "@/src/application/budget";
import { createPostTx, updateVariantTx } from "@/src/application/posts";
import { registerAssetTx } from "@/src/application/assets";
import { fixturePng } from "@/src/providers/media/fixtureImage";
import { agents } from "./index";
import type { ResearchResult } from "./types";

const WORKER = { kind: "worker" } as const;

async function transition(tx: Tx, ws: string, taskId: string, to: TaskState, message: string, extra: { summary?: string; error?: string; output?: object } = {}) {
  const t = await one(tx, "select state from tasks where id = $1 for update", [taskId]);
  if (t.state === to) return true;
  if (!canTaskTransition(t.state, to)) return false;
  await tx.query(
    "update tasks set state = $2, summary = coalesce($3, summary), error_code = $4, output = coalesce($5, output), attempts = attempts + case when $2 = 'running' then 1 else 0 end, updated_at = now() where id = $1",
    [taskId, to, extra.summary ?? null, extra.error ?? null, extra.output ?? null]);
  await tx.query("insert into task_events (workspace_id, task_id, state, message) values ($1,$2,$3,$4)", [ws, taskId, to, message]);
  return true;
}

/** True if the task may still commit results (not cancelled, workspace active). */
async function stillWanted(tx: Tx, ws: string, taskId: string) {
  const t = await one(tx, "select t.state, t.inputs, w.status from tasks t join workspaces w on w.id = t.workspace_id where t.id = $1 for update of t", [taskId]);
  return t.state === "running" && !t.inputs.cancelRequested && t.status === "active";
}

/**
 * Durable plan execution. Each stage commits its own state; a restart re-enters
 * here and skips tasks that already succeeded (AT06/AT22).
 */
export async function runPlan(ws: string, coordinatorTaskId: string) {
  const { coordinator, researcher, creator } = agents();
  const ctx = await withScope(WORKER, ws, async (tx) => {
    const task = await one(tx, "select * from tasks where id = $1", [coordinatorTaskId]);
    const w = await one(tx, "select timezone from workspaces where id = $1", [ws]);
    const brand = await one(tx, "select * from brand_profiles where workspace_id = $1 order by version desc limit 1", [ws]);
    const drafts = (await tx.query(
      `select v.id as "variantId", v.platform, p.concept, v.version from post_variants v join posts p on p.id = v.post_id
       where p.campaign_id = $1 and v.editorial_state <> 'published' order by p.created_at, v.platform`, [task.campaign_id])).rows;
    const accounts = new Set<string>((await tx.query("select id from social_accounts where workspace_id = $1 and allowed", [ws])).rows.map((r) => r.id));
    return { task, timezone: w.timezone as string, brand, drafts, accounts };
  });
  const { task } = ctx;

  let plan: Plan | null = task.output?.plan ?? null;
  if (task.state === "queued") {
    await withScope(WORKER, ws, (tx) => transition(tx, ws, task.id, "running", "Coordinator planning"));
    const raw = await coordinator.plan({ text: task.inputs.text, timezone: ctx.timezone, now: new Date(), brand: ctx.brand, existingDrafts: ctx.drafts });
    const v = validatePlan(raw, ctx.accounts);
    if (!v.ok) {
      await withScope(WORKER, ws, (tx) => transition(tx, ws, task.id, "failed", `Plan rejected: ${v.errors.join("; ")}`, { error: "INVALID_PLAN" }));
      return;
    }
    plan = v.plan;
    await withScope(WORKER, ws, async (tx) => {
      if (plan!.intent === "clarify") {
        await tx.query("insert into conversation_messages (workspace_id, campaign_id, client_message_id, role, body) values ($1,$2,$3,'coordinator',$4) on conflict do nothing",
          [ws, task.campaign_id, task.inputs.clientMessageId, plan!.questions.join(" ")]);
        await transition(tx, ws, task.id, "awaiting_input", plan!.questions[0] ?? "Need input", { summary: plan!.summary, output: { plan } });
        return;
      }
      for (const t of plan!.tasks) {
        await tx.query(
          "insert into tasks (workspace_id, campaign_id, plan_id, plan_key, role, depends_on, inputs) values ($1,$2,$3,$4,$5,$6,$7) on conflict (plan_id, plan_key) do nothing",
          [ws, task.campaign_id, task.plan_id, t.key, t.role, t.dependsOn, t.inputs]);
      }
      await tx.query("insert into conversation_messages (workspace_id, campaign_id, client_message_id, role, body) values ($1,$2,$3,'coordinator',$4) on conflict do nothing",
        [ws, task.campaign_id, task.inputs.clientMessageId, `Plan: ${plan!.summary}. ${plan!.posts.map((p) => `${p.platform} at ${p.localTime} (${ctx.timezone})`).join("; ")}`]);
      await transition(tx, ws, task.id, "succeeded", plan!.summary, { summary: plan!.summary, output: { plan } });
    });
  }
  if (!plan || plan.intent === "clarify") return;

  const children = await withScope(WORKER, ws, async (tx) =>
    (await tx.query("select * from tasks where plan_id = $1 and role <> 'coordinator' order by created_at", [task.plan_id])).rows);
  const done = new Map<string, any>();
  for (const c of children) if (c.state === "succeeded") done.set(c.plan_key, c.output);

  // Run in dependency order: repeat passes until no queued task becomes runnable.
  for (let progressed = true; progressed;) {
  progressed = false;
  for (const child of children) {
    if (child.state !== "queued") continue;
    if (child.depends_on.some((d: string) => !done.has(d))) continue;
    child.state = "running";
    progressed = true;
    try {
      await withScope(WORKER, ws, async (tx) => {
        await reserve(tx, ws, `task:${child.id}`, plan!.tasks.find((t) => t.key === child.plan_key)?.estimatedCostMicros ?? 0, child.role);
        await transition(tx, ws, child.id, "running", `${child.role} started`);
      });
    } catch (e) {
      const code = e instanceof AppError ? e.code : "ERROR";
      await withScope(WORKER, ws, (tx) => transition(tx, ws, child.id, "cancelled", code === "BUDGET_EXCEEDED" ? "Budget cap reached" : "Could not start", { error: code }));
      continue;
    }

    try {
      if (child.role === "researcher") {
        const r = await researcher.research(child.inputs.topic, ctx.brand.audience);
        await withScope(WORKER, ws, async (tx) => {
          if (!(await stillWanted(tx, ws, child.id))) return;
          const ids: string[] = [];
          for (const s of r.sources.slice(0, 20)) {
            const row = await one(tx, "insert into research_sources (workspace_id, task_id, canonical_url, title, retrieved_at, published_at, excerpt, supported_claims) values ($1,$2,$3,$4,now(),$5,$6,$7) returning id",
              [ws, child.id, s.url, s.title, s.publishedAt ?? null, s.excerpt, s.claims]);
            ids.push(row.id);
          }
          await settle(tx, `task:${child.id}`, 0);
          await transition(tx, ws, child.id, "succeeded", `${ids.length} source(s) saved${researcher.fixture ? " (fixture)" : ""}`, { output: { sourceIds: ids, uncertainty: r.uncertainty } });
          done.set(child.plan_key, { sourceIds: ids });
        });
      } else if (child.role === "creator") {
        const research = done.get("research") as { sourceIds: string[] } | undefined;
        const researchResult: ResearchResult | null = null;
        if (child.plan_key === "revise") {
          const out = await creator.draft({ concept: child.inputs.concept, platform: child.inputs.platform, brand: ctx.brand, research: researchResult });
          await withScope(WORKER, ws, async (tx) => {
            if (!(await stillWanted(tx, ws, child.id))) return;
            try {
              await updateVariantTx(tx, WORKER, ws, child.inputs.variantId, { expectedVersion: child.inputs.expectedVersion, caption: out.caption, aiGenerated: true });
              await transition(tx, ws, child.id, "succeeded", "Draft revised");
            } catch (e) {
              if (!(e instanceof AppError && e.code === "VERSION_CONFLICT")) throw e;
              // Stale output (AT07): kept as obsolete history, never overwrites the newer draft.
              await transition(tx, ws, child.id, "failed", "Draft changed while revising; result kept as obsolete", { error: "STALE_OUTPUT", output: { obsolete: out } });
            }
          });
        } else {
          const drafts = await Promise.all(plan.posts.map((p) => creator.draft({ concept: p.concept, platform: p.platform, brand: ctx.brand, research: researchResult })));
          await withScope(WORKER, ws, async (tx) => {
            if (!(await stillWanted(tx, ws, child.id))) return;
            const created: string[] = [];
            for (const [i, p] of plan!.posts.entries()) {
              const img = p.platform === "instagram"
                ? await registerAssetTx(tx, WORKER, ws, fixturePng(`${child.id}:${i}`), { origin: "generated", provider: "fixture", params: { brief: drafts[i].imageBrief }, rightsAttested: true })
                : null;
              const r = await createPostTx(tx, WORKER, ws, {
                campaignId: task.campaign_id, concept: p.concept, proposedLocalTime: p.localTime,
                variants: [{ platform: p.platform, caption: drafts[i].caption, altText: drafts[i].altText, assetId: img?.assetId ?? null, sourceIds: research?.sourceIds ?? [], aiGenerated: true }],
              });
              created.push(...r.variantIds);
            }
            await settle(tx, `task:${child.id}`, 0);
            await transition(tx, ws, child.id, "succeeded", `${created.length} draft(s) ready for review`, { output: { variantIds: created, proposedTimes: plan!.posts.map((p) => p.localTime) } });
          });
        }
      }
    } catch (e) {
      await withScope(WORKER, ws, (tx) => transition(tx, ws, child.id, "failed", "Task failed; you can retry", { error: e instanceof AppError ? e.code : "ERROR" }));
    }
  }
  }
}
