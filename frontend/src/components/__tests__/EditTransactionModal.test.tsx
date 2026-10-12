import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { EditTransactionModal } from '../EditTransactionModal';
import type { TransactionEditView } from '../../domain/ledger';
import type { LedgerMutationResult } from '../../domain/ledgerAudit';

const OK: LedgerMutationResult = { ok: true };

const baseTx: TransactionEditView = {
  transactionId: 'tx-1',
  mealPrice: 90,
  paidAmount: 0,
  note: '',
};

describe('EditTransactionModal', () => {
  it('does not render when transaction is null', () => {
    const { container } = render(
      <EditTransactionModal open transaction={null} onClose={vi.fn()} onSave={vi.fn(() => OK)} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('does not render when open is false', () => {
    const { container } = render(
      <EditTransactionModal open={false} transaction={baseTx} onClose={vi.fn()} onSave={vi.fn(() => OK)} />
    );
    expect(container.textContent).toBeFalsy();
  });

  it('pre-fills mealPrice from transaction', () => {
    const { getByLabelText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={vi.fn(() => OK)} />
    );
    const input = getByLabelText('應收金額（餐費或支出）') as HTMLInputElement;
    expect(input.value).toBe('90');
  });

  it('pre-fills paidAmount from transaction', () => {
    const { getByLabelText } = render(
      <EditTransactionModal open transaction={{ ...baseTx, paidAmount: 50 }} onClose={vi.fn()} onSave={vi.fn(() => OK)} />
    );
    const input = getByLabelText('實收金額') as HTMLInputElement;
    expect(input.value).toBe('50');
  });

  it('pre-fills note from transaction', () => {
    const { getByLabelText } = render(
      <EditTransactionModal open transaction={{ ...baseTx, note: 'test note' }} onClose={vi.fn()} onSave={vi.fn(() => OK)} />
    );
    const input = getByLabelText('備註') as HTMLInputElement;
    expect(input.value).toBe('test note');
  });

  it('updates form fields on prop change (new transaction)', () => {
    const { getByLabelText, rerender } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={vi.fn(() => OK)} />
    );
    const newTx: TransactionEditView = { ...baseTx, transactionId: 'tx-2', mealPrice: 120, paidAmount: 100, note: 'changed' };
    rerender(
      <EditTransactionModal open transaction={newTx} onClose={vi.fn()} onSave={vi.fn(() => OK)} />
    );
    expect((getByLabelText('應收金額（餐費或支出）') as HTMLInputElement).value).toBe('120');
    expect((getByLabelText('實收金額') as HTMLInputElement).value).toBe('100');
    expect((getByLabelText('備註') as HTMLInputElement).value).toBe('changed');
  });

  it('calls onSave with transactionId and updates', () => {
    const onSave = vi.fn(() => OK);
    const { getByText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={onSave} />
    );
    fireEvent.click(getByText('儲存變更'));
    expect(onSave).toHaveBeenCalledWith('tx-1', { mealPrice: 90, paidAmount: 0, note: '' }, '');
  });

  it('calls onClose after save', () => {
    const onClose = vi.fn();
    const { getByText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={onClose} onSave={vi.fn(() => OK)} />
    );
    fireEvent.click(getByText('儲存變更'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('saves with modified mealPrice and paidAmount', () => {
    const onSave = vi.fn(() => OK);
    const { getByLabelText, getByText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={onSave} />
    );
    fireEvent.change(getByLabelText('應收金額（餐費或支出）'), { target: { value: '80' } });
    fireEvent.change(getByLabelText('實收金額'), { target: { value: '50' } });
    fireEvent.click(getByText('儲存變更'));
    expect(onSave).toHaveBeenCalledWith('tx-1', { mealPrice: 80, paidAmount: 50, note: '' }, '');
  });

  it('saves with mealPrice cleared and re-entered', () => {
    const onSave = vi.fn(() => OK);
    const { getByLabelText, getByText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={onSave} />
    );
    fireEvent.change(getByLabelText('應收金額（餐費或支出）'), { target: { value: '0' } });
    fireEvent.click(getByText('儲存變更'));
    expect(onSave).toHaveBeenCalledWith('tx-1', { mealPrice: 0, paidAmount: 0, note: '' }, '');
  });

  it('NumericInput blocks non-digit characters in mealPrice', () => {
    const { getByLabelText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={vi.fn(() => OK)} />
    );
    const input = getByLabelText('應收金額（餐費或支出）') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-5' } });
    expect(input.value).toBe('90');
  });

  it('NumericInput blocks non-digit characters in paidAmount', () => {
    const { getByLabelText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={vi.fn(() => OK)} />
    );
    const input = getByLabelText('實收金額') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1.5' } });
    expect(input.value).toBe('0');
  });

  it('save succeeds with valid modified values (defense check)', () => {
    const onSave = vi.fn(() => OK);
    const { getByLabelText, getByText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={onSave} />
    );
    fireEvent.change(getByLabelText('應收金額（餐費或支出）'), { target: { value: '100' } });
    fireEvent.change(getByLabelText('實收金額'), { target: { value: '100' } });
    fireEvent.click(getByText('儲存變更'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when cancel button clicked', () => {
    const onClose = vi.fn();
    const { getByText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={onClose} onSave={vi.fn(() => OK)} />
    );
    fireEvent.click(getByText('取消'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('handles zero values', () => {
    const onSave = vi.fn(() => OK);
    const { getByText } = render(
      <EditTransactionModal open transaction={{ ...baseTx, mealPrice: 0, paidAmount: 0 }} onClose={vi.fn()} onSave={onSave} />
    );
    fireEvent.click(getByText('儲存變更'));
    expect(onSave).toHaveBeenCalledWith('tx-1', { mealPrice: 0, paidAmount: 0, note: '' }, '');
  });

  it('handles empty note', () => {
    const onSave = vi.fn(() => OK);
    const { getByText } = render(
      <EditTransactionModal open transaction={{ ...baseTx, note: '' }} onClose={vi.fn()} onSave={onSave} />
    );
    fireEvent.click(getByText('儲存變更'));
    expect(onSave).toHaveBeenCalledWith('tx-1', expect.objectContaining({ note: '' }), '');
  });

  it('handles note with special characters', () => {
    const onSave = vi.fn(() => OK);
    const { getByLabelText, getByText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={onSave} />
    );
    const input = getByLabelText('備註') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '<script>alert("xss")</script>' } });
    fireEvent.click(getByText('儲存變更'));
    expect(onSave).toHaveBeenCalledWith('tx-1', expect.objectContaining({ note: '<script>alert("xss")</script>' }), '');
  });

  it('handles large values', () => {
    const onSave = vi.fn(() => OK);
    const { getByLabelText, getByText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={onSave} />
    );
    fireEvent.change(getByLabelText('應收金額（餐費或支出）'), { target: { value: '9999' } });
    fireEvent.change(getByLabelText('實收金額'), { target: { value: '9999' } });
    fireEvent.click(getByText('儲存變更'));
    expect(onSave).toHaveBeenCalledWith('tx-1', { mealPrice: 9999, paidAmount: 9999, note: '' }, '');
  });

  it('re-initializes form when transaction prop changes to different tx', () => {
    const onSave = vi.fn(() => OK);
    const { getByLabelText, rerender } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={onSave} />
    );
    fireEvent.change(getByLabelText('應收金額（餐費或支出）'), { target: { value: '80' } });
    const newTx: TransactionEditView = { ...baseTx, transactionId: 'tx-3', mealPrice: 100, paidAmount: 100, note: 'second' };
    rerender(
      <EditTransactionModal open transaction={newTx} onClose={vi.fn()} onSave={onSave} />
    );
    expect((getByLabelText('應收金額（餐費或支出）') as HTMLInputElement).value).toBe('100');
    expect((getByLabelText('實收金額') as HTMLInputElement).value).toBe('100');
    expect((getByLabelText('備註') as HTMLInputElement).value).toBe('second');
  });

  it('modal title is correct', () => {
    const { getByText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={vi.fn(() => OK)} />
    );
    expect(getByText('更正交易')).toBeTruthy();
  });

  it('save button text is correct', () => {
    const { getByText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={vi.fn(() => OK)} />
    );
    expect(getByText('儲存變更')).toBeTruthy();
  });

  it('cancel button text is correct', () => {
    const { getByText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={vi.fn(() => OK)} />
    );
    expect(getByText('取消')).toBeTruthy();
  });

  it('number fields show 元 suffix', () => {
    const { container } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={vi.fn(() => OK)} />
    );
    expect(container.textContent).toContain('元');
  });

  it('calls onSave with correct transactionId from the passed transaction', () => {
    const onSave = vi.fn(() => OK);
    const tx: TransactionEditView = { ...baseTx, transactionId: 'custom-tx-id-999' };
    const { getByText } = render(
      <EditTransactionModal open transaction={tx} onClose={vi.fn()} onSave={onSave} />
    );
    fireEvent.click(getByText('儲存變更'));
    expect(onSave).toHaveBeenCalledWith('custom-tx-id-999', expect.any(Object), '');
  });

  it('M2：把理由一起交給 onSave', () => {
    const onSave = vi.fn(() => OK);
    const { getByText, getByLabelText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={onSave} />
    );
    fireEvent.change(getByLabelText('理由（必填，會記在稽核紀錄）'), { target: { value: '收款打錯' } });
    fireEvent.click(getByText('儲存變更'));
    expect(onSave).toHaveBeenCalledWith('tx-1', { mealPrice: 90, paidAmount: 0, note: '' }, '收款打錯');
  });

  it('M2：儲存失敗（缺理由、已關帳）時視窗不關，顯示原因', () => {
    const onClose = vi.fn();
    const onSave = vi.fn((): LedgerMutationResult => ({ ok: false, message: '請填寫理由。' }));
    const { getByText, getByRole } = render(
      <EditTransactionModal open transaction={baseTx} onClose={onClose} onSave={onSave} />
    );
    fireEvent.click(getByText('儲存變更'));
    expect(onClose).not.toHaveBeenCalled();
    expect(getByRole('alert').textContent).toBe('請填寫理由。');
  });
});
