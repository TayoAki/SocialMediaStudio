import { z } from "zod";
import { AppError } from "@/src/domain/errors";
import { tupleDigest, type PublicationTuple } from "@/src/domain/approval";
import { assertTransition, type DeliveryState } from "@/src/domain/delivery";
import { resolveLocalTime } from "@/src/domain/time";
import { audit, one, withScope, type Actor, type Tx } from "@/src/data/db";
import { checkAccounts, currentTuple } from "./approvals";

async function enqueue(tx: Tx, ws: string, kind: string, aggregateId: string, version: number) {
  await tx.query(
    "insert into outbox_events (workspace_id, kind, aggregate_id, aggregate_version) values ($1,$2,$3,$4) on conflict do nothing",
    [ws, kind, aggregateId, version]);
}

async function insertOperation(tx: Tx, ws: string, deliveryId: string, kind: "create" | "update" | "cancel", generation: number, payload: object) {
  const logicalKey = `${kind}:${deliveryId}:${generation}`;
  const op = await tx.query(
    `insert into provider_operations (workspace_id, delivery_id, kind, schedule_generation, logical_key, payload, payload_digest)
     values ($1,$2,$3,$4,$5,$6::jsonb, encode(digest($7, 'sha256'), 'hex')) on conflict (logical_key) do nothing returning id`,
    [ws, deliveryId, kind, generation, logicalKey, JSON.stringify(payload), JSON.stringify(payload)]);
  if (!op.rowCount) throw new AppError("VERSION_CONFLICT", "An operation for this change already exists");
  await enqueue(tx, ws, "operation.execute", op.rows[0].id, 1);
  return op.rows[0].id as string;
}

async function setState(tx: Tx, id: string, from: DeliveryState, to: DeliveryState, extra = "") {
  assertTransition(from, to);
  await tx.query(`update deliveries set state = $2, version = version + 1 ${extra} where id = $1`, [id, to]);
}

/**
 * Consume an approval exactly once (FR24, AT09, AT30). The approval row is locked; the
 * grant is materialised into one delivery + create operation + outbox event per approved
 * account in the same transaction. A replay returns the existing delivery IDs.
 */
export async function submitApproval(actor: Actor, ws: string, input: unknown) {
  const { approvalId } = z.object({ approvalId: z.string().uuid() }).parse(input);
  return withScope(actor, ws, async (tx) => {
    const a = await one(tx, "select * from approvals where id = $1 and workspace_id = $2 for update", [approvalId, ws]);
    if (a.consumed_at) {
      const existing = (await tx.query("select id from deliveries where approval_id = $1 order by account_id", [approvalId])).rows.map((r) => r.id);
      return { deliveryIds: existing as string[], replay: true };
    }
    if (a.invalidated_reason || a.decision !== "approved") throw new AppError("APPROVAL_REQUIRED", "This approval no longer applies; approve the current version");
    const t = a.tuple as PublicationTuple;
    const fresh = await currentTuple(tx, ws, t.variantId, t.accountIds, t.localTime, t.timezone, t.scheduledUtc);
    if (tupleDigest(fresh) !== a.digest) {
      await tx.query("update approvals set invalidated_reason = 'tuple_mismatch' where id = $1", [approvalId]);
      throw new AppError("APPROVAL_REQUIRED", "Content, media or accounts changed after approval");
    }
    if (new Date(t.scheduledUtc).getTime() <= Date.now()) throw new AppError("NEEDS_RESCHEDULING", "The approved time has passed; choose and approve a new future time");
    await checkAccounts(tx, ws, t.platform, t.accountIds, !!t.assetChecksum);
    const ids: string[] = [];
    for (const accountId of [...t.accountIds].sort()) {
      const d = await one(tx,
        `insert into deliveries (workspace_id, variant_id, revision, account_id, approval_id, local_time, timezone, scheduled_utc, desired_state, state)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'scheduled','schedule_pending') returning id`,
        [ws, t.variantId, t.revision, accountId, approvalId, t.localTime, t.timezone, t.scheduledUtc]);
      await insertOperation(tx, ws, d.id, "create", 1, { scheduledUtc: t.scheduledUtc });
      ids.push(d.id);
    }
    await tx.query("update approvals set consumed_at = now() where id = $1", [approvalId]);
    await audit(tx, ws, actor, "approval.consumed", approvalId, { deliveries: ids });
    return { deliveryIds: ids, replay: false };
  });
}

export const Reschedule = z.object({ expectedVersion: z.number().int(), localTime: z.string(), offsetMinutes: z.number().int().optional() });

/**
 * Reschedule (J03, FR23). The confirmed old schedule stays authoritative and visible
 * until the provider confirms the update. Confirmation here is the approval of the
 * new schedule tuple; it is recorded as its own (immediately consumed) approval.
 */
export async function reschedule(actor: Actor, ws: string, deliveryId: string, input: unknown) {
  const p = Reschedule.parse(input);
  if (actor.kind !== "user") throw new AppError("FORBIDDEN", "Only people reschedule");
  return withScope(actor, ws, async (tx) => {
    const d = await one(tx, "select * from deliveries where id = $1 and workspace_id = $2 for update", [deliveryId, ws]);
    if (d.version !== p.expectedVersion) throw new AppError("VERSION_CONFLICT", "Delivery changed", { currentVersion: d.version });
    if (d.state !== "scheduled") throw new AppError("INVALID_INPUT", `Cannot reschedule while ${d.state}`);
    if (!d.provider_schedule_id) throw new AppError("CAPABILITY_UNAVAILABLE", "Remote schedule ID not linked yet; reconcile first");
    const t = resolveLocalTime(p.localTime, d.timezone, p.offsetMinutes);
    if (t.kind !== "ok") throw new AppError("TIME_AMBIGUOUS", t.message, t.kind === "ambiguous" ? { offsets: t.offsets } : {});
    if (new Date(t.utc).getTime() <= Date.now() + 60_000) throw new AppError("NEEDS_RESCHEDULING", "Choose a future time");
    const old = (await one(tx, "select tuple from approvals where id = $1", [d.approval_id])).tuple as PublicationTuple;
    const tuple: PublicationTuple = { ...old, accountIds: [d.account_id], revision: d.revision, localTime: p.localTime, scheduledUtc: t.utc };
    await tx.query(
      "insert into approvals (workspace_id, approver_id, variant_id, revision, digest, tuple, decision, consumed_at) values ($1,$2,$3,$4,$5,$6,'approved',now())",
      [ws, actor.userId, d.variant_id, d.revision, tupleDigest(tuple), tuple]);
    const gen = d.schedule_generation + 1;
    await tx.query("update deliveries set schedule_generation = $2 where id = $1", [deliveryId, gen]);
    await setState(tx, deliveryId, "scheduled", "change_pending");
    await insertOperation(tx, ws, deliveryId, "update", gen, { scheduledUtc: t.utc, localTime: p.localTime });
    await audit(tx, ws, actor, "delivery.reschedule_requested", deliveryId, { from: d.scheduled_utc, to: t.utc });
    return { generation: gen };
  });
}

export async function cancelDelivery(actor: Actor, ws: string, deliveryId: string, input: unknown) {
  const p = z.object({ expectedVersion: z.number().int() }).parse(input);
  return withScope(actor, ws, (tx) => cancelDeliveryTx(tx, actor, ws, deliveryId, p.expectedVersion));
}

export async function cancelDeliveryTx(tx: Tx, actor: Actor, ws: string, deliveryId: string, expectedVersion: number | null) {
  const d = await one(tx, "select * from deliveries where id = $1 and workspace_id = $2 for update", [deliveryId, ws]);
  if (expectedVersion !== null && d.version !== expectedVersion) throw new AppError("VERSION_CONFLICT", "Delivery changed", { currentVersion: d.version });
  if (["cancelled", "published", "cancelling"].includes(d.state)) return { state: d.state };
  if (d.state === "approved" || d.state === "needs_rescheduling") {
    await setState(tx, deliveryId, d.state, "cancelled", ", desired_state = 'cancelled'");
    return { state: "cancelled" };
  }
  if (d.state !== "scheduled" || !d.provider_schedule_id)
    throw new AppError("INVALID_INPUT", `Cannot cancel while ${d.state}; wait for provider confirmation or reconcile`);
  const gen = d.schedule_generation + 1;
  await tx.query("update deliveries set schedule_generation = $2, desired_state = 'cancelled' where id = $1", [deliveryId, gen]);
  await setState(tx, deliveryId, "scheduled", "cancelling");
  await insertOperation(tx, ws, deliveryId, "cancel", gen, {});
  await audit(tx, ws, actor, "delivery.cancel_requested", deliveryId);
  return { state: "cancelling" };
}

export const Resolve = z.discriminatedUnion("resolution", [
  z.object({ resolution: z.literal("attach"), submissionId: z.string().min(1), scheduleId: z.string().optional(), evidence: z.string().min(5) }),
  z.object({ resolution: z.literal("not_accepted"), evidence: z.string().min(5) }),
  z.object({ resolution: z.literal("failed"), evidence: z.string().min(5) }),
]);

/**
 * Operator reconciliation (FR29, J04). Evidence is required; the decision is appended to
 * audit history. "not_accepted" authorises exactly one new attempt for the same generation.
 */
export async function resolveOperation(actor: Actor, ws: string, operationId: string, input: unknown) {
  const p = Resolve.parse(input);
  if (actor.kind !== "user") throw new AppError("FORBIDDEN", "Operator decision required");
  return withScope(actor, ws, async (tx) => {
    const op = await one(tx, "select * from provider_operations where id = $1 and workspace_id = $2 for update", [operationId, ws]);
    if (op.state !== "outcome_unknown") throw new AppError("INVALID_INPUT", "Operation is not awaiting reconciliation");
    const d = await one(tx, "select * from deliveries where id = $1 for update", [op.delivery_id]);
    const evidence = { ...p, by: actor.userId, at: new Date().toISOString() };
    if (p.resolution === "attach") {
      await tx.query("update provider_operations set state = 'resolved', external_id = $2, reconciliation_evidence = $3, updated_at = now() where id = $1", [operationId, p.submissionId, evidence]);
      await setState(tx, d.id, d.state, "scheduled");
      await tx.query("update deliveries set provider_submission_id = $2, provider_schedule_id = $3 where id = $1", [d.id, p.submissionId, p.scheduleId ?? null]);
    } else if (p.resolution === "not_accepted") {
      if (new Date(d.scheduled_utc).getTime() <= Date.now()) {
        await tx.query("update provider_operations set state = 'resolved', reconciliation_evidence = $2, updated_at = now() where id = $1", [operationId, evidence]);
        await setState(tx, d.id, d.state, "needs_rescheduling");
      } else {
        await tx.query("update provider_operations set state = 'pending', reconciliation_evidence = $2, updated_at = now() where id = $1", [operationId, evidence]);
        await setState(tx, d.id, d.state, "schedule_pending");
        await enqueue(tx, ws, "operation.execute", operationId, op.attempts + 1);
      }
    } else {
      await tx.query("update provider_operations set state = 'failed', reconciliation_evidence = $2, updated_at = now() where id = $1", [operationId, evidence]);
      await setState(tx, d.id, d.state, "failed");
    }
    await audit(tx, ws, actor, "operation.reconciled", operationId, { resolution: p.resolution });
    return { ok: true };
  });
}

export async function listDeliveries(actor: Actor, ws: string) {
  return withScope(actor, ws, async (tx) => (await tx.query(
    `select d.*, v.platform, p.concept, s.display_name as account_name, r.caption,
       (select json_agg(json_build_object('id', o.id, 'kind', o.kind, 'state', o.state, 'error_class', o.error_class, 'payload', o.payload) order by o.updated_at desc)
          from provider_operations o where o.delivery_id = d.id) as operations
     from deliveries d join post_variants v on v.id = d.variant_id join posts p on p.id = v.post_id
     join social_accounts s on s.id = d.account_id
     join variant_revisions r on r.variant_id = d.variant_id and r.revision = d.revision
     where d.workspace_id = $1 order by d.scheduled_utc`, [ws])).rows);
}
