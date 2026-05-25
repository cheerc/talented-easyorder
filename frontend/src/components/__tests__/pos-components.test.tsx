import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { RecentStrip, ExpensePanel } from '../pos-components';
import type { LedgerTransaction } from '../../domain/ledger';

describe('RecentStrip', () => {
  const makeTx = (overrides: Partial<import('../../domain/ledger').MergedTransaction> & { uid: string }): (import('../../domain/ledger').MergedTransaction & { uid: string }) => ({
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
    menuNameSnapshot: '預設菜單',
    vendorNameSnapshot: '預設廠商',
    sourceDevice: 'pc' as const,
    revision: 1,
    syncStatus: 'local' as const,
    uid: '0-tx-1',
    depositAmount: 0,
    unpaidAmount: 0,
    ...overrides,
  });

  it('shows 待繳費 for unpaid order', () => {
    const recent = [makeTx({ type: 'order', mealPrice: 90, paidAmount: 0, amount: -90, afterBalance: -90, unpaidAmount: 90, uid: '0-a' })];
    const { container } = render(<RecentStrip recent={recent} />);
    expect(container.textContent).toContain('待繳費');
    expect(container.textContent).toContain('90');
  });

  it('shows 已繳費 for paid order', () => {
    const recent = [makeTx({ type: 'order', mealPrice: 90, paidAmount: 90, amount: 0, afterBalance: 500, unpaidAmount: 0, uid: '0-b' })];
    const { container } = render(<RecentStrip recent={recent} />);
    expect(container.textContent).toContain('已繳費');
    expect(container.textContent).toContain('90');
  });

  it('shows numeric amount for payment type', () => {
    const recent = [makeTx({ type: 'payment', paidAmount: 200, amount: 200, afterBalance: 500, unpaidAmount: 0, uid: '0-c' })];
    const { container } = render(<RecentStrip recent={recent} />);
    expect(container.textContent).not.toContain('待繳費');
    expect(container.textContent).not.toContain('已繳費');
  });

  it('shows formatted note for expense type', () => {
    const recent = [makeTx({ type: 'expense', mealPrice: 150, paidAmount: 0, amount: -150, note: '支付便當', afterBalance: 0, uid: '0-d' })];
    const { container } = render(<RecentStrip recent={recent} />);
    expect(container.textContent).toContain('支');
    expect(container.textContent).toContain('支付便當');
  });

  it('formats income expense with note prefix', () => {
    const recent = [makeTx({ type: 'expense', paidAmount: 300, mealPrice: 0, amount: 300, note: '贊助金', studentId: '__cashier__', studentNameSnapshot: '櫃台', afterBalance: 0, uid: '0-f' })];
    const { container } = render(<RecentStrip recent={recent} />);
    expect(container.textContent).toContain('收');
    expect(container.textContent).toContain('贊助金');
    expect(container.textContent).toContain('300');
  });

  it('hides __cashier__ id in studentId column', () => {
    const recent = [makeTx({ studentId: '__cashier__', studentNameSnapshot: '櫃台', type: 'expense', mealPrice: 100, paidAmount: 0, amount: -100, afterBalance: 0, uid: '0-e' })];
    const { container } = render(<RecentStrip recent={recent} />);
    const idSpan = container.querySelector('.recent-id');
    expect(idSpan?.textContent).toBe('');
    expect(container.textContent).toContain('櫃台');
  });
});

describe('ExpensePanel', () => {
  it('stops propagation of Escape key on note input', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ExpensePanel
        kind="expense_other_note"
        amountText=""
        amount={100}
        onAmountChange={() => {}}
        onAmountConfirm={() => {}}
        onDirectionSelect={() => {}}
        onReasonSelect={() => {}}
        onNoteChange={() => {}}
        onNoteConfirm={() => {}}
        onCancel={onCancel}
      />
    );

    const input = container.querySelector('input');
    expect(input).not.toBeNull();

    const windowListener = vi.fn();
    window.addEventListener('keydown', windowListener);

    const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    input!.dispatchEvent(escEvent);

    expect(onCancel).toHaveBeenCalledOnce();
    expect(windowListener).not.toHaveBeenCalled();

    window.removeEventListener('keydown', windowListener);
  });

  it('stops propagation of Escape key on amount input', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ExpensePanel
        kind="expense_input"
        amountText="100"
        amount={0}
        onAmountChange={() => {}}
        onAmountConfirm={() => {}}
        onDirectionSelect={() => {}}
        onReasonSelect={() => {}}
        onNoteChange={() => {}}
        onNoteConfirm={() => {}}
        onCancel={onCancel}
      />
    );

    const input = container.querySelector('input');
    expect(input).not.toBeNull();

    const windowListener = vi.fn();
    window.addEventListener('keydown', windowListener);

    const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    input!.dispatchEvent(escEvent);

    expect(onCancel).toHaveBeenCalledOnce();
    expect(windowListener).not.toHaveBeenCalled();

    window.removeEventListener('keydown', windowListener);
  });
});
