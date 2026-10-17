# Implementation decisions

- **Plain `pg` instead of Drizzle** for the DAL: keeps the RLS `set_config` contract explicit and visible in one place (`src/data/db.ts`). Revisit if query volume grows.
- **Scope model**: `app.in_scope(workspace_id)` = matches `app.workspace_id` AND (actor is member OR actor kind is worker/cleanup). Worker scope is derived from the persisted outbox event, never from client input. `FORCE ROW LEVEL SECURITY` is on every tenant table.
- **Approval = tuple digest** (sha256 of canonical JSON: revision, caption, alt text, asset checksum, sorted account IDs, local time, zone, UTC). Re-computed from current rows at submission.
- **One operation per (kind, delivery, schedule generation)** via unique `logical_key`; this — not event dedupe — is the duplicate-post safeguard.
- **in_flight before the call**: a crash between commit and response is detectable and becomes `outcome_unknown`, never an automatic resend.
- **Reschedule confirmation records a new consumed approval** of the new schedule tuple (FR23).
- **OpenAI via Responses API fetch** rather than the Agents SDK for now: fewer moving parts until the M0 model/SDK pin. The coordinator still sits behind the `Coordinator` interface.
- **Fixture worker runs inline** after server actions so the demo needs no extra process. Connected mode must use a real worker.
- **Notifications are derived** from persisted state at read time rather than stored.
