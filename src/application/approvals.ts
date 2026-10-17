import { z } from "zod";
import { AppError } from "@/src/domain/errors";
import { tupleDigest, type PublicationTuple } from "@/src/domain/approval";
import { resolveLocalTime } from "@/src/domain/time";
import { audit, one, withScope, type Actor, type Tx } from "@/src/data/db";

export const Approve = z.object({
  variantId: z.string().uuid(),
  expectedVersion: z.number().int(),
  accountIds: z.array(z.string().uuid()).min(1).max(5),
  localTime: z.string(),
  offsetMinutes: z.number().int().optional(),
});

/** Build the tuple from current persisted state; used both at approval and before submission. */
export async function currentTuple(tx: Tx, ws: string, variantId: string, accountIds: string[], localTime: string, timezone: string, scheduledUtc: string): Promise<PublicationTuple> {
  const v = await one(tx,
    `select v.id, v.platform, v.current_revision, r.caption, r.alt_text, a.checksum
     from post_variants v join variant_revisions r on r.variant_id = v.id and r.revision = v.current_revision
     left join assets a on a.id = r.asset_id where v.id = $1 and v.workspace_id = $2`, [variantId, ws]);
  return {
    variantId, revision: v.current_revision, platform: v.platform, caption: v.caption, altText: v.alt_text,
    assetChecksum: v.checksum ?? null, accountIds, localTime, timezone, scheduledUtc, options: {},
  };
}

export async function checkAccounts(tx: Tx, ws: string, platform: string, accountIds: string[], hasAsset: boolean) {
  const rows = (await tx.query(
    `select s.*, c.status as connection_status from social_accounts s join provider_connections c on c.id = s.connection_id
     where s.workspace_id = $1 and s.id = any($2)`, [ws, accountIds])).rows;
  if (rows.length !== new Set(accountIds).size) throw new AppError("FORBIDDEN", "One or more accounts are not in this workspace");
  for (const a of rows) {
    if (!a.allowed) throw new AppError("FORBIDDEN", `${a.display_name} is not on this workspace's allowlist`);
    if (a.platform !== platform) throw new AppError("CAPABILITY_UNAVAILABLE", `${a.display_name} is a ${a.platform} account, not ${platform}`);
    if (a.connection_status !== "valid") throw new AppError("CONNECTION_EXPIRED", `Connection for ${a.display_name} needs attention`);
    const fmt = hasAsset ? "image_post" : "text_post";
    if (!a.capabilities.formats?.includes(fmt)) throw new AppError("CAPABILITY_UNAVAILABLE", `${a.display_name} does not support ${fmt.replace("_", " ")}s`);
    if (!a.capabilities.schedule) throw new AppError("CAPABILITY_UNAVAILABLE", `${a.display_name} does not support scheduling`);
  }
  return rows;
}

export async function approve(actor: Actor, ws: string, input: unknown) {
  const p = Approve.parse(input);
  if (actor.kind !== "user") throw new AppError("FORBIDDEN", "Only people approve");
  return withScope(actor, ws, async (tx) => {
    const v = await one(tx, "select * from post_variants where id = $1 and workspace_id = $2 for update", [p.variantId, ws]);
    if (v.version !== p.expectedVersion) throw new AppError("VERSION_CONFLICT", "Draft changed; review the latest version", { currentVersion: v.version });
    if (v.editorial_state === "published") throw new AppError("INVALID_INPUT", "Already published");
    const { timezone } = await one(tx, "select timezone from workspaces where id = $1", [ws]);
    const t = resolveLocalTime(p.localTime, timezone, p.offsetMinutes);
    if (t.kind !== "ok") throw new AppError("TIME_AMBIGUOUS", t.message, t.kind === "ambiguous" ? { offsets: t.offsets } : {});
    if (new Date(t.utc).getTime() <= Date.now() + 60_000) throw new AppError("NEEDS_RESCHEDULING", "Choose a time at least one minute in the future");
    const rev = await one(tx, "select caption, asset_id from variant_revisions where variant_id = $1 and revision = $2", [p.variantId, v.current_revision]);
    if (!rev.caption.trim()) throw new AppError("INVALID_INPUT", "Caption is required");
    if (v.platform === "instagram" && !rev.asset_id) throw new AppError("CAPABILITY_UNAVAILABLE", "Instagram feed posts need an image");
    await checkAccounts(tx, ws, v.platform, p.accountIds, !!rev.asset_id);
    const tuple = await currentTuple(tx, ws, p.variantId, p.accountIds, p.localTime, timezone, t.utc);
    const a = await one(tx,
      "insert into approvals (workspace_id, approver_id, variant_id, revision, digest, tuple, decision) values ($1,$2,$3,$4,$5,$6,'approved') returning id",
      [ws, actor.userId, p.variantId, v.current_revision, tupleDigest(tuple), tuple]);
    await tx.query("update post_variants set editorial_state = 'approved' where id = $1", [p.variantId]);
    await audit(tx, ws, actor, "approval.granted", a.id, { variantId: p.variantId, revision: v.current_revision, accounts: p.accountIds.length });
    return { approvalId: a.id as string, tuple };
  });
}
