import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { getQuickAmounts, RecentStrip } from '../pos-components';
import type { LedgerTransaction } from '../../domain/ledger';

describe('getQuickAmounts', () => {
  it('places today price first for order mode', () => {
    expect(getQuickAmounts({ mode: 'order', todayPrice: 85, currentDebt: 0 })[0]).toBe(85);
  });

  it('adds price plus debt as the second order quick amount when the student owes money', () => {
    expect(getQuickAmounts({ mode: 'order', todayPrice: 85, currentDebt: 170 }).slice(0, 2)).toEqual([85, 255]);
  });

  it('keeps payment amounts independent from today price', () => {
    expect(getQuickAmounts({ mode: 'payment', todayPrice: 85, currentDebt: 0 })).toEqual([100, 500, 1000, 2000, 3000]);
  });
});

describe('RecentStrip', () => {
  const makeTx = (overrides: Partial<LedgerTransaction> & { uid: string }): (LedgerTransaction & { uid: string }) => ({
    transactionId: 'tx-1',
    studentId: '001',
    studentNameSnapshot: '王小美',
    type: 'order' as const,
    businessDate: '2026-05-17',
    mealPrice: 90,
    paidAmount: 0,
    amount: -90,
    note: '',
    afterBalance: 10,
    createdAt: '2026-05-17T12:00:00.000Z',
    createdBy: 'test',
    syncStatus: 'local' as const,
    uid: '0-tx-1',
    ...overrides,
  });

  it('shows 待繳費 for unpaid order', () => {
    const recent = [makeTx({ type: 'order', mealPrice: 90, paidAmount: 0, amount: -90, uid: '0-a' })];
    const { container } = render(<RecentStrip recent={recent} />);
    expect(container.textContent).toContain('待繳費');
    expect(container.textContent).toContain('90');
  });

  it('shows 已繳費 for paid order', () => {
    const recent = [makeTx({ type: 'order', mealPrice: 90, paidAmount: 90, amount: 0, uid: '0-b' })];
    const { container } = render(<RecentStrip recent={recent} />);
    expect(container.textContent).toContain('已繳費');
    expect(container.textContent).toContain('90');
  });

  it('shows numeric amount for payment type', () => {
    const recent = [makeTx({ type: 'payment', paidAmount: 200, amount: 200, uid: '0-c' })];
    const { container } = render(<RecentStrip recent={recent} />);
    expect(container.textContent).not.toContain('待繳費');
    expect(container.textContent).not.toContain('已繳費');
  });

  it('shows numeric amount for expense type', () => {
    const recent = [makeTx({ type: 'expense', mealPrice: 150, amount: -150, uid: '0-d' })];
    const { container } = render(<RecentStrip recent={recent} />);
    expect(container.textContent).not.toContain('待繳費');
    expect(container.textContent).not.toContain('已繳費');
  });
});
