import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireActor } from "@/src/security/session";
import { myWorkspaces } from "@/src/application/workspaces";

/** Resolve actor + selected workspace. Membership is re-verified by every service call. */
export async function studio() {
  const actor = await requireActor();
  const all = await myWorkspaces(actor);
  if (!all.length) redirect("/welcome");
  const chosen = (await cookies()).get("sas_ws")?.value;
  const ws = all.find((w) => w.id === chosen) ?? all[0];
  return { actor, ws: ws.id, workspace: ws, workspaces: all };
}
