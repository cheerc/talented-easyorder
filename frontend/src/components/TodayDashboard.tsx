import React, { useMemo } from 'react';
import { useSession } from '../store/selectors';
import { fmt } from './pos-components';
import { useLedgerReport } from '../store/derived/useLedgerReport';
import { formatTaipeiTime } from '../utils/dateTime';
import { operatorLabel } from '../domain/operatorId';
import { latestSettlement } from '../domain/cashClose';

// systemDate 由 App 傳入（練習模式下為練習營業日），不在這裡自行取實際日期。
export const TodayDashboard = React.memo(function TodayDashboard({ systemDate, onClose }: { systemDate: string; onClose: () => void }) {
  const { auditEvents, dailySettlements, businessDateStatuses } = useSession();

  const { filtered: todayTx, totals } = useLedgerReport({
    dateRange: 'today',
    viewDate: systemDate,
  });

  const queuedCount = todayTx.filter(t => t.syncStatus === 'queued').length;

  const dateStatus = businessDateStatuses[systemDate] || 'open';

  // M3：同一天取最後一版（先比重開／關帳時間再比版次），和結帳歷史、關帳面板用同一個判斷。
  // 舊資料重開後再關帳的版次都是 1，只比版次會取到重開那一列的人和時間。
  const todaySettlement = latestSettlement(systemDate, dailySettlements) ?? null;

  // M2：更正與刪除各自計數（稽核事件只有 transaction_edited 與 transaction_deleted／transaction_hard_deleted）。
  const correctionCount = auditEvents.filter(e => e.eventType === 'transaction_edited' && e.businessDate === systemDate).length;

  const deleteCount = auditEvents.filter(e =>
    (e.eventType === 'transaction_deleted' || e.eventType === 'transaction_hard_deleted') && e.businessDate === systemDate,
  ).length;

  const latest5 = useMemo(() => {
    return [...todayTx].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  }, [todayTx]);

  const statusLabel = dateStatus === 'closed' ? '已關帳' : dateStatus === 'reopened' ? '已重開' : '營業中';
  const statusClass = dateStatus === 'closed' ? 'pill-ok' : dateStatus === 'reopened' ? 'pill-warn' : 'pill';

  return (
    <div className="db-overlay" onClick={onClose}>
      <div className="db-panel" onClick={e => e.stopPropagation()}>
        <div className="db-head">
          <div>
            <div className="db-title">今日營運概覽</div>
            <div className="db-date mono">{systemDate}</div>
          </div>
          <button className="db-close" onClick={onClose}>✕</button>
        </div>

        <div className="db-grid">
          {/* M2 F08：名稱與口徑和今日帳（F2）的卡片一致。 */}
          <div className="db-card db-card-strong">
            <div className="db-card-lbl">筆數</div>
            <div className="db-card-num">{totals.transactionCount}</div>
            <div className="db-card-sub">含未付款訂餐</div>
          </div>
          <div className="db-card">
            <div className="db-card-lbl">份數</div>
            <div className="db-card-num">{totals.orderCount}</div>
            <div className="db-card-sub">餐費 ${fmt(totals.mealTotal)}</div>
          </div>
          <div className="db-card db-card-accent">
            <div className="db-card-lbl">收現</div>
            <div className="db-card-num">${fmt(totals.totalIncome)}</div>
            <div className="db-card-sub">淨現金 ${fmt(totals.netCash)}</div>
          </div>
          <div className={`db-card ${dateStatus === 'closed' ? 'db-card-ok' : dateStatus === 'reopened' ? 'db-card-warn' : 'db-card-open'}`}>
            <div className="db-card-lbl">關帳狀態</div>
            <div className="db-card-num"><span className={statusClass} style={{ fontSize: '14px' }}>{statusLabel}</span></div>
            {todaySettlement && (
              <div className="db-card-sub">
                {todaySettlement.status === 'reopened' && todaySettlement.reopenedAt
                  ? `重開：${operatorLabel(todaySettlement.reopenedBy ?? '')} · ${formatTaipeiTime(todaySettlement.reopenedAt)}`
                  : `${operatorLabel(todaySettlement.closedBy)} · ${formatTaipeiTime(todaySettlement.closedAt)}`}
              </div>
            )}
          </div>
          <div className={`db-card ${queuedCount > 0 ? 'db-card-warn' : 'db-card-ok'}`}>
            <div className="db-card-lbl">待同步</div>
            <div className="db-card-num">{queuedCount}</div>
            <div className="db-card-sub">{queuedCount > 0 ? '尚有資料未同步' : '已全數同步'}</div>
          </div>
          <div className="db-card">
            <div className="db-card-lbl">今日更正</div>
            <div className="db-card-num">{correctionCount}</div>
            <div className="db-card-sub">刪除 {deleteCount} 筆</div>
          </div>
        </div>

        <div className="db-section">
          <div className="db-section-h">最近 5 筆交易</div>
          {latest5.length === 0 ? (
            <div className="rpt-empty" style={{ padding: '20px' }}>今日尚無交易紀錄</div>
          ) : (
            <div className="db-tx-list">
              {latest5.map(tx => (
                <div key={tx.transactionId} className="db-tx-row">
                  <div className="mono dim" style={{ fontSize: '12px' }}>{formatTaipeiTime(tx.createdAt)}</div>
                  <div>{tx.studentNameSnapshot}</div>
                  <div><span className={`pill pill-${tx.type}`}>{tx.type}</span></div>
                  <div className={`mono ${tx.amount >= 0 ? 'accent' : 'warn'}`} style={{ textAlign: 'right' }}>
                    {tx.amount >= 0 ? '+' : ''}{fmt(tx.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
