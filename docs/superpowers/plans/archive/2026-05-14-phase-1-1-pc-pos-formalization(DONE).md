# Phase 1.1 PC POS Formalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current PC POS prototype into a formal, testable transaction flow with explicit state transitions, local transaction snapshots, scan-ready input boundaries, and write guards.

**Architecture:** Build a pure `frontend/src/domain/posFlow.ts` reducer around the Phase 1.0 domain models, then wire React to that reducer through a small hook and the existing Zustand store. The PC remains the transaction authority: manual search, scan input, and future iPad handoff all select a student, but only the PC confirm action creates a ledger transaction.

**Tech Stack:** Vite 8, React 19, TypeScript 6, Zustand 5, Vitest 4, Testing Library, current `frontend/` verification chain.

---

## Source Specs

- `docs/superpowers/specs/2026-05-14-pc-pos-order-flow-spec.md`
- `docs/superpowers/specs/2026-05-14-student-account-management-spec.md`
- `docs/superpowers/specs/2026-05-14-menu-vendor-management-spec.md`
- `docs/superpowers/specs/2026-05-14-ipad-face-auth-handoff-spec.md`
- `docs/superpowers/plans/2026-05-14-phase-1-0-foundation-hardening.md`
- `docs/superpowers/plans/ROADMAP.md`

## Phase Estimate

- Total estimate: 4-6 dev days.
- Complexity: medium-high. The user-facing screen should look familiar, but write behavior moves behind a stricter state machine and must preserve keyboard speed.
- Recommended PR split:
  - PR 1: pure POS flow reducer, search/scan boundary, and transaction intent/snapshot tests.
  - PR 2: React/Zustand wiring and integration tests for keyboard flow, duplicate warning, success reset, historical lock, and iPad handoff receiver boundary.

## Task Board Breakdown

| Task ID | Title | Estimate | Primary Files | Depends On |
|---|---|---:|---|---|
| EO-P11-T01 | POS flow reducer and state fixtures | 0.75 day / 2 SP | `frontend/src/domain/posFlow.ts`, `frontend/src/domain/__tests__/posFlow.test.ts` | Phase 1.0 |
| EO-P11-T02 | Search, scan, and selection boundary | 0.75 day / 2 SP | `frontend/src/domain/posSearch.ts`, `frontend/src/domain/__tests__/posSearch.test.ts` | EO-P11-T01 |
| EO-P11-T03 | Transaction intent and snapshot commit adapter | 1 day / 3 SP | `frontend/src/domain/posTransaction.ts`, `frontend/src/store/posStore.ts` | EO-P11-T01, Phase 1.0 ledger domain |
| EO-P11-T04 | React POS state-machine wiring | 1.25 days / 5 SP | `frontend/src/hooks/usePosFlow.ts`, `frontend/src/App.tsx`, `frontend/src/components/pos-components.tsx` | EO-P11-T01-T03 |
| EO-P11-T05 | Error, cancel, retry, and historical-lock hardening | 0.75 day / 2 SP | `frontend/src/domain/posFlow.ts`, `frontend/src/__tests__/pcPosSafety.integration.test.tsx` | EO-P11-T04 |
| EO-P11-T06 | iPad handoff receiver boundary | 0.5 day / 2 SP | `frontend/src/domain/ipadHandoff.ts`, `frontend/src/domain/__tests__/ipadHandoff.test.ts`, `frontend/src/hooks/usePosFlow.ts` | EO-P11-T04 |
| EO-P11-T07 | Phase verification and regression guard | 0.5 day / 1 SP | `frontend/src/__tests__/pcPosFlow.integration.test.tsx`, `frontend/src/__tests__/pcPosSafety.integration.test.tsx` | EO-P11-T05, EO-P11-T06 |

## Key Technical Decisions

1. `PosFlowState` is a discriminated union in the domain layer.
   - State transitions live in pure functions.
   - React components receive state and callbacks; they do not decide whether a write is legal.
   - Keyboard shortcuts call the same transition functions as mouse actions.

2. Search mode and transaction mode are separate concepts.
   - Search mode identifies how a student was selected: `manual`, `scan`, or `ipad`.
   - Transaction mode identifies the requested ledger action: `order`, `topup`, or `cancel`.

3. QR/barcode work in this phase is an input boundary, not hardware integration.
   - Text search continues to match active students by id, alias, and Traditional Chinese display name.
   - Scan processing accepts a completed code string plus terminator event and resolves to exactly one active student.
   - Zero or multiple matches return a recoverable scan error and keep the operator in text-search flow.

4. Transaction creation captures snapshots every time.
   - Student snapshot, menu snapshot, vendor snapshot, business date, source device, and operator-visible mode are captured before local commit.
   - Confirmation recalculates from latest domain state, so stale preview data cannot create an outdated ledger row.

5. Local commit idempotency is explicit.
   - `committing` state ignores duplicate keyboard and mouse submissions.
   - Retry is allowed only when no local transaction id exists.
   - Sync failure after local commit becomes queued/failed sync state, not a second POS transaction.

6. iPad handoff selects only; it never commits.
   - Idle PC can accept a valid handoff and move to `student_selected`.
   - Active PC flow queues or rejects the event visibly and does not replace the selected student.

## Known Pitfalls: Zustand 5 Persist API

> 以下來自 Phase 1.0 PR2 實作經驗，Phase 1.1 若涉及 `persist` middleware 務必參考。

1. **`persist.migrate` 接收的參數是 `persistedState.state`，而非完整 `StorageValue`。**
   - `migrate` 的 signature 是 `(persistedState: unknown, version: number) => StorageValue<State>`。
   - TypeScript 型別上 `persistedState` 被標為 `unknown`，實際傳入的是 `StorageValue<State>`（即 `{ state: YourState, version: number }`）。
   - 取用時直接用 `(persistedState as StorageValue<YourState>).state`，不要多包一層 `raw.state`。

2. **`rehydrate()` 是非同步 Promise，測試必須 `await`。**
   - `usePosStore.persist.rehydrate()` 回傳 `Promise<void>`。
   - 測試在 rehydrate 後立即讀取 store state 會拿到尚未完成 migration 的舊資料。
   - 正確寫法：`await usePosStore.persist.rehydrate()` 後再 assertion。

3. **TypeScript 型別上 `usePosStore.persist` 不存在，需手動 cast。**
   - Zustand 5 的 `create()` 包裝後，`persist` 屬性不會自動出現在 TypeScript 型別推斷中。
   - 使用 `(usePosStore as any).persist` 或定義 extended interface 來存取 `persist.rehydrate()` / `persist.getOptions()`。

4. **`skipHydration` 行為：**
   - `persist({ skipHydration: true })` 時，store 初始化不會自動從 localStorage 讀取資料。
   - 需手動呼叫 `rehydrate()` 來觸發 hydration。適合需要在 hydrate 前做前置檢查的場景（如 localStorage 格式驗證）。

## Data Flow

```text
SearchBox / scanner buffer / iPad event
  -> usePosFlow event callback
  -> posSearch / ipadHandoff resolver
  -> posFlow reducer
  -> selected student and mode preview
  -> posTransaction creates intent from latest store state
  -> usePosStore commit adapter
  -> success/error state
  -> reset to idle after dismissal
```

## Component Tree Impact

Current surfaces stay in place, but flow ownership changes:

```text
App
  usePosStore
  usePosFlow
  POS main column
    SearchBox
    IdleHero
    CustomerCard
    ActionBar
    ConfirmBanner
  POS side column
    RecentStrip
```

`ReportScreen`, `AdminScreen`, and `VendorsScreen` are not redesigned in this phase. They may receive updated transaction/store types only where Phase 1.0 compatibility requires it.

## EO-P11-T01: POS Flow Reducer And State Fixtures

**Estimate:** 0.75 day / 2 SP

**Files:**

- Create: `frontend/src/domain/posFlow.ts`
- Create: `frontend/src/domain/__tests__/posFlow.test.ts`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define exported POS flow types in `frontend/src/domain/posFlow.ts`:

```ts
export type PosMode = 'order' | 'topup' | 'cancel';
export type PosSelectionSource = 'manual' | 'scan' | 'ipad';
export type PosSourceDevice = 'pc' | 'barcode_scanner' | 'ipad_handoff';

export type PosFlowState =
  | { kind: 'idle'; searchText: string }
  | { kind: 'student_selected'; studentId: string; mode: PosMode; source: PosSelectionSource; paidAmountText: string }
  | { kind: 'duplicate_warning'; studentId: string; source: PosSelectionSource; paidAmountText: string }
  | { kind: 'committing'; studentId: string; mode: PosMode; source: PosSelectionSource; paidAmountText: string }
  | { kind: 'success'; transactionId: string; syncStatus: 'queued' | 'synced' | 'failed' }
  | { kind: 'historical_readonly'; businessDate: string }
  | { kind: 'error'; studentId?: string; mode?: PosMode; source?: PosSelectionSource; paidAmountText?: string; message: string; retryable: boolean };

export type PosFlowEvent =
  | { type: 'updateSearchText'; text: string }
  | { type: 'selectStudent'; studentId: string; source: PosSelectionSource }
  | { type: 'changeMode'; mode: PosMode; cancelAvailable: boolean }
  | { type: 'updatePaidAmount'; text: string }
  | { type: 'requestCommit'; hasDuplicateOrder: boolean; cancelAvailable: boolean }
  | { type: 'confirmDuplicate' }
  | { type: 'commitStarted' }
  | { type: 'commitSucceeded'; transactionId: string; syncStatus: 'queued' | 'synced' | 'failed' }
  | { type: 'commitFailed'; message: string; retryable: boolean }
  | { type: 'dismissSuccess' }
  | { type: 'cancel' }
  | { type: 'enterHistoricalReadonly'; businessDate: string };
```

- [ ] Implement `createInitialPosFlowState(isHistorical: boolean, businessDate: string): PosFlowState`.
- [ ] Implement `reducePosFlow(state: PosFlowState, event: PosFlowEvent): PosFlowState`.
- [ ] Implement `toPosSourceDevice(source: PosSelectionSource): PosSourceDevice`.
- [ ] Export the public types and functions from `frontend/src/domain/index.ts`.

**Transition Rules:**

- `idle + selectStudent` -> `student_selected` with `mode: 'order'` and empty amount.
- `student_selected + changeMode('cancel')` remains selected only when `cancelAvailable` is true.
- `student_selected + requestCommit` -> `duplicate_warning` when `mode` is `order` and `hasDuplicateOrder` is true.
- `student_selected + requestCommit` -> `committing` for valid order/top-up/cancel requests, preserving `paidAmountText` for failure retry.
- `duplicate_warning + confirmDuplicate` -> `committing` as an explicit second confirmation.
- `committing + requestCommit` returns unchanged state.
- `committing + commitSucceeded` -> `success`.
- `committing + commitFailed` -> `error` with retry metadata.
- `success + dismissSuccess` -> `idle`.
- Any write event in `historical_readonly` returns unchanged state.
- `cancel` from selected, duplicate warning, or error returns `idle`.

**Testing Strategy:**

- Unit:
  - idle select from manual, scan, and iPad sets the correct source.
  - duplicate order requires a second confirmation.
  - committing ignores duplicate submit events.
  - commit success resets only after dismissal.
  - commit failure preserves enough selected context for retry.
  - historical read-only blocks select, mode change, amount update, and commit.
- Integration: covered in EO-P11-T04 through EO-P11-T07.

**Acceptance Criteria:**

- `posFlow.ts` has no React, DOM, localStorage, or Zustand imports.
- All reducer branches return a full `PosFlowState` object; there are no partial state mutations.
- Tests run with `npx vitest run src/domain/__tests__/posFlow.test.ts`.

## EO-P11-T02: Search, Scan, And Selection Boundary

**Estimate:** 0.75 day / 2 SP

**Files:**

- Create: `frontend/src/domain/posSearch.ts`
- Create: `frontend/src/domain/__tests__/posSearch.test.ts`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define these exported types in `frontend/src/domain/posSearch.ts`:

```ts
import type { StudentAccount } from './student';

export type PosSearchMode = 'text' | 'scan';

export type PosSearchResult =
  | { ok: true; mode: PosSearchMode; students: StudentAccount[] }
  | { ok: false; mode: PosSearchMode; code: 'empty_query' | 'scan_not_found' | 'scan_ambiguous'; message: string };

export interface ScannerInput {
  rawCode: string;
  terminator: 'Enter' | 'Tab';
}
```

- [ ] Implement `searchPosStudents(students: StudentAccount[], query: string): PosSearchResult`.
- [ ] Implement `resolveScannedStudent(students: StudentAccount[], input: ScannerInput): PosSearchResult`.
- [ ] Keep inactive students hidden by default by delegating to Phase 1.0 student helpers.
- [ ] Treat scan input as exact `studentId` or exact alias match only; scan does not use partial display-name matching.
- [ ] Return `scan_not_found` when zero active students match.
- [ ] Return `scan_ambiguous` when more than one active student matches the code through aliases.
- [ ] Export functions and types from `frontend/src/domain/index.ts`.

**Testing Strategy:**

- Unit:
  - exact student id search finds one active student.
  - partial Traditional Chinese name search finds active matching students.
  - inactive student is hidden from normal POS search.
  - scan exact id selects one student.
  - scan alias selects one student.
  - scan zero-match returns `scan_not_found`.
  - scan duplicate alias returns `scan_ambiguous`.
- Integration:
  - SearchBox keyboard behavior covered in EO-P11-T04.

**Acceptance Criteria:**

- Existing text search semantics are preserved for operators.
- Scan resolver is deterministic and does not depend on browser key timing.
- Tests run with `npx vitest run src/domain/__tests__/posSearch.test.ts`.

## EO-P11-T03: Transaction Intent And Snapshot Commit Adapter

**Estimate:** 1 day / 3 SP

**Files:**

- Create: `frontend/src/domain/posTransaction.ts`
- Create: `frontend/src/domain/__tests__/posTransaction.test.ts`
- Modify: `frontend/src/store/posStore.ts`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define a POS transaction intent type in `frontend/src/domain/posTransaction.ts`:

```ts
import type { MenuSnapshot } from './menu';
import type { PosMode, PosSourceDevice } from './posFlow';
import type { StudentSnapshot } from './student';

export interface PosTransactionIntent {
  businessDate: string;
  studentId: string;
  type: PosMode;
  mealPrice: number;
  paidAmount: number;
  note: string;
  sourceDevice: PosSourceDevice;
}

export interface PosTransactionSnapshotInput {
  student: StudentSnapshot;
  menu: MenuSnapshot;
}

export interface PosTransactionDraft {
  intent: PosTransactionIntent;
  snapshots: PosTransactionSnapshotInput;
  amount: number;
  expectedBalanceAfter: number;
}
```

- [ ] Implement `parsePaidAmount(text: string): { ok: true; value: number } | { ok: false; message: string }`.
- [ ] Implement `buildPosTransactionDraft(args)` using the Phase 1.0 student, menu, and ledger helpers.
- [ ] Enforce `amount = paidAmount - mealPrice` for orders.
- [ ] Enforce `mealPrice = 0` and `amount = paidAmount` for top-ups.
- [ ] Enforce cancel draft creation only when the caller supplies the active same-day order being reversed.
- [ ] Modify `usePosStore.processTransaction` or add `commitPosTransactionDraft(draft)` so the store creates ledger rows from the draft and captures:
  - `businessDate`
  - `studentId`
  - `studentNameSnapshot`
  - `menuNameSnapshot`
  - `menuPriceSnapshot`
  - `vendorIdSnapshot`
  - `vendorNameSnapshot`
  - `sourceDevice`
  - local commit id and queued/sync metadata already available from Phase 1.0 foundations
- [ ] Preserve existing persisted localStorage compatibility by accepting older rows that lack snapshot/source fields and enriching only new rows.
- [ ] Export functions and types from `frontend/src/domain/index.ts`.

**Testing Strategy:**

- Unit:
  - order with empty paid input creates `paidAmount = 0`, `mealPrice = today price`, and negative amount.
  - order with exact paid input creates zero amount.
  - top-up with `500` creates positive amount.
  - cancel reverses the supplied active order and cannot run without that order.
  - draft uses latest student balance and menu price passed at confirm time.
  - invalid paid amount returns the first actionable validation message.
  - snapshots preserve names/prices after source objects are later edited in the test.
- Store:
  - new transaction rows include snapshot/source fields.
  - legacy localStorage rows still hydrate without crashing.
- **Side-effect files:** `frontend/src/App.tsx`, `frontend/src/components/pos-components.tsx`, `frontend/src/components/screens.tsx` 直接引用 `posStore` 的型別與 actions，store 介面變更時需同步檢查這些檔案的型別引用是否相容。

**Acceptance Criteria:**

- Transaction math is centralized in `posTransaction.ts` and Phase 1.0 ledger helpers.
- React components never hand-roll `amount` or balance math.
- Tests run with `npx vitest run src/domain/__tests__/posTransaction.test.ts src/store/__tests__/posStore.test.ts`.

## EO-P11-T04: React POS State-Machine Wiring

**Estimate:** 1.25 days / 5 SP

**Files:**

- Create: `frontend/src/hooks/usePosFlow.ts`
- Create: `frontend/src/__tests__/pcPosFlow.integration.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/pos-components.tsx`
- Modify: `frontend/src/components/screens.tsx`

**Implementation Plan:**

- [ ] Create `usePosFlow` as the React adapter around the pure reducer:

```ts
export interface UsePosFlowArgs {
  businessDate: string;
  isHistorical: boolean;
  hasDuplicateOrder(studentId: string): boolean;
  canCancelOrder(studentId: string): boolean;
  commitSelectedTransaction(args: {
    studentId: string;
    mode: PosMode;
    paidAmountText: string;
    source: PosSelectionSource;
  }): Promise<{ transactionId: string; syncStatus: 'queued' | 'synced' | 'failed' }>;
}
```

- [ ] Expose these callbacks from the hook:
  - `setSearchText(text)`
  - `selectStudent(studentId, source)`
  - `changeMode(mode)`
  - `setPaidAmountText(text)`
  - `receiveScannerInput(input: ScannerInput)`
  - `requestConfirm()`
  - `confirmDuplicate()`
  - `cancelFlow()`
  - `dismissSuccess()`
- [ ] Update `App.tsx` so selected student, duplicate warning, committing, success, error, and historical read-only rendering derive from `PosFlowState`.
- [ ] Update `SearchBox` props so text input and suggestion navigation call `setSearchText` and `selectStudent`.
- [ ] Update scanner terminator handling so SearchBox sends `{ rawCode, terminator }` to `receiveScannerInput(input)` and never calls commit directly.
- [ ] Update `ActionBar` props so order/top-up/cancel buttons call `changeMode`, and cancel is disabled when `canCancelOrder` is false.
- [ ] Update confirm button and Enter key handling so they call `requestConfirm()` and are disabled during `committing`.
- [ ] Update Escape key handling:
  - idle clears search text.
  - selected state cancels back to idle.
  - duplicate warning closes without committing.
  - success dismisses and returns to idle.
  - historical read-only remains read-only.
- [ ] Keep existing visual structure and class naming where possible to reduce CSS churn.

**Testing Strategy:**

- Integration with Testing Library:
  - typing an exact student id and pressing Enter selects the student.
  - ArrowDown, ArrowUp, and Enter select a highlighted suggestion.
  - mode shortcut changes transaction preview without creating a ledger row.
  - pressing Enter on an order with no duplicate calls one store commit.
  - success dismissal clears selected student and private balance details.
  - confirm button is disabled or ignored while committing.

**Acceptance Criteria:**

- Operator-visible PC POS flow remains the first screen.
- Keyboard and mouse paths share the same reducer and commit adapter.
- Tests run with `npx vitest run src/__tests__/pcPosFlow.integration.test.tsx`.

## EO-P11-T05: Error, Cancel, Retry, And Historical-Lock Hardening

**Estimate:** 0.75 day / 2 SP

**Files:**

- Modify: `frontend/src/domain/posFlow.ts`
- Modify: `frontend/src/hooks/usePosFlow.ts`
- Create: `frontend/src/__tests__/pcPosSafety.integration.test.tsx`

**Implementation Plan:**

- [ ] Make validation failures return `error` state with `retryable: true` and selected context preserved.
- [ ] Make local persistence failures return `error` state with `retryable: true` only when no local transaction id exists.
- [ ] Make post-commit sync failures return `success` with `syncStatus: 'failed'` or `syncStatus: 'queued'`, not a retryable POS write error.
- [ ] Add a retry callback in `usePosFlow` that reuses the preserved student id, mode, source, and paid amount text when `retryable` is true.
- [ ] Ensure `cancelFlow()` from error state discards the pending intent and creates no ledger row.
- [ ] Ensure `enterHistoricalReadonly` is called whenever the selected business date is not the current business date.
- [ ] Ensure all keyboard shortcuts first check `state.kind !== 'historical_readonly'`.
- [ ] Ensure duplicate-submit from keyboard repeat and double-click produces one commit call while state is `committing`.

**Testing Strategy:**

- Unit:
  - `historical_readonly` ignores selection, mode, amount, and commit events.
  - `error + cancel` returns idle.
  - `error + retryable false` does not expose retry behavior from the hook.
- Integration:
  - non-current business date blocks search, order, top-up, cancel, and Enter shortcuts.
  - validation error preserves selected student and paid amount.
  - local persistence failure can retry the same intent once the mocked store succeeds.
  - sync failure after local commit shows queued/failed sync state and does not create a duplicate transaction.
  - Escape from duplicate warning creates no transaction.

**Acceptance Criteria:**

- Historical dates are read-only from both UI controls and keyboard shortcuts.
- Retry cannot create a second local row for a transaction that already has a local id.
- Tests run with `npx vitest run src/__tests__/pcPosSafety.integration.test.tsx`.

## EO-P11-T06: iPad Handoff Receiver Boundary

**Estimate:** 0.5 day / 2 SP

**Files:**

- Create: `frontend/src/domain/ipadHandoff.ts`
- Create: `frontend/src/domain/__tests__/ipadHandoff.test.ts`
- Modify: `frontend/src/hooks/usePosFlow.ts`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define the handoff event type in `frontend/src/domain/ipadHandoff.ts`:

```ts
export interface FaceHandoffEvent {
  eventId: string;
  studentId: string;
  recognizedAt: string;
  sourceDeviceId: string;
  confidenceBucket: 'high' | 'medium' | 'low';
}

export type FaceHandoffResolution =
  | { ok: true; action: 'select'; studentId: string }
  | { ok: true; action: 'queue'; studentId: string; message: string }
  | { ok: false; action: 'reject'; code: 'duplicate_event' | 'student_not_active' | 'pc_busy'; message: string };
```

- [ ] Implement `resolveFaceHandoffEvent(args)` with:
  - active student required.
  - duplicate `eventId` rejected.
  - idle POS state selects the student.
  - active POS state returns `queue` or `reject` based on a `busyPolicy: 'queue' | 'reject'` argument.
- [ ] Add `receiveFaceHandoff(event)` to `usePosFlow`.
- [ ] When resolution is `select`, dispatch `selectStudent` with source `ipad`.
- [ ] When resolution is `queue` or `reject`, expose an operator-visible message without changing selected student.
- [ ] Store processed event ids for Phase 1.1 in `usePosFlow` with `useRef<Set<string>>`; do not add a remote transport or durable queue in this phase.
- [ ] Export functions and types from `frontend/src/domain/index.ts`.

**Testing Strategy:**

- Unit:
  - valid event for active student resolves to select when POS is idle.
  - valid event resolves to queue when POS is active and busy policy is queue.
  - valid event resolves to reject when POS is active and busy policy is reject.
  - duplicate event id is rejected.
  - inactive student is rejected.
- Integration:
  - iPad event selects a student on idle PC and marks source as iPad.
  - iPad event during active transaction does not replace the selected student.
  - receiving an iPad event never creates a transaction.

**Acceptance Criteria:**

- There is no camera, model, or biometric profile implementation in Phase 1.1.
- Handoff event handling has idempotency and active-flow protection.
- Tests run with `npx vitest run src/domain/__tests__/ipadHandoff.test.ts`.

## EO-P11-T07: Phase Verification And Regression Guard

**Estimate:** 0.5 day / 1 SP

**Files:**

- Modify: `frontend/src/__tests__/pcPosFlow.integration.test.tsx`
- Modify: `frontend/src/__tests__/pcPosSafety.integration.test.tsx`
- Modify: `docs/superpowers/plans/2026-05-14-phase-1-1-pc-pos-formalization.md` only if implementation discoveries require scope clarification before review.

**Implementation Plan:**

- [ ] Run focused domain tests from `frontend/`:

```bash
npx vitest run src/domain/__tests__/posFlow.test.ts src/domain/__tests__/posSearch.test.ts src/domain/__tests__/posTransaction.test.ts src/domain/__tests__/ipadHandoff.test.ts
```

- [ ] Run focused POS integration tests from `frontend/`:

```bash
npx vitest run src/__tests__/pcPosFlow.integration.test.tsx src/__tests__/pcPosSafety.integration.test.tsx
```

- [ ] Run the global verification gate from `frontend/`:

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

- [ ] Manually smoke-check the development server for these flows:
  - text search by exact id.
  - partial Traditional Chinese name search.
  - duplicate order warning then cancel.
  - duplicate order warning then second confirm.
  - order with empty payment.
  - top-up with numeric payment.
  - historical date write lock.
  - success dismissal clearing private data.
- [ ] Commit Phase 1.1 implementation with a message that identifies POS formalization:

```bash
git add frontend/src/domain frontend/src/hooks frontend/src/store frontend/src/App.tsx frontend/src/components frontend/src/__tests__
git commit -m "feat: formalize pc pos flow"
```

**Acceptance Criteria:**

- Global verification gate passes from `frontend/`.
- Focused POS integration tests cover keyboard flow, duplicate warning, success reset, historical lock, duplicate-submit guard, and iPad receiver boundary.
- No Phase 1.2 cash close/audit UI, Phase 1.3 Sheets transport, or Phase 2 face recognition implementation is added.

## Testing Matrix

| Behavior | Unit Test | Integration Test | Manual Smoke |
|---|---|---|---|
| POS reducer transitions | `posFlow.test.ts` | `pcPosFlow.integration.test.tsx` | yes |
| Text search by id/name | `posSearch.test.ts` | `pcPosFlow.integration.test.tsx` | yes |
| Scan resolver exact code | `posSearch.test.ts` | scanner terminator path in `pcPosFlow.integration.test.tsx` | optional |
| Snapshot transaction draft | `posTransaction.test.ts` | store commit assertion | yes |
| Duplicate warning | `posFlow.test.ts` | `pcPosFlow.integration.test.tsx` | yes |
| Duplicate-submit guard | `posFlow.test.ts` | `pcPosSafety.integration.test.tsx` | yes |
| Historical read-only lock | `posFlow.test.ts` | `pcPosSafety.integration.test.tsx` | yes |
| Error/cancel/retry | `posFlow.test.ts`, `posTransaction.test.ts` | `pcPosSafety.integration.test.tsx` | yes |
| iPad handoff receiver boundary | `ipadHandoff.test.ts` | `pcPosSafety.integration.test.tsx` | no transaction smoke |

## Phase Done Criteria

- `PosFlowState` and transition helpers exist in `frontend/src/domain/posFlow.ts`.
- Existing PC POS operators can still search by id/name, use keyboard navigation, choose order/top-up/cancel, preview balance, confirm, and serve the next student quickly.
- Transaction rows created from the POS include student/menu/vendor snapshots and source device metadata.
- Duplicate orders require explicit second confirmation.
- Duplicate keyboard/mouse submits during local commit create at most one ledger transaction.
- Historical dates are write-locked from both UI controls and keyboard shortcuts.
- Scan input has a tested resolver boundary without requiring scanner hardware.
- iPad handoff has a tested receiver boundary without face recognition implementation.
- Full gate passes from `frontend/`: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run build`.

## Out Of Scope For Phase 1.1

- Cash close, settlement revision, void/correction UI, and formal audit screens; these belong to Phase 1.2.
- Google Sheets transport, durable queue implementation, conflict resolution, and restore/migration flows; these belong to Phase 1.3.
- Real barcode scanner device support beyond deterministic code resolution and terminator handling.
- Camera access, face-recognition model, enrollment UI, biometric profile sync, and iPad student-facing screen; these belong to Phase 2.
