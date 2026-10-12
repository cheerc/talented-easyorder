import React, { useState, useEffect, useCallback } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { ReasonField } from './ui/ReasonField';
import type { LedgerTransaction } from '../domain/ledger';
import type { LedgerMutationResult } from '../domain/ledgerAudit';

interface CancelOrderDialogProps {
  open: boolean;
  /** 帳戶名稱與目前餘額，用來先說明取消後的影響。 */
  account: { displayName: string; currentBalance: number } | null;
  orderTx: LedgerTransaction | null;
  /** M2：理由必填；回傳失敗（例如已關帳）時對話框留著並顯示原因。 */
  onConfirm: (keepPaymentAsDeposit: boolean, reason: string) => LedgerMutationResult;
  onCancel: () => void;
}

const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n)}`;

export const CancelOrderDialog = React.memo(function CancelOrderDialog({
  open,
  account,
  orderTx,
  onConfirm,
  onCancel,
}: CancelOrderDialogProps) {
  const [keepPaymentAsDeposit, setKeepPaymentAsDeposit] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();

  // 規格 L-TRACE：預設不能自動退現。有收款時預設「收款留在帳戶」，要退現金得自己按 ↑ 或點選。
  useEffect(() => {
    if (open) {
      setKeepPaymentAsDeposit(true);
      setReason('');
      setError(undefined);
    }
  }, [open]);

  const hasPaidAmount = !!(account && orderTx && orderTx.paidAmount > 0);
  const keep = hasPaidAmount && keepPaymentAsDeposit;

  const handleConfirm = useCallback(() => {
    const result = onConfirm(keep, reason);
    if (!result.ok) setError(result.message);
  }, [onConfirm, keep, reason]);

  // Ref: #391 — ↑／↓ 切換退款方式（↑ 退還、↓ 留在帳戶）。Enter 由理由欄處理（輸入法選字的 Enter 不算）。
  useEffect(() => {
    if (!open || !hasPaidAmount) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      // 理由欄用注音選字時 ↑／↓ 是選候選字，不能拿來切換退款方式。
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setKeepPaymentAsDeposit(e.key === 'ArrowDown');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, hasPaidAmount]);

  if (!account || !orderTx) return null;

  // M2：先說清楚對帳戶與櫃台現金的影響。刪掉這筆訂餐，餘額扣回本筆的淨額；保留收款時只退餐費。
  const before = account.currentBalance;
  const after = keep ? before + orderTx.mealPrice : before - orderTx.amount;
  const cashText = !keep && orderTx.paidAmount > 0
    ? `櫃台退還現金 $${orderTx.paidAmount}`
    : '櫃台現金不變';

  return (
    <Modal open={open} title="取消訂餐" onClose={onCancel}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <p style={{ margin: 0, color: 'var(--ink-1)', fontSize: '15px', fontWeight: 500 }}>
          取消 {account.displayName} 的訂餐 — {orderTx.menuNameSnapshot || orderTx.note || '今日便當'}（${orderTx.mealPrice}）
        </p>
        {hasPaidAmount && (
          <>
            <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: '14px', lineHeight: 1.5 }}>
              這筆訂餐同時收了 ${orderTx.paidAmount}，請選擇處理方式（↑／↓ 切換）：
            </p>
            <div role="radiogroup" aria-label="收款處理方式" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '4px 0' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="radio" name="refundMethod" checked={!keepPaymentAsDeposit} onChange={() => setKeepPaymentAsDeposit(false)} />
                <span style={{ color: 'var(--ink-1)', fontSize: '14px' }}>退還這筆收款（現金還給對方）</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input type="radio" name="refundMethod" checked={keepPaymentAsDeposit} onChange={() => setKeepPaymentAsDeposit(true)} />
                <span style={{ color: 'var(--ink-1)', fontSize: '14px' }}>收款留在帳戶（只取消餐費）</span>
              </label>
            </div>
          </>
        )}
        <div className="cancel-impact" aria-live="polite" style={{ padding: '10px 12px', borderRadius: 'var(--r)', background: 'var(--line-2)', fontSize: '14px', lineHeight: 1.6 }}>
          <div>帳戶餘額：{money(before)} → <strong>{money(after)}</strong></div>
          <div>{cashText}</div>
        </div>
        <ReasonField value={reason} onChange={v => { setReason(v); setError(undefined); }} onSubmit={handleConfirm} error={error} autoFocus />
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '4px' }}>
          <Button variant="ghost" onClick={onCancel}>返回</Button>
          <Button variant="danger" onClick={handleConfirm}>確認取消</Button>
        </div>
      </div>
    </Modal>
  );
});
