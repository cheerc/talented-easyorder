import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { NumericInput } from '../ui/NumericInput';
import { fmt } from '../pos-components';
import type { StudentAccount } from '../../domain/student';

export interface RefundDialogProps {
  open: boolean;
  student: StudentAccount;
  onConfirm: (amount: number, reason: string) => void;
  onCancel: () => void;
  busy?: boolean;
}

export const RefundDialog = React.memo(function RefundDialog({
  open,
  student,
  onConfirm,
  onCancel,
  busy = false,
}: RefundDialogProps) {
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  // 當對話框開啟時，預設金額為目前全部正餘額，清空理由與錯誤
  useEffect(() => {
    if (open) {
      setAmountText(String(Math.max(0, student.currentBalance)));
      setReason('');
      setError(null);
    }
  }, [open, student.currentBalance]);

  const numAmount = Number(amountText);
  const isPositiveInt = Number.isInteger(numAmount) && numAmount > 0;
  const isWithinBalance = isPositiveInt && numAmount <= student.currentBalance;
  const hasReason = reason.trim().length > 0;

  let validationMsg: string | null = null;
  if (!amountText.trim()) {
    validationMsg = '請輸入退款金額';
  } else if (!isPositiveInt) {
    validationMsg = '退款金額必須是大於 0 的整數';
  } else if (!isWithinBalance) {
    validationMsg = `退款金額不能超過目前餘額（$${fmt(student.currentBalance)}）`;
  } else if (!hasReason) {
    validationMsg = '請填寫退款理由';
  }

  const canSubmit = isWithinBalance && hasReason && !busy;
  const remainingBalance = student.currentBalance - (isPositiveInt ? numAmount : 0);

  const handleConfirm = () => {
    if (!canSubmit) {
      setError(validationMsg);
      return;
    }
    onConfirm(numAmount, reason.trim());
  };

  if (!open) return null;

  return (
    <Modal open={open} title="退款給學生" onClose={onCancel}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', color: 'var(--ink-2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--bg)', borderRadius: '8px' }}>
          <div>
            <span style={{ fontWeight: 600, color: 'var(--ink)', fontSize: '16px' }}>{student.displayName}</span>
            <span className="mono" style={{ marginLeft: '8px', color: 'var(--ink-3)', fontSize: '13px' }}>#{student.studentId}</span>
          </div>
          <div>
            <span style={{ fontSize: '13px' }}>目前餘額 </span>
            <span className="mono" style={{ fontWeight: 600, color: 'var(--ink)', fontSize: '16px' }}>${fmt(student.currentBalance)}</span>
          </div>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500, color: 'var(--ink)' }}>
            退款金額 (元)
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <NumericInput
              className="adm-input mono"
              aria-label="退款金額"
              value={amountText}
              onChange={val => {
                setAmountText(val);
                setError(null);
              }}
              style={{ width: '100%', fontSize: '16px' }}
              autoFocus
            />
            {student.currentBalance > 0 && (
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  setAmountText(String(student.currentBalance));
                  setError(null);
                }}
                style={{ flexShrink: 0, padding: '0 12px' }}
              >
                全額
              </button>
            )}
          </div>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: 500, color: 'var(--ink)' }}>
            退款理由（必填）
          </label>
          <input
            className="adm-input"
            aria-label="退款理由"
            value={reason}
            onChange={e => {
              setReason(e.target.value);
              setError(null);
            }}
            placeholder="例如：結清離班、溢繳退還"
            style={{ width: '100%', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
            {['結清離班', '溢繳退還', '取消課程'].map(preset => (
              <button
                key={preset}
                type="button"
                className="ghost-btn"
                style={{ fontSize: '12px', padding: '2px 8px' }}
                onClick={() => {
                  setReason(preset);
                  setError(null);
                }}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {isWithinBalance && (
          <div style={{ padding: '10px 12px', background: 'var(--accent-soft, rgba(0, 0, 0, 0.04))', borderRadius: '6px', fontSize: '14px', lineHeight: 1.5, color: 'var(--ink)' }}>
            確定從 <b>{student.displayName}</b> 的帳戶退還 <b>${fmt(numAmount)}</b> 現金嗎？退款後餘額 <b>${fmt(remainingBalance)}</b>
          </div>
        )}

        {(error || (amountText.trim() && validationMsg && !canSubmit)) && (
          <div role="alert" style={{ color: 'var(--c-warn, #d97706)', fontSize: '13px' }}>
            {error || validationMsg}
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' }}>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            取消
          </Button>
          <Button variant="danger" onClick={handleConfirm} disabled={!canSubmit}>
            確認退款
          </Button>
        </div>
      </div>
    </Modal>
  );
});
