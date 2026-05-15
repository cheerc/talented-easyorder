# Phase 1.0 Foundation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish shared domain models, pure business logic, store integration, and test foundations while preserving the current PC POS user experience.

**Architecture:** Add a focused domain layer under `frontend/src/domain/` and move accounting/search/menu/date rules out of React component state. Zustand remains the app state boundary in this phase; React screens should continue consuming the store with minimal behavior change.

**Tech Stack:** Vite 8, React 19, TypeScript 6, Zustand 5, Vitest 4, Testing Library, current `frontend/` verification chain.

---

## Source Specs

- `docs/superpowers/specs/2026-05-14-student-account-management-spec.md`
- `docs/superpowers/specs/2026-05-14-menu-vendor-management-spec.md`
- `docs/superpowers/specs/2026-05-14-pc-pos-order-flow-spec.md`
- `docs/superpowers/specs/2026-05-14-order-ledger-cash-close-spec.md`
- `docs/superpowers/plans/ROADMAP.md`

## Phase Estimate

- Total estimate: 4-6 dev days.
- Complexity: medium. Most work is domain extraction and test coverage; UI behavior should remain stable.
- Recommended PR split:
  - PR 1: domain types and pure functions.
  - PR 2: Zustand store integration and compatibility tests.

## Task Board Breakdown

| Task ID | Title | Estimate | Primary Files | Depends On |
|---|---|---:|---|---|
| EO-P10-T01 | Domain module skeleton and test fixtures | 0.5 day / 1 SP | `frontend/src/domain/*`, `frontend/src/domain/__tests__/fixtures.ts` | none |
| EO-P10-T02 | Student account domain | 1 day / 3 SP | `frontend/src/domain/student.ts` | EO-P10-T01 |
| EO-P10-T03 | Menu and vendor domain | 0.75 day / 2 SP | `frontend/src/domain/menu.ts` | EO-P10-T01 |
| EO-P10-T04 | Ledger transaction domain | 1.25 days / 5 SP | `frontend/src/domain/ledger.ts` | EO-P10-T02, EO-P10-T03 |
| EO-P10-T05 | Business date and sync status foundations | 0.5 day / 2 SP | `frontend/src/domain/businessDate.ts`, `frontend/src/domain/syncStatus.ts` | EO-P10-T01 |
| EO-P10-T06 | Store refactor with compatibility boundary | 1.25 days / 5 SP | `frontend/src/store/posStore.ts`, `frontend/src/mocks/initialData.ts` | EO-P10-T02-T05 |
| EO-P10-T07 | Verification hardening and integration guard | 0.75 day / 2 SP | `frontend/src/store/__tests__/posStore.test.ts`, `frontend/src/domain/__tests__/*` | EO-P10-T06 |

## Key Technical Decisions

1. Domain modules are framework-free TypeScript.
   - No React imports.
   - No Zustand imports.
   - No browser storage access.

2. The store remains the single state owner in Phase 1.0.
   - Components still read/write through `usePosStore`.
   - Store actions delegate math and validation to domain helpers.

3. Historical snapshots are introduced at the transaction boundary.
   - Student snapshots use `studentId` and `studentNameSnapshot`.
   - Menu snapshots use `menuNameSnapshot`, `menuPriceSnapshot`, `vendorIdSnapshot`, and `vendorNameSnapshot`.

4. Balance math has one formula.
   - `amount = paidAmount - mealPrice`.
   - `newBalance = previousBalance + amount`.

5. Backward compatibility is explicit.
   - Existing mock values remain recognizable.
   - Existing persisted localStorage shape is either migrated in `posStore.ts` or reset with a documented operator-safe fallback before release.

## Data Flow

```text
React components
  -> usePosStore actions
  -> domain validators/calculators
  -> Zustand state update
  -> React components re-render
```

Phase 1.0 does not add Google Sheets transport, a durable sync queue, a new router, or iPad screens.

## Component Tree Impact

No new user-facing component tree is required in this phase.

Current surfaces remain:

```text
App
  TopBar
  POS main column
    SearchBox
    IdleHero
    CustomerCard
    ActionBar
  POS side column
    RecentStrip
  ReportScreen
  AdminScreen
  VendorsScreen
```

The implementation may change props/types consumed by these components only where required by store integration.

## EO-P10-T01: Domain Module Skeleton And Test Fixtures

**Estimate:** 0.5 day / 1 SP

**Files:**

- Create: `frontend/src/domain/index.ts`
- Create: `frontend/src/domain/__tests__/fixtures.ts`

**Implementation Plan:**

- [ ] Create `frontend/src/domain/index.ts` as the public barrel for Phase 1.0 domain exports.
- [ ] Create shared test fixtures that mirror current mock records:
  - student `001` with balance `1250`
  - student `004` with balance `-90`
  - today's menu `日式唐揚雞便當`, price `90`, vendor `阿榮便當`
  - vendor `阿榮便當`
  - one order transaction and one top-up transaction
- [ ] Keep fixtures deterministic; do not use `new Date()` or `crypto.randomUUID()` in fixtures.

**Testing Strategy:**

- Unit: fixture import compiles and is consumed by later domain tests.
- Integration: no UI integration in this task.

**Acceptance Criteria:**

- `npx tsc --noEmit` can resolve `frontend/src/domain/index.ts`.
- Test fixtures are plain serializable objects.

## EO-P10-T02: Student Account Domain

**Estimate:** 1 day / 3 SP

**Files:**

- Create: `frontend/src/domain/student.ts`
- Create: `frontend/src/domain/__tests__/student.test.ts`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define these exported types:

```ts
export type StudentStatus = 'active' | 'inactive';
export type FaceEnrollmentStatus = 'none' | 'enrolled' | 'disabled' | 'needs_review';

export interface StudentAccount {
  studentId: string;
  displayName: string;
  status: StudentStatus;
  currentBalance: number;
  aliases: string[];
  className?: string;
  groupName?: string;
  faceProfileId?: string;
  faceEnrollmentStatus: FaceEnrollmentStatus;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface StudentSnapshot {
  studentId: string;
  studentNameSnapshot: string;
}
```

- [ ] Implement `createStudentSnapshot(student: StudentAccount): StudentSnapshot`.
- [ ] Implement `filterActiveStudents(students: StudentAccount[]): StudentAccount[]`.
- [ ] Implement `searchActiveStudents(students, query)` matching active `studentId`, aliases, and Traditional Chinese display name.
- [ ] Implement `validateStudentImportRows(rows)` returning valid records plus field-level errors for duplicate ids, empty names, and non-numeric opening balances.
- [ ] Export all public types/functions from `domain/index.ts`.

**Testing Strategy:**

- Unit:
  - duplicate `studentId` blocks import and reports every duplicate row.
  - empty display name blocks import.
  - non-numeric opening balance blocks import.
  - inactive students are excluded from normal search.
  - snapshot keeps the current display name.
- Integration:
  - covered later by store tests in EO-P10-T06.

**Acceptance Criteria:**

- Student domain has no React/Zustand imports.
- Search and validation behavior matches `student-account-management` spec.
- Tests run with `npx vitest run src/domain/__tests__/student.test.ts`.

## EO-P10-T03: Menu And Vendor Domain

**Estimate:** 0.75 day / 2 SP

**Files:**

- Create: `frontend/src/domain/menu.ts`
- Create: `frontend/src/domain/__tests__/menu.test.ts`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define these exported types:

```ts
export type RecordStatus = 'active' | 'inactive';

export interface Vendor {
  vendorId: string;
  name: string;
  phone: string;
  note: string;
  status: RecordStatus;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface TodayMenu {
  businessDate: string;
  itemName: string;
  price: number;
  vendorId: string;
  vendorNameSnapshot: string;
  catalogItemId?: string;
  updatedAt: string;
  revision: number;
}

export interface MenuSnapshot {
  menuNameSnapshot: string;
  menuPriceSnapshot: number;
  vendorIdSnapshot: string;
  vendorNameSnapshot: string;
}
```

- [ ] Define `MenuCatalogItem` with `itemId`, `name`, `defaultPrice`, optional `defaultVendorId`, `category`, `imageUrl`, `description`, `status`, timestamps, and `revision`.
- [ ] Implement `validateTodayMenu(menu, vendors)` for non-empty name, positive integer TWD price, and active vendor.
- [ ] Implement `filterActiveVendors(vendors)`.
- [ ] Implement `createMenuSnapshot(menu)`.
- [ ] Implement `promoteCatalogItemToTodayMenu(item, vendor, businessDate)`.
- [ ] Export all public types/functions from `domain/index.ts`.

**Testing Strategy:**

- Unit:
  - empty item name fails validation.
  - zero, negative, and decimal prices fail validation.
  - inactive vendor fails validation.
  - active vendor passes validation.
  - snapshot preserves menu/vendor values after later edits.
  - catalog promotion creates a valid `TodayMenu`.
- Integration:
  - store validation integration in EO-P10-T06.

**Acceptance Criteria:**

- Menu/vendor domain has no React/Zustand imports.
- Price handling is integer-only.
- Tests run with `npx vitest run src/domain/__tests__/menu.test.ts`.

## EO-P10-T04: Ledger Transaction Domain

**Estimate:** 1.25 days / 5 SP

**Files:**

- Create: `frontend/src/domain/ledger.ts`
- Create: `frontend/src/domain/__tests__/ledger.test.ts`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define these exported types:

```ts
export type TransactionType = 'order' | 'topup' | 'cancel' | 'correction' | 'void';
export type LedgerSyncStatus = 'local' | 'queued' | 'synced' | 'failed' | 'conflict';

export interface LedgerTransaction {
  transactionId: string;
  businessDate: string;
  createdAt: string;
  studentId: string;
  studentNameSnapshot: string;
  type: TransactionType;
  mealPrice: number;
  paidAmount: number;
  amount: number;
  afterBalance: number;
  menuNameSnapshot: string;
  vendorNameSnapshot: string;
  sourceDevice: 'pc' | 'barcode_scanner' | 'ipad_handoff';
  operatorId?: string;
  syncStatus: LedgerSyncStatus;
  revision: number;
  note: string;
}
```

- [ ] Implement `calculateTransactionAmount(mealPrice, paidAmount)` using `paidAmount - mealPrice`.
- [ ] Implement `createLedgerTransaction(input)` that requires student snapshot, menu snapshot, business date, transaction type, and prior balance.
- [ ] Implement `countActiveOrdersForStudent(transactions, studentId, businessDate)`.
- [ ] Implement `canCancelToday(transactions, studentId, businessDate)`.
- [ ] Implement `recalculateStudentBalances(students, transactions)` with deterministic ordering by `businessDate`, `createdAt`, and `transactionId`.
- [ ] Export all public types/functions from `domain/index.ts`.

**Testing Strategy:**

- Unit:
  - order with no cash: `mealPrice = 90`, `paidAmount = 0`, `amount = -90`.
  - order with full cash: `mealPrice = 90`, `paidAmount = 90`, `amount = 0`.
  - top-up: `mealPrice = 0`, `paidAmount = 500`, `amount = 500`.
  - cancel reverses active same-day order count.
  - cancel disabled when active order count is zero.
  - duplicate count excludes canceled orders.
  - recalculation updates later balances for the same student.
- Integration:
  - covered by store tests in EO-P10-T06 and EO-P10-T07.

**Acceptance Criteria:**

- Ledger domain has no React/Zustand imports.
- Every new ledger transaction has student and menu snapshots.
- Tests run with `npx vitest run src/domain/__tests__/ledger.test.ts`.

## EO-P10-T05: Business Date And Sync Status Foundations

**Estimate:** 0.5 day / 2 SP

**Files:**

- Create: `frontend/src/domain/businessDate.ts`
- Create: `frontend/src/domain/syncStatus.ts`
- Create: `frontend/src/domain/__tests__/businessDate.test.ts`
- Modify: `frontend/src/domain/index.ts`

**Implementation Plan:**

- [ ] Define `BusinessDateStatus = 'open' | 'closed' | 'reopened'`.
- [ ] Define `isHistoricalBusinessDate(viewDate, systemDate)`.
- [ ] Define `canWriteBusinessDate(status, viewDate, systemDate)` returning false for historical or closed dates.
- [ ] Define shared sync status type used by Phase 1.0 records:

```ts
export type SyncStatus = 'local' | 'queued' | 'synced' | 'failed' | 'conflict';
```

- [ ] Export all public types/functions from `domain/index.ts`.

**Testing Strategy:**

- Unit:
  - current open date is writable.
  - historical date is not writable.
  - closed date is not writable even if it is current.
  - reopened date is writable only when it is not historical.
- Integration:
  - historical lock is already visible in current UI and will be hardened in Phase 1.1.

**Acceptance Criteria:**

- Business date helpers are deterministic and take explicit dates.
- No helper reads `new Date()` internally.
- Tests run with `npx vitest run src/domain/__tests__/businessDate.test.ts`.

## EO-P10-T06: Store Refactor With Compatibility Boundary

**Estimate:** 1.25 days / 5 SP

**Files:**

- Modify: `frontend/src/mocks/initialData.ts`
- Modify: `frontend/src/store/posStore.ts`
- Modify: `frontend/src/store/__tests__/posStore.test.ts`

**Implementation Plan:**

- [ ] Map current mock `Student { id, name, balance }` data into `StudentAccount` fields while preserving visible ids, names, and balances.
- [ ] Map current `Vendor` and `TodayMenu` mock data into new domain-compatible fields.
- [ ] Update transaction seed data to include `businessDate`, snapshots, source device, sync status, and revision.
- [ ] Refactor `processTransaction` to call `createStudentSnapshot`, `createMenuSnapshot`, and `createLedgerTransaction`.
- [ ] Refactor duplicate/cancel availability calculations to call ledger helpers.
- [ ] Refactor `updateTransaction` and `deleteTransaction` only enough to keep current tests passing; full audit/void semantics remain Phase 1.2.
- [ ] Add a compatibility read path for existing persisted records if the store receives old `id/name/balance` shape from localStorage.

**Testing Strategy:**

- Unit:
  - existing `posStore` accounting tests still pass.
  - `processTransaction` creates snapshots and business date.
  - old-shape student records are normalized into `StudentAccount`.
  - transaction amount formula remains unchanged.
- Integration:
  - render-level flow tests remain Phase 1.1; this task uses store-level integration only.

**Acceptance Criteria:**

- Current POS UI still renders with seeded data.
- Current order/top-up/cancel behavior remains equivalent.
- Store tests run with `npx vitest run src/store/__tests__/posStore.test.ts`.

## EO-P10-T07: Verification Hardening And Integration Guard

**Estimate:** 0.75 day / 2 SP

**Files:**

- Modify: `frontend/src/store/__tests__/posStore.test.ts`
- Modify: `frontend/src/test/setup.ts` only if test setup needs deterministic storage reset.
- Add: `frontend/src/domain/__tests__/integrationGuard.test.ts`

**Implementation Plan:**

- [ ] Add a domain integration guard test that imports from `frontend/src/domain/index.ts` and verifies all public Phase 1.0 types/helpers are exported.
- [ ] Add store tests for:
  - localStorage reset between tests.
  - process order preserves student/menu snapshots.
  - duplicate count uses active same-day order logic.
  - historical business date helper blocks writes at the domain level.
- [ ] Confirm no test depends on wall-clock time except where the store intentionally generates timestamps.
- [ ] Document any remaining wall-clock behavior in the test name or assertion.

**Testing Strategy:**

- Unit:
  - all domain test files under `frontend/src/domain/__tests__/`.
- Integration:
  - `frontend/src/store/__tests__/posStore.test.ts` exercises store plus domain helpers.

**Acceptance Criteria:**

- `npx vitest run src/domain/__tests__ src/store/__tests__/posStore.test.ts` passes.
- No existing test coverage is removed.
- New tests fail on the old component-only/domain-less implementation.

## Phase Done Criteria

- [ ] `frontend/src/domain/` exists with framework-free modules for student, menu, ledger, business date, and sync status.
- [ ] Zustand store uses domain helpers for transaction math and snapshots.
- [ ] Existing visible POS behavior is preserved.
- [ ] Student, menu/vendor, ledger, business date, and store integration tests pass.
- [ ] No Google Sheets transport, iPad camera, or major admin UI expansion is introduced.
- [ ] Full verification passes from `frontend/`:

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

## Risks And Mitigations

- Risk: LocalStorage shape change breaks existing prototype data.
  - Mitigation: add compatibility normalization in `posStore.ts` and tests with old-shape fixtures.
- Risk: Store refactor changes operator-visible behavior.
  - Mitigation: preserve seeded data and existing `posStore` tests, then add behavior-equivalence assertions.
- Risk: Domain model grows too broad before UI needs it.
  - Mitigation: include fields required by approved specs, but defer UI workflows and transport implementation to later phases.

## Review Checklist

- [ ] Every Task ID can be copied into AgEnD task board as a separate implementation task.
- [ ] Each task has estimate, file scope, technical plan, tests, and acceptance criteria.
- [ ] Phase scope matches ROADMAP Phase 1.0.
- [ ] Plan contains no implementation work outside docs.
