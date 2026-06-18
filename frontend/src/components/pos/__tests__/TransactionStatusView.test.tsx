import { render, screen } from '@testing-library/react';
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
  it('renders dual-column headers', () => {
    render(<TransactionStatusView transactions={[mockTx()]} />);
    expect(screen.getByText('收入')).toBeInTheDocument();
    expect(screen.getByText('支出')).toBeInTheDocument();
  });

  it('shows expense for order type', () => {
    render(<TransactionStatusView transactions={[mockTx({ type: 'order', mealPrice: 60 })]} />);
    expect(screen.getByText('-60')).toBeInTheDocument();
  });

  it('shows income for payment type', () => {
    render(<TransactionStatusView transactions={[mockTx({ type: 'payment', paidAmount: 300 })]} />);
    expect(screen.getByText('+300')).toBeInTheDocument();
  });

  it('renders type badge', () => {
    render(<TransactionStatusView transactions={[mockTx({ type: 'order' })]} />);
    expect(screen.getByText('訂')).toBeInTheDocument();
  });

  it('renders time from createdAt', () => {
    const txs = [mockTx({ createdAt: '2026-06-18T09:13:41Z' })]
    render(<TransactionStatusView transactions={txs} />);
    const expected = new Date('2026-06-18T09:13:41Z').toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('renders empty state when no transactions', () => {
    render(<TransactionStatusView transactions={[]} />);
    expect(screen.getByText('今日無交易紀錄')).toBeInTheDocument();
  });

  it('renders action buttons when actions provided', () => {
    const action = vi.fn().mockReturnValue(<button>刪除</button>);
    render(<TransactionStatusView transactions={[mockTx()]} actions={action} />);
    expect(action).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 'tx-1' }));
    expect(screen.getByText('刪除')).toBeInTheDocument();
  });
});
