# [Issue #267] Decouple Subsystems from LedgerTransaction Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple various subsystems from the monolithic `LedgerTransaction` type by introducing domain-specific interfaces and mappings.

**Architecture:** Define `OrderEntry`, `PaymentEntry`, and `ExpenseEntry` interfaces. Use a base interface for common fields and specific extensions for domain logic.

**Tech Stack:** TypeScript.

---

### Task 1: Define Domain-Specific Transaction Types

**Files:**
- Modify: `frontend/src/domain/ledger.ts`
- Create: `frontend/src/domain/transactionTypes.ts`

- [ ] **Step 1: Create base transaction interface and domain extensions**
```typescript
export interface BaseTransaction {
  transactionId: string;
  businessDate: string;
  // ...
}

export interface OrderTransaction extends BaseTransaction {
  mealPrice: number;
  // ...
}
```

- [ ] **Step 2: Commit**
```bash
git add frontend/src/domain/transactionTypes.ts
git commit -m "chore: define domain-specific transaction types"
```

### Task 2: Implement Mappers and Type Guards

**Files:**
- Modify: `frontend/src/domain/ledger.ts`

- [ ] **Step 1: Implement functions to convert LedgerTransaction to domain types**
```typescript
export function toOrderTransaction(tx: LedgerTransaction): OrderTransaction { ... }
```

- [ ] **Step 2: Add type guards for safe discrimination**

- [ ] **Step 3: Commit**
```bash
git add frontend/src/domain/ledger.ts
git commit -m "feat: add transaction mappers and type guards"
```

### Task 3: Refactor UI and Audit to use Domain Types

**Files:**
- Modify: `frontend/src/components/screens/ReportScreen.tsx`
- Modify: `frontend/src/domain/ledgerAudit.ts`

- [ ] **Step 1: Update ReportScreen to use OrderTransaction where appropriate**
- [ ] **Step 2: Update Audit logic to rely on the base interface**

- [ ] **Step 3: Commit**
```bash
git add .
git commit -m "refactor: use domain-specific transaction types in UI and Audit"
```
