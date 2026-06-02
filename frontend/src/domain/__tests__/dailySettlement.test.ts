import { describe, it, expect } from 'vitest';
import { createDailySettlement, reopenBusinessDate } from '../cashClose';
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

describe('DailySettlement state machine', () => {
  describe('close transition', () => {
    it('creates settlement with status=closed and settlementRevision=1', () => {
      const settlement = createDailySettlement(
        '2026-05-15', makeTotals(), 4000, 4500, '', 'op-admin',
        '2026-05-15T18:00:00.000Z', false,
      );

      expect(settlement.status).toBe('closed');
      expect(settlement.settlementRevision).toBe(1);
      expect(settlement.revision).toBe(1);
    });

    it('sets settlementId with businessDate and closedAt', () => {
      const settlement = createDailySettlement(
        '2026-05-15', makeTotals(), 4000, 4500, '', 'op-admin',
        '2026-05-15T18:00:00.000Z', false,
      );

      expect(settlement.settlementId).toBe('settle-2026-05-15-2026-05-15T18:00:00.000Z');
    });

    it('records all financial fields from totals', () => {
      const settlement = createDailySettlement(
        '2026-05-15',
        makeTotals({ netCash: 1260, totalIncome: 3000, totalExpense: 1740, transactionCount: 15, orderCount: 12 }),
        4000, 5260, '平帳', 'counter',
        '2026-05-15T18:00:00.000Z', false,
      );

      expect(settlement.openingCash).toBe(4000);
      expect(settlement.netCash).toBe(1260);
      expect(settlement.expectedCash).toBe(5260);
      expect(settlement.countedCash).toBe(5260);
      expect(settlement.difference).toBe(0);
      expect(settlement.totalIncome).toBe(3000);
      expect(settlement.totalExpense).toBe(1740);
      expect(settlement.transactionCount).toBe(15);
      expect(settlement.orderCount).toBe(12);
    });

    it('records negative difference when countedCash < expectedCash', () => {
      const settlement = createDailySettlement(
        '2026-05-15', makeTotals({ netCash: 500 }), 1000, 1480, '短少 20', 'op',
        '2026-05-15T18:00:00.000Z', false,
      );

      expect(settlement.expectedCash).toBe(1500);
      expect(settlement.countedCash).toBe(1480);
      expect(settlement.difference).toBe(-20);
    });

    it('sets syncStatus=queued when hasQueuedRows true', () => {
      const settlement = createDailySettlement(
        '2026-05-15', makeTotals(), 4000, 4500, '', 'op-admin',
        '2026-05-15T18:00:00.000Z', true,
      );

      expect(settlement.syncStatus).toBe('queued');
    });

    it('records closedBy and closedAt', () => {
      const settlement = createDailySettlement(
        '2026-05-15', makeTotals(), 4000, 4500, '', 'op-admin',
        '2026-05-15T18:00:00.000Z', false,
      );

      expect(settlement.closedBy).toBe('op-admin');
      expect(settlement.closedAt).toBe('2026-05-15T18:00:00.000Z');
    });

    it('reopened fields absent on fresh close', () => {
      const settlement = createDailySettlement(
        '2026-05-15', makeTotals(), 4000, 4500, '', 'op-admin',
        '2026-05-15T18:00:00.000Z', false,
      );

      expect(settlement.reopenedBy).toBeUndefined();
      expect(settlement.reopenedAt).toBeUndefined();
      expect(settlement.reopenReason).toBeUndefined();
    });
  });

  describe('reopen transition', () => {
    const closed = createDailySettlement(
      '2026-05-15', makeTotals({ netCash: 500 }), 1000, 1500, '', 'op-admin',
      '2026-05-15T18:00:00.000Z', false,
    );

    it('sets status=reopened', () => {
      const reopened = reopenBusinessDate(closed, '更正金額', 'manager', '2026-05-15T20:00:00.000Z');
      expect(reopened.status).toBe('reopened');
    });

    it('increments settlementRevision', () => {
      const reopened = reopenBusinessDate(closed, '更正金額', 'manager', '2026-05-15T20:00:00.000Z');
      expect(reopened.settlementRevision).toBe(2);
    });

    it('increments revision', () => {
      const reopened = reopenBusinessDate(closed, '更正金額', 'manager', '2026-05-15T20:00:00.000Z');
      expect(reopened.revision).toBe(2);
    });

    it('records reopenedBy, reopenedAt, reopenReason', () => {
      const reopened = reopenBusinessDate(closed, '帳目有誤，重新結算', 'manager', '2026-05-15T20:30:00.000Z');
      expect(reopened.reopenedBy).toBe('manager');
      expect(reopened.reopenedAt).toBe('2026-05-15T20:30:00.000Z');
      expect(reopened.reopenReason).toBe('帳目有誤，重新結算');
    });

    it('preserves all original financial fields', () => {
      const reopened = reopenBusinessDate(closed, '更正金額', 'manager', '2026-05-15T20:00:00.000Z');

      expect(reopened.settlementId).toBe(closed.settlementId);
      expect(reopened.businessDate).toBe(closed.businessDate);
      expect(reopened.openingCash).toBe(closed.openingCash);
      expect(reopened.netCash).toBe(closed.netCash);
      expect(reopened.expectedCash).toBe(closed.expectedCash);
      expect(reopened.countedCash).toBe(closed.countedCash);
      expect(reopened.difference).toBe(closed.difference);
      expect(reopened.totalIncome).toBe(closed.totalIncome);
      expect(reopened.totalExpense).toBe(closed.totalExpense);
      expect(reopened.transactionCount).toBe(closed.transactionCount);
      expect(reopened.orderCount).toBe(closed.orderCount);
      expect(reopened.closedBy).toBe(closed.closedBy);
      expect(reopened.closedAt).toBe(closed.closedAt);
      expect(reopened.note).toBe(closed.note);
      expect(reopened.syncStatus).toBe(closed.syncStatus);
    });

    it('reopen returns new object without mutating original', () => {
      const reopened = reopenBusinessDate(closed, '更正', 'admin', '2026-05-15T20:00:00.000Z');
      expect(closed.status).toBe('closed');
      expect(closed.settlementRevision).toBe(1);
      expect(closed.reopenedBy).toBeUndefined();
      expect(reopened).not.toBe(closed);
    });
  });

  describe('state machine sequence: close → reopen', () => {
    it('close then reopen produces valid final state', () => {
      const settlement = createDailySettlement(
        '2026-05-15', makeTotals({ netCash: 500 }), 1000, 1500, '', 'op',
        '2026-05-15T18:00:00.000Z', false,
      );
      const reopened = reopenBusinessDate(settlement, '重開', 'admin', '2026-05-15T21:00:00.000Z');

      expect(settlement.status).toBe('closed');
      expect(reopened.status).toBe('reopened');
      expect(reopened.settlementRevision).toBe(2);
      expect(reopened.revision).toBe(2);
      expect(reopened.reopenReason).toBe('重開');
    });

    it('multiple reopens accumulate revision', () => {
      const s1 = createDailySettlement(
        '2026-05-15', makeTotals(), 4000, 4500, '', 'op',
        '2026-05-15T18:00:00.000Z', false,
      );
      const s2 = reopenBusinessDate(s1, '第一次重開', 'admin', '2026-05-15T19:00:00.000Z');
      const s3 = reopenBusinessDate(s2, '第二次重開', 'admin', '2026-05-15T20:00:00.000Z');

      expect(s3.settlementRevision).toBe(3);
      expect(s3.revision).toBe(3);
      expect(s3.status).toBe('reopened');
      expect(s3.reopenReason).toBe('第二次重開');
    });
  });
});
