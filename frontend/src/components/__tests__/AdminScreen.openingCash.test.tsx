import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../hooks/useFirebase', () => ({
  useFirebase: () => ({ fb: null, fbError: null, access: { ok: false, reason: 'signed_out' } }),
}));

import { AdminScreen } from '../screens/AdminScreen';
import { usePosStore } from '../../store/posStore';

describe('AdminScreen Opening Cash Validation and Confirmation', () => {
  beforeEach(() => {
    usePosStore.getState().loadSampleData();
  });

  it('rejects values greater than 20,000 and displays error without opening dialog', () => {
    render(<AdminScreen viewDate="2026-10-15" />);

    const input = screen.getByLabelText('開帳金額');
    const saveBtn = screen.getByRole('button', { name: '儲存開帳金額' });

    fireEvent.change(input, { target: { value: '25000' } });
    fireEvent.click(saveBtn);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('開帳金額異常，請確認是否輸入錯誤');

    // Dialog should not be opened
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('rejects negative or decimal values and displays error without opening dialog', () => {
    render(<AdminScreen viewDate="2026-10-15" />);

    const input = screen.getByLabelText('開帳金額');
    const saveBtn = screen.getByRole('button', { name: '儲存開帳金額' });

    fireEvent.change(input, { target: { value: '-100' } });
    fireEvent.click(saveBtn);

    expect(screen.getByRole('alert').textContent).toBe('開帳金額必須是 0 或正整數');
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.change(input, { target: { value: '100.5' } });
    fireEvent.click(saveBtn);

    expect(screen.getByRole('alert').textContent).toBe('開帳金額必須是 0 或正整數');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('clears error message when input value changes', () => {
    render(<AdminScreen viewDate="2026-10-15" />);

    const input = screen.getByLabelText('開帳金額');
    const saveBtn = screen.getByRole('button', { name: '儲存開帳金額' });

    fireEvent.change(input, { target: { value: '30000' } });
    fireEvent.click(saveBtn);
    expect(screen.getByRole('alert').textContent).toBe('開帳金額異常，請確認是否輸入錯誤');

    // Changing the input clears the error
    fireEvent.change(input, { target: { value: '3000' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('opens confirmation dialog on valid input and saves on confirm', () => {
    render(<AdminScreen viewDate="2026-10-15" />);

    const input = screen.getByLabelText('開帳金額');
    const saveBtn = screen.getByRole('button', { name: '儲存開帳金額' });

    fireEvent.change(input, { target: { value: '3500' } });
    fireEvent.click(saveBtn);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();

    const confirmBtn = screen.getByRole('button', { name: /確認設定|確認修改/ });
    fireEvent.click(confirmBtn);

    // Dialog closes and success message shows
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('已儲存')).toBeTruthy();
  });

  it('cancels confirmation dialog without saving', () => {
    render(<AdminScreen viewDate="2026-10-15" />);

    const input = screen.getByLabelText('開帳金額');
    const saveBtn = screen.getByRole('button', { name: '儲存開帳金額' });

    fireEvent.change(input, { target: { value: '3500' } });
    fireEvent.click(saveBtn);

    expect(screen.getByRole('dialog')).toBeTruthy();

    const cancelBtn = screen.getByRole('button', { name: '取消' });
    fireEvent.click(cancelBtn);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('已儲存')).toBeNull();
  });
});
