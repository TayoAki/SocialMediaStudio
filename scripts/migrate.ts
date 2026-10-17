import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

// Uses DATABASE_ADMIN_URL only. Applies migrations/*.sql in order, once each.
export async function migrate(url = process.env.DATABASE_ADMIN_URL) {
  if (!url) throw new Error("DATABASE_ADMIN_URL is required");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())");
    const dir = path.join(__dirname, "..", "migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      const done = await client.query("select 1 from schema_migrations where name = $1", [file]);
      if (done.rowCount) continue;
      await client.query("begin");
      await client.query(readFileSync(path.join(dir, file), "utf8"));
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`applied ${file}`);
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) migrate().catch((e) => { console.error(e); process.exit(1); });
