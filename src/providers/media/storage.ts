import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { appMode } from "@/src/config";

/**
 * Private object storage. Local filesystem implementation for fixture/dev mode only;
 * InsForge storage is the connected target and is an open M0 item (docs/M0-BLOCKERS.md).
 */
export interface ObjectStorage { put(key: string, bytes: Buffer): Promise<void>; get(key: string): Promise<Buffer> }

class LocalStorage implements ObjectStorage {
  constructor(private root = process.env.LOCAL_STORAGE_DIR ?? path.join(process.cwd(), ".data", "objects")) {}
  private p(key: string) {
    if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..")) throw new Error("bad storage key");
    return path.join(this.root, key);
  }
  async put(key: string, bytes: Buffer) { await mkdir(path.dirname(this.p(key)), { recursive: true }); await writeFile(this.p(key), bytes); }
  async get(key: string) { return readFile(this.p(key)); }
}

export function storage(): ObjectStorage {
  if (appMode() === "connected") throw new Error("Connected private storage (InsForge) is not configured yet; see docs/M0-BLOCKERS.md");
  return new LocalStorage();
}
