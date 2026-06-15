import { useMemo } from 'react';
import { useTransactions } from '../selectors';
import { countActiveOrdersForStudent, mergeLedgerTransactions } from '../../domain/ledger';
import type { MergedTransaction, LedgerTransaction } from '../../domain/ledger';

export function useActiveOrderCount(studentId: string | null, viewDate: string): number {
  const { transactions: allTx } = useTransactions();
  return useMemo(() => {
    if (!studentId) return 0;
    return countActiveOrdersForStudent(allTx, studentId, viewDate);
  }, [allTx, studentId, viewDate]);
}

export function useMergedTransactions(tx: LedgerTransaction[]): MergedTransaction[] {
  return useMemo(() => mergeLedgerTransactions(tx), [tx]);
}
