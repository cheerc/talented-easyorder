import React, { useMemo } from 'react';
import { useShallow } from 'zustand/shallow';
import { usePosStore } from '../store/posStore';
import { fmt } from './pos-components';
import { useLedgerReport } from '../store/derived/useLedgerReport';

export const TodayDashboard = React.memo(function TodayDashboard({ onClose }: { onClose: () => void }) {
  const { auditEvents, dailySettlements, businessDateStatuses } = usePosStore(
    useShallow((s) => ({ auditEvents: s.auditEvents, dailySettlements: s.dailySettlements, businessDateStatuses: s.businessDateStatuses }))
  );

  const systemDate = useMemo(() => new Date().toISOString().split('T')[0], []);

  const { filtered: todayTx, totals } = useLedgerReport({
    dateRange: 'today',
    viewDate: systemDate,
  });

  const queuedCount = todayTx.filter(t => t.syncStatus === 'queued').length;

  const dateStatus = businessDateStatuses[systemDate] || 'open';

  const todaySettlement = (() => {
    const daySet = dailySettlements.filter(s => s.businessDate === systemDate);
    return daySet.sort((a, b) => b.settlementRevision - a.settlementRevision)[0] ?? null;
  })();

  const correctionCount = auditEvents.filter(e => e.eventType === 'transaction_corrected' && e.businessDate === systemDate).length;

  const voidCount = auditEvents.filter(e => e.eventType === 'transaction_voided' && e.businessDate === systemDate).length;

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
          <div className="db-card db-card-strong">
            <div className="db-card-lbl">交易筆數</div>
            <div className="db-card-num">{totals.transactionCount}</div>
          </div>
          <div className="db-card">
            <div className="db-card-lbl">訂餐數</div>
            <div className="db-card-num">{totals.orderCount}</div>
            <div className="db-card-sub">取消 {totals.cancellationCount} 筆</div>
          </div>
          <div className="db-card db-card-accent">
            <div className="db-card-lbl">收現總計</div>
            <div className="db-card-num">${fmt(totals.cashCollected)}</div>
            <div className="db-card-sub">淨現金 ${fmt(totals.netCash)}</div>
          </div>
          <div className={`db-card ${dateStatus === 'closed' ? 'db-card-ok' : dateStatus === 'reopened' ? 'db-card-warn' : 'db-card-open'}`}>
            <div className="db-card-lbl">關帳狀態</div>
            <div className="db-card-num"><span className={statusClass} style={{ fontSize: '14px' }}>{statusLabel}</span></div>
            {todaySettlement && (
              <div className="db-card-sub">
                {todaySettlement.closedBy} · {todaySettlement.closedAt.slice(11, 19)}
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
            <div className="db-card-sub">作廢 {voidCount} 筆</div>
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
                  <div className="mono dim" style={{ fontSize: '12px' }}>{tx.createdAt.slice(11, 19)}</div>
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
