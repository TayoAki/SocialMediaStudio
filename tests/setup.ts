import { Client } from "pg";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

export const ADMIN = process.env.TEST_DATABASE_ADMIN_URL ?? "postgres://studio_admin:admin@localhost/studio_test";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://app_runtime:app_runtime@localhost/studio_test";
process.env.APP_MODE = "fixture";
process.env.APP_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.LOCAL_STORAGE_DIR = path.join(__dirname, "..", ".data", "test-objects");

export async function resetDb() {
  const c = new Client({ connectionString: ADMIN });
  await c.connect();
  await c.query("drop schema if exists public cascade; drop schema if exists app cascade; create schema public;");
  for (const f of readdirSync(path.join(__dirname, "..", "migrations")).filter((f) => f.endsWith(".sql")).sort())
    await c.query(readFileSync(path.join(__dirname, "..", "migrations", f), "utf8"));
  await c.end();
}

export async function adminQuery(sql: string, params: unknown[] = []) {
  const c = new Client({ connectionString: ADMIN });
  await c.connect();
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
}
