import { processOutbox, sweepStaleOperations, pollDelivery } from "@/src/workflows/executor";
import { getPool, closePool } from "@/src/data/db";

/** Local worker loop (stand-in for Inngest cron in fixture/dev): outbox, stale ops, due polls. */
async function tick() {
  await sweepStaleOperations();
  while ((await processOutbox()) > 0);
  const due = (await getPool().query("select * from app.due_polls(300)")).rows;
  for (const d of due) await pollDelivery(d.workspace_id, d.delivery_id).catch(() => {});
}

const once = process.argv.includes("--once");
(async () => {
  do { await tick(); if (!once) await new Promise((r) => setTimeout(r, 5000)); } while (!once);
  await closePool();
})();
