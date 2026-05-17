import { describe, it, expect, beforeEach } from 'vitest';
import { usePosStore } from '../posStore';

describe('posStore Accounting Engine', () => {
  beforeEach(() => {
    usePosStore.getState().resetData();
  });

  it('calculates order balance correctly', () => {
    const studentId = '001';
    const store = usePosStore.getState();
    const initialBalance = store.students.find(s => s.studentId === studentId)!.currentBalance;

    store.processTransaction(studentId, 'order', 90, 0);

    const updatedStudent = usePosStore.getState().students.find(s => s.studentId === studentId)!;
    expect(updatedStudent.currentBalance).toBe(initialBalance - 90);
  });

  it('recalculates after balance correctly on update', () => {
    const studentId = '001';
    const store = usePosStore.getState();

    usePosStore.setState({ transactions: [] });

    store.processTransaction(studentId, 'order', 90, 0);
    const tx1 = usePosStore.getState().transactions[0];

    store.processTransaction(studentId, 'order', 90, 0);
    const tx2 = usePosStore.getState().transactions[0];

    const balanceAfterTx2 = usePosStore.getState().students.find(s => s.studentId === studentId)!.currentBalance;
    expect(tx2.afterBalance).toBe(balanceAfterTx2);

    usePosStore.getState().updateTransaction(tx1.transactionId, { type: 'topup', mealPrice: 0, paidAmount: 100 });

    const newTx1 = usePosStore.getState().transactions.find(t => t.transactionId === tx1.transactionId)!;
    const newTx2 = usePosStore.getState().transactions.find(t => t.transactionId === tx2.transactionId)!;
    const finalBalance = usePosStore.getState().students.find(s => s.studentId === studentId)!.currentBalance;

    expect(newTx1.afterBalance).toBe(tx1.afterBalance + 190);
    expect(newTx2.afterBalance).toBe(tx2.afterBalance + 190);
    expect(newTx2.afterBalance).toBe(finalBalance);
  });
});

describe('posStore Domain Integration', () => {
  beforeEach(() => {
    usePosStore.getState().resetData();
  });

  it('processTransaction stores studentNameSnapshot', () => {
    const store = usePosStore.getState();
    store.processTransaction('001', 'order', 90, 0);
    const tx = usePosStore.getState().transactions[0];
    expect(tx.studentNameSnapshot).toBe('王柏翰');
  });

  it('processTransaction stores menu snapshots from todayMenu', () => {
    const store = usePosStore.getState();
    store.processTransaction('001', 'order', 90, 0);
    const tx = usePosStore.getState().transactions[0];
    expect(tx.menuNameSnapshot).toBe('日式唐揚雞便當');
    expect(tx.vendorNameSnapshot).toBe('阿榮便當');
  });

  it('processTransaction sets businessDate on transaction', () => {
    const store = usePosStore.getState();
    const todayDate = store.todayMenu.businessDate;
    store.processTransaction('001', 'order', 90, 0);
    const tx = usePosStore.getState().transactions[0];
    expect(tx.businessDate).toBe(todayDate);
  });

  it('processTransaction sets syncStatus to local', () => {
    const store = usePosStore.getState();
    store.processTransaction('001', 'order', 90, 0);
    const tx = usePosStore.getState().transactions[0];
    expect(tx.syncStatus).toBe('local');
  });

  it('processTransaction uses calculateTransactionAmount for amount', () => {
    const store = usePosStore.getState();
    store.processTransaction('001', 'order', 90, 50);
    const tx = usePosStore.getState().transactions[0];
    expect(tx.amount).toBe(-40);
  });

  it('students use StudentAccount shape with currentBalance', () => {
    const student = usePosStore.getState().students[0];
    expect(student).toHaveProperty('studentId');
    expect(student).toHaveProperty('displayName');
    expect(student).toHaveProperty('currentBalance');
    expect(student).toHaveProperty('status');
    expect(student).toHaveProperty('faceEnrollmentStatus');
    expect(student).toHaveProperty('revision');
  });
});

describe('posStore commitPosTransactionDraft', () => {
  beforeEach(() => {
    usePosStore.getState().resetData();
  });

  it('stores expense with income direction (mealPrice=0, paidAmount=100)', () => {
    const store = usePosStore.getState();
    store.commitPosTransactionDraft({
      intent: {
        businessDate: '2026-05-17',
        studentId: '__cashier__',
        type: 'expense',
        mealPrice: 0,
        paidAmount: 100,
        note: '收入：撿到錢',
        sourceDevice: 'pc',
      },
      snapshots: {
        student: { studentId: '__cashier__', studentNameSnapshot: '櫃台' },
        menu: { menuNameSnapshot: '', vendorNameSnapshot: '' },
      },
      amount: 100,
      expectedBalanceAfter: 0,
    });
    const tx = usePosStore.getState().transactions[0];
    expect(tx.mealPrice).toBe(0);
    expect(tx.paidAmount).toBe(100);
    expect(tx.amount).toBe(100);
  });

  it('stores expense with expense direction (mealPrice=150, paidAmount=0)', () => {
    const store = usePosStore.getState();
    store.commitPosTransactionDraft({
      intent: {
        businessDate: '2026-05-17',
        studentId: '__cashier__',
        type: 'expense',
        mealPrice: 150,
        paidAmount: 0,
        note: '支出：付便當錢',
        sourceDevice: 'pc',
      },
      snapshots: {
        student: { studentId: '__cashier__', studentNameSnapshot: '櫃台' },
        menu: { menuNameSnapshot: '', vendorNameSnapshot: '' },
      },
      amount: -150,
      expectedBalanceAfter: 0,
    });
    const tx = usePosStore.getState().transactions[0];
    expect(tx.mealPrice).toBe(150);
    expect(tx.paidAmount).toBe(0);
    expect(tx.amount).toBe(-150);
  });
});

describe('posStore commitPosTransactionDraft', () => {
  beforeEach(() => {
    usePosStore.getState().resetData();
  });

  it('stores expense with income direction (mealPrice=0, paidAmount=100)', () => {
    const store = usePosStore.getState();
    store.commitPosTransactionDraft({
      intent: {
        businessDate: '2026-05-17',
        studentId: '__cashier__',
        type: 'expense',
        mealPrice: 0,
        paidAmount: 100,
        note: '收入：撿到錢',
        sourceDevice: 'pc',
      },
      snapshots: {
        student: { studentId: '__cashier__', studentNameSnapshot: '櫃台' },
        menu: { menuNameSnapshot: '', vendorNameSnapshot: '' },
      },
      amount: 100,
      expectedBalanceAfter: 0,
    });
    const tx = usePosStore.getState().transactions[0];
    expect(tx.mealPrice).toBe(0);
    expect(tx.paidAmount).toBe(100);
    expect(tx.amount).toBe(100);
  });

  it('stores expense with expense direction (mealPrice=150, paidAmount=0)', () => {
    const store = usePosStore.getState();
    store.commitPosTransactionDraft({
      intent: {
        businessDate: '2026-05-17',
        studentId: '__cashier__',
        type: 'expense',
        mealPrice: 150,
        paidAmount: 0,
        note: '支出：付便當錢',
        sourceDevice: 'pc',
      },
      snapshots: {
        student: { studentId: '__cashier__', studentNameSnapshot: '櫃台' },
        menu: { menuNameSnapshot: '', vendorNameSnapshot: '' },
      },
      amount: -150,
      expectedBalanceAfter: 0,
    });
    const tx = usePosStore.getState().transactions[0];
    expect(tx.mealPrice).toBe(150);
    expect(tx.paidAmount).toBe(0);
    expect(tx.amount).toBe(-150);
  });
});

describe('posStore Compatibility', () => {
  beforeEach(() => {
    window.localStorage.clear();
    usePosStore.getState().resetData();
  });

  it('normalizes old-shape student {id, name, balance} into StudentAccount', async () => {
    const oldShape = {
      state: {
        students: [
          { id: '999', name: '舊生甲', balance: 300 },
          { id: '998', name: '舊生乙', balance: -50 },
        ],
        transactions: [],
        vendors: [],
        todayMenu: { date: '2026/05/07', name: '便當', price: 90, vendor: '測試' },
      },
      version: 0,
    };
    localStorage.setItem('pos-storage', JSON.stringify(oldShape));

    // Zustand 5 persist rehydrate is async; await it so migrate() runs
    const store = usePosStore as unknown as { persist?: { rehydrate: () => Promise<void> } };
    if (store.persist?.rehydrate) {
      await store.persist.rehydrate();
    }
    const students = usePosStore.getState().students;
    const normalized = students.find(s => s.studentId === '999');
    expect(normalized).toBeDefined();
    expect(normalized!.displayName).toBe('舊生甲');
    expect(normalized!.currentBalance).toBe(300);
    expect(normalized!.status).toBe('active');
    expect(normalized!.faceEnrollmentStatus).toBe('none');
    expect(normalized!.revision).toBe(1);
  });
});


describe('posStore Cash Sessions', () => {
  beforeEach(() => {
    usePosStore.getState().resetData();
  });

  it('opens a cash session for the current business date', () => {
    const store = usePosStore.getState();

    store.openCashSession({
      businessDate: '2026-05-15',
      openingCash: 4000,
      operatorId: 'counter',
      openedAt: '2026-05-15T08:00:00.000Z',
    });

    const next = usePosStore.getState();
    expect(next.cashSessions['2026-05-15']).toMatchObject({
      businessDate: '2026-05-15',
      openingCash: 4000,
      status: 'open',
    });
  });

  it('does not overwrite an existing open cash session', () => {
    const store = usePosStore.getState();

    store.openCashSession({
      businessDate: '2026-05-15',
      openingCash: 4000,
      operatorId: 'counter',
      openedAt: '2026-05-15T08:00:00.000Z',
    });
    store.openCashSession({
      businessDate: '2026-05-15',
      openingCash: 3000,
      operatorId: 'counter',
      openedAt: '2026-05-15T08:05:00.000Z',
    });

    expect(usePosStore.getState().cashSessions['2026-05-15'].openingCash).toBe(4000);
  });
});
