import { fmt } from '../pos-components';
import type { LedgerTotals } from '../../domain/ledgerReport';

interface ReportSummaryStatsProps {
  totals: LedgerTotals;
  itemName: string;
}

export function ReportSummaryStats({ totals, itemName }: ReportSummaryStatsProps) {
  return (
    <div className="rpt-stats">
      <div className="stat stat-strong">
        <div className="stat-lbl">訂餐</div>
        <div className="stat-num mono">{totals.orderCount}<span className="stat-of"> 份</span></div>
        <div className="stat-sub">{itemName}</div>
      </div>
      <div className="stat">
        <div className="stat-lbl">訂餐金額</div>
        <div className="stat-num mono">${fmt(totals.orderSalesAmount)}</div>
      </div>
      <div className="stat">
        <div className="stat-lbl">收現總額</div>
        <div className="stat-num mono accent">+${fmt(totals.cashCollected)}</div>
      </div>
      <div className="stat">
        <div className="stat-lbl">退款</div>
        <div className="stat-num mono warn">${fmt(totals.refundAmount)}</div>
      </div>
      <div className="stat">
        <div className="stat-lbl">淨現金</div>
        <div className="stat-num mono">${fmt(totals.netCash)}</div>
      </div>
      <div className="stat">
        <div className="stat-lbl">新增欠款</div>
        <div className="stat-num mono warn">${fmt(totals.newDebt)}</div>
      </div>
      <div className="stat">
        <div className="stat-lbl">儲值</div>
        <div className="stat-num mono accent">${fmt(totals.topUpAmount)}</div>
      </div>
      <div className="stat">
        <div className="stat-lbl">取消</div>
        <div className="stat-num mono">{totals.cancellationCount}</div>
      </div>
      <div className="stat">
        <div className="stat-lbl">總交易</div>
        <div className="stat-num mono">{totals.transactionCount}</div>
      </div>
    </div>
  );
}