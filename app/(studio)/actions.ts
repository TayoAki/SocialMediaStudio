"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { appMode } from "@/src/config";
import { AppError } from "@/src/domain/errors";
import { studio } from "./context";
import { requireActor, setSession, clearSession } from "@/src/security/session";
import { ensureUser, createWorkspace, createCampaign, updateBrand } from "@/src/application/workspaces";
import { updateVariant, createPost } from "@/src/application/posts";
import { approve } from "@/src/application/approvals";
import { submitApproval, reschedule, cancelDelivery, resolveOperation } from "@/src/application/deliveries";
import { connectProvider, setAccountAllowed, disconnect } from "@/src/application/connections";
import { postMessage, cancelPlan } from "@/src/application/conversation";
import { uploadAsset } from "@/src/application/assets";
import { processOutbox, pollDelivery } from "@/src/workflows/executor";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string; code?: string };

/** In fixture mode the worker runs inline after a mutation so the demo is self-contained. */
async function kick() {
  if (appMode() === "fixture") while ((await processOutbox()) > 0);
}

async function run(fn: () => Promise<string | void>, path = "/"): Promise<ActionResult> {
  try {
    const message = await fn();
    await kick();
    revalidatePath(path, "layout");
    return { ok: true, message: message || undefined };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message, code: e.code };
    if (e && typeof e === "object" && "issues" in e) return { ok: false, error: "Please check the highlighted fields", code: "INVALID_INPUT" };
    console.error(e);
    return { ok: false, error: "Something went wrong. Nothing was published." };
  }
}

const s = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function signInFixture() {
  if (appMode() !== "fixture") throw new Error("Fixture sign-in disabled");
  const userId = await ensureUser("fixture-owner", "owner@fixture.invalid");
  await setSession(userId);
  redirect("/");
}
export async function signOut() { await clearSession(); redirect("/sign-in"); }

export async function createWorkspaceAction(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const actor = await requireActor();
  let id = "";
  const r = await run(async () => { id = await createWorkspace(actor, { name: s(f, "name"), timezone: s(f, "timezone") }); });
  if (r.ok) { (await cookies()).set("sas_ws", id, { httpOnly: true, sameSite: "lax", path: "/" }); redirect("/settings?tab=brand"); }
  return r;
}

export async function switchWorkspace(f: FormData) {
  (await cookies()).set("sas_ws", s(f, "id"), { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/");
}

export async function createCampaignAction(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const { actor, ws } = await studio();
  return run(async () => { await createCampaign(actor, ws, { name: s(f, "name"), objective: s(f, "objective"), brief: s(f, "brief") }); return "Campaign created"; });
}

export async function saveBrand(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const { actor, ws } = await studio();
  return run(async () => {
    await updateBrand(actor, ws, {
      expectedVersion: Number(s(f, "version")), businessDescription: s(f, "business"), audience: s(f, "audience"), offer: s(f, "offer"),
      voiceRules: s(f, "voice"), prohibitedClaims: s(f, "prohibited"), website: s(f, "website"),
    });
    return "Brand profile saved as a new version";
  });
}

export async function sendMessage(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const { actor, ws } = await studio();
  return run(async () => { await postMessage(actor, ws, { campaignId: s(f, "campaignId"), clientMessageId: s(f, "clientMessageId") || randomUUID(), text: s(f, "text") }); }, "/agents");
}
export async function stopPlan(f: FormData) {
  const { actor, ws } = await studio();
  await run(async () => { await cancelPlan(actor, ws, s(f, "planId")); }, "/agents");
}

export async function newManualPost(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const { actor, ws } = await studio();
  let variantId = "";
  const r = await run(async () => {
    const out = await createPost(actor, ws, { campaignId: s(f, "campaignId"), concept: s(f, "concept"), variants: [{ platform: s(f, "platform"), caption: s(f, "caption") }] });
    variantId = out.variantIds[0];
  }, "/posts");
  if (r.ok) redirect(`/posts/${variantId}`);
  return r;
}

export async function saveVariant(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const { actor, ws } = await studio();
  return run(async () => {
    let assetId: string | undefined;
    const file = f.get("image");
    if (file instanceof File && file.size > 0) {
      assetId = (await uploadAsset(actor, ws, Buffer.from(await file.arrayBuffer()), f.get("rights") === "on")).assetId;
    }
    await updateVariant(actor, ws, s(f, "variantId"), { expectedVersion: Number(s(f, "version")), caption: s(f, "caption"), altText: s(f, "altText"), ...(assetId ? { assetId } : {}) });
    return "Saved as a new revision";
  }, "/posts");
}

export async function approveAndSchedule(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const { actor, ws } = await studio();
  return run(async () => {
    const offset = s(f, "offset");
    const { approvalId } = await approve(actor, ws, {
      variantId: s(f, "variantId"), expectedVersion: Number(s(f, "version")), accountIds: f.getAll("accountIds").map(String),
      localTime: s(f, "localTime"), ...(offset ? { offsetMinutes: Number(offset) } : {}),
    });
    await submitApproval(actor, ws, { approvalId });
    return "Approved and sent to the provider. It shows Scheduled only once the provider confirms.";
  }, "/posts");
}

export async function rescheduleAction(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const { actor, ws } = await studio();
  return run(async () => {
    await reschedule(actor, ws, s(f, "deliveryId"), { expectedVersion: Number(s(f, "version")), localTime: s(f, "localTime") });
    return "Change requested. The current time stays active until the provider confirms.";
  }, "/calendar");
}
export async function cancelAction(f: FormData) {
  const { actor, ws } = await studio();
  await run(async () => { await cancelDelivery(actor, ws, s(f, "deliveryId"), { expectedVersion: Number(s(f, "version")) }); }, "/calendar");
}
export async function refreshStatus(f: FormData) {
  const { ws } = await studio();
  await run(async () => { await pollDelivery(ws, s(f, "deliveryId")); }, "/calendar");
}
export async function resolveAction(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const { actor, ws } = await studio();
  return run(async () => {
    await resolveOperation(actor, ws, s(f, "operationId"), { resolution: s(f, "resolution"), submissionId: s(f, "submissionId") || undefined, scheduleId: s(f, "scheduleId") || undefined, evidence: s(f, "evidence") });
    return "Reconciliation recorded";
  }, "/calendar");
}

export async function connectAction(_: ActionResult | null, f: FormData): Promise<ActionResult> {
  const { actor, ws } = await studio();
  return run(async () => {
    const r = await connectProvider(actor, ws, { provider: s(f, "provider"), secret: s(f, "secret") });
    return r.readyToPublish ? `Connected. ${r.accounts} account(s) found — add them to the allowlist.` : "Key works but lists zero accounts, so it cannot publish yet.";
  }, "/accounts");
}
export async function toggleAccount(f: FormData) {
  const { actor, ws } = await studio();
  await run(async () => { await setAccountAllowed(actor, ws, s(f, "accountId"), s(f, "allowed") === "true"); }, "/accounts");
}
export async function disconnectAction(f: FormData) {
  const { actor, ws } = await studio();
  await run(async () => { await disconnect(actor, ws, s(f, "connectionId")); }, "/accounts");
}
