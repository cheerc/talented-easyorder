import { render, screen, fireEvent } from '@testing-library/react';
import { TransactionStatusView } from '../../pos-components';
import type { LedgerTransaction } from '../../../domain/ledger';

const baseTx: LedgerTransaction = {
  transactionId: 'tx-1',
  businessDate: '2026-06-18',
  createdAt: '2026-06-18T09:13:41Z',
  studentId: 's1',
  studentNameSnapshot: '王柏翰',
  menuNameSnapshot: '',
  vendorNameSnapshot: '',
  type: 'order',
  mealPrice: 60,
  paidAmount: 0,
  amount: 0,
  afterBalance: 440,
  sourceDevice: 'pc',
  syncStatus: 'synced',
  revision: 1,
  note: '',
} as LedgerTransaction;

function mockTx(overrides: Partial<LedgerTransaction> = {}): LedgerTransaction {
  return { ...baseTx, ...overrides };
}

describe('TransactionStatusView', () => {
  it('renders type badge', () => {
    render(<TransactionStatusView transactions={[mockTx({ type: 'order' })]} />);
    expect(screen.getByText('訂')).toBeInTheDocument();
  });

  it('renders time from createdAt', () => {
    const txs = [mockTx({ createdAt: '2026-06-18T09:13:41Z' })];
    render(<TransactionStatusView transactions={txs} />);
    const expected = new Date('2026-06-18T09:13:41Z').toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('renders empty state when no transactions', () => {
    render(<TransactionStatusView transactions={[]} />);
    expect(screen.getByText('今日無交易紀錄')).toBeInTheDocument();
  });

  it('shows right-aligned expense amount for order type', () => {
    const { container } = render(<TransactionStatusView transactions={[mockTx({ type: 'order', mealPrice: 60 })]} />);
    const amountEl = container.querySelector('.tx-amount');
    expect(amountEl?.textContent).toBe('−60');
    expect(amountEl?.className).toContain('neg');
  });

  it('shows right-aligned income amount for payment type', () => {
    const { container } = render(<TransactionStatusView transactions={[mockTx({ type: 'payment', paidAmount: 300 })]} />);
    const amountEl = container.querySelector('.tx-amount');
    expect(amountEl?.textContent).toBe('+300');
    expect(amountEl?.className).toContain('pos');
  });

  it('renders edit and delete buttons when callbacks provided and not locked', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(<TransactionStatusView transactions={[mockTx()]} onEditClick={onEdit} onDeleteClick={onDelete} />);
    expect(screen.getByLabelText('編輯')).toBeInTheDocument();
    expect(screen.getByLabelText('刪除')).toBeInTheDocument();
  });

  it('calls onEditClick when edit button clicked', () => {
    const onEdit = vi.fn();
    render(<TransactionStatusView transactions={[mockTx()]} onEditClick={onEdit} />);
    fireEvent.click(screen.getByLabelText('編輯'));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 'tx-1' }));
  });

  it('calls onDeleteClick when delete button clicked', () => {
    const onDelete = vi.fn();
    render(<TransactionStatusView transactions={[mockTx()]} onDeleteClick={onDelete} />);
    fireEvent.click(screen.getByLabelText('刪除'));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 'tx-1' }));
  });

  it('hides action buttons when locked', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(<TransactionStatusView transactions={[mockTx()]} onEditClick={onEdit} onDeleteClick={onDelete} locked />);
    expect(screen.queryByLabelText('編輯')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('刪除')).not.toBeInTheDocument();
  });
});
