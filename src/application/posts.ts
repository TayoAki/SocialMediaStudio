import { z } from "zod";
import { AppError } from "@/src/domain/errors";
import { audit, one, withScope, type Actor, type Tx } from "@/src/data/db";

export const CreatePost = z.object({
  campaignId: z.string().uuid(),
  concept: z.string().trim().min(1).max(300),
  proposedLocalTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
  variants: z.array(z.object({
    platform: z.enum(["instagram", "linkedin"]),
    caption: z.string().max(3000),
    altText: z.string().max(1000).default(""),
    assetId: z.string().uuid().nullable().default(null),
    sourceIds: z.array(z.string().uuid()).default([]),
    aiGenerated: z.boolean().default(false),
  })).min(1).max(4),
});

export async function createPostTx(tx: Tx, actor: Actor, ws: string, input: z.infer<typeof CreatePost>) {
  const camp = await one(tx, "select brand_profile_version, status from campaigns where id = $1 and workspace_id = $2", [input.campaignId, ws]);
  if (camp.status !== "active") throw new AppError("FORBIDDEN", "Campaign is archived");
  const bp = await one(tx, "select max(version) as v from brand_profiles where workspace_id = $1", [ws]);
  const post = await one(tx, "insert into posts (workspace_id, campaign_id, concept, proposed_local_time) values ($1,$2,$3,$4) returning *", [ws, input.campaignId, input.concept, input.proposedLocalTime ?? null]);
  const variantIds: string[] = [];
  for (const v of input.variants) {
    const pv = await one(tx, "insert into post_variants (workspace_id, post_id, platform) values ($1,$2,$3) returning id", [ws, post.id, v.platform]);
    await tx.query(
      "insert into variant_revisions (workspace_id, variant_id, revision, caption, alt_text, asset_id, source_ids, brand_profile_version, ai_generated) values ($1,$2,1,$3,$4,$5,$6,$7,$8)",
      [ws, pv.id, v.caption, v.altText, v.assetId, v.sourceIds, bp.v, v.aiGenerated]);
    variantIds.push(pv.id);
  }
  await audit(tx, ws, actor, "post.created", post.id, { variants: variantIds.length });
  return { postId: post.id as string, variantIds };
}

export async function createPost(actor: Actor, ws: string, input: unknown) {
  const v = CreatePost.parse(input);
  return withScope(actor, ws, (tx) => createPostTx(tx, actor, ws, v));
}

export const UpdateVariant = z.object({
  expectedVersion: z.number().int(),
  caption: z.string().max(3000).optional(),
  altText: z.string().max(1000).optional(),
  assetId: z.string().uuid().nullable().optional(),
  aiGenerated: z.boolean().optional(),
});

/**
 * Creates revision+1 (FR15). Any change invalidates unconsumed approvals (FR23) and
 * returns the variant to draft. Deliveries already bound to an older revision are untouched:
 * the previously approved version stays scheduled until replaced/cancelled at the provider.
 */
export async function updateVariantTx(tx: Tx, actor: Actor, ws: string, variantId: string, p: z.infer<typeof UpdateVariant>) {
  const v = await one(tx, "select * from post_variants where id = $1 and workspace_id = $2 for update", [variantId, ws]);
  if (v.version !== p.expectedVersion) throw new AppError("VERSION_CONFLICT", "This draft changed since you opened it", { currentVersion: v.version });
  if (v.editorial_state === "published") throw new AppError("INVALID_INPUT", "Published variants are immutable; duplicate it as a new post");
  const cur = await one(tx, "select * from variant_revisions where variant_id = $1 and revision = $2", [variantId, v.current_revision]);
  const bp = await one(tx, "select max(version) as v from brand_profiles where workspace_id = $1", [ws]);
  const rev = v.current_revision + 1;
  await tx.query(
    "insert into variant_revisions (workspace_id, variant_id, revision, caption, alt_text, asset_id, source_ids, brand_profile_version, ai_generated) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [ws, variantId, rev, p.caption ?? cur.caption, p.altText ?? cur.alt_text, p.assetId === undefined ? cur.asset_id : p.assetId, cur.source_ids, bp.v, p.aiGenerated ?? false]);
  await tx.query("update post_variants set current_revision = $2, version = version + 1, editorial_state = 'draft' where id = $1", [variantId, rev]);
  const inv = await tx.query(
    "update approvals set invalidated_reason = 'variant_changed' where variant_id = $1 and consumed_at is null and invalidated_reason is null returning id", [variantId]);
  await audit(tx, ws, actor, "variant.revised", variantId, { revision: rev, approvalsInvalidated: inv.rowCount });
  return { revision: rev, version: v.version + 1 };
}

export async function updateVariant(actor: Actor, ws: string, variantId: string, input: unknown) {
  const p = UpdateVariant.parse(input);
  return withScope(actor, ws, (tx) => updateVariantTx(tx, actor, ws, variantId, p));
}

export async function listPosts(actor: Actor, ws: string) {
  return withScope(actor, ws, async (tx) => (await tx.query(
    `select p.id as post_id, p.concept, c.name as campaign, v.id as variant_id, v.platform, v.editorial_state, v.version, v.current_revision,
            r.caption, r.alt_text, r.asset_id, r.ai_generated, r.source_ids, a.checksum as asset_checksum,
            (select json_agg(json_build_object('id', d.id, 'state', d.state, 'scheduled_utc', d.scheduled_utc, 'revision', d.revision) order by d.created_at)
               from deliveries d where d.variant_id = v.id) as deliveries
     from posts p join campaigns c on c.id = p.campaign_id join post_variants v on v.post_id = p.id
     join variant_revisions r on r.variant_id = v.id and r.revision = v.current_revision
     left join assets a on a.id = r.asset_id
     where p.workspace_id = $1 order by p.created_at desc, v.platform`, [ws])).rows);
}

export async function getVariant(actor: Actor, ws: string, variantId: string) {
  return withScope(actor, ws, async (tx) => {
    const v = await one(tx,
      `select v.*, p.concept, p.campaign_id, p.proposed_local_time, r.caption, r.alt_text, r.asset_id, r.source_ids, r.ai_generated, r.brand_profile_version
       from post_variants v join posts p on p.id = v.post_id join variant_revisions r on r.variant_id = v.id and r.revision = v.current_revision
       where v.id = $1 and v.workspace_id = $2`, [variantId, ws]);
    const revisions = (await tx.query("select revision, caption, ai_generated, created_at from variant_revisions where variant_id = $1 order by revision desc", [variantId])).rows;
    const sources = v.source_ids.length ? (await tx.query("select * from research_sources where id = any($1)", [v.source_ids])).rows : [];
    const approvals = (await tx.query("select id, revision, decision, consumed_at, invalidated_reason, tuple, created_at from approvals where variant_id = $1 order by created_at desc", [variantId])).rows;
    return { ...v, revisions, sources, approvals };
  });
}
