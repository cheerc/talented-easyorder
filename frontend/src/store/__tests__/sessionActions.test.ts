import { describe, it, expect, beforeEach } from 'vitest';
import { usePosStore } from '../posStore';

beforeEach(() => {
  usePosStore.getState().resetData();
});

describe('sessionActions — cash sessions', () => {
  it('S1: openCashSession creates a session entry with correct fields', () => {
    const store = usePosStore.getState();

    store.openCashSession({
      businessDate: '2026-05-15',
      openingCash: 4000,
      operatorId: 'counter',
      openedAt: '2026-05-15T08:00:00.000Z',
    });

    const session = usePosStore.getState().cashSessions['2026-05-15'];
    expect(session).toBeDefined();
    expect(session.businessDate).toBe('2026-05-15');
    expect(session.openingCash).toBe(4000);
    expect(session.status).toBe('open');
    expect(session.openedBy).toBe('counter');
  });

  it('S2: duplicate openCashSession does not overwrite existing session', () => {
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
      openedAt: '2026-05-15T09:00:00.000Z',
    });

    const session = usePosStore.getState().cashSessions['2026-05-15'];
    expect(session.openingCash).toBe(4000);
  });

  it('S3: updateOpeningCash modifies the opening cash amount', () => {
    const store = usePosStore.getState();

    store.openCashSession({
      businessDate: '2026-05-15',
      openingCash: 4000,
      operatorId: 'counter',
      openedAt: '2026-05-15T08:00:00.000Z',
    });

    store.updateOpeningCash('2026-05-15', 5000);

    const session = usePosStore.getState().cashSessions['2026-05-15'];
    expect(session.openingCash).toBe(5000);
  });
});

describe('sessionActions — close / reopen', () => {
  it('S4: closeBusinessDate produces a dailySettlement and marks date closed', () => {
    const store = usePosStore.getState();

    store.openCashSession({
      businessDate: '2026-05-15',
      openingCash: 4000,
      operatorId: 'counter',
      openedAt: '2026-05-15T08:00:00.000Z',
    });

    // No transactions → netCash = 0 → expectedCash = openingCash
    store.closeBusinessDate({
      businessDate: '2026-05-15',
      countedCash: 4000,
      note: '',
      queuedSettlementAccepted: false,
      operatorId: 'counter',
    });

    const next = usePosStore.getState();
    expect(next.businessDateStatuses['2026-05-15']).toBe('closed');
    expect(next.dailySettlements).toHaveLength(1);
    expect(next.dailySettlements[0].businessDate).toBe('2026-05-15');
    expect(next.dailySettlements[0].openingCash).toBe(4000);
  });

  it('S5: reopenBusinessDate reverts status to reopened and appends settlement', () => {
    const store = usePosStore.getState();

    store.openCashSession({
      businessDate: '2026-05-15',
      openingCash: 4000,
      operatorId: 'counter',
      openedAt: '2026-05-15T08:00:00.000Z',
    });

    store.closeBusinessDate({
      businessDate: '2026-05-15',
      countedCash: 4000,
      note: '',
      queuedSettlementAccepted: false,
      operatorId: 'counter',
    });

    const settlementCount = usePosStore.getState().dailySettlements.length;

    store.reopenBusinessDate({
      businessDate: '2026-05-15',
      reason: 'need correction',
      operatorId: 'counter',
    });

    const next = usePosStore.getState();
    expect(next.businessDateStatuses['2026-05-15']).toBe('reopened');
    expect(next.dailySettlements.length).toBeGreaterThan(settlementCount);
    // Latest settlement should be the reopened variant
    const latest = next.dailySettlements[next.dailySettlements.length - 1];
    expect(latest.businessDate).toBe('2026-05-15');
    expect(latest.reopenReason).toBe('need correction');
  });

  it('S6: closeBusinessDate without cash session still succeeds (openingCash=0)', () => {
    const store = usePosStore.getState();

    store.closeBusinessDate({
      businessDate: '2026-05-16',
      countedCash: 0,
      note: '',
      queuedSettlementAccepted: false,
      operatorId: 'counter',
    });

    const next = usePosStore.getState();
    expect(next.businessDateStatuses['2026-05-16']).toBe('closed');
    expect(next.dailySettlements).toHaveLength(1);
    expect(next.dailySettlements[0].openingCash).toBe(0);
  });
});
