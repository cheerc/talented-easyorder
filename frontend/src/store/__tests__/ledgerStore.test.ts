import { describe, it, expect, beforeEach } from 'vitest';
import { usePosStore } from '../posStore';

beforeEach(() => {
  localStorage.clear();
  usePosStore.getState().resetData();
  usePosStore.persist.rehydrate();
});

describe('ledgerStore — audit events', () => {
  it('correctTransaction appends audit event', () => {
    const store = usePosStore.getState();
    const tx = store.transactions[0];
    store.correctTransaction({
      transactionId: tx.transactionId,
      updates: { mealPrice: 90, paidAmount: 50, note: 'test' },
      reason: '價格變更',
      operatorId: 'op-test',
    });
    const next = usePosStore.getState();
    expect(next.auditEvents).toHaveLength(1);
    expect(next.auditEvents[0].eventType).toBe('transaction_corrected');
    expect(next.auditEvents[0].entityId).toBe(tx.transactionId);
    expect(next.auditEvents[0].reason).toBe('價格變更');
  });

  it('voidTransaction appends audit event', () => {
    const store = usePosStore.getState();
    const tx = store.transactions[0];
    store.voidTransaction({ transactionId: tx.transactionId, reason: '錯誤', operatorId: 'op-test' });
    const next = usePosStore.getState();
    expect(next.auditEvents).toHaveLength(1);
    expect(next.auditEvents[0].eventType).toBe('transaction_voided');
  });

  it('hardDeleteLocalDraft removes local draft and appends audit', () => {
    const store = usePosStore.getState();
    const tx = store.transactions[0];
    store.hardDeleteLocalDraft({ transactionId: tx.transactionId, reason: '測試刪除', operatorId: 'op-test' });
    const next = usePosStore.getState();
    expect(next.transactions.find(t => t.transactionId === tx.transactionId)).toBeUndefined();
    expect(next.auditEvents).toHaveLength(1);
  });
});

describe('ledgerStore — correction migration', () => {
  it('corrects queued row by appending correction not mutating original', () => {
    const store = usePosStore.getState();
    const tx = store.transactions[0];
    if (!tx) return;

    // First set sync to queued
    store.updateTransaction(tx.transactionId, { syncStatus: 'queued' });
    const updatedTx = usePosStore.getState().transactions.find(t => t.transactionId === tx.transactionId)!;
    expect(updatedTx.syncStatus).toBe('queued');

    store.correctTransaction({
      transactionId: tx.transactionId,
      updates: { mealPrice: 100, paidAmount: 100, note: 'correction' },
      reason: 'sync-status correction',
      operatorId: 'op-test',
    });

    const next = usePosStore.getState();
    // Original should not be mutated for mealPrice/paidAmount
    const orig = next.transactions.find(t => t.transactionId === tx.transactionId);
    expect(orig).toBeTruthy();
    if (orig) {
      // Original values preserved (queued row should not be directly edited)
      expect(orig.mealPrice).toBe(updatedTx.mealPrice);
      expect(orig.paidAmount).toBe(updatedTx.paidAmount);
    }

    // A correction row should exist
    const correction = next.transactions.find(t =>
      t.type === 'correction' && t.studentId === tx.studentId,
    );
    expect(correction).toBeTruthy();
  });
});

describe('ledgerStore — void', () => {
  it('marks original voided when voidTransaction is called', () => {
    const store = usePosStore.getState();
    const tx = store.transactions[0];
    if (!tx) return;

    store.updateTransaction(tx.transactionId, { syncStatus: 'synced' });
    store.voidTransaction({ transactionId: tx.transactionId, reason: '必須 void', operatorId: 'op-test' });

    const next = usePosStore.getState();
    const orig = next.transactions.find(t => t.transactionId === tx.transactionId);
    expect(orig).toBeTruthy();
    if (orig) {
      expect(orig.voidedAt).toBeDefined();
    }

    const voidRow = next.transactions.find(t => t.type === 'void' && t.studentId === tx.studentId);
    expect(voidRow).toBeTruthy();
    if (voidRow) {
      expect(voidRow.amount).toBe(-orig!.amount);
    }
  });
});

describe('ledgerStore — closed date blocks', () => {
  it('blocked date prevents correctTransaction', () => {
    const store = usePosStore.getState();
    const tx = store.transactions[0];
    if (!tx) return;

    store.setBusinessDateStatus(tx.businessDate, 'closed');
    const prevCount = store.auditEvents.length;

    store.correctTransaction({
      transactionId: tx.transactionId,
      updates: { paidAmount: 100 },
      reason: 'test',
      operatorId: 'op',
    });

    // Should be a no-op - no additional audit event
    const next = usePosStore.getState();
    expect(next.auditEvents.length).toBe(prevCount);

    // Reset for other tests
    store.setBusinessDateStatus(tx.businessDate, 'open');
  });
});

describe('ledgerStore — hydration migration', () => {
  it('hydrates missing auditEvents as empty array', () => {
    const raw = usePosStore.persist.getOptions().migrate?.(
      { state: { auditEvents: undefined } },
      1,
    );
    expect(raw).toBeDefined();
    const state = raw as Record<string, unknown>;
    expect(state.auditEvents).toEqual([]);
  });

  it('hydrates missing dailySettlements as empty array', () => {
    const raw = usePosStore.persist.getOptions().migrate?.(
      { state: { dailySettlements: undefined } },
      1,
    );
    expect(raw).toBeDefined();
    const state = raw as Record<string, unknown>;
    expect(state.dailySettlements).toEqual([]);
  });

  it('hydrates missing businessDateStatuses as empty record', () => {
    const raw = usePosStore.persist.getOptions().migrate?.(
      { state: { businessDateStatuses: undefined } },
      1,
    );
    expect(raw).toBeDefined();
    const state = raw as Record<string, unknown>;
    expect(state.businessDateStatuses).toEqual({});
  });

  it('normalizes transactions without syncStatus to local', () => {
    // Zustand 5: persistedState received directly (no .state wrapper)
    const input = {
      students: [],
      transactions: [
        { id: '1', date: '2026-01-01', time: '12:00:00Z', sid: '015', name: 'test', type: 'order' as const, mealPrice: 0, paidAmount: 0, amount: 0, after: 0, note: '' },
      ],
      todayMenu: { date: '2026-01-01', name: '雞腿飯', price: 85, vendor: 'test' },
      vendors: [],
    };
    const raw = usePosStore.persist.getOptions().migrate?.(input as unknown as PosState, 1);
    const state = raw as Record<string, unknown>;
    const txs = state.transactions as Array<Record<string, unknown>>;
    expect(txs).toHaveLength(1);
    expect(txs[0].syncStatus).toBe('local');
  });
});