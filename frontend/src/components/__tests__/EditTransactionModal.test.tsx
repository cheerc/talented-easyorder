import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { EditTransactionModal } from '../EditTransactionModal';
import type { LedgerTransaction } from '../../domain/ledger';

const baseTx: LedgerTransaction = {
  transactionId: 'tx-1',
  studentId: '001',
  studentNameSnapshot: '王小美',
  type: 'order',
  businessDate: '2026-05-30',
  mealPrice: 90,
  paidAmount: 0,
  amount: -90,
  note: '',
  afterBalance: -90,
  createdAt: '2026-05-30T12:00:00.000Z',
  menuNameSnapshot: '預設菜單',
  vendorNameSnapshot: '預設廠商',
  sourceDevice: 'pc',
  revision: 1,
  syncStatus: 'local',
  depositAmount: 0,
  unpaidAmount: 90,
};

describe('EditTransactionModal', () => {
  it('does not render when transaction is null', () => {
    const { container } = render(
      <EditTransactionModal open transaction={null} onClose={vi.fn()} onSave={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('does not render when open is false', () => {
    const { container } = render(
      <EditTransactionModal open={false} transaction={baseTx} onClose={vi.fn()} onSave={vi.fn()} />
    );
    expect(container.textContent).toBeFalsy();
  });

  it('pre-fills mealPrice from transaction', () => {
    const { getByLabelText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={vi.fn()} />
    );
    const input = getByLabelText('支出金額 (mealPrice)') as HTMLInputElement;
    expect(input.value).toBe('90');
  });

  it('pre-fills paidAmount from transaction', () => {
    const { getByLabelText } = render(
      <EditTransactionModal open transaction={{ ...baseTx, paidAmount: 50 }} onClose={vi.fn()} onSave={vi.fn()} />
    );
    const input = getByLabelText('實收金額 (paidAmount)') as HTMLInputElement;
    expect(input.value).toBe('50');
  });

  it('pre-fills note from transaction', () => {
    const { getByLabelText } = render(
      <EditTransactionModal open transaction={{ ...baseTx, note: 'test note' }} onClose={vi.fn()} onSave={vi.fn()} />
    );
    const input = getByLabelText('備註') as HTMLInputElement;
    expect(input.value).toBe('test note');
  });

  it('updates form fields on prop change (new transaction)', () => {
    const { getByLabelText, rerender } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={vi.fn()} />
    );
    const newTx: LedgerTransaction = { ...baseTx, transactionId: 'tx-2', mealPrice: 120, paidAmount: 100, note: 'changed' };
    rerender(
      <EditTransactionModal open transaction={newTx} onClose={vi.fn()} onSave={vi.fn()} />
    );
    expect((getByLabelText('支出金額 (mealPrice)') as HTMLInputElement).value).toBe('120');
    expect((getByLabelText('實收金額 (paidAmount)') as HTMLInputElement).value).toBe('100');
    expect((getByLabelText('備註') as HTMLInputElement).value).toBe('changed');
  });

  it('calls onSave with transactionId and updates', () => {
    const onSave = vi.fn();
    const { getByText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={onSave} />
    );
    fireEvent.click(getByText('儲存變更'));
    expect(onSave).toHaveBeenCalledWith('tx-1', { mealPrice: 90, paidAmount: 0, note: '' });
  });

  it('calls onClose after save', () => {
    const onClose = vi.fn();
    const { getByText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={onClose} onSave={vi.fn()} />
    );
    fireEvent.click(getByText('儲存變更'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('saves with modified mealPrice and paidAmount', () => {
    const onSave = vi.fn();
    const { getByLabelText, getByText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={onSave} />
    );
    fireEvent.change(getByLabelText('支出金額 (mealPrice)'), { target: { value: '80' } });
    fireEvent.change(getByLabelText('實收金額 (paidAmount)'), { target: { value: '50' } });
    fireEvent.click(getByText('儲存變更'));
    expect(onSave).toHaveBeenCalledWith('tx-1', { mealPrice: 80, paidAmount: 50, note: '' });
  });

  it('saves with mealPrice cleared and re-entered', () => {
    const onSave = vi.fn();
    const { getByLabelText, getByText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={onSave} />
    );
    fireEvent.change(getByLabelText('支出金額 (mealPrice)'), { target: { value: '0' } });
    fireEvent.click(getByText('儲存變更'));
    expect(onSave).toHaveBeenCalledWith('tx-1', { mealPrice: 0, paidAmount: 0, note: '' });
  });

  it('NumericInput blocks non-digit characters in mealPrice', () => {
    const { getByLabelText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={vi.fn()} />
    );
    const input = getByLabelText('支出金額 (mealPrice)') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-5' } });
    expect(input.value).toBe('90');
  });

  it('NumericInput blocks non-digit characters in paidAmount', () => {
    const { getByLabelText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={vi.fn()} />
    );
    const input = getByLabelText('實收金額 (paidAmount)') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1.5' } });
    expect(input.value).toBe('0');
  });

  it('save succeeds with valid modified values (defense check)', () => {
    const onSave = vi.fn();
    const { getByLabelText, getByText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={onSave} />
    );
    fireEvent.change(getByLabelText('支出金額 (mealPrice)'), { target: { value: '100' } });
    fireEvent.change(getByLabelText('實收金額 (paidAmount)'), { target: { value: '100' } });
    fireEvent.click(getByText('儲存變更'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when cancel button clicked', () => {
    const onClose = vi.fn();
    const { getByText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={onClose} onSave={vi.fn()} />
    );
    fireEvent.click(getByText('取消'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('handles zero values', () => {
    const onSave = vi.fn();
    const { getByText } = render(
      <EditTransactionModal open transaction={{ ...baseTx, mealPrice: 0, paidAmount: 0 }} onClose={vi.fn()} onSave={onSave} />
    );
    fireEvent.click(getByText('儲存變更'));
    expect(onSave).toHaveBeenCalledWith('tx-1', { mealPrice: 0, paidAmount: 0, note: '' });
  });

  it('handles empty note', () => {
    const onSave = vi.fn();
    const { getByText } = render(
      <EditTransactionModal open transaction={{ ...baseTx, note: '' }} onClose={vi.fn()} onSave={onSave} />
    );
    fireEvent.click(getByText('儲存變更'));
    expect(onSave).toHaveBeenCalledWith('tx-1', expect.objectContaining({ note: '' }));
  });

  it('handles note with special characters', () => {
    const onSave = vi.fn();
    const { getByLabelText, getByText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={onSave} />
    );
    const input = getByLabelText('備註') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '<script>alert("xss")</script>' } });
    fireEvent.click(getByText('儲存變更'));
    expect(onSave).toHaveBeenCalledWith('tx-1', expect.objectContaining({ note: '<script>alert("xss")</script>' }));
  });

  it('handles large values', () => {
    const onSave = vi.fn();
    const { getByLabelText, getByText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={onSave} />
    );
    fireEvent.change(getByLabelText('支出金額 (mealPrice)'), { target: { value: '9999' } });
    fireEvent.change(getByLabelText('實收金額 (paidAmount)'), { target: { value: '9999' } });
    fireEvent.click(getByText('儲存變更'));
    expect(onSave).toHaveBeenCalledWith('tx-1', { mealPrice: 9999, paidAmount: 9999, note: '' });
  });

  it('re-initializes form when transaction prop changes to different tx', () => {
    const onSave = vi.fn();
    const { getByLabelText, rerender } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={onSave} />
    );
    fireEvent.change(getByLabelText('支出金額 (mealPrice)'), { target: { value: '80' } });
    const newTx: LedgerTransaction = { ...baseTx, transactionId: 'tx-3', mealPrice: 100, paidAmount: 100, note: 'second' };
    rerender(
      <EditTransactionModal open transaction={newTx} onClose={vi.fn()} onSave={onSave} />
    );
    expect((getByLabelText('支出金額 (mealPrice)') as HTMLInputElement).value).toBe('100');
    expect((getByLabelText('實收金額 (paidAmount)') as HTMLInputElement).value).toBe('100');
    expect((getByLabelText('備註') as HTMLInputElement).value).toBe('second');
  });

  it('modal title is correct', () => {
    const { getByText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={vi.fn()} />
    );
    expect(getByText('編輯交易項目')).toBeTruthy();
  });

  it('save button text is correct', () => {
    const { getByText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={vi.fn()} />
    );
    expect(getByText('儲存變更')).toBeTruthy();
  });

  it('cancel button text is correct', () => {
    const { getByText } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={vi.fn()} />
    );
    expect(getByText('取消')).toBeTruthy();
  });

  it('number fields show 元 suffix', () => {
    const { container } = render(
      <EditTransactionModal open transaction={baseTx} onClose={vi.fn()} onSave={vi.fn()} />
    );
    expect(container.textContent).toContain('元');
  });

  it('calls onSave with correct transactionId from the passed transaction', () => {
    const onSave = vi.fn();
    const tx: LedgerTransaction = { ...baseTx, transactionId: 'custom-tx-id-999' };
    const { getByText } = render(
      <EditTransactionModal open transaction={tx} onClose={vi.fn()} onSave={onSave} />
    );
    fireEvent.click(getByText('儲存變更'));
    expect(onSave).toHaveBeenCalledWith('custom-tx-id-999', expect.any(Object));
  });
});
