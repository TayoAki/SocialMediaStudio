import { mapProviderStatus, type DeliveryState, assertTransition } from "@/src/domain/delivery";
import { decryptSecret } from "@/src/security/crypto";
import { publisherFor } from "@/src/providers/publishing";
import { ProviderError, type PublishingAdapter, type ScheduleRequest } from "@/src/providers/publishing/types";
import { storage } from "@/src/providers/media/storage";
import { audit, getPool, one, withScope, type Tx } from "@/src/data/db";
import { log } from "@/src/observability/log";

const WORKER = { kind: "worker" } as const;
type AdapterFactory = (provider: string, secret: string) => PublishingAdapter;

async function move(tx: Tx, id: string, from: DeliveryState, to: DeliveryState) {
  if (from === to) return;
  assertTransition(from, to);
  await tx.query("update deliveries set state = $2, version = version + 1 where id = $1", [id, to]);
}

/** Claim due outbox events and dispatch them. Workspace scope comes from the persisted event. */
export async function processOutbox(opts: { adapters?: AdapterFactory; limit?: number } = {}) {
  const claimed = (await getPool().query("select * from app.claim_outbox($1, 60)", [opts.limit ?? 20])).rows;
  for (const ev of claimed) {
    try {
      if (ev.kind === "operation.execute") await executeOperation(ev.workspace_id, ev.aggregate_id, opts.adapters);
      else if (ev.kind === "plan.run") await (await import("@/src/agents/runner")).runPlan(ev.workspace_id, ev.aggregate_id);
      await withScope(WORKER, ev.workspace_id, (tx) => tx.query("update outbox_events set status = 'done' where id = $1", [ev.id]));
    } catch (e) {
      log("error", "outbox.dispatch_failed", { eventId: ev.id, kind: ev.kind, error: (e as Error).message });
      await withScope(WORKER, ev.workspace_id, (tx) => tx.query(
        "update outbox_events set status = case when attempts >= 5 then 'dead' else 'pending' end, available_at = now() + interval '30 seconds' where id = $1", [ev.id]));
    }
  }
  return claimed.length;
}

/**
 * Execute one provider operation (PRD §10 schedule/update/cancel protocol).
 * Phase 1 commits in_flight BEFORE the external call, so a crash leaves evidence that
 * the request may have been sent; the sweeper turns stale in_flight into outcome_unknown
 * and nothing ever re-sends it automatically.
 */
export async function executeOperation(ws: string, operationId: string, adapters: AdapterFactory = publisherFor) {
  const prep = await withScope(WORKER, ws, async (tx) => {
    const op = await one(tx, "select * from provider_operations where id = $1 for update", [operationId]);
    if (op.state !== "pending") return null; // replayed event: persistent uniqueness, not event dedupe
    const d = await one(tx, "select * from deliveries where id = $1 for update", [op.delivery_id]);
    const w = await one(tx, "select status from workspaces where id = $1", [ws]);
    const acct = await one(tx, "select s.*, c.provider, c.secret_ciphertext, c.status as cstatus, c.id as cid from social_accounts s join provider_connections c on c.id = s.connection_id where s.id = $1", [d.account_id]);
    const fail = async (to: DeliveryState, errorClass: string) => {
      await tx.query("update provider_operations set state = 'failed', error_class = $2, updated_at = now() where id = $1", [operationId, errorClass]);
      await move(tx, d.id, d.state, to);
      return null;
    };
    if (op.schedule_generation !== d.schedule_generation) return fail(d.state, "superseded");
    if (op.kind === "create") {
      if (w.status !== "active") return fail("failed", "workspace_inactive");
      if (acct.cstatus !== "valid") return fail("needs_connection", "connection");
      if (new Date(d.scheduled_utc).getTime() <= Date.now()) return fail("needs_rescheduling", "missed_time");
    } else if (acct.cstatus === "invalid") {
      return fail("needs_reconciliation", "connection");
    }
    const rev = await one(tx, "select r.*, a.storage_key, a.mime from variant_revisions r left join assets a on a.id = r.asset_id where r.variant_id = $1 and r.revision = $2", [d.variant_id, d.revision]);
    const v = await one(tx, "select platform from post_variants where id = $1", [d.variant_id]);
    await tx.query("update provider_operations set state = 'in_flight', attempts = attempts + 1, submitted_at = now(), updated_at = now() where id = $1", [operationId]);
    return { op, d, acct, rev, platform: v.platform as "instagram" | "linkedin" };
  });
  if (!prep) return;
  const { op, d, acct, rev, platform } = prep;
  const adapter = adapters(acct.provider, decryptSecret(acct.secret_ciphertext));

  let outcome: { ok: true; submissionId?: string; scheduleId?: string | null; remoteState?: string } | { ok: false; err: ProviderError };
  try {
    if (op.kind === "create") {
      const mediaUrls: string[] = [];
      if (rev.storage_key) mediaUrls.push((await adapter.uploadMedia(`${rev.asset_id}.${rev.mime.split("/")[1]}`, await storage().get(rev.storage_key), rev.mime)).publicUrl);
      const req: ScheduleRequest = { accountExternalId: acct.external_account_id, platform, text: rev.caption, mediaUrls, scheduledUtc: new Date(d.scheduled_utc).toISOString() };
      const { submissionId } = await adapter.createScheduled(req);
      // Persist the submission ID immediately, before any further call can fail.
      await withScope(WORKER, ws, (tx) => tx.query("update deliveries set provider_submission_id = $2 where id = $1", [d.id, submissionId]));
      const status = await adapter.getStatus(submissionId).catch(() => null);
      const matches = (await adapter.listSchedules().catch(() => [])).filter((s) =>
        s.accountExternalId === req.accountExternalId && new Date(s.scheduledUtc).getTime() === new Date(req.scheduledUtc).getTime() && s.text === req.text);
      outcome = { ok: true, submissionId, scheduleId: matches.length === 1 ? matches[0].scheduleId : null, remoteState: status?.status };
    } else if (op.kind === "update") {
      await adapter.updateSchedule(d.provider_schedule_id, { scheduledUtc: op.payload.scheduledUtc });
      outcome = { ok: true };
    } else {
      await adapter.deleteSchedule(d.provider_schedule_id);
      outcome = { ok: true };
    }
  } catch (e) {
    outcome = { ok: false, err: e instanceof ProviderError ? e : new ProviderError("unknown", (e as Error).message) };
  }

  await withScope(WORKER, ws, async (tx) => {
    const cur = await one(tx, "select * from deliveries where id = $1 for update", [d.id]);
    if (outcome.ok) {
      await tx.query("update provider_operations set state = 'succeeded', external_id = coalesce($2, external_id), updated_at = now() where id = $1", [operationId, outcome.submissionId ?? null]);
      if (op.kind === "create") {
        const mapped = outcome.remoteState ? mapProviderStatus(outcome.remoteState) : null;
        await tx.query("update deliveries set provider_schedule_id = $2, observed_provider_state = $3, observed_at = now() where id = $1", [d.id, outcome.scheduleId, outcome.remoteState ?? null]);
        // Scheduled only on provider confirmation; otherwise stay pending for the poller.
        if (mapped === "scheduled" || mapped === "processing" || mapped === "published") await move(tx, d.id, cur.state, mapped);
      } else if (op.kind === "update") {
        await tx.query("update deliveries set scheduled_utc = $2, local_time = $3 where id = $1", [d.id, op.payload.scheduledUtc, op.payload.localTime]);
        await move(tx, d.id, cur.state, "scheduled");
      } else {
        await move(tx, d.id, cur.state, "cancelled");
      }
      await audit(tx, ws, WORKER, `operation.${op.kind}.succeeded`, operationId);
      return;
    }
    const { err } = outcome;
    const cls = err.errorClass;
    log("warn", "provider.operation_failed", { operationId, kind: op.kind, errorClass: cls });
    if (cls === "rate_limited") {
      await tx.query("update provider_operations set state = 'pending', error_class = $2, updated_at = now() where id = $1", [operationId, cls]);
      await tx.query("insert into outbox_events (workspace_id, kind, aggregate_id, aggregate_version, available_at) values ($1,'operation.execute',$2,$3, now() + make_interval(secs => $4)) on conflict do nothing",
        [ws, operationId, op.attempts + 2, err.retryAfterSeconds ?? 60]);
      return;
    }
    const opState = cls === "unknown" || (cls === "not_found" && op.kind !== "create") ? "outcome_unknown" : "failed";
    await tx.query("update provider_operations set state = $2, error_class = $3, updated_at = now() where id = $1", [operationId, opState, cls]);
    if (cls === "auth") {
      await tx.query("update provider_connections set status = 'invalid' where id = $1", [acct.cid]);
      await move(tx, d.id, cur.state, op.kind === "create" ? "needs_connection" : "needs_reconciliation");
    } else if (opState === "outcome_unknown") {
      await move(tx, d.id, cur.state, "needs_reconciliation");
    } else if (op.kind === "create") {
      await move(tx, d.id, cur.state, "failed");
    } else {
      // Rejected update/cancel: the previously confirmed schedule remains active.
      await move(tx, d.id, cur.state, "scheduled");
    }
    await audit(tx, ws, WORKER, `operation.${op.kind}.${opState}`, operationId, { errorClass: cls });
  });
}

/** Stale in_flight operations (worker died mid-call) become outcome_unknown, never auto-retried. */
export async function sweepStaleOperations(olderThanSeconds = 300) {
  const workspaces = (await getPool().query("select distinct workspace_id from app.stale_operations($1)", [olderThanSeconds])).rows;
  for (const { workspace_id } of workspaces) {
    await withScope(WORKER, workspace_id, async (tx) => {
      const stale = (await tx.query("select id, delivery_id from provider_operations where state = 'in_flight' and updated_at < now() - make_interval(secs => $1) for update", [olderThanSeconds])).rows;
      for (const s of stale) {
        await tx.query("update provider_operations set state = 'outcome_unknown', error_class = 'worker_interrupted', updated_at = now() where id = $1", [s.id]);
        const d = await one(tx, "select state from deliveries where id = $1 for update", [s.delivery_id]);
        await move(tx, s.delivery_id, d.state, "needs_reconciliation");
      }
    });
  }
}

/** Poll provider status for submitted deliveries; Published only on definitive evidence (FR28). */
export async function pollDelivery(ws: string, deliveryId: string, adapters: AdapterFactory = publisherFor) {
  const ctx = await withScope(WORKER, ws, (tx) => one(tx,
    "select d.*, c.provider, c.secret_ciphertext from deliveries d join social_accounts s on s.id = d.account_id join provider_connections c on c.id = s.connection_id where d.id = $1", [deliveryId]));
  if (!ctx.provider_submission_id || ["published", "cancelled", "failed"].includes(ctx.state)) return ctx.state as DeliveryState;
  const status = await adapters(ctx.provider, decryptSecret(ctx.secret_ciphertext)).getStatus(ctx.provider_submission_id);
  return withScope(WORKER, ws, async (tx) => {
    const d = await one(tx, "select * from deliveries where id = $1 for update", [deliveryId]);
    await tx.query("update deliveries set observed_provider_state = $2, observed_at = $3, remote_url = coalesce($4, remote_url) where id = $1", [d.id, status.status, status.observedAt, status.remoteUrl ?? null]);
    const mapped = mapProviderStatus(status.status);
    if (mapped && mapped !== d.state && ["schedule_pending", "scheduled", "processing", "needs_reconciliation"].includes(d.state)) {
      await move(tx, d.id, d.state, mapped);
      if (mapped === "published") await tx.query("update post_variants set editorial_state = 'published' where id = $1", [d.variant_id]);
      await audit(tx, ws, WORKER, `delivery.${mapped}`, d.id, { observedAt: status.observedAt });
    }
    return (mapped ?? d.state) as DeliveryState;
  });
}
