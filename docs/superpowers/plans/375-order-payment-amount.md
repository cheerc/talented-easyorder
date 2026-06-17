# Fix #375: Order Payment Amount Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correctly account for the paidAmount when ordering a box meal in order mode, ensuring the payment is not ignored and the student's balance calculations are correct.

**Architecture:** Assign the parsed payment amount (`paidAmountVal`) to the `paidAmount` property in `deriveTransactionAttributes` when the POS mode is `order`. Additionally, update the crash draft saving logic to calculate the transaction amount correctly when mode is `order`.

**Tech Stack:** React, TypeScript, Zustand

---

### Task 1: Fix Transaction Attributes Derivation

**Files:**
- Modify: `frontend/src/domain/posTransaction.ts` (Around L103-111)

- [ ] **Step 1: Write the implementation**
  In [posTransaction.ts](file:///Users/cheerc/talented-easyorder/frontend/src/domain/posTransaction.ts), assign `paidAmountVal` to `paidAmount` inside the `mode === 'order'` block.

  Replace:
  ```typescript
    if (mode === 'order') {
      mealPrice = priceOverride ?? todayMenuPrice;
      note = priceOverride !== null
        ? `單筆改價：${priceOverrideLabel.trim() || todayMenuItemName}`
        : todayMenuItemName + (paidAmountVal > 0 ? ' (已付)' : '');
    }
  ```
  With:
  ```typescript
    if (mode === 'order') {
      mealPrice = priceOverride ?? todayMenuPrice;
      paidAmount = paidAmountVal;
      note = priceOverride !== null
        ? `單筆改價：${priceOverrideLabel.trim() || todayMenuItemName}`
        : todayMenuItemName + (paidAmountVal > 0 ? ' (已付)' : '');
    }
  ```

- [ ] **Step 2: Commit changes**
  ```bash
  git add frontend/src/domain/posTransaction.ts
  git commit -m "fix: assign paidAmountVal to paidAmount in order mode"
  ```

---

### Task 2: Fix Crash Draft Balance Calculation

**Files:**
- Modify: `frontend/src/hooks/useTransactionCommit.ts` (Around L89)

- [ ] **Step 1: Write the implementation**
  In [useTransactionCommit.ts](file:///Users/cheerc/talented-easyorder/frontend/src/hooks/useTransactionCommit.ts), adjust the crash draft `amount` calculation for `mode === 'order'` to include the `paidAmount`.

  Replace:
  ```typescript
        const amount = mode === 'order' ? -crashAttrs.mealPrice : (mode === 'payment' ? crashAttrs.paidAmount : 0);
  ```
  With:
  ```typescript
        const amount = mode === 'order'
          ? crashAttrs.paidAmount - crashAttrs.mealPrice
          : (mode === 'payment' ? crashAttrs.paidAmount : 0);
  ```

- [ ] **Step 2: Commit changes**
  ```bash
  git add frontend/src/hooks/useTransactionCommit.ts
  git commit -m "fix: include paidAmount in order mode crash draft amount calculation"
  ```

---

### Task 3: Add Unit Tests

**Files:**
- Modify: `frontend/src/domain/__tests__/posTransaction.test.ts`

- [ ] **Step 1: Import deriveTransactionAttributes in the test file**
  Add `deriveTransactionAttributes` to imports in [posTransaction.test.ts](file:///Users/cheerc/talented-easyorder/frontend/src/domain/__tests__/posTransaction.test.ts).

  Replace:
  ```typescript
  import {
    parsePaidAmount,
    buildPosTransactionDraft,
  } from '../posTransaction';
  ```
  With:
  ```typescript
  import {
    parsePaidAmount,
    buildPosTransactionDraft,
    deriveTransactionAttributes,
  } from '../posTransaction';
  ```

- [ ] **Step 2: Write the unit test**
  Add a new describe block for `deriveTransactionAttributes` in [posTransaction.test.ts](file:///Users/cheerc/talented-easyorder/frontend/src/domain/__tests__/posTransaction.test.ts).

  Test code:
  ```typescript
  describe('deriveTransactionAttributes', () => {
    it('derives paidAmount correctly when mode is order and paidAmountText is provided', () => {
      const result = deriveTransactionAttributes({
        mode: 'order',
        todayMenuPrice: 90,
        todayMenuItemName: '日式唐揚雞便當',
        priceOverride: null,
        priceOverrideLabel: '',
        paidAmountText: '90',
      });
      expect(result.paidAmount).toBe(90);
      expect(result.mealPrice).toBe(90);
      expect(result.note).toBe('日式唐揚雞便當 (已付)');
    });
  });
  ```

- [ ] **Step 3: Run tests to verify correctness**
  Run unit tests:
  ```bash
  ./workflow.sh t4
  ```
  Verify all unit tests pass.

- [ ] **Step 4: Commit changes**
  ```bash
  git add frontend/src/domain/__tests__/posTransaction.test.ts
  git commit -m "test: add unit test for deriveTransactionAttributes in order mode"
  ```
