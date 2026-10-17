import { withScope, type Actor } from "@/src/data/db";

/** Read models for the shell and overview. Every query runs under the verified workspace scope. */
export async function shellData(actor: Actor, ws: string) {
  return withScope(actor, ws, async (tx) => {
    const campaigns = (await tx.query(
      `select c.id, c.name, c.status, (select count(*) from posts p where p.campaign_id = c.id)::int as posts
       from campaigns c where c.workspace_id = $1 order by c.created_at desc`, [ws])).rows;
    const tasks = (await tx.query(
      `select distinct on (role) role, state, summary, updated_at from tasks where workspace_id = $1 order by role, updated_at desc`, [ws])).rows;
    const activity = (await tx.query(
      `select e.seq, t.role, e.state, e.message, e.created_at from task_events e join tasks t on t.id = e.task_id
       where e.workspace_id = $1 order by e.seq desc limit 8`, [ws])).rows;
    const w = (await tx.query("select id, name, timezone from workspaces where id = $1", [ws])).rows[0];
    const attention = (await tx.query(
      `select count(*)::int as n from deliveries where workspace_id = $1 and state in ('needs_reconciliation','needs_connection','needs_rescheduling','failed')`, [ws])).rows[0].n;
    return { campaigns, tasks, activity, workspace: w, attention };
  });
}

export async function overview(actor: Actor, ws: string) {
  return withScope(actor, ws, async (tx) => ({
    awaitingReview: (await tx.query("select count(*)::int as n from post_variants where workspace_id = $1 and editorial_state in ('draft','in_review')", [ws])).rows[0].n,
    next: (await tx.query(
      `select d.id, d.scheduled_utc, d.state, v.platform, p.concept from deliveries d join post_variants v on v.id = d.variant_id join posts p on p.id = v.post_id
       where d.workspace_id = $1 and d.state in ('scheduled','schedule_pending','change_pending','processing') order by d.scheduled_utc limit 5`, [ws])).rows,
    problems: (await tx.query(
      `select d.id, d.state, v.platform, p.concept from deliveries d join post_variants v on v.id = d.variant_id join posts p on p.id = v.post_id
       where d.workspace_id = $1 and d.state in ('needs_reconciliation','needs_connection','needs_rescheduling','failed') order by d.created_at desc limit 5`, [ws])).rows,
    checklist: {
      brand: (await tx.query("select max(version) > 1 as ok from brand_profiles where workspace_id = $1", [ws])).rows[0].ok,
      campaign: (await tx.query("select count(*) > 0 as ok from campaigns where workspace_id = $1", [ws])).rows[0].ok,
      connection: (await tx.query("select count(*) > 0 as ok from social_accounts where workspace_id = $1 and allowed", [ws])).rows[0].ok,
      draft: (await tx.query("select count(*) > 0 as ok from posts where workspace_id = $1", [ws])).rows[0].ok,
    },
  }));
}

export async function search(actor: Actor, ws: string, q: string) {
  return withScope(actor, ws, async (tx) => (await tx.query(
    `select v.id as variant_id, v.platform, v.editorial_state, p.concept, r.caption, c.name as campaign
     from post_variants v join posts p on p.id = v.post_id join campaigns c on c.id = p.campaign_id
     join variant_revisions r on r.variant_id = v.id and r.revision = v.current_revision
     where v.workspace_id = $1 and (r.caption ilike $2 or p.concept ilike $2 or c.name ilike $2) limit 50`,
    [ws, `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`])).rows);
}

export async function deliveryStats(actor: Actor, ws: string) {
  return withScope(actor, ws, async (tx) => (await tx.query(
    `select v.platform, d.state, count(*)::int as n from deliveries d join post_variants v on v.id = d.variant_id where d.workspace_id = $1 group by 1,2 order by 1,2`, [ws])).rows);
}
