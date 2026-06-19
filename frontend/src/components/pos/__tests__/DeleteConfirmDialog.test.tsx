import { render, screen, fireEvent } from '@testing-library/react';
import { DeleteConfirmDialog } from '../../pos-components';

describe('DeleteConfirmDialog', () => {
  const baseProps = {
    open: true,
    studentName: '王柏翰',
    transactionType: 'payment' as const,
    amount: 500,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('renders confirmation message with student name', () => {
    render(<DeleteConfirmDialog {...baseProps} />);
    expect(screen.getByText(/王柏翰/)).toBeInTheDocument();
  });

  it('shows payment-specific message for payment type', () => {
    render(<DeleteConfirmDialog {...baseProps} transactionType="payment" />);
    expect(screen.getAllByText(/繳費/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows expense-specific message for expense type', () => {
    render(<DeleteConfirmDialog {...baseProps} transactionType="expense" />);
    expect(screen.getAllByText(/支出/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows amount in message', () => {
    render(<DeleteConfirmDialog {...baseProps} amount={500} />);
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn();
    render(<DeleteConfirmDialog {...baseProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText('確認刪除'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('calls onCancel when cancel button clicked', () => {
    const onCancel = vi.fn();
    render(<DeleteConfirmDialog {...baseProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('返回'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('does not render when open is false', () => {
    render(<DeleteConfirmDialog {...baseProps} open={false} />);
    expect(screen.queryByText(/王柏翰/)).not.toBeInTheDocument();
  });

  it('handles Enter key to confirm', () => {
    const onConfirm = vi.fn();
    render(<DeleteConfirmDialog {...baseProps} onConfirm={onConfirm} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalled();
  });

  it('handles Escape key to cancel', () => {
    const onCancel = vi.fn();
    render(<DeleteConfirmDialog {...baseProps} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});
