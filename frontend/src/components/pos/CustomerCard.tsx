import React, { useEffect, useRef, useState, useMemo } from "react";
import type { StudentAccount } from '../../domain/student';
import type { TodayMenu } from '../../domain/menu';
import type { PosMode } from '../../domain/posFlow';
import type { LedgerTransaction } from '../../domain/ledger';
import { NumericInput } from '../ui/NumericInput';
import { TransactionStatusView } from './TransactionStatusView';
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

  focusZone?: string;
  studentTransactions?: LedgerTransaction[];
  onEditClick?: (tx: LedgerTransaction) => void;
  onDeleteClick?: (tx: LedgerTransaction) => void;
  locked?: boolean;
  allStudentTransactions?: LedgerTransaction[];
  onViewHistoryBack?: () => void;
}
// Ref: #423 — weekly pagination helper
function getWeekRange(offset: number): { start: string; end: string; label: string } {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  // Calculate Monday of current week
  const mondayDiff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayDiff + offset * 7);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(monday), end: fmt(sunday), label: `${fmt(monday)} ~ ${fmt(sunday)}` };
}

// Ref: #423 — weekly history sub-component (weekOffset is internal; reset via key={studentId})
function WeeklyHistoryView({ allStudentTransactions, onViewHistoryBack }: {
  allStudentTransactions?: LedgerTransaction[];
  onViewHistoryBack?: () => void;
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const { start, end, label } = getWeekRange(weekOffset);
  const weekTxs = useMemo(() => {
    if (!allStudentTransactions) return [];
    return allStudentTransactions.filter(tx => tx.businessDate >= start && tx.businessDate <= end);
  }, [allStudentTransactions, start, end]);

  // Group by businessDate
  const grouped = useMemo(() => {
    const map = new Map<string, LedgerTransaction[]>();
    for (const tx of weekTxs) {
      const arr = map.get(tx.businessDate) ?? [];
      arr.push(tx);
      map.set(tx.businessDate, arr);
    }
    return Array.from(map.entries());
  }, [weekTxs]);

  return (
    <div className="tx-history-view">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div className="pay-title">交易歷史</div>
        <button className="ghost-btn" onClick={onViewHistoryBack} style={{ fontSize: '13px' }}>返回</button>
      </div>
      <div className="tx-week-nav">
        <button className="ghost-btn" onClick={() => setWeekOffset(weekOffset - 1)} aria-label="上一週">&lt;</button>
        <span className="tx-week-label">{label}</span>
        <button className="ghost-btn" onClick={() => setWeekOffset(weekOffset + 1)} aria-label="下一週" disabled={weekOffset >= 0}>&gt;</button>
      </div>
      {grouped.length > 0 ? (
        grouped.map(([date, txs]) => (
          <div key={date} className="tx-history-date-group">
            <div className="tx-history-date-label">{date}</div>
            <TransactionStatusView transactions={txs} />
          </div>
        ))
      ) : (
        <div className="tx-status-empty">本週無交易紀錄</div>
      )}
    </div>
  );
}

export const CustomerCard = React.memo(function CustomerCard({ student, todayMenu, mode, orderedTodayCount, payAmount, setPayAmount, onViewHistory, priceOverride, priceOverrideLabel, setPriceOverride, setPriceOverrideLabel, focusZone, studentTransactions, onEditClick, onDeleteClick, locked, allStudentTransactions, onViewHistoryBack }: CustomerCardProps) {
  const effectiveMealPrice = mode === 'order' ? (priceOverride ?? todayMenu.price) : 0;
  const payInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusZone?.startsWith('mode-')) {
      payInputRef.current?.focus();
    }
  }, [mode, focusZone]);

  const parsedPayAmount = Number(payAmount) || 0;
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

        </div>
      </div>

      <div className="action-block">
        <div className="action-grid">
          {/* Left Side: Summary — Ref: #423 full-width for view-status/view-history */}
          <div className={`bill-summary${focusZone === 'view-status' || focusZone === 'view-history' ? ' full-width' : ''}`}>
            {focusZone === 'view-history' ? (
              <WeeklyHistoryView
                key={student.studentId}
                allStudentTransactions={allStudentTransactions}
                onViewHistoryBack={onViewHistoryBack}
              />
            ) : focusZone === 'view-status' ? (
              <TransactionStatusView
                transactions={studentTransactions ?? []}
                onEditClick={onEditClick}
                onDeleteClick={onDeleteClick}
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
                <span className="bill-label">今日便當 ({priceOverrideLabel || todayMenu.itemName})</span>
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
            </>)
            : null /* expense mode: no bill items when not in expense flow */}
          </div>

          {/* Right Side: Payment Panel */}
          {focusZone !== 'view-status' && focusZone !== 'view-history' && mode !== 'expense' ? (
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
                  placeholder=""
                />
                <span className="pay-input-suffix">元</span>
              </div>

              {/* §3.3: removed quick amount buttons from payment mode */}
            </div>
          ) : focusZone !== 'view-status' && focusZone !== 'view-history' ? (
            <div className="cancel-empty">
              <div>支出模式 — 請在下方輸入金額</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});
