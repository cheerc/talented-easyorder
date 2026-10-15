import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import type { OpeningCashSuggestion } from '../../domain/cashClose';
import { formatMonthDay, formatDiff } from './openingCashConfirmUtils';

export interface OpeningCashConfirmDialogProps {
  open: boolean;
  hasCashSession: boolean;
  draftAmount: number;
  suggestedOpeningCash: OpeningCashSuggestion | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export const OpeningCashConfirmDialog = React.memo(function OpeningCashConfirmDialog({
  open,
  hasCashSession,
  draftAmount,
  suggestedOpeningCash,
  onConfirm,
  onCancel,
}: OpeningCashConfirmDialogProps) {
  const [checked, setChecked] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  // 每次打開對話框時重設勾選狀態為未勾選
  useEffect(() => {
    if (open) {
      setChecked(false);
    }
  }, [open]);

  const isSame = Boolean(suggestedOpeningCash && draftAmount === suggestedOpeningCash.amount);
  const isDifferent = Boolean(suggestedOpeningCash && draftAmount !== suggestedOpeningCash.amount);
  const requiresCheck = isSame;

  const title = hasCashSession ? '修改開帳金額' : '設定開帳金額';
  const confirmLabel = hasCashSession ? '確認修改' : '確認設定';
  const variant = hasCashSession || isDifferent ? 'danger' : 'primary';

  // 鍵盤操作支援：左右鍵切換按鈕，Enter 在未勾選時不得確認
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const buttons = actionsRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
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

      // 焦點在對話框內元素上時
      const active = document.activeElement;
      if (active instanceof HTMLButtonElement && active.closest('[role="dialog"]')) {
        e.preventDefault();
        if (!active.disabled) {
          active.click();
        }
        return;
      }

      e.preventDefault();
      // 若需要清點勾選但尚未勾選，Enter 不得送出
      if (requiresCheck && !checked) {
        return;
      }
      onConfirm();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onConfirm, onCancel, requiresCheck, checked]);

  if (!open) return null;

  const sourceDesc = suggestedOpeningCash
    ? suggestedOpeningCash.source === 'same_day'
      ? '這一天上次關帳用的開帳金額'
      : `前一天（${formatMonthDay(suggestedOpeningCash.fromDate)}）關帳點算`
    : '';

  const diff = suggestedOpeningCash ? draftAmount - suggestedOpeningCash.amount : 0;
  const diffText = formatDiff(diff);

  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <div style={{ color: 'var(--ink-2)', fontSize: '15px', lineHeight: 1.6, marginBottom: '24px' }}>
        {isDifferent && suggestedOpeningCash && (
          <>
            <p style={{ margin: '0 0 12px' }}>
              {hasCashSession
                ? '修改開帳金額會影響今日所有帳務計算，確定要繼續嗎？'
                : `確定要將今日開帳金額設為 $${draftAmount.toLocaleString()} 嗎？`}
            </p>
            <p
              role="alert"
              style={{
                margin: 0,
                color: 'var(--c-warn, #d97706)',
                backgroundColor: 'var(--warn-soft, rgba(217, 119, 6, 0.1))',
                padding: '8px 12px',
                borderRadius: '6px',
                fontWeight: 500,
              }}
            >
              {suggestedOpeningCash.source === 'same_day'
                ? `與這一天上次關帳用的開帳金額 $${suggestedOpeningCash.amount.toLocaleString()} 不同，差 ${diffText}。`
                : `與前一天（${formatMonthDay(suggestedOpeningCash.fromDate)}）關帳點算的 $${suggestedOpeningCash.amount.toLocaleString()} 不同，差 ${diffText}。`}
            </p>
          </>
        )}

        {isSame && suggestedOpeningCash && (
          <>
            {hasCashSession && (
              <p style={{ margin: '0 0 8px', color: 'var(--c-warn, #d97706)', fontWeight: 500 }}>
                修改開帳金額會影響今日所有帳務計算。
              </p>
            )}
            <p style={{ margin: '0 0 16px' }}>
              開帳金額與{sourceDesc}相同（${suggestedOpeningCash.amount.toLocaleString()}）。請確實清點抽屜現金後再按確認。
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
              <input
                type="checkbox"
                id="confirm-counted"
                aria-label="我已實際清點"
                checked={checked}
                onChange={e => setChecked(e.target.checked)}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <label htmlFor="confirm-counted" style={{ fontSize: '15px', color: 'var(--ink)', cursor: 'pointer', fontWeight: 500 }}>
                我已實際清點
              </label>
            </div>
          </>
        )}

        {!suggestedOpeningCash && (
          <p style={{ margin: 0 }}>
            {hasCashSession
              ? `修改開帳金額會影響今日所有帳務計算，確定要將今日開帳金額設為 $${draftAmount.toLocaleString()} 嗎？請確實清點抽屜現金後再按確認。`
              : `確定要將今日開帳金額設為 $${draftAmount.toLocaleString()} 嗎？請確實清點抽屜現金後再按確認。`}
          </p>
        )}
      </div>

      <div ref={actionsRef} style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button
          variant={variant}
          onClick={onConfirm}
          disabled={requiresCheck && !checked}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
});
