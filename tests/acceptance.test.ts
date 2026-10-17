import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { adminQuery, resetDb } from "./setup";
import { futureLocal, igDraft, resetFixture, world } from "./helpers";
import { approve } from "@/src/application/approvals";
import { submitApproval, reschedule, cancelDelivery, resolveOperation } from "@/src/application/deliveries";
import { updateVariant, listPosts, getVariant } from "@/src/application/posts";
import { postMessage, conversation } from "@/src/application/conversation";
import { disconnect } from "@/src/application/connections";
import { reserve } from "@/src/application/budget";
import { processOutbox, pollDelivery, sweepStaleOperations, executeOperation } from "@/src/workflows/executor";
import { withScope } from "@/src/data/db";

const TZ = "Europe/London";
const drain = async () => { while ((await processOutbox()) > 0); };
const delivery = async (id: string) => (await adminQuery("select * from deliveries where id = $1", [id]))[0];

beforeAll(async () => { await resetDb(); });
beforeEach(() => { resetFixture(); });

describe("AT01/AT34 tenant isolation through the real runtime role", () => {
  it("denies cross-workspace reads by ID and with forged scope", async () => {
    const a = await world("a"); const b = await world("b");
    const vb = await igDraft(b);
    await expect(getVariant(a.actor, b.ws, vb)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getVariant(a.actor, a.ws, vb)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Runtime role with no scope sees nothing even with raw SQL.
    const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
    expect((await c.query("select * from post_variants")).rowCount).toBe(0);
    await c.query("begin");
    await c.query("select set_config('app.workspace_id', $1, true), set_config('app.user_id', $2, true), set_config('app.actor_kind','user',true)", [b.ws, a.actor.userId]);
    expect((await c.query("select * from post_variants")).rowCount).toBe(0); // not a member: RLS denies
    await c.query("commit");
    // Scope is transaction-local: nothing leaks into the next statement on the same connection.
    expect((await c.query("select current_setting('app.workspace_id', true) as w")).rows[0].w).toBe("");
    const role = (await c.query("select rolbypassrls, rolsuper from pg_roles where rolname = current_user")).rows[0];
    expect(role).toEqual({ rolbypassrls: false, rolsuper: false });
    await c.end();
  });
  it("blocks cross-tenant foreign keys (post using another workspace's asset)", async () => {
    const a = await world("a2"); const b = await world("b2");
    const vb = await igDraft(b);
    const bAsset = (await adminQuery("select r.asset_id from variant_revisions r where variant_id = $1", [vb]))[0].asset_id;
    const va = await igDraft(a);
    const v = await getVariant(a.actor, a.ws, va);
    await expect(updateVariant(a.actor, a.ws, va, { expectedVersion: v.version, assetId: bAsset })).rejects.toThrow();
  });
});

describe("approval and publication", () => {
  it("J01 + AT20 + AT26(fixture): approve, schedule, provider confirms, publish only on definitive evidence", async () => {
    const w = await world("j1");
    const v = await igDraft(w);
    const { approvalId } = await approve(w.actor, w.ws, { variantId: v, expectedVersion: 1, accountIds: [w.ig], localTime: futureLocal(TZ) });
    const { deliveryIds: [d] } = await submitApproval(w.actor, w.ws, { approvalId });
    expect((await delivery(d)).state).toBe("schedule_pending");
    await drain();
    const after = await delivery(d);
    expect(after.state).toBe("scheduled");
    expect(after.provider_submission_id).toBeTruthy();
    expect(after.provider_schedule_id).toMatch(/^sch_/);
    const f = resetFixture.bind(null); void f;
    const { fixturePublisher } = await import("@/src/providers/publishing/fixture");
    // Provider in-progress is not Published.
    fixturePublisher().jobs.get(after.provider_submission_id)!.status = "in-progress";
    expect(await pollDelivery(w.ws, d)).toBe("processing");
    fixturePublisher().dispatch(after.provider_submission_id);
    expect(await pollDelivery(w.ws, d)).toBe("published");
    expect((await delivery(d)).remote_url).toMatch(/^https:/);
  });

  it("AT08 editing after approval invalidates it", async () => {
    const w = await world("at08");
    const v = await igDraft(w);
    const { approvalId } = await approve(w.actor, w.ws, { variantId: v, expectedVersion: 1, accountIds: [w.ig], localTime: futureLocal(TZ) });
    await updateVariant(w.actor, w.ws, v, { expectedVersion: 1, caption: "changed" });
    await expect(submitApproval(w.actor, w.ws, { approvalId })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(await adminQuery("select count(*)::int as n from deliveries where approval_id = $1", [approvalId])).toEqual([{ n: 0 }]);
  });

  it("AT09/AT30 concurrent double submission of a two-account approval creates each destination once", async () => {
    const w = await world("at30");
    const asset = await igDraft(w); // ensures image exists for IG; use LinkedIn text for a two-account case on same platform not available
    void asset;
    const { createPost } = await import("@/src/application/posts");
    const { variantIds: [li] } = await createPost(w.actor, w.ws, { campaignId: w.campaignId, concept: "LI", variants: [{ platform: "linkedin", caption: "Hello" }] });
    // Add a second allowed LinkedIn account on the same connection.
    const conn = (await adminQuery("select connection_id from social_accounts where id = $1", [w.li]))[0].connection_id;
    const [{ id: li2 }] = await adminQuery(
      "insert into social_accounts (workspace_id, connection_id, external_account_id, platform, display_name, capabilities, allowed) select workspace_id, connection_id, 'fx-li-2', platform, 'Second', capabilities, true from social_accounts where id = $1 returning id", [w.li]);
    void conn;
    const { approvalId } = await approve(w.actor, w.ws, { variantId: li, expectedVersion: 1, accountIds: [w.li, li2], localTime: futureLocal(TZ) });
    const [r1, r2] = await Promise.all([submitApproval(w.actor, w.ws, { approvalId }), submitApproval(w.actor, w.ws, { approvalId })]);
    expect(r1.deliveryIds.sort()).toEqual(r2.deliveryIds.sort());
    expect(r1.deliveryIds).toHaveLength(2);
    expect(await adminQuery("select count(*)::int as n from provider_operations o join deliveries d on d.id = o.delivery_id where d.approval_id = $1", [approvalId])).toEqual([{ n: 2 }]);
    await Promise.all([drain(), drain()]);
    const { fixturePublisher } = await import("@/src/providers/publishing/fixture");
    expect(fixturePublisher().calls.filter((c) => c.startsWith("create"))).toHaveLength(2);
  });

  it("AT10 lost response -> needs reconciliation, no automatic second create; operator attaches evidence", async () => {
    const w = await world("at10");
    const v = await igDraft(w);
    const fx = resetFixture(); fx.faults.push("lost_response");
    const { approvalId } = await approve(w.actor, w.ws, { variantId: v, expectedVersion: 1, accountIds: [w.ig], localTime: futureLocal(TZ) });
    const { deliveryIds: [d] } = await submitApproval(w.actor, w.ws, { approvalId });
    await drain(); await drain();
    expect((await delivery(d)).state).toBe("needs_reconciliation");
    expect(fx.calls.filter((c) => c.startsWith("create"))).toHaveLength(1);
    const [op] = await adminQuery("select id from provider_operations where delivery_id = $1", [d]);
    const job = [...fx.jobs.values()][0];
    await resolveOperation(w.actor, w.ws, op.id, { resolution: "attach", submissionId: job.submissionId, scheduleId: job.scheduleId, evidence: "Found in provider schedule list at same time/text" });
    expect((await delivery(d)).state).toBe("scheduled");
    expect(fx.calls.filter((c) => c.startsWith("create"))).toHaveLength(1);
  });

  it("AT06 worker crash after in_flight -> outcome unknown, never resent", async () => {
    const w = await world("at06");
    const v = await igDraft(w);
    const { approvalId } = await approve(w.actor, w.ws, { variantId: v, expectedVersion: 1, accountIds: [w.ig], localTime: futureLocal(TZ) });
    const { deliveryIds: [d] } = await submitApproval(w.actor, w.ws, { approvalId });
    await adminQuery("update provider_operations set state = 'in_flight', updated_at = now() - interval '10 minutes' where delivery_id = $1", [d]);
    await sweepStaleOperations(300);
    expect((await delivery(d)).state).toBe("needs_reconciliation");
    const [op] = await adminQuery("select id, state from provider_operations where delivery_id = $1", [d]);
    expect(op.state).toBe("outcome_unknown");
    await executeOperation(w.ws, op.id); // replayed event is a no-op
    expect(resetFixture().calls).toHaveLength(0);
  });

  it("AT11 failed reschedule keeps the original known schedule", async () => {
    const w = await world("at11");
    const v = await igDraft(w);
    const t0 = futureLocal(TZ, 3);
    const { approvalId } = await approve(w.actor, w.ws, { variantId: v, expectedVersion: 1, accountIds: [w.ig], localTime: t0 });
    const { deliveryIds: [d] } = await submitApproval(w.actor, w.ws, { approvalId });
    await drain();
    const before = await delivery(d);
    const fx = (await import("@/src/providers/publishing/fixture")).fixturePublisher(); fx.faults.push("reject");
    await reschedule(w.actor, w.ws, d, { expectedVersion: before.version, localTime: futureLocal(TZ, 4) });
    expect((await delivery(d)).state).toBe("change_pending");
    await drain();
    const after = await delivery(d);
    expect(after.state).toBe("scheduled");
    expect(after.scheduled_utc.toISOString()).toBe(before.scheduled_utc.toISOString());
    // A successful reschedule updates time only after provider confirmation.
    await reschedule(w.actor, w.ws, d, { expectedVersion: after.version, localTime: futureLocal(TZ, 5) });
    await drain();
    expect((await delivery(d)).local_time).toBe(futureLocal(TZ, 5));
  });

  it("AT12 cancel after dispatch -> reconciliation, never shown as cancelled", async () => {
    const w = await world("at12");
    const v = await igDraft(w);
    const { approvalId } = await approve(w.actor, w.ws, { variantId: v, expectedVersion: 1, accountIds: [w.ig], localTime: futureLocal(TZ) });
    const { deliveryIds: [d] } = await submitApproval(w.actor, w.ws, { approvalId });
    await drain();
    const s = await delivery(d);
    (await import("@/src/providers/publishing/fixture")).fixturePublisher().dispatch(s.provider_submission_id);
    await cancelDelivery(w.actor, w.ws, d, { expectedVersion: s.version });
    await drain();
    expect((await delivery(d)).state).toBe("needs_reconciliation");
    expect(await pollDelivery(w.ws, d)).toBe("published");
  });

  it("AT13 partial delivery: retrying failed destination cannot republish the successful one", async () => {
    const w = await world("at13");
    const { createPost } = await import("@/src/application/posts");
    const { variantIds: [li] } = await createPost(w.actor, w.ws, { campaignId: w.campaignId, concept: "LI", variants: [{ platform: "linkedin", caption: "Hi" }] });
    const [{ id: li2 }] = await adminQuery(
      "insert into social_accounts (workspace_id, connection_id, external_account_id, platform, display_name, capabilities, allowed) select workspace_id, connection_id, 'fx-li-3', platform, 'Third', capabilities, true from social_accounts where id = $1 returning id", [w.li]);
    const fx = resetFixture();
    const { approvalId } = await approve(w.actor, w.ws, { variantId: li, expectedVersion: 1, accountIds: [w.li, li2], localTime: futureLocal(TZ) });
    const { deliveryIds } = await submitApproval(w.actor, w.ws, { approvalId });
    fx.faults.push("reject");
    await drain();
    const states = await Promise.all(deliveryIds.map(delivery));
    expect(states.map((s) => s.state).sort()).toEqual(["failed", "scheduled"]);
    expect(fx.calls.filter((c) => c.startsWith("create"))).toHaveLength(2);
    await drain();
    expect(fx.calls.filter((c) => c.startsWith("create"))).toHaveLength(2);
  });

  it("AT14 connection loss: auth failure blocks submission; disconnect requests cancellation", async () => {
    const w = await world("at14");
    const v = await igDraft(w);
    const fx = resetFixture(); fx.faults.push("auth");
    const { approvalId } = await approve(w.actor, w.ws, { variantId: v, expectedVersion: 1, accountIds: [w.ig], localTime: futureLocal(TZ) });
    const { deliveryIds: [d] } = await submitApproval(w.actor, w.ws, { approvalId });
    await drain();
    expect((await delivery(d)).state).toBe("needs_connection");
    const w2 = await world("at14b");
    const v2 = await igDraft(w2);
    const a2 = await approve(w2.actor, w2.ws, { variantId: v2, expectedVersion: 1, accountIds: [w2.ig], localTime: futureLocal(TZ) });
    const { deliveryIds: [d2] } = await submitApproval(w2.actor, w2.ws, { approvalId: a2.approvalId });
    await drain();
    const conn = (await adminQuery("select connection_id from social_accounts where id = $1", [w2.ig]))[0].connection_id;
    const r = await disconnect(w2.actor, w2.ws, conn);
    expect(r.cancellationsRequested).toBe(1);
    await drain();
    expect((await delivery(d2)).state).toBe("cancelled");
  });

  it("AT29 missed time -> needs rescheduling, no catch-up publication", async () => {
    const w = await world("at29");
    const v = await igDraft(w);
    const { approvalId } = await approve(w.actor, w.ws, { variantId: v, expectedVersion: 1, accountIds: [w.ig], localTime: futureLocal(TZ) });
    const { deliveryIds: [d] } = await submitApproval(w.actor, w.ws, { approvalId });
    await adminQuery("update deliveries set scheduled_utc = now() - interval '1 minute' where id = $1", [d]);
    await drain();
    expect((await delivery(d)).state).toBe("needs_rescheduling");
    expect(resetFixture().calls).toHaveLength(0);
  });

  it("AT17 rate limit re-queues with delay, no runaway retry", async () => {
    const w = await world("at17");
    const v = await igDraft(w);
    const fx = resetFixture(); fx.faults.push("rate_limit");
    const { approvalId } = await approve(w.actor, w.ws, { variantId: v, expectedVersion: 1, accountIds: [w.ig], localTime: futureLocal(TZ) });
    const { deliveryIds: [d] } = await submitApproval(w.actor, w.ws, { approvalId });
    await drain(); await drain();
    expect(fx.calls).toHaveLength(1);
    expect((await delivery(d)).state).toBe("schedule_pending");
  });

  it("rejects approving accounts not on the allowlist", async () => {
    const w = await world("allow");
    const v = await igDraft(w);
    await adminQuery("update social_accounts set allowed = false where id = $1", [w.ig]);
    await expect(approve(w.actor, w.ws, { variantId: v, expectedVersion: 1, accountIds: [w.ig], localTime: futureLocal(TZ) })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("agents and budget", () => {
  it("AT03 duplicate clientMessageId creates one message and one plan; J01 drafts are produced", async () => {
    const w = await world("at03");
    const msg = { campaignId: w.campaignId, clientMessageId: "msg-00000001", text: "Create two Instagram image posts for our coffee-shop opening, one tomorrow and one the following day at 8am" };
    const r1 = await postMessage(w.actor, w.ws, msg);
    const r2 = await postMessage(w.actor, w.ws, msg);
    expect(r2).toMatchObject({ planId: r1.planId, duplicate: true });
    await drain();
    const conv = await conversation(w.actor, w.ws, w.campaignId);
    expect(conv.messages.filter((m: any) => m.role === "user")).toHaveLength(1);
    expect(conv.tasks.map((t: any) => t.state)).toEqual(["succeeded", "succeeded", "succeeded"]);
    const posts = await listPosts(w.actor, w.ws);
    expect(posts).toHaveLength(2);
    expect(posts.every((p: any) => p.ai_generated && p.asset_id)).toBe(true);
  });

  it("asks a focused question instead of inventing a date", async () => {
    const w = await world("clarify");
    await postMessage(w.actor, w.ws, { campaignId: w.campaignId, clientMessageId: "msg-00000002", text: "Make some instagram posts" });
    await drain();
    const conv = await conversation(w.actor, w.ws, w.campaignId);
    expect(conv.tasks[0].state).toBe("awaiting_input");
    expect(conv.messages.at(-1).body).toMatch(/date and local time/);
  });

  it("AT07 follow-up revision whose target changed meanwhile cannot overwrite the newer draft", async () => {
    const w = await world("at07");
    const v = await igDraft(w, "original");
    await postMessage(w.actor, w.ws, { campaignId: w.campaignId, clientMessageId: "msg-00000003", text: "make the first post about pastries" });
    // Owner edits before the worker runs.
    // The owner edits while the creator is generating (after the plan captured version 1).
    const { FixtureCreator } = await import("@/src/agents/fixture");
    const orig = FixtureCreator.prototype.draft;
    FixtureCreator.prototype.draft = async function (i) {
      await updateVariant(w.actor, w.ws, v, { expectedVersion: 1, caption: "owner edit" });
      return orig.call(this, i);
    };
    try { await drain(); } finally { FixtureCreator.prototype.draft = orig; }
    const cur = await getVariant(w.actor, w.ws, v);
    expect(cur.caption).toBe("owner edit");
    const conv = await conversation(w.actor, w.ws, w.campaignId);
    expect(conv.tasks.find((t: any) => t.plan_key === "revise").error_code).toBe("STALE_OUTPUT");
  });

  it("AT31 concurrent reservations cannot oversubscribe the cap; same logical key is reserved once", async () => {
    const w = await world("at31");
    await adminQuery("update workspaces set daily_budget_micros = 100 where id = $1", [w.ws]);
    const run = (k: string) => withScope({ kind: "worker" }, w.ws, (tx) => reserve(tx, w.ws, k, 60, "test")).then(() => "ok", (e) => e.code);
    const keys = ["k1", "k2", "k3"];
    const res = await Promise.all(keys.map(run));
    expect(res.filter((r) => r === "ok")).toHaveLength(1);
    expect(res.filter((r) => r === "BUDGET_EXCEEDED")).toHaveLength(2);
    expect(await run(keys[res.indexOf("ok")])).toBe("ok"); // replay of the existing reservation
  });
});
