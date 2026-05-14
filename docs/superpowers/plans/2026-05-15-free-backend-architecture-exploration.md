# Free Backend Architecture Exploration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:writing-plans` for any follow-up implementation plan. This document is a decision and architecture exploration plan; do not implement backend code directly from it until the `DISCUSS WITH USER` points are resolved.

**Goal:** Select a backend architecture for Talented EasyOrder that can stay completely free for the first production campus deployment while preserving local-first POS service, accounting integrity, multi-device sync, and future iPad face handoff.

**Architecture:** Keep the PC POS local-first: domain writes commit to Zustand/localStorage first, then a durable queue flushes to a remote transport. Replace the current Phase 1.3 assumption that Google Sheets is the only persistence backend with a transport-neutral sync layer, then choose the cheapest reliable remote authority. Google Sheets can remain an export, audit, or migration surface when it is not the primary backend.

**Tech Stack:** Current frontend is Vite 8, React 19, TypeScript 6, Zustand 5, Vitest 4. Candidate backends evaluated: Cloudflare Workers + D1, Supabase, Neon Free, Firebase Spark, Appwrite Cloud, Turso/libSQL, PocketBase on free hosting, and Google Sheets API.

---

## Required Reads Completed

- `docs/superpowers/plans/ROADMAP.md`
- `docs/superpowers/plans/2026-05-14-phase-1-2-reporting-and-settlement.md`
- `docs/superpowers/plans/2026-05-14-phase-1-3-google-sheets-sync-offline.md`
- `docs/superpowers/specs/2026-05-14-google-sheets-sync-offline-spec.md`
- `docs/iPad人臉辨識訂餐系統設計方案_V3.pdf`
- `frontend/src/` domain, store, and screen files

## Official Provider Sources Checked On 2026-05-15

- Supabase pricing: https://supabase.com/pricing.md
- Firebase pricing and Spark quota behavior: https://firebase.google.com/pricing
- Cloudflare Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare Workers platform limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Workers Static Assets billing and limits: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- Cloudflare D1 limits and pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Neon pricing: https://neon.com/pricing
- Neon plans: https://neon.com/docs/introduction/plans
- Google Sheets API usage limits: https://developers.google.com/workspace/sheets/api/limits
- Appwrite pricing: https://appwrite.io/pricing
- Turso pricing: https://turso.tech/pricing
- PocketBase overview: https://pocketbase.io/docs/
- PocketBase going-to-production caveat: https://pocketbase.io/docs/going-to-production/

## Current Product Constraints

1. The PDF's Phase 1 requirement says PC web POS is the immediate priority, and the PC is the accounting authority for search, order, top-up, refund/cancel, and daily cash settlement.
2. The PDF names three accounting sheets: student master, transaction ledger, and daily settlement summary. It also requires no paper receipts, all transactions digitally recorded, daily cash reconciliation, and zero-maintenance migration when old forms grow too large.
3. Phase 2 iPad face recognition is only an input sensor. It must not show balance, debt, payment amount, or transaction history.
4. The current frontend is pure frontend. `usePosStore` persists students, vendors, today's menu, and ledger transactions through Zustand localStorage.
5. `App.tsx` currently fakes `online`, `syncing`, and `lastSync`; there is no remote health check, no durable remote queue, and no real sync transport.
6. Phase 1.2 creates the accounting boundary that Phase 1.3 consumes: transactions, audit events, cash close/reopen, CSV/print, and settlement payloads.
7. The existing Phase 1.3 plan already has the right local-first queue shape: stable ids, idempotency keys, dependency ordering, fake transport tests, retry/backoff, failed/conflict states, restore preview, and migration preview.
8. The current Phase 1.3 plan's weakest assumption is not local-first design. It is treating Google Sheets/Apps Script as the default remote authority before confirming the user's new hard requirement that the backend must be completely free.

## Evaluation Criteria

| Criterion | What Good Looks Like For EasyOrder |
|---|---|
| Free ceiling | No automatic paid overage under the selected strict-free configuration. Provider must either avoid requiring a credit card/billing account or document a hard-stop/no-overage behavior. Quota exhaustion must fail predictably, not silently bill or corrupt the ledger. |
| Frontend integration | TypeScript-friendly client or HTTP API; no privileged secret in frontend; works from Vite app. |
| Offline-first | Local commit remains authoritative; remote outage cannot block lunch service; queue can retry idempotently. |
| Student privacy | Student identity, balance, order history, and future face metadata are protected by server-side access rules or a backend proxy. |
| Multi-device sync | PC and iPad can observe the same student/menu/order state without using spreadsheet row numbers as identity. |
| Maintenance | Migrations, deployment, backup, auth, and incident recovery are realistic for a small operator. |
| Migration path | Existing localStorage data and old Google Sheet/form data can be previewed, imported, and audited. |

## Executive Recommendation

### Primary Recommendation: Cloudflare Workers + D1

Choose Cloudflare Workers + D1 as the primary free backend if the user accepts moving the remote accounting authority away from Google Sheets. It fits a small campus POS better than Sheets because it gives a real HTTP API, SQL tables, server-side secrets, deterministic migrations, and hard free-tier limits instead of spreadsheet scripting behavior.

Recommended target architecture:

```text
React/Zustand local commit
  -> durable SyncQueueEntry in localStorage
  -> Cloudflare Worker HTTPS API
  -> D1 SQL tables: students, vendors, menus, transactions, settlements, sync_events
  -> optional exports: CSV and Google Sheets-compatible accounting snapshots
```

Why this is the best zero-cost default:

- Cloudflare Workers Free allows 100,000 requests per day, which is far above a single campus POS workload.
- Worker dynamic/API requests and Worker Static Assets are separate. Static asset requests are free and unlimited, while API/SSR requests count against Workers pricing and request limits.
- Worker Static Assets supports 20,000 asset files per Worker version on Free and 100,000 on Paid, with a 25 MiB individual file limit. This matters only if frontend assets are hosted through Workers Static Assets instead of Cloudflare Pages.
- D1 Free includes 5 GB storage, 5 million row reads per day, and 100,000 row writes per day.
- D1 documents that operations fail when daily limits are exceeded, which is safer than automatic paid overage for a strict free requirement.
- Worker code keeps privileged write logic server-side. The browser only talks to the Worker API.
- SQL tables fit the ledger, settlement, idempotency, and restore model better than document or spreadsheet storage.
- The existing Phase 1.3 fake-transport and queue plan can be kept with a new `cloudflare_d1` adapter.

Main tradeoff:

- Cloudflare D1 does not provide Firebase/Supabase-style realtime by default. For this product, polling or explicit sync cycles are acceptable unless the user requires sub-second PC/iPad state updates.

### Secondary Recommendation: Supabase Free Tier

Choose Supabase if the user wants a managed Postgres UI, built-in Auth, Realtime, and faster admin tooling, and accepts the Free plan's 500 MB database, 5 GB egress, 50,000 monthly active users, and pause-after-inactivity policy.

Why Supabase is a strong fallback:

- Postgres fits the ledger and settlement data model.
- Row Level Security can protect student/accounting data better than a direct browser spreadsheet integration.
- Realtime can simplify PC/iPad status updates.
- Supabase's API and SDK are easy to integrate with React/TypeScript.

Main tradeoff:

- The free database is smaller than D1's free storage, free projects can pause after inactivity, and production backups/operational controls are less comfortable on a hard-free plan.

### Conditional Recommendation: Google Sheets API Only If Sheets Must Remain The Legal Accounting Surface

Keep Google Sheets as the primary remote store only if the user explicitly says the spreadsheet itself must remain the legal/accounting source of truth. If that is required, keep the existing Phase 1.3 plan mostly intact but avoid direct browser writes. Use an Apps Script web app or Cloudflare Worker proxy so privileged writes and idempotency checks do not live in the browser.

## Candidate Evaluation

### 1. Cloudflare D1 + Workers Free Tier

| Dimension | Evaluation |
|---|---|
| Free limits | Workers Free dynamic/API quota: 100,000 requests/day and 10 ms CPU time per invocation. Worker Static Assets are a separate hosting surface: static asset requests are free and unlimited, there is no additional asset storage cost, Free allows 20,000 static asset files per Worker version, Paid allows 100,000, and each static asset file can be up to 25 MiB. D1 Free: 5 GB storage, 5 million row reads/day, 100,000 row writes/day. D1 returns errors once daily limits are exceeded. |
| Integration difficulty | Medium. Add a `worker/` or `backend/cloudflare-worker/` package, D1 migrations, Worker API routes, and a frontend transport adapter. This is more setup than Supabase, but simpler than operating a VM. |
| Offline-first support | Strong when paired with the existing planned durable queue. The Worker is only a flush target; POS local commit remains independent. |
| Student privacy | Stronger than direct Sheets because the Worker can enforce operator/session authorization and keep admin tokens server-side. Cloudflare account ownership and access policy must be documented. |
| Multi-device sync | Good. PC and iPad can read/write through the same API. Use polling, health checks, or a sync endpoint before adding realtime infrastructure. |
| Maintenance cost | Moderate. Requires Wrangler, D1 migrations, seed/backup scripts, and deployment ownership. No server patching. |
| Migration path | LocalStorage rows map to SQL tables. Old Google Sheets/form rows import through the same preview/validator path, then write to D1 with migration batch ids. |
| Verdict | **Best primary option** for hard-free hosted backend plus accounting-grade data model. |

### 2. Supabase Free Tier

| Dimension | Evaluation |
|---|---|
| Free limits | Free plan includes unlimited API requests, 50,000 monthly active users, 500 MB database size, 5 GB egress, 5 GB cached egress, 1 GB file storage, and 2 active projects. Free projects pause after 1 week of inactivity. |
| Integration difficulty | Low to medium. Use `@supabase/supabase-js`, SQL migrations, RLS policies, and possibly Edge Functions for privileged write/repair operations. |
| Offline-first support | Good with custom local queue. Supabase Realtime is useful after sync succeeds, but it does not replace local-first queue/idempotency. |
| Student privacy | Good if RLS is written and tested carefully. Bad if the frontend uses broad anon-key access without restrictive policies. |
| Multi-device sync | Strong. Realtime can update PC/iPad views quickly. |
| Maintenance cost | Low to moderate. No server maintenance, but RLS, migrations, free project pause, backups, and quota monitoring need ownership. |
| Migration path | LocalStorage and old Sheets data import into Postgres tables. SQL constraints can enforce ledger invariants. |
| Verdict | **Best secondary option** when managed Postgres/Auth/Realtime matters more than maximum free storage and hard no-pause behavior. |

### 3. Neon Free Plan: Managed Postgres

| Dimension | Evaluation |
|---|---|
| Free limits | Neon Free is $0 with no time limit and no credit card required. Current pricing lists 100 projects, 100 CU-hours monthly per project, 0.5 GB storage per project, sizes up to 2 CU, Neon Auth 60K monthly active users, 5 GB included public network transfer per month, 6-hour time travel/restores, and unlimited team members. Compute can suspend after inactivity, so first-request latency and keepalive policy must be tested rather than assumed away. |
| Integration difficulty | Medium. Postgres fits the ledger, but the browser must not hold privileged database credentials. EasyOrder would need a server-side API layer, edge function, or Worker proxy for safe writes and idempotency enforcement. |
| Offline-first support | Good with the same durable queue and idempotent flush model. Neon is the remote authority; the POS still commits locally first. |
| Student privacy | Good if access is mediated by a backend/API layer with per-session authorization and database policies. Bad if direct client credentials or broad SQL access reach the browser. |
| Multi-device sync | Medium. Postgres is a strong system of record, but Neon is not the simplest out-of-the-box realtime BaaS for PC/iPad status. Use polling or an explicit sync endpoint unless realtime becomes a hard requirement. |
| Maintenance cost | Moderate. Migrations, schema discipline, branch/restore flow, auth/session model, and API deployment ownership still need an operator. |
| Migration path | Strong. LocalStorage and old Sheets data map cleanly to Postgres tables with migration batch ids and audit tables. |
| Verdict | **Strong SQL candidate, not the primary default**. If a Worker/proxy is required anyway, Cloudflare D1 is simpler inside the Cloudflare stack; choose Neon if managed Postgres tooling or Postgres compatibility matters more than one-provider simplicity. |

### 4. Firebase Spark Plan: Firestore + Auth

| Dimension | Evaluation |
|---|---|
| Free limits | Cloud Firestore Spark includes 1 GiB stored data, 50,000 document reads/day, 20,000 document writes/day, 20,000 document deletes/day, and 10 GiB/month network egress. Spark has no-cost limits and Firebase says products stop working for the rest of the month when a no-cost quota is exceeded. Firebase Authentication has a 50,000 monthly active user no-cost tier for the relevant auth pricing family. |
| Integration difficulty | Low. Firebase SDKs are mature, and browser integration is common. |
| Offline-first support | Medium. Firestore has offline capabilities, but EasyOrder still needs an application queue because accounting idempotency, settlement close rules, and migration preview cannot be delegated to automatic document caching. |
| Student privacy | Good if Firestore Security Rules are strict and tested. Rules are easy to under-specify for accounting workflows. |
| Multi-device sync | Strong. Realtime listeners are a major strength. |
| Maintenance cost | Low for hosting; medium for rule design, document schema discipline, and read-cost control. |
| Migration path | LocalStorage maps to documents. Ledger queries and settlement aggregates need careful collection design to avoid read amplification. |
| Verdict | **Viable but not preferred**. Realtime is attractive, but document modeling and daily read/write caps are less comfortable for an auditable ledger than SQL. |

### 5. Appwrite Cloud Free Plan

| Dimension | Evaluation |
|---|---|
| Free limits | Free plan currently lists 75,000 monthly active users, 5 GB bandwidth, 2 GB storage, 750,000 function executions, 1 database, 1 bucket, 2 functions, 500,000 database reads/month, 250,000 database writes/month, and 250 realtime connections. Free projects pause after 1 week of inactivity and are limited to 2 projects. |
| Integration difficulty | Medium. Appwrite SDKs cover Auth, Databases, Storage, Functions, and Realtime, but the app must adapt to Appwrite's document model and permission system. |
| Offline-first support | Medium. EasyOrder still needs its own queue and idempotent flush. |
| Student privacy | Good if collection permissions and functions are constrained. Accounting write rules should be kept behind functions rather than broad client writes. |
| Multi-device sync | Good. Realtime is available within free limits. |
| Maintenance cost | Low to moderate. Managed service reduces ops, but quotas are monthly and smaller than Cloudflare D1 for database writes. |
| Migration path | Import localStorage and Sheets rows into Appwrite collections through previewed migration functions. |
| Verdict | **Usable alternative** when an all-in-one BaaS is desired, but less compelling than Supabase for SQL-like accounting or Cloudflare for hard-free capacity. |

### 6. Turso/libSQL Free Plan

| Dimension | Evaluation |
|---|---|
| Free limits | Turso Free currently lists 100 databases, 5 GB total storage, 500 million row reads/month, 10 million row writes/month, 3 GB syncs/month, and no credit card requirement. |
| Integration difficulty | Medium to high. SQL fits the ledger, but browser access should not hold privileged database tokens. A Worker/proxy or token broker is needed for safe production writes. |
| Offline-first support | Potentially strong because libSQL/Turso has sync-oriented positioning, but EasyOrder should still use the explicit queue/idempotency plan for accounting correctness. |
| Student privacy | Good only if write access is mediated server-side. Direct browser DB tokens are not acceptable for student/accounting data. |
| Multi-device sync | Good when paired with a safe API layer. |
| Maintenance cost | Moderate. Fewer server concerns than a VM, but a proxy/auth layer still exists. |
| Migration path | Similar to D1: localStorage and old Sheets rows become SQL rows with migration batch ids. |
| Verdict | **Interesting but not first choice**. If a Worker proxy is needed anyway, D1 is simpler in the Cloudflare stack. |

### 7. PocketBase Self-Hosted On A Free VM

| Dimension | Evaluation |
|---|---|
| Free limits | PocketBase itself is open source and combines SQLite, REST APIs, realtime subscriptions, auth, files, and an admin dashboard in one executable. Actual free limits depend entirely on the chosen free VM or hosting provider. |
| Integration difficulty | Medium. API integration is simple, but deployment, TLS, backups, monitoring, OS updates, and uptime become project responsibilities. |
| Offline-first support | Medium. EasyOrder still needs the local durable queue and idempotent sync worker. |
| Student privacy | Depends on the VM, TLS, access controls, backup discipline, and admin passwords. |
| Multi-device sync | Good for a single small deployment if the VM is stable. Realtime is built in. |
| Maintenance cost | High for a small school POS. Free VM reliability and backup ownership are the real cost. PocketBase also warns that, before v1.0, it is not recommended for critical production applications. |
| Migration path | LocalStorage and Sheets rows map to PocketBase collections, but schema migrations and rollback need custom discipline. |
| Verdict | **Not recommended** unless the operator already owns and maintains reliable hosting. It is free software, not free operations. |

### 8. Google Sheets API Direct Or Apps Script

| Dimension | Evaluation |
|---|---|
| Free limits | Sheets API usage limits are per-minute quotas: 300 read requests/minute/project, 300 write requests/minute/project, 60 read requests/minute/user/project, and 60 write requests/minute/user/project. Google recommends a 2 MB maximum payload even though there is no hard size limit. |
| Integration difficulty | Medium for Apps Script, high for direct browser OAuth writes. The current Phase 1.3 plan already rejects direct browser writes for the POS write path. |
| Offline-first support | Good only with the existing queue and idempotency layer. Sheets itself is not the queue. |
| Student privacy | Weakest if written directly from the browser. Better if Apps Script or Worker proxy enforces batch schema/idempotency, but endpoint exposure and access settings must be controlled. |
| Multi-device sync | Medium. Sheets is inspectable but not a realtime application database. Polling and batch reads are needed. |
| Maintenance cost | Low billing cost but medium operational fragility: deployment URLs, Apps Script quotas, sheet schema drift, and spreadsheet edits can break sync. |
| Migration path | Strong for old-sheet import/export because the user already has spreadsheet mental models. |
| Verdict | **Keep as export, backup, or legal spreadsheet view unless the user requires Sheets as primary.** Do not use direct browser API writes for normal POS operations. |

## Recommendation By Decision Scenario

| User Decision | Recommended Backend | Rationale |
|---|---|---|
| Must be free, hosted, no automatic paid overage, spreadsheet can become export | Cloudflare D1 + Workers | Best balance of free capacity, SQL ledger model, server-side API, and hard limit failure. |
| Must have managed Postgres/Auth/Realtime and free pause risk is acceptable | Supabase Free | Fastest high-quality BaaS path with SQL and Realtime. |
| Must have managed Postgres with no credit card and a separate API layer is acceptable | Neon Free | Strong Postgres fit and no-credit-card free plan; less integrated than D1 because EasyOrder still needs a trusted API/proxy and explicit sync/realtime design. |
| Must keep Google Sheets as legal accounting source | Apps Script or Worker proxy to Sheets | Preserves spreadsheet authority while keeping privileged write logic outside the browser. |
| Must have Firebase ecosystem familiarity or realtime-first behavior | Firebase Spark | Viable, but Firestore document modeling is less natural for accounting ledger/settlement. |
| Must be self-owned with no SaaS lock-in | PocketBase on owned hosting | Only acceptable if someone owns backups, TLS, patching, and uptime. |

## Differences From Existing Phase 1.3 Plan

### Parts To Keep Regardless Of Backend

- Local-first POS commitment: transactions, corrections, voids, and settlements commit locally before sync.
- Durable queue persisted through Zustand/localStorage.
- Stable idempotency keys using entity id plus revision or event id.
- Dependency ordering: master data before transactions, transactions before settlements, sync events after the related entity.
- Retry/backoff policy and `queued`, `retrying`, `synced`, `failed`, `conflict` statuses.
- Fake transport tests before real provider integration.
- Remote health check plus browser online/offline events.
- Restore preview/apply and old-sheet migration preview/commit.
- Failed/conflict closeout blocking rules from Phase 1.2.
- Traditional Chinese text preservation in all mappers and migrations.

### Changes If Cloudflare D1 + Workers Is Chosen

1. Rename the transport decision record from `docs/sync/google-sheets-transport-decision.md` to `docs/sync/free-backend-transport-decision.md`.
2. Replace `SheetsTransport` naming with `RemoteLedgerTransport` or keep a provider-neutral `SyncTransport` interface.
3. Replace `sheetsSchema.ts` as the remote-authority mapper with:
   - `frontend/src/domain/remoteSchema.ts` for DTO validation.
   - `worker/src/schema.ts` for D1 table definitions and API validation.
   - `worker/migrations/*.sql` for D1 tables and indexes.
4. Replace `appsScriptTransport.ts` with `cloudflareD1Transport.ts` in the frontend service layer.
5. Add Worker endpoints:
   - `POST /health`
   - `POST /sync/batch-write`
   - `GET /sync/snapshot`
   - `POST /sync/resolve-conflict`
   - `POST /migration/import-preview`
   - `POST /migration/import-commit`
6. Store only non-secret frontend config:
   - `VITE_EASYORDER_SYNC_TRANSPORT=cloudflare_d1`
   - `VITE_EASYORDER_API_BASE_URL`
   - `VITE_EASYORDER_ENVIRONMENT_LABEL`
7. Move Google Sheets schema from remote authority to export/import compatibility:
   - Keep `students`, `transactions`, `daily_settlements`, and `sync_events` column mappers as export/import adapters.
   - Do not let spreadsheet row number become identity.
8. Add Worker/D1 verification:
   - `wrangler d1 migrations list`
   - local Worker tests with a fake D1 binding or Miniflare-equivalent harness selected by the implementer.
   - frontend transport tests mocking `fetch`.
9. Add an operational runbook:
   - account owner
   - project name
   - D1 database name
   - backup/export command
   - restore drill
   - quota monitoring
   - what happens when D1 returns free-limit errors

### Changes If Supabase Is Chosen

1. Replace Apps Script adapter with `supabaseTransport.ts`.
2. Add SQL migrations for `students`, `vendors`, `menus`, `transactions`, `daily_settlements`, `sync_events`, and `sync_queue_receipts`.
3. Add RLS policies and tests that prove operators cannot read hidden iPad/face/private accounting fields they should not access.
4. Decide whether privileged batch write happens through Supabase Edge Functions or direct table writes constrained by RLS.
5. Update closeout conflict detection to compare database revisions, not spreadsheet rows.
6. Document free project inactivity behavior and a scheduled keepalive policy only if it is allowed by Supabase terms and operator policy.

### Changes If Google Sheets Remains Primary

1. Keep the current Phase 1.3 plan's Apps Script pilot path.
2. Make the decision record explicit that the backend is free but operationally fragile.
3. Reject direct Google API writes from the normal POS browser path.
4. Add a manual sheet-schema drift check before every pilot deployment.
5. Add user-facing warnings for quota exhaustion, Apps Script deployment errors, and spreadsheet permission errors.

## Proposed Follow-Up Implementation Plan If Cloudflare Is Approved

This is the likely next plan file after user decision: `docs/superpowers/plans/YYYY-MM-DD-phase-1-3-cloudflare-d1-sync-offline.md`.

Recommended task board split:

| Task ID | Title | Primary Files | Depends On |
|---|---|---|---|
| EO-P13F-T01 | Free backend decision record and provider-neutral transport contract | `docs/sync/free-backend-transport-decision.md`, `frontend/src/domain/syncTransport.ts` | Phase 1.2 |
| EO-P13F-T02 | D1 SQL schema and remote DTO validators | `worker/migrations/0001_initial.sql`, `worker/src/schema.ts`, `frontend/src/domain/remoteSchema.ts` | EO-P13F-T01 |
| EO-P13F-T03 | Durable queue, idempotency, and store migration | `frontend/src/domain/syncQueue.ts`, `frontend/src/store/posStore.ts` | EO-P13F-T02 |
| EO-P13F-T04 | Fake remote transport and sync worker lifecycle | `frontend/src/domain/syncWorker.ts`, `frontend/src/services/sync/fakeRemoteTransport.ts` | EO-P13F-T03 |
| EO-P13F-T05 | Cloudflare Worker API and D1 adapter | `worker/src/index.ts`, `worker/src/d1Repository.ts`, `frontend/src/services/sync/cloudflareD1Transport.ts` | EO-P13F-T04 |
| EO-P13F-T06 | Online/offline health and automatic reconnect flush | `frontend/src/domain/syncHealth.ts`, `frontend/src/hooks/useSyncWorker.ts`, `frontend/src/App.tsx` | EO-P13F-T05 |
| EO-P13F-T07 | Conflict detection and repair policy | `frontend/src/domain/syncConflict.ts`, `worker/src/conflicts.ts` | EO-P13F-T05 |
| EO-P13F-T08 | Restore preview/apply from D1 snapshots | `frontend/src/domain/syncRestore.ts`, `worker/src/snapshot.ts` | EO-P13F-T07 |
| EO-P13F-T09 | Old localStorage and old Google Sheets migration preview/commit | `frontend/src/domain/syncMigration.ts`, `worker/src/migration.ts` | EO-P13F-T08 |
| EO-P13F-T10 | Sync UI, closeout blocks, and export-to-Sheets-compatible CSV | `frontend/src/components/sync/*`, `frontend/src/components/screens.tsx`, `frontend/src/domain/sheetsExport.ts` | EO-P13F-T06-T09 |
| EO-P13F-T11 | Production pilot checklist and quota-failure drill | `docs/sync/cloudflare-d1-pilot-checklist.md` | EO-P13F-T10 |

## Testing And Verification Strategy For The Follow-Up Plan

| Layer | Verification |
|---|---|
| Domain queue | Idempotency key stability, dependency sort, retry/backoff, failed/conflict transitions, legacy store migration. |
| Transport interface | Fake transport contract tests and frontend `fetch` mocks for real provider adapter. |
| Worker API | Request validation, auth/session checks, idempotent duplicate batch handling, D1 transaction behavior, schema migration tests. |
| Restore/migration | Preview counts, invalid-row rejection, local-only row choices, migration batch id audit events. |
| UI integration | Top bar online/syncing/offline counts, admin repair links, closeout blocking with failed/conflict rows. |
| Operational | Pilot checklist proves one student, one transaction, one settlement, one duplicate retry, one conflict, one restore preview, and one export. |

## Decision Points For User Discussion

> ⚠️ DISCUSS WITH USER: Does “完全免費” mean “no credit card and no billing account ever,” or “can use a free tier as long as normal operation stays below quota”? This changes Cloudflare, Supabase, Neon, Firebase, Appwrite, and Turso eligibility.

> ⚠️ DISCUSS WITH USER: Must Google Sheets remain the legal/accounting source of truth, or can it become an export/backup view generated from a real database?

> ⚠️ DISCUSS WITH USER: Is the first production deployment exactly one campus/site, or should the backend design assume multiple campuses with separate data partitions from the start?

> ⚠️ DISCUSS WITH USER: Is near-realtime PC + iPad sync required, or is polling/explicit sync acceptable as long as the PC remains the transaction authority?

> ⚠️ DISCUSS WITH USER: Who owns the backend account, deployment credentials, backup exports, and restore drill? A free backend still needs an operator for production data.

> ⚠️ DISCUSS WITH USER: What student privacy boundary is required for provider region, access logs, staff accounts, and future face profile metadata? The current design should store face metadata only, not raw biometric templates, unless separately approved.

> ⚠️ DISCUSS WITH USER: For counter access, is a shared counter PIN acceptable, or does production require per-staff auth/session tracking for audit, revocation, and incident review?

> ⚠️ DISCUSS WITH USER: Should the system hard-fail remote sync when free quotas are exceeded, or should it continue local-only service and require admin export/repair before daily close?

## Final Architecture Position

The existing Phase 1.3 plan should not be discarded. Its local-first queue, fake adapter, idempotency, conflict, restore, and migration design is the correct spine. The decision to change is the remote authority:

- Use **Cloudflare D1 + Workers** if the user wants the best hard-free production backend.
- Use **Supabase Free** if the user values managed Postgres/Auth/Realtime and accepts free-tier pause/storage tradeoffs.
- Use **Neon Free** if the user wants managed Postgres with no credit card and accepts a separate trusted API/proxy plus explicit sync/realtime design.
- Use **Google Sheets via proxy** only if the spreadsheet must remain the authoritative accounting artifact.

The next plan should be provider-specific. Do not write a generic “supports every backend” implementation plan; that would spread testing and security review too thin.
