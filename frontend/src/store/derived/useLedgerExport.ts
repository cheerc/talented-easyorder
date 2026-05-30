import { useCallback } from 'react';
import type { LedgerTransaction } from '../../domain/ledger';
import { mergeLedgerTransactions } from '../../domain/ledger';
import {
  TRANSACTION_CSV_COLUMNS,
  buildTransactionCsvRows,
  serializeCsv,
  triggerCsvDownload,
} from '../../domain/ledgerExport';

export function useLedgerExport(viewDate: string): {
  exportCsv: (transactions: LedgerTransaction[], displayMode: 'merged' | 'original') => void;
} {
  const exportCsv = useCallback((transactions: LedgerTransaction[], displayMode: 'merged' | 'original') => {
    const txsToExport = displayMode === 'merged' ? mergeLedgerTransactions(transactions) : transactions;
    const txRows = buildTransactionCsvRows(txsToExport);
    const csv = serializeCsv(TRANSACTION_CSV_COLUMNS, txRows);
    triggerCsvDownload(`easyorder-report-${viewDate}.csv`, csv);
  }, [viewDate]);

  return { exportCsv };
}
