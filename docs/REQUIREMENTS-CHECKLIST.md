# Requirements → implementation → test

Legend: ✅ implemented + tested · 🟡 implemented, fixture-only or untested path · ⛔ blocked on M0 · ⬜ not started

## Acceptance matrix

| Test | Status | Where |
|---|---|---|
| AT01 Tenant isolation | ✅ | tests/acceptance.test.ts (direct ID, forged scope, raw SQL as runtime role) |
| AT02 Auth lifecycle | ⛔ | InsForge session bridge not built; fixture HMAC cookie only |
| AT03 Duplicate messages | ✅ | `postMessage` + unique (workspace, clientMessageId, role) |
| AT04 Plan validation | ✅ | `validatePlan` — cycles, tools, foreign accounts, fan-out |
| AT05 Research integrity | 🟡 | Fixture researcher reports uncertainty; live research adapter ⛔ |
| AT06 Worker restart | ✅ | in_flight committed before call; sweeper → outcome_unknown; replay no-op |
| AT07 Follow-up race | ✅ | expectedVersion on creator commit → STALE_OUTPUT, kept as obsolete |
| AT08 Approval binding | ✅ | revision bump invalidates; digest recheck at submission |
| AT09 Double approval/schedule | ✅ | approval row lock + unique logical operation key |
| AT10 Ambiguous create | ✅ | lost response → needs_reconciliation; operator attach |
| AT11 Failed reschedule | ✅ | old time preserved until provider confirms |
| AT12 Cancel race | ✅ | 404 on cancel → reconciliation, then poll shows published |
| AT13 Partial delivery | ✅ | per-destination operations |
| AT14 Connection loss | ✅ | auth error → needs_connection; disconnect requests cancels |
| AT15 Media lifetime | ⛔ | requires connected Blotato upload/fetch timing test |
| AT16 Calendar time (DST) | ✅ | `resolveLocalTime` gap/overlap tests |
| AT17 Rate/budget limit | ✅ | 429 → delayed requeue; budget cap reservation |
| AT18 Upload security | ✅ | magic-byte inspection, pixel cap, SVG rejected |
| AT19 Prompt injection | 🟡 | scope/tools enforced server-side; SSRF guard unit-tested; no red-team suite yet |
| AT20 Status honesty | ✅ | in-progress → processing, published only on definitive status |
| AT21 Analytics absence | ✅ | `displayMetric` never renders zero for unavailable |
| AT22 Interface recovery | 🟡 | all UI state is persisted & re-read; no browser reload test yet |
| AT23 Accessibility | 🟡 | labelled inputs, 44px targets, reduced motion, agenda alternative; no axe run yet |
| AT24 Cleanup | ⬜ | workspace deletion not built (M5) |
| AT25 Secrets | 🟡 | encryption + redaction tested; no bundle scan yet |
| AT26 Live proof | ⛔ | needs authorized Blotato account |
| AT27/28 | ⬜ | P1/P2 |
| AT29 Missed deadline | ✅ | needs_rescheduling, no catch-up |
| AT30 Batch approval | ✅ | concurrent double submit, both destinations once |
| AT31 Budget recovery | ✅ | atomic reservation under concurrency; logical-key replay |
| AT32 Late generation | 🟡 | `stillWanted` check before commit; no dedicated test |
| AT33 Connection rotation | 🟡 | new connection supersedes; old accounts keep identity; no test |
| AT34 Scoped SQL | ✅ | transaction-local `set_config`, pooled reuse check, non-bypass role asserted |

## Functional requirements not yet covered

FR01 (InsForge auth) ⛔ · FR05 ⬜ (P1) · FR07 live research ⛔ · FR18 ImageKit ⛔ (fixture PNG generator used) · FR32 ⬜ (P1) · FR36 metric sync ⛔ · FR37 export ⬜ · FR38 deletion ⬜ · FR39 in-app derived notifications 🟡 (not persisted).
