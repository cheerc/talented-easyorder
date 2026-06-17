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
    // TODO: Fix #375 — paidAmount should be assigned to paidAmountVal here so that
    // paidAmount is correctly passed to buildPosTransactionDraft and createLedgerTransaction.
    // Currently paidAmount is left as the default 0, which ignores the payment when ordering.
    // paidAmount = paidAmountVal;
  ```
  With:
  ```typescript
    paidAmount = paidAmountVal;
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
- Modify: `frontend/src/store/__tests__/transactionActions.test.ts`

- [ ] **Step 1: Write the unit test**
  Add a new test inside the `describe('transactionActions — commitPosTransactionDraft', ...)` block in [transactionActions.test.ts](file:///Users/cheerc/talented-easyorder/frontend/src/store/__tests__/transactionActions.test.ts).

  Test code:
  ```typescript
    it('T1b: creates order with simultaneous payment and updates student balance correctly', () => {
      const store = usePosStore.getState();
      const student = store.students.find(s => s.studentId === '001')!;
      const initialBalance = student.currentBalance;

      const draft = buildPosTransactionDraft({
        intent: {
          businessDate: store.todayMenu.businessDate,
          studentId: '001',
          type: 'order',
          mealPrice: 90,
          paidAmount: 90,
          note: '日式唐揚雞便當',
          sourceDevice: 'pc',
        },
        student,
        menu: store.todayMenu,
      });

      store.commitPosTransactionDraft(draft);

      const next = usePosStore.getState();
      const tx = next.transactions[0];
      const updatedStudent = next.students.find(s => s.studentId === '001')!;

      expect(tx.type).toBe('order');
      expect(tx.studentId).toBe('001');
      expect(tx.mealPrice).toBe(90);
      expect(tx.paidAmount).toBe(90);
      expect(tx.amount).toBe(0);
      expect(updatedStudent.currentBalance).toBe(initialBalance);
    });
  ```

- [ ] **Step 2: Run tests to verify correctness**
  Run unit tests:
  ```bash
  ./workflow.sh t4
  ```
  Verify all unit tests pass.

- [ ] **Step 3: Commit changes**
  ```bash
  git add frontend/src/store/__tests__/transactionActions.test.ts
  git commit -m "test: add unit test for order with simultaneous payment"
  ```
