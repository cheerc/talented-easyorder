import type { LedgerGroup } from '../../domain/ledgerReport';
import type { LedgerTransaction } from '../../domain/ledger';
import { mergeLedgerTransactions } from '../../domain/ledger';

export interface FlatRow {
  kind: 'group' | 'summary' | 'detail';
  groupIndex: number;
  tx?: LedgerTransaction;
}

export function flattenGroups(groups: LedgerGroup[], expandedSids: Set<string>, displayMode: 'merged' | 'original'): FlatRow[] {
  const rows: FlatRow[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    rows.push({ kind: 'group', groupIndex: i });
    if (expandedSids.has(g.studentId)) {
      rows.push({ kind: 'summary', groupIndex: i });
      const txs = displayMode === 'merged' ? mergeLedgerTransactions(g.transactions) : g.transactions;
      for (const tx of txs) {
        rows.push({ kind: 'detail', groupIndex: i, tx });
      }
    }
  }
  return rows;
}

export function paginateGroups(flatRows: FlatRow[], page: number, pageSize: number): FlatRow[] {
  let groupIdx = 0;
  const startGroup = (page - 1) * pageSize;
  const endGroup = startGroup + pageSize;
  const result: FlatRow[] = [];
  let currentGroup = -1;

  for (const row of flatRows) {
    if (row.kind === 'group') {
      currentGroup = groupIdx;
      groupIdx++;
    }
    if (currentGroup >= startGroup && currentGroup < endGroup) {
      result.push(row);
    }
  }
  return result;
}
