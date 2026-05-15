import React, { useRef, useEffect, useState, useCallback } from 'react';
import { List as FixedList } from 'react-window';
import { fmt } from '../pos-components';
import type { LedgerGroup } from '../../domain/ledgerReport';
import type { LedgerTransaction } from '../../domain/ledger';

interface LedgerGroupedTableProps {
  groups: LedgerGroup[];
  onToggleExpand: (sid: string) => void;
  expandedSids: Set<string>;
  onCorrectClick: (t: LedgerTransaction) => void;
  onVoidClick: (t: LedgerTransaction) => void;
  dateStatus: string;
}

// Flatten groups + expanded detail rows into a single item list for virtualization
interface FlatRow {
  kind: 'group' | 'detail';
  groupIndex: number;
  tx?: LedgerTransaction;
}

function flattenRows(groups: LedgerGroup[], expandedSids: Set<string>): FlatRow[] {
  const rows: FlatRow[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    rows.push({ kind: 'group', groupIndex: i });
    if (expandedSids.has(g.studentId)) {
      for (const tx of g.transactions) {
        rows.push({ kind: 'detail', groupIndex: i, tx });
      }
    }
  }
  return rows;
}

const GROUP_ROW_HEIGHT = 48;
const DETAIL_ROW_HEIGHT = 40;
const TABLE_HEADER_HEIGHT = 36;

function getRowHeight(row: FlatRow): number {
  if (row.kind === 'group') return GROUP_ROW_HEIGHT;
  return DETAIL_ROW_HEIGHT;
}

const LedgerGroupedTable = React.memo(function LedgerGroupedTable({
  groups,
  onToggleExpand,
  expandedSids,
  onCorrectClick,
  onVoidClick,
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

  const flatRows = flattenRows(groups, expandedSids);

  const Row = useCallback(({ index, style }: { index: number; style: React.CSSProperties }) => {
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

    // detail row
    const t = row.tx!;
    const locked = dateStatus === 'closed';
    return (
      <div style={style}>
        <div className="rpt-detail-row" style={{ display: 'grid', gridTemplateColumns: '80px 60px 100px 1fr 1fr 1fr auto', height: DETAIL_ROW_HEIGHT, alignItems: 'center' }}>
          <div className="mono dim">{t.createdAt.slice(11, 19)}</div>
          <div className="dim">{t.type === 'order' ? '訂餐' : t.type === 'topup' ? '儲值' : t.type === 'cancel' ? '取消' : t.type === 'correction' ? '更正' : '作廢'}</div>
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
                <button className="rpt-mini-btn" onClick={() => onCorrectClick(t)}>更正</button>
                <button className="rpt-mini-btn rpt-mini-del" onClick={() => onVoidClick(t)}>刪除</button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }, [groups, flatRows, expandedSids, dateStatus, onToggleExpand, onCorrectClick, onVoidClick]);

  const totalHeight = flatRows.reduce((acc, r) => acc + getRowHeight(r), 0);
  const listHeight = Math.min(totalHeight, containerHeight);

  return (
    <div className="rpt-table" ref={containerRef}>
      <div className="rpt-th" style={{ gridTemplateColumns: '80px 60px 100px 1fr 1fr 1fr auto', height: TABLE_HEADER_HEIGHT }}>
        <div>最後時間</div><div>編號</div><div>姓名</div>
        <div className="r">當日應付</div><div className="r">當日實收</div><div className="r">目前餘額</div><div className="r">狀態</div>
      </div>
      {flatRows.length > 0 ? (
        <FixedList
          height={listHeight}
          itemCount={flatRows.length}
          itemSize={getRowHeight}
          width="100%"
          overscanCount={5}
        >
          {Row}
        </FixedList>
      ) : (
        <div className="rpt-empty">尚無交易紀錄</div>
      )}
    </div>
  );
});

export { LedgerGroupedTable };
