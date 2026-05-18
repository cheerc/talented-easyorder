import { fmt } from '../pos-components';
import type { LedgerTotals } from '../../domain/ledgerReport';

interface CounterCashFlow {
  incomeCount: number;
  incomeAmount: number;
  expenseCount: number;
  expenseAmount: number;
}

interface ReportSummaryStatsProps {
  totals: LedgerTotals;
  itemName: string;
  counterCashFlow?: CounterCashFlow;
}

export function ReportSummaryStats({ totals, itemName, counterCashFlow }: ReportSummaryStatsProps) {
  return (
    <div className="rpt-stats">
      <div className="stat stat-strong">
        <div className="stat-lbl">訂餐</div>
        <div className="stat-num mono">{totals.orderCount}<span className="stat-of"> 份</span></div>
        <div className="stat-sub">{itemName}</div>
      </div>
      <div className="stat">
        <div className="stat-lbl">總收入</div>
        <div className="stat-num mono accent">+${fmt(totals.totalIncome)}</div>
      </div>
      <div className="stat">
        <div className="stat-lbl">總支出</div>
        <div className="stat-num mono warn">−${fmt(totals.totalExpense)}</div>
      </div>
      <div className="stat">
        <div className="stat-lbl">淨現金</div>
        <div className="stat-num mono">${fmt(totals.netCash)}</div>
      </div>
      {counterCashFlow && (counterCashFlow.incomeCount > 0 || counterCashFlow.expenseCount > 0) && (
        <>
          <div className="stat">
            <div className="stat-lbl">櫃台收入</div>
            <div className="stat-num mono accent">${fmt(counterCashFlow.incomeAmount)}<span className="stat-of"> ({counterCashFlow.incomeCount}筆)</span></div>
          </div>
          <div className="stat">
            <div className="stat-lbl">櫃台支出</div>
            <div className="stat-num mono warn">−${fmt(counterCashFlow.expenseAmount)}<span className="stat-of"> ({counterCashFlow.expenseCount}筆)</span></div>
          </div>
        </>
      )}
      <div className="stat">
        <div className="stat-lbl">新增欠款</div>
        <div className="stat-num mono warn">${fmt(totals.newDebt)}</div>
      </div>
      <div className="stat">
        <div className="stat-lbl">總交易</div>
        <div className="stat-num mono">{totals.transactionCount}</div>
      </div>
    </div>
  );
}