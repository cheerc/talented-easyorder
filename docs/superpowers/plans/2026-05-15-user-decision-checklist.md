# User Decision Checklist For EasyOrder Phase 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans if turning any decision below into implementation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the user one concise decision list before implementing the counter-cash and Apps Script sync plans.

**Architecture:** Decisions are grouped by product area and each item has options, a recommendation, and the implementation effect. This document is not a code task list; it is the approval gate for Plan A and Plan B.

**Tech Stack:** Project documentation, AgEnD decision records, EasyOrder frontend and Apps Script plans.

---

## How To Use This Checklist

1. The lead sends this file to the user/operator.
2. The user answers each required item.
3. The lead records accepted answers with `decision(action: post)` before dispatching implementation.
4. Implementation plans may proceed with recommended defaults only when the item says "safe default".

## Required Decisions Before Plan A

### A1. Opening Cash Default

**Question:** Is the petty-cash opening amount fixed, configurable per day, or configured once per school/term?

**Options:**
- A. Fixed default `4000`, editable per day.
- B. Fixed default `3000`, editable per day.
- C. Admin-configured school default, copied into each day.

**Recommendation:** C for production, A as the implementation default. The UI should prefill `4000` but allow the operator to edit the opening cash for that business date.

**Implementation effect:** `dailyCashSession.openingCash` must be stored per business date. A future admin setting may provide the default.

### A2. Vendor Payout Tracking

**Question:** Does the counter pay the lunch vendor from the drawer every day?

**Decision from current discussion:** No. The vendor is monthly billed.

**Recommendation:** Do not implement vendor payout in Phase 1.

**Implementation effect:** Settlement formula is `expectedDrawerCash = openingCash + netCash`. Do not subtract vendor payout.

### A3. Late Payment / Missed Payment Correction

**Question:** Should missed payment discovered later get a special "補登" UI?

**Decision from current discussion:** No.

**Recommendation:** Use the existing W mode, renamed `補錢 / 儲值`.

**Implementation effect:** No new backfill screen. The POS workflow remains: search student -> W -> enter amount -> confirm.

### A4. Cancellation Semantics

**Question:** Should cancellation distinguish before vs after the vendor count was phoned in?

**Decision from current discussion:** No.

**Recommendation:** Show only current effective order count.

**Implementation effect:** `cancel` continues to affect local effective count. No vendor-count lock or policy state is added.

### A5. Multiple Meals On One Account

**Question:** Can one account order more than one meal in a day?

**Options:**
- A. Allow, with duplicate warning only.
- B. Allow, but require a reason/category such as `多孩同帳號`, `加訂`, `老師代訂`.
- C. Block by default; admin override required.

**Recommendation:** B. This matches the real "parent uses one account for multiple children" case while preserving audit clarity.

**Implementation effect:** Plan A duplicate warning can stay, but a later small enhancement should add optional reason text when confirming a duplicate order.

### A6. Single-Order Price Override

**Question:** Who may change one order's price?

**Options:**
- A. Any counter operator during order confirmation.
- B. Admin only.
- C. No override; change today's global menu price only.

**Recommendation:** A for Phase 1. The action is visible, local to one selected transaction, and recorded in transaction note.

**Implementation effect:** Add `改本筆價格` in POS confirmation; do not mutate `todayMenu.price`.

### A7. Debt Limit

**Question:** Are students allowed to go into debt without a limit?

**Options:**
- A. No limit in pilot; show warning when balance becomes negative.
- B. Soft warning threshold, e.g. debt over 300 requires confirmation.
- C. Hard block after a configured limit.

**Recommendation:** A for pilot, B for production after staff confirms policy.

**Implementation effect:** Current negative-balance warning is enough for Plan A. Do not add approval gates yet.

## Required Decisions Before Plan B

### B1. Backend Authority

**Question:** Is Google Sheets the visible operational database and Phase 1 backend source?

**Decision from current discussion:** Yes, via Apps Script.

**Recommendation:** Apps Script + Google Sheets for Phase 1; Cloudflare D1 remains fallback only.

**Implementation effect:** Implement Apps Script `doGet`/`doPost`, not Cloudflare Worker/D1.

### B2. Meaning Of Free

**Question:** Does "free" allow a free-tier provider account, or must it use only the user's existing Google account?

**Options:**
- A. Existing Google account only.
- B. Free-tier provider allowed if no normal monthly cost.
- C. Free-tier provider allowed with billing account/credit card.

**Recommendation:** A based on the latest discussion.

**Implementation effect:** Plan B uses Apps Script and Sheets. Deployment/hosting plan must not assume Cloudflare unless later approved.

### B3. Sync Freshness

**Question:** Is near-realtime multi-device sync required?

**Options:**
- A. No. Pull at opening and foreground sync/retry after each transaction is enough.
- B. Poll every 15-30 seconds.
- C. Near-realtime push/realtime channel.

**Recommendation:** A for Phase 1. The lunch counter scale is about 40 students and roughly 50 daily transactions.

**Implementation effect:** Implement foreground outbox push and bootstrap pull first. Do not add realtime infrastructure.

### B4. Closeout With Queued Rows

**Question:** May the operator close the day while some rows are queued but not yet uploaded?

**Options:**
- A. Block closeout until every row is synced.
- B. Allow closeout only with explicit queued-row acknowledgement.
- C. Always allow closeout and sync later.

**Recommendation:** B. Failed/conflict rows must block; queued rows can close only with an explicit visible receipt because school network may be unreliable.

**Implementation effect:** Existing closeout gate should block failed/conflict rows and require acknowledgement for queued rows.

### B5. Conflict Resolution

**Question:** What happens if two devices update the same accounting state?

**Options:**
- A. Last-write-wins.
- B. Apps Script revision check returns conflict; operator resolves after pulling latest state.
- C. CRDT/merge logic.

**Recommendation:** B. Last-write-wins is unsafe for accounting; CRDT is unnecessary.

**Implementation effect:** Sync events include `baseServerRevision`; Apps Script returns `conflict` when revision checks fail.

### B6. Staff Identity

**Question:** Does production require per-staff accounts?

**Options:**
- A. Shared counter identity/PIN for pilot.
- B. Per-staff name/PIN selected at shift start.
- C. Google account sign-in per staff member.

**Recommendation:** A for pilot, B for production if audit accountability matters. Avoid Google OAuth complexity in Phase 1 unless the school requires it.

**Implementation effect:** Plan B can write `operatorId='counter'` initially. Store schema should still keep `operatorId` fields.

### B7. Sheet Access Policy

**Question:** Who can directly edit the Google Sheet?

**Options:**
- A. Director/admin read-only; Apps Script is the only writer.
- B. Director/admin can edit students only.
- C. Director/admin can edit any sheet.

**Recommendation:** B. Direct edits to transactions or settlements can break idempotency and revisions.

**Implementation effect:** Runbook must say transaction and settlement sheets are append-only via Apps Script.

### B8. Apps Script Web App Access / Auth

**Question:** Who can invoke the Apps Script web app, and how are requests authenticated?

**Options:**
- A. **Restricted school Google accounts only** — Deploy the web app with "Who has access: specific accounts" (school-owned operator/admin accounts). The `doPost` endpoint additionally validates a shared secret (`X-EasyOrder-Secret` header) stored in `ScriptProperties` for defense-in-depth. Unauthorized requests return HTTP 401.
- B. **Execute-as-school-owner + signed/shared-secret API requests** — Deploy as school owner with shared secret validation only (no per-account Google auth on the web app). Simpler but relies entirely on secret secrecy.
- C. **Public link (forbidden for production)** — The web app is accessible to anyone with the URL. No auth. Rejected for production because accounting data is sensitive.

**Recommendation:** A. Defense-in-depth: Google account restriction on the deployment _and_ shared secret validation in `doPost`. This is the strongest option that still uses only the school's existing Google account.

**Implementation effect on Plan B:** Plan B's `Code.gs` must validate `X-EasyOrder-Secret` in `doPost` and return 401 for unauthorized requests. The frontend outbox (`pushOutboxEvents`) must include the secret header. The secret is stored in `VITE_SYNC_SECRET` (frontend env config) and `EASYORDER_SYNC_SECRET` (Apps Script `ScriptProperties`). Secret rotation requires redeploying the Apps Script and updating the frontend env.

### B9. Student Import Path

**Question:** Where does existing Excel data get imported?

**Options:**
- A. Excel -> CSV -> app preview -> Sheets students tab -> app bootstrap pull.
- B. Excel -> direct manual paste into Sheets.
- C. Excel -> app imports directly into local storage.

**Recommendation:** A. It gives validation and keeps Sheets visible as the master roster.

**Implementation effect:** Add student import runbook and keep transaction CSV import out of production ledger.

## Required Decisions Before Deployment / Pilot

### C1. Pilot Can Launch Without Real Sync

**Question:** Can the pilot launch before real sync exists if UI clearly says local-only/demo?

**Options:**
- A. Yes, for training/demo only.
- B. Yes, for real lunch service with manual export backup.
- C. No, real service requires sync and backup first.

**Recommendation:** A. Do not use local-only mode for real money unless the operator explicitly accepts manual backup risk.

### C2. Offline Cold Start

**Question:** Must the PWA open from the Home Screen when the network is already down?

**Options:**
- A. Required for launch.
- B. Not required; already-loaded app continuity is enough.

**Recommendation:** A if the app is used for real lunch service. The operator should run a pre-lunch readiness check anyway.

### C3. Device Install Rule

**Question:** Can the runbook require exactly one production PWA install per device?

**Options:**
- A. Yes. Duplicate Home Screen installs must be removed.
- B. No. Staff may use multiple browser profiles/icons.

**Recommendation:** A. iPad/PWA duplicate installs can isolate storage and create split local queues.

### C4. Local Data Risk

**Question:** Does the school accept that offline POS stores student/accounting data on the device?

**Options:**
- A. Yes, with minimization, clear-data runbook, and device access controls.
- B. No, do not store sensitive data locally.

**Recommendation:** A. Offline POS cannot work without local data.

### C5. Backup And Restore Owner

**Question:** Who owns backup/export and restore drills?

**Options:**
- A. Director/admin.
- B. Counter operator.
- C. Developer/support only.

**Recommendation:** A. Counter operator should not own restore decisions during service.

### C6. Account Ownership

**Question:** Which Google account owns the Spreadsheet and Apps Script?

**Options:**
- A. School-owned shared/admin Google account with recovery/2FA.
- B. Individual staff personal Google account.
- C. Developer account.

**Recommendation:** A. Production data should not depend on a developer or individual staff account.

## Existing Plan Disposition

| Existing file | Disposition |
|---|---|
| `2026-05-14-phase-1-3-google-sheets-sync-offline.md` | Replaced by Plan B. |
| `2026-05-15-free-backend-architecture-exploration.md` | Backend choice superseded by Apps Script/Sheets for Phase 1. |
| `2026-05-15-data-migration-strategy.md` | Student import and backup parts fold into Plan B; broader IndexedDB migration remains reference. |
| `2026-05-15-deployment-hosting-strategy.md` | Keep; update after B2/C6 decisions. |
| `2026-05-15-frontend-security-considerations.md` | Keep; lower priority but local data risk decision is required. |
| `2026-05-15-cross-platform-android-support.md` | Keep for Phase 2. |
| `2026-05-14-phase-2-ipad-face-handoff.md` | Keep for Phase 2. |
| `2026-05-15-user-operation-sop-ux-analysis.md` | Reference for training and pilot drill, not a separate implementation plan. |

## Recommended Decision Defaults

If the user wants to proceed without answering every item, use these defaults:

- A1: default 4000, editable per day.
- A2: no vendor payout.
- A3: W mode handles missed payment.
- A4: no before/after vendor count split.
- A5: allow duplicate/multiple meals with reason in later enhancement.
- A6: counter operator can override one order price.
- A7: no debt limit in pilot.
- B1: Apps Script + Sheets.
- B2: existing Google account only.
- B3: no realtime sync for Phase 1.
- B4: block failed/conflict, allow queued only with acknowledgement.
- B5: revision conflict, no last-write-wins.
- B6: shared counter identity for pilot.
- B7: admin can edit students only; transactions/settlements append via Apps Script.
- B8: restricted school Google accounts + shared secret auth; public link forbidden.
- B9: Excel -> CSV -> preview -> Sheets students.
- C1: local-only training only, not real service.
- C2: offline cold start required before real launch.
- C3: exactly one production PWA install per device.
- C4: local data accepted with runbook.
- C5: director/admin owns backup and restore.
- C6: school-owned Google account owns production Sheets/Apps Script.

## Definition Of Done

- The user has answered or accepted defaults for all Plan A and Plan B required decisions.
- Accepted answers are recorded through AgEnD `decision(action: post)`.
- Implementation dispatch cites this checklist plus the exact Plan A or Plan B file path.
- Any future Cloudflare/D1 work is explicitly marked fallback or Phase 2, not the Phase 1 default.
