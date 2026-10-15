import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ReportSummaryStats } from '../ReportSummaryStats';
import type { LedgerTotals } from '../../domain/ledgerReport';

const baseTotals: LedgerTotals = {
  orderCount: 10,
  bentoCount: 10,
  otherMealCount: 0,
  mealTotal: 900,
  orderUnpaid: 0,
  totalIncome: 900,
  totalExpense: 200,
  totalRefund: 0,
  netCash: 700,
  transactionCount: 12,
};

describe('ReportSummaryStats', () => {
  it('displays orderCount with 份 suffix', () => {
    const { container } = render(<ReportSummaryStats totals={baseTotals} itemName="排骨便當" />);
    expect(container.textContent).toContain('10');
    expect(container.textContent).toContain('份');
  });

  it('份數顯示今日便當，其他餐點另外寫「＋ 其他 M 份」', () => {
    const { container } = render(<ReportSummaryStats totals={{ ...baseTotals, bentoCount: 8, otherMealCount: 2 }} itemName="排骨便當" />);
    const card = container.querySelector('.stat-strong')!;
    expect(card.textContent).toBe('份數8 份今日便當（排骨便當）＋ 其他 2 份');
  });

  it('淨現金是負的時候顯示「−」（先付了便當錢、還沒收到現金）', () => {
    const { container } = render(<ReportSummaryStats totals={{ ...baseTotals, totalIncome: 0, totalExpense: 270, netCash: -270 }} itemName="排骨便當" />);
    expect(container.textContent).toContain('−$270');
  });

  it('displays itemName as subtitle', () => {
    const { container } = render(<ReportSummaryStats totals={baseTotals} itemName="雞腿便當" />);
    expect(container.textContent).toContain('雞腿便當');
  });

  it('displays totalIncome with +$ prefix', () => {
    const { container } = render(<ReportSummaryStats totals={baseTotals} itemName="排骨便當" />);
    expect(container.textContent).toContain('+$900');
  });

  it('displays totalExpense with −$ prefix', () => {
    const { container } = render(<ReportSummaryStats totals={baseTotals} itemName="排骨便當" />);
    expect(container.textContent).toContain('−$200');
  });

  it('displays totalRefund with −$ prefix', () => {
    const { container } = render(<ReportSummaryStats totals={{ ...baseTotals, totalRefund: 150 }} itemName="排骨便當" />);
    expect(container.textContent).toContain('−$150');
    expect(container.textContent).toContain('從帳戶退還的現金');
    expect(container.textContent).toContain('收現 − 支出 − 退款');
  });

  it('displays netCash formatted', () => {
    const { container } = render(<ReportSummaryStats totals={{ ...baseTotals, netCash: 1234 }} itemName="排骨便當" />);
    expect(container.textContent).toContain('$1,234');
  });

  it('F08：餐費卡片顯示應收餐費，副標是訂餐當下未收，不再有「新增欠款」', () => {
    const { container } = render(<ReportSummaryStats totals={{ ...baseTotals, mealTotal: 1350, orderUnpaid: 567 }} itemName="排骨便當" />);
    expect(container.textContent).toContain('餐費$1,350');
    expect(container.textContent).toContain('訂餐當下未收 $567');
    expect(container.textContent).not.toContain('新增欠款');
  });

  it('F08：卡片名稱是份數／餐費／收現／支出／退款／淨現金／筆數', () => {
    const { container } = render(<ReportSummaryStats totals={baseTotals} itemName="排骨便當" />);
    const labels = Array.from(container.querySelectorAll('.stat-lbl')).map(el => el.textContent);
    expect(labels).toEqual(['份數', '餐費', '收現', '支出', '退款', '淨現金', '筆數']);
  });

  it('displays transactionCount', () => {
    const { container } = render(<ReportSummaryStats totals={baseTotals} itemName="排骨便當" />);
    expect(container.textContent).toContain('12');
  });

  it('does not render counter cash flow section when counterCashFlow is undefined', () => {
    const { container } = render(<ReportSummaryStats totals={baseTotals} itemName="排骨便當" />);
    const labels = Array.from(container.querySelectorAll('.stat-lbl')).map(el => el.textContent);
    expect(labels).not.toContain('櫃台收入');
    expect(labels).not.toContain('櫃台支出');
  });

  it('does not render counter cash flow section when both counts are 0', () => {
    const { container } = render(
      <ReportSummaryStats
        totals={baseTotals}
        itemName="排骨便當"
        counterCashFlow={{ incomeCount: 0, incomeAmount: 0, expenseCount: 0, expenseAmount: 0 }}
      />
    );
    const labels = Array.from(container.querySelectorAll('.stat-lbl')).map(el => el.textContent);
    expect(labels).not.toContain('櫃台收入');
    expect(labels).not.toContain('櫃台支出');
  });

  it('renders counter income when incomeCount > 0', () => {
    const { container } = render(
      <ReportSummaryStats
        totals={baseTotals}
        itemName="排骨便當"
        counterCashFlow={{ incomeCount: 3, incomeAmount: 500, expenseCount: 0, expenseAmount: 0 }}
      />
    );
    expect(container.textContent).toContain('櫃台收入');
    expect(container.textContent).toContain('$500');
    expect(container.textContent).toContain('3筆');
  });

  it('renders counter expense when expenseCount > 0', () => {
    const { container } = render(
      <ReportSummaryStats
        totals={baseTotals}
        itemName="排骨便當"
        counterCashFlow={{ incomeCount: 0, incomeAmount: 0, expenseCount: 2, expenseAmount: 300 }}
      />
    );
    expect(container.textContent).toContain('櫃台支出');
    expect(container.textContent).toContain('$300');
    expect(container.textContent).toContain('2筆');
  });

  it('handles zero totals (all fields 0)', () => {
    const zeroTotals: LedgerTotals = {
      orderCount: 0,
      mealTotal: 0,
      orderUnpaid: 0,
      totalIncome: 0,
      totalExpense: 0,
      netCash: 0,
      transactionCount: 0,
    };
    const { container } = render(<ReportSummaryStats totals={zeroTotals} itemName="排骨便當" />);
    expect(container.textContent).toContain('0');
    expect(container.textContent).toContain('$0');
  });
});
