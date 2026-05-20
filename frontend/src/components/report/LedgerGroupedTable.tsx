import React, { useState, useMemo, useCallback } from 'react';
import { fmt } from '../pos-components';
import type { LedgerGroup } from '../../domain/ledgerReport';
import type { LedgerTransaction } from '../../domain/ledger';
import { CASHIER_SENTINEL } from '../../domain/ledger';

interface LedgerGroupedTableProps {
  groups: LedgerGroup[];
  expenseRows: LedgerTransaction[];
  onToggleExpand: (sid: string) => void;
  expandedSids: Set<string>;
  onEditClick: (t: LedgerTransaction) => void;
  onDeleteClick: (t: LedgerTransaction) => void;
  dateStatus: string;
}

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
const DEFAULT_PAGE_SIZE = 20;

const GROUP_ROW_HEIGHT = 48;
const SUMMARY_ROW_HEIGHT = 36;
const DETAIL_ROW_HEIGHT = 40;
const TABLE_HEADER_HEIGHT = 36;

// Flatten groups + summary + detail rows into a single flat list
interface FlatRow {
  kind: 'group' | 'summary' | 'detail';
  groupIndex: number;
  tx?: LedgerTransaction;
}

function flattenGroups(groups: LedgerGroup[], expandedSids: Set<string>): FlatRow[] {
  const rows: FlatRow[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    rows.push({ kind: 'group', groupIndex: i });
    if (expandedSids.has(g.studentId)) {
      rows.push({ kind: 'summary', groupIndex: i });
      for (const tx of g.transactions) {
        rows.push({ kind: 'detail', groupIndex: i, tx });
      }
    }
  }
  return rows;
}

function paginateGroups(flatRows: FlatRow[], page: number, pageSize: number): FlatRow[] {
  // Count groups only for pagination
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

const LedgerGroupedTable = React.memo(function LedgerGroupedTable({
  groups,
  expenseRows,
  onToggleExpand,
  expandedSids,
  onEditClick,
  onDeleteClick,
  dateStatus,
}: LedgerGroupedTableProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const flatRows = useMemo(() => flattenGroups(groups, expandedSids), [groups, expandedSids]);

  const totalGroups = groups.length;
  const totalPages = Math.max(1, Math.ceil(totalGroups / pageSize));

  // Reset to page 1 when groups change
  useMemo(() => {
    if (page > totalPages) setPage(1);
  }, [groups.length, page, totalPages]);

  const visibleRows = useMemo(() => {
    // If total groups fit on one page, show all without pagination
    if (totalGroups <= pageSize) return flatRows;
    return paginateGroups(flatRows, Math.min(page, totalPages), pageSize);
  }, [flatRows, page, pageSize, totalGroups]);

  const incomeRows = expenseRows.filter(t => t.paidAmount > 0);
  const expenseOnlyRows = expenseRows.filter(t => t.paidAmount === 0);

  const expenseSection = expenseRows.length > 0 ? (
    <div style={{ marginBottom: '12px', borderRadius: 'var(--r)', overflow: 'hidden' }}>
      <div style={{ background: 'var(--ink)', color: '#fff', padding: '8px 12px', fontSize: '13px', fontWeight: 600 }}>櫃台 收入/支出（{expenseRows.length} 筆）</div>
      {incomeRows.map(t => (
        <div key={t.transactionId} className="rpt-detail-row" style={{ display: 'grid', gridTemplateColumns: '80px 60px 1fr 1fr auto', height: DETAIL_ROW_HEIGHT, alignItems: 'center', borderBottom: '1px solid var(--line-1)', padding: '4px 0', background: 'rgba(34,197,94,0.04)' }}>
          <div className="mono dim">{t.createdAt.slice(11, 19)}</div>
          <div className="pos" style={{ fontWeight: 600 }}>收入</div>
          <div className="r mono pos">+${fmt(t.paidAmount)}</div>
          <div className="dim italic" style={{ fontSize: '12px' }}>{t.note}</div>
          <div className="rpt-row-actions">
            {dateStatus !== 'closed' && <button className="rpt-mini-btn rpt-mini-del" onClick={() => onDeleteClick(t)}>刪除</button>}
          </div>
        </div>
      ))}
      {expenseOnlyRows.map(t => (
        <div key={t.transactionId} className="rpt-detail-row" style={{ display: 'grid', gridTemplateColumns: '80px 60px 1fr 1fr auto', height: DETAIL_ROW_HEIGHT, alignItems: 'center', borderBottom: '1px solid var(--line-1)', padding: '4px 0', background: 'rgba(239,68,68,0.04)' }}>
          <div className="mono dim">{t.createdAt.slice(11, 19)}</div>
          <div className="neg" style={{ fontWeight: 600 }}>支出</div>
          <div className="r mono neg">−${fmt(t.mealPrice)}</div>
          <div className="dim italic" style={{ fontSize: '12px' }}>{t.note}</div>
          <div className="rpt-row-actions">
            {dateStatus !== 'closed' && <button className="rpt-mini-btn rpt-mini-del" onClick={() => onDeleteClick(t)}>刪除</button>}
          </div>
        </div>
      ))}
    </div>
  ) : null;

  const renderRow = (row: FlatRow, _idx: number) => {
    if (row.kind === 'group') {
      const g = groups[row.groupIndex];
      const isExpanded = expandedSids.has(g.studentId);
      return (
        <div
          key={`g-${row.groupIndex}`}
          className={'rpt-tr ' + (isExpanded ? 'expanded-head' : '')}
          onClick={() => onToggleExpand(g.studentId)}
          style={{ gridTemplateColumns: '80px 60px 100px 1fr 1fr 1fr auto', cursor: 'pointer', display: 'grid', height: GROUP_ROW_HEIGHT, alignItems: 'center', borderTop: '1px solid var(--line-2)' }}
        >
          <div className="mono dim">{g.latestCreatedAt.slice(11, 19)}</div>
          <div className="mono">{g.studentId}</div>
          <div style={{ fontWeight: '600' }}>{g.studentNameSnapshot}</div>
          <div className="r mono neg">{g.mealTotal > 0 ? `−$${fmt(g.mealTotal)}` : '-'}</div>
          <div className="r mono pos">{g.paidTotal > 0 ? `+$${fmt(g.paidTotal)}` : '-'}</div>
          <div className="r mono">{g.afterBalance < 0 ? '−' : ''}${fmt(Math.abs(g.afterBalance))}</div>
          <div className="r">
            <span className="pill" style={{ fontSize: '10px', background: isExpanded ? 'var(--ink)' : 'var(--line-2)', color: isExpanded ? '#fff' : 'var(--ink-3)' }}>
              {g.recordCount} 筆紀錄 {isExpanded ? '▴' : '▾'}
            </span>
          </div>
        </div>
      );
    }

    if (row.kind === 'summary') {
      const g = groups[row.groupIndex];
      return (
        <div key={`s-${row.groupIndex}`} className="rpt-detail-row rpt-summary-row" style={{ background: 'var(--bg-2)', fontWeight: 500, fontSize: '12px', borderBottom: '2px solid var(--line-2)', display: 'flex', gap: '12px', padding: '4px 12px', alignItems: 'center', height: SUMMARY_ROW_HEIGHT }}>
          <span>📋 訂餐 {g.recordCount} 筆</span>
          <span className="pos">收現 +${fmt(g.paidTotal)}</span>
          <span className={g.afterBalance - (g.transactions[0]?.afterBalance ?? g.afterBalance) < 0 ? 'warn' : 'pos'}>
            淨變動 {g.afterBalance - (g.transactions[0]?.afterBalance ?? g.afterBalance) < 0 ? '−' : '+'}${fmt(Math.abs(g.afterBalance - (g.transactions[0]?.afterBalance ?? g.afterBalance)))}
          </span>
        </div>
      );
    }

    // detail row
    const t = row.tx!;
    const locked = dateStatus === 'closed';
    const typeLabel: Record<string, string> = { order: '訂餐', payment: '繳費', expense: '支出' };
    return (
      <div key={`d-${t.transactionId}`} className="rpt-detail-row" style={{ display: 'grid', gridTemplateColumns: '80px 60px 100px 1fr 1fr 1fr auto', height: DETAIL_ROW_HEIGHT, alignItems: 'center' }}>
        <div className="mono dim">{t.createdAt.slice(11, 19)}</div>
        <div className="dim">{typeLabel[t.type] ?? t.type}</div>
        <div className={'r mono ' + (t.mealPrice > 0 ? 'neg' : t.mealPrice < 0 ? 'pos' : '')}>
          {t.mealPrice !== 0 ? <>{t.mealPrice > 0 ? '−' : '+'}${fmt(Math.abs(t.mealPrice))}</> : <>-</>}
        </div>
        <div className={'r mono ' + (t.paidAmount > 0 ? 'pos' : '')}>
          {t.paidAmount > 0 ? <>+${fmt(t.paidAmount)}</> : <>-</>}
        </div>
        <div className="dim italic" style={{ fontSize: '12px' }}>
          {t.note}
        </div>
        <div className="rpt-row-actions">
          {locked ? (
            <span className="dim" style={{fontSize:'11px'}}>🔒 已關帳</span>
          ) : (
            <>
              {t.studentId !== CASHIER_SENTINEL && (
                <>
                  <button className="rpt-mini-btn" onClick={() => onEditClick(t)}>編輯</button>
                  <button className="rpt-mini-btn rpt-mini-del" onClick={() => onDeleteClick(t)}>刪除</button>
                </>
              )}
              {t.studentId === CASHIER_SENTINEL && (
                <button className="rpt-mini-btn rpt-mini-del" onClick={() => onDeleteClick(t)}>刪除</button>
              )}
            </>
          )}
        </div>
      </div>
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
          {visibleRows.map((row, idx) => renderRow(row, idx))}
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
