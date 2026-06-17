# Fix #376: Refund Options on Order Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to choose whether to refund paid amount in cash or keep it in the student's balance when cancelling a meal order that has a payment.

**Architecture:** 
1. Create `CancelOrderDialog.tsx` to display cancellation options when an order includes payment.
2. Update `deleteOrderWithRefundCheck` in `editActions.ts` to accept `keepPaymentAsDeposit` argument. When `keepPaymentAsDeposit` is true, convert the transaction into a payment transaction instead of deleting it.
3. Update `useCancelDialog.ts` and `App.tsx` / `MainLayout.tsx` to handle the new dialog and pass selection to the delete call.

**Tech Stack:** React, TypeScript, Zustand

---

### Task 1: Extend Store Delete Order Action

**Files:**
- Modify: `frontend/src/store/posActions/editActions.ts` (Around L88)

- [ ] **Step 1: Update action signature and logic**
  In [editActions.ts](file:///Users/cheerc/talented-easyorder/frontend/src/store/posActions/editActions.ts), modify `deleteOrderWithRefundCheck` to accept `keepPaymentAsDeposit?: boolean`.
  If `keepPaymentAsDeposit` is true and `tx.paidAmount > 0`, instead of removing the transaction, convert it in-place to a payment transaction (updating its type to `payment`, setting `mealPrice` to 0, updating `amount` to `paidAmount`, and updating note/revision).

  Replace `deleteOrderWithRefundCheck` implementation:
  ```typescript
    deleteOrderWithRefundCheck: (id: string, operatorId?: string) => {
      const state = get();
      const tx = state.transactions.find(t => t.transactionId === id);
      if (!tx || tx.type !== 'order') {
        return { deleted: false, refundAmount: 0, studentName: '', wasClosedDate: false };
      }

      const dateStatus = state.businessDateStatuses[tx.businessDate] || 'open';
      const wasClosedDate = dateStatus !== 'open';
      const refundAmount = tx.paidAmount;

      const now = new Date().toISOString();
      const auditEvent = createLedgerAuditEvent({
        auditEventId: `evt-${crypto.randomUUID()}`,
        eventType: 'transaction_deleted',
        entityType: 'transaction',
        entityId: id,
        businessDate: tx.businessDate,
        before: { ...tx },
        after: null,
        reason: 'delete',
        operatorId: operatorId ?? SYSTEM_OPERATOR_ID,
        createdAt: now,
      });

      const remainingTx = state.transactions.filter(t => t.transactionId !== id);

      const { students: newStudents, transactions: newStudentTx } = recalculateStudentBalances(
        state.students,
        remainingTx
      );

      const cashierTx = remainingTx.filter(t => t.studentId === CASHIER_SENTINEL);

      const newTransactions = [...newStudentTx, ...cashierTx].sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt)
      );

      set({
        transactions: newTransactions,
        students: newStudents,
        auditEvents: [...state.auditEvents, auditEvent],
      });

      return {
        deleted: true,
        refundAmount,
        studentName: tx.studentNameSnapshot,
        wasClosedDate,
      };
    },
  ```

  With (maintaining the 4 spaces for signature, 6 spaces for body indentation):
  ```typescript
    deleteOrderWithRefundCheck: (id: string, operatorId?: string, keepPaymentAsDeposit?: boolean) => {
      const state = get();
      const tx = state.transactions.find(t => t.transactionId === id);
      if (!tx || tx.type !== 'order') {
        return { deleted: false, refundAmount: 0, studentName: '', wasClosedDate: false };
      }

      const dateStatus = state.businessDateStatuses[tx.businessDate] || 'open';
      const wasClosedDate = dateStatus !== 'open';
      
      const now = new Date().toISOString();
      let remainingTx = state.transactions;
      let refundAmount = tx.paidAmount;
      let auditEvent;

      if (keepPaymentAsDeposit && tx.paidAmount > 0) {
        refundAmount = 0;
        auditEvent = createLedgerAuditEvent({
          auditEventId: `evt-${crypto.randomUUID()}`,
          eventType: 'transaction_edited',
          entityType: 'transaction',
          entityId: id,
          businessDate: tx.businessDate,
          before: { mealPrice: tx.mealPrice, paidAmount: tx.paidAmount, note: tx.note },
          after: { mealPrice: 0, paidAmount: tx.paidAmount, note: `取消訂餐：保留繳費 ${tx.paidAmount}` },
          reason: 'edit',
          operatorId: operatorId ?? SYSTEM_OPERATOR_ID,
          createdAt: now,
        });

        remainingTx = state.transactions.map(t => {
          if (t.transactionId === id) {
            return {
              ...t,
              type: 'payment',
              mealPrice: 0,
              amount: t.paidAmount,
              note: `取消訂餐：保留繳費 ${t.paidAmount}`,
              revision: t.revision + 1,
            };
          }
          return t;
        });
      } else {
        auditEvent = createLedgerAuditEvent({
          auditEventId: `evt-${crypto.randomUUID()}`,
          eventType: 'transaction_deleted',
          entityType: 'transaction',
          entityId: id,
          businessDate: tx.businessDate,
          before: { ...tx },
          after: null,
          reason: 'delete',
          operatorId: operatorId ?? SYSTEM_OPERATOR_ID,
          createdAt: now,
        });
        remainingTx = state.transactions.filter(t => t.transactionId !== id);
      }

      const { students: newStudents, transactions: newStudentTx } = recalculateStudentBalances(
        state.students,
        remainingTx
      );

      const cashierTx = remainingTx.filter(t => t.studentId === CASHIER_SENTINEL);

      const newTransactions = [...newStudentTx, ...cashierTx].sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt)
      );

      set({
        transactions: newTransactions,
        students: newStudents,
        auditEvents: [...state.auditEvents, auditEvent],
      });

      return {
        deleted: true,
        refundAmount,
        studentName: tx.studentNameSnapshot,
        wasClosedDate,
      };
    },
  ```

- [ ] **Step 2: Update type definition in posTypes.ts**
  In [posTypes.ts](file:///Users/cheerc/talented-easyorder/frontend/src/store/posTypes.ts) (Around L78), update `deleteOrderWithRefundCheck` signature definition.

  Replace:
  ```typescript
    deleteOrderWithRefundCheck: (id: string, operatorId?: string) => { deleted: boolean; refundAmount: number; studentName: string; wasClosedDate: boolean };
  ```
  With:
  ```typescript
    deleteOrderWithRefundCheck: (id: string, operatorId?: string, keepPaymentAsDeposit?: boolean) => { deleted: boolean; refundAmount: number; studentName: string; wasClosedDate: boolean };
  ```

- [ ] **Step 3: Run unit tests to ensure nothing is broken yet**
  ```bash
  ./workflow.sh t4
  ```

- [ ] **Step 4: Commit changes**
  ```bash
  git add frontend/src/store/posActions/editActions.ts frontend/src/store/posTypes.ts
  git commit -m "feat: support keeping payment as deposit in deleteOrderWithRefundCheck"
  ```

---

### Task 2: Create CancelOrderDialog UI Component

**Files:**
- Create: `frontend/src/components/CancelOrderDialog.tsx`

- [ ] **Step 1: Write the dialog component**
  Create [CancelOrderDialog.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/CancelOrderDialog.tsx) with the following content:

  ```typescript
  import React, { useState, useEffect } from 'react';
  import { Modal } from './ui/Modal';
  import { Button } from './ui/Button';
  import type { StudentAccount } from '../domain/student';
  import type { LedgerTransaction } from '../domain/ledger';

  interface CancelOrderDialogProps {
    open: boolean;
    picked: StudentAccount | null;
    orderTx: LedgerTransaction | null;
    onConfirm: (keepPaymentAsDeposit: boolean) => void;
    onCancel: () => void;
  }

  export const CancelOrderDialog = React.memo(function CancelOrderDialog({
    open,
    picked,
    orderTx,
    onConfirm,
    onCancel,
  }: CancelOrderDialogProps) {
    const [keepPaymentAsDeposit, setKeepPaymentAsDeposit] = useState(false);

    useEffect(() => {
      if (open) {
        setKeepPaymentAsDeposit(false);
      }
    }, [open]);

    if (!picked) return null;

    const hasPaidAmount = orderTx && orderTx.paidAmount > 0;

    const handleConfirm = () => {
      onConfirm(hasPaidAmount ? keepPaymentAsDeposit : false);
    };

    return (
      <Modal open={open} title="取消訂餐" onClose={onCancel}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {hasPaidAmount ? (
            <>
              <p style={{ margin: 0, color: 'var(--ink-1)', fontSize: '15px', fontWeight: 500 }}>
                取消訂餐 — {orderTx.note || '今日便當'}
              </p>
              <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: '14px', lineHeight: 1.5 }}>
                本次訂餐含繳費 ${orderTx.paidAmount}，請選擇處理方式：
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px 0' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="refundMethod"
                    checked={!keepPaymentAsDeposit}
                    onChange={() => setKeepPaymentAsDeposit(false)}
                  />
                  <span style={{ color: 'var(--ink-1)', fontSize: '14px' }}>
                    退還現金（餘額恢復至訂餐前）
                  </span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="refundMethod"
                    checked={keepPaymentAsDeposit}
                    onChange={() => setKeepPaymentAsDeposit(true)}
                  />
                  <span style={{ color: 'var(--ink-1)', fontSize: '14px' }}>
                    保留至帳戶餘額（取消便當但繳費保留）
                  </span>
                </label>
              </div>
            </>
          ) : (
            <p style={{ margin: '0 0 8px', color: 'var(--ink-2)', fontSize: '15px', lineHeight: 1.6 }}>
              確定要取消 {picked.displayName} 的訂餐嗎？
            </p>
          )}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' }}>
            <Button variant="ghost" onClick={onCancel}>
              返回
            </Button>
            <Button variant="danger" onClick={handleConfirm}>
              確認取消
            </Button>
          </div>
        </div>
      </Modal>
    );
  });
  ```

- [ ] **Step 2: Commit changes**
  ```bash
  git add frontend/src/components/CancelOrderDialog.tsx
  git commit -m "feat: implement CancelOrderDialog component"
  ```

---

### Task 3: Integrate Dialog and Cancel Action in Hook and Layout

**Files:**
- Modify: `frontend/src/hooks/useCancelDialog.ts`
- Modify: `frontend/src/components/MainLayout.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/__tests__/MainLayout.test.tsx`

- [ ] **Step 1: Update useCancelDialog hook**
  In [useCancelDialog.ts](file:///Users/cheerc/talented-easyorder/frontend/src/hooks/useCancelDialog.ts), allow `handleDeleteOrder` to accept `keepPaymentAsDeposit?: boolean`.

  Replace `handleDeleteOrder`:
  ```typescript
    const handleDeleteOrder = useCallback(() => {
      if (!picked) return;
      // Ref: #317 — getState() is correct: imperative read inside callback, not a subscription.
      const store = usePosStore.getState();
      store.deleteOrderWithRefundCheck(
        store.transactions.find(t =>
          t.studentId === picked.studentId && t.businessDate === viewDate && t.type === 'order'
        )?.transactionId ?? ''
      );
    }, [picked, viewDate]);
  ```

  With:
  ```typescript
    const handleDeleteOrder = useCallback((keepPaymentAsDeposit?: boolean) => {
      if (!picked) return;
      const store = usePosStore.getState();
      const orderTx = store.transactions.find(t =>
        t.studentId === picked.studentId && t.businessDate === viewDate && t.type === 'order'
      );
      if (orderTx) {
        store.deleteOrderWithRefundCheck(orderTx.transactionId, undefined, keepPaymentAsDeposit);
      }
    }, [picked, viewDate]);
  ```

- [ ] **Step 2: Update MainLayout props and replace ConfirmDialog**
  In [MainLayout.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/MainLayout.tsx):
  1. Add `orderTx?: LedgerTransaction | null` to `MainLayoutProps` interface.
  2. Update `onCancelDialogConfirm` signature to support `(keepPaymentAsDeposit?: boolean) => void`.
  3. Import `CancelOrderDialog` and `StudentAccount`.
  4. Replace `ConfirmDialog` (for cancelDialogOpen).

  Replace:
  ```typescript
  import { ConfirmDialog } from './ui/ConfirmDialog';
  ```
  With:
  ```typescript
  import { ConfirmDialog } from './ui/ConfirmDialog';
  import { CancelOrderDialog } from './CancelOrderDialog';
  import type { LedgerTransaction } from '../domain/ledger';
  import type { StudentAccount } from '../domain/student';
  ```

  And update `MainLayoutProps` (Around L35):
  ```typescript
    cancelDialogOpen: boolean;
    picked: StudentAccount | null;
    orderTx?: LedgerTransaction | null;
    onCancelDialogConfirm: (keepPaymentAsDeposit?: boolean) => void;
    onCancelDialogCancel: () => void;
  ```

  And replace the cancel dialog in return (L61-70):
  ```typescript
        <CancelOrderDialog
          open={cancelDialogOpen}
          picked={picked}
          orderTx={orderTx ?? null}
          onConfirm={onCancelDialogConfirm}
          onCancel={onCancelDialogCancel}
        />
  ```

- [ ] **Step 3: Update App.tsx to lookup orderTx and pass it**
  In [App.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/App.tsx):
  1. Lookup `orderTx` for the picked student and the viewDate using `allTx` (not `transactions` which is out of scope).
  2. Pass it to `MainLayout`.
  3. Pass the `keepPaymentAsDeposit` boolean parameter in the `onCancelDialogConfirm` callback to `handleDeleteOrder`.

  Around L195:
  ```typescript
        cancelDialogOpen={cancelDialogOpen} picked={picked}
        orderTx={picked ? allTx.find(t => t.studentId === picked.studentId && t.businessDate === viewDate && t.type === 'order') : null}
        onCancelDialogConfirm={(keepPaymentAsDeposit) => { handleDeleteOrder(keepPaymentAsDeposit); setCancelDialogOpen(false); cancelFlow(); }}
        onCancelDialogCancel={() => setCancelDialogOpen(false)}
  ```

- [ ] **Step 4: Update MainLayout mock props in tests**
  In [MainLayout.test.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/__tests__/MainLayout.test.tsx), add `orderTx: null` to the default props.

- [ ] **Step 5: Run unit tests**
  ```bash
  ./workflow.sh t4
  ```

- [ ] **Step 6: Commit changes**
  ```bash
  git add frontend/src/hooks/useCancelDialog.ts frontend/src/components/MainLayout.tsx frontend/src/App.tsx frontend/src/components/__tests__/MainLayout.test.tsx
  git commit -m "feat: integrate CancelOrderDialog and propagate keepPaymentAsDeposit parameter"
  ```

---

### Task 4: Add Unit and Integration Tests

**Files:**
- Modify: `frontend/src/store/__tests__/transactionActions.test.ts`
- Modify: `frontend/src/hooks/__tests__/useCancelDialog.test.ts`

- [ ] **Step 1: Add unit test in transactionActions.test.ts**
  In [transactionActions.test.ts](file:///Users/cheerc/talented-easyorder/frontend/src/store/__tests__/transactionActions.test.ts), add a new test verifying `deleteOrderWithRefundCheck` with `keepPaymentAsDeposit = true` converts the transaction to payment and updates student balance correctly.

  Test code to add:
  ```typescript
    it('T9b: deleteOrderWithRefundCheck with keepPaymentAsDeposit converts order to payment', () => {
      const store = usePosStore.getState();

      store.processTransaction('001', 'order', 90, 50);
      const tx = usePosStore.getState().transactions[0];

      const studentBefore = usePosStore.getState().students.find(s => s.studentId === '001')!;
      // balance is affected by order (amount = 50 - 90 = -40)

      const result = store.deleteOrderWithRefundCheck(tx.transactionId, undefined, true);

      expect(result.deleted).toBe(true);
      expect(result.refundAmount).toBe(0); // Kept as deposit

      const next = usePosStore.getState();
      const updatedTx = next.transactions.find(t => t.transactionId === tx.transactionId)!;
      const studentAfter = next.students.find(s => s.studentId === '001')!;

      expect(updatedTx.type).toBe('payment');
      expect(updatedTx.mealPrice).toBe(0);
      expect(updatedTx.paidAmount).toBe(50);
      expect(updatedTx.amount).toBe(50);
      // Balance was base_balance - 40. Now it is base_balance + 50. Difference is +90.
      expect(studentAfter.currentBalance).toBe(studentBefore.currentBalance + 90);
    });
  ```

- [ ] **Step 2: Update useCancelDialog tests**
  In [useCancelDialog.test.ts](file:///Users/cheerc/talented-easyorder/frontend/src/hooks/__tests__/useCancelDialog.test.ts), verify hook parameters and mock behaviors match.

- [ ] **Step 3: Run full tests**
  ```bash
  ./workflow.sh t4
  ```

- [ ] **Step 4: Commit changes**
  ```bash
  git add frontend/src/store/__tests__/transactionActions.test.ts frontend/src/hooks/__tests__/useCancelDialog.test.ts
  git commit -m "test: add unit tests for cancel order with keep balance option"
  ```
