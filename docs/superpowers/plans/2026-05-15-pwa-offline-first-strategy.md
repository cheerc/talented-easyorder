# PWA Offline-First Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:writing-plans` for any follow-up implementation plan. This document is a PWA/offline-first strategy plan; do not implement PWA code directly from it until the `DISCUSS WITH USER` points are resolved.

**Goal:** Define how Talented EasyOrder should become a lunch-service-safe PWA that can cold-start when cached, keep POS operations local-first during unstable school network conditions, and reconnect/sync without duplicate accounting rows.

**Architecture:** Use a service worker only for app-shell/static-asset availability and update control. Use IndexedDB as the durable local data and queue store, with Zustand as the in-memory view model, and keep Phase 1.3's idempotent sync worker as the accounting authority for offline-to-online recovery. Background Sync API is explicitly deferred out of this plan; it is not part of the first executable PWA scope.

**Tech Stack:** Vite 8, React 19, TypeScript 6, Zustand 5, Vitest 4, IndexedDB, Cache API, Service Worker API, Web App Manifest, Workbox via `vite-plugin-pwa`, selected frontend hosting provider, and Cloudflare Workers + D1 or selected Phase 1.3 sync backend. If Plan 2's hosting decision is approved, the frontend hosting provider is Cloudflare Pages.

---

## Required Reads Completed

- `docs/superpowers/plans/ROADMAP.md`
- `docs/superpowers/plans/2026-05-15-free-backend-architecture-exploration.md`
- `docs/superpowers/plans/2026-05-15-deployment-hosting-strategy.md`
- `docs/superpowers/plans/2026-05-14-phase-1-3-google-sheets-sync-offline.md`
- `docs/superpowers/specs/2026-05-14-google-sheets-sync-offline-spec.md`
- `frontend/package.json`
- `frontend/vite.config.ts`
- `frontend/index.html`
- `docs/iPad人臉辨識訂餐系統設計方案_V3.pdf`
- Current `frontend/src/` store, domain, and sync-status stubs

## Official Sources Checked On 2026-05-15

- MDN Service Worker API: https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
- MDN Background Synchronization API: https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API
- MDN IndexedDB API: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- MDN Storage quotas and eviction criteria: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- MDN Web App Manifest: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest
- web.dev Workbox: https://web.dev/learn/pwa/workbox
- web.dev PWA installation prompt: https://web.dev/learn/pwa/installation-prompt/
- WebKit Home Screen web apps on iOS/iPadOS: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- Vite PWA Workbox docs: https://vite-pwa-org.netlify.app/workbox/
- Vite PWA service worker strategies: https://vite-pwa-org.netlify.app/guide/service-worker-strategies-and-behaviors
- Vite PWA advanced `injectManifest`: https://vite-pwa-org.netlify.app/guide/inject-manifest.html
- Workbox Background Sync docs: https://developer.chrome.com/docs/workbox/reference/workbox-background-sync
- web.dev PWA installation: https://web.dev/learn/pwa/installation/

## Current PWA Readiness

1. The frontend has no PWA package, no service worker, no manifest, and no install prompt logic.
2. `frontend/index.html` only declares charset, favicon, viewport, title, root div, and Vite entry script.
3. `frontend/vite.config.ts` uses only `@vitejs/plugin-react` and Vitest jsdom setup.
4. `frontend/package.json` scripts are `dev`, `build`, `lint`, and `preview`; there is no PWA build step.
5. Current persistence is Zustand `persist` on `localStorage` under `pos-storage`.
6. Current sync UI is a stub: `App.tsx` sets `online = true`, fakes `syncing`, and updates `lastSync` after a timeout.
7. Current domain types already include `syncStatus: local | queued | synced | failed | conflict`, but no real queue exists yet.
8. Phase 1.3 already defines the correct durable queue semantics: local commit first, stable idempotency keys, dependency ordering, retry/backoff, conflict/failed states, restore, migration, and auto-flush on reconnect.
9. The PDF requires PC as Phase 1 accounting authority and iPad as a future input sensor. It also says offline iPad recognition can work locally and later補登, but it does not make iPad the accounting authority.

## Strategic Recommendation

### Use PWA In Three Layers

| Layer | Responsibility | Primary Storage/API | Launch Timing |
|---|---|---|---|
| PWA shell | App can load without network after one successful install/load. | Service Worker + Cache API + manifest. | Before or at the start of Phase 1.3. |
| Offline data | POS data and queue survive refresh, browser restart, and lunch network outage. | IndexedDB domain repository + sync queue; Zustand hydrated from IndexedDB. | During Phase 1.3 durable queue work. |
| Sync recovery | Reconnect flushes queued writes safely and surfaces conflicts/failed rows. | Phase 1.3 sync worker + chosen remote transport. | During Phase 1.3 provider-specific sync work. |

### Recommended Implementation Order

1. Add app-shell PWA infrastructure before Phase 1.3 sync pilot.
2. Move durable queue and authoritative local data from `localStorage` to IndexedDB as part of Phase 1.3, before using real remote sync.
3. Keep `localStorage` only for small UI preferences and as a migration source from the current `pos-storage` shape.
4. Add install prompt and campus runbook after the final hosting provider is known. If Plan 2 is approved, write the runbook against Cloudflare Pages.
5. Do not implement Background Sync in this plan. Revisit it only in a later plan after foreground reconnect has passed campus PC and iPad drills.

Reasoning:

- App-shell caching without a durable data layer gives a misleading offline promise.
- IndexedDB without service worker still lets a loaded tab keep serving lunch, but does not solve cold-start after network loss.
- Background Sync is not reliable enough across iPad Safari and school devices to be the primary recovery path.
- Keeping this plan on `generateSW` means there is no custom service-worker `sync` listener in scope. That avoids a split-brain queue where Workbox replays failed requests from its own IndexedDB queue while EasyOrder also maintains an authoritative app queue.

## PWA Infrastructure

### Workbox Vs Hand-Written Service Worker

| Option | Strengths | Risks | Recommendation |
|---|---|---|---|
| Hand-written `sw.js` | Maximum control; fewer dependencies; easy to audit small fetch handler. | Easy to cache stale `index.html`, miss hashed Vite assets, forget old-cache cleanup, or diverge from build output. More maintenance for every Vite chunk naming change. | Not first choice for this app. Use only if Workbox/vite-plugin-pwa blocks a required behavior. |
| Workbox through `vite-plugin-pwa` with `generateSW` | Integrates with Vite build output, precaches hashed assets, supports cleanup of outdated caches, and provides runtime caching strategies. Less custom service-worker code. | Generated worker can hide details; aggressive defaults can cache wrong routes if misconfigured. It is not the right place for a custom `sync` event listener. Must test update/rollback carefully. | **Recommended for initial PWA shell.** Keep runtime rules strict, do not cache accounting API mutations, and do not implement Background Sync in this phase. |
| Workbox through `vite-plugin-pwa` with `injectManifest` | Keeps Workbox precache injection while allowing custom service-worker code. Required if the app later needs a custom service-worker `sync` event listener. | More moving parts; custom worker code must be audited for Safari/iPad behavior, update lifecycle, and queue ownership. | Future-only. Use in a separate Background Sync plan if foreground sync is insufficient. |

Recommended initial choice:

```text
vite-plugin-pwa + Workbox generateSW
registerType: prompt
manifest: committed in vite config or public manifest
precache: Vite output assets + favicon/icons/manifest
runtime caching: same-origin static assets only
API requests: network-only except explicit read-only snapshot routes after approval
```

Do not start with `autoUpdate`. Lunch-service POS cannot silently swap app code during active service. Use a visible "新版本已準備，午餐後重新整理" update prompt and allow admin-triggered refresh only when no transaction is in-progress and the sync queue is safe.

Background Sync scope decision for this plan:

- Choose **B: defer Background Sync out of scope**.
- Keep `generateSW` for app-shell precache and strict runtime caching only.
- Do not add `frontend/src/pwa/backgroundSync.ts` in this plan.
- Do not use Workbox `BackgroundSyncPlugin`, because it stores failed requests in its own IndexedDB-backed Workbox queue and would conflict with EasyOrder's explicit `sync_queue` domain model.
- If Background Sync becomes necessary later, create a separate plan that switches to `injectManifest`, adds a custom service worker source, listens for `sync`, reads EasyOrder's existing IndexedDB queue, and calls the same idempotent sync path as foreground reconnect.

### Service Worker Scope And Lifecycle

Use one service worker scoped to the frontend origin root.

Service worker responsibilities:

- Precache Vite build assets needed for the app shell.
- Serve offline fallback for navigation to the SPA shell.
- Clean up outdated caches during activation.
- Notify the app when a new version is waiting.
- Never decide accounting conflicts.
- Never write authoritative domain data directly.
- Never retry queued accounting mutations. In this plan, only the foreground app sync worker flushes the IndexedDB queue.

Service worker non-goals:

- Do not cache `POST /sync/batch-write`, `POST /migration/import-commit`, closeout, settlement, or mutation endpoints.
- Do not treat cached API responses as authoritative accounting state.
- Do not hide remote API failures by returning stale successful sync responses.
- Do not implement face-recognition model caching in the first PWA PR; Phase 2 needs a separate privacy/storage review.

### Cache Strategy

| Resource | Strategy | Reason |
|---|---|---|
| Vite hashed JS/CSS/assets | Precache/cache-first via Workbox | Hashed filenames are immutable; required for offline shell. |
| `index.html` / SPA navigation | Network-first with cached fallback, or Workbox app-shell fallback with short/no HTTP cache | Avoid serving stale HTML that points to missing assets after deploy/rollback. |
| `manifest.webmanifest`, icons, favicon | Precache/cache-first with versioned filenames where possible | Required for install and offline launch appearance. |
| Fonts/assets from same origin | Cache-first with expiration | Avoid lunch-time reload failures; cap cache size. |
| Backend health endpoint | Network-only with short timeout | Health must reflect current remote availability. |
| Sync write endpoints | Network-only, no service-worker cache | Prevent fake success or duplicated/masked writes. |
| Read-only snapshot endpoint | Network-first only after restore/snapshot design exists | Stale snapshot can overwrite local state if misused; default to no caching. |
| Google/third-party script CDN | Avoid or network-only | Offline shell should not depend on third-party CDNs. Bundle required assets locally. |

### Web App Manifest

Add `frontend/public/manifest.webmanifest` and link it from `frontend/index.html`.

Recommended manifest fields:

```json
{
  "id": "/",
  "name": "Talented EasyOrder POS",
  "short_name": "EasyOrder",
  "description": "校園訂餐與帳務 POS",
  "start_url": "/?source=pwa",
  "scope": "/",
  "display": "standalone",
  "background_color": "#fff7ed",
  "theme_color": "#7c3f1d",
  "orientation": "any",
  "icons": [
    { "src": "/pwa/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/pwa/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/pwa/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Also add iOS-compatible metadata in `frontend/index.html`:

```html
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#7c3f1d" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="EasyOrder" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<link rel="apple-touch-icon" href="/pwa/apple-touch-icon.png" />
```

Do not force `orientation: landscape` in the first PWA release. The PC POS is likely landscape/wide, but iPad Phase 2 camera flow may need portrait. Use responsive UI constraints and test both.

### Install Prompt Experience

Chromium desktop/Android:

- Listen for `beforeinstallprompt`.
- Save the event.
- Show install CTA only after initial data load and storage readiness pass.
- Trigger prompt from a user action.
- Hide install CTA in standalone display mode.

Safari/iPadOS:

- Do not expect `beforeinstallprompt`.
- Show manual instructions: Safari Share button -> Add to Home Screen.
- Verify installed Home Screen app opens in standalone mode.
- Provide an operator runbook with screenshots after branding/domain is final.
- Warn operators not to install duplicate EasyOrder Home Screen icons for the same site. Apple devices can install the same PWA more than once, and each install can have isolated storage, so duplicate icons can produce different local queues/data.

Operator UX rule:

- Never show install prompts during active POS transaction flow.
- Suggested locations: Admin screen, end-of-day checklist, or after successful offline-readiness test.
- Copy should say installation improves cold-start/offline launch, but does not replace daily sync/backup.

## Offline Data Layer

### IndexedDB Vs localStorage

| Criterion | localStorage | IndexedDB | EasyOrder Decision |
|---|---|---|---|
| Current repo state | Already used by Zustand persist under `pos-storage`. | Not implemented. | Keep as migration source and preference store. |
| Capacity | Web Storage is small and string-only; MDN documents Web Storage as 10 MiB per origin total, split as about 5 MiB localStorage plus 5 MiB sessionStorage. | Designed for significant structured data with indexes. | Use IndexedDB for ledger, queue, snapshots, restore, and migration. |
| Performance | Synchronous; can block UI during larger writes/reads. | Async; better for lunch spikes and growing ledgers. | Avoid large localStorage writes in POS commit path. |
| Worker access | Service workers cannot use Web Storage. | IndexedDB is available in workers. | Required if future service-worker-assisted sync is approved. |
| Querying | Manual JSON parse/filter. | Object stores and indexes. | Needed for business date, sync status, idempotency, and restore queries. |
| Eviction/quotas | Shares origin storage risk; small hard ceiling. | Shares browser quota/eviction model but has larger practical headroom. | Add `navigator.storage.estimate()` and optional `persist()` request. |

Recommendation:

- Phase 1.3 should not build a serious queue on localStorage if production lunch offline is required.
- Implement an IndexedDB repository before the real sync transport pilot.
- Keep Zustand as the UI state cache, not the only durable source of truth.

### IndexedDB Schema

Database name: `easyorder-pos`

Version: `1`

Object stores:

| Store | Key | Indexes | Purpose |
|---|---|---|---|
| `app_meta` | `key` | none | schema version, last migration, install id, last successful sync. |
| `students` | `studentId` | `status`, `updatedAt`, `revision` | student master and balances. |
| `vendors` | `vendorId` | `status`, `updatedAt` | vendor master. |
| `menus` | `menuId` or `businessDate` | `businessDate`, `vendorId`, `updatedAt` | menu/catalog/current-day menu. |
| `transactions` | `transactionId` | `businessDate`, `studentId`, `syncStatus`, `createdAt`, `idempotencyKey` | append-only ledger rows. |
| `daily_settlements` | `settlementId` | `businessDate`, `status`, `syncStatus` | closeout and settlement revisions. |
| `sync_queue` | `queueId` | `status`, `nextRetryAt`, `entity`, `idempotencyKey`, `businessDate` | Phase 1.3 durable queue. |
| `sync_events` | `eventId` | `entityType`, `entityId`, `businessDate`, `createdAt` | idempotency/audit/repair trail. |
| `restore_previews` | `previewId` | `createdAt`, `source` | temporary restore preview results before apply. |
| `migration_batches` | `migrationBatchId` | `status`, `createdAt` | old sheet/form migration audit. |
| `outbox_receipts` | `idempotencyKey` | `remoteRevision`, `remoteUpdatedAt` | duplicate retry/replay protection and remote receipt audit. |

Rules:

- Transactions and settlement revisions are append-only from the UI perspective.
- `sync_queue` entries reference domain rows by id; payload is a serialized DTO snapshot used for remote writes.
- `outbox_receipts` is the local proof that a remote accepted an idempotency key.
- `app_meta.installId` is generated once and never reused across browsers/devices.
- Raw biometric templates are not stored in this database in Phase 1.3 or this PWA plan.

### Zustand Relationship

Current `usePosStore` should evolve into a UI/state facade:

```text
App starts
  -> initialize IndexedDB
  -> run migration from old localStorage `pos-storage` if needed
  -> hydrate Zustand slices from IndexedDB
  -> render POS only after local repository readiness
```

Write path:

```text
Operator commits POS action
  -> compute domain transaction/correction/settlement
  -> IndexedDB transaction writes domain row + queue entry atomically
  -> Zustand updates from committed IndexedDB result
  -> sync worker is notified if network is available
```

Do not update Zustand first and then attempt IndexedDB. If the browser crashes between those two steps, the UI would show a committed accounting fact that is not durable.

### Offline Queue Integration With Phase 1.3

Use the Phase 1.3 `SyncQueueEntry` as the logical queue model and store it in IndexedDB.

Required additions for PWA/offline hardening:

- Add `deviceId` and `installId` to queue metadata.
- Add `createdWhileOffline: boolean` for reporting and operator diagnostics.
- Add `lastForegroundFlushAt`, `lastManualFlushAt`, and `lastHealthCheckAt` in `app_meta`.
- Add a `storageHealth` summary: estimated quota, usage, persistence granted, last IDB write test.
- Add queue startup reconciliation:
  - If domain row says `queued` but queue entry is missing, create a repair warning.
  - If queue entry exists but domain row is missing, mark the queue entry `failed` with repair details.
  - If receipt exists for a queued idempotency key, mark domain row `synced` after validating remote revision.

## Sync Strategy

### Background Sync API Feasibility

Background Sync API can defer sync work to a service worker when connectivity is stable, but MDN marks it limited availability and not Baseline. It is secure-context-only and must be feature-detected.

Decision for this executable plan:

- Do not rely on Background Sync for production correctness.
- Implement foreground sync as the primary path:
  - app startup
  - `online` browser event
  - successful remote health check
  - `visibilitychange` to visible
  - periodic timer while POS/Admin app is open
  - manual "push to cloud" button
- Do not implement Background Sync in PWA-P0 through PWA-P5.
- On iPad Safari, assume the app may need to be open/foregrounded to flush reliably.

Future-only path if Background Sync is later approved:

- Switch `vite-plugin-pwa` from `generateSW` to `injectManifest`.
- Add a custom service worker source file with a `sync` event listener.
- Feature-detect `SyncManager` before registration.
- Do not use Workbox `BackgroundSyncPlugin` for accounting writes. Workbox's plugin queues failed requests in its own IndexedDB-backed replay queue; EasyOrder must keep one authoritative `sync_queue`.
- The custom `sync` listener must read EasyOrder's IndexedDB queue and call the same idempotent queue processor used by foreground reconnect.
- Unsupported browsers must behave exactly like this plan's foreground-only implementation.

This removes Background Sync from current implementation scope while preserving a technically executable upgrade path.

### Reconnection補登 Flow

```text
Browser/app starts or returns online
  -> read IndexedDB app_meta + sync_queue summary
  -> perform remote health check with short timeout
  -> if health fails: show offline/remote unavailable and keep POS enabled
  -> if health passes: claim eligible queue entries by dependency order
  -> send batch to remote transport
  -> map each result to synced / retrying / failed / conflict
  -> update IndexedDB domain row metadata and queue rows atomically
  -> update Zustand UI summary
  -> if failures/conflicts exist: show repair links, but POS remains usable
```

Connectivity sources:

- `navigator.onLine` is a hint only.
- Remote health endpoint is authoritative for sync availability.
- Captive portal/proxy responses must be treated as health failure if JSON schema or expected status is wrong.
- Hosting availability only proves app shell delivery. If Plan 2's Cloudflare Pages decision is approved, Cloudflare Pages availability still does not prove Worker/API health.

### Conflict Resolution Offline

Keep Phase 1.3 conflict policy unchanged:

- Mutable master rows can offer server-wins or last-write-wins with preview.
- Transactions, corrections, voids, and settlement revisions require manual resolve.
- Do not overwrite append-only accounting rows silently.
- Do not allow the service worker or any future Background Sync enhancement to resolve conflicts without UI.

PWA-specific rule:

- Conflict prompts should never block the lunch POS screen unless closeout/reporting requires it.
- During lunch, show queued/failed/conflict counts in the top bar and admin/report repair surfaces.
- Closeout remains stricter: failed/conflict rows block close unless the user explicitly accepts a settlement-queued policy approved in Phase 1.3.

## Campus Environment Considerations

### Lunch Peak Offline Readiness

Before lunch service, the operator should see an explicit readiness indicator:

| Check | Pass Condition |
|---|---|
| Service worker active | Current app shell version is cached and controlling the page. |
| IndexedDB ready | Last write/read test succeeded. |
| Storage headroom | `navigator.storage.estimate()` reports enough free space for expected queue growth. |
| Persistent storage | `navigator.storage.persist()` attempted and result recorded where supported. |
| Queue health | No unknown corrupted entries; failed/conflict count visible. |
| Last remote health | Shows last successful sync time and current remote status. |
| App version | Shows build/version and whether an update is waiting. |

Offline lunch rule:

- If the app was loaded and readiness passed before lunch, POS service continues from local IndexedDB even if Wi-Fi drops.
- If the device cold-starts and the app shell is not cached, PWA cannot load offline; this must be verified during the pre-lunch readiness drill.
- If the browser/storage was cleared, the app must show a restore/migration path rather than silently creating an empty production dataset.

### PC And iPad Differences

| Capability | PC Browser | iPad Safari / Home Screen Web App | Plan Decision |
|---|---|---|---|
| App-shell service worker | Supported in modern desktop browsers over HTTPS/localhost. | Supported, but must be tested on target iPad/iPadOS. | Test both installed and Safari-tab modes. |
| Install prompt | Chromium can expose `beforeinstallprompt`. | Use Safari Share -> Add to Home Screen; no dependable custom native prompt. | Provide manual install instructions for iPad. |
| Duplicate installs | Usually one installed app identity per manifest/app id. | Apple devices can install the same PWA more than once; each install can have isolated storage and separate local queue state. | Runbook must instruct operators to keep one approved EasyOrder icon per device and verify the expected `installId`. |
| Background Sync | Available only in some browsers. | Do not assume support. | Out of scope for this plan; foreground reconnect path is mandatory. |
| Storage eviction | Browser quota/eviction still applies. | Safari may proactively evict script-created data for inactive origins; daily use helps but backup/restore still required. | Add storage health and remote backup/restore drills. |
| Camera for Phase 2 | Browser-specific permission prompts. | Requires HTTPS and real iPad testing; user gesture and permission UX matter. | Separate Phase 2 feasibility; do not cache face templates now. |
| Screen/privacy | PC is accounting authority. | iPad must not show balance/debt/payment/history. | Keep iPad PWA as lookup/handoff only. |

### Campus Firewall / Proxy

Required tests on real campus network:

- Load production custom domain over HTTPS.
- Register service worker without blocked `sw.js` or manifest requests.
- Fetch cached assets after toggling Wi-Fi off.
- API health to Cloudflare Worker or selected backend.
- Sync write endpoint with captive portal/proxy detection.
- iPad Home Screen launch from the custom domain.
- iPad check that only one approved EasyOrder Home Screen icon is present and that the displayed `installId` matches the runbook record.
- iPad camera permission later in Phase 2.

Firewall implications:

- Avoid third-party CDN runtime dependencies; bundle assets locally.
- Use custom domain for app and API if provider default domains are blocked.
- Service worker scope must be same-origin with the app shell.
- Do not let a proxy cache `index.html` or `sw.js` too aggressively; update/rollback depends on fresh checks.

## Implementation Roadmap

### PWA-P0: Decision And Runbook

**Files:**

- Create: `docs/pwa/offline-first-decision.md`
- Create: `docs/pwa/campus-offline-readiness-checklist.md`
- Create: `docs/pwa/ipad-install-runbook.md`

**Scope:**

- Record Workbox/vite-plugin-pwa decision.
- Record that Background Sync is deferred out of this plan and would require a future `injectManifest` plan.
- Document PC/iPad install, readiness, and emergency reload steps.
- Add iPad duplicate-install warning: one approved EasyOrder Home Screen icon per device, because duplicate installs can have isolated storage and different queue state.
- Document what operator must do before lunch.

**Verification:**

- Docs review confirms all `DISCUSS WITH USER` decisions are either answered or marked pending.

### PWA-P1: App Shell And Manifest

**Files:**

- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/index.html`
- Create: `frontend/public/manifest.webmanifest`
- Create: `frontend/public/pwa/icon-192.png`
- Create: `frontend/public/pwa/icon-512.png`
- Create: `frontend/public/pwa/icon-maskable-512.png`
- Create: `frontend/public/pwa/apple-touch-icon.png`
- Create: `frontend/src/pwa/registerServiceWorker.ts`
- Create: `frontend/src/pwa/__tests__/pwaConfig.test.ts`

**Scope:**

- Add `vite-plugin-pwa` and Workbox config.
- Use `generateSW` for app-shell precache/runtime caching; do not add a custom service worker source in this PR.
- Add manifest and iOS metadata.
- Register service worker from app startup.
- Use `registerType: prompt` or equivalent update prompt behavior.
- Add tests that manifest fields and PWA config match the expected app identity.

**Verification:**

```bash
cd frontend
npm run lint
npx tsc --noEmit
npx vitest run src/pwa/__tests__/pwaConfig.test.ts
npm run build
```

Manual:

- `npm run preview`, load app, confirm manifest is linked.
- Confirm service worker registers on HTTPS/localhost preview environment.
- Toggle offline in browser devtools and reload app shell.

### PWA-P2: IndexedDB Repository And Migration From localStorage

**Files:**

- Create: `frontend/src/storage/easyOrderDb.ts`
- Create: `frontend/src/storage/localStorageMigration.ts`
- Create: `frontend/src/storage/storageHealth.ts`
- Create: `frontend/src/storage/__tests__/easyOrderDb.test.ts`
- Create: `frontend/src/storage/__tests__/localStorageMigration.test.ts`
- Modify: `frontend/src/store/posStore.ts`
- Modify: `frontend/src/store/__tests__/posStore.test.ts`

**Scope:**

- Create IndexedDB schema listed above.
- Migrate current `pos-storage` data into IndexedDB once per install.
- Keep a migration receipt in `app_meta`.
- Hydrate Zustand from IndexedDB before showing POS ready state.
- Keep small UI preferences in localStorage only.
- Add storage estimate/persistence API wrapper.

**Verification:**

```bash
cd frontend
npx vitest run src/storage/__tests__/easyOrderDb.test.ts src/storage/__tests__/localStorageMigration.test.ts src/store/__tests__/posStore.test.ts
npm run lint
npx tsc --noEmit
npm run build
```

Manual:

- Load current app with existing `pos-storage`.
- Confirm students/transactions migrate and persist after refresh.
- Clear network, refresh installed PWA, confirm local data appears if app shell was cached.

### PWA-P3: Durable Queue In IndexedDB

**Files:**

- Create: `frontend/src/domain/syncQueue.ts`
- Create: `frontend/src/domain/__tests__/syncQueue.test.ts`
- Create: `frontend/src/sync/indexedDbQueueRepository.ts`
- Create: `frontend/src/sync/__tests__/indexedDbQueueRepository.test.ts`
- Modify: `frontend/src/store/posStore.ts`

**Scope:**

- Implement Phase 1.3 `SyncQueueEntry` in IndexedDB.
- Ensure POS writes atomically create domain row plus queue entry.
- Add queue repair/reconciliation on startup.
- Add idempotency key and dependency indexes.

**Verification:**

- Queue survives refresh and browser restart.
- Unknown network result retry does not create duplicate domain row.
- Missing queue/domain mismatch appears as repair warning.

### PWA-P4: Foreground Reconnect Sync Worker

**Files:**

- Create: `frontend/src/sync/syncWorker.ts`
- Create: `frontend/src/sync/syncHealth.ts`
- Create: `frontend/src/hooks/useSyncWorker.ts`
- Create: `frontend/src/sync/__tests__/syncWorker.test.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/pos-components.tsx`

**Scope:**

- Replace fake `online`, `syncing`, and `lastSync` in `App.tsx`.
- Combine browser events with remote health checks.
- Flush queue on startup, `online`, `visibilitychange`, interval, and manual push.
- Keep POS local-first when remote is unavailable.

**Verification:**

- Browser offline event changes top bar and POS remains usable.
- Online event after queued writes flushes in dependency order.
- Health failure keeps queue local and shows remote unavailable.

### PWA-P5: Campus Offline Drill And Release Gate

**Files:**

- Create: `docs/pwa/offline-drill-results.md`
- Create: `docs/pwa/release-gate.md`
- Modify: `docs/deployment/cloudflare-pages-runbook.md` only if Plan 2's Cloudflare Pages hosting decision is approved.

**Scope:**

- Define release gate for PWA/offline launch.
- Run PC and iPad manual checks on target campus network.
- Prove app shell reloads offline after first successful load.
- Prove queued POS transaction survives refresh and reconnect補登.
- Prove service worker update prompt does not interrupt active transaction.
- Verify iPad has exactly one approved EasyOrder Home Screen install for production use and record the expected `installId`; duplicate installs must be removed or clearly marked non-production.

**Verification:**

- Release gate is not passed until real PC and target iPad are tested on campus Wi-Fi/wired network.
- Release gate is not passed if the iPad has duplicate production-looking EasyOrder Home Screen icons with different storage/queue state.

## Testing Matrix

| Scope | Automated Check | Manual Check |
|---|---|---|
| Manifest | Unit reads manifest/config and validates `name`, `short_name`, `start_url`, `scope`, `display`, icons. | Browser Application panel shows manifest and installability status. |
| Service worker | Build output contains service worker and precache manifest. | Offline reload after `npm run preview` or deployed preview. |
| Update lifecycle | Unit tests update-prompt state machine. | Deploy two versions; verify old active session shows update waiting instead of silent refresh. |
| IndexedDB migration | Unit migrates `pos-storage` fixtures to IndexedDB. | Existing browser data appears after upgrade. |
| Queue durability | Unit writes queue/domain rows atomically and reloads DB. | Commit POS row offline, refresh, row and queue remain. |
| Reconnect | Unit simulates health fail/pass and queue flush. | Toggle Wi-Fi off/on; queued rows flush after health returns. |
| Conflict | Unit maps remote conflict to `conflict` state. | Admin/report repair link visible; POS still usable. |
| Storage health | Unit covers estimate/persist fallbacks. | Admin screen shows storage status on PC and iPad. |
| iPad install | Not fully automatable in repo. | Safari Add to Home Screen, standalone launch, offline shell reload, duplicate-icon check, and expected `installId` recorded. |
| Campus network | Not fully automatable in repo. | Test custom domain, service worker, API health, and sync write on school network. |

## DISCUSS WITH USER Decision Points

> ⚠️ DISCUSS WITH USER: Is offline cold-start required for launch, meaning the app must open from the Home Screen even when the network is already down, or is it enough that an already-loaded tab continues serving lunch offline?

> ⚠️ DISCUSS WITH USER: Should Phase 1.3 move authoritative local data and queue to IndexedDB before the first real sync pilot, accepting extra implementation cost, or keep localStorage for the pilot and migrate later?

> ⚠️ DISCUSS WITH USER: Can operators be required to run a pre-lunch offline readiness check every day, including opening the PWA once while online and verifying storage/sync status?

> ⚠️ DISCUSS WITH USER: On iPad, will staff use Safari Add to Home Screen as the supported install path, or must the system also support normal Safari-tab mode during Phase 2?

> ⚠️ DISCUSS WITH USER: For iPad/Home Screen operation, can the runbook require exactly one production EasyOrder install per device and remove duplicate installs that have separate storage/queue state?

> ⚠️ DISCUSS WITH USER: Are queued offline transactions allowed to accumulate across multiple business days, or must daily closeout require all queues for that business date to sync/resolve first?

> ⚠️ DISCUSS WITH USER: Should PWA storage request persistent storage where supported, and how should the operator be trained to avoid clearing site data on the POS PC/iPad?

> ⚠️ DISCUSS WITH USER: Should the app ever cache read-only remote snapshots/API responses, or should all remote data be network-only and local IndexedDB be the sole offline data source?

> ⚠️ DISCUSS WITH USER: What is the acceptable update policy during lunch service: block updates until no active transaction and queue safe, or allow immediate refresh when a critical fix is available?

> ⚠️ DISCUSS WITH USER: Should Background Sync remain deferred until after foreground reconnect passes campus drills, or should a separate future plan switch to `injectManifest` and add a custom service-worker `sync` listener?

> ⚠️ DISCUSS WITH USER: Does Phase 2 iPad face recognition need offline model/profile caching at launch, and if so what biometric/privacy constraints govern storage, encryption, and deletion?

## Final Position

Add PWA infrastructure before the real Phase 1.3 sync pilot, but keep the service worker narrowly scoped to app-shell/static-asset availability. The production offline guarantee must come from IndexedDB-backed local data, Phase 1.3's durable queue, idempotent reconnect補登, and clear operator readiness checks.

Use Workbox through `vite-plugin-pwa` with `generateSW` for the first PWA shell. Use IndexedDB, not localStorage, for the accounting data and queue that must survive lunch network failures. Defer Background Sync entirely; the foreground reconnect path must be sufficient on both PC and iPad Safari. If Background Sync is approved later, switch to `injectManifest` in a separate plan and use EasyOrder's existing IndexedDB queue, not Workbox's separate replay queue.
