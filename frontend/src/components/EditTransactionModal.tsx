import React, { useState, useEffect } from 'react';
import { Modal } from './ui/Modal';
import { NumberField } from './ui/NumberField';
import { TextField } from './ui/TextField';
import { Button } from './ui/Button';
import type { LedgerTransaction } from '../domain/ledger';

interface EditTransactionModalProps {
  open: boolean;
  transaction: LedgerTransaction | null;
  onClose: () => void;
  onSave: (transactionId: string, updates: { mealPrice: number; paidAmount: number; note: string }) => void;
}

export const EditTransactionModal = React.memo(function EditTransactionModal({
  open,
  transaction,
  onClose,
  onSave,
}: EditTransactionModalProps) {
  const [mealPrice, setMealPrice] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (transaction) {
      setMealPrice(transaction.mealPrice);
      setPaidAmount(transaction.paidAmount);
      setNote(transaction.note || '');
      setErrors({});
    }
  }, [transaction]);

  if (!transaction) return null;

  const handleSave = () => {
    const nextErrors: Record<string, string> = {};
    if (!Number.isInteger(mealPrice) || mealPrice < 0) {
      nextErrors.mealPrice = '金額必須為正整數';
    }
    if (!Number.isInteger(paidAmount) || paidAmount < 0) {
      nextErrors.paidAmount = '實收金額必須為正整數';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    onSave(transaction.transactionId, { mealPrice, paidAmount, note });
    onClose();
  };

  return (
    <Modal open={open} title="編輯交易項目" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <NumberField
          label="支出金額 (mealPrice)"
          value={mealPrice}
          onChange={setMealPrice}
          error={errors.mealPrice}
          suffix="元"
        />
        <NumberField
          label="實收金額 (paidAmount)"
          value={paidAmount}
          onChange={setPaidAmount}
          error={errors.paidAmount}
          suffix="元"
        />
        <TextField
          label="備註"
          value={note}
          onChange={setNote}
          placeholder="例如：單筆改價或備註說明"
        />
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '12px' }}>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={handleSave}>儲存變更</Button>
        </div>
      </div>
    </Modal>
  );
});
