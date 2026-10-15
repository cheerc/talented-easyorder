import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RefundDialog } from '../RefundDialog';
import type { StudentAccount } from '../../../domain/student';

const mockStudent: StudentAccount = {
  studentId: '007',
  displayName: '林小華',
  status: 'active',
  currentBalance: 350,
  aliases: [],
  faceEnrollmentStatus: 'none',
  createdAt: '2026-05-01T08:00:00.000Z',
  updatedAt: '2026-05-01T08:00:00.000Z',
  revision: 1,
};

describe('RefundDialog', () => {
  it('renders student info, prefilled balance, and preset reasons', () => {
    render(
      <RefundDialog
        open={true}
        student={mockStudent}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('退款給學生')).toBeTruthy();
    expect(screen.getAllByText('林小華').length).toBeGreaterThan(0);
    expect(screen.getByText('#007')).toBeTruthy();
    expect(screen.getAllByText('$350').length).toBeGreaterThan(0);

    const amountInput = screen.getByLabelText('退款金額') as HTMLInputElement;
    expect(amountInput.value).toBe('350');

    expect(screen.getByText('結清離班')).toBeTruthy();
    expect(screen.getByText('溢繳退還')).toBeTruthy();
  });

  it('validates amount: rejects 0, negative, and amounts exceeding current balance', () => {
    render(
      <RefundDialog
        open={true}
        student={mockStudent}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const amountInput = screen.getByLabelText('退款金額');
    const reasonInput = screen.getByLabelText('退款理由');
    const confirmBtn = screen.getByRole('button', { name: '確認退款' });

    // With reason filled but amount > 350
    fireEvent.change(reasonInput, { target: { value: '結清離班' } });
    fireEvent.change(amountInput, { target: { value: '500' } });
    expect(confirmBtn.hasAttribute('disabled')).toBe(true);

    // With amount = 0
    fireEvent.change(amountInput, { target: { value: '0' } });
    expect(confirmBtn.hasAttribute('disabled')).toBe(true);

    // With amount negative
    fireEvent.change(amountInput, { target: { value: '-50' } });
    expect(confirmBtn.hasAttribute('disabled')).toBe(true);

    // Valid amount
    fireEvent.change(amountInput, { target: { value: '100' } });
    expect(confirmBtn.hasAttribute('disabled')).toBe(false);
  });

  it('validates reason: requires non-empty reason', () => {
    render(
      <RefundDialog
        open={true}
        student={mockStudent}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const confirmBtn = screen.getByRole('button', { name: '確認退款' });
    expect(confirmBtn.hasAttribute('disabled')).toBe(true);

    // Click preset reason
    fireEvent.click(screen.getByRole('button', { name: '結清離班' }));
    expect(confirmBtn.hasAttribute('disabled')).toBe(false);
  });

  it('displays confirmation prompt with correct refund amount and remaining balance', () => {
    render(
      <RefundDialog
        open={true}
        student={mockStudent}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const amountInput = screen.getByLabelText('退款金額');
    fireEvent.change(amountInput, { target: { value: '150' } });

    expect(screen.getByText(/確定從/)).toBeTruthy();
    expect(screen.getByText(/現金嗎？退款後餘額/)).toBeTruthy();
    expect(screen.getByText('$150')).toBeTruthy();
    expect(screen.getByText('$200')).toBeTruthy();
  });

  it('submits on confirm and passes parsed amount and trimmed reason', () => {
    const onConfirm = vi.fn();

    render(
      <RefundDialog
        open={true}
        student={mockStudent}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('退款金額'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('退款理由'), { target: { value: '  畢業結清  ' } });

    fireEvent.click(screen.getByRole('button', { name: '確認退款' }));

    expect(onConfirm).toHaveBeenCalledWith(200, '畢業結清');
  });

  it('cancels on cancel button click', () => {
    const onCancel = vi.fn();

    render(
      <RefundDialog
        open={true}
        student={mockStudent}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
