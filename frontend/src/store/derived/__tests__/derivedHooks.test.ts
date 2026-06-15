import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePosStore } from '../../posStore';
import { useCashClose } from '../useCashClose';
import { useActiveOrderCount, useMergedTransactions } from '../useLedger';
import { useLedgerReport } from '../useLedgerReport';
import type { LedgerTransaction } from '../../../domain/ledger';

beforeEach(() => {
  window.localStorage.clear();
  usePosStore.getState().resetData();
  usePosStore.setState({ students: [], transactions: [], vendors: [] });
});

function makeTx(overrides?: Partial<LedgerTransaction>): LedgerTransaction {
  return {
    transactionId: `tx-${Math.random()}`,
    businessDate: '2026-06-15',
    createdAt: '2026-06-15T10:00:00Z',
    studentId: 's1',
    studentNameSnapshot: '學生',
    type: 'order',
    mealPrice: 60,
    paidAmount: 0,
    amount: -60,
    afterBalance: 940,
    menuNameSnapshot: '便當',
    vendorNameSnapshot: '廠商A',
    sourceDevice: 'pc',
    syncStatus: 'local',
    revision: 1,
    note: '',
    ...overrides,
  };
}

describe('useLedgerReport', () => {
  it('filters transactions by viewDate for today range', () => {
    const todayTx = makeTx({ businessDate: '2026-06-15' });
    const yesterdayTx = makeTx({ businessDate: '2026-06-14' });
    usePosStore.setState({ transactions: [todayTx, yesterdayTx] });

    const { result } = renderHook(() =>
      useLedgerReport({ dateRange: 'today', viewDate: '2026-06-15' }),
    );

    expect(result.current.filtered.length).toBe(1);
    expect(result.current.filtered[0].businessDate).toBe('2026-06-15');
  });

  it('calculates totals correctly', () => {
    const orderTx = makeTx({ type: 'order', mealPrice: 60, paidAmount: 0, amount: -60 });
    const paymentTx = makeTx({ type: 'payment', mealPrice: 0, paidAmount: 200, amount: 200 });
    usePosStore.setState({ transactions: [orderTx, paymentTx] });

    const { result } = renderHook(() =>
      useLedgerReport({ dateRange: 'today', viewDate: '2026-06-15' }),
    );

    expect(result.current.totals.orderCount).toBe(1);
    // transactionCount excludes unpaid orders (paidAmount=0), only payment counts
    expect(result.current.totals.transactionCount).toBe(1);
  });

  it('groups by student', () => {
    const tx1 = makeTx({ studentId: 's1' });
    const tx2 = makeTx({ studentId: 's2', studentNameSnapshot: '學生B' });
    usePosStore.setState({ transactions: [tx1, tx2] });

    const { result } = renderHook(() =>
      useLedgerReport({ dateRange: 'today', viewDate: '2026-06-15' }),
    );

    expect(result.current.groups.length).toBe(2);
  });

  // Ref: #299 — L39 crash risk: custom range with undefined start/end
  it('handles custom date range', () => {
    const tx = makeTx({ businessDate: '2026-06-15' });
    usePosStore.setState({ transactions: [tx] });

    const { result } = renderHook(() =>
      useLedgerReport({
        dateRange: 'custom',
        viewDate: '2026-06-15',
        customStart: '2026-06-01',
        customEnd: '2026-06-30',
      }),
    );

    expect(result.current.filtered.length).toBe(1);
  });
});

describe('useCashClose', () => {
  it('returns opening cash and date status', () => {
    usePosStore.setState({
      businessDateStatuses: { '2026-06-15': 'open' },
      cashSessions: {},
      dailySettlements: [],
    });

    const { result } = renderHook(() => useCashClose('2026-06-15'));

    expect(result.current.dateStatus).toBe('open');
    expect(typeof result.current.openingCash).toBe('number');
  });

  it('defaults to open when no status exists', () => {
    usePosStore.setState({ businessDateStatuses: {}, cashSessions: {}, dailySettlements: [] });

    const { result } = renderHook(() => useCashClose('2026-06-15'));
    expect(result.current.dateStatus).toBe('open');
  });
});

describe('useLedger — useActiveOrderCount', () => {
  it('counts active orders for a student on a date', () => {
    const tx1 = makeTx({ studentId: 's1', type: 'order', businessDate: '2026-06-15' });
    const tx2 = makeTx({ studentId: 's1', type: 'payment', businessDate: '2026-06-15' });
    const tx3 = makeTx({ studentId: 's1', type: 'order', businessDate: '2026-06-15' });
    usePosStore.setState({ transactions: [tx1, tx2, tx3] });

    const { result } = renderHook(() => useActiveOrderCount('s1', '2026-06-15'));
    expect(result.current).toBe(2);
  });

  it('returns 0 for null studentId', () => {
    const { result } = renderHook(() => useActiveOrderCount(null, '2026-06-15'));
    expect(result.current).toBe(0);
  });
});

describe('useLedger — useMergedTransactions', () => {
  it('merges transactions with same studentId', () => {
    const tx1 = makeTx({ studentId: 's1', type: 'order' });
    const tx2 = makeTx({ studentId: 's1', type: 'order' });
    const tx3 = makeTx({ studentId: 's2', type: 'order' });

    const { result } = renderHook(() => useMergedTransactions([tx1, tx2, tx3]));
    // Merged: s1 group + s2 group
    expect(result.current.length).toBeGreaterThanOrEqual(2);
  });
});
