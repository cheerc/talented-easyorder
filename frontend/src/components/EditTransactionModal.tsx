import React, { useState, useEffect } from 'react';
import { Modal } from './ui/Modal';
import { NumberField } from './ui/NumberField';
import { TextField } from './ui/TextField';
import { Button } from './ui/Button';
import { ReasonField } from './ui/ReasonField';
import type { TransactionEditView } from '../domain/ledger';
import type { LedgerMutationResult } from '../domain/ledgerAudit';

interface EditTransactionModalProps {
  open: boolean;
  transaction: TransactionEditView | null;
  onClose: () => void;
  /** M2：理由必填；回傳失敗（例如已關帳）時視窗留著並顯示原因。 */
  onSave: (transactionId: string, updates: { mealPrice: number; paidAmount: number; amount?: number; note: string }, reason: string) => LedgerMutationResult;
}

export const EditTransactionModal = React.memo(function EditTransactionModal({
  open,
  transaction,
  onClose,
  onSave,
}: EditTransactionModalProps) {
  const isRefund = transaction?.type === 'refund';
  const [mealPrice, setMealPrice] = useState(0);
  const [paidAmount, setPaidAmount] = useState(0);
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (transaction) {
      setMealPrice(transaction.mealPrice);
      setPaidAmount(transaction.paidAmount);
      setAmount(transaction.amount ?? 0);
      setNote(transaction.note || '');
      setReason('');
      setErrors({});
    }
  }, [transaction]);

  if (!transaction) return null;

  const handleSave = () => {
    const nextErrors: Record<string, string> = {};
    if (isRefund) {
      if (!Number.isInteger(amount) || amount <= 0) {
        nextErrors.amount = '退款金額必須是大於 0 的整數';
      }
    } else {
      if (!Number.isInteger(mealPrice) || mealPrice < 0) {
        nextErrors.mealPrice = '金額必須是 0 或正整數';
      }
      if (!Number.isInteger(paidAmount) || paidAmount < 0) {
        nextErrors.paidAmount = '實收金額必須是 0 或正整數';
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const updates = isRefund
      ? { mealPrice: 0, paidAmount: 0, amount, note }
      : { mealPrice, paidAmount, note };

    const result = onSave(transaction.transactionId, updates, reason);
    if (!result.ok) {
      setErrors({ reason: result.message });
      return;
    }
    onClose();
  };

  return (
    <Modal open={open} title={isRefund ? "更正退款" : "更正交易"} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {isRefund ? (
          <NumberField
            label="退款金額"
            value={amount}
            onChange={setAmount}
            error={errors.amount}
            suffix="元"
          />
        ) : (
          <>
            <NumberField
              label="應收金額（餐費或支出）"
              value={mealPrice}
              onChange={setMealPrice}
              error={errors.mealPrice}
              suffix="元"
            />
            <NumberField
              label="實收金額"
              value={paidAmount}
              onChange={setPaidAmount}
              error={errors.paidAmount}
              suffix="元"
            />
          </>
        )}
        <TextField
          label="備註"
          value={note}
          onChange={setNote}
          placeholder="例如：單筆改價或備註說明"
        />
        <ReasonField
          value={reason}
          onChange={v => { setReason(v); setErrors(prev => { const next = { ...prev }; delete next.reason; return next; }); }}
          onSubmit={handleSave}
          error={errors.reason}
        />
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '12px' }}>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={handleSave}>儲存變更</Button>
        </div>
      </div>
    </Modal>
  );
});
