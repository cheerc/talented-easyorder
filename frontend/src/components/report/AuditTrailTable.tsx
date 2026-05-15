import React, { useMemo } from 'react';
import { usePosStore } from '../../store/posStore';
import type { LedgerAuditEvent } from '../../domain/ledgerAudit';

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
  if (!before || !after) return '-';
  const changes: string[] = [];
  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) {
      changes.push(`${key}: ${before[key]} → ${after[key]}`);
    }
  }
  return changes.length > 0 ? changes.join('; ') : '-';
}

export const AuditTrailTable = React.memo(function AuditTrailTable() {
  const auditEvents = usePosStore((s) => s.auditEvents);

  const sorted = useMemo(() => {
    return [...auditEvents].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [auditEvents]);

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
      {sorted.map((e) => (
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
    </div>
  );
});
