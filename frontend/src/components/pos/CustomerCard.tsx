import React, { useEffect, useRef } from "react";
import type { StudentAccount } from '../../domain/student';
import type { TodayMenu } from '../../domain/menu';
import type { PosMode } from '../../domain/posFlow';
import { NumericInput } from '../ui/NumericInput';
import { fmt } from './utils';

interface CustomerCardProps {
  student: StudentAccount;
  todayMenu: TodayMenu;
  mode: PosMode;
  orderedTodayCount: number;
  payAmount: string;
  setPayAmount: (val: string) => void;
  onViewHistory?: () => void;
  priceOverride: number | null;
  priceOverrideLabel: string;
  setPriceOverride: (value: number | null) => void;
  setPriceOverrideLabel: (value: string) => void;
  onDeleteOrder?: () => void;
}
export const CustomerCard = React.memo(function CustomerCard({ student, todayMenu, mode, orderedTodayCount, payAmount, setPayAmount, onViewHistory, priceOverride, priceOverrideLabel, setPriceOverride, setPriceOverrideLabel, onDeleteOrder }: CustomerCardProps) {
  const effectiveMealPrice = mode === 'order' ? (priceOverride ?? todayMenu.price) : 0;
  const payInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    payInputRef.current?.focus();
  }, [mode]);

  const parsedPayAmount = Number(payAmount) || 0;
  const projectedBalance = student.currentBalance + parsedPayAmount;

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
          {onViewHistory && (
            <button className="ghost-btn" style={{ marginTop: '6px', fontSize: '11px', padding: '2px 10px' }}
              onClick={onViewHistory}>
              檢視歷史
            </button>
          )}
          {orderedTodayCount > 0 && (
            <div className="bal-debt warn-soft-chip">
              ⚠ 今日已訂過 <b>{orderedTodayCount}</b> 次便當
            </div>
          )}
          {onDeleteOrder && (
            <button className="ghost-btn" style={{ marginTop: '6px', fontSize: '11px', padding: '2px 10px', color: 'var(--c-warn)' }}
              onClick={onDeleteOrder}>
              取消訂餐
            </button>
          )}
        </div>
      </div>

      <div className="action-block">
        <div className="action-grid">
          {/* Left Side: Summary */}
          <div className="bill-summary">
            <div className="pay-title">結帳明細</div>
            {mode === 'order' && (
              <div className="bill-item">
                <span className="bill-label">當日便當 ({priceOverrideLabel || todayMenu.itemName})</span>
                <span className="bill-val neg">−${fmt(effectiveMealPrice)}</span>
              </div>
            )}
            {mode === 'payment' && (
              <>
                <div className="bill-item no-border">
                  <span className="bill-label">目前帳戶餘額</span>
                  <span className={`bill-val${student.currentBalance < 0 ? ' neg' : ''}`}>
                    {student.currentBalance < 0 ? '−' : ''}${fmt(student.currentBalance)}
                  </span>
                </div>
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
              </>
            )}

            {mode === 'order' && (
              <div className="price-override">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setPriceOverride(priceOverride ?? todayMenu.price)}
                >
                  訂購其他餐點
                </button>
                {priceOverride !== null && (
                  <div className="price-override-fields">
                    <label>
                      <span>品項</span>
                      <input
                        className="adm-input"
                        aria-label="品項或原因"
                        value={priceOverrideLabel}
                        onChange={e => setPriceOverrideLabel(e.target.value)}
                        placeholder="例如：雞腿便當"
                      />
                    </label>
                    <label>
                      <span>價格</span>
                      <NumericInput
                        className="adm-input mono"
                        aria-label="價格"
                        value={priceOverride}
                        onChange={v => setPriceOverride(Number(v || todayMenu.price))}
                      />
                    </label>
                    <button type="button" className="ghost-btn" onClick={() => setPriceOverride(null)}>
                      取消
                    </button>
                  </div>
                )}
              </div>
            )}
            {/* §3.1: removed "將產生欠款" warning per UX spec */}
          </div>

          {/* Right Side: Payment Panel */}
          {mode !== 'expense' ? (
            <div className="pay-panel">
              <div className="pay-header">
                <span className="pay-title">
                  {mode === 'order' ? '本次繳費' : '繳費金額'}
                </span>
                {mode === 'order' && <span className="dim" style={{ fontSize: '12px' }}>留空為記帳</span>}
              </div>

              <div className="pay-input-container">
                <span className="pay-input-prefix">$</span>
                <NumericInput
                  ref={payInputRef}
                  className="pay-input-main"
                  aria-label="付款金額"
                  value={payAmount}
                  onChange={setPayAmount}
                  placeholder={mode === 'order' ? "" : "輸入金額"}
                />
                <span className="pay-input-suffix">元</span>
              </div>

              {/* §3.3: removed quick amount buttons from payment mode */}
            </div>
          ) : (
            <div className="cancel-empty">
              <div>支出模式 — 請在下方輸入金額</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
