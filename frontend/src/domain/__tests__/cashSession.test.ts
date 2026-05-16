import { describe, expect, it } from 'vitest';
import {
  calculateExpectedDrawerCash,
  createDailyCashSession,
  createDrawerCloseout,
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
});
