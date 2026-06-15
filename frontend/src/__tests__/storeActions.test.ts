import { describe, it, expect, beforeEach } from 'vitest';
import { usePosStore } from '../store/posStore';
import { CASHIER_SENTINEL } from '../domain/ledger';
import { resetStoreForTest } from './helpers/storeSetup';
import type { PosTransactionDraft } from '../domain/posTransaction';

beforeEach(() => {
  resetStoreForTest();
  // Clear initial mock data for isolated tests
  usePosStore.setState({ students: [], transactions: [], vendors: [] });
});

function seedStudent(id: string, name: string, balance: number) {
  usePosStore.setState((s) => ({
    students: [
      ...s.students,
      {
        studentId: id,
        displayName: name,
        status: 'active' as const,
        currentBalance: balance,
        aliases: [],
        faceEnrollmentStatus: 'none' as const,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        revision: 1,
      },
    ],
  }));
}

function seedMenu() {
  usePosStore.setState({
    todayMenu: {
      businessDate: '2026-06-15',
      itemName: '便當',
      price: 60,
      vendorId: 'v1',
      vendorNameSnapshot: '廠商A',
      updatedAt: '2026-06-15T08:00:00Z',
      revision: 1,
    },
  });
}

describe('orderActions — processTransaction', () => {
  it('creates order and updates student balance', () => {
    seedStudent('s1', '學生A', 1000);
    seedMenu();
    usePosStore.getState().processTransaction('s1', 'order', 60, 0, '便當');

    const state = usePosStore.getState();
    expect(state.students[0].currentBalance).toBe(940); // 1000 - 60
    expect(state.transactions.length).toBe(1);
    expect(state.transactions[0].type).toBe('order');
    expect(state.transactions[0].studentId).toBe('s1');
  });

  it('ignores nonexistent student', () => {
    seedMenu();
    usePosStore.getState().processTransaction('nonexistent', 'order', 60, 0);
    expect(usePosStore.getState().transactions.length).toBe(0);
  });
});

describe('expenseActions — commitPosTransactionDraft (expense)', () => {
  it('creates expense with CASHIER_SENTINEL studentId', () => {
    seedMenu();
    const draft: PosTransactionDraft = {
      intent: {
        businessDate: '2026-06-15',
        studentId: CASHIER_SENTINEL,
        type: 'expense',
        mealPrice: 100,
        paidAmount: 0,
        note: '文具費',
        sourceDevice: 'pc',
      },
      snapshots: {
        student: { studentId: CASHIER_SENTINEL, studentNameSnapshot: '櫃台' },
        menu: { menuNameSnapshot: '', vendorNameSnapshot: '', menuPriceSnapshot: 0, vendorIdSnapshot: '' },
      },
      expectedBalanceAfter: 0,
    };
    usePosStore.getState().commitPosTransactionDraft(draft);

    const state = usePosStore.getState();
    expect(state.transactions.length).toBe(1);
    expect(state.transactions[0].studentId).toBe(CASHIER_SENTINEL);
    expect(state.transactions[0].type).toBe('expense');
  });
});

describe('editActions — updateTransaction + cascade', () => {
  it('propagates balance change to subsequent transactions of same student', () => {
    seedStudent('s1', '學生A', 1000);
    seedMenu();
    const store = usePosStore.getState();

    // Create 3 transactions for same student (most recent first in array)
    store.processTransaction('s1', 'order', 60, 0, 'tx1');
    store.processTransaction('s1', 'order', 60, 0, 'tx2');
    store.processTransaction('s1', 'order', 60, 0, 'tx3');

    const state = usePosStore.getState();
    expect(state.students[0].currentBalance).toBe(820); // 1000 - 60*3
    expect(state.transactions.length).toBe(3);

    // Edit the oldest transaction (last in array, index 2) — change mealPrice from 60 to 100
    const oldestTxId = state.transactions[2].transactionId;
    usePosStore.getState().updateTransaction(oldestTxId, { mealPrice: 100 });

    const updated = usePosStore.getState();
    // Balance diff: was -60 (amount = 0-60), now -100 (amount = 0-100), diff = -40
    // All subsequent tx of same student should cascade
    expect(updated.students[0].currentBalance).toBe(780); // 820 - 40
  });

  it('deleteTransaction removes tx and recalculates balance', () => {
    seedStudent('s1', '學生A', 1000);
    seedMenu();
    usePosStore.getState().processTransaction('s1', 'order', 60, 0, '訂單');

    const txId = usePosStore.getState().transactions[0].transactionId;
    usePosStore.getState().deleteTransaction(txId, '刪除原因', 'operator1');

    const state = usePosStore.getState();
    // After delete, tx should be removed and balance restored
    expect(state.transactions.length).toBe(0);
    expect(state.students[0].currentBalance).toBe(1000);
  });
});

describe('paymentActions — commitPaymentTransaction', () => {
  it('creates payment transaction and adds to student balance', () => {
    seedStudent('s1', '學生A', 500);
    seedMenu();
    usePosStore.getState().commitPaymentTransaction('s1', 200, '儲值');

    const state = usePosStore.getState();
    expect(state.students[0].currentBalance).toBe(700); // 500 + 200
    expect(state.transactions.length).toBe(1);
    expect(state.transactions[0].type).toBe('payment');
    expect(state.transactions[0].paidAmount).toBe(200);
  });
});

describe('firebaseActions — basic existence', () => {
  it('store exposes firebase action functions (addStudent, disableStudent)', () => {
    const state = usePosStore.getState();
    expect(typeof state.addStudent).toBe('function');
    expect(typeof state.disableStudent).toBe('function');
  });
});
