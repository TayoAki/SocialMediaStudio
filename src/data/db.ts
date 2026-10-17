import { Pool, type PoolClient } from "pg";
import { AppError } from "@/src/domain/errors";

let pool: Pool | null = null;
export function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required (runtime role, not admin)");
    pool = new Pool({ connectionString: url, max: 10 });
  }
  return pool;
}
export async function closePool() {
  await pool?.end();
  pool = null;
}

export type Actor =
  | { kind: "user"; userId: string }
  | { kind: "worker" }
  | { kind: "cleanup" };

export type Tx = PoolClient;

/**
 * Run fn in a transaction whose tenant scope is set with set_config(..., true),
 * i.e. transaction-local, so pooled connections never carry scope between requests.
 * For users, membership is verified before any tenant row is touched; RLS enforces it again.
 */
export async function withScope<T>(actor: Actor, workspaceId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query(
      "select set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true), set_config('app.actor_kind', $3, true)",
      [actor.kind === "user" ? actor.userId : "", workspaceId ?? "", actor.kind],
    );
    if (workspaceId && actor.kind === "user") {
      const m = await client.query("select app.is_member($1) as ok", [workspaceId]);
      if (!m.rows[0].ok) throw new AppError("FORBIDDEN", "Not a member of this workspace");
    }
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function one<T = any>(tx: Tx, sql: string, params: unknown[] = []): Promise<T> {
  const r = await tx.query(sql, params);
  if (!r.rowCount) throw new AppError("NOT_FOUND", "Not found");
  return r.rows[0];
}

export async function audit(tx: Tx, workspaceId: string, actor: Actor, action: string, aggregateId: string | null, summary: object = {}) {
  await tx.query(
    "insert into audit_events (workspace_id, actor, action, aggregate_id, summary) values ($1,$2,$3,$4,$5)",
    [workspaceId, actor.kind === "user" ? actor.userId : actor.kind, action, aggregateId, summary],
  );
}
