import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { usePosStore } from '../../store/posStore';
import type { LedgerAuditEvent } from '../../domain/ledgerAudit';

const PAGE_SIZE = 20;

function eventTypeLabel(t: LedgerAuditEvent['eventType']) {
  switch (t) {
    case 'transaction_edited': return '編輯';
    case 'transaction_corrected': return '更正';
    case 'transaction_voided': return '作廢';
    case 'transaction_hard_deleted': return '刪除';
    case 'business_date_closed': return '關帳';
    case 'business_date_reopened': return '重開';
    case 'csv_exported': return '匯出 CSV';
    case 'report_printed': return '列印';
  }
}

function eventTypeClass(t: LedgerAuditEvent['eventType']) {
  switch (t) {
    case 'transaction_corrected': return 'pill-warn';
    case 'transaction_voided': return 'pill-err';
    case 'transaction_hard_deleted': return 'pill-err';
    case 'business_date_closed': return 'pill-ok';
    case 'business_date_reopened': return 'pill-warn';
    default: return 'pill';
  }
}

function beforeAfterSummary(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string {
  if (!before) return after ? '(新建)' : '-';
  if (!after) return '(已刪除)';
  const changes: string[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of allKeys) {
    const bv = before[key];
    const av = after[key];
    if (bv !== av) {
      if (bv === undefined) changes.push(`${key}: (無) → ${av}`);
      else if (av === undefined) changes.push(`${key}: ${bv} → (無)`);
      else changes.push(`${key}: ${bv} → ${av}`);
    }
  }
  return changes.length > 0 ? changes.join('; ') : '-';
}

export const AuditTrailTable = React.memo(function AuditTrailTable() {
  const auditEvents = usePosStore(useShallow((s) => s.auditEvents));
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    return [...auditEvents].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [auditEvents]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (sorted.length === 0) {
    return <div className="rpt-empty">尚無稽核紀錄</div>;
  }

  return (
    <div className="rpt-table">
      <div className="rpt-th" style={{ display: 'grid', gridTemplateColumns: '160px 100px 120px 200px 1fr 80px' }}>
        <div>時間</div>
        <div>操作類型</div>
        <div>操作人</div>
        <div>對象</div>
        <div>變更摘要</div>
        <div>日期</div>
      </div>
      {paged.map((e) => (
        <div
          key={e.auditEventId}
          className="rpt-tr"
          style={{ display: 'grid', gridTemplateColumns: '160px 100px 120px 200px 1fr 80px' }}
        >
          <div className="mono dim" style={{ fontSize: '12px' }}>{e.createdAt.slice(0, 19).replace('T', ' ')}</div>
          <div><span className={eventTypeClass(e.eventType)}>{eventTypeLabel(e.eventType)}</span></div>
          <div>{e.operatorId}</div>
          <div className="mono dim" style={{ fontSize: '12px' }}>{e.entityType}: {e.entityId.slice(0, 12)}…</div>
          <div className="dim" style={{ fontSize: '12px' }}>{beforeAfterSummary(e.before, e.after)}</div>
          <div className="mono">{e.businessDate}</div>
        </div>
      ))}
      {sorted.length > PAGE_SIZE && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', padding: '12px 0' }}>
          <button className="ghost-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>上一頁</button>
          <span className="dim" style={{ fontSize: '13px' }}>第 {page + 1} / {totalPages} 頁（共 {sorted.length} 筆）</span>
          <button className="ghost-btn" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>下一頁</button>
        </div>
      )}
    </div>
  );
});
