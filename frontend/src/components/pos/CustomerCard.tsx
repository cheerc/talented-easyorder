import React, { useEffect, useRef, useState } from "react";
import type { StudentAccount } from '../../domain/student';
import type { TodayMenu } from '../../domain/menu';
import { isMenuReady } from '../../domain/menu';
import { Button } from '../ui/Button';
import type { PosMode } from '../../domain/posFlow';
import type { LedgerTransaction } from '../../domain/ledger';
import { NumericInput } from '../ui/NumericInput';
import { parsePaidAmount } from '../../domain/posTransaction';
import { TransactionStatusView } from './TransactionStatusView';
import { RefundDialog } from './RefundDialog';
import { fmt } from './utils';
import type { LedgerMutationResult } from '../../domain/ledgerAudit';
import { TriangleAlert } from 'lucide-react';

interface CustomerCardProps {
  student: StudentAccount;
  todayMenu: TodayMenu;
  mode: PosMode;
  orderedTodayCount: number;
  payAmount: string;
  setPayAmount: (val: string) => void;
  priceOverride: number | null;
  priceOverrideLabel: string;
  setPriceOverride: (value: number | null) => void;
  setPriceOverrideLabel: (value: string) => void;

  focusZone?: string;
  studentTransactions?: LedgerTransaction[];
  onEditClick?: (tx: LedgerTransaction) => void;
  onDeleteClick?: (tx: LedgerTransaction) => void;
  onViewAllHistory?: () => void;
  locked?: boolean;
  /** M1：看得到的送出鍵，與 Enter 同一個動作。 */
  onConfirm?: () => void;
  /** M1：看得到的取消鍵，與 Esc 同一個動作。 */
  onCancel?: () => void;
  /** 存檔中：按鈕暫時停用，避免重複送出。 */
  busy?: boolean;
  /**
 * 學生退款回調；寫入失敗時回傳失敗結果，留在對話框顯示原因。
 * 帶 studentId 讓 F1 與 F3 共用同一條 store 路徑（F3 可對未選取的帳戶退款）。
 */
  onRefund?: (studentId: string, amount: number, reason: string) => LedgerMutationResult;
  onRefundDialogOpenChange?: (open: boolean) => void;
}

export const CustomerCard = React.memo(function CustomerCard({
  student,
  todayMenu,
  mode,
  orderedTodayCount,
  payAmount,
  setPayAmount,
  priceOverride,
  priceOverrideLabel,
  setPriceOverride,
  setPriceOverrideLabel,
  focusZone,
  studentTransactions,
  onEditClick,
  onDeleteClick,
  onViewAllHistory,
  locked,
  onConfirm,
  onCancel,
  busy = false,
  onRefund,
  onRefundDialogOpenChange,
}: CustomerCardProps) {
  const [showRefundDialog, setShowRefundDialog] = useState(false);

  const handleOpenRefund = () => {
    setShowRefundDialog(true);
    onRefundDialogOpenChange?.(true);
  };
  const handleCloseRefund = () => {
    setShowRefundDialog(false);
    onRefundDialogOpenChange?.(false);
  };
  const effectiveMealPrice = mode === 'order' ? (priceOverride ?? todayMenu.price) : 0;
  const payInputRef = useRef<HTMLInputElement>(null);
  const otherItemRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusZone === 'other-item' && priceOverride !== null && mode === 'order') otherItemRef.current?.focus();
  }, [focusZone, mode, priceOverride]);
  useEffect(() => {
    if (focusZone?.startsWith('mode-')) {
      payInputRef.current?.focus();
    }
  }, [mode, focusZone]);

  // M1 K07：收款欄不合法（例如負數）時兩種模式都不能送出，並說明原因，不悄悄當成 0。
  const payParse = parsePaidAmount(String(payAmount ?? ''));
  const payError = payParse.ok ? null : payParse.message;
  const parsedPayAmount = payParse.ok ? payParse.value : 0;
  // M1：送出鍵的條件與 Enter 一致：繳費要有正整數金額；訂餐要有當天晚餐。
  // 訂購其他餐點時價格要是正整數（價格欄清空時是 0）。
  const otherPriceMissing = mode === 'order' && priceOverride !== null && !(Number.isSafeInteger(priceOverride) && priceOverride > 0);
  const canConfirm = !payError && (mode === 'payment'
    ? Number.isSafeInteger(parsedPayAmount) && parsedPayAmount > 0
    : mode === 'order' ? isMenuReady(todayMenu) && !otherPriceMissing : false);
  const confirmLabel = mode === 'payment'
    ? '確認收款'
    : orderedTodayCount > 0 ? `再訂一份（今日第 ${orderedTodayCount + 1} 份）` : '確認訂餐';
  const projectedBalance = mode === 'order'
    ? student.currentBalance - effectiveMealPrice + parsedPayAmount
    : student.currentBalance + parsedPayAmount;

  return (
    <div className="card customer">
      <div className="cust-head">
        <div className="cust-id-block">
          <div className="cust-id mono">{student.studentId}</div>
          <div className="cust-grade">學員</div>
        </div>
        <div className="cust-name">{student.displayName}</div>
        <div className="cust-bal">
          <div className="bal-lbl">帳戶餘額</div>
          <div className={'bal-num mono ' + (student.currentBalance < 0 ? 'warn' : student.currentBalance < 90 ? 'low' : '')}>
            {student.currentBalance < 0 ? '−' : ''}${fmt(student.currentBalance)}
          </div>
          {orderedTodayCount > 0 && (
            <div className="bal-debt warn-soft-chip">
              <TriangleAlert size={16} aria-hidden="true" /> 今天已訂 <b>{orderedTodayCount}</b> 份餐點
            </div>
          )}

        </div>
      </div>

      <div className="action-block">
        <div className="action-grid">
          {/* Left Side: Summary — Ref: #423 full-width for view-status */}
          <div className={`bill-summary${focusZone === 'view-status' ? ' full-width' : ''}`}>
            {focusZone === 'view-status' ? (
              <TransactionStatusView
                student={student}
                todayMenu={todayMenu}
                transactions={studentTransactions ?? []}
                onEditClick={onEditClick}
                onDeleteClick={onDeleteClick}
                onViewAllHistory={onViewAllHistory}
                locked={locked}
              />
            ) : (mode === 'order' || mode === 'payment') ? (<>
            <div className="pay-title">結帳明細</div>
            {/* Shared bill items for order & payment modes only — expense mode must NOT render bill items */}
            <div className="bill-item no-border">
              <span className="bill-label">目前帳戶餘額</span>
              <span className={`bill-val${student.currentBalance < 0 ? ' neg' : ''}`}>
                {student.currentBalance < 0 ? '−' : ''}${fmt(student.currentBalance)}
              </span>
            </div>
            {mode === 'order' && (
              <div className="bill-item no-border">
                <span className="bill-label">今日餐點 ({(priceOverride !== null && priceOverrideLabel) || todayMenu.itemName})</span>
                <span className="bill-val neg">−${fmt(effectiveMealPrice)}</span>
              </div>
            )}
            <div className="bill-item no-border">
              <span className="bill-label">此次繳費金額</span>
              <span className="bill-val pos">
                +${fmt(parsedPayAmount)}
              </span>
            </div>
            <div className="bill-divider" />
            <div className="bill-item bill-total">
              <span className="bill-label">預計結帳後餘額</span>
              <span className={`bill-val${projectedBalance < 0 ? ' neg' : ''}`}>
                {projectedBalance < 0 ? '−' : ''}${fmt(projectedBalance)}
              </span>
            </div>

            {mode === 'order' && (
              <div className="price-override">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setPriceOverride(priceOverride ?? todayMenu.price)}
                >
                  訂購其他餐點<span aria-hidden="true">（R）</span>
                </button>
                {priceOverride !== null && (
                  <div className="price-override-fields">
                    <label>
                      <span>品項</span>
                      <input
                        className="adm-input"
                        ref={otherItemRef}
                        data-other-meal-item
                        aria-label="品項或原因"
                        value={priceOverrideLabel}
                        onChange={e => setPriceOverrideLabel(e.target.value)}
                        placeholder="例如：雞腿餐點"
                      />
                    </label>
                    <label>
                      <span>價格</span>
                      <NumericInput
                        className="adm-input mono"
                        aria-label="價格"
                        value={priceOverride === 0 ? '' : priceOverride ?? ''}
                        // 清空時先存 0（送出前會擋），不再立刻跳回今日餐點的價格；以前倒退鍵刪掉 90 再打 110 會變成 90110。
                        onChange={v => setPriceOverride(v === '' ? 0 : Number(v))}
                      />
                    </label>
                    <button type="button" className="ghost-btn" onClick={() => { setPriceOverride(null); setPriceOverrideLabel(''); }}>
                      取消其他餐點
                    </button>
                  </div>
                )}
              </div>
            )}
            {/* §3.1: removed "將產生欠款" warning per UX spec */}
            </>)
            : null /* expense mode: no bill items when not in expense flow */}
          </div>

          {/* Right Side: Payment Panel */}
          {focusZone !== 'view-status' && mode !== 'expense' ? (
            <div className="pay-panel">
              <div className="pay-header">
                <span className="pay-title">
                  {mode === 'order' ? '本次繳費' : '繳費金額'}
                </span>
                {mode === 'order' && <span className="dim" style={{ fontSize: '12px' }}>留空為記帳</span>}
                {mode === 'payment' && !locked && (
                  <button
                    type="button"
                    className="ghost-btn"
                    style={{ fontSize: '13px', padding: '4px 10px', marginLeft: 'auto' }}
                    onClick={handleOpenRefund}
                    disabled={student.currentBalance <= 0}
                    title={student.currentBalance <= 0 ? '目前無餘額可退' : '從帳戶退還現金給學生'}
                  >
                    退款
                  </button>
                )}
              </div>

              <div className="pay-input-container">
                <span className="pay-input-prefix">$</span>
                <NumericInput
                  ref={payInputRef}
                  allowOtherMealShortcut
                  className="pay-input-main"
                  aria-label="付款金額"
                  value={payAmount}
                  onChange={setPayAmount}
                  keepMinusSign
                  aria-invalid={payError ? true : undefined}
                  placeholder=""
                />
                <span className="pay-input-suffix">元</span>
              </div>

              {/* §3.3: removed quick amount buttons from payment mode */}
              {onConfirm && onCancel && !locked && (
                <div className="pay-actions">
                  <Button variant="primary" size="lg" onClick={onConfirm} disabled={busy || !canConfirm}>
                    {confirmLabel} <span className="kbd kbd-light">↵</span>
                  </Button>
                  <Button variant="ghost" onClick={onCancel} disabled={busy}>
                    取消 <span className="kbd">Esc</span>
                  </Button>
                </div>
              )}
              {onConfirm && !locked && !canConfirm && (
                <div className="pay-actions-hint">
                  {payError ?? (mode === 'payment' ? '請先輸入收款金額。' : otherPriceMissing ? '請輸入其他餐點的價格。' : '這天還沒設定晚餐，不能訂餐；可以按 W 改成只繳費。')}
                </div>
              )}
            </div>
          ) : focusZone !== 'view-status' ? (
            <div className="cancel-empty">
              <div>支出模式 — 請在下方輸入金額</div>
            </div>
          ) : null}
        </div>
      </div>
      {showRefundDialog && onRefund && (
        <RefundDialog
          open={showRefundDialog}
          student={student}
          onConfirm={(amt, reason) => {
            const result = onRefund(student.studentId, amt, reason);
            if (result.ok) handleCloseRefund();
            return result;
          }}
          onCancel={handleCloseRefund}
          busy={busy}
        />
      )}
    </div>
  );
});
