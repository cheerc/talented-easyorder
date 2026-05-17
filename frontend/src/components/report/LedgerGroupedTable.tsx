import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { List } from 'react-window';
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

// Flatten groups + summary + detail rows into a single item list for virtualization
interface FlatRow {
  kind: 'group' | 'summary' | 'detail';
  groupIndex: number;
  tx?: LedgerTransaction;
}

function flattenRows(groups: LedgerGroup[], expandedSids: Set<string>): FlatRow[] {
  const rows: FlatRow[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    rows.push({ kind: 'group', groupIndex: i });
    if (expandedSids.has(g.studentId)) {
      rows.push({ kind: 'summary', groupIndex: i }); // M5 per-student summary row
      for (const tx of g.transactions) {
        rows.push({ kind: 'detail', groupIndex: i, tx });
      }
    }
  }
  return rows;
}

const GROUP_ROW_HEIGHT = 48;
const SUMMARY_ROW_HEIGHT = 36;
const DETAIL_ROW_HEIGHT = 40;
const TABLE_HEADER_HEIGHT = 36;
const DEFAULT_ROW_HEIGHT = GROUP_ROW_HEIGHT;

interface RowProps {
  flatRows: FlatRow[];
  groups: LedgerGroup[];
  expandedSids: Set<string>;
  dateStatus: string;
  onToggleExpand: (sid: string) => void;
  onEditClick: (t: LedgerTransaction) => void;
  onDeleteClick: (t: LedgerTransaction) => void;
}

function LedgerGroupRow({
  index,
  style,
  flatRows,
  groups,
  expandedSids,
  dateStatus,
  onToggleExpand,
  onEditClick,
  onDeleteClick,
}: {
  index: number;
  style: React.CSSProperties;
} & RowProps) {
  const row = flatRows[index];
  if (!row) return null;

  if (row.kind === 'group') {
    const g = groups[row.groupIndex];
    const isExpanded = expandedSids.has(g.studentId);
    return (
      <div style={style}>
        <div
          className={'rpt-tr ' + (isExpanded ? 'expanded-head' : '')}
          onClick={() => onToggleExpand(g.studentId)}
          style={{ gridTemplateColumns: '80px 60px 100px 1fr 1fr 1fr auto', cursor: 'pointer', display: 'grid', height: GROUP_ROW_HEIGHT, alignItems: 'center' }}
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
      </div>
    );
  }

  if (row.kind === 'summary') {
    const g = groups[row.groupIndex];
    return (
      <div style={style}>
        <div className="rpt-detail-row rpt-summary-row" style={{ background: 'var(--bg-2)', fontWeight: 500, fontSize: '12px', borderBottom: '2px solid var(--line-2)', display: 'flex', gap: '12px', padding: '4px 12px', alignItems: 'center', height: SUMMARY_ROW_HEIGHT }}>
          <span>📋 訂餐 {g.recordCount} 筆</span>
          <span className="pos">收現 +${fmt(g.paidTotal)}</span>
          <span className={g.afterBalance - (g.transactions[0]?.afterBalance ?? g.afterBalance) < 0 ? 'warn' : 'pos'}>
            淨變動 {g.afterBalance - (g.transactions[0]?.afterBalance ?? g.afterBalance) < 0 ? '−' : '+'}${fmt(Math.abs(g.afterBalance - (g.transactions[0]?.afterBalance ?? g.afterBalance)))}
          </span>
        </div>
      </div>
    );
  }

  // detail row
  const t = row.tx!;
  const locked = dateStatus === 'closed';
  const typeLabel: Record<string, string> = { order: '訂餐', payment: '繳費', expense: '支出' };
  return (
    <div style={style}>
      <div className="rpt-detail-row" style={{ display: 'grid', gridTemplateColumns: '80px 60px 100px 1fr 1fr 1fr auto', height: DETAIL_ROW_HEIGHT, alignItems: 'center' }}>
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
    </div>
  );
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(400);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateHeight = () => {
      const rect = el.getBoundingClientRect();
      const avail = window.innerHeight - rect.top - 24;
      setContainerHeight(Math.max(200, avail));
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  const flatRows = useMemo(() => flattenRows(groups, expandedSids), [groups, expandedSids]);

  const getRowHeight = useCallback((index: number) => {
    const row = flatRows[index];
    if (!row) return DEFAULT_ROW_HEIGHT;
    if (row.kind === 'group') return GROUP_ROW_HEIGHT;
    if (row.kind === 'summary') return SUMMARY_ROW_HEIGHT;
    return DETAIL_ROW_HEIGHT;
  }, [flatRows]);

  const rowProps: RowProps = {
    flatRows,
    groups,
    expandedSids,
    dateStatus,
    onToggleExpand,
    onEditClick,
    onDeleteClick,
  };

  const expenseSection = expenseRows.length > 0 ? (
    <div style={{ marginBottom: '12px', border: '1px solid var(--c-warn)', borderRadius: 'var(--r)', overflow: 'hidden' }}>
      <div style={{ background: 'var(--c-warn)', color: '#fff', padding: '8px 12px', fontSize: '13px', fontWeight: 600 }}>櫃台支出</div>
      {expenseRows.map(t => (
        <div key={t.transactionId} className="rpt-detail-row" style={{ display: 'grid', gridTemplateColumns: '80px 60px 100px 1fr 1fr 1fr auto', height: DETAIL_ROW_HEIGHT, alignItems: 'center', borderBottom: '1px solid var(--line-1)', padding: '4px 0' }}>
          <div className="mono dim">{t.createdAt.slice(11, 19)}</div>
          <div className="dim">支出</div>
          <div className="r mono neg">−${fmt(t.mealPrice)}</div>
          <div className="r mono">-</div>
          <div className="dim italic" style={{ fontSize: '12px' }}>{t.note}</div>
          <div className="rpt-row-actions">
            {dateStatus !== 'closed' && <button className="rpt-mini-btn rpt-mini-del" onClick={() => onDeleteClick(t)}>刪除</button>}
          </div>
        </div>
      ))}
    </div>
  ) : null;

  return (
    <div className="rpt-table" ref={containerRef}>
      {expenseSection}
      <div className="rpt-th" style={{ gridTemplateColumns: '80px 60px 100px 1fr 1fr 1fr auto', height: TABLE_HEADER_HEIGHT }}>
        <div>最後時間</div><div>編號</div><div>姓名</div>
        <div className="r">當日應付</div><div className="r">當日實收</div><div className="r">目前餘額</div><div className="r">狀態</div>
      </div>
      {flatRows.length > 0 ? (
        <List
          rowComponent={LedgerGroupRow}
          rowCount={flatRows.length}
          rowHeight={getRowHeight}
          rowProps={rowProps}
          defaultHeight={containerHeight}
          style={{ height: containerHeight }}
          overscanCount={5}
        />
      ) : expenseRows.length === 0 ? (
        <div className="rpt-empty">尚無交易紀錄</div>
      ) : null}
    </div>
  );
});

export { LedgerGroupedTable };