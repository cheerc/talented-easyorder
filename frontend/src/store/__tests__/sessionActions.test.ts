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

  it('M3 S6：沒有設定開帳金額不能關帳，回傳原因、資料不動', () => {
    const r = usePosStore.getState().closeBusinessDate({
      businessDate: '2026-05-16', countedCash: 0, note: '', queuedSettlementAccepted: false, operatorId: 'counter',
    });
    expect(r).toEqual({ ok: false, message: expect.stringContaining('還沒設定這一天的開帳金額') });
    const next = usePosStore.getState();
    expect(next.businessDateStatuses['2026-05-16']).toBeUndefined();
    expect(next.dailySettlements).toHaveLength(0);
  });

  it('M3：開帳金額用當天本人確認的設定，不用前一天的點算', () => {
    const store = usePosStore.getState();
    store.openCashSession({ businessDate: '2026-05-15', openingCash: 1000, operatorId: 'counter', openedAt: '2026-05-15T08:00:00.000Z' });
    expect(store.closeBusinessDate({ businessDate: '2026-05-15', countedCash: 1320, note: '多了', queuedSettlementAccepted: false, operatorId: 'counter' })).toEqual({ ok: true });
    store.openCashSession({ businessDate: '2026-05-16', openingCash: 1000, operatorId: 'counter', openedAt: '2026-05-16T08:00:00.000Z' });
    expect(store.closeBusinessDate({ businessDate: '2026-05-16', countedCash: 1000, note: '', queuedSettlementAccepted: false, operatorId: 'counter' })).toEqual({ ok: true });
    const d2 = usePosStore.getState().dailySettlements.find(s => s.businessDate === '2026-05-16')!;
    expect(d2.openingCash).toBe(1000);
    expect(d2.expectedCash).toBe(1000);
    expect(d2.difference).toBe(0);
  });

  it('M3：有差額沒寫原因不能關；差額為 0 可以不寫', () => {
    const store = usePosStore.getState();
    store.openCashSession({ businessDate: '2026-05-15', openingCash: 1000, operatorId: 'counter', openedAt: '2026-05-15T08:00:00.000Z' });
    const r = store.closeBusinessDate({ businessDate: '2026-05-15', countedCash: 990, note: ' ', queuedSettlementAccepted: false, operatorId: 'counter' });
    expect(r).toEqual({ ok: false, message: '點算金額和應有現金不同，請寫下原因。' });
    expect(usePosStore.getState().dailySettlements).toHaveLength(0);
    expect(store.closeBusinessDate({ businessDate: '2026-05-15', countedCash: 1000, note: '', queuedSettlementAccepted: false, operatorId: 'counter' })).toEqual({ ok: true });
  });

  it('M3：有待上傳的交易時，確認接受後可以關帳（原本永遠關不了）', () => {
    const store = usePosStore.getState();
    const date = store.todayMenu.businessDate;
    store.openCashSession({ businessDate: date, openingCash: 1000, operatorId: 'counter', openedAt: '2026-05-15T08:00:00.000Z' });
    store.processTransaction('001', 'payment', 0, 100);
    usePosStore.setState(s => ({ transactions: s.transactions.map(t => ({ ...t, syncStatus: 'queued' as const })) }));
    const blocked = usePosStore.getState().closeBusinessDate({ businessDate: date, countedCash: 1100, note: '', queuedSettlementAccepted: false, operatorId: 'counter' });
    expect(blocked.ok).toBe(false);
    const ok = usePosStore.getState().closeBusinessDate({ businessDate: date, countedCash: 1100, note: '', queuedSettlementAccepted: true, operatorId: 'counter' });
    expect(ok).toEqual({ ok: true });
    expect(usePosStore.getState().dailySettlements[0].expectedCash).toBe(1100);
  });

  it('M3：重開後再關帳，新紀錄的版次接在最高版次之後；隔天預填用最新的點算', async () => {
    const { suggestOpeningCash, latestSettlement } = await import('../../domain/cashClose');
    const store = usePosStore.getState();
    const close = (counted: number) => usePosStore.getState().closeBusinessDate({
      businessDate: '2026-05-15', countedCash: counted, note: counted === 1000 ? '' : '點算不同', queuedSettlementAccepted: false, operatorId: 'counter',
    });
    const reopen = () => usePosStore.getState().reopenBusinessDate({ businessDate: '2026-05-15', reason: '補登', operatorId: 'counter' });
    store.openCashSession({ businessDate: '2026-05-15', openingCash: 1000, operatorId: 'counter', openedAt: '2026-05-15T08:00:00.000Z' });

    expect(close(1090)).toEqual({ ok: true });
    reopen();
    expect(close(1100)).toEqual({ ok: true });
    reopen();
    const all = usePosStore.getState().dailySettlements;
    expect(all.map(s => [s.status, s.settlementRevision])).toEqual([
      ['closed', 1], ['reopened', 2], ['closed', 3], ['reopened', 4],
    ]);
    // 第二次重開是從第二次關帳（$1,100）複製，不是第一次。
    expect(latestSettlement('2026-05-15', all)!.countedCash).toBe(1100);
    expect(suggestOpeningCash('2026-05-16', all)).toEqual({ amount: 1100, source: 'previous_day' });
    expect(new Set(all.map(s => s.settlementId)).size).toBe(4);
  });
});
