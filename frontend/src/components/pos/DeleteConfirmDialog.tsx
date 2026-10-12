import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ReasonField } from '../ui/ReasonField';
import type { LedgerMutationResult } from '../../domain/ledgerAudit';

interface DeleteConfirmDialogProps {
  open: boolean;
  studentName: string;
  transactionType: 'payment' | 'expense';
  amount: number;
  /** M2：理由必填；回傳失敗（例如已關帳）時對話框留著並顯示原因。 */
  onConfirm: (reason: string) => LedgerMutationResult;
  onCancel: () => void;
}

const TYPE_LABELS = { payment: '繳費', expense: '支出' } as const;

export const DeleteConfirmDialog = React.memo(function DeleteConfirmDialog({
  open, studentName, transactionType, amount, onConfirm, onCancel,
}: DeleteConfirmDialogProps) {
  const label = TYPE_LABELS[transactionType];
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (open) { setReason(''); setError(undefined); }
  }, [open]);

  const submit = () => {
    const result = onConfirm(reason);
    if (!result.ok) setError(result.message);
  };

  return (
    <Modal open={open} title={`刪除${label}紀錄`} onClose={onCancel}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: '15px', lineHeight: 1.6 }}>
          確定要刪除 {studentName} 的{label}紀錄（{amount} 元）嗎？原單會保留在稽核紀錄裡。
        </p>
        <ReasonField value={reason} onChange={v => { setReason(v); setError(undefined); }} onSubmit={submit} error={error} autoFocus />
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onCancel}>返回</Button>
          <Button variant="danger" onClick={submit}>確認刪除</Button>
        </div>
      </div>
    </Modal>
  );
});
