import React from 'react';
import { ConfirmDialog } from '../ui/ConfirmDialog';

interface DeleteConfirmDialogProps {
  open: boolean;
  studentName: string;
  transactionType: 'payment' | 'expense';
  amount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

const TYPE_LABELS = { payment: '繳費', expense: '支出' } as const;

export const DeleteConfirmDialog = React.memo(function DeleteConfirmDialog({
  open, studentName, transactionType, amount, onConfirm, onCancel,
}: DeleteConfirmDialogProps) {
  const label = TYPE_LABELS[transactionType];

  return (
    <ConfirmDialog
      open={open}
      title={`刪除${label}紀錄`}
      message={`確定要刪除 ${studentName} 的${label}紀錄（${amount} 元）嗎？`}
      confirmLabel="確認刪除"
      cancelLabel="返回"
      variant="danger"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
});
