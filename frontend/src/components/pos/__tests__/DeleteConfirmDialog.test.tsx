import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeleteConfirmDialog } from '../../pos-components';

describe('DeleteConfirmDialog', () => {
  const baseProps = {
    open: true,
    studentName: '王柏翰',
    transactionType: 'payment' as const,
    amount: 500,
    onConfirm: vi.fn(() => ({ ok: true as const })),
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
    const onConfirm = vi.fn(() => ({ ok: true as const }));
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

  it('M2：理由欄自動取得焦點，按 Enter 帶理由送出', () => {
    const onConfirm = vi.fn(() => ({ ok: true as const }));
    render(<DeleteConfirmDialog {...baseProps} onConfirm={onConfirm} />);
    const reason = screen.getByLabelText('理由（必填，會記在稽核紀錄）');
    expect(document.activeElement).toBe(reason);
    fireEvent.change(reason, { target: { value: '重複登記' } });
    fireEvent.keyDown(reason, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledWith('重複登記');
  });

  it('M2：送出失敗時留在對話框並顯示原因', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn(() => ({ ok: false as const, message: '這一天已經關帳' }));
    render(<DeleteConfirmDialog {...baseProps} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('確認刪除'));
    expect(screen.getByRole('alert').textContent).toBe('這一天已經關帳');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('handles Escape key to cancel', () => {
    const onCancel = vi.fn();
    render(<DeleteConfirmDialog {...baseProps} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});
