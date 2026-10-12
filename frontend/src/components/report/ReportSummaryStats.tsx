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
  // M2 F08：卡片名稱對應 LedgerTotals 的口徑，公式寫在副標，櫃台不用猜數字怎麼來的。
  return (
    <div className="rpt-stats">
      <div className="stat stat-strong">
        <div className="stat-lbl">份數</div>
        <div className="stat-num mono">{totals.orderCount}<span className="stat-of"> 份</span></div>
        <div className="stat-sub">{itemName}</div>
      </div>
      <div className="stat">
        <div className="stat-lbl">餐費</div>
        <div className="stat-num mono">${fmt(totals.mealTotal)}</div>
        <div className="stat-sub">訂餐當下未收 ${fmt(totals.orderUnpaid)}</div>
      </div>
      <div className="stat">
        <div className="stat-lbl">收現</div>
        <div className="stat-num mono accent">+${fmt(totals.totalIncome)}</div>
        <div className="stat-sub">訂餐收款＋繳費＋櫃台收入</div>
      </div>
      <div className="stat">
        <div className="stat-lbl">支出</div>
        <div className="stat-num mono warn">−${fmt(totals.totalExpense)}</div>
        <div className="stat-sub">櫃台付出的現金</div>
      </div>
      <div className="stat">
        <div className="stat-lbl">淨現金</div>
        <div className="stat-num mono">${fmt(totals.netCash)}</div>
        <div className="stat-sub">收現 − 支出</div>
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
        <div className="stat-lbl">筆數</div>
        <div className="stat-num mono">{totals.transactionCount}</div>
        <div className="stat-sub">所有交易，含未付款訂餐</div>
      </div>
    </div>
  );
}
