# [Issue #264] Refactor Monolithic posStore into Domain-Specific Slices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the monolithic `posStore` into domain-specific slices (Student, Transaction, Menu, Audit, Settlement) to improve maintainability and performance.

**Architecture:** Use Zustand's slice pattern. Each slice will have its own state and actions, then merged into a single store.

**Tech Stack:** React, TypeScript, Zustand.

---

### Task 1: Define Slice Interfaces

**Files:**
- Modify: `frontend/src/store/posTypes.ts`

- [ ] **Step 1: Update PosState to use combined slice interfaces**
Change `PosState` to clearly extend individual slice interfaces and move actions into their respective slices.

```typescript
export interface StudentSlice {
  students: StudentAccount[];
  addStudent: (...) => Promise<void>;
  disableStudent: (...) => Promise<void>;
}
// Repeat for other slices...
```

- [ ] **Step 2: Commit**
```bash
git add frontend/src/store/posTypes.ts
git commit -m "chore: define domain slice interfaces for posStore"
```

### Task 2: Create Slice Implementations

**Files:**
- Create: `frontend/src/store/slices/studentSlice.ts`
- Create: `frontend/src/store/slices/transactionSlice.ts`
- Create: `frontend/src/store/slices/menuSlice.ts`
- Create: `frontend/src/store/slices/settlementSlice.ts`
- Create: `frontend/src/store/slices/auditSlice.ts`

- [ ] **Step 1: Implement Student Slice**
Extract logic from `posActions/transactionActions.ts` (student related parts) into `studentSlice.ts`.

- [ ] **Step 2: Implement Transaction Slice**
Extract transaction processing logic.

- [ ] **Step 3: Commit**
```bash
git add frontend/src/store/slices/*.ts
git commit -m "feat: implement domain-specific store slices"
```

### Task 3: Assemble Monolithic Store from Slices

**Files:**
- Modify: `frontend/src/store/posStore.ts`

- [ ] **Step 1: Refactor usePosStore to combine slices**
```typescript
export const usePosStore = create<PosState>()(
  persist(
    (...a) => ({
      ...createStudentSlice(...a),
      ...createTransactionSlice(...a),
      // ...
    }),
    posPersistenceConfig,
  )
);
```

- [ ] **Step 2: Run existing tests to ensure no regressions**
Run: `npm test frontend/src/store/__tests__`

- [ ] **Step 3: Commit**
```bash
git add frontend/src/store/posStore.ts
git commit -m "refactor: assemble posStore from slices"
```
