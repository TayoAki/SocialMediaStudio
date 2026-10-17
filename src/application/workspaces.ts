import { z } from "zod";
import { IANAZone } from "luxon";
import { AppError } from "@/src/domain/errors";
import { audit, one, withScope, type Actor } from "@/src/data/db";

export const CreateWorkspace = z.object({
  name: z.string().trim().min(1).max(120),
  timezone: z.string().refine((z) => IANAZone.isValidZone(z), "Unknown IANA timezone"),
});

export async function ensureUser(authSubject: string, email: string) {
  return withScope({ kind: "worker" }, null, async (tx) => {
    await tx.query("insert into users (auth_subject, email) values ($1,$2) on conflict (auth_subject) do nothing", [authSubject, email]);
    return (await one<{ id: string }>(tx, "select id from users where auth_subject = $1", [authSubject])).id;
  });
}

export async function createWorkspace(actor: Extract<Actor, { kind: "user" }>, input: unknown) {
  const v = CreateWorkspace.parse(input);
  return withScope(actor, null, async (tx) => {
    const { id } = await one<{ id: string }>(tx, "select app.create_workspace($1,$2,$3) as id", [actor.userId, v.name, v.timezone]);
    return id;
  });
}

export async function myWorkspaces(actor: Extract<Actor, { kind: "user" }>) {
  return withScope(actor, null, async (tx) => (await tx.query("select * from app.my_workspaces()")).rows as { id: string; name: string; timezone: string; role: string }[]);
}

export const BrandPatch = z.object({
  expectedVersion: z.number().int(),
  businessDescription: z.string().max(4000).optional(),
  audience: z.string().max(2000).optional(),
  offer: z.string().max(2000).optional(),
  voiceRules: z.string().max(2000).optional(),
  prohibitedClaims: z.string().max(2000).optional(),
  website: z.string().url().max(300).optional().or(z.literal("")),
});

export async function getBrand(actor: Actor, ws: string) {
  return withScope(actor, ws, (tx) => one(tx, "select * from brand_profiles where workspace_id = $1 order by version desc limit 1", [ws]));
}

/** Brand profiles are immutable snapshots; a patch creates version+1 (FR03). */
export async function updateBrand(actor: Actor, ws: string, input: unknown) {
  const p = BrandPatch.parse(input);
  return withScope(actor, ws, async (tx) => {
    const cur = await one(tx, "select * from brand_profiles where workspace_id = $1 order by version desc limit 1 for update", [ws]);
    if (cur.version !== p.expectedVersion) throw new AppError("VERSION_CONFLICT", "Brand profile changed", { currentVersion: cur.version });
    const next = await one(tx,
      `insert into brand_profiles (workspace_id, version, business_description, audience, offer, voice_rules, prohibited_claims, website, colors, approved_urls)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [ws, cur.version + 1, p.businessDescription ?? cur.business_description, p.audience ?? cur.audience, p.offer ?? cur.offer,
        p.voiceRules ?? cur.voice_rules, p.prohibitedClaims ?? cur.prohibited_claims, p.website === undefined ? cur.website : p.website || null, cur.colors, cur.approved_urls]);
    await audit(tx, ws, actor, "brand.updated", next.id, { version: next.version });
    return next;
  });
}

export const CreateCampaign = z.object({
  name: z.string().trim().min(1).max(120),
  objective: z.string().max(1000).default(""),
  brief: z.string().max(4000).default(""),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
});

export async function createCampaign(actor: Actor, ws: string, input: unknown) {
  const v = CreateCampaign.parse(input);
  return withScope(actor, ws, async (tx) => {
    const ws_ = await one(tx, "select status from workspaces where id = $1", [ws]);
    if (ws_.status !== "active") throw new AppError("FORBIDDEN", "Workspace is not active");
    const bp = await one(tx, "select max(version) as v from brand_profiles where workspace_id = $1", [ws]);
    const c = await one(tx, "insert into campaigns (workspace_id, brand_profile_version, name, objective, brief, start_date, end_date) values ($1,$2,$3,$4,$5,$6,$7) returning *",
      [ws, bp.v, v.name, v.objective, v.brief, v.startDate ?? null, v.endDate ?? null]);
    await audit(tx, ws, actor, "campaign.created", c.id);
    return c;
  });
}
