# User Decision Checklist For EasyOrder Phase 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans if turning any decision below into implementation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the user's confirmed Phase 1 product and architecture decisions before rewriting Plan B for Firebase Firestore + Vercel.

**Architecture:** Decisions are grouped by product area and each item records the confirmed choice plus the implementation effect. This document is not a code task list; it is the approval gate for Plan A and the upcoming Firebase/Firestore Plan B.

**Tech Stack:** EasyOrder frontend PWA, Firebase Auth, Firestore with offline persistence/realtime sync, Firebase Security Rules, Vercel hosting, AgEnD decision records.

---

## How To Use This Checklist

1. The lead treats each item below as the user's confirmed decision.
2. The lead records accepted answers with `decision(action: post)` before dispatching implementation.
3. Implementation plans may proceed only when they cite this checklist and the exact plan file they implement.
4. The Apps Script + Google Sheets Plan B cycle is stopped; the sync/backend plan must be rewritten for Firebase Firestore + Vercel.

## Required Decisions Before Plan A

### A1. Opening Cash And Counter Cash Adjustments

**Question:** Is the petty-cash opening amount fixed, editable, or controlled by explicit cash movements?

**Confirmed decision:** The first setup records the initial opening cash. After that, drawer cash changes through daily revenue plus explicit `counter deposit` / `counter withdraw` operations.

**Implementation effect:** Do not allow arbitrary edits to current drawer cash. Add counter deposit/withdraw flows that record operator, timestamp, amount, and reason. The accounting ledger must make every manual drawer change traceable.

### A2. Vendor Payout Tracking

**Question:** Does the counter pay the lunch vendor from the drawer every day?

**Confirmed decision:** No. The vendor is monthly billed.

**Implementation effect:** Settlement formula is `expectedDrawerCash = openingCash + netCash + counterDeposits - counterWithdrawals`. Do not subtract vendor payout.

### A3. Late Payment / Missed Payment Correction

**Question:** Should missed payment discovered later get a special "補登" UI?

**Confirmed decision:** No.

**Implementation effect:** Use the existing W mode, renamed `補錢 / 儲值`. The POS workflow remains: search student -> W -> enter amount -> confirm.

### A4. Cancellation Semantics

**Question:** Should cancellation distinguish before vs after the vendor count was phoned in?

**Confirmed decision:** No.

**Implementation effect:** Show only current effective order count. `cancel` continues to affect the local effective count. No vendor-count lock or policy state is added.

### A5. Multiple Meals On One Account

**Question:** Can one account order more than one meal in a day?

**Confirmed decision:** Yes. Allow multiple meals and show a duplicate/multiple-meal prompt. Students may legitimately share one number, for example siblings like "林小明/林小妹".

**Implementation effect:** Do not block duplicate orders for the same account. The UI should warn and require confirmation, but shared-account use is normal data, not an error.

### A6. Single-Order Price Override

**Question:** Who may change one order's price?

**Confirmed decision:** Any counter staff member may change the price. Responsibility belongs to the counter operator who performed the action.

**Implementation effect:** Add `改本筆價格` in POS confirmation. Record operator identity, timestamp, original price, new price, and reason/note when available. Do not mutate `todayMenu.price`.

### A7. Debt Limit

**Question:** Are students allowed to go into debt without a limit?

**Confirmed decision:** Do not restrict debt in Phase 1. Add limits later if needed.

**Implementation effect:** Current negative-balance warning is enough. Do not add approval gates or hard debt blocks yet.

## Required Decisions Before Plan B

### B1. Backend Authority

**Question:** What is the Phase 1 backend/source of truth?

**Confirmed decision:** Use Firebase Firestore + Vercel, following the same broad architecture as `talented-payroll`. Use an independent Firebase project for EasyOrder. Cancel the Apps Script + Google Sheets backend plan.

**Implementation effect:** Rewrite Plan B around Firestore collections, Firebase Auth, Security Rules, Vercel deployment, realtime sync, and Firestore offline persistence. Do not implement Apps Script `doGet`/`doPost` or Google Sheets as the production backend.

### B2. Account Ownership And Project Boundary

**Question:** Which account and project own the backend data?

**Confirmed decision:** Use the company's existing Google Workspace account. Backend data belongs under the `cheerc@talented.com.tw` admin account. EasyOrder must use its own Firebase project, separate from `talented-payroll`.

**Implementation effect:** Setup/runbook must create a distinct EasyOrder Firebase project under the company admin account. Do not reuse the `talented-payroll` Firebase project.

### B3. Sync Freshness

**Question:** Is near-realtime multi-device sync required?

**Confirmed decision:** Yes. Use Firestore realtime sync. When network is available, every transaction syncs automatically.

**Implementation effect:** Plan B must use Firestore realtime listeners for operational views and writes through Firestore APIs. Avoid polling loops as the primary sync mechanism.

### B4. Offline Closeout And Sync Status

**Question:** May the operator close the day while writes are not yet synced?

**Confirmed decision:** Yes. Allow offline closeout. Firestore offline persistence writes locally first, then automatically syncs when network returns.

**Implementation effect:** Do not block closeout only because writes are pending. Show an explicit sync status indicator: `🟢已同步` / `🟡同步中` / `🔴離線待同步`. Failed/conflict states still need visible operator attention.

### B5. Concurrent Multi-Computer Operation

**Question:** Can multiple counter computers operate at the same time?

**Confirmed decision:** Yes. Do not lock the system to one active session.

**Implementation effect:** Plan B must support multiple devices writing concurrently. Use Firestore atomic transactions and optimistic locking/retry for conflicts such as two devices updating the same student's balance at the same time.

### B6. Staff Identity

**Question:** Does production require per-staff accounts?

**Confirmed decision:** Yes. Staff sign in with individual Google Workspace accounts and every operation records the operator identity.

**Implementation effect:** Use Firebase Auth with Google Workspace login. Store `operatorUid`, `operatorEmail`, and timestamp on accounting-relevant writes.

### B7. Admin Dashboard

**Question:** Is a separate admin dashboard required?

**Confirmed decision:** No. Do not build an admin dashboard for Phase 1. Counter staff have full permission in the frontend to view, verify, and reconcile accounting because lunch money is代收代付, not revenue.

**Implementation effect:** Put operational accounting workflows in the POS/frontend. Use Firestore Security Rules to control authenticated read/write access instead of a separate admin UI.

### B8. Production Auth And Access Control

**Question:** How should production users authenticate and authorize backend access?

**Confirmed decision:** Use Firebase Auth with Google Workspace accounts. Cancel the Apps Script shared-secret/HMAC pairing model.

**Implementation effect:** Plan B must define Firebase Auth setup, allowed-domain or whitelist behavior, custom claims/allowlist as needed, and Firestore Security Rules that verify identity before reads/writes.

### B9. Student Lifecycle

**Question:** Where does student data come from?

**Confirmed decision:** Cancel the CSV import flow. Students are created one by one when they order lunch. Graduated/inactive/non-ordering students are disabled rather than deleted.

**Implementation effect:** Add POS/frontend workflows to create and deactivate students directly. Historical orders and cash ledger rows must keep student snapshots so deleting/deactivating a student never breaks history.

## Required Decisions Before Deployment / Pilot

### C1. Paper And System Parallel Run

**Question:** Can the pilot use paper and system together?

**Confirmed decision:** Yes. Paper and system run in parallel. Cloud exists for backup and sync. Staff can switch computers; production is not bound to one device.

**Implementation effect:** Runbook should state that paper remains the operational fallback during pilot. Firestore sync enables continuity across counter computers.

### C2. Offline Cold Start

**Question:** Must the PWA open when the network is already down?

**Confirmed decision:** Required for real lunch service.

**Implementation effect:** Keep PWA offline readiness in the deployment checklist. The operator should still run a pre-lunch readiness check while online.

### C3. Device And Phase Boundary

**Question:** What devices are in Phase 1?

**Confirmed decision:** One browser per operating device. iPad/Android face-recognition ordering is Phase 2. Phase 1 PWA is the counter-computer ordering system.

**Implementation effect:** Phase 1 runbook should standardize one browser/profile per device. Do not mix Phase 2 face-ordering requirements into the Phase 1 POS plan.

### C4. Local Data Risk

**Question:** Does the school accept that offline POS stores student/accounting data on the device?

**Confirmed decision:** Yes, with minimization, sync status visibility, clear-data runbook, and device access controls.

**Implementation effect:** Firestore offline persistence is allowed. The security plan must document local-device risk and recovery/clear-data steps.

### C5. Backup And Restore Owner

**Question:** Who owns backup/export and restore drills?

**Confirmed decision:** Counter staff own backup and restore. Reason: lunch ordering cash flow is代收代付, not business revenue.

**Implementation effect:** Backup/restore runbooks and UI must be usable by counter staff, not admin-only. Keep recovery steps operationally simple.

### C6. Account Ownership And Frontend Access

**Question:** Who owns backend permissions and who can log in?

**Confirmed decision:** Backend authority belongs to the admin account `cheerc@talented.com.tw`. Frontend login is open to a whitelist of approved Google Workspace accounts.

**Implementation effect:** Firebase project ownership, Auth allowlist, and Security Rules must be documented. Production access must not depend on a developer personal account.

## Existing Plan Disposition

| Existing file | Disposition |
|---|---|
| `2026-05-15-apps-script-sheets-sync-migration.md` | Superseded. Do not implement Apps Script + Sheets; rewrite Plan B for Firebase Firestore + Vercel. |
| `2026-05-14-phase-1-3-google-sheets-sync-offline.md` | Superseded by Firebase Firestore offline/realtime sync direction. |
| `2026-05-15-free-backend-architecture-exploration.md` | Backend choice superseded by independent EasyOrder Firebase project + Vercel. |
| `2026-05-15-data-migration-strategy.md` | CSV import direction superseded; keep only general historical-data safety ideas if still useful. |
| `2026-05-15-deployment-hosting-strategy.md` | Update to Firebase project + Vercel hosting. |
| `2026-05-15-frontend-security-considerations.md` | Keep and update for Firebase Auth, Firestore rules, and local Firestore cache risk. |
| `2026-05-15-cross-platform-android-support.md` | Keep for Phase 2. |
| `2026-05-14-phase-2-ipad-face-handoff.md` | Keep for Phase 2. |
| `2026-05-15-user-operation-sop-ux-analysis.md` | Reference for training and pilot drill, not a separate implementation plan. |

## Recommended Decision Defaults

Use these confirmed decisions when writing or dispatching implementation plans:

- A1: initial opening cash is set once; later drawer changes use counter deposit/withdraw ledger entries with operator, time, amount, and reason.
- A2: no vendor payout in daily settlement.
- A3: W mode handles missed payment.
- A4: no before/after vendor count split.
- A5: allow multiple meals on one account with prompt; shared student numbers are normal.
- A6: any counter staff member can override one order price; record responsibility on the operator.
- A7: no debt limit in Phase 1.
- B1: Firebase Firestore + Vercel; independent EasyOrder Firebase project; no Apps Script + Sheets.
- B2: company Google Workspace/admin account owns backend data; separate from `talented-payroll`.
- B3: Firestore realtime sync for transactions when online.
- B4: offline closeout allowed; show `🟢已同步` / `🟡同步中` / `🔴離線待同步`; Firestore syncs later.
- B5: multiple computers may operate concurrently; use Firestore atomic transactions with optimistic retry.
- B6: individual Google Workspace staff login; record operator identity.
- B7: no admin dashboard; counter frontend handles full accounting workflows.
- B8: Firebase Auth + Firestore Security Rules; no shared-secret/HMAC Apps Script auth.
- B9: create/deactivate students in POS; no CSV import; history remains intact.
- C1: paper and system run in parallel; cloud is backup + sync and supports switching computers.
- C2: offline cold start required before real launch.
- C3: one browser per operating device; Phase 2 handles iPad/Android face-recognition ordering.
- C4: local Firestore cache accepted with runbook and device controls.
- C5: counter staff own backup/restore.
- C6: backend permissions under `cheerc@talented.com.tw`; frontend login uses whitelist.

## Definition Of Done

- The user-confirmed decisions above are recorded through AgEnD `decision(action: post)` before implementation dispatch.
- Plan A implementation cites this checklist for counter cash, multiple meals, price override, and debt-limit behavior.
- The old Apps Script + Sheets Plan B is not dispatched for implementation.
- The replacement Plan B cites this checklist and specifies Firebase project setup, Firebase Auth, Firestore schema, Firestore Security Rules, Vercel deployment, realtime listeners, offline persistence, and multi-device conflict handling.
- Student lifecycle implementation creates/deactivates students in the POS/frontend and preserves historical transaction snapshots.
- Backup/restore and local-data runbooks assign responsibility to counter staff and document the `cheerc@talented.com.tw` admin ownership boundary.
