# M0 / connected-beta blockers

Nothing below has been exercised against a real service. Connected mode (`APP_MODE=connected`) refuses rather than falling back to fixtures.

1. **InsForge session bridge** — `src/security/session.ts` only supports the fixture cookie. Needs the pinned InsForge SDK's server session verification, refresh, logout, reset and OAuth callback tests (AT02).
2. **InsForge Postgres role path** — RLS design is proven on local Postgres 16 with a non-bypass `app_runtime` role and transaction-local `set_config`. Must be re-proven on the hosted InsForge project (role creation rights, pooler behaviour with `set_config(..., true)`, SECURITY DEFINER helpers). If unsupported, an architecture amendment is required — do not substitute admin queries.
3. **Private storage** — `src/providers/media/storage.ts` is local filesystem for fixture mode; InsForge storage adapter not written.
4. **Blotato contract** — `src/providers/publishing/blotato.ts` follows docs read 2026-10-17 but response field names (`items`, `postSubmissionId`, schedules listing fields, `publicUrl`) are unverified. Capture real fixtures for accounts, create, status, schedules list/patch/delete, uploads and 429 behaviour. Confirm BYOK commercial terms.
5. **Schedule ID linkage** — matching by account + exact time + text is a heuristic; zero/multiple matches leave edit/cancel blocked pending reconciliation.
6. **Media fetch timing** (AT15) — when Blotato fetches uploaded media for a future schedule, and for how long `publicUrl` stays valid.
7. **Models / research / media generation** — OpenAI coordinator exists but is untested and needs a pinned model; Firecrawl and ImageKit adapters not written. Fixture agents are deterministic and clearly labelled.
8. **Inngest** — outbox/executor are plain functions run inline (fixture) or by `scripts/sweep.ts`. Wiring them as Inngest functions with stable step IDs is pending.
9. **Analytics sync** — no metric snapshot ingestion yet; UI shows availability only.
10. **Rights** — office art is original SVG in `components/Office.tsx`; no tutorial assets are used.
