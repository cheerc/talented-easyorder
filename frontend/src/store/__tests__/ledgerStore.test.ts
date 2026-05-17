import { describe, it, expect, beforeEach } from 'vitest';
import { usePosStore } from '../posStore';

beforeEach(() => {
  localStorage.clear();
  usePosStore.getState().resetData();
  usePosStore.persist.rehydrate();
});

describe('ledgerStore — audit events', () => {
  it('editTransaction appends audit event', () => {
    const store = usePosStore.getState();
    const tx = store.transactions[0];
    store.editTransaction(tx.transactionId, { mealPrice: 90, paidAmount: 50, note: 'test' });
    const next = usePosStore.getState();
    expect(next.auditEvents).toHaveLength(1);
    expect(next.auditEvents[0].eventType).toBe('transaction_edited');
    expect(next.auditEvents[0].entityId).toBe(tx.transactionId);
  });

  it('deleteTransaction removes the transaction from state', () => {
    const store = usePosStore.getState();
    const tx = store.transactions[0];
    expect(tx).toBeTruthy();
    store.deleteTransaction(tx.transactionId);
    const next = usePosStore.getState();
    expect(next.transactions.find(t => t.transactionId === tx.transactionId)).toBeUndefined();
  });

  it('deleteOrderWithRefundCheck appends audit event', () => {
    const store = usePosStore.getState();
    const tx = store.transactions[0];
    const prevAuditCount = store.auditEvents.length;
    const result = store.deleteOrderWithRefundCheck(tx.transactionId);
    if (result.deleted) {
      const next = usePosStore.getState();
      expect(next.auditEvents.length).toBe(prevAuditCount + 1);
      expect(next.auditEvents[prevAuditCount].eventType).toBe('transaction_deleted');
    }
  });
});

describe('ledgerStore — edit transaction', () => {
  it('edits mealPrice and paidAmount inline', () => {
    const store = usePosStore.getState();
    const tx = store.transactions[0];
    if (!tx) return;

    store.editTransaction(tx.transactionId, { mealPrice: 100, paidAmount: 100, note: 'updated' });

    const next = usePosStore.getState();
    const edited = next.transactions.find(t => t.transactionId === tx.transactionId)!;
    expect(edited).toBeTruthy();
    expect(edited.mealPrice).toBe(100);
    expect(edited.paidAmount).toBe(100);
    expect(edited.note).toBe('updated');
    expect(edited.revision).toBe(tx.revision + 1);
  });
});

describe('ledgerStore — closed date blocks', () => {
  it('blocked date prevents editTransaction', () => {
    const store = usePosStore.getState();
    const tx = store.transactions[0];
    if (!tx) return;

    store.setBusinessDateStatus(tx.businessDate, 'closed');
    const prevCount = store.auditEvents.length;

    store.editTransaction(tx.transactionId, { paidAmount: 100 });

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
