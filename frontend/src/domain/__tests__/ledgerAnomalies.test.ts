import { describe, expect, it } from 'vitest';
import {
  computeLedgerAnomalies, openingDifference, previousClosedDay, type LedgerAnomalyDay,
} from '../ledgerAnomalies';

const closed = (dayId: string, openingCash: number, countedCash: number): LedgerAnomalyDay => ({
  dayId, status: 'closed', openingCash, activeTransactionCount: 3, countedCash,
});
const open = (dayId: string, openingCash: number | null, activeTransactionCount = 0, status: 'open' | 'reopened' = 'open'): LedgerAnomalyDay => ({
  dayId, status, openingCash, activeTransactionCount, countedCash: null,
});

describe('computeLedgerAnomalies', () => {
  it('上線第一天找不到上一個已關帳日，不算異常', () => {
    expect(computeLedgerAnomalies([open('2026-10-01', 500)], '2026-10-01')).toEqual([]);
  });

  it('連續日期且開帳等於上次實點，沒有異常', () => {
    const days = [closed('2026-10-01', 500, 1200), open('2026-10-02', 1200)];
    expect(computeLedgerAnomalies(days, '2026-10-02')).toEqual([]);
  });

  it('中間放假（沒有營業日文件）且金額一致，不算異常', () => {
    const days = [closed('2026-10-01', 500, 1200), open('2026-10-05', 1200)];
    expect(computeLedgerAnomalies(days, '2026-10-05')).toEqual([]);
  });

  it('中間放假且金額不同，回報前一個已關帳日、差額與相隔天數', () => {
    const days = [closed('2026-10-01', 500, 1200), open('2026-10-05', 1000)];
    expect(computeLedgerAnomalies(days, '2026-10-05')).toEqual([{
      kind: 'opening-mismatch', dayId: '2026-10-05', openingCash: 1000,
      previousClosedDayId: '2026-10-01', previousCountedCash: 1200, difference: -200, daysApart: 4,
      gapDays: ['2026-10-02', '2026-10-03', '2026-10-04'], gapDayCount: 3,
    }]);
  });

  it('空日只列完全沒有營業日文件的日子，已有文件（例如沒開帳的過去日）不重複列出', () => {
    const days = [closed('2026-10-01', 500, 1200), open('2026-10-03', null), open('2026-10-05', 1000)];
    const mismatch = computeLedgerAnomalies(days, '2026-10-05').find(item => item.kind === 'opening-mismatch');
    expect(mismatch).toMatchObject({ gapDays: ['2026-10-02', '2026-10-04'], gapDayCount: 2 });
  });

  it('連續兩天沒有空日', () => {
    const days = [closed('2026-10-01', 500, 1200), open('2026-10-02', 1000)];
    expect(computeLedgerAnomalies(days, '2026-10-02')).toMatchObject([{ gapDays: [], gapDayCount: 0 }]);
  });

  it('空日最多列出最早的 31 天，總數照實回報；跨月與閏年的日曆日都算對', () => {
    const days = [closed('2028-02-20', 500, 1200), open('2028-04-10', 1000)];
    const [mismatch] = computeLedgerAnomalies(days, '2028-04-10');
    expect(mismatch).toMatchObject({ kind: 'opening-mismatch', daysApart: 50, gapDayCount: 49 });
    if (mismatch.kind !== 'opening-mismatch') throw new Error('unreachable');
    expect(mismatch.gapDays).toHaveLength(31);
    expect(mismatch.gapDays.slice(0, 11)).toEqual([
      '2028-02-21', '2028-02-22', '2028-02-23', '2028-02-24', '2028-02-25', '2028-02-26', '2028-02-27',
      '2028-02-28', '2028-02-29', '2028-03-01', '2028-03-02',
    ]);
    expect(mismatch.gapDays.at(-1)).toBe('2028-03-22');
  });

  it('中間有一天完全沒有營業日文件，不影響前後比對', () => {
    const days = [closed('2026-10-01', 500, 800), closed('2026-10-03', 800, 900), open('2026-10-04', 950)];
    const result = computeLedgerAnomalies(days, '2026-10-04');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ kind: 'opening-mismatch', dayId: '2026-10-04', previousClosedDayId: '2026-10-03', difference: 50, daysApart: 1 });
  });

  it('前一天是 reopened 時往前找已關帳日', () => {
    const days = [closed('2026-10-01', 500, 800), open('2026-10-02', 800, 2, 'reopened'), open('2026-10-03', 700)];
    const result = computeLedgerAnomalies(days, '2026-10-03');
    expect(result.map(item => item.kind)).toEqual(['unclosed-past-day', 'opening-mismatch']);
    expect(result[1]).toMatchObject({ dayId: '2026-10-03', previousClosedDayId: '2026-10-01', previousCountedCash: 800, difference: -100 });
  });

  it('同一天多次關帳時用呼叫端傳入的最新版本實點', () => {
    // 最新版本（第 3 版）實點 900；舊版本實點 800 不會再出現在輸入。
    const days = [closed('2026-10-01', 500, 900), open('2026-10-02', 800)];
    expect(computeLedgerAnomalies(days, '2026-10-02')).toMatchObject([{ difference: -100, previousCountedCash: 900 }]);
  });

  it('過去未關帳但只有開帳現金，算 unclosed-past-day', () => {
    expect(computeLedgerAnomalies([open('2026-10-01', 500)], '2026-10-02')).toEqual([{
      kind: 'unclosed-past-day', dayId: '2026-10-01', status: 'open', openingCash: 500, activeTransactionCount: 0,
    }]);
  });

  it('過去未關帳、有交易但缺開帳現金，算 unclosed-past-day', () => {
    expect(computeLedgerAnomalies([open('2026-10-01', null, 4)], '2026-10-02')).toMatchObject([
      { kind: 'unclosed-past-day', dayId: '2026-10-01', openingCash: null, activeTransactionCount: 4 },
    ]);
  });

  it('過去未關帳但沒有開帳現金也沒有有效交易（含全部作廢），不算異常', () => {
    expect(computeLedgerAnomalies([open('2026-10-01', null, 0)], '2026-10-02')).toEqual([]);
  });

  it('今天未關帳不算異常；未來日期不檢查', () => {
    const days = [open('2026-10-02', 500, 3), open('2026-10-09', 900)];
    expect(computeLedgerAnomalies(days, '2026-10-02')).toEqual([]);
  });

  it('多筆異常依日期排序，同日先列未關帳再列開帳差額', () => {
    const days = [
      open('2026-10-04', 100, 1), closed('2026-10-01', 500, 1200), open('2026-10-02', 1000, 2), open('2026-10-03', 1200, 0),
    ];
    const result = computeLedgerAnomalies(days, '2026-10-05');
    expect(result.map(item => `${item.dayId}:${item.kind}`)).toEqual([
      '2026-10-02:unclosed-past-day',
      '2026-10-02:opening-mismatch',
      '2026-10-03:unclosed-past-day',
      '2026-10-04:unclosed-past-day',
      '2026-10-04:opening-mismatch',
    ]);
  });

  it('已關帳日缺實點現金時 fail closed', () => {
    expect(() => computeLedgerAnomalies([{ ...closed('2026-10-01', 0, 0), countedCash: null }], '2026-10-02')).toThrow();
  });
});

describe('previousClosedDay / openingDifference', () => {
  const closedDays = [{ dayId: '2026-10-01', countedCash: 800 }, { dayId: '2026-10-03', countedCash: 900 }];

  it('取日期早於目標日的最近一個已關帳日', () => {
    expect(previousClosedDay(closedDays, '2026-10-03')).toEqual({ dayId: '2026-10-01', countedCash: 800 });
    expect(previousClosedDay(closedDays, '2026-10-09')).toEqual({ dayId: '2026-10-03', countedCash: 900 });
    expect(previousClosedDay(closedDays, '2026-10-01')).toBeNull();
  });

  it('差額只在有上一個已關帳日且金額不同時出現', () => {
    expect(openingDifference({ dayId: '2026-10-03', countedCash: 900 }, 900)).toBeNull();
    expect(openingDifference({ dayId: '2026-10-03', countedCash: 900 }, 1000)).toBe(100);
    expect(openingDifference(null, 1000)).toBeNull();
  });
});
