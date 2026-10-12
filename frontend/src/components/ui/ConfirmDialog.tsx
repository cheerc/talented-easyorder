import React, { useEffect, useRef } from 'react';
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
  /**
   * M1 K08：焦點不在對話框按鈕上時，Enter 做哪一個動作。
   * 'cancel' 會讓取消鍵取得初始焦點，要確認必須先 Tab／→ 移到確認鍵或用滑鼠按。
   */
  defaultAction?: 'confirm' | 'cancel';
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
  defaultAction = 'confirm',
}: ConfirmDialogProps) {
  const actionsRef = useRef<HTMLDivElement>(null);

  // M1 K08：對話框開著時由它獨占 Enter。用 capture 階段搶在全域快捷鍵（window bubble）之前，
  // 避免同一次 Enter 同時被背景流程與對話框各處理一次。
  // 長按產生的重複 Enter、輸入法選字中的 Enter 一律吞掉，不能連續穿過確認。
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // 左右鍵在「取消／確認」兩顆鍵之間移動，不讓背景切換模式。
        const buttons = actionsRef.current?.querySelectorAll<HTMLButtonElement>('button');
        if (!buttons || buttons.length < 2) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        buttons[e.key === 'ArrowLeft' ? 0 : buttons.length - 1].focus();
        return;
      }
      if (e.key !== 'Enter') return;
      e.stopImmediatePropagation();
      if (e.repeat || e.isComposing || e.keyCode === 229) {
        e.preventDefault();
        return;
      }
      // 焦點在對話框內的按鈕上：交給瀏覽器原生的按鈕行為，Enter 按哪顆就是哪顆。
      const active = document.activeElement;
      if (active instanceof HTMLButtonElement && active.closest('[role="dialog"]')) return;
      e.preventDefault();
      if (defaultAction === 'cancel') onCancel();
      else onConfirm();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onConfirm, onCancel, defaultAction]);

  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <p style={{ margin: '0 0 24px', color: 'var(--ink-2)', fontSize: '15px', lineHeight: 1.6 }}>
        {message}
      </p>
      <div ref={actionsRef} style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onCancel} autoFocus={defaultAction === 'cancel'}>
          {cancelLabel}
        </Button>
        <Button variant={variant} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
});
