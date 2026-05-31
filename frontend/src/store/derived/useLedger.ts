import { useMemo } from 'react';
import { usePosStore } from '../posStore';
import { countActiveOrdersForStudent, mergeLedgerTransactions } from '../../domain/ledger';
import type { MergedTransaction } from '../../domain/ledger';

export function useActiveOrderCount(studentId: string | null, viewDate: string): number {
  const allTx = usePosStore((s) => s.transactions);
  return useMemo(() => {
    if (!studentId) return 0;
    return countActiveOrdersForStudent(allTx, studentId, viewDate);
  }, [allTx, studentId, viewDate]);
}

export function useMergedTransactions(tx: ReturnType<typeof usePosStore.getState>['transactions']): MergedTransaction[] {
  return useMemo(() => mergeLedgerTransactions(tx), [tx]);
}
