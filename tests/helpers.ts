import { DateTime } from "luxon";
import { ensureUser, createWorkspace, createCampaign } from "@/src/application/workspaces";
import { connectProvider, listConnections, setAccountAllowed } from "@/src/application/connections";
import { createPost } from "@/src/application/posts";
import { uploadAsset } from "@/src/application/assets";
import { fixturePng } from "@/src/providers/media/fixtureImage";
import { fixturePublisher } from "@/src/providers/publishing/fixture";

export async function world(name = "a", tz = "Europe/London") {
  const userId = await ensureUser(`sub-${name}-${Math.random()}`, `${name}@example.test`);
  const actor = { kind: "user" as const, userId };
  const ws = await createWorkspace(actor, { name: `WS ${name}`, timezone: tz });
  const campaign = await createCampaign(actor, ws, { name: "Opening" });
  await connectProvider(actor, ws, { provider: "fixture", secret: "fixture-key-123" });
  const { accounts } = await listConnections(actor, ws);
  for (const a of accounts) await setAccountAllowed(actor, ws, a.id, true);
  const ig = accounts.find((a: any) => a.platform === "instagram")!.id as string;
  const li = accounts.find((a: any) => a.platform === "linkedin")!.id as string;
  return { actor, ws, campaignId: campaign.id as string, ig, li };
}

export async function igDraft(w: Awaited<ReturnType<typeof world>>, caption = "Grand opening tomorrow") {
  const asset = await uploadAsset(w.actor, w.ws, fixturePng(caption, 64), true);
  const { variantIds } = await createPost(w.actor, w.ws, { campaignId: w.campaignId, concept: "Opening", variants: [{ platform: "instagram", caption, assetId: asset.assetId }] });
  return variantIds[0];
}

export function futureLocal(tz: string, days = 2, hour = 8) {
  return DateTime.now().setZone(tz).plus({ days }).set({ hour, minute: 0 }).toFormat("yyyy-LL-dd'T'HH:mm");
}

export function resetFixture() {
  const f = fixturePublisher();
  f.jobs.clear(); f.faults = []; f.calls = [];
  return f;
}
