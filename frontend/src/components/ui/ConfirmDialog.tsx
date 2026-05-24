import React, { useEffect } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

type ConfirmVariant = 'primary' | 'danger';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
}

export const ConfirmDialog = React.memo(function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = '確認',
  cancelLabel = '取消',
  variant = 'primary',
}: ConfirmDialogProps) {
  // Enter key confirm handler — stopImmediatePropagation to prevent global shortcuts
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onConfirm]);

  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <p style={{ margin: '0 0 24px', color: 'var(--ink-2)', fontSize: '15px', lineHeight: 1.6 }}>
        {message}
      </p>
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button variant={variant} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
});
