---
required_reads:
  - frontend/src/store/posStore.ts
  - frontend/src/store/posTypes.ts
  - frontend/src/store/posPersistence.ts
  - frontend/src/store/posActions/transactionActions.ts
  - frontend/src/store/posActions/sessionActions.ts
  - frontend/src/store/posActions/menuActions.ts
  - frontend/src/store/posActions/firebaseActions.ts
  - frontend/src/store/posActions/editActions.ts
  - frontend/src/store/posActions/orderActions.ts
  - frontend/src/store/posActions/paymentActions.ts
  - frontend/src/store/posActions/expenseActions.ts
  - frontend/src/store/derived/useCashClose.ts
  - frontend/src/store/derived/useLedger.ts
  - frontend/src/store/derived/useLedgerReport.ts
  - frontend/src/hooks/useAppState.ts
  - frontend/src/hooks/usePosFlow.ts
  - frontend/src/hooks/useUndoCountdown.ts
  - frontend/src/hooks/useCancelDialog.ts
  - frontend/src/hooks/useCrashDraftRecovery.ts
  - frontend/src/App.tsx
  - frontend/src/components/TodayDashboard.tsx
  - frontend/src/components/screens/ReportScreen.tsx
  - frontend/src/store/__tests__/posStore.test.ts
  - frontend/src/store/__tests__/transactionActions.test.ts
  - frontend/src/store/__tests__/sessionActions.test.ts
  - frontend/src/store/__tests__/menuActions.test.ts
  - frontend/src/__tests__/helpers/storeSetup.ts
research_skipped: "posTypes.ts already defines 5 domain slice interfaces; PR #140 established actions split; all 30 consumers mapped via grep — impact surface fully known"
revision: "v2 — revised after REJECTED plan review. Key change: facade-selector approach replaces multi-store split to avoid cross-domain action re-typing nightmare (5/8 action files are cross-domain). Reviewer findings: editActions touches 4 domains, paymentActions 3, menuActions contains resetData, sessionActions reads transactions, orderActions reads students+todayMenu."
---

# posStore Domain Split — Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the re-render blast radius of the monolithic `usePosStore` (degree=23) so components only re-render when their relevant domain state changes, while improving code navigability.

**Architecture:** **Facade-selector pattern** — keep a single unified Zustand store internally (avoiding the cross-domain action nightmare), but expose **domain-specific selector hooks** (`useStudents()`, `useTransactions()`, `useMenu()`, `useSession()`) that subscribe only to their slice via `useShallow`. This achieves the re-render isolation goal without splitting actions or persistence.

**Why not multi-store:** v1 plan review (REJECTED) revealed that 5 of 8 action creators are cross-domain (editActions touches 4 domains, paymentActions 3, sessionActions reads transactions, orderActions reads students+todayMenu). Splitting the store would require every cross-domain action to do `otherStore.getState()` reads and `otherStore.setState()` writes — fragile, hard to test, and loses Zustand's transactional `set()`.

**Tech Stack:** Zustand 5 (create + persist + useShallow), TypeScript 6, Vitest 4

**refs #264**

---

## Cross-Domain Action Audit (corrected from v1)

| Action File | Reads | Writes | Domains Touched |
|------------|-------|--------|----------------|
| `menuActions.ts` | — | todayMenu, vendors, **ALL domains (resetData L18-23)** | menu + ALL |
| `sessionActions.ts` | cashSessions, businessDateStatuses, **transactions (L56)**, dailySettlements | cashSessions, businessDateStatuses, dailySettlements, auditEvents | session + transaction |
| `transactionActions.ts` | — | — (orchestrator: delegates to order/payment/edit/expense actions) | ALL (via sub-actions) |
| `orderActions.ts` | **students**, **todayMenu**, transactions | **students**, transactions | student + menu + transaction |
| `paymentActions.ts` | **students**, **todayMenu** | **students**, transactions | student + menu + transaction |
| `editActions.ts` | **students**, transactions, **businessDateStatuses**, **auditEvents** | **students**, transactions, **auditEvents** | student + transaction + session |
| `expenseActions.ts` | transactions | transactions | transaction only |
| `firebaseActions.ts` | — (external Firebase calls) | — | firebase (external, no local state) |

**Conclusion:** Only `expenseActions.ts` is truly single-domain. Multi-store split would require 5+ action files to do cross-store reads/writes, breaking transactional consistency.

---

## File Structure

### New files to create:
- `frontend/src/store/selectors.ts` — Domain-specific selector hooks
- `frontend/src/store/__tests__/selectors.test.ts` — Selector hook tests (re-render isolation)

### Files to modify:
- `frontend/src/store/posTypes.ts` — Add per-domain action interfaces (for type documentation)
- `frontend/src/hooks/useAppState.ts` — Migrate to domain selectors
- `frontend/src/hooks/usePosFlow.ts` — Migrate to domain selectors
- `frontend/src/hooks/useUndoCountdown.ts` — Migrate to domain selectors
- `frontend/src/hooks/useCancelDialog.ts` — Migrate to domain selectors
- `frontend/src/hooks/useCrashDraftRecovery.ts` — Migrate to domain selectors
- `frontend/src/components/TodayDashboard.tsx` — Migrate to domain selectors
- `frontend/src/components/screens/ReportScreen.tsx` — Migrate to domain selectors
- `frontend/src/store/derived/useCashClose.ts` — Migrate to domain selectors
- `frontend/src/store/derived/useLedger.ts` — Migrate to domain selectors
- `frontend/src/store/derived/useLedgerReport.ts` — Migrate to domain selectors
- `frontend/src/components/report/AuditTrailTable.tsx` — Migrate to domain selectors
- `frontend/src/components/report/SettlementHistoryTable.tsx` — Migrate to domain selectors
- `frontend/src/App.tsx` — Migrate to domain selectors

### Consumer migration map:

| Consumer File | Current Usage | Target Selector |
|--------------|--------------|-----------------|
| `hooks/useAppState.ts` | `usePosStore(useShallow(...))` selecting 12 fields | `useStudents()` + `useTransactions()` + `useMenu()` + `useSession()` |
| `hooks/usePosFlow.ts` | `usePosStore(useShallow(...))` selecting students+todayMenu+transactions+action | `useStudents()` + `useMenu()` + `useTransactions()` |
| `hooks/useUndoCountdown.ts` | `usePosStore((s) => s.deleteTransaction)` | `useTransactionActions()` |
| `hooks/useCancelDialog.ts` | `usePosStore((s) => s.deleteOrderWithRefundCheck)` | `useTransactionActions()` |
| `hooks/useCrashDraftRecovery.ts` | `usePosStore((s) => s.students)` | `useStudents()` |
| `components/TodayDashboard.tsx` | `usePosStore(useShallow(...))` selecting audit+settlements+statuses | `useSession()` |
| `components/screens/ReportScreen.tsx` | `usePosStore(useShallow(...))` selecting session+transaction actions | `useSessionActions()` + `useTransactionActions()` |
| `store/derived/useCashClose.ts` | 3 separate `usePosStore((s) => ...)` calls | `useSession()` |
| `store/derived/useLedger.ts` | `usePosStore((s) => s.transactions)` | `useTransactions()` |
| `store/derived/useLedgerReport.ts` | `usePosStore(useShallow(...))` with filter | `useTransactions()` (custom selector) |
| `components/report/AuditTrailTable.tsx` | `usePosStore(useShallow((s) => s.auditEvents))` | `useSession()` |
| `components/report/SettlementHistoryTable.tsx` | `usePosStore(useShallow((s) => s.dailySettlements))` | `useSession()` |
| `App.tsx` | `usePosStore.getState().transactions[0]` | `useTransactionStore.getState()` or keep (non-reactive) |
| `components/report/DetailRow.tsx` | `CASHIER_SENTINEL` (constant re-export) | No change needed |
| `components/report/ledgerGroupUtils.ts` | `mergeLedgerTransactions` (function re-export) | No change needed |

### Test files that mock posStore (must update):
- `components/__tests__/screens.test.tsx` — vi.mock posStore
- `components/__tests__/TodayDashboard.test.tsx` — vi.mock posStore
- `components/report/__tests__/AuditTrailTable.test.tsx` — vi.mock posStore
- `components/report/__tests__/SettlementHistoryTable.test.tsx` — vi.mock posStore
- `hooks/__tests__/usePosFlow.test.ts`
- `hooks/__tests__/useUndoCountdown.test.ts`
- `hooks/__tests__/useCrashDraftRecovery.test.ts`

---

## Task 1: Create Domain Selector Hooks

**Files:**
- Create: `frontend/src/store/selectors.ts`
- Create: `frontend/src/store/__tests__/selectors.test.ts`

- [ ] **Step 1: Write failing tests for re-render isolation**

Create `frontend/src/store/__tests__/selectors.test.ts`:

```typescript
import { renderHook, act } from '@testing-library/react';
import { usePosStore } from '../posStore';
import {
  useStudents,
  useTransactions,
  useMenu,
  useSession,
  useTransactionActions,
  useSessionActions,
} from '../selectors';

beforeEach(() => {
  usePosStore.getState().resetData();
});

describe('domain selector hooks', () => {
  it('useStudents returns only student state', () => {
    const { result } = renderHook(() => useStudents());
    expect(result.current.students).toBeDefined();
    expect(Array.isArray(result.current.students)).toBe(true);
  });

  it('useTransactions returns only transaction state', () => {
    const { result } = renderHook(() => useTransactions());
    expect(result.current.transactions).toBeDefined();
    expect(Array.isArray(result.current.transactions)).toBe(true);
  });

  it('useMenu returns only menu state', () => {
    const { result } = renderHook(() => useMenu());
    expect(result.current.todayMenu).toBeDefined();
    expect(result.current.vendors).toBeDefined();
  });

  it('useSession returns session + audit + settlement state', () => {
    const { result } = renderHook(() => useSession());
    expect(result.current.auditEvents).toBeDefined();
    expect(result.current.dailySettlements).toBeDefined();
    expect(result.current.businessDateStatuses).toBeDefined();
    expect(result.current.cashSessions).toBeDefined();
  });

  it('useTransactionActions returns action functions', () => {
    const { result } = renderHook(() => useTransactionActions());
    expect(typeof result.current.deleteTransaction).toBe('function');
    expect(typeof result.current.editTransaction).toBe('function');
    expect(typeof result.current.commitPosTransactionDraft).toBe('function');
  });

  it('useSessionActions returns session action functions', () => {
    const { result } = renderHook(() => useSessionActions());
    expect(typeof result.current.closeBusinessDate).toBe('function');
    expect(typeof result.current.reopenBusinessDate).toBe('function');
    expect(typeof result.current.openCashSession).toBe('function');
  });

  it('useStudents does not re-render when transactions change', () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount++;
      return useStudents();
    });

    const initialCount = renderCount;

    // Mutate transactions — should NOT trigger re-render of useStudents
    act(() => {
      usePosStore.getState().processTransaction(
        result.current.students[0]?.studentId ?? 'test-student',
        'topup',
        0,
        100,
      );
    });

    // renderCount should not increase (or increase by at most 0 due to shallow equality)
    // Note: Zustand + useShallow guarantees no re-render if selected slice unchanged
    expect(renderCount).toBe(initialCount);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/store/__tests__/selectors.test.ts`
Expected: FAIL — `selectors.ts` doesn't exist yet

- [ ] **Step 3: Create selectors.ts**

Create `frontend/src/store/selectors.ts`:

```typescript
import { useShallow } from 'zustand/shallow';
import { usePosStore } from './posStore';
import type {
  StudentStateSlice,
  TransactionStateSlice,
  MenuStateSlice,
  AuditStateSlice,
  SettlementStateSlice,
} from './posTypes';

// ─── State Selectors (subscribe only to domain slice) ───

/** Student domain state only. Re-renders only when students change. */
export function useStudents(): StudentStateSlice {
  return usePosStore(useShallow((s) => ({ students: s.students })));
}

/** Transaction domain state only. Re-renders only when transactions change. */
export function useTransactions(): TransactionStateSlice {
  return usePosStore(useShallow((s) => ({ transactions: s.transactions })));
}

/** Menu domain state only. Re-renders only when menu/vendors change. */
export function useMenu(): MenuStateSlice {
  return usePosStore(useShallow((s) => ({
    vendors: s.vendors,
    todayMenu: s.todayMenu,
  })));
}

/** Session + Audit + Settlement state. Re-renders only when these change. */
export function useSession(): AuditStateSlice & SettlementStateSlice {
  return usePosStore(useShallow((s) => ({
    auditEvents: s.auditEvents,
    dailySettlements: s.dailySettlements,
    businessDateStatuses: s.businessDateStatuses,
    cashSessions: s.cashSessions,
  })));
}

// ─── Action Selectors (stable references, no re-render on state change) ───

/** Transaction actions. Stable references — will not cause re-renders. */
export function useTransactionActions() {
  return usePosStore(useShallow((s) => ({
    commitPosTransactionDraft: s.commitPosTransactionDraft,
    processTransaction: s.processTransaction,
    updateTransaction: s.updateTransaction,
    deleteTransaction: s.deleteTransaction,
    deleteOrderWithRefundCheck: s.deleteOrderWithRefundCheck,
    editTransaction: s.editTransaction,
  })));
}

/** Session actions. Stable references — will not cause re-renders. */
export function useSessionActions() {
  return usePosStore(useShallow((s) => ({
    setBusinessDateStatus: s.setBusinessDateStatus,
    openCashSession: s.openCashSession,
    updateOpeningCash: s.updateOpeningCash,
    closeBusinessDate: s.closeBusinessDate,
    reopenBusinessDate: s.reopenBusinessDate,
    getBusinessDateStatus: s.getBusinessDateStatus,
  })));
}

/** Menu actions. Stable references. */
export function useMenuActions() {
  return usePosStore(useShallow((s) => ({
    setTodayMenu: s.setTodayMenu,
    setVendors: s.setVendors,
  })));
}

/** Student actions. Stable references. */
export function useStudentActions() {
  return usePosStore(useShallow((s) => ({
    addStudent: s.addStudent,
    disableStudent: s.disableStudent,
  })));
}

/** Global actions. */
export function useGlobalActions() {
  return usePosStore(useShallow((s) => ({
    resetData: s.resetData,
  })));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/store/__tests__/selectors.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/selectors.ts frontend/src/store/__tests__/selectors.test.ts
git commit -m "feat(store): add domain-specific selector hooks for re-render isolation (#264)"
```

---

## Task 2: Add Per-Domain Action Interfaces to posTypes.ts

**Files:**
- Modify: `frontend/src/store/posTypes.ts`

- [ ] **Step 1: Add action interfaces**

Add after existing slice interfaces, before `PosState`:

```typescript
/** Transaction domain actions */
export interface TransactionActions {
  commitPosTransactionDraft: (draft: PosTransactionDraft) => void;
  processTransaction: (
    studentId: string,
    type: LedgerTransaction['type'],
    mealPrice: number,
    paidAmount: number,
    note?: string
  ) => void;
  updateTransaction: (id: string, updates: Partial<LedgerTransaction>) => void;
  deleteTransaction: (id: string) => void;
  deleteOrderWithRefundCheck: (id: string) => DeleteOrderResult;
  editTransaction: (id: string, updates: { mealPrice?: number; paidAmount?: number; note?: string }) => void;
}

/** Menu domain actions */
export interface MenuActions {
  setTodayMenu: (menu: TodayMenu) => void;
  setVendors: (vendors: Vendor[]) => void;
  resetData: () => void;
}

/** Session domain actions */
export interface SessionActions {
  setBusinessDateStatus: (date: string, status: BusinessDateStatus) => void;
  openCashSession: (input: OpenCashSessionInput) => void;
  updateOpeningCash: (businessDate: string, amount: number) => void;
  closeBusinessDate: (input: CloseBusinessDateInput) => void;
  reopenBusinessDate: (input: ReopenBusinessDateInput) => void;
  getBusinessDateStatus: (businessDate: string) => BusinessDateStatus;
}

/** Student domain actions */
export interface StudentActions {
  addStudent: (db: Firestore, input: { studentId: string; displayName: string; openingBalance: number; operatorId: string }) => Promise<void>;
  disableStudent: (db: Firestore, input: { studentId: string; operatorId: string }) => Promise<void>;
}
```

Update `PosState` to extend:

```typescript
export interface PosState
  extends StudentStateSlice,
    TransactionStateSlice,
    MenuStateSlice,
    AuditStateSlice,
    SettlementStateSlice,
    TransactionActions,
    MenuActions,
    SessionActions,
    StudentActions {}
```

- [ ] **Step 2: Run type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/store/posTypes.ts
git commit -m "refactor(store): extract per-domain action interfaces for documentation (#264)"
```

---

## Task 3: Migrate Single-Domain Consumers

Migrate consumers that access only one domain — these are the simplest and safest.

**Files:**
- Modify: `frontend/src/store/derived/useLedger.ts`
- Modify: `frontend/src/store/derived/useLedgerReport.ts`
- Modify: `frontend/src/hooks/useUndoCountdown.ts`
- Modify: `frontend/src/hooks/useCrashDraftRecovery.ts`
- Modify: `frontend/src/components/report/AuditTrailTable.tsx`
- Modify: `frontend/src/components/report/SettlementHistoryTable.tsx`
- Modify: `frontend/src/components/TodayDashboard.tsx`
- Modify: `frontend/src/store/derived/useCashClose.ts`

- [ ] **Step 1: Migrate transaction-only consumers**

`store/derived/useLedger.ts`:
```typescript
// Before:
import { usePosStore } from '../posStore';
// After:
import { useTransactions } from '../selectors';
// Replace: usePosStore((s) => s.transactions)
// With: useTransactions().transactions
```

`store/derived/useLedgerReport.ts`:
```typescript
// Replace usePosStore import with useTransactions from selectors
// Keep the custom filter logic inside — useTransactions gives raw transactions,
// component applies the dateRange filter via useMemo
```

`hooks/useUndoCountdown.ts`:
```typescript
// Replace:
import { usePosStore } from '../store/posStore';
const deleteTransaction = usePosStore((s) => s.deleteTransaction);
// With:
import { useTransactionActions } from '../store/selectors';
const { deleteTransaction } = useTransactionActions();
```

`hooks/useCrashDraftRecovery.ts`:
```typescript
// Replace:
import { usePosStore } from '../store/posStore';
// student access with:
import { useStudents } from '../store/selectors';
```

- [ ] **Step 2: Migrate session-only consumers**

`store/derived/useCashClose.ts`:
```typescript
// Replace 3 separate usePosStore calls with:
import { useSession } from '../selectors';
const { businessDateStatuses, cashSessions, dailySettlements } = useSession();
```

`components/TodayDashboard.tsx`:
```typescript
// Replace: usePosStore(useShallow((s) => ({ auditEvents, dailySettlements, businessDateStatuses })))
// With: useSession()
```

`components/report/AuditTrailTable.tsx`:
```typescript
// Replace: usePosStore(useShallow((s) => s.auditEvents))
// With: useSession().auditEvents
```

`components/report/SettlementHistoryTable.tsx`:
```typescript
// Replace: usePosStore(useShallow((s) => s.dailySettlements))
// With: useSession().dailySettlements
```

- [ ] **Step 3: Update test mocks**

Test files that mock `../../store/posStore` for these components need to be updated to mock `../../store/selectors` (or `../selectors` depending on relative path):

- `components/__tests__/TodayDashboard.test.tsx` — mock selectors instead of posStore
- `components/report/__tests__/AuditTrailTable.test.tsx` — mock selectors
- `components/report/__tests__/SettlementHistoryTable.test.tsx` — mock selectors
- `hooks/__tests__/useUndoCountdown.test.ts` — mock selectors
- `hooks/__tests__/useCrashDraftRecovery.test.ts` — mock selectors

- [ ] **Step 4: Run affected tests**

Run: `cd frontend && npx vitest run src/store/derived/ src/hooks/__tests__/useUndoCountdown.test.ts src/hooks/__tests__/useCrashDraftRecovery.test.ts src/components/__tests__/TodayDashboard.test.tsx src/components/report/__tests__/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor(store): migrate single-domain consumers to selector hooks (#264)"
```

---

## Task 4: Migrate Multi-Domain Consumers

**Files:**
- Modify: `frontend/src/hooks/useAppState.ts`
- Modify: `frontend/src/hooks/usePosFlow.ts`
- Modify: `frontend/src/hooks/useCancelDialog.ts`
- Modify: `frontend/src/components/screens/ReportScreen.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Migrate useAppState.ts**

This is the largest consumer. Rewrite to use domain selectors:

```typescript
import { useMemo } from 'react';
import { useStudents } from '../store/selectors';
import { useTransactions } from '../store/selectors';
import { useMenu, useMenuActions } from '../store/selectors';
import { useSession, useSessionActions } from '../store/selectors';
import { useGlobalActions } from '../store/selectors';
// ... keep existing UseAppStateReturn interface and computed logic
```

Each domain is subscribed independently via its own `useShallow` — if only transactions change, the student/menu/session subscriptions don't fire.

- [ ] **Step 2: Migrate usePosFlow.ts**

```typescript
import { useStudents } from '../store/selectors';
import { useMenu } from '../store/selectors';
import { useTransactions, useTransactionActions } from '../store/selectors';
```

- [ ] **Step 3: Migrate useCancelDialog.ts**

```typescript
import { useTransactionActions } from '../store/selectors';
const { deleteOrderWithRefundCheck } = useTransactionActions();
```

- [ ] **Step 4: Migrate ReportScreen.tsx**

```typescript
import { useSessionActions, useTransactionActions } from '../../store/selectors';
const { closeBusinessDate, reopenBusinessDate } = useSessionActions();
const { deleteOrderWithRefundCheck, deleteTransaction, editTransaction } = useTransactionActions();
```

- [ ] **Step 5: Migrate App.tsx**

For `usePosStore.getState().transactions[0]` (non-reactive, in useEffect):
```typescript
// Keep using usePosStore.getState() for non-reactive reads — this is fine,
// the getState() pattern doesn't subscribe and doesn't re-render.
// OR import usePosStore directly for this one usage.
```

- [ ] **Step 6: Update test mocks**

- `components/__tests__/screens.test.tsx` — mock `../../store/selectors`
- `hooks/__tests__/usePosFlow.test.ts` — mock `../store/selectors`

- [ ] **Step 7: Run full test suite**

Run: `cd .. && ./workflow.sh t4`
Expected: ALL PASS (720+ tests)

- [ ] **Step 8: Commit**

```bash
git commit -am "refactor(store): migrate multi-domain consumers to selector hooks (#264)"
```

---

## Task 5: Final Verification + PR

**Files:**
- No new changes — verification only

- [ ] **Step 1: Run full verification chain**

```bash
cd .. && ./workflow.sh t1  # build
./workflow.sh t2           # typecheck
./workflow.sh t3           # lint
./workflow.sh t4           # unit tests (full)
```
Expected: ALL PASS

- [ ] **Step 2: Verify migration completeness**

```bash
# Count remaining direct usePosStore imports in production code (excluding posStore.ts, selectors.ts, tests)
grep -rn "from.*posStore\|import.*posStore" frontend/src/ \
  --include="*.ts" --include="*.tsx" \
  | grep -v "posStore.ts" \
  | grep -v "selectors.ts" \
  | grep -v "__tests__" \
  | grep -v "node_modules"
```

Expected: Only `App.tsx` (non-reactive `getState()`) and re-exports (`DetailRow.tsx` for `CASHIER_SENTINEL`, `ledgerGroupUtils.ts` for `mergeLedgerTransactions`) — these are constant/function re-exports, not state subscriptions.

- [ ] **Step 3: Create PR**

```bash
git push origin feat/264-posstore-domain-split
gh pr create --base dev --title "Refactor: posStore domain selector hooks for re-render isolation (#264)" \
  --body "Closes #264

## Summary
Add domain-specific selector hooks that subscribe only to their slice via useShallow,
reducing re-render blast radius from 'any state change' to 'domain-relevant changes'.

## Approach — Facade Selectors (not multi-store)
- **Single store retained**: 5/8 action creators are cross-domain; splitting the store
  would require fragile cross-store getState/setState.
- **Domain selectors**: useStudents(), useTransactions(), useMenu(), useSession() —
  each wraps usePosStore + useShallow for a specific slice.
- **Action selectors**: useTransactionActions(), useSessionActions(), etc. — stable
  function references that don't trigger re-renders.
- **Zero breaking changes**: usePosStore still works; consumers migrated incrementally.

## Testing
- All existing 720+ tests pass (t1-t4)
- New selectors.test.ts verifies re-render isolation"
```

- [ ] **Step 4: Commit**

```bash
# Only if PR creation generates any changes
```

---

## Verification Steps

| # | Check | Command | Expected |
|---|-------|---------|----------|
| 1 | TypeScript compiles | `./workflow.sh t2` | PASS |
| 2 | Lint clean | `./workflow.sh t3` | PASS |
| 3 | Unit tests pass | `./workflow.sh t4` | ALL 720+ PASS |
| 4 | Build succeeds | `./workflow.sh t1` | PASS |
| 5 | Selectors re-render isolation | `npx vitest run src/store/__tests__/selectors.test.ts` | Re-render count unchanged when unrelated domain mutates |
| 6 | No unnecessary posStore subscriptions | grep remaining imports | Only non-reactive getState() + constant re-exports |
