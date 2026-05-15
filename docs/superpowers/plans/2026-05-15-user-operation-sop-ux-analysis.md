# User Operation SOP And UX Blind Spot Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:writing-plans` for any follow-up implementation plan. This document is an operation/SOP and UX risk plan; do not implement product code directly from it until the `DISCUSS WITH USER` points are resolved.

**Goal:** Convert the PDF's school-lunch operating model and the current frontend prototype into a concrete operator SOP, then identify UX blind spots that could create wrong orders, wrong cash, privacy leaks, or false confidence during network/iPad failures.

**Architecture:** Treat the PC web POS as the accounting authority. Treat iPad face recognition as an input sensor that can select a student on the PC, not as an autonomous checkout or payment surface. SOP, UI copy, validation, sync status, report editing, and daily closeout must all reinforce that authority boundary.

**Tech Stack:** Vite 8, React 19, TypeScript 6, Zustand 5, Vitest 4, React Testing Library, local-first POS domain modules, future IndexedDB sync queue, Cloudflare deployment stack if Plan 2 is approved, and PDF-driven campus operation runbooks.

---

## Required Reads Completed

- `docs/iPad人臉辨識訂餐系統設計方案_V3.pdf`
- `docs/superpowers/plans/ROADMAP.md`
- `docs/superpowers/plans/2026-05-14-phase-1-1-pc-pos-formalization.md`
- `docs/superpowers/plans/2026-05-14-phase-1-2-reporting-and-settlement.md`
- `docs/superpowers/plans/2026-05-14-phase-1-3-google-sheets-sync-offline.md`
- `docs/superpowers/plans/2026-05-14-phase-2-ipad-face-handoff.md`
- `docs/superpowers/specs/2026-05-14-pc-pos-order-flow-spec.md`
- `docs/superpowers/specs/2026-05-14-order-ledger-cash-close-spec.md`
- `docs/superpowers/specs/2026-05-14-google-sheets-sync-offline-spec.md`
- `docs/superpowers/specs/2026-05-14-ipad-face-auth-handoff-spec.md`
- `frontend/src/App.tsx`
- `frontend/src/components/pos-components.tsx`
- `frontend/src/components/screens.tsx`
- `frontend/src/store/posStore.ts`
- `frontend/src/domain/posFlow.ts`
- `frontend/src/domain/posTransaction.ts`
- `frontend/src/domain/ledger.ts`

## Source Evidence Summary

### PDF Operating Model

1. Phase 1 is a PC web POS. The core workflow is search -> display -> action -> automatic close/reset.
2. The PDF expects dual search: direct student id search and fuzzy name search.
3. One person has one order record for the day, so duplicate handling must be explicit.
4. The system replaces paper slips. Order, top-up, cancel, payment, and settlement records become the reconciliation basis.
5. Daily closeout compares counted cash with expected system cash and tracks the 4,000 petty-cash baseline.
6. Phase 2 iPad face recognition is only the identification sensor. On success it pushes the student id/name to the PC flow.
7. The iPad privacy boundary is strict: show recognition success and student name only, never balance, debt, cash, or order amount.
8. The PDF says iPad local recognition can work without network and later補登. For this product plan, that wording must be constrained by the later specs: iPad may identify offline, but the PC remains the order/payment authority.

### Current Frontend Prototype

1. `App.tsx` already has a fast counter flow: query suggestions, picked student, order/top-up/cancel modes, duplicate warning, confirm banner, and date locking for POS.
2. `App.tsx` currently sets `online = true` and simulates sync with a timeout. The UI can say "雲端已同步" even though no real sync exists.
3. Amount entry in `App.tsx` uses `Number(payAmount || 0)` directly. It does not use `parsePaidAmount` from `frontend/src/domain/posTransaction.ts`, so negative, decimal, non-integer, or accidental values are not centrally rejected.
4. POS historical mode is locked, but `ReportScreen` still receives `onUpdate` and `onDelete` for any selected `viewDate`.
5. `ReportScreen` has visible buttons for print, CSV export, and cloud push, but they do not execute real flows.
6. `ReportScreen` allows direct inline edit/delete with browser confirm only. There is no correction reason, operator id, void transaction, audit trail, or settlement revision.
7. `AdminScreen` can reset all app data through `resetData`; this is acceptable for prototype data but dangerous as production copy.
8. `AdminScreen` menu price/vendor changes are immediate and have no service-start warning, post-transaction lock, or settlement impact preview.
9. Current durable storage is Zustand `persist` to `localStorage` under `pos-storage`.
10. Domain types already include stronger concepts than the UI uses: `syncStatus`, explicit POS flow states, correction/void transaction types, and amount parsing.

## Operating Principles

- Accounting truth lives on the PC POS and its ledger, not on the iPad.
- The operator must always know whether a transaction is local-only, queued, synced, failed, or conflicted.
- A transaction that affects cash or student balance must never be silently edited or deleted.
- The daily closeout is not optional. If counted cash and expected cash disagree, the system should preserve a discrepancy note and block false "all synced/all closed" language.
- Historical business dates are read-only unless an authorized correction/reopen flow is active.
- Privacy defaults matter because the counter is public. Search suggestions and iPad output must minimize unnecessary financial exposure.
- The SOP must support peak lunch pressure: minimal typing, clear next action, fast recovery, and no modal that traps the operator without a meaningful choice.

## Target Operator SOP

### 1. Pre-Lunch Setup

1. Open EasyOrder on the counter PC before service starts.
2. Confirm the business date is today's lunch date.
3. Confirm menu name, vendor, and meal price before the first transaction.
4. Confirm the cash drawer starts with the approved 4,000 petty-cash baseline.
5. Confirm sync/storage status is safe:
   - Green/synced: service can start normally.
   - Offline/queued: service may start only if the operator understands transactions are local-first and must be flushed before closeout.
   - Failed/conflict: fix or escalate before service starts unless the user explicitly accepts emergency local-only operation.
6. If iPad recognition is active, confirm the iPad can reach the PC handoff channel and has the expected profile set.
7. Do not change menu price/vendor after the first order unless using an authorized correction procedure.

### 2. Normal Lunch Order

1. Student says student id/name, or iPad recognition sends the student identity to the PC.
2. Operator checks the selected student's name and id.
3. Operator selects `訂便當` or uses the default order mode.
4. If the student pays cash now, enter the received amount. If the student records debt, leave order payment blank only when debt is allowed by policy.
5. Operator confirms.
6. System shows a short result banner with student, amount, and after-balance.
7. Operator dismisses and continues to the next student.

### 3. Payment Without New Order

1. Search/select student.
2. Choose `純繳費 / 儲值`.
3. Enter the received cash amount.
4. Confirm and check the after-balance.
5. If the student is paying previous debt, the SOP must define whether this is still recorded as top-up or as a debt-payment subtype.

### 4. Duplicate Order Warning

1. If the student already has an active order today, the PC must stop at duplicate warning.
2. Operator chooses one of:
   - Cancel and return to search.
   - Continue only if school policy allows a second meal for this student/account.
3. The continued duplicate order should be auditable, because it can be a real second meal, an input error, or a sibling/account edge case.

### 5. Same-Day Cancel And Refund

1. Search/select student.
2. Choose `取消當日訂餐`.
3. System shows the active order count and refund implication.
4. Operator enters refunded cash only if cash is physically returned.
5. Confirm.
6. Cancellation should be a ledger transaction, not destructive deletion of the original order.

### 6. Mistake Recovery

Wrong student, wrong amount, wrong menu, and accidental duplicate must not be fixed by silent row edits.

Required SOP:

1. Open the affected transaction in today's report.
2. Choose correction or void.
3. Enter a required reason.
4. System records the operator, time, original row, corrected row, and settlement impact.
5. If closeout already happened, authorized reopen/revision is required.

### 7. Network Outage

1. Continue PC service only if the app clearly shows local-first/offline mode and the local queue is writable.
2. Do not refresh or reinstall the app while unsynced local transactions exist.
3. Do not create manual duplicate rows in Google Sheets during the outage unless the emergency paper fallback procedure is activated.
4. When network returns, let the app flush queued transactions.
5. Fix failed/conflict rows before daily closeout.

### 8. iPad Recognition Failure Or Disconnection

1. If recognition fails, student goes to the counter and operator uses PC search.
2. If the iPad recognizes a student but cannot hand off to the PC, the iPad must not imply the order is complete.
3. If the PC cannot receive the iPad handoff, service continues through PC manual search.
4. The iPad never shows balance, debt, payment, settlement, or closeout data.

### 9. Daily Closeout

1. Stop accepting new counter transactions for the business date.
2. Confirm all sync queues are synced, or explicitly document failed/conflict rows.
3. Count physical cash.
4. Enter counted cash.
5. System compares counted cash with expected cash, including the 4,000 petty-cash baseline policy.
6. If there is a discrepancy, enter a required note before closing.
7. Export/print/share the daily report as required by school workflow.
8. Lock the business date. Later changes require correction/reopen.

## UX Blind Spots And Risks

### P0 - Must Fix Before Real Operation

1. **False cloud-sync confidence.** The current TopBar can show "雲端已同步" from a hardcoded `online = true` and timeout. This must be removed or labeled as prototype-only before any real user test that could be mistaken for production.
2. **Unsafe amount parsing.** `App.tsx` converts payment input with `Number(payAmount || 0)` instead of the domain parser. Negative, decimal, empty top-up, and accidental non-integer cases need explicit UI validation and tests.
3. **Historical report mutation.** POS locks historical dates, but report edit/delete remains available for `viewDate` history. Historical dates must be read-only unless a formal correction/reopen flow is active.
4. **Destructive ledger edits.** Inline report edit/delete breaks auditability. Order/payment/cancel mistakes should become correction or void ledger entries with reasons.
5. **No daily cash-close workflow.** The PDF requires counted cash vs system expected cash and petty-cash tracking. Current UI has report totals, but no closeout, discrepancy, lock, reopen, or settlement revision flow.
6. **Production-danger reset.** `resetData` can wipe current data and reload. This must be removed, restricted to dev/demo mode, or protected behind an explicit environment gate before pilot.
7. **iPad authority ambiguity.** The PDF's offline補登 wording can be misread as autonomous iPad ordering. Product copy and SOP must state that iPad identifies only; PC confirms the transaction.

### P1 - Fix Before Pilot Expansion

1. **Business date is easy to change.** The TopBar date picker is powerful but risky during service. Switching away from today should require clear read-only context and easy return.
2. **Report range controls are non-functional.** Today/week/month/custom buttons do not change the actual input dataset. Dead controls create operator mistrust.
3. **Print/export/cloud buttons are non-functional.** Visible but inert reporting actions should be hidden, disabled with honest copy, or implemented before operations training.
4. **Ambiguous search recovery is under-specified.** Fuzzy search works, but SOP/UI needs clear no-result, many-result, inactive student, duplicate names, and unknown-student flows.
5. **Duplicate warning lacks policy choices.** The current warning is binary continue/cancel. The system should capture why a duplicate is allowed if school policy permits it.
6. **Menu changes after service start are not guarded.** Changing price/vendor mid-day affects operator expectations and report meaning.
7. **Student management is incomplete.** Only the first 10 students are shown and "新增學員" has no implementation. Missing-student SOP must be explicit.
8. **Sync status lacks actionable detail.** Operator needs queue count, last success, failed/conflict count, and recovery action, not just a badge.

### P2 - Training And Polish

1. Keyboard shortcuts are useful but need a printable one-page cheat sheet and optional on-screen discoverability.
2. The confirm banner protects against accidental next search, but peak-lunch timing should be tested. If it slows service, consider a short auto-dismiss only after audit and accessibility review.
3. Theme tweak controls are useful for demos but should not distract production operators during service.
4. Vendor phone/count workflow is not connected to a "call vendor / confirm prepared count" SOP.
5. iPad PWA installation can create duplicate local app icons/stores. The setup SOP needs a one-device-one-install rule.

## Implementation Plan

### Step 1 - Write Operator Runbooks

- [ ] Add `docs/ops/lunch-counter-sop.md` with pre-lunch setup, normal order, payment, duplicate, cancel/refund, mistake recovery, and closeout.
- [ ] Add `docs/ops/offline-recovery-sop.md` with local-first service, queue safety, reconnect flush, failed/conflict handling, and "do not reinstall/refresh during unsynced queue" warnings.
- [ ] Add `docs/ops/ipad-fallback-sop.md` with recognition failure, handoff failure, privacy boundaries, and PC manual-search fallback.
- [ ] Add `docs/ops/daily-closeout-sop.md` with counted cash, expected cash, petty-cash baseline, discrepancy note, export, lock, and reopen rules.
- [ ] Add `docs/training/lunch-counter-cheat-sheet.md` as a printable one-page operator guide.

### Step 2 - Make Status Copy Truthful

- [ ] Replace prototype sync copy in `frontend/src/App.tsx` and `frontend/src/components/pos-components.tsx`.
- [ ] Do not display "雲端已同步" until a real sync adapter exists.
- [ ] Add explicit local-only/demo wording for the current prototype state.
- [ ] Define status states that match the sync spec: online, syncing, offline, queued, failed, conflict.
- [ ] Add tests that prevent hardcoded green sync status from returning.

### Step 3 - Wire Payment Validation Into POS

- [ ] Use `parsePaidAmount` from `frontend/src/domain/posTransaction.ts` in the POS confirm path.
- [ ] Define mode-specific rules:
  - Order may allow blank payment only if debt is allowed.
  - Top-up/payment requires a positive integer.
  - Cancel refund must be a non-negative integer and should not exceed policy without authorization.
- [ ] Show validation errors near the amount input without losing the selected student.
- [ ] Add Vitest tests for blank, zero, negative, decimal, text, large amount, and quick amount paths.

### Step 4 - Formalize Correction Instead Of Edit/Delete

- [ ] Disable report edit/delete for historical dates.
- [ ] Replace destructive delete with void/correction flow in today's report.
- [ ] Require reason, operator identity placeholder, original transaction id, and settlement impact.
- [ ] Add ledger-level tests proving corrections preserve audit history and recalculate balances.
- [ ] Align this with `docs/superpowers/specs/2026-05-14-order-ledger-cash-close-spec.md`.

### Step 5 - Add Daily Closeout Scope

- [ ] Implement or plan the `DailyCloseout` domain object before adding UI.
- [ ] Track counted cash, expected cash, petty-cash baseline, discrepancy, notes, close time, operator, and revision status.
- [ ] Add UI flow after report totals, not inside the fast POS panel.
- [ ] Block closeout if failed/conflict sync rows exist unless the user approves an emergency local-only closeout policy.
- [ ] Lock the business date after closeout.

### Step 6 - Constrain iPad UX And Handoff

- [ ] Add SOP copy that iPad recognition never completes an order.
- [ ] Ensure future iPad screen only displays recognition success/name and handoff result.
- [ ] If handoff fails, display "請到櫃台" style copy, not order/payment status.
- [ ] Add integration tests for PC handoff accepting identity while PC remains the only transaction committer.

### Step 7 - Run Story-Based Usability Drills

- [ ] 10-student peak lunch drill using keyboard and mouse.
- [ ] Duplicate order drill.
- [ ] Wrong amount correction drill.
- [ ] Cancel/refund drill.
- [ ] Network outage before, during, and after confirm.
- [ ] iPad no-match and handoff-disconnected drills.
- [ ] End-of-day discrepancy closeout drill.

## Expected File-Level Follow-Up

Likely documentation files:

- `docs/ops/lunch-counter-sop.md`
- `docs/ops/offline-recovery-sop.md`
- `docs/ops/ipad-fallback-sop.md`
- `docs/ops/daily-closeout-sop.md`
- `docs/ux/operation-blind-spots.md`
- `docs/training/lunch-counter-cheat-sheet.md`

Likely frontend files:

- `frontend/src/App.tsx`
- `frontend/src/components/pos-components.tsx`
- `frontend/src/components/screens.tsx`
- `frontend/src/store/posStore.ts`
- `frontend/src/domain/posTransaction.ts`
- `frontend/src/domain/ledger.ts`
- `frontend/src/domain/posFlow.ts`
- `frontend/src/domain/dailyCloseout.ts`
- `frontend/src/domain/*.test.ts`
- `frontend/src/components/*.test.tsx`

## Verification Plan

1. Documentation verification:
   - SOP covers every PDF operational promise: dual search, one-person-one-order, paperless ledger, daily cash close, iPad privacy, and offline recovery.
   - SOP explicitly states PC authority and iPad input-only behavior.
   - SOP has an emergency procedure for offline operation and failed/conflict sync rows.
2. Unit verification:
   - Amount parsing rejects invalid values and preserves valid blank-order debt policy.
   - Ledger correction/void keeps original transaction history.
   - Historical business dates are read-only by default.
3. Component verification:
   - POS shows truthful sync/local-only states.
   - Report action buttons are either implemented or honestly disabled.
   - Closeout UI blocks close when required data is missing.
4. Manual drill verification:
   - A trained operator can complete 10 normal orders without reading developer docs.
   - Mistake recovery produces auditable rows.
   - Offline and iPad failure drills do not produce duplicate accounting truth.

## DISCUSS WITH USER

1. Is the 4,000 petty-cash baseline fixed for every day, or can an admin change it per school/term?
2. Is debt allowed for all students, or does it need a limit/approval rule?
3. Can a student/account order more than one meal in a day? If yes, what reason categories are needed?
4. Who is allowed to correct, void, reopen, or revise a closed business date?
5. At daily closeout, may the operator close with unsynced local transactions, or must failed/conflict rows block closeout?
6. Can the pilot launch before real sync exists, if the UI says local/demo-only clearly?
7. What exact message should the iPad show when it recognizes a student but cannot reach the PC?
8. Should training artifacts use Taiwan Mandarin terms only, or include bilingual labels for school staff?

## Definition Of Done For Follow-Up Implementation

- SOP documents exist and match the approved school policy answers.
- Prototype-only sync claims are removed or gated.
- POS payment validation uses shared domain parsing.
- Report mutation becomes correction/void with reason and audit trail.
- Historical dates are read-only unless explicitly reopened.
- Daily closeout has a defined data model and operator flow.
- iPad flows cannot imply payment or order completion.
- Story drills are documented with pass/fail evidence.
