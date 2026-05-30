import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ReportSummaryStats } from '../ReportSummaryStats';
import type { LedgerTotals } from '../../domain/ledgerReport';

const baseTotals: LedgerTotals = {
  orderCount: 10,
  totalIncome: 900,
  totalExpense: 200,
  netCash: 700,
  newDebt: 900,
  transactionCount: 12,
};

describe('ReportSummaryStats', () => {
  it('displays orderCount with 份 suffix', () => {
    const { container } = render(<ReportSummaryStats totals={baseTotals} itemName="排骨便當" />);
    expect(container.textContent).toContain('10');
    expect(container.textContent).toContain('份');
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

  it('displays netCash formatted', () => {
    const { container } = render(<ReportSummaryStats totals={{ ...baseTotals, netCash: 1234 }} itemName="排骨便當" />);
    expect(container.textContent).toContain('$1,234');
  });

  it('displays newDebt formatted', () => {
    const { container } = render(<ReportSummaryStats totals={{ ...baseTotals, newDebt: 567 }} itemName="排骨便當" />);
    expect(container.textContent).toContain('$567');
  });

  it('displays transactionCount', () => {
    const { container } = render(<ReportSummaryStats totals={baseTotals} itemName="排骨便當" />);
    expect(container.textContent).toContain('12');
  });

  it('does not render counter cash flow section when counterCashFlow is undefined', () => {
    const { container } = render(<ReportSummaryStats totals={baseTotals} itemName="排骨便當" />);
    expect(container.textContent).not.toContain('櫃台收入');
    expect(container.textContent).not.toContain('櫃台支出');
  });

  it('does not render counter cash flow section when both counts are 0', () => {
    const { container } = render(
      <ReportSummaryStats
        totals={baseTotals}
        itemName="排骨便當"
        counterCashFlow={{ incomeCount: 0, incomeAmount: 0, expenseCount: 0, expenseAmount: 0 }}
      />
    );
    expect(container.textContent).not.toContain('櫃台收入');
    expect(container.textContent).not.toContain('櫃台支出');
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
      totalIncome: 0,
      totalExpense: 0,
      netCash: 0,
      newDebt: 0,
      transactionCount: 0,
    };
    const { container } = render(<ReportSummaryStats totals={zeroTotals} itemName="排骨便當" />);
    expect(container.textContent).toContain('0');
    expect(container.textContent).toContain('$0');
  });
});
