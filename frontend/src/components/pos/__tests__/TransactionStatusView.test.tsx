import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TransactionStatusView } from '../../pos-components';
import type { LedgerTransaction } from '../../../domain/ledger';

const baseTx: LedgerTransaction = {
  transactionId: 'tx-1',
  businessDate: '2026-06-18',
  createdAt: '2026-06-18T09:13:41Z',
  studentId: 's1',
  studentNameSnapshot: '王柏翰',
  menuNameSnapshot: '排骨便當',
  vendorNameSnapshot: '老王便當',
  type: 'order',
  mealPrice: 90,
  paidAmount: 0,
  amount: -90,
  afterBalance: 410,
  sourceDevice: 'pc',
  syncStatus: 'synced',
  revision: 1,
  note: '',
} as LedgerTransaction;

function mockTx(overrides: Partial<LedgerTransaction> = {}): LedgerTransaction {
  return { ...baseTx, ...overrides };
}

describe('TransactionStatusView (U2a #5)', () => {
  const student = { displayName: '王小明', currentBalance: 150 };

  it('renders title with student displayName and default headers', () => {
    render(<TransactionStatusView transactions={[mockTx()]} student={student} />);
    expect(screen.getByText('王小明 今日付款明細')).toBeInTheDocument();
    expect(screen.getByText('時間')).toBeInTheDocument();
    expect(screen.getByText('項目')).toBeInTheDocument();
    expect(screen.getByText('餐費')).toBeInTheDocument();
    expect(screen.getByText('收款')).toBeInTheDocument();
  });

  it('renders "查看全部紀錄" button when onViewAllHistory provided and handles click', () => {
    const onViewAllHistory = vi.fn();
    render(<TransactionStatusView transactions={[mockTx()]} student={student} onViewAllHistory={onViewAllHistory} />);
    const btn = screen.getByRole('button', { name: '查看全部紀錄' });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onViewAllHistory).toHaveBeenCalledTimes(1);
  });

  it('does not render "查看全部紀錄" button when onViewAllHistory not provided', () => {
    render(<TransactionStatusView transactions={[mockTx()]} student={student} />);
    expect(screen.queryByRole('button', { name: '查看全部紀錄' })).not.toBeInTheDocument();
  });

  it('displays item label for regular today meal order', () => {
    render(<TransactionStatusView transactions={[mockTx({ type: 'order', menuNameSnapshot: '日式豬排' })]} student={student} />);
    expect(screen.getByText('今日餐點：日式豬排')).toBeInTheDocument();
  });

  it('displays fallback to todayMenu when menuNameSnapshot is empty', () => {
    render(
      <TransactionStatusView
        transactions={[mockTx({ type: 'order', menuNameSnapshot: '' })]}
        todayMenu={{ itemName: '今日特餐' }}
        student={student}
      />
    );
    expect(screen.getByText('今日餐點：今日特餐')).toBeInTheDocument();
  });

  it('displays other meal item label when isOtherMealOrder is true', () => {
    render(
      <TransactionStatusView
        transactions={[mockTx({ type: 'order', otherItemName: '雞腿便當' })]}
        student={student}
      />
    );
    expect(screen.getByText('其他餐點：雞腿便當')).toBeInTheDocument();
  });

  it('displays "繳費" for payment transaction', () => {
    const { container } = render(
      <TransactionStatusView
        transactions={[mockTx({ type: 'payment', mealPrice: 0, paidAmount: 500 })]}
        student={student}
      />
    );
    expect(screen.getByText('繳費')).toBeInTheDocument();
    expect(container.querySelector('.tx-status-row .tx-col-meal-price')?.textContent).toBe('—');
    expect(container.querySelector('.tx-status-row .tx-col-paid')?.textContent).toBe('$500');
  });

  it('renders mealPrice and paidAmount correctly for orders', () => {
    const { container } = render(
      <TransactionStatusView
        transactions={[mockTx({ type: 'order', mealPrice: 90, paidAmount: 100 })]}
        student={student}
      />
    );
    expect(container.querySelector('.tx-status-row .tx-col-meal-price')?.textContent).toBe('$90');
    expect(container.querySelector('.tx-status-row .tx-col-paid')?.textContent).toBe('$100');
  });

  it('shows $0 in paidAmount column when order has 0 paidAmount', () => {
    const { container } = render(
      <TransactionStatusView
        transactions={[mockTx({ type: 'order', mealPrice: 90, paidAmount: 0 })]}
        student={student}
      />
    );
    expect(container.querySelector('.tx-status-row .tx-col-meal-price')?.textContent).toBe('$90');
    expect(container.querySelector('.tx-status-row .tx-col-paid')?.textContent).toBe('$0');
  });

  it('renders Taipei time from createdAt', () => {
    const txs = [mockTx({ createdAt: '2026-06-18T09:13:41Z' })];
    render(<TransactionStatusView transactions={txs} student={student} />);
    expect(screen.getByText('17:13:41')).toBeInTheDocument();
  });

  it('renders face tag for face transactions', () => {
    const txs = [mockTx({ sourceDevice: 'ipad_handoff', note: '刷臉訂餐' })];
    render(<TransactionStatusView transactions={txs} student={student} />);
    const tag = screen.getByText('刷臉');
    expect(tag).toBeInTheDocument();
    expect(tag.getAttribute('title')).toBe('刷臉訂餐');
  });

  it('renders empty state when no transactions but still renders title and totals', () => {
    render(<TransactionStatusView transactions={[]} student={student} />);
    expect(screen.getByText('王小明 今日付款明細')).toBeInTheDocument();
    expect(screen.getByText('今日無交易紀錄')).toBeInTheDocument();
    expect(screen.getByText('今日餐費')).toBeInTheDocument();
    expect(screen.getByText('今日收款')).toBeInTheDocument();
    expect(screen.getByText('帳戶餘額')).toBeInTheDocument();
  });

  it('renders bottom totals for meal prices, paid amounts, and current balance', () => {
    const txs = [
      mockTx({ type: 'order', mealPrice: 90, paidAmount: 100 }),
      mockTx({ type: 'order', mealPrice: 110, otherItemName: '雞腿', paidAmount: 0 }),
      mockTx({ type: 'payment', mealPrice: 0, paidAmount: 300 }),
    ];
    render(<TransactionStatusView transactions={txs} student={{ displayName: '小明', currentBalance: -50 }} />);
    // Total meal price: 90 + 110 = 200
    expect(screen.getByText('$200')).toBeInTheDocument();
    // Total paid amount: 100 + 0 + 300 = 400
    expect(screen.getByText('$400')).toBeInTheDocument();
    // Balance: -50 -> −$50
    expect(screen.getByText('−$50')).toBeInTheDocument();
  });

  // Action buttons
  it('renders edit and delete buttons when callbacks provided', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(<TransactionStatusView transactions={[mockTx()]} onEditClick={onEdit} onDeleteClick={onDelete} student={student} />);
    expect(screen.getByLabelText('編輯')).toBeInTheDocument();
    expect(screen.getByLabelText('刪除')).toBeInTheDocument();
  });

  it('calls onEditClick when edit button clicked', () => {
    const onEdit = vi.fn();
    render(<TransactionStatusView transactions={[mockTx()]} onEditClick={onEdit} student={student} />);
    fireEvent.click(screen.getByLabelText('編輯'));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 'tx-1' }));
  });

  it('calls onDeleteClick when delete button clicked', () => {
    const onDelete = vi.fn();
    render(<TransactionStatusView transactions={[mockTx()]} onDeleteClick={onDelete} student={student} />);
    fireEvent.click(screen.getByLabelText('刪除'));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 'tx-1' }));
  });

  it('hides action buttons when locked', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(<TransactionStatusView transactions={[mockTx()]} onEditClick={onEdit} onDeleteClick={onDelete} locked student={student} />);
    expect(screen.queryByLabelText('編輯')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('刪除')).not.toBeInTheDocument();
  });

  // Ref: #423 — header and data rows must always have 5 grid children
  describe('grid children alignment (#423)', () => {
    it('header has exactly 5 grid children', () => {
      const { container } = render(<TransactionStatusView transactions={[mockTx()]} student={student} />);
      const header = container.querySelector('.tx-status-header');
      expect(header?.children.length).toBe(5);
    });

    it('data row has 5 children when action callbacks provided', () => {
      const { container } = render(
        <TransactionStatusView transactions={[mockTx()]} onEditClick={vi.fn()} onDeleteClick={vi.fn()} student={student} />
      );
      const row = container.querySelector('.tx-status-row');
      expect(row?.children.length).toBe(5);
    });

    it('data row has 5 children when locked (action placeholder rendered)', () => {
      const { container } = render(
        <TransactionStatusView transactions={[mockTx()]} onEditClick={vi.fn()} onDeleteClick={vi.fn()} locked student={student} />
      );
      const row = container.querySelector('.tx-status-row');
      expect(row?.children.length).toBe(5);
    });

    it('data row has 5 children when no action callbacks provided', () => {
      const { container } = render(<TransactionStatusView transactions={[mockTx()]} student={student} />);
      const row = container.querySelector('.tx-status-row');
      expect(row?.children.length).toBe(5);
    });
  });
});
