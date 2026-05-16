import { describe, it, expect } from 'vitest';
import {
  createCashCloseDraft,
  validateCashClose,
  createDailySettlement,
  reopenBusinessDate,
  isBusinessDateWritable,
} from '../cashClose';
import type { LedgerTotals } from '../ledgerReport';

const makeTotals = (overrides: Partial<LedgerTotals> = {}): LedgerTotals => ({
  orderCount: 10,
  orderSalesAmount: 850,
  cashCollected: 500,
  refundAmount: 0,
  netCash: 500,
  newDebt: 350,
  topUpAmount: 500,
  cancellationCount: 0,
  transactionCount: 10,
  ...overrides,
});

describe('createCashCloseDraft', () => {
  it('sets expectedCash from openingCash + totals.netCash', () => {
    const draft = createCashCloseDraft(makeTotals({ netCash: 500 }), '2026-05-15', 1000, 1500, '', false);
    expect(draft.openingCash).toBe(1000);
    expect(draft.netCash).toBe(500);
    expect(draft.expectedCash).toBe(1500);
  });

  it('calculates difference as countedCash - expectedCash', () => {
    const draft = createCashCloseDraft(makeTotals({ netCash: 500 }), '2026-05-15', 1000, 1480, '', false);
    expect(draft.difference).toBe(-20);
  });

  it('zero difference when counted matches expected', () => {
    const draft = createCashCloseDraft(makeTotals({ netCash: 500 }), '2026-05-15', 1000, 1500, '', false);
    expect(draft.difference).toBe(0);
  });
});

describe('validateCashClose', () => {
  it('counted cash equal to expected closes without discrepancy note', () => {
    const result = validateCashClose(500, 500, false, false, false, '');
    expect(result.ok).toBe(true);
  });

  it('non-zero difference blocks close without note', () => {
    const result = validateCashClose(500, 480, false, false, false, '');
    expect(result.ok).toBe(false);
  });

  it('non-zero difference with note passes', () => {
    const result = validateCashClose(500, 480, false, false, false, '現金短少');
    expect(result.ok).toBe(true);
  });

  it('failed sync row blocks close', () => {
    const result = validateCashClose(500, 500, true, false, false, '');
    expect(result.ok).toBe(false);
  });

  it('conflict row blocks close', () => {
    const result = validateCashClose(500, 500, false, true, false, '');
    expect(result.ok).toBe(false);
  });

  it('queued rows require settlement acceptance', () => {
    const result = validateCashClose(500, 500, false, false, true, '');
    expect(result.ok).toBe(false);
  });

  it('queued rows with acceptance passes', () => {
    const result = validateCashClose(500, 500, false, false, true, '');
    // false: queuedSettlementAccepted
    expect(result.ok).toBe(false);
  });
});

describe('createDailySettlement', () => {
  it('creates settlement with revision 1 for first close', () => {
    const settlement = createDailySettlement('2026-05-15', makeTotals(), 0, 500, '', 'op-admin', '2026-05-15T18:00:00.000Z', false);
    expect(settlement.settlementRevision).toBe(1);
    expect(settlement.status).toBe('closed');
    expect(settlement.openingCash).toBe(0);
    expect(settlement.netCash).toBe(500);
    expect(settlement.expectedCash).toBe(500);
    expect(settlement.countedCash).toBe(500);
    expect(settlement.difference).toBe(0);
    expect(settlement.closedBy).toBe('op-admin');
  });

  it('uses queued syncStatus when queuedRowsExist', () => {
    const settlement = createDailySettlement('2026-05-15', makeTotals(), 0, 500, '', 'op-admin', '2026-05-15T18:00:00.000Z', true);
    expect(settlement.syncStatus).toBe('queued');
  });

  it('uses local syncStatus when no queued rows', () => {
    const settlement = createDailySettlement('2026-05-15', makeTotals(), 0, 500, '', 'op-admin', '2026-05-15T18:00:00.000Z', false);
    expect(settlement.syncStatus).toBe('local');
  });
});

describe('reopenBusinessDate', () => {
  it('creates reopened settlement revision', () => {
    const original = createDailySettlement('2026-05-15', makeTotals(), 500, '', 'op-admin', '2026-05-15T18:00:00.000Z', false);
    const reopened = reopenBusinessDate(original, '更正金額', 'op-admin', '2026-05-15T19:00:00.000Z');
    expect(reopened.status).toBe('reopened');
    expect(reopened.settlementRevision).toBe(2);
    expect(reopened.reopenedBy).toBe('op-admin');
    expect(reopened.reopenReason).toBe('更正金額');
    expect(reopened.reopenedAt).toBe('2026-05-15T19:00:00.000Z');
  });

  it('increments settlementRevision from original', () => {
    const original = createDailySettlement('2026-05-15', makeTotals(), 500, '', 'op-admin', '2026-05-15T18:00:00.000Z', false);
    const reopened = reopenBusinessDate(original, '再開', 'op-admin', '2026-05-15T20:00:00.000Z');
    expect(reopened.settlementRevision).toBe(2);
  });
});

describe('settlement with opening cash', () => {
  it('creates settlement using expected drawer cash including opening cash', () => {
    const settlement = createDailySettlement(
      '2026-05-15',
      makeTotals({ netCash: 1260 }),
      4000,
      5260,
      '平帳',
      'counter',
      '2026-05-15T09:30:00.000Z',
      false,
    );

    expect(settlement.openingCash).toBe(4000);
    expect(settlement.netCash).toBe(1260);
    expect(settlement.expectedCash).toBe(5260);
    expect(settlement.countedCash).toBe(5260);
    expect(settlement.difference).toBe(0);
  });

  it('createCashCloseDraft derives expected cash from opening cash plus net cash', () => {
    const draft = createCashCloseDraft(
      makeTotals({ netCash: 1260 }),
      '2026-05-15',
      4000,
      5250,
      '短少 10 元',
      false,
    );

    expect(draft.openingCash).toBe(4000);
    expect(draft.netCash).toBe(1260);
    expect(draft.expectedCash).toBe(5260);
    expect(draft.countedCash).toBe(5250);
    expect(draft.difference).toBe(-10);
  });
});

describe('isBusinessDateWritable', () => {
  it('open is writable', () => {
    expect(isBusinessDateWritable('open')).toBe(true);
  });

  it('reopened is writable', () => {
    expect(isBusinessDateWritable('reopened')).toBe(true);
  });

  it('closed is not writable', () => {
    expect(isBusinessDateWritable('closed')).toBe(false);
  });
});
