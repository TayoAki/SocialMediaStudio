import { z } from "zod";
import { AppError } from "@/src/domain/errors";
import { audit, one, withScope, type Actor } from "@/src/data/db";
import { randomUUID } from "node:crypto";

export const PostMessage = z.object({
  campaignId: z.string().uuid(),
  clientMessageId: z.string().min(8).max(80),
  text: z.string().trim().min(1).max(4000),
});

/**
 * Store the user's message and enqueue a coordinator task (AT03). The same
 * clientMessageId returns the existing plan instead of creating another.
 */
export async function postMessage(actor: Actor, ws: string, input: unknown) {
  const p = PostMessage.parse(input);
  return withScope(actor, ws, async (tx) => {
    const camp = await one(tx, "select status from campaigns where id = $1 and workspace_id = $2", [p.campaignId, ws]);
    if (camp.status !== "active") throw new AppError("FORBIDDEN", "Campaign is archived");
    const ins = await tx.query(
      "insert into conversation_messages (workspace_id, campaign_id, client_message_id, role, body) values ($1,$2,$3,'user',$4) on conflict do nothing returning id",
      [ws, p.campaignId, p.clientMessageId, p.text]);
    if (!ins.rowCount) {
      const t = await one(tx, "select plan_id, id from tasks where workspace_id = $1 and inputs->>'clientMessageId' = $2 and role = 'coordinator'", [ws, p.clientMessageId]);
      return { planId: t.plan_id as string, taskId: t.id as string, duplicate: true };
    }
    const planId = randomUUID();
    const t = await one(tx,
      "insert into tasks (workspace_id, campaign_id, plan_id, plan_key, role, inputs) values ($1,$2,$3,'coordinate','coordinator',$4) returning id",
      [ws, p.campaignId, planId, { clientMessageId: p.clientMessageId, text: p.text }]);
    await tx.query("insert into task_events (workspace_id, task_id, state, message) values ($1,$2,'queued','Request received')", [ws, t.id]);
    await tx.query("insert into outbox_events (workspace_id, kind, aggregate_id, aggregate_version) values ($1,'plan.run',$2,1)", [ws, t.id]);
    await audit(tx, ws, actor, "message.posted", t.id);
    return { planId, taskId: t.id as string, duplicate: false };
  });
}

export async function cancelPlan(actor: Actor, ws: string, planId: string) {
  return withScope(actor, ws, async (tx) => {
    const r = await tx.query(
      "update tasks set state = 'cancelled', updated_at = now() where plan_id = $1 and workspace_id = $2 and state in ('queued','awaiting_input','awaiting_approval') returning id", [planId, ws]);
    const running = await tx.query("select id from tasks where plan_id = $1 and state = 'running'", [planId]);
    // Running tasks are flagged; their results are discarded at commit time (AT32).
    await tx.query("update tasks set inputs = inputs || '{\"cancelRequested\": true}' where plan_id = $1 and state = 'running'", [planId]);
    for (const t of r.rows) await tx.query("insert into task_events (workspace_id, task_id, state, message) values ($1,$2,'cancelled','Stopped by owner')", [ws, t.id]);
    return { cancelled: r.rowCount, stillRunning: running.rowCount };
  });
}

export async function conversation(actor: Actor, ws: string, campaignId: string) {
  return withScope(actor, ws, async (tx) => ({
    messages: (await tx.query("select role, body, created_at from conversation_messages where workspace_id = $1 and campaign_id = $2 order by created_at", [ws, campaignId])).rows,
    tasks: (await tx.query("select id, plan_id, plan_key, role, state, summary, error_code, updated_at from tasks where workspace_id = $1 and campaign_id = $2 order by created_at", [ws, campaignId])).rows,
  }));
}

export async function taskEvents(actor: Actor, ws: string, after: number) {
  return withScope(actor, ws, async (tx) => (await tx.query(
    "select e.seq, e.task_id, t.role, e.state, e.message, e.created_at from task_events e join tasks t on t.id = e.task_id where e.workspace_id = $1 and e.seq > $2 order by e.seq limit 200", [ws, after])).rows);
}
