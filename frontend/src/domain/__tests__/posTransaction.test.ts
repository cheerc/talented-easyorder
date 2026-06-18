import { describe, it, expect } from 'vitest';
import {
  parsePaidAmount,
  buildPosTransactionDraft,
  deriveTransactionAttributes,
} from '../posTransaction';
import type { PosTransactionIntent } from '../posTransaction';
import { STUDENT_001, TODAY_MENU_KARAAGE } from './fixtures';
import type { StudentAccount } from '../student';
import type { TodayMenu } from '../menu';

describe('parsePaidAmount', () => {
  it('parses a valid integer', () => {
    expect(parsePaidAmount('100')).toEqual({ ok: true, value: 100 });
  });

  it('treats empty string as zero', () => {
    expect(parsePaidAmount('')).toEqual({ ok: true, value: 0 });
  });

  it('rejects non-numeric input', () => {
    const result = parsePaidAmount('abc');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
  });

  it('rejects negative numbers', () => {
    const result = parsePaidAmount('-50');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
  });

  it('rejects fractional amounts', () => {
    const result = parsePaidAmount('12.5');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
  });
});

describe('buildPosTransactionDraft', () => {
  function makeIntent(overrides: Partial<PosTransactionIntent> & { type: PosMode; sourceDevice: PosSourceDevice }): PosTransactionIntent {
    return {
      businessDate: '2026-05-07',
      studentId: '001',
      mealPrice: 90,
      paidAmount: 0,
      note: '日式唐揚雞便當',
      ...overrides,
    };
  }

  it('order with empty paid creates negative amount from mealPrice', () => {
    const draft = buildPosTransactionDraft({
      intent: makeIntent({ type: 'order', sourceDevice: 'pc', paidAmount: 0 }),
      student: STUDENT_001,
      menu: TODAY_MENU_KARAAGE,
    });
    expect(draft.amount).toBe(-90);
    expect(draft.expectedBalanceAfter).toBe(STUDENT_001.currentBalance + draft.amount);
    expect(draft.intent.mealPrice).toBe(90);
  });

  it('order with exact paid creates zero amount', () => {
    const draft = buildPosTransactionDraft({
      intent: makeIntent({ type: 'order', sourceDevice: 'pc', paidAmount: 90 }),
      student: STUDENT_001,
      menu: TODAY_MENU_KARAAGE,
    });
    expect(draft.amount).toBe(0);
    expect(draft.expectedBalanceAfter).toBe(STUDENT_001.currentBalance);
  });

  it('payment with 500 creates positive amount and mealPrice=0', () => {
    const draft = buildPosTransactionDraft({
      intent: makeIntent({ type: 'payment', sourceDevice: 'pc', mealPrice: 0, paidAmount: 500 }),
      student: STUDENT_001,
      menu: TODAY_MENU_KARAAGE,
    });
    expect(draft.amount).toBe(500);
    expect(draft.intent.mealPrice).toBe(0);
    expect(draft.expectedBalanceAfter).toBe(STUDENT_001.currentBalance + 500);
  });

  it('draft snapshots preserve names/price from current objects', () => {
    const student: StudentAccount = { ...STUDENT_001, displayName: '王柏翰', currentBalance: 2000 };
    const menu: TodayMenu = { ...TODAY_MENU_KARAAGE, itemName: '排骨便當', price: 100 };

    const draft = buildPosTransactionDraft({
      intent: makeIntent({ type: 'order', sourceDevice: 'pc', paidAmount: 50, mealPrice: 100, note: '排骨便當' }),
      student,
      menu,
    });

    expect(draft.snapshots.student.studentNameSnapshot).toBe('王柏翰');
    expect(draft.snapshots.menu.menuNameSnapshot).toBe('排骨便當');
    expect(draft.snapshots.menu.menuPriceSnapshot).toBe(100);

    // Mutating source after draft should not affect snapshots
    student.displayName = 'changed';
    menu.itemName = 'changed';
    expect(draft.snapshots.student.studentNameSnapshot).toBe('王柏翰');
    expect(draft.snapshots.menu.menuNameSnapshot).toBe('排骨便當');
  });

  it('draft uses latest student balance at confirm time', () => {
    const richerStudent: StudentAccount = { ...STUDENT_001, currentBalance: 5000 };
    const draft = buildPosTransactionDraft({
      intent: makeIntent({ type: 'order', sourceDevice: 'pc', paidAmount: 0 }),
      student: richerStudent,
      menu: TODAY_MENU_KARAAGE,
    });
    expect(draft.expectedBalanceAfter).toBe(5000 - 90);
  });

  it('uses per-order price override without changing today menu', () => {
    const draft = buildPosTransactionDraft({
      intent: makeIntent({ type: 'order', sourceDevice: 'pc', mealPrice: 110, paidAmount: 110, note: '單筆改價：雞腿便當' }),
      student: STUDENT_001,
      menu: TODAY_MENU_KARAAGE,
    });

    expect(draft.intent.mealPrice).toBe(110);
    expect(draft.snapshots.menu.menuNameSnapshot).toBe(TODAY_MENU_KARAAGE.itemName);
    expect(draft.amount).toBe(0);
  });
});

describe('deriveTransactionAttributes', () => {
  it('derives paidAmount correctly when mode is order and paidAmountText is provided', () => {
    const result = deriveTransactionAttributes({
      mode: 'order',
      todayMenuPrice: 90,
      todayMenuItemName: '日式唐揚雞便當',
      priceOverride: null,
      priceOverrideLabel: '',
      paidAmountText: '90',
    });
    expect(result.paidAmount).toBe(90);
    expect(result.mealPrice).toBe(90);
    expect(result.note).toBe('日式唐揚雞便當 (已付)');
  });
});
