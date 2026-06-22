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
  // Ref: #402 — dual-column display
  it('renders dual-column headers (收入/支出)', () => {
    render(<TransactionStatusView transactions={[mockTx()]} />);
    expect(screen.getByText('收入')).toBeInTheDocument();
    expect(screen.getByText('支出')).toBeInTheDocument();
  });

  it('shows expense for order type in expense column', () => {
    render(<TransactionStatusView transactions={[mockTx({ type: 'order', mealPrice: 60 })]} />);
    expect(screen.getByText('-60')).toBeInTheDocument();
  });

  it('shows income for payment type in income column', () => {
    render(<TransactionStatusView transactions={[mockTx({ type: 'payment', paidAmount: 300 })]} />);
    expect(screen.getByText('+300')).toBeInTheDocument();
  });

  // Ref: #421 — order with paidAmount > 0 shows both columns
  it('shows both income and expense when order has paidAmount > 0', () => {
    render(<TransactionStatusView transactions={[mockTx({ type: 'order', mealPrice: 60, paidAmount: 100 })]} />);
    expect(screen.getByText('-60')).toBeInTheDocument();
    expect(screen.getByText('+100')).toBeInTheDocument();
  });

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

  it('renders dual-column headers even when empty', () => {
    render(<TransactionStatusView transactions={[]} />);
    expect(screen.getByText('收入')).toBeInTheDocument();
    expect(screen.getByText('支出')).toBeInTheDocument();
  });

  // Ref: #419 — edit/delete buttons
  it('renders edit and delete buttons when callbacks provided', () => {
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

  it('hides edit button for expense type transactions', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(<TransactionStatusView transactions={[mockTx({ type: 'expense', amount: 100 })]} onEditClick={onEdit} onDeleteClick={onDelete} />);
    expect(screen.queryByLabelText('編輯')).not.toBeInTheDocument();
    expect(screen.getByLabelText('刪除')).toBeInTheDocument();
  });

  it('shows expense for expense type in expense column', () => {
    render(<TransactionStatusView transactions={[mockTx({ type: 'expense', amount: 200 })]} />);
    expect(screen.getByText('-200')).toBeInTheDocument();
  });

  // Ref: #423 — header and data rows must always have 5 grid children
  describe('grid children alignment (#423)', () => {
    it('header has exactly 5 grid children', () => {
      const { container } = render(<TransactionStatusView transactions={[mockTx()]} />);
      const header = container.querySelector('.tx-status-header');
      expect(header?.children.length).toBe(5);
    });

    it('data row has 5 children when action callbacks provided', () => {
      const { container } = render(
        <TransactionStatusView transactions={[mockTx()]} onEditClick={vi.fn()} onDeleteClick={vi.fn()} />
      );
      const row = container.querySelector('.tx-status-row');
      expect(row?.children.length).toBe(5);
    });

    it('data row has 5 children when locked (action placeholder rendered)', () => {
      const { container } = render(
        <TransactionStatusView transactions={[mockTx()]} onEditClick={vi.fn()} onDeleteClick={vi.fn()} locked />
      );
      const row = container.querySelector('.tx-status-row');
      expect(row?.children.length).toBe(5);
    });

    it('data row has 5 children when no action callbacks provided', () => {
      const { container } = render(<TransactionStatusView transactions={[mockTx()]} />);
      const row = container.querySelector('.tx-status-row');
      expect(row?.children.length).toBe(5);
    });
  });
});
