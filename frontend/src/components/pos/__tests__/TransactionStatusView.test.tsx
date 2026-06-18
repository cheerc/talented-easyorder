import { render, screen } from '@testing-library/react';
import { TransactionStatusView } from '../../pos-components';
import type { LedgerTransaction } from '../../../domain/ledger';

// Helper to create mock transactions
function mockTx(overrides: Partial<LedgerTransaction>): LedgerTransaction {
  return {
    transactionId: 'tx-1',
    businessDate: '2026-06-18',
    studentId: 's1',
    studentNameSnapshot: '王柏翰',
    type: 'order',
    mealPrice: 90,
    paidAmount: 0,
    afterBalance: -90,
    menuNameSnapshot: '雞腿便當',
    note: '',
    createdAt: '2026-06-18T09:13:41Z',
    operatorId: 'op1',
    amount: 0,
    vendorNameSnapshot: '',
    sourceDevice: 'pc',
    syncStatus: 'synced',
    revision: 1,
    ...overrides,
  } as LedgerTransaction;
}

describe('TransactionStatusView', () => {
  it('renders column headers 收入 and 支出', () => {
    render(<TransactionStatusView transactions={[]} />);
    expect(screen.getByText('收入')).toBeInTheDocument();
    expect(screen.getByText('支出')).toBeInTheDocument();
  });

  it('renders order-only transaction in 支出 column', () => {
    const txs = [mockTx({ type: 'order', mealPrice: 90, paidAmount: 0 })];
    render(<TransactionStatusView transactions={txs} />);
    // 支出 column shows -90
    expect(screen.getByText('-90')).toBeInTheDocument();
    // 收入 column is empty for this row
    expect(screen.queryByText('+90')).not.toBeInTheDocument();
  });

  it('renders payment transaction in 收入 column', () => {
    const txs = [mockTx({ type: 'payment', mealPrice: 0, paidAmount: 500 })];
    render(<TransactionStatusView transactions={txs} />);
    expect(screen.getByText('+500')).toBeInTheDocument();
  });

  it('renders order with payment in both columns', () => {
    const txs = [mockTx({ type: 'order', mealPrice: 90, paidAmount: 90 })];
    render(<TransactionStatusView transactions={txs} />);
    expect(screen.getByText('+90')).toBeInTheDocument();
    expect(screen.getByText('-90')).toBeInTheDocument();
  });

  it('renders transaction type badge', () => {
    const txs = [mockTx({ type: 'order' })];
    render(<TransactionStatusView transactions={txs} />);
    expect(screen.getByText('訂')).toBeInTheDocument();
  });

  it('renders time from createdAt', () => {
    const txs = [mockTx({ createdAt: '2026-06-18T09:13:41Z' })]
    render(<TransactionStatusView transactions={txs} />);
    // Time formatted via toLocaleTimeString — match the HH:MM portion regardless of timezone
    const expected = new Date('2026-06-18T09:13:41Z').toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('renders empty state when no transactions', () => {
    render(<TransactionStatusView transactions={[]} />);
    expect(screen.getByText('今日無交易紀錄')).toBeInTheDocument();
  });
});
