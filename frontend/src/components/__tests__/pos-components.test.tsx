import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { RecentStrip, ExpensePanel, SearchBox } from '../pos-components';
import type { StudentAccount } from '../../domain/student';


describe('RecentStrip', () => {
  type MergedTx = import('../../domain/ledger').MergedTransaction & { uid: string };
  const base: Omit<MergedTx, 'uid'> = {
    transactionId: 'tx-1',
    studentId: '001',
    studentNameSnapshot: '王小美',
    type: 'order' as const,
    businessDate: '2026-05-17',
    mealPrice: 90,
    paidAmount: 0,
    amount: -90,
    note: '',
    afterBalance: -90,
    createdAt: '2026-05-17T12:00:00.000Z',
    menuNameSnapshot: '預設菜單',
    vendorNameSnapshot: '預設廠商',
    sourceDevice: 'pc' as const,
    revision: 1,
    syncStatus: 'local' as const,
    depositAmount: 0,
    unpaidAmount: 90,
    orderCount: 1,
    displayBalance: -90,
  };
  const mk = (overrides: Partial<MergedTx>): MergedTx => ({ ...base, uid: overrides.transactionId ? '0-' + overrides.transactionId : '0-tx-1', ...overrides });

  // Edge case 1: order 90, no payment → balance -90 → red
  it('shows 訂 1份 餘額 −90 (red) for unpaid order', () => {
    const { container } = render(<RecentStrip recent={[mk({ displayBalance: -90, orderCount: 1 })]} />);
    expect(container.textContent).toContain('1份');
    expect(container.textContent).toContain('餘額');
    const amt = container.querySelector('.recent-amt');
    expect(amt?.className).toContain('neg');
  });

  // Edge case 2: order 90 + pay 50 → balance -40 → red
  it('shows 訂 1份 餘額 −40 (red) for partial payment', () => {
    const { container } = render(<RecentStrip recent={[mk({ displayBalance: -40, orderCount: 1 })]} />);
    expect(container.textContent).toContain('1份');
    expect(container.textContent).toContain('40');
    const amt = container.querySelector('.recent-amt');
    expect(amt?.className).toContain('neg');
  });

  // Edge case 3: order 90 + pay 90 → balance 0 → green
  it('shows 訂 1份 餘額 0 (green) for fully paid order', () => {
    const { container } = render(<RecentStrip recent={[mk({ displayBalance: 0, orderCount: 1 })]} />);
    expect(container.textContent).toContain('1份');
    expect(container.textContent).toContain('0');
    const amt = container.querySelector('.recent-amt');
    expect(amt?.className).toContain('pos');
  });

  // Edge case 4: order 90 + pay 100 → balance 10 → green
  it('shows 訂 1份 餘額 10 (green) for overpayment', () => {
    const { container } = render(<RecentStrip recent={[mk({ displayBalance: 10, orderCount: 1 })]} />);
    expect(container.textContent).toContain('1份');
    expect(container.textContent).toContain('10');
    const amt = container.querySelector('.recent-amt');
    expect(amt?.className).toContain('pos');
  });

  // Edge case 5: 2 orders + pay 200 → balance 20 → green
  it('shows 訂 2份 餘額 20 (green) for two orders', () => {
    const { container } = render(<RecentStrip recent={[mk({ displayBalance: 20, orderCount: 2 })]} />);
    expect(container.textContent).toContain('2份');
    expect(container.textContent).toContain('20');
    const amt = container.querySelector('.recent-amt');
    expect(amt?.className).toContain('pos');
  });

  // Edge case 6: payment 200 first then order 90 → balance 110 → green
  it('shows 訂 1份 餘額 110 (green) for deposit before order', () => {
    const { container } = render(<RecentStrip recent={[mk({ displayBalance: 110, orderCount: 1 })]} />);
    expect(container.textContent).toContain('1份');
    expect(container.textContent).toContain('110');
    const amt = container.querySelector('.recent-amt');
    expect(amt?.className).toContain('pos');
  });

  // Edge case 7: payment only, no order → should NOT appear
  it('does not show payment-only rows', () => {
    const paymentOnly = mk({ type: 'payment', orderCount: 0, displayBalance: 500, mealPrice: 0, paidAmount: 500, amount: 500 });
    const { container } = render(<RecentStrip recent={[paymentOnly]} />);
    const rows = container.querySelectorAll('.recent-row');
    expect(rows.length).toBe(0);
  });

  // Edge case 8: cashier expense → should NOT appear
  it('does not show cashier expense rows', () => {
    const expenseTx = mk({ type: 'expense', studentId: '__cashier__', studentNameSnapshot: '櫃台', orderCount: 0, displayBalance: 0, note: '文具' });
    const { container } = render(<RecentStrip recent={[expenseTx]} />);
    const rows = container.querySelectorAll('.recent-row');
    expect(rows.length).toBe(0);
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

describe('SearchBox', () => {
  const mockStudents: StudentAccount[] = [
    { studentId: '001', displayName: '王小美', currentBalance: 100, status: 'active' as const, aliases: [], faceEnrollmentStatus: 'none' as const, createdAt: '', updatedAt: '', revision: 1 },
    { studentId: '002', displayName: '李大華', currentBalance: 200, status: 'active' as const, aliases: [], faceEnrollmentStatus: 'none' as const, createdAt: '', updatedAt: '', revision: 1 },
  ];
  const baseProps = {
    value: '001',
    onChange: () => {},
    onSubmit: () => {},
    onEsc: () => {},
    suggestions: [] as StudentAccount[],
    activeIdx: 0,
    onPick: () => {},
    onHover: vi.fn(),
    focusKey: 0,
    disabled: false,
  };

  it('does not call onHover on mouse enter when disableHoverSelection is true', () => {
    const onHover = vi.fn();
    const { container } = render(<SearchBox {...baseProps} suggestions={mockStudents} onHover={onHover} disableHoverSelection={true} />);
    const firstRow = container.querySelector('.sug-row');
    fireEvent.mouseEnter(firstRow!);
    expect(onHover).not.toHaveBeenCalled();
  });

  it('does not call onHover on mouse enter when disableHoverSelection is omitted (default true)', () => {
    const onHover = vi.fn();
    const { container } = render(<SearchBox {...baseProps} suggestions={mockStudents} onHover={onHover} />);
    const firstRow = container.querySelector('.sug-row');
    fireEvent.mouseEnter(firstRow!);
    expect(onHover).not.toHaveBeenCalled();
  });

  it('calls onHover on mouse enter when disableHoverSelection is false', () => {
    const onHover = vi.fn();
    const { container } = render(<SearchBox {...baseProps} suggestions={mockStudents} onHover={onHover} disableHoverSelection={false} />);
    const firstRow = container.querySelector('.sug-row');
    fireEvent.mouseEnter(firstRow!);
    expect(onHover).toHaveBeenCalledWith(0);
  });
});
