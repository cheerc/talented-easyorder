import React, { useMemo, useState } from 'react';
import { useSession, useTransactions } from '../../store/selectors';
import { describeAuditEvents } from '../../domain/auditView';

const PAGE_SIZE = 20;
const COLUMNS = '160px 90px 110px 150px 1fr 100px';

/**
 * M2 F09／F10：稽核紀錄以帳戶、營業日或交易編號查詢；每列寫出帳戶、中文欄名的前後值與理由，
 * 時間一律台北時間，營業日另成一欄。
 */
export const AuditTrailTable = React.memo(function AuditTrailTable() {
  const { auditEvents } = useSession();
  const { transactions } = useTransactions();
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');

  const rows = useMemo(() => describeAuditEvents(auditEvents, transactions), [auditEvents, transactions]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter(r => r.searchText.includes(q)) : rows;
  }, [rows, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  if (rows.length === 0) {
    return <div className="rpt-empty">尚無稽核紀錄</div>;
  }

  return (
    <div className="rpt-table">
      <div style={{ padding: '8px 0 12px' }}>
        <input
          className="adm-input"
          aria-label="查詢稽核紀錄"
          placeholder="輸入帳戶編號、姓名或營業日（例如 001、王、2026-05-30）"
          value={query}
          onChange={e => { setQuery(e.target.value); setPage(0); }}
          style={{ width: '100%', maxWidth: '420px' }}
        />
      </div>
      <div className="rpt-th" style={{ display: 'grid', gridTemplateColumns: COLUMNS }}>
        <div>時間（台北）</div>
        <div>操作</div>
        <div>操作人</div>
        <div>帳戶</div>
        <div>變更內容與理由</div>
        <div>營業日</div>
      </div>
      {paged.length === 0 && <div className="rpt-empty">沒有符合「{query.trim()}」的紀錄</div>}
      {paged.map(r => (
        <div key={r.auditEventId} className="rpt-tr" style={{ display: 'grid', gridTemplateColumns: COLUMNS }}>
          <div className="mono dim" style={{ fontSize: '12px' }}>{r.time}</div>
          <div><span className={r.typeClass}>{r.typeLabel}</span></div>
          <div>{r.operator}</div>
          <div>{r.subject}</div>
          <div style={{ fontSize: '13px' }}>
            <div>{r.changes}</div>
            {r.reason && <div className="dim">理由：{r.reason}</div>}
          </div>
          <div className="mono">{r.businessDate}</div>
        </div>
      ))}
      {filtered.length > PAGE_SIZE && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', padding: '12px 0' }}>
          <button className="ghost-btn" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一頁</button>
          <span className="dim" style={{ fontSize: '13px' }}>第 {currentPage + 1} / {totalPages} 頁（共 {filtered.length} 筆）</span>
          <button className="ghost-btn" disabled={currentPage >= totalPages - 1} onClick={() => setPage(currentPage + 1)}>下一頁</button>
        </div>
      )}
    </div>
  );
});
