import { useMemo } from 'react';
import { useTransactions } from '../selectors';
import {
  createLedgerDateRange,
  calculateLedgerTotals,
  groupLedgerRowsByStudent,
  type LedgerDateRangeKind,
  type LedgerDateRange,
  type LedgerTotals,
  type LedgerGroup,
} from '../../domain/ledgerReport';
import type { LedgerTransaction } from '../../domain/ledger';

export type { LedgerDateRangeKind, LedgerDateRange, LedgerTotals, LedgerGroup };
export type { LedgerTransaction };

export function useLedgerReport(args: {
  dateRange: LedgerDateRangeKind;
  viewDate: string;
  customStart?: string;
  customEnd?: string;
}): {
  range: LedgerDateRange;
  filtered: LedgerTransaction[];
  totals: LedgerTotals;
  groups: LedgerGroup[];
} {
  const { transactions: allTransactions } = useTransactions();
  const transactions = useMemo(() => {
    if (args.dateRange === 'today') {
      return allTransactions.filter(t => t.businessDate === args.viewDate);
    }
    return allTransactions;
  }, [allTransactions, args.dateRange, args.viewDate]);

  const range = useMemo(() => createLedgerDateRange(
    args.dateRange,
    args.viewDate,
    args.dateRange === 'custom' ? { startDate: args.customStart!, endDate: args.customEnd! } : undefined,
  ), [args.dateRange, args.viewDate, args.customStart, args.customEnd]);

  const filtered = useMemo(() =>
    transactions.filter(t => t.businessDate >= range.startDate && t.businessDate <= range.endDate),
  [transactions, range]);

  const totals = useMemo(() => calculateLedgerTotals(filtered), [filtered]);
  const groups = useMemo(() => groupLedgerRowsByStudent(filtered), [filtered]);

  return { range, filtered, totals, groups };
}
