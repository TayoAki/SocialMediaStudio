import { AppError } from "@/src/domain/errors";
import { one, type Tx } from "@/src/data/db";

/**
 * Atomic budget reservation (FR13, AT31). The workspace row is locked so concurrent
 * reservations cannot oversubscribe the daily cap. Keys are logical (task + purpose),
 * so retries/resumes reuse the same reservation instead of resetting it.
 */
export async function reserve(tx: Tx, ws: string, logicalKey: string, micros: number, category: string) {
  const w = await one(tx, "select daily_budget_micros from workspaces where id = $1 for update", [ws]);
  const existing = await tx.query("select id from usage_records where logical_key = $1", [logicalKey]);
  if (existing.rowCount) return;
  const used = await one(tx,
    "select coalesce(sum(coalesce(settled_micros, reserved_micros)), 0)::bigint as u from usage_records where workspace_id = $1 and created_at > now() - interval '1 day'", [ws]);
  if (Number(used.u) + micros > Number(w.daily_budget_micros)) throw new AppError("BUDGET_EXCEEDED", "Daily generation budget reached; editing and existing schedules are unaffected");
  await tx.query("insert into usage_records (workspace_id, logical_key, category, reserved_micros, state) values ($1,$2,$3,$4,'reserved')", [ws, logicalKey, category, micros]);
}

/** Settle exactly once; a second settle is a no-op. */
export async function settle(tx: Tx, logicalKey: string, micros: number) {
  await tx.query("update usage_records set settled_micros = $2, state = 'settled' where logical_key = $1 and state = 'reserved'", [logicalKey, micros]);
}
