# Social Agent Studio (provisional name)

Turns a brand brief into researched, editable social posts, gets approval for the **exact** content, media, accounts and time, schedules approved revisions with the provider, and reports only provider-confirmed outcomes. Built against `PRD.md` v1.0 (private, invite-only beta).

**Status: fixture-mode vertical slice (M1–M4 core).** Everything runs locally with no credentials. No real publishing, research or AI calls have been made. See [docs/M0-BLOCKERS.md](docs/M0-BLOCKERS.md) for what must be proven before connected beta.

## Layout

Left icon rail → sidebar (workspace switcher + campaigns) → tabbed main content → right sidebar (agent office + activity) → bottom status bar (mode, timezone, attention count). On phones the sidebar and office collapse into disclosure panels and the calendar uses the agenda view.

## Run locally

Requires Node 22 and PostgreSQL 16.

```bash
npm install
cp .env.example .env.local     # set APP_MODE=fixture, DATABASE_URL (app_runtime), DATABASE_ADMIN_URL, APP_ENCRYPTION_KEY (openssl rand -base64 32)
npm run db:migrate             # uses DATABASE_ADMIN_URL; creates the app_runtime role (local password app_runtime — change it outside dev)
npm run dev                    # http://localhost:3000 → "Continue as fixture owner"
```

In fixture mode the outbox worker runs inline after each action. `npm run outbox:sweep` runs the standalone worker loop (outbox, stale-operation sweep, status polling).

Fixture demo: create a workspace → Settings › Brand → Settings › Campaigns → Accounts › Connections (provider “Fixture”, any key) → allow accounts → Agents: *“Create two Instagram image posts for our coffee-shop opening, one tomorrow and one the following day at 8am”* → Posts → approve → Calendar.

## Tests

```bash
createdb studio_test   # owned by an admin role; see tests/setup.ts for the URLs
npm test               # 34 tests: domain units + acceptance tests against real Postgres via the non-bypass runtime role
npm run typecheck
```

## Structure

```
app/                 pages (App Router) and server actions; every action calls an authorized service
components/          shell pieces: Tabs, Office (original SVG art), forms
src/domain/          state machines (delivery, task), approval digest, DST-safe time, plan validation, metrics rules
src/application/     authorized use cases (workspaces, posts, approvals, deliveries, connections, conversation, budget)
src/data/db.ts       withScope(): transaction-local tenant scope for RLS
src/agents/          coordinator/researcher/creator contracts, fixture agents, OpenAI coordinator, durable plan runner
src/providers/       publishing (Blotato + fixture with fault injection), media storage, fixture image
src/workflows/       operation executor, outbox processing, stale sweep, status polling
src/security/        session, AES-GCM secrets, upload byte inspection, SSRF guard
migrations/          versioned SQL incl. RLS policies and narrow SECURITY DEFINER helpers
docs/                checklist, decisions, blockers, runbooks
```
