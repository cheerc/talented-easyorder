import React, { useState, useMemo, useEffect } from 'react';
import type { LedgerGroup } from '../../domain/ledgerReport';
import type { LedgerTransaction } from '../../domain/ledger';
import { GroupRow } from './GroupRow';
import { SummaryRow } from './SummaryRow';
import { DetailRow } from './DetailRow';
import { IncomeRow } from './IncomeRow';
import { ExpenseOnlyRow } from './ExpenseOnlyRow';
import { flattenGroups, paginateGroups } from './ledgerGroupUtils';
import type { FlatRow } from './ledgerGroupUtils';

interface LedgerGroupedTableProps {
  groups: LedgerGroup[];
  expenseRows: LedgerTransaction[];
  onToggleExpand: (sid: string) => void;
  expandedSids: Set<string>;
  onEditClick: (t: LedgerTransaction) => void;
  onDeleteClick: (t: LedgerTransaction) => void;
  dateStatus: string;
  displayMode?: 'merged' | 'original';
}

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
const DEFAULT_PAGE_SIZE = 20;

const TABLE_HEADER_HEIGHT = 36;

const LedgerGroupedTable = React.memo(function LedgerGroupedTable({
  groups,
  expenseRows,
  onToggleExpand,
  expandedSids,
  onEditClick,
  onDeleteClick,
  dateStatus,
  displayMode = 'merged',
}: LedgerGroupedTableProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const flatRows = useMemo(() => flattenGroups(groups, expandedSids, displayMode), [groups, expandedSids, displayMode]);

  const totalGroups = groups.length;
  const totalPages = Math.max(1, Math.ceil(totalGroups / pageSize));

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  const visibleRows = useMemo(() => {
    if (totalGroups <= pageSize) return flatRows;
    return paginateGroups(flatRows, Math.min(page, totalPages), pageSize);
  }, [flatRows, page, pageSize, totalPages, totalGroups]);

  const { incomeRows, expenseOnlyRows } = useMemo(() => {
    return expenseRows.reduce<{ incomeRows: LedgerTransaction[]; expenseOnlyRows: LedgerTransaction[] }>(
      (acc, t) => {
        if ((Number(t.paidAmount) || 0) > 0) {
          acc.incomeRows.push(t);
        } else {
          acc.expenseOnlyRows.push(t);
        }
        return acc;
      },
      { incomeRows: [], expenseOnlyRows: [] },
    );
  }, [expenseRows]);

  const expenseSection = expenseRows.length > 0 ? (
    <div style={{ marginBottom: '12px', borderRadius: 'var(--r)' }}>
      <div style={{ background: 'var(--ink)', color: '#fff', padding: '8px 12px', fontSize: '13px', fontWeight: 600 }}>櫃台 收支明細（{expenseRows.length} 筆）</div>
      {incomeRows.map(t => (
        <IncomeRow key={t.transactionId} tx={t} onDeleteClick={onDeleteClick} dateStatus={dateStatus} />
      ))}
      {expenseOnlyRows.map(t => (
        <ExpenseOnlyRow key={t.transactionId} tx={t} onDeleteClick={onDeleteClick} dateStatus={dateStatus} />
      ))}
    </div>
  ) : null;

  const renderRow = (row: FlatRow) => {
    if (row.kind === 'group') {
      const g = groups[row.groupIndex];
      const isExpanded = expandedSids.has(g.studentId);
      return (
        <GroupRow
          key={`g-${row.groupIndex}`}
          group={g}
          groupIndex={row.groupIndex}
          isExpanded={isExpanded}
          onToggleExpand={onToggleExpand}
        />
      );
    }

    if (row.kind === 'summary') {
      const g = groups[row.groupIndex];
      return (
        <SummaryRow
          key={`s-${row.groupIndex}`}
          group={g}
          groupIndex={row.groupIndex}
        />
      );
    }

    return (
      <DetailRow
        key={`d-${row.tx!.transactionId}`}
        tx={row.tx!}
        locked={dateStatus === 'closed'}
        displayMode={displayMode}
        onEditClick={onEditClick}
        onDeleteClick={onDeleteClick}
      />
    );
  };

  return (
    <div className="rpt-table">
      {expenseSection}
      <div className="rpt-th" style={{ gridTemplateColumns: '80px 60px 100px 1fr 1fr 1fr auto', height: TABLE_HEADER_HEIGHT }}>
        <div>最後時間</div><div>編號</div><div>姓名</div>
        <div className="r">當日應付</div><div className="r">當日實收</div><div className="r">目前餘額</div><div className="r">狀態</div>
      </div>
      {flatRows.length > 0 ? (
        <>
          {visibleRows.map((row) => renderRow(row))}
          {totalGroups > pageSize && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderTop: '1px solid var(--line-2)', fontSize: '13px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="dim">每頁</span>
                <select
                  value={pageSize}
                  onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
                  style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid var(--line)', background: 'var(--bg)', fontFamily: 'inherit', fontSize: '13px' }}
                >
                  {PAGE_SIZE_OPTIONS.map(n => (
                    <option key={n} value={n}>{n} 組</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  className="rpt-mini-btn"
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  style={page <= 1 ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                >
                  ＜ 上一頁
                </button>
                <span className="mono dim" style={{ fontSize: '12px' }}>
                  {page} / {totalPages}
                </span>
                <button
                  className="rpt-mini-btn"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  style={page >= totalPages ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                >
                  下一頁 ＞
                </button>
              </div>
            </div>
          )}
        </>
      ) : expenseRows.length === 0 ? (
        <div className="rpt-empty">尚無交易紀錄</div>
      ) : null}
    </div>
  );
});

export { LedgerGroupedTable };
export type { LedgerGroupedTableProps };
