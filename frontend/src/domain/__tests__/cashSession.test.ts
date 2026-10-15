import { describe, expect, it } from 'vitest';
import {
  calculateExpectedDrawerCash,
  createDailyCashSession,
  createDrawerCloseout,
  validateOpeningCash,
} from '../cashSession';

describe('cashSession', () => {
  it('creates an open daily drawer session with opening cash only', () => {
    const session = createDailyCashSession({
      businessDate: '2026-05-15',
      openingCash: 4000,
      openedBy: 'counter',
      openedAt: '2026-05-15T08:00:00.000Z',
    });

    expect(session).toEqual({
      cashSessionId: 'cash-2026-05-15',
      businessDate: '2026-05-15',
      openingCash: 4000,
      openedBy: 'counter',
      openedAt: '2026-05-15T08:00:00.000Z',
      status: 'open',
      revision: 1,
    });
  });

  it('adds net cash to opening cash when calculating expected drawer cash', () => {
    expect(calculateExpectedDrawerCash({ openingCash: 4000, netCash: 1260 })).toBe(5260);
  });

  it('creates a closeout snapshot against expected drawer cash', () => {
    const closeout = createDrawerCloseout({
      businessDate: '2026-05-15',
      openingCash: 4000,
      netCash: 1260,
      countedCash: 5250,
      note: '少 10 元，櫃台已註記',
    });

    expect(closeout).toEqual({
      businessDate: '2026-05-15',
      openingCash: 4000,
      netCash: 1260,
      expectedDrawerCash: 5260,
      countedCash: 5250,
      difference: -10,
      note: '少 10 元，櫃台已註記',
    });
  });

  describe('validateOpeningCash', () => {
    it('accepts 0, positive integers up to 20,000', () => {
      expect(validateOpeningCash(0)).toEqual({ ok: true });
      expect(validateOpeningCash(100)).toEqual({ ok: true });
      expect(validateOpeningCash(20000)).toEqual({ ok: true });
    });

    it('rejects negative numbers and decimals', () => {
      expect(validateOpeningCash(-1)).toEqual({ ok: false, reason: '開帳金額必須是 0 或正整數' });
      expect(validateOpeningCash(10.5)).toEqual({ ok: false, reason: '開帳金額必須是 0 或正整數' });
      expect(validateOpeningCash(NaN)).toEqual({ ok: false, reason: '開帳金額必須是 0 或正整數' });
    });

    it('rejects values greater than 20,000 with warning reason', () => {
      expect(validateOpeningCash(20001)).toEqual({ ok: false, reason: '開帳金額異常，請確認是否輸入錯誤' });
      expect(validateOpeningCash(50000)).toEqual({ ok: false, reason: '開帳金額異常，請確認是否輸入錯誤' });
    });
  });
});
