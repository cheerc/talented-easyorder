import React, { useState, useEffect, useCallback } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import type { StudentAccount } from '../domain/student';
import type { LedgerTransaction } from '../domain/ledger';

interface CancelOrderDialogProps {
  open: boolean;
  picked: StudentAccount | null;
  orderTx: LedgerTransaction | null;
  onConfirm: (keepPaymentAsDeposit: boolean) => void;
  onCancel: () => void;
}

export const CancelOrderDialog = React.memo(function CancelOrderDialog({
  open,
  picked,
  orderTx,
  onConfirm,
  onCancel,
}: CancelOrderDialogProps) {
  const [keepPaymentAsDeposit, setKeepPaymentAsDeposit] = useState(false);

  useEffect(() => {
    if (open) {
      setKeepPaymentAsDeposit(false);
    }
  }, [open]);

  const hasPaidAmount = !!(picked && orderTx && orderTx.paidAmount > 0);

  const handleConfirm = useCallback(() => {
    onConfirm(hasPaidAmount ? keepPaymentAsDeposit : false);
  }, [onConfirm, hasPaidAmount, keepPaymentAsDeposit]);

  // Ref: #391 — keyboard nav for refund option radios + Enter confirm
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' && hasPaidAmount) {
        e.preventDefault();
        setKeepPaymentAsDeposit(true);
        return;
      }
      if (e.key === 'ArrowUp' && hasPaidAmount) {
        e.preventDefault();
        setKeepPaymentAsDeposit(false);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        handleConfirm();
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hasPaidAmount, handleConfirm]);


  if (!picked) return null;

  return (
    <Modal open={open} title="取消訂餐" onClose={onCancel}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {hasPaidAmount ? (
          <>
            <p style={{ margin: 0, color: 'var(--ink-1)', fontSize: '15px', fontWeight: 500 }}>
              取消訂餐 — {orderTx.note || '今日便當'}
            </p>
            <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: '14px', lineHeight: 1.5 }}>
              本次訂餐含繳費 ${orderTx.paidAmount}，請選擇處理方式：
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px 0' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="refundMethod"
                  checked={!keepPaymentAsDeposit}
                  onChange={() => setKeepPaymentAsDeposit(false)}
                />
                <span style={{ color: 'var(--ink-1)', fontSize: '14px' }}>
                  退還現金（餘額恢復至訂餐前）
                </span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="refundMethod"
                  checked={keepPaymentAsDeposit}
                  onChange={() => setKeepPaymentAsDeposit(true)}
                />
                <span style={{ color: 'var(--ink-1)', fontSize: '14px' }}>
                  保留至帳戶餘額（取消便當但繳費保留）
                </span>
              </label>
            </div>
          </>
        ) : (
          <p style={{ margin: '0 0 8px', color: 'var(--ink-2)', fontSize: '15px', lineHeight: 1.6 }}>
            確定要取消 {picked.displayName} 的訂餐嗎？
          </p>
        )}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' }}>
          <Button variant="ghost" onClick={onCancel}>
            返回
          </Button>
          <Button variant="danger" onClick={handleConfirm}>
            確認取消
          </Button>
        </div>
      </div>
    </Modal>
  );
});
