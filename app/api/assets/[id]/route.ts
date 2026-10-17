import { requireActor } from "@/src/security/session";
import { readAsset } from "@/src/application/assets";
import { studio } from "@/app/(studio)/context";

/** Authorized private asset read. Workspace scope + RLS apply; nothing is publicly addressable. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireActor();
  const { actor, ws } = await studio();
  try {
    const { bytes, mime } = await readAsset(actor, ws, (await params).id);
    return new Response(new Uint8Array(bytes), { headers: { "content-type": mime, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
