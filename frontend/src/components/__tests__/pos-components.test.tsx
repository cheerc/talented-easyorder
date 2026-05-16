import { describe, expect, it } from 'vitest';
import { getQuickAmounts } from '../pos-components';

describe('getQuickAmounts', () => {
  it('places today price first for order mode', () => {
    expect(getQuickAmounts({ mode: 'order', todayPrice: 85, currentDebt: 0 })[0]).toBe(85);
  });

  it('adds price plus debt as the second order quick amount when the student owes money', () => {
    expect(getQuickAmounts({ mode: 'order', todayPrice: 85, currentDebt: 170 }).slice(0, 2)).toEqual([85, 255]);
  });

  it('keeps top-up amounts independent from today price', () => {
    expect(getQuickAmounts({ mode: 'topup', todayPrice: 85, currentDebt: 0 })).toEqual([100, 500, 1000, 2000, 3000]);
  });
});
