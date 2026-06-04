# Phase 1.2 Reporting And Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the report screen an auditable ledger and daily closeout tool with deterministic totals, formal close/reopen state, correction/void audit trails, CSV export, print view models, and clear Google Sheets sync boundaries.

**Architecture:** Add pure ledger reporting, audit, cash-close, export, and sync-boundary modules under `frontend/src/domain/`, then integrate them into Zustand as stored accounting state rather than report-only UI state. `ReportScreen` becomes a composed workflow surface: range filters and grouped rows are projections, while corrections, voids, close, and reopen create domain records consumed by POS locks and future sync.

**Tech Stack:** Vite 8, React 19, TypeScript 6, Zustand 5, Vitest 4, Testing Library, current `frontend/` verification chain.

---

## Source Specs

- `docs/superpowers/specs/2026-05-14-order-ledger-cash-close-spec.md`
- `docs/superpowers/specs/2026-05-14-pc-pos-order-flow-spec.md`
- `docs/superpowers/specs/2026-05-14-google-sheets-sync-offline-spec.md`
- `docs/superpowers/plans/2026-05-14-phase-1-0-foundation-hardening.md`
- `docs/superpowers/plans/2026-05-14-phase-1-1-pc-pos-formalization.md`
- `docs/superpowers/plans/ROADMAP.md`

## Phase Estimate

- Total estimate: 6-8 dev days.
- Complexity: high. This phase replaces unsafe report mutations with auditable accounting workflows while preserving a dense, fast report surface.
- Recommended PR split:
  - PR 1: ledger projections, totals, audit policy, correction/void domain, and store integration.
  - PR 2: cash close/reopen, closed-date locks, CSV/print export, sync-boundary payloads, and integration tests.

## Task Board Breakdown

| Task ID | Title | Estimate | Primary Files | Depends On |
|---|---|---:|---|---|
| EO-P12-T01 | Ledger report projections and totals | 1 day / 3 SP | `frontend/src/domain/ledgerReport.ts`, `frontend/src/domain/__tests__/ledgerReport.test.ts` | Phase 1.1 |
| EO-P12-T02 | Audit policy, correction, and void domain | 1.25 days / 5 SP | `frontend/src/domain/ledgerAudit.ts`, `frontend/src/domain/__tests__/ledgerAudit.test.ts` | EO-P12-T01 |
| EO-P12-T03 | Store integration and deterministic balance recalculation | 1 day / 3 SP | `frontend/src/store/posStore.ts`, `frontend/src/store/__tests__/ledgerStore.test.ts` | EO-P12-T02 |
| EO-P12-T04 | Cash close, reopen, settlement revisions, and date locks | 1.25 days / 5 SP | `frontend/src/domain/cashClose.ts`, `frontend/src/domain/__tests__/cashClose.test.ts` | EO-P12-T01, EO-P12-T03 |
| EO-P12-T05 | Report UI correction/void/close workflows | 1.25 days / 5 SP | `frontend/src/components/screens.tsx`, `frontend/src/components/report/*`, `frontend/src/__tests__/reportScreen.integration.test.tsx` | EO-P12-T03, EO-P12-T04 |
| EO-P12-T06 | CSV export and print view models | 0.75 day / 2 SP | `frontend/src/domain/ledgerExport.ts`, `frontend/src/domain/__tests__/ledgerExport.test.ts`, `frontend/src/components/report/ExportActions.tsx` | EO-P12-T01, EO-P12-T04 |
| EO-P12-T07 | Google Sheets sync-boundary payloads | 0.5 day / 2 SP | `frontend/src/domain/ledgerSyncBoundary.ts`, `frontend/src/domain/__tests__/ledgerSyncBoundary.test.ts` | EO-P12-T02, EO-P12-T04 |
| EO-P12-T08 | Phase verification and regression guard | 0.5 day / 1 SP | `frontend/src/__tests__/cashClose.integration.test.tsx`, `frontend/src/__tests__/reportScreen.integration.test.tsx` | EO-P12-T05-T07 |

## Key Technical Decisions

1. Closeout is stored domain state, not a visual label.
   - `DailySettlement` rows are persisted in Zustand.
   - Business-date status is read by POS and report write guards.
   - Closing a date marks it read-only locally before remote sync exists.

2. Ledger projections are pure derived views.
   - Date filters, grouped rows, totals, CSV rows, and print view models derive from ledger rows and settlement rows.
   - Report UI never mutates totals directly.

3. Direct edit/delete is constrained.
   - Direct correction is allowed only for open dates and local draft rows that have not crossed sync or close boundaries.
   - Synced, queued, failed, conflict, closed, or settlement-covered rows use append-only correction or void/reversal records.
   - Every edit, correction, delete, void, close, and reopen creates an audit event.

4. Cash close records actual versus expected cash.
   - `expectedCash` comes from ledger totals.
   - `countedCash` is entered by the accounting user.
   - `difference = countedCash - expectedCash`.
   - Non-zero difference requires a discrepancy note before close can commit.

5. Google Sheets sync is a boundary only in Phase 1.2.
   - This phase defines settlement and audit payload shapes emitted to Phase 1.3.
   - No transport, retry worker, OAuth, Apps Script, backend proxy, or real network write is added here.

## Data Flow

```text
POS committed transactions
  -> ledgerReport projection
  -> report groups/totals
  -> correction/void or close/reopen action
  -> ledgerAudit / cashClose domain record
  -> usePosStore persisted state
  -> POS/report write guards
  -> ledgerExport and ledgerSyncBoundary payloads
```

## Component Tree Impact

`ReportScreen` remains the route-level screen, but its internals should be split so accounting controls are testable:

```text
ReportScreen
  ReportDateRangeControls
  ReportSummaryStats
  CashClosePanel
  LedgerGroupedTable
  CorrectionDialog
  VoidDialog
  ReopenDialog
  ExportActions
```

`App` passes business-date close status to POS write guards after EO-P12-T04. `AdminScreen` and `VendorsScreen` are unchanged unless store type compatibility requires prop adjustments.

## EO-P12-T01: Ledger Report Projections And Totals

**Estimate:** 1 day / 3 SP

**Files:**

- Create: `frontend/src/domain/ledgerReport.ts`
- Create: `frontend/src/domain/__tests__/ledgerReport.test.ts`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define exported report types in `frontend/src/domain/ledgerReport.ts`:

```ts
import type { LedgerTransaction } from './ledger';

export type LedgerDateRangeKind = 'today' | 'week' | 'month' | 'custom';

export interface LedgerDateRange {
  kind: LedgerDateRangeKind;
  startDate: string;
  endDate: string;
}

export interface LedgerTotals {
  orderCount: number;
  orderSalesAmount: number;
  cashCollected: number;
  refundAmount: number;
  netCash: number;
  newDebt: number;
  topUpAmount: number;
  cancellationCount: number;
  transactionCount: number;
}

export interface LedgerGroup {
  studentId: string;
  studentNameSnapshot: string;
  latestCreatedAt: string;
  mealTotal: number;
  paidTotal: number;
  afterBalance: number;
  recordCount: number;
  transactions: LedgerTransaction[];
}
```

- [ ] Implement `createLedgerDateRange(kind, anchorDate, custom)` so:
  - `today` uses `anchorDate` as both start and end.
  - `week` uses Monday through Sunday for the anchor week.
  - `month` uses the first through last date of the anchor month.
  - `custom` requires explicit `startDate` and `endDate`.
- [ ] Implement `filterTransactionsByBusinessDate(transactions, range)`.
- [ ] Implement `getEffectiveLedgerRows(transactions)`:
  - exclude original rows with `voidedAt`.
  - include `correction` and `void` rows because they carry accounting impact.
- [ ] Implement `calculateLedgerTotals(transactions): LedgerTotals` with these formulas:
  - `orderCount`: count rows with `type === 'order'`.
  - `orderSalesAmount`: sum positive `mealPrice` for order rows.
  - `cashCollected`: sum positive `paidAmount` across order and top-up rows.
  - `refundAmount`: absolute value of negative `paidAmount` across cancel, void, and correction rows.
  - `netCash`: `cashCollected - refundAmount`.
  - `newDebt`: sum `Math.max(mealPrice - Math.max(paidAmount, 0), 0)` for order rows.
  - `topUpAmount`: sum positive `paidAmount` for top-up rows.
  - `cancellationCount`: count rows with `type === 'cancel'`.
  - `transactionCount`: count effective rows.
- [ ] Implement `groupLedgerRowsByStudent(transactions): LedgerGroup[]`.
- [ ] Sort groups by latest transaction time descending; sort each group's transactions by created time ascending for readable detail.
- [ ] Export all public types/functions from `frontend/src/domain/index.ts`.

**Testing Strategy:**

- Unit:
  - today/week/month/custom filters use `businessDate`, not UI view date text.
  - totals match the required nine metrics.
  - voided original rows are excluded from totals while void/reversal rows are included.
  - grouped rows show latest time, id, name snapshot, meal total, paid total, after balance, and record count.
  - Traditional Chinese student name snapshots are preserved in groups.
- Integration:
  - Report screen consumes these projections in EO-P12-T05.

**Acceptance Criteria:**

- `ledgerReport.ts` has no React, DOM, localStorage, or Zustand imports.
- The existing report UI can be powered entirely by `LedgerGroup[]` and `LedgerTotals`.
- Tests run with `npx vitest run src/domain/__tests__/ledgerReport.test.ts`.

## EO-P12-T02: Audit Policy, Correction, And Void Domain

**Estimate:** 1.25 days / 5 SP

**Files:**

- Create: `frontend/src/domain/ledgerAudit.ts`
- Create: `frontend/src/domain/__tests__/ledgerAudit.test.ts`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define audit and mutation policy types:

```ts
import type { LedgerTransaction, LedgerSyncStatus } from './ledger';

export type LedgerAuditEventType =
  | 'transaction_edited'
  | 'transaction_corrected'
  | 'transaction_voided'
  | 'transaction_hard_deleted'
  | 'business_date_closed'
  | 'business_date_reopened'
  | 'csv_exported'
  | 'report_printed';

export interface LedgerAuditEvent {
  auditEventId: string;
  eventType: LedgerAuditEventType;
  entityType: 'transaction' | 'settlement' | 'business_date' | 'export';
  entityId: string;
  businessDate: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string;
  operatorId: string;
  createdAt: string;
}

export type LedgerMutationDecision =
  | { action: 'direct_edit'; reasonRequired: boolean }
  | { action: 'append_correction'; reasonRequired: true }
  | { action: 'hard_delete'; reasonRequired: true }
  | { action: 'append_void'; reasonRequired: true }
  | { action: 'blocked'; message: string };
```

- [ ] Implement `decideLedgerEditPolicy(args)`:
  - open date and `syncStatus === 'local'` returns `direct_edit`.
  - open date and `syncStatus` in `queued`, `synced`, `failed`, or `conflict` returns `append_correction`.
  - closed date returns `blocked` with reopen guidance.
  - amount, paid amount, meal price, and type changes require a reason.
  - note-only changes record an audit event but do not require a reason.
- [ ] Implement `decideLedgerDeletePolicy(args)`:
  - open date and `syncStatus === 'local'` with no settlement revision returns `hard_delete`.
  - open date and any non-local sync status returns `append_void`.
  - closed date returns `blocked`.
- [ ] Implement `createLedgerAuditEvent(args)` with deterministic input fields supplied by the caller:
  - `auditEventId`
  - `operatorId`
  - `createdAt`
  - `reason`
- [ ] Implement `createCorrectionTransaction(args)`:
  - creates a `type: 'correction'` ledger row.
  - references `correctsTransactionId`.
  - stores before/after values in the audit event.
  - uses `amount = paidAmount - mealPrice` for corrected accounting impact.
- [ ] Implement `createVoidTransaction(args)`:
  - creates a `type: 'void'` ledger row.
  - references `voidsTransactionId`.
  - reverses the original row's `amount` and cash impact.
  - sets `voidedAt`, `voidedBy`, and `voidReason` on the original row through the store integration.
- [ ] Implement `recalculateStudentAfterBalances(transactions, studentId, openingBalance)` so later rows for that student are recomputed deterministically by `createdAt` and stable id.
- [ ] Export all public types/functions from `frontend/src/domain/index.ts`.

**Testing Strategy:**

- Unit:
  - local open row can direct-edit with audit.
  - queued/synced/failed/conflict rows use append-only correction.
  - closed rows block direct mutation.
  - local open row can hard-delete only before settlement boundary.
  - synced or queued delete creates void/reversal decision.
  - amount/type changes require reason.
  - note-only edit records audit without reason requirement.
  - balance recalculation updates every later row for the same student and leaves other students unchanged.
- Integration:
  - store actions and dialogs covered in EO-P12-T03 and EO-P12-T05.

**Acceptance Criteria:**

- No report UI path can call raw `updateTransaction` or `deleteTransaction` without going through audit policy.
- Synced or closed accounting rows are never destructively rewritten.
- Tests run with `npx vitest run src/domain/__tests__/ledgerAudit.test.ts`.

## EO-P12-T03: Store Integration And Deterministic Balance Recalculation

**Estimate:** 1 day / 3 SP

**Files:**

- Modify: `frontend/src/store/posStore.ts`
- Create: `frontend/src/store/__tests__/ledgerStore.test.ts`

**Implementation Plan:**

- [ ] Extend `PosState` with accounting state:

```ts
import type { DailySettlement } from '../domain/cashClose';
import type { LedgerAuditEvent } from '../domain/ledgerAudit';

interface PosState {
  auditEvents: LedgerAuditEvent[];
  dailySettlements: DailySettlement[];
  businessDateStatuses: Record<string, 'open' | 'closed' | 'reopened'>;
}
```

- [ ] Replace direct report mutation actions with audited actions:

```ts
interface LedgerCorrectionInput {
  transactionId: string;
  updates: Partial<Transaction>;
  reason: string;
  operatorId: string;
}

interface LedgerVoidInput {
  transactionId: string;
  reason: string;
  operatorId: string;
}

interface PosState {
  correctTransaction: (input: LedgerCorrectionInput) => void;
  voidTransaction: (input: LedgerVoidInput) => void;
  hardDeleteLocalDraft: (input: LedgerVoidInput) => void;
}
```

- [ ] Keep `updateTransaction` and `deleteTransaction` temporarily as internal compatibility wrappers only if existing components still compile during the PR; make them delegate to audited actions or remove them in EO-P12-T05.
- [ ] When correction changes an amount, call `recalculateStudentAfterBalances` and update the affected student's current balance.
- [ ] When a void/reversal row is created, mark the original row with void metadata and append the reversal row.
- [ ] Persist `auditEvents`, `dailySettlements`, and `businessDateStatuses` through the existing Zustand persist middleware.
- [ ] Add localStorage migration logic:
  - missing `auditEvents` hydrates as `[]`.
  - missing `dailySettlements` hydrates as `[]`.
  - missing `businessDateStatuses` hydrates as `{}`.
  - existing transaction rows without `syncStatus` hydrate as `local`.
- [ ] Ensure transactions continue using stable ids and never array index identity.

**Testing Strategy:**

- Store:
  - correction appends audit event and updates balances.
  - correction of queued/synced row appends correction row instead of mutating the original.
  - void of synced row marks original voided and appends reversal.
  - hard delete is allowed only for local open draft row.
  - closed business date blocks correction, void, and hard delete.
  - legacy persisted state hydrates with empty audit/settlement/status collections.

**Acceptance Criteria:**

- Store has one audited path for report correction and void flows.
- Balance recalculation is deterministic and covered by tests.
- Tests run with `npx vitest run src/store/__tests__/ledgerStore.test.ts`.

## EO-P12-T04: Cash Close, Reopen, Settlement Revisions, And Date Locks

**Estimate:** 1.25 days / 5 SP

**Files:**

- Create: `frontend/src/domain/cashClose.ts`
- Create: `frontend/src/domain/__tests__/cashClose.test.ts`
- Modify: `frontend/src/store/posStore.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define cash-close domain types:

```ts
import type { LedgerSyncStatus } from './ledger';
import type { LedgerTotals } from './ledgerReport';

export type BusinessDateStatus = 'open' | 'closed' | 'reopened';

export interface DailySettlement {
  settlementId: string;
  businessDate: string;
  status: BusinessDateStatus;
  settlementRevision: number;
  orderCount: number;
  transactionCount: number;
  expectedCash: number;
  countedCash: number;
  difference: number;
  note: string;
  closedBy: string;
  closedAt: string;
  reopenedBy?: string;
  reopenedAt?: string;
  reopenReason?: string;
  syncStatus: LedgerSyncStatus;
  revision: number;
}

export interface CashCloseDraft {
  businessDate: string;
  expectedCash: number;
  countedCash: number;
  difference: number;
  note: string;
  queuedSettlementAccepted: boolean;
}
```

- [ ] Implement `createCashCloseDraft(totals: LedgerTotals, businessDate: string, countedCash: number, note: string, queuedSettlementAccepted: boolean): CashCloseDraft`.
- [ ] Implement `validateCashClose(args)`:
  - failed or conflict transaction sync status blocks close.
  - queued rows require `queuedSettlementAccepted === true`.
  - non-zero `difference` requires non-empty `note`.
  - already closed date blocks duplicate close.
- [ ] Implement `createDailySettlement(args)`:
  - `expectedCash = totals.netCash`.
  - `difference = countedCash - expectedCash`.
  - first close revision is `1`.
  - reclose after reopen increments `settlementRevision`.
  - local close uses `syncStatus: 'queued'` when queued rows exist, otherwise `syncStatus: 'local'`.
- [ ] Implement `reopenBusinessDate(args)`:
  - requires existing closed settlement.
  - requires non-empty reason.
  - creates a new settlement revision with `status: 'reopened'`.
  - records audit event through store integration.
- [ ] Implement `isBusinessDateWritable(status, businessDate): boolean`.
- [ ] Modify store with actions:
  - `closeBusinessDate(input)`
  - `reopenBusinessDate(input)`
  - `getBusinessDateStatus(businessDate)`
- [ ] Modify POS lock logic in `App.tsx` so a closed business date blocks POS creation even if it is the current calendar date.
- [ ] Ensure report correction/void guards consume `getBusinessDateStatus`.

**Testing Strategy:**

- Unit:
  - counted cash equal to expected cash closes without discrepancy note.
  - counted cash different from expected cash blocks close without note.
  - difference is calculated as counted minus expected.
  - failed or conflict row blocks close.
  - queued local rows require explicit settlement queued acceptance.
  - close creates revision 1.
  - reopen requires reason and creates reopened revision.
  - reclose creates a later settlement revision without deleting the prior revision.
  - closed status makes `isBusinessDateWritable` false.
- Integration:
  - POS/report lock behavior covered in EO-P12-T05 and EO-P12-T08.

**Acceptance Criteria:**

- Closing writes `DailySettlement` and business-date status to persisted store state.
- Closed-date write guards are enforced outside the report UI.
- Tests run with `npx vitest run src/domain/__tests__/cashClose.test.ts`.

## EO-P12-T05: Report UI Correction, Void, And Close Workflows

**Estimate:** 1.25 days / 5 SP

**Files:**

- Modify: `frontend/src/components/screens.tsx`
- Modify: `frontend/src/index.css`
- Create: `frontend/src/components/report/ReportDateRangeControls.tsx`
- Create: `frontend/src/components/report/ReportSummaryStats.tsx`
- Create: `frontend/src/components/report/LedgerGroupedTable.tsx`
- Create: `frontend/src/components/report/CorrectionDialog.tsx`
- Create: `frontend/src/components/report/VoidDialog.tsx`
- Create: `frontend/src/components/report/CashClosePanel.tsx`
- Create: `frontend/src/components/report/ReopenDialog.tsx`
- Create: `frontend/src/__tests__/reportScreen.integration.test.tsx`

**Implementation Plan:**

- [ ] Refactor `ReportScreen` to consume `LedgerDateRange`, `LedgerTotals`, `LedgerGroup[]`, `DailySettlement[]`, and `BusinessDateStatus`.
- [ ] Move date-range buttons into `ReportDateRangeControls`.
- [ ] Implement custom range inputs with explicit start/end dates before applying the custom filter.
- [ ] Move summary cards into `ReportSummaryStats` and show:
  - order count.
  - order sales amount.
  - cash collected.
  - refunds.
  - net cash.
  - new debt.
  - top-up amount.
  - cancellation count.
  - transaction count.
- [ ] Move grouped row rendering into `LedgerGroupedTable`.
- [ ] In expanded transaction rows, show:
  - time.
  - type.
  - meal price.
  - paid amount.
  - note.
  - after balance.
  - source device.
  - sync status.
  - correction/void buttons only when policy allows an action.
- [ ] Replace inline edit with `CorrectionDialog`:
  - fields: type, meal price, paid amount, note, reason.
  - reason required for type/meal/paid changes.
  - save calls `correctTransaction`.
- [ ] Replace delete confirmation with `VoidDialog`:
  - shows hard-delete versus void/reversal decision from policy.
  - reason required.
  - confirm calls `hardDeleteLocalDraft` or `voidTransaction`.
- [ ] Add `CashClosePanel` above grouped ledger rows:
  - shows expected cash, counted cash input, difference, note, sync-blocking status, and close button.
  - blocks close when difference is non-zero and note is empty.
  - shows queued-settlement confirmation when queued rows exist.
- [ ] Add `ReopenDialog` for closed business dates:
  - requires reopen reason.
  - calls `reopenBusinessDate`.
- [ ] Show lock indicators for closed, reopened, failed-sync, conflict, voided, and corrected states.

**Testing Strategy:**

- Integration with Testing Library:
  - today/week/month/custom filters update visible totals and rows.
  - grouped row expands and shows transaction time/type/amount/note/after/source/sync status.
  - correction dialog requires reason for amount changes.
  - correction creates an audit-backed store call and closes the dialog.
  - void dialog requires reason and does not call raw delete.
  - closed date hides correction/void controls and shows lock state.
  - cash close panel blocks discrepancy without note.
  - reopen dialog requires reason before allowing corrections.

**Acceptance Criteria:**

- Report UI no longer uses unsafe inline edit/delete controls.
- Cash close is a focused form visible from the report screen.
- Dense report layout is preserved; no landing page or unrelated screen redesign is introduced.
- Tests run with `npx vitest run src/__tests__/reportScreen.integration.test.tsx`.

## EO-P12-T06: CSV Export And Print View Models

**Estimate:** 0.75 day / 2 SP

**Files:**

- Create: `frontend/src/domain/ledgerExport.ts`
- Create: `frontend/src/domain/__tests__/ledgerExport.test.ts`
- Create: `frontend/src/components/report/ExportActions.tsx`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define stable CSV column arrays in `frontend/src/domain/ledgerExport.ts`:

```ts
export const TRANSACTION_CSV_COLUMNS = [
  'business_date',
  'transaction_id',
  'created_at',
  'student_id',
  'student_name_snapshot',
  'type',
  'meal_price',
  'paid_amount',
  'amount',
  'after_balance',
  'menu_name_snapshot',
  'vendor_name_snapshot',
  'source_device',
  'operator_id',
  'sync_status',
  'revision',
  'note',
  'voided_at',
  'voided_by',
  'void_reason',
] as const;

export const SETTLEMENT_CSV_COLUMNS = [
  'business_date',
  'settlement_revision',
  'status',
  'order_count',
  'transaction_count',
  'expected_cash',
  'counted_cash',
  'difference',
  'note',
  'closed_by',
  'closed_at',
  'reopened_by',
  'reopened_at',
  'reopen_reason',
  'sync_status',
] as const;
```

- [ ] Implement `buildTransactionCsvRows(transactions)` with one row per ledger transaction and values in the exact column order above.
- [ ] Implement `buildSettlementCsvRows(settlements)` with one row per settlement revision and values in the exact column order above.
- [ ] Implement `serializeCsv(columns, rows)`:
  - quote values containing comma, quote, newline, or carriage return.
  - escape quotes by doubling them.
  - preserve empty string for missing optional fields.
- [ ] Implement `buildLedgerExportFile(args)`:
  - includes transaction CSV always.
  - includes settlement CSV when the selected range contains settlement revisions.
  - returns deterministic filenames using `businessDate` or range.
- [ ] Define `LedgerPrintViewModel` with:
  - header title.
  - business date/range.
  - generated timestamp.
  - generated by.
  - totals.
  - cash close status.
  - grouped ledger rows.
  - sync summary counts.
- [ ] Implement `buildLedgerPrintViewModel(args)`.
- [ ] Add `ExportActions` buttons for CSV and print:
  - CSV uses the domain serializer.
  - print renders or opens a print-ready view model without changing ledger state.
  - both actions create audit events when audit logging is enabled in store.
- [ ] Export functions and constants from `frontend/src/domain/index.ts`.

**Testing Strategy:**

- Unit:
  - transaction CSV has exactly 20 columns in the documented order.
  - settlement CSV has exactly 15 columns in the documented order.
  - CSV escaping handles comma, quote, newline, and empty optional values.
  - closed-date export includes settlement fields for that date.
  - print view model includes header, totals, cash close status, grouped rows, and sync summary.
- Integration:
  - export/print buttons are included in the EO-P12-T08 manual smoke checklist.

**Acceptance Criteria:**

- CSV schema matches the spec exactly.
- Print logic is driven by a typed view model, not browser DOM scraping.
- Tests run with `npx vitest run src/domain/__tests__/ledgerExport.test.ts`.

## EO-P12-T07: Google Sheets Sync-Boundary Payloads

**Estimate:** 0.5 day / 2 SP

**Files:**

- Create: `frontend/src/domain/ledgerSyncBoundary.ts`
- Create: `frontend/src/domain/__tests__/ledgerSyncBoundary.test.ts`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define queueable accounting payload types:

```ts
import type { DailySettlement } from './cashClose';
import type { LedgerAuditEvent } from './ledgerAudit';
import type { LedgerTransaction } from './ledger';

export type LedgerSyncEntity = 'transaction' | 'settlement' | 'sync_event';

export interface QueueableLedgerPayload {
  idempotencyKey: string;
  entity: LedgerSyncEntity;
  operation: 'append';
  businessDate: string;
  payload: LedgerTransaction | DailySettlement | LedgerAuditEvent;
  dependencyIds: string[];
}
```

- [ ] Implement `buildTransactionQueuePayload(transaction)`:
  - entity is `transaction`.
  - operation is `append`.
  - idempotency key uses transaction id and revision.
- [ ] Implement `buildSettlementQueuePayload(settlement, transactionDependencyIds)`:
  - entity is `settlement`.
  - operation is `append`.
  - dependencies include transaction ids for the same business date when supplied.
- [ ] Implement `buildAuditEventQueuePayload(event, entityDependencyId)`:
  - entity is `sync_event`.
  - operation is `append`.
  - dependencies include the row being audited when supplied.
- [ ] Implement `getCloseBlockingSyncSummary(transactions)` returning counts for `queued`, `failed`, and `conflict`.
- [ ] Document in code comments that this module does not send network requests and must be consumed by Phase 1.3 durable queue implementation.
- [ ] Export functions and types from `frontend/src/domain/index.ts`.

**Testing Strategy:**

- Unit:
  - transaction payload maps one ledger row without dropping required Google Sheets columns.
  - settlement payload includes settlement revision and close status.
  - audit event payload uses `sync_event`.
  - failed/conflict rows block close summary.
  - queued rows are reported separately so UI can require queued-settlement acceptance.

**Acceptance Criteria:**

- Phase 1.2 owns data shape and close policy; Phase 1.3 owns transport and retry.
- No Google API, Apps Script, fetch transport, OAuth, or backend proxy code is added.
- Tests run with `npx vitest run src/domain/__tests__/ledgerSyncBoundary.test.ts`.

## EO-P12-T08: Phase Verification And Regression Guard

**Estimate:** 0.5 day / 1 SP

**Files:**

- Create: `frontend/src/__tests__/cashClose.integration.test.tsx`
- Modify: `frontend/src/__tests__/reportScreen.integration.test.tsx`
- Modify: `docs/superpowers/plans/2026-05-14-phase-1-2-reporting-and-settlement.md` only if implementation discoveries require scope clarification before review.

**Implementation Plan:**

- [ ] Run focused domain tests from `frontend/`:

```bash
npx vitest run src/domain/__tests__/ledgerReport.test.ts src/domain/__tests__/ledgerAudit.test.ts src/domain/__tests__/cashClose.test.ts src/domain/__tests__/ledgerExport.test.ts src/domain/__tests__/ledgerSyncBoundary.test.ts
```

- [ ] Run focused store and UI integration tests from `frontend/`:

```bash
npx vitest run src/store/__tests__/ledgerStore.test.ts src/__tests__/reportScreen.integration.test.tsx src/__tests__/cashClose.integration.test.tsx
```

- [ ] Run the global verification gate from `frontend/`:

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

- [ ] Manually smoke-check the development server for these flows:
  - report default grouping by student.
  - today/week/month/custom filters.
  - correction with required reason.
  - void/reversal with required reason.
  - close with matching counted cash.
  - close blocked by discrepancy without note.
  - close with discrepancy note.
  - closed date blocking POS and report writes.
  - reopen with reason and reclose creating a later revision.
  - transaction CSV export.
  - settlement CSV export.
  - print view.
- [ ] Commit Phase 1.2 implementation with a message that identifies reporting and settlement:

```bash
git add frontend/src/domain frontend/src/store frontend/src/components frontend/src/App.tsx frontend/src/index.css frontend/src/__tests__
git commit -m "feat: add audited reporting and cash close"
```

**Acceptance Criteria:**

- Global verification gate passes from `frontend/`.
- Focused tests cover report totals, correction/void audit trail, balance recalculation, formal close/reopen, discrepancy handling, closed-date locks, CSV schema, print view model, and sync-boundary payloads.
- No Phase 1.3 transport/retry/conflict resolver or Phase 2 biometric work is added.

## Testing Matrix

| Behavior | Unit Test | Integration Test | Manual Smoke |
|---|---|---|---|
| Date filters and grouped report rows | `ledgerReport.test.ts` | `reportScreen.integration.test.tsx` | yes |
| Required totals | `ledgerReport.test.ts` | `reportScreen.integration.test.tsx` | yes |
| Edit/correction audit trail | `ledgerAudit.test.ts` | `reportScreen.integration.test.tsx`, `ledgerStore.test.ts` | yes |
| Delete/void policy | `ledgerAudit.test.ts` | `reportScreen.integration.test.tsx`, `ledgerStore.test.ts` | yes |
| Later after-balance recalculation | `ledgerAudit.test.ts` | `ledgerStore.test.ts` | yes |
| Cash close formal status | `cashClose.test.ts` | `cashClose.integration.test.tsx` | yes |
| Difference actual vs expected | `cashClose.test.ts` | `cashClose.integration.test.tsx` | yes |
| Closed-date POS/report locks | `cashClose.test.ts` | `cashClose.integration.test.tsx` | yes |
| Reopen and reclose revisions | `cashClose.test.ts` | `cashClose.integration.test.tsx` | yes |
| Transaction CSV schema | `ledgerExport.test.ts` | optional export button smoke | yes |
| Settlement CSV schema | `ledgerExport.test.ts` | optional export button smoke | yes |
| Print view model | `ledgerExport.test.ts` | optional print button smoke | yes |
| Sheets sync boundary | `ledgerSyncBoundary.test.ts` | close panel sync-block summary | no network smoke |

## Phase Done Criteria

- Report filters for today/week/month/custom are driven by `businessDate`.
- Required totals are computed from effective ledger rows and covered by tests.
- Unsafe inline edit/delete is replaced by audited correction and void/reversal workflows.
- Direct mutation is blocked for synced, queued, failed, conflict, closed, or settlement-covered data.
- Every correction, void, hard delete, close, reopen, export, and print action can create an audit event.
- Cash close writes a `DailySettlement` revision and persisted business-date status.
- Counted cash, expected cash, difference, and discrepancy note rules are enforced.
- Closed business dates are read-only for POS and report write paths.
- Reopen requires a reason and reclose creates a later settlement revision without deleting prior revisions.
- Transaction CSV uses the documented 20-column schema.
- Settlement CSV uses the documented 15-column schema.
- Print view model includes header, date/range, totals, grouped rows, cash close status, and sync summary.
- Google Sheets boundary payloads exist for transactions, settlement revisions, and audit events, without transport implementation.
- Full gate passes from `frontend/`: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build`.

## Out Of Scope For Phase 1.2

- Google Sheets transport, durable queue worker, retry/backoff, OAuth, Apps Script, backend proxy, conflict resolver UI, restore, and migration; these belong to Phase 1.3.
- Tax, invoice, external accounting package integration, or receipt printing.
- Student roster import/admin maintenance beyond displaying snapshots already captured in ledger rows.
- Menu/vendor CRUD beyond historical menu/vendor snapshots already captured in ledger rows.
- iPad camera, face recognition, enrollment UI, or biometric profile sync.
