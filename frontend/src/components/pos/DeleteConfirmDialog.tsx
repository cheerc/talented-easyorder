import React, { useEffect, useCallback } from 'react';

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
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  }, [open, onConfirm, onCancel]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!open) return null;

  const label = TYPE_LABELS[transactionType];

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={`刪除${label}確認`}>
      <div className="modal-box cancel-dialog">
        <h3>刪除{label}紀錄</h3>
        <p>確定要刪除 {studentName} 的{label}紀錄（{amount} 元）嗎？</p>
        <div className="dialog-actions">
          <button className="btn-ghost" onClick={onCancel}>返回</button>
          <button className="btn-danger" onClick={onConfirm}>確認刪除</button>
        </div>
      </div>
    </div>
  );
});
