import { describe, it, expect, beforeEach } from 'vitest';
import { usePosStore } from '../posStore';

// Ref: #358 — Tests for editActions (delete/edit with audit trail)

beforeEach(() => {
  usePosStore.getState().resetData();
});

describe('editActions — deleteTransaction', () => {
  it('removes transaction and adjusts student balance', () => {
    const store = usePosStore.getState();
    store.processTransaction('001', 'order', 90, 0);
    const tx = usePosStore.getState().transactions[0];
    const balanceAfterOrder = usePosStore.getState().students.find(s => s.studentId === '001')!.currentBalance;

    usePosStore.getState().deleteTransaction(tx.transactionId, { reason: '測試' });

    const next = usePosStore.getState();
    expect(next.transactions.find(t => t.transactionId === tx.transactionId)).toBeUndefined();
    // Balance should be restored
    expect(next.students.find(s => s.studentId === '001')!.currentBalance).toBe(
      Math.round(balanceAfterOrder + 90)
    );
  });

  it('does nothing for non-existent transaction', () => {
    const store = usePosStore.getState();
    const txCount = store.transactions.length;
    store.deleteTransaction('NONEXISTENT', { reason: '測試' });
    expect(usePosStore.getState().transactions.length).toBe(txCount);
  });
});

describe('editActions — deleteOrderWithRefundCheck', () => {
  it('deletes an order and returns refund info', () => {
    const store = usePosStore.getState();
    store.processTransaction('001', 'order', 90, 50);
    const tx = usePosStore.getState().transactions[0];

    const result = usePosStore.getState().deleteOrderWithRefundCheck(tx.transactionId, { reason: '測試' });

    expect(result.deleted).toBe(true);
    expect(result.refundAmount).toBe(50);
    expect(result.wasClosedDate).toBe(false);
    expect(usePosStore.getState().transactions.find(t => t.transactionId === tx.transactionId)).toBeUndefined();
  });

  it('creates audit event on deletion', () => {
    const store = usePosStore.getState();
    const auditsBefore = store.auditEvents.length;
    store.processTransaction('001', 'order', 90, 0);
    const tx = usePosStore.getState().transactions[0];

    usePosStore.getState().deleteOrderWithRefundCheck(tx.transactionId, { reason: '測試' });

    const audits = usePosStore.getState().auditEvents;
    expect(audits.length).toBe(auditsBefore + 1);
    expect(audits[audits.length - 1].eventType).toBe('transaction_deleted');
  });

  it('returns not-deleted for non-order transaction', () => {
    const store = usePosStore.getState();
    store.processTransaction('001', 'payment', 0, 500);
    const tx = usePosStore.getState().transactions[0];

    const result = usePosStore.getState().deleteOrderWithRefundCheck(tx.transactionId, { reason: '測試' });
    expect(result.deleted).toBe(false);
  });

  it('returns not-deleted for non-existent id', () => {
    const result = usePosStore.getState().deleteOrderWithRefundCheck('NONEXISTENT', { reason: '測試' });
    expect(result.deleted).toBe(false);
    expect(result.refundAmount).toBe(0);
  });
});

describe('editActions — editTransaction', () => {
  it('updates mealPrice and recalculates balance', () => {
    const store = usePosStore.getState();
    const initialBalance = store.students.find(s => s.studentId === '001')!.currentBalance;

    store.processTransaction('001', 'order', 90, 0);
    const tx = usePosStore.getState().transactions[0];

    usePosStore.getState().editTransaction(tx.transactionId, { mealPrice: 60 }, { reason: '測試' });

    const next = usePosStore.getState();
    const editedTx = next.transactions.find(t => t.transactionId === tx.transactionId)!;
    const student = next.students.find(s => s.studentId === '001')!;

    expect(editedTx.mealPrice).toBe(60);
    expect(editedTx.revision).toBe(tx.revision + 1);
    // Balance should reflect cheaper meal: initialBalance - 60
    expect(student.currentBalance).toBe(initialBalance - 60);
  });

  it('creates audit event for edit', () => {
    const store = usePosStore.getState();
    const auditsBefore = store.auditEvents.length;
    store.processTransaction('001', 'order', 90, 0);
    const tx = usePosStore.getState().transactions[0];

    usePosStore.getState().editTransaction(tx.transactionId, { note: 'updated' }, { reason: '測試' });

    const audits = usePosStore.getState().auditEvents;
    expect(audits.length).toBe(auditsBefore + 1);
    expect(audits[audits.length - 1].eventType).toBe('transaction_edited');
  });
});

describe('M2 F03：改帳後這個帳戶之後每一筆的結餘都重算', () => {
  function setup() {
    usePosStore.setState({ transactions: [] });
    const start = usePosStore.getState().students.find(s => s.studentId === '001')!.currentBalance;
    usePosStore.getState().processTransaction('001', 'order', 90, 0);
    const order = usePosStore.getState().transactions[0];
    usePosStore.getState().processTransaction('001', 'payment', 0, 100);
    const payment = usePosStore.getState().transactions[0];
    return { start, order, payment };
  }
  const bal = () => usePosStore.getState().students.find(s => s.studentId === '001')!.currentBalance;
  const after = (id: string) => usePosStore.getState().transactions.find(t => t.transactionId === id)!.afterBalance;

  it('editTransaction 把收款 100 改成 120：最後一筆結餘與目前餘額一致', () => {
    const { start, payment } = setup();
    usePosStore.getState().editTransaction(payment.transactionId, { paidAmount: 120 }, { reason: '測試' });
    expect(bal()).toBe(start - 90 + 120);
    expect(after(payment.transactionId)).toBe(start - 90 + 120);
  });

  it('editTransaction 改前面那筆訂餐：後面的收款結餘跟著變', () => {
    const { start, order, payment } = setup();
    usePosStore.getState().editTransaction(order.transactionId, { mealPrice: 110 }, { reason: '測試' });
    expect(after(order.transactionId)).toBe(start - 110);
    expect(after(payment.transactionId)).toBe(start - 110 + 100);
    expect(bal()).toBe(start - 110 + 100);
  });

  it('deleteTransaction 刪掉中間那筆：後面的結餘往回調', () => {
    const { start, order, payment } = setup();
    usePosStore.getState().deleteTransaction(order.transactionId, { reason: '測試' });
    expect(after(payment.transactionId)).toBe(start + 100);
    expect(bal()).toBe(start + 100);
  });

  it('deleteOrderWithRefundCheck 不會動到其他帳戶的餘額', () => {
    const { order } = setup();
    const others = usePosStore.getState().students.filter(s => s.studentId !== '001').map(s => [s.studentId, s.currentBalance]);
    usePosStore.getState().deleteOrderWithRefundCheck(order.transactionId, { reason: '測試' });
    expect(usePosStore.getState().students.filter(s => s.studentId !== '001').map(s => [s.studentId, s.currentBalance])).toEqual(others);
  });
});


describe('M2：改帳共用檢查（關帳日、理由、稽核）', () => {
  function setup() {
    usePosStore.setState({ transactions: [], auditEvents: [] });
    usePosStore.getState().processTransaction('001', 'order', 90, 100);
    const order = usePosStore.getState().transactions[0];
    usePosStore.getState().processTransaction('001', 'payment', 0, 50);
    const payment = usePosStore.getState().transactions[0];
    return { order, payment };
  }
  const snapshot = () => {
    const s = usePosStore.getState();
    return { transactions: s.transactions, students: s.students, auditEvents: s.auditEvents };
  };
  const closeDate = (date: string) =>
    usePosStore.setState(s => ({ businessDateStatuses: { ...s.businessDateStatuses, [date]: 'closed' } }));

  it('已關帳的日期：更正、刪除、取消訂餐都被擋下，資料與稽核完全不動', () => {
    const { order, payment } = setup();
    closeDate(order.businessDate);
    const before = snapshot();
    const store = usePosStore.getState();

    const edit = store.editTransaction(payment.transactionId, { paidAmount: 80 }, { reason: '打錯' });
    const del = store.deleteTransaction(payment.transactionId, { reason: '重複' });
    const cancel = store.deleteOrderWithRefundCheck(order.transactionId, { reason: '家長取消' });

    expect(edit).toEqual({ ok: false, message: expect.stringContaining('已經關帳') });
    expect(del).toEqual({ ok: false, message: expect.stringContaining('已經關帳') });
    expect(cancel).toMatchObject({ deleted: false, wasClosedDate: true, message: expect.stringContaining('已經關帳') });
    expect(snapshot()).toEqual(before);
  });

  it('重開後（reopened）可以更正', () => {
    const { payment } = setup();
    usePosStore.setState(s => ({ businessDateStatuses: { ...s.businessDateStatuses, [payment.businessDate]: 'reopened' } }));
    expect(usePosStore.getState().editTransaction(payment.transactionId, { paidAmount: 80 }, { reason: '漏收' })).toEqual({ ok: true });
  });

  it('理由空白（只有空格）：三個入口都擋下，資料不動', () => {
    const { order, payment } = setup();
    const before = snapshot();
    const store = usePosStore.getState();
    expect(store.editTransaction(payment.transactionId, { paidAmount: 80 }, { reason: '  ' })).toEqual({ ok: false, message: '請填寫理由。' });
    expect(store.deleteTransaction(payment.transactionId, { reason: '' })).toEqual({ ok: false, message: '請填寫理由。' });
    expect(store.deleteOrderWithRefundCheck(order.transactionId, { reason: '' })).toMatchObject({ deleted: false, message: '請填寫理由。' });
    expect(snapshot()).toEqual(before);
  });

  it('刪除：原單整筆、理由、操作員寫進稽核，和交易在同一次更新', () => {
    const { payment } = setup();
    const result = usePosStore.getState().deleteTransaction(payment.transactionId, { reason: ' 重複登記 ', operatorId: 'op-1' });
    expect(result).toEqual({ ok: true });
    const s = usePosStore.getState();
    expect(s.transactions.some(t => t.transactionId === payment.transactionId)).toBe(false);
    const evt = s.auditEvents.at(-1)!;
    expect(evt).toMatchObject({
      eventType: 'transaction_deleted', entityId: payment.transactionId,
      reason: '重複登記', operatorId: 'op-1', after: null,
    });
    expect(evt.before).toEqual({ ...payment });
  });

  it('更正：稽核記下理由與前後數字', () => {
    const { payment } = setup();
    usePosStore.getState().editTransaction(payment.transactionId, { paidAmount: 80 }, { reason: '收款打錯', operatorId: 'op-2' });
    expect(usePosStore.getState().auditEvents.at(-1)).toMatchObject({
      eventType: 'transaction_edited', reason: '收款打錯', operatorId: 'op-2',
      before: { paidAmount: 50 }, after: { paidAmount: 80 },
    });
  });

  it('取消訂餐、收款留在帳戶：原單改成同額繳費，稽核記下類型變化與理由', () => {
    const { order } = setup();
    const r = usePosStore.getState().deleteOrderWithRefundCheck(order.transactionId, { reason: '家長取消', keepPaymentAsDeposit: true });
    expect(r).toMatchObject({ deleted: true, refundAmount: 0 });
    const converted = usePosStore.getState().transactions.find(t => t.transactionId === order.transactionId)!;
    expect(converted).toMatchObject({ type: 'payment', mealPrice: 0, paidAmount: 100, amount: 100 });
    expect(usePosStore.getState().auditEvents.at(-1)).toMatchObject({
      eventType: 'transaction_edited', reason: '家長取消',
      before: { type: 'order', mealPrice: 90 }, after: { type: 'payment', mealPrice: 0 },
    });
  });
});
