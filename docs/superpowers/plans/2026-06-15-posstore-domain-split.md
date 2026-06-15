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
---

# posStore Domain Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the monolithic `usePosStore` (degree=23, single Zustand store serving all domains) into domain-specific stores, reducing re-render blast radius and improving maintainability.

**Architecture:** Create 4 domain stores (`useStudentStore`, `useTransactionStore`, `useMenuStore`, `useSessionStore`) with independent persistence. Retain `usePosStore` as a **thin compatibility re-export** (re-exports all domain hooks + combined `getState()`) so existing consumers migrate incrementally — zero breakage at each commit.

**Tech Stack:** Zustand 5 (create + persist), TypeScript 6, Vitest 4

**refs #264**

---

## Domain Mapping

The existing `posTypes.ts` already defines 5 slice interfaces. Map to 4 stores (audit is thin, co-locate with session):

| New Store | Slice Interfaces | State | Actions | Persistence Key |
|-----------|-----------------|-------|---------|-----------------|
| `useStudentStore` | `StudentStateSlice` | `students` | `addStudent`, `disableStudent` | `student-storage` |
| `useTransactionStore` | `TransactionStateSlice` | `transactions` | `commitPosTransactionDraft`, `processTransaction`, `updateTransaction`, `deleteTransaction`, `deleteOrderWithRefundCheck`, `editTransaction` | `transaction-storage` |
| `useMenuStore` | `MenuStateSlice` | `vendors`, `todayMenu` | `setTodayMenu`, `setVendors` | `menu-storage` |
| `useSessionStore` | `AuditStateSlice` + `SettlementStateSlice` | `auditEvents`, `dailySettlements`, `businessDateStatuses`, `cashSessions` | `setBusinessDateStatus`, `openCashSession`, `updateOpeningCash`, `closeBusinessDate`, `reopenBusinessDate`, `getBusinessDateStatus` | `session-storage` |

## File Structure

### New files to create:
- `frontend/src/store/studentStore.ts` — Student domain store
- `frontend/src/store/transactionStore.ts` — Transaction domain store  
- `frontend/src/store/menuStore.ts` — Menu domain store
- `frontend/src/store/sessionStore.ts` — Session + Audit + Settlement domain store
- `frontend/src/store/__tests__/studentStore.test.ts` — Student store tests
- `frontend/src/store/__tests__/transactionStore.test.ts` — (rename existing)

### Files to modify:
- `frontend/src/store/posStore.ts` — Becomes thin compatibility layer
- `frontend/src/store/posTypes.ts` — Add per-store action interfaces
- `frontend/src/store/posPersistence.ts` — Split into per-store persistence configs
- `frontend/src/store/__tests__/posStore.test.ts` — Update to test compat layer
- `frontend/src/__tests__/helpers/storeSetup.ts` — Reset all stores
- All consumer files (30 files) — Migrate imports incrementally

### Consumer migration map (affected callers):

| Consumer File | Current Slice Access | Target Store |
|--------------|---------------------|--------------|
| `hooks/useAppState.ts` | students, transactions, todayMenu, vendors, cashSessions, dailySettlements + 6 actions | Multi-store (all 4) |
| `hooks/usePosFlow.ts` | students, todayMenu, transactions, commitPosTransactionDraft | useStudentStore + useMenuStore + useTransactionStore |
| `hooks/useUndoCountdown.ts` | deleteTransaction | useTransactionStore |
| `hooks/useCancelDialog.ts` | deleteOrderWithRefundCheck | useTransactionStore |
| `hooks/useCrashDraftRecovery.ts` | students | useStudentStore |
| `components/TodayDashboard.tsx` | auditEvents, dailySettlements, businessDateStatuses | useSessionStore |
| `components/screens/ReportScreen.tsx` | closeBusinessDate, reopenBusinessDate, deleteOrderWithRefundCheck, deleteTransaction, editTransaction | useSessionStore + useTransactionStore |
| `store/derived/useCashClose.ts` | businessDateStatuses, cashSessions, dailySettlements | useSessionStore |
| `store/derived/useLedger.ts` | transactions | useTransactionStore |
| `store/derived/useLedgerReport.ts` | transactions | useTransactionStore |
| `components/report/AuditTrailTable.tsx` | auditEvents | useSessionStore |
| `components/report/SettlementHistoryTable.tsx` | dailySettlements | useSessionStore |
| `components/report/DetailRow.tsx` | CASHIER_SENTINEL (constant re-export) | No store change |
| `components/report/ledgerGroupUtils.ts` | mergeLedgerTransactions (function re-export) | No store change |
| `App.tsx` | usePosStore.getState().transactions[0] | useTransactionStore |

### Test files that mock posStore (must update mock targets):
- `components/__tests__/screens.test.tsx` — vi.mock posStore
- `components/__tests__/TodayDashboard.test.tsx` — vi.mock posStore
- `components/report/__tests__/AuditTrailTable.test.tsx` — vi.mock posStore
- `components/report/__tests__/SettlementHistoryTable.test.tsx` — vi.mock posStore
- `__tests__/helpers/storeSetup.ts` — direct getState/resetData
- `__tests__/orderPayment.integration.test.tsx` — usePosStore.getState()
- `__tests__/reportScreen.integration.test.tsx` — usePosStore.getState()
- `hooks/__tests__/usePosFlow.test.ts` — likely mocks posStore
- `hooks/__tests__/useUndoCountdown.test.ts` — likely mocks posStore
- `hooks/__tests__/useCrashDraftRecovery.test.ts` — likely mocks posStore
- `store/__tests__/posStore.test.ts` — direct store test
- `store/__tests__/transactionActions.test.ts` — direct store test
- `store/__tests__/sessionActions.test.ts` — direct store test
- `store/__tests__/menuActions.test.ts` — direct store test
- `store/__tests__/ledgerStore.test.ts` — direct store test

---

## Task 1: Define Per-Store Action Interfaces in posTypes.ts

**Files:**
- Modify: `frontend/src/store/posTypes.ts`
- Test: `frontend/src/store/__tests__/posStore.test.ts` (type-check only — no runtime change)

- [ ] **Step 1: Add action interfaces for each domain**

Add these interfaces to `posTypes.ts` (after the existing slice interfaces, before `PosState`):

```typescript
/** Student domain actions */
export interface StudentActions {
  addStudent: (db: Firestore, input: { studentId: string; displayName: string; openingBalance: number; operatorId: string }) => Promise<void>;
  disableStudent: (db: Firestore, input: { studentId: string; operatorId: string }) => Promise<void>;
}

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
}

/** Session domain actions (session + settlement + audit + firebase) */
export interface SessionActions {
  setBusinessDateStatus: (date: string, status: BusinessDateStatus) => void;
  openCashSession: (input: OpenCashSessionInput) => void;
  updateOpeningCash: (businessDate: string, amount: number) => void;
  closeBusinessDate: (input: CloseBusinessDateInput) => void;
  reopenBusinessDate: (input: ReopenBusinessDateInput) => void;
  getBusinessDateStatus: (businessDate: string) => BusinessDateStatus;
}

/** Firebase sync actions (shared across stores) */
export interface FirebaseStoreActions {
  resetData: () => void;
}
```

Update `PosState` to use the new interfaces:

```typescript
export interface PosState
  extends StudentStateSlice,
    TransactionStateSlice,
    MenuStateSlice,
    AuditStateSlice,
    SettlementStateSlice,
    StudentActions,
    TransactionActions,
    MenuActions,
    SessionActions,
    FirebaseStoreActions {}
```

- [ ] **Step 2: Run type check to verify no breakage**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (refactor is additive — PosState now explicitly extends action interfaces instead of inlining)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/store/posTypes.ts
git commit -m "refactor(store): extract per-domain action interfaces from PosState (#264)"
```

---

## Task 2: Create Domain Stores with Independent Persistence

**Files:**
- Create: `frontend/src/store/studentStore.ts`
- Create: `frontend/src/store/transactionStore.ts`
- Create: `frontend/src/store/menuStore.ts`
- Create: `frontend/src/store/sessionStore.ts`
- Modify: `frontend/src/store/posPersistence.ts` — extract per-store configs
- Test: Run `t2` (type check) after creation

- [ ] **Step 1: Create studentStore.ts**

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StudentStateSlice, StudentActions } from './posTypes';
import { INITIAL_STUDENTS } from '../mocks/initialData';
import { createIndexedDBStorage } from '../storage/indexedDBStorage';
// Import the actual action creators — they need (set, get) from this store
// For now, inline minimal actions; full migration in Task 3

export type StudentStore = StudentStateSlice & StudentActions & { resetStudents: () => void };

export const useStudentStore = create<StudentStore>()(
  persist(
    (set, _get) => ({
      students: INITIAL_STUDENTS,
      addStudent: async (_db, _input) => {
        // Will be migrated from firebaseActions in Task 3
        throw new Error('Not yet migrated — use usePosStore.addStudent');
      },
      disableStudent: async (_db, _input) => {
        throw new Error('Not yet migrated — use usePosStore.disableStudent');
      },
      resetStudents: () => set({ students: INITIAL_STUDENTS }),
    }),
    {
      name: 'student-storage',
      storage: createIndexedDBStorage(),
      version: 1,
    },
  ),
);
```

- [ ] **Step 2: Create transactionStore.ts**

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TransactionStateSlice, TransactionActions } from './posTypes';
import { INITIAL_TODAY_TX } from '../mocks/initialData';
import { createTransactionActions } from './posActions/transactionActions';
import { createIndexedDBStorage } from '../storage/indexedDBStorage';

export type TransactionStore = TransactionStateSlice & TransactionActions & { resetTransactions: () => void };

export const useTransactionStore = create<TransactionStore>()(
  persist(
    (set, get) => ({
      transactions: INITIAL_TODAY_TX,
      ...createTransactionActions(set, get),
      resetTransactions: () => set({ transactions: INITIAL_TODAY_TX }),
    }),
    {
      name: 'transaction-storage',
      storage: createIndexedDBStorage(),
      version: 1,
    },
  ),
);
```

⚠️ **Note:** `createTransactionActions` currently expects `(set, get)` typed for the full `PosState`. The action creators need to be made generic or re-typed. Check `transactionActions.ts` — if it only accesses `transactions` slice, it can work with `TransactionStore` directly. If it accesses other slices (e.g., `students` for `deleteOrderWithRefundCheck`), those cross-domain actions need special handling (see Task 3).

- [ ] **Step 3: Create menuStore.ts**

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MenuStateSlice, MenuActions } from './posTypes';
import { INITIAL_TODAY_MENU, VENDORS } from '../mocks/initialData';
import { createMenuActions } from './posActions/menuActions';
import { createIndexedDBStorage } from '../storage/indexedDBStorage';

export type MenuStoreState = MenuStateSlice & MenuActions & { resetMenu: () => void };

export const useMenuStore = create<MenuStoreState>()(
  persist(
    (set) => ({
      vendors: VENDORS,
      todayMenu: INITIAL_TODAY_MENU,
      ...createMenuActions(set),
      resetMenu: () => set({ vendors: VENDORS, todayMenu: INITIAL_TODAY_MENU }),
    }),
    {
      name: 'menu-storage',
      storage: createIndexedDBStorage(),
      version: 1,
    },
  ),
);
```

- [ ] **Step 4: Create sessionStore.ts**

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuditStateSlice, SettlementStateSlice, SessionActions } from './posTypes';
import { createSessionActions } from './posActions/sessionActions';
import { createIndexedDBStorage } from '../storage/indexedDBStorage';

export type SessionStore = AuditStateSlice & SettlementStateSlice & SessionActions & { resetSession: () => void };

const defaultSessionState = {
  auditEvents: [] as SessionStore['auditEvents'],
  dailySettlements: [] as SessionStore['dailySettlements'],
  businessDateStatuses: {} as SessionStore['businessDateStatuses'],
  cashSessions: {} as SessionStore['cashSessions'],
};

export const useSessionStore = create<SessionStore>()(
  persist(
    (set, get) => ({
      ...defaultSessionState,
      ...createSessionActions(set, get),
      resetSession: () => set(defaultSessionState),
    }),
    {
      name: 'session-storage',
      storage: createIndexedDBStorage(),
      version: 1,
    },
  ),
);
```

- [ ] **Step 5: Run type check**

Run: `cd frontend && npx tsc --noEmit`
Expected: May have type errors if action creators reference full PosState — note them for Task 3.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/store/studentStore.ts frontend/src/store/transactionStore.ts frontend/src/store/menuStore.ts frontend/src/store/sessionStore.ts
git commit -m "feat(store): create domain-specific stores (student, transaction, menu, session) (#264)"
```

---

## Task 3: Adapt Action Creators for Domain Store Types

**Files:**
- Modify: `frontend/src/store/posActions/transactionActions.ts`
- Modify: `frontend/src/store/posActions/sessionActions.ts`
- Modify: `frontend/src/store/posActions/menuActions.ts`
- Modify: `frontend/src/store/posActions/editActions.ts`
- Modify: `frontend/src/store/posActions/orderActions.ts`
- Modify: `frontend/src/store/posActions/paymentActions.ts`
- Modify: `frontend/src/store/posActions/expenseActions.ts`
- Modify: `frontend/src/store/posActions/firebaseActions.ts`

⚠️ **Key challenge:** Some action creators read across domains (e.g., `deleteOrderWithRefundCheck` needs both `transactions` and `students`). Strategy:

1. **Pure single-domain actions:** Re-type `set`/`get` generics to the domain store type
2. **Cross-domain actions:** Accept external state as parameters, or use `useTransactionStore.getState()` + `useStudentStore.getState()` inside the action (Zustand allows cross-store reads via `getState()`)

- [ ] **Step 1: Audit each action file for cross-domain access**

Read each file and list what state it reads:
- `transactionActions.ts` — only `transactions` → pure single-domain ✅
- `editActions.ts` — reads `transactions`, writes `transactions` + `auditEvents` → cross-domain (transactions + session)
- `orderActions.ts` — reads `transactions`, `students` → cross-domain
- `paymentActions.ts` — reads `transactions` → pure single-domain ✅
- `expenseActions.ts` — reads `transactions` → pure single-domain ✅
- `sessionActions.ts` — reads/writes settlement/cashSession/audit/businessDateStatus → pure session domain ✅
- `menuActions.ts` — only menu state → pure single-domain ✅
- `firebaseActions.ts` — `resetData` → cross-domain (resets everything)

- [ ] **Step 2: Make pure-domain action creators generic**

For each pure-domain action creator, change the type parameter from `PosState` to the domain store type. Example for `transactionActions.ts`:

```typescript
// Before:
export function createTransactionActions(
  set: (fn: (s: PosState) => Partial<PosState>) => void,
  get: () => PosState
)
// After:
export function createTransactionActions<S extends TransactionStateSlice & TransactionActions>(
  set: (fn: (s: S) => Partial<S>) => void,
  get: () => S
)
```

- [ ] **Step 3: Handle cross-domain actions**

For `editActions.ts` (writes `auditEvents`):
```typescript
// Import cross-store access
import { useSessionStore } from '../sessionStore';

// In editTransaction: instead of set({ auditEvents: [...] })
// Use: useSessionStore.getState().auditEvents and useSessionStore.setState(...)
```

For `orderActions.ts` (reads `students`):
```typescript
import { useStudentStore } from '../studentStore';
// Replace get().students with useStudentStore.getState().students
```

For `firebaseActions.ts` (`resetData`):
```typescript
// resetData becomes a coordinator that calls each store's reset
import { useStudentStore } from '../studentStore';
import { useTransactionStore } from '../transactionStore';
import { useMenuStore } from '../menuStore';
import { useSessionStore } from '../sessionStore';

export function createFirebaseActions() {
  return {
    resetData: () => {
      useStudentStore.getState().resetStudents();
      useTransactionStore.getState().resetTransactions();
      useMenuStore.getState().resetMenu();
      useSessionStore.getState().resetSession();
    },
  };
}
```

- [ ] **Step 4: Run type check + unit tests**

Run: `cd frontend && npx tsc --noEmit && npx vitest run src/store/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/posActions/
git commit -m "refactor(store): adapt action creators for domain store types (#264)"
```

---

## Task 4: Convert posStore.ts to Compatibility Shim

**Files:**
- Modify: `frontend/src/store/posStore.ts`
- Modify: `frontend/src/store/posPersistence.ts` — simplify (domain stores handle own persistence)
- Test: `frontend/src/store/__tests__/posStore.test.ts`

- [ ] **Step 1: Rewrite posStore.ts as compatibility layer**

```typescript
import { useStudentStore } from './studentStore';
import { useTransactionStore } from './transactionStore';
import { useMenuStore } from './menuStore';
import { useSessionStore } from './sessionStore';
import type { PosState } from './posTypes';

// Re-export types for backward compatibility
export { type PosState, type BusinessDateStatus } from './posTypes';
export { CASHIER_SENTINEL, mergeLedgerTransactions } from '../domain/ledger';

// Re-export domain stores for direct access (preferred)
export { useStudentStore } from './studentStore';
export { useTransactionStore } from './transactionStore';
export { useMenuStore } from './menuStore';
export { useSessionStore } from './sessionStore';

/**
 * @deprecated Use domain-specific stores directly:
 * - useStudentStore for students
 * - useTransactionStore for transactions
 * - useMenuStore for menu/vendors
 * - useSessionStore for sessions/settlements/audit
 *
 * This shim exists for incremental migration only.
 */
export const usePosStore = Object.assign(
  function usePosStore<T>(selector: (state: PosState) => T): T {
    // Combine all domain stores into a unified view for legacy selectors
    const studentState = useStudentStore((s) => s);
    const transactionState = useTransactionStore((s) => s);
    const menuState = useMenuStore((s) => s);
    const sessionState = useSessionStore((s) => s);

    const combined = {
      ...studentState,
      ...transactionState,
      ...menuState,
      ...sessionState,
    } as PosState;

    return selector(combined);
  },
  {
    getState: (): PosState => ({
      ...useStudentStore.getState(),
      ...useTransactionStore.getState(),
      ...useMenuStore.getState(),
      ...useSessionStore.getState(),
    } as PosState),
    persist: {
      rehydrate: async () => {
        await useStudentStore.persist.rehydrate();
        await useTransactionStore.persist.rehydrate();
        await useMenuStore.persist.rehydrate();
        await useSessionStore.persist.rehydrate();
      },
    },
  },
);
```

⚠️ **Important:** The shim's `usePosStore` function calls 4 hooks — this means components using it will re-render when ANY domain changes. This is intentional for backward compat; migrating consumers to domain-specific stores (Task 5+) fixes this.

- [ ] **Step 2: Update storeSetup helper**

```typescript
// frontend/src/__tests__/helpers/storeSetup.ts
import { useStudentStore } from '../../store/studentStore';
import { useTransactionStore } from '../../store/transactionStore';
import { useMenuStore } from '../../store/menuStore';
import { useSessionStore } from '../../store/sessionStore';

export function resetAllStores() {
  useStudentStore.getState().resetStudents();
  useTransactionStore.getState().resetTransactions();
  useMenuStore.getState().resetMenu();
  useSessionStore.getState().resetSession();
  // Rehydrate all
  useStudentStore.persist.rehydrate();
  useTransactionStore.persist.rehydrate();
  useMenuStore.persist.rehydrate();
  useSessionStore.persist.rehydrate();
}
```

- [ ] **Step 3: Run full test suite**

Run: `cd .. && ./workflow.sh t4`
Expected: All existing tests PASS (compat shim preserves API surface)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/store/posStore.ts frontend/src/store/posPersistence.ts frontend/src/__tests__/helpers/storeSetup.ts
git commit -m "refactor(store): convert posStore to compatibility shim over domain stores (#264)"
```

---

## Task 5: Migrate Consumers to Domain-Specific Stores

**Files:** All 30 consumer files (see consumer migration map above)
**Strategy:** Migrate in batches by domain, running tests after each batch.

### Batch 5a: Transaction consumers

- [ ] **Step 1: Migrate derived hooks**

Update `store/derived/useLedger.ts` and `store/derived/useLedgerReport.ts`:
- Replace `import { usePosStore } from '../posStore'` with `import { useTransactionStore } from '../transactionStore'`
- Replace `usePosStore((s) => s.transactions)` with `useTransactionStore((s) => s.transactions)`

Update `hooks/useUndoCountdown.ts`:
- Replace `import { usePosStore } from '../store/posStore'` with `import { useTransactionStore } from '../store/transactionStore'`
- Replace `usePosStore((s) => s.deleteTransaction)` with `useTransactionStore((s) => s.deleteTransaction)`

- [ ] **Step 2: Run affected tests**

Run: `cd frontend && npx vitest run src/hooks/__tests__/useUndoCountdown.test.ts src/store/__tests__/ledgerStore.test.ts`

- [ ] **Step 3: Commit**

```bash
git commit -am "refactor(store): migrate transaction consumers to useTransactionStore (#264)"
```

### Batch 5b: Session/Settlement consumers

- [ ] **Step 4: Migrate session consumers**

Update `store/derived/useCashClose.ts`:
- Replace with `import { useSessionStore } from '../sessionStore'`

Update `components/TodayDashboard.tsx`:
- Replace `usePosStore` selector with `useSessionStore`

Update `components/report/AuditTrailTable.tsx`:
- Replace with `useSessionStore`

Update `components/report/SettlementHistoryTable.tsx`:
- Replace with `useSessionStore`

- [ ] **Step 5: Update test mocks for session consumers**

Update `components/__tests__/TodayDashboard.test.tsx`:
- Change `vi.mock('../../store/posStore', ...)` to `vi.mock('../../store/sessionStore', ...)`

Update `components/report/__tests__/AuditTrailTable.test.tsx`:
- Change mock target to `sessionStore`

Update `components/report/__tests__/SettlementHistoryTable.test.tsx`:
- Change mock target to `sessionStore`

- [ ] **Step 6: Run affected tests**

Run: `cd frontend && npx vitest run src/components/__tests__/TodayDashboard.test.tsx src/components/report/__tests__/`

- [ ] **Step 7: Commit**

```bash
git commit -am "refactor(store): migrate session consumers to useSessionStore (#264)"
```

### Batch 5c: Multi-domain consumers (useAppState, App.tsx, ReportScreen)

- [ ] **Step 8: Migrate useAppState.ts**

This is the largest consumer — pulls from all 4 domains. Rewrite to use domain stores directly:

```typescript
import { useStudentStore } from '../store/studentStore';
import { useTransactionStore } from '../store/transactionStore';
import { useMenuStore } from '../store/menuStore';
import { useSessionStore } from '../store/sessionStore';
// ... keep existing logic, just source from different stores
```

- [ ] **Step 9: Migrate usePosFlow.ts**

Pulls from students + menu + transactions:
```typescript
import { useStudentStore } from '../store/studentStore';
import { useTransactionStore } from '../store/transactionStore';
import { useMenuStore } from '../store/menuStore';
```

- [ ] **Step 10: Migrate useCancelDialog.ts**

Uses `deleteOrderWithRefundCheck` from transactions:
```typescript
import { useTransactionStore } from '../store/transactionStore';
```

- [ ] **Step 11: Migrate useCrashDraftRecovery.ts**

Uses `students` from student store:
```typescript
import { useStudentStore } from '../store/studentStore';
```

- [ ] **Step 12: Migrate App.tsx**

Replace `usePosStore.getState().transactions[0]` with `useTransactionStore.getState().transactions[0]`.

- [ ] **Step 13: Migrate ReportScreen.tsx**

Uses session actions + transaction actions:
```typescript
import { useTransactionStore } from '../../store/transactionStore';
import { useSessionStore } from '../../store/sessionStore';
```

- [ ] **Step 14: Update screens.test.tsx mock**

The `screens.test.tsx` mock needs to mock multiple stores instead of one. Update mock to target the correct domain stores.

- [ ] **Step 15: Run full test suite**

Run: `cd .. && ./workflow.sh t4`
Expected: ALL PASS

- [ ] **Step 16: Commit**

```bash
git commit -am "refactor(store): migrate multi-domain consumers to domain stores (#264)"
```

---

## Task 6: Migrate Data Persistence (IndexedDB Key Split)

**Files:**
- Modify: `frontend/src/store/posPersistence.ts`
- Modify: `frontend/src/storage/migration.ts` — add migration from old `pos-storage` key
- Test: `frontend/src/storage/__tests__/migration.test.ts`

- [ ] **Step 1: Write migration test**

```typescript
// Test that existing pos-storage data is split into domain-specific keys on first load
it('migrates pos-storage data to domain-specific keys', async () => {
  // Seed old unified storage with test data
  // Load new stores
  // Verify data appears in correct domain stores
});
```

- [ ] **Step 2: Implement data migration**

In `posPersistence.ts`, add a one-time migration that:
1. On first load, checks if legacy `pos-storage` key exists in IndexedDB
2. If yes, reads it and distributes data to `student-storage`, `transaction-storage`, `menu-storage`, `session-storage`
3. Marks migration complete (e.g., sets `pos-storage-migrated: true` in localStorage)

- [ ] **Step 3: Run migration test**

Run: `cd frontend && npx vitest run src/storage/__tests__/migration.test.ts`

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(store): add persistence migration from unified to domain-specific storage (#264)"
```

---

## Task 7: Integration Tests + Cleanup

**Files:**
- Modify: `frontend/src/__tests__/orderPayment.integration.test.tsx`
- Modify: `frontend/src/__tests__/reportScreen.integration.test.tsx`
- Modify: `frontend/src/__tests__/helpers/storeSetup.ts`

- [ ] **Step 1: Update integration tests**

Replace `usePosStore.getState()` with domain-specific store access in integration tests:
- `orderPayment.integration.test.tsx` → `useTransactionStore.getState()`, `useStudentStore.getState()`
- `reportScreen.integration.test.tsx` → `useSessionStore.getState()`, `useTransactionStore.getState()`

- [ ] **Step 2: Run full test suite + build**

Run: `cd .. && ./workflow.sh t1 && ./workflow.sh t2 && ./workflow.sh t3 && ./workflow.sh t4`
Expected: ALL PASS (build + typecheck + lint + unit tests)

- [ ] **Step 3: Verify posStore deprecation warnings**

Grep for remaining `usePosStore` imports (should only be in posStore.ts compat layer + any intentionally kept):

```bash
grep -rn "from.*posStore\|import.*posStore" frontend/src/ --include="*.ts" --include="*.tsx" | grep -v "posStore.ts" | grep -v "__tests__" | grep -v "node_modules"
```

Expected: Zero results (all production code migrated to domain stores)

- [ ] **Step 4: Final commit**

```bash
git commit -am "test(store): update integration tests for domain stores, verify full migration (#264)"
```

---

## Task 8: Create Draft PR

- [ ] **Step 1: Push branch and create PR**

```bash
git push origin feat/264-posstore-domain-split
gh pr create --base dev --title "Refactor: Split posStore into domain-specific stores (#264)" \
  --body "Closes #264

## Summary
Split monolithic \`usePosStore\` (degree=23) into 4 domain-specific Zustand stores:
- \`useStudentStore\` — student accounts
- \`useTransactionStore\` — ledger transactions
- \`useMenuStore\` — menu and vendors
- \`useSessionStore\` — sessions, settlements, audit events

## Approach
- Backward-compatible: \`usePosStore\` retained as thin compatibility shim
- Independent persistence: each store has its own IndexedDB key
- Data migration: legacy \`pos-storage\` data auto-split on first load
- All 30+ consumers migrated to domain-specific stores

## Testing
- All existing unit + integration tests pass
- t1 (build) + t2 (typecheck) + t3 (lint) + t4 (unit tests) green"
```

---

## Verification Steps

| # | Check | Command | Expected |
|---|-------|---------|----------|
| 1 | TypeScript compiles | `./workflow.sh t2` | PASS |
| 2 | Lint clean | `./workflow.sh t3` | PASS |
| 3 | Unit tests pass | `./workflow.sh t4` | PASS |
| 4 | Build succeeds | `./workflow.sh t1` | PASS |
| 5 | No production `usePosStore` imports remain | `grep -rn "from.*posStore" frontend/src/ --include="*.ts" --include="*.tsx" \| grep -v __tests__ \| grep -v posStore.ts \| grep -v node_modules` | Zero matches |
| 6 | Domain stores have independent persistence keys | Check IndexedDB in browser devtools | 4 separate keys |
