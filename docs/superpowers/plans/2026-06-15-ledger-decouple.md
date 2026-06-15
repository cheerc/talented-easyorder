---
required_reads:
  - frontend/src/domain/ledger.ts
  - frontend/src/domain/ledgerReport.ts
  - frontend/src/domain/ledgerExport.ts
  - frontend/src/domain/ledgerSyncBoundary.ts
  - frontend/src/components/report/DetailRow.tsx
  - frontend/src/components/report/ExpenseOnlyRow.tsx
  - frontend/src/components/report/IncomeRow.tsx
  - frontend/src/components/report/LedgerGroupedTable.tsx
  - frontend/src/components/report/ledgerGroupUtils.ts
  - frontend/src/components/screens/ReportScreen.tsx
  - frontend/src/components/PosColumn.types.ts
  - frontend/src/hooks/useCancelDialog.ts
  - frontend/src/hooks/useFlashData.ts
  - frontend/src/hooks/useTransactionCommit.ts
  - frontend/src/store/posTypes.ts
  - frontend/src/store/derived/useLedger.ts
  - frontend/src/store/derived/useLedgerReport.ts
  - frontend/src/store/derived/useLedgerExport.ts
  - frontend/src/storage/wireTypes.ts
  - frontend/src/storage/posStateValidator.ts
audit_method: "grep -c LedgerTransaction per file + full read of domain/ledger.ts"
---

# LedgerTransaction Decoupling — Implementation Plan

> **For agentic workers:** Use executing-plans skill to implement task-by-task.

**Goal:** Reduce LedgerTransaction's degree from 33 to ~15 by introducing subsystem-specific view interfaces. Core domain retains `LedgerTransaction`; UI/reporting/hooks consume narrower types.

**Architecture:** **Narrowing interfaces** (not separate types) — subsystems declare what they need via `Pick<LedgerTransaction, ...>` or dedicated interfaces. This avoids data mapping overhead while achieving type-level decoupling.

**Why not full ViewModel mapping:** LedgerTransaction is the persistence type (IndexedDB + Firestore). Full mapping would require mapping functions at every boundary (98 refs), massive risk for a mechanical refactor. Narrowing interfaces achieve the same decoupling goal with zero runtime cost.

**Existing patterns:** `TransactionEditView` (L131) and `LedgerPrintViewModel` (ledgerExport.ts:124) already demonstrate this approach.

**refs #267**

---

## Subsystem Audit (grep-verified)

| Subsystem | Files | Refs | Fields Actually Used |
|-----------|-------|------|---------------------|
| **Domain (core)** | ledger.ts, ledgerReport.ts, ledgerExport.ts, ledgerSyncBoundary.ts | 23 | All (owner) — no change |
| **Store (state)** | posTypes.ts, posStore.ts, 4 action files | 17 | All (manages full objects) — no change |
| **UI Report** | DetailRow, ExpenseOnlyRow, IncomeRow, LedgerGroupedTable, ledgerGroupUtils, ReportScreen | 22 | transactionId, businessDate, studentNameSnapshot, type, amount, mealPrice, paidAmount, afterBalance, menuNameSnapshot, vendorNameSnapshot, note, syncStatus, createdAt |
| **Hooks** | useFlashData, useCancelDialog, useTransactionCommit, useAppState | 9 | transactionId, businessDate, type, amount, studentId, createdAt, syncStatus |
| **Storage** | migration.ts, posStateValidator.ts, wireTypes.ts | 9 | All (serialization) — no change |
| **Derived** | useLedger, useLedgerReport, useLedgerExport | 12 | Various — already use domain functions |

**Migration targets:** UI Report (22 refs) + Hooks (9 refs) = 31 refs to narrow. Domain/Store/Storage keep full `LedgerTransaction`.

---

## Task 1: Define Narrowing Interfaces

**Files:**
- Create: `frontend/src/domain/transactionViews.ts`
- Test: `frontend/src/domain/__tests__/transactionViews.test.ts`

- [ ] **Step 1: Create subsystem view interfaces**

```typescript
// frontend/src/domain/transactionViews.ts
import type { LedgerTransaction } from './ledger';

/** Fields needed by report UI components (DetailRow, IncomeRow, ExpenseOnlyRow, etc.) */
export interface ReportTransactionView {
  transactionId: string;
  businessDate: string;
  createdAt: string;
  studentNameSnapshot: string;
  type: LedgerTransaction['type'];
  mealPrice: number;
  paidAmount: number;
  amount: number;
  afterBalance: number;
  menuNameSnapshot: string;
  vendorNameSnapshot: string;
  note: string;
  syncStatus: LedgerTransaction['syncStatus'];
}

/** Fields needed by POS workflow hooks (useFlashData, useCancelDialog, useTransactionCommit) */
export interface WorkflowTransactionView {
  transactionId: string;
  businessDate: string;
  type: LedgerTransaction['type'];
  amount: number;
  studentId: string;
  createdAt: string;
  syncStatus: LedgerTransaction['syncStatus'];
}

// Type compatibility assertion: LedgerTransaction extends both views
// (compile-time verification, zero runtime cost)
type _AssertReportCompat = LedgerTransaction extends ReportTransactionView ? true : never;
type _AssertWorkflowCompat = LedgerTransaction extends WorkflowTransactionView ? true : never;
```

- [ ] **Step 2: Write type compatibility tests**

```typescript
// Verify that LedgerTransaction satisfies both views
import type { LedgerTransaction } from '../ledger';
import type { ReportTransactionView, WorkflowTransactionView } from '../transactionViews';

// These should compile without error
const _report: ReportTransactionView = {} as LedgerTransaction;
const _workflow: WorkflowTransactionView = {} as LedgerTransaction;
```

- [ ] **Step 3: Commit**

```bash
git commit -am "feat: add ReportTransactionView and WorkflowTransactionView interfaces (#267)"
```

---

## Task 2: Migrate Report UI Components

**Files to modify:**
- `frontend/src/components/report/DetailRow.tsx` — `tx: LedgerTransaction` → `tx: ReportTransactionView`
- `frontend/src/components/report/ExpenseOnlyRow.tsx` — same
- `frontend/src/components/report/IncomeRow.tsx` — same
- `frontend/src/components/report/LedgerGroupedTable.tsx` — `transactions: LedgerTransaction[]` → `transactions: ReportTransactionView[]`
- `frontend/src/components/report/ledgerGroupUtils.ts` — group functions accept `ReportTransactionView[]`
- `frontend/src/components/screens/ReportScreen.tsx` — handler types

For each file:
1. Replace `import type { LedgerTransaction }` with `import type { ReportTransactionView }`
2. Replace `LedgerTransaction` in prop types with `ReportTransactionView`
3. Verify no field access beyond ReportTransactionView's fields

- [ ] **Step 1: Migrate DetailRow, ExpenseOnlyRow, IncomeRow**

These are leaf components — safest to migrate first.

- [ ] **Step 2: Migrate LedgerGroupedTable + ledgerGroupUtils**

LedgerGroupedTable passes transactions to row components. Update types to match.

- [ ] **Step 3: Migrate ReportScreen handlers**

`handleEditClick(t: LedgerTransaction)` → check if ReportScreen actually needs full LedgerTransaction or just ReportTransactionView fields.

⚠️ **Careful:** ReportScreen's `handleEditClick` and `handleDeleteClick` pass transaction to store actions which expect `LedgerTransaction`. If so, keep `LedgerTransaction` for these callbacks or use `transactionId` only.

- [ ] **Step 4: Run tests**

```bash
cd frontend && npx vitest run src/components/report/ src/components/__tests__/
```

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor: report UI components use ReportTransactionView instead of LedgerTransaction (#267)"
```

---

## Task 3: Migrate Hooks to WorkflowTransactionView

**Files to modify:**
- `frontend/src/hooks/useFlashData.ts`
- `frontend/src/hooks/useCancelDialog.ts`
- `frontend/src/components/PosColumn.types.ts`

- [ ] **Step 1: Audit each hook's actual field usage**

```bash
# For each hook, grep which LedgerTransaction fields are accessed
grep -n '\.\(transactionId\|businessDate\|type\|amount\|studentId\|createdAt\|syncStatus\|mealPrice\|paidAmount\)' frontend/src/hooks/useFlashData.ts
```

- [ ] **Step 2: Replace LedgerTransaction imports with WorkflowTransactionView**

Where hooks only access WorkflowTransactionView fields, replace the import.

⚠️ **useTransactionCommit:** This hook creates new transactions (calls `createLedgerTransaction`) — it needs to stay with full `LedgerTransaction`. Don't migrate.

- [ ] **Step 3: Update PosColumn.types.ts**

If PosColumn only displays transaction info (not mutating), narrow to `ReportTransactionView` or `WorkflowTransactionView`.

- [ ] **Step 4: Run tests**

```bash
cd frontend && npx vitest run
```

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor: workflow hooks use WorkflowTransactionView (#267)"
```

---

## Task 4: Update Derived Hooks

**Files:**
- `frontend/src/store/derived/useLedger.ts`
- `frontend/src/store/derived/useLedgerReport.ts`

These hooks return `LedgerTransaction[]` from the store. Their return types should stay as `LedgerTransaction[]` (they pull from the store which holds full objects), but their consumers (UI) now expect narrower types — this is automatically compatible since `LedgerTransaction extends ReportTransactionView`.

- [ ] **Step 1: Verify type compatibility**

No changes needed if `LedgerTransaction extends ReportTransactionView` (Task 1's type assertion). Verify with `tsc --noEmit`.

- [ ] **Step 2: Run full verification**

```bash
./workflow.sh t1 && ./workflow.sh t2 && ./workflow.sh t3 && ./workflow.sh t4
```

- [ ] **Step 3: Commit (if any changes needed)**

---

## Task 5: Verify Degree Reduction + Create PR

- [ ] **Step 1: Count remaining direct LedgerTransaction imports**

```bash
grep -rn "import.*LedgerTransaction" frontend/src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v __tests__ | wc -l
```

Expected: ~15 (down from 28 — domain/store/storage remain, UI/hooks migrated).

- [ ] **Step 2: Create PR**

```bash
git push origin feat/267-ledger-decouple
gh pr create --base dev --title "Refactor: Decouple subsystems from LedgerTransaction type (#267)" \
  --body "Closes #267

## Summary
Introduce ReportTransactionView and WorkflowTransactionView interfaces to decouple
UI and hook subsystems from the full LedgerTransaction type.

## Approach
Narrowing interfaces (not separate types) — zero runtime cost, compile-time decoupling.
LedgerTransaction extends both views, so no mapping functions needed.

## Metrics
- LedgerTransaction import count: 28 → ~15 files
- Report UI components: fully decoupled
- Workflow hooks: fully decoupled
- Domain/Store/Storage: unchanged (they own the full type)

## Testing
t1-t4 all pass"
```

---

## Verification Steps

| # | Check | Command | Expected |
|---|-------|---------|----------|
| 1 | TypeScript compiles | `./workflow.sh t2` | PASS |
| 2 | No runtime changes | `git diff --stat` shows only `.ts`/`.tsx` type changes | No `.js` output changes |
| 3 | Unit tests pass | `./workflow.sh t4` | PASS |
| 4 | Import count reduced | `grep -c` LedgerTransaction imports | ≤15 files (from 28) |
| 5 | Type assertions compile | transactionViews.ts type assertions | No errors |
