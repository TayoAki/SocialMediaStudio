import { randomUUID } from "node:crypto";
import { inspectImage } from "@/src/security/upload";
import { storage } from "@/src/providers/media/storage";
import { audit, one, withScope, type Actor, type Tx } from "@/src/data/db";
import { AppError } from "@/src/domain/errors";

/** Decode/verify actual bytes, store privately, register immutable asset metadata (FR17, FR19). */
export async function registerAssetTx(tx: Tx, actor: Actor, ws: string, bytes: Buffer, meta: { origin: "upload" | "generated"; provider?: string; params?: object; rightsAttested: boolean }) {
  const img = inspectImage(bytes);
  const key = `${ws}/${randomUUID()}.${img.mime.split("/")[1]}`;
  await storage().put(key, bytes);
  const a = await one(tx,
    `insert into assets (workspace_id, storage_key, mime, width, height, bytes, checksum, origin, provider, generation_params, rights_attested)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [ws, key, img.mime, img.width, img.height, img.bytes, img.checksum, meta.origin, meta.provider ?? null, meta.params ?? null, meta.rightsAttested]);
  await audit(tx, ws, actor, "asset.registered", a.id, { origin: meta.origin, mime: img.mime });
  return { assetId: a.id as string, ...img };
}

export async function uploadAsset(actor: Actor, ws: string, bytes: Buffer, rightsAttested: boolean) {
  if (!rightsAttested) throw new AppError("INVALID_INPUT", "Confirm you have the rights to use this image");
  return withScope(actor, ws, (tx) => registerAssetTx(tx, actor, ws, bytes, { origin: "upload", rightsAttested }));
}

export async function readAsset(actor: Actor, ws: string, assetId: string) {
  const a = await withScope(actor, ws, (tx) => one(tx, "select storage_key, mime from assets where id = $1 and workspace_id = $2", [assetId, ws]));
  return { bytes: await storage().get(a.storage_key), mime: a.mime as string };
}
