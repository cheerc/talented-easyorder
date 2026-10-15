import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSession, useStudents, useTransactions } from '../../store/selectors';
import { buildLookupRows, balanceAtEndOf, findLookupAccountIds } from '../../domain/transactionLookup';
import { describeAuditEvents } from '../../domain/auditView';
import { CASHIER_SENTINEL } from '../../domain/ledger';
import { formatTaipeiTime } from '../../utils/dateTime';
import { fmt } from '../pos-components';

const COLUMNS = '100px 80px 150px 80px 90px 90px 110px 1fr 90px';
const TYPE_LABELS: Record<string, string> = { order: '訂餐', payment: '繳費', expense: '櫃台收支' };

export interface TransactionLookupProps {
  /** 預設的區間（起訖同一天）。 */
  defaultDate: string;
  /** 起始營業日（選填）。 */
  initialStartDate?: string;
  /** 結束營業日（選填）。 */
  initialEndDate?: string;
  /** 從稽核「看原單」或 E「付款明細」帶進來的帳戶查詢字。 */
  initialQuery?: string;
  /** 要標出來的交易。 */
  highlightTransactionId?: string;
  /** 精確帳戶鎖定（選填；指定時優先精確鎖定該帳戶，手動修改搜尋文字時解除鎖定）。 */
  exactStudentId?: string;
  exactAccountId?: string;
}

const money = (n: number) => `${n < 0 ? '−' : ''}$${fmt(Math.abs(n))}`;

/**
 * M3 F12／D05：F5「交易查詢」。依帳戶編號、姓名或別名與營業日區間查交易，
 * 已刪除的原單從稽核找回並標示；每筆可展開看更正紀錄。
 */
export const TransactionLookup = React.memo(function TransactionLookup({
  defaultDate,
  initialStartDate,
  initialEndDate,
  initialQuery = '',
  highlightTransactionId,
  exactStudentId,
  exactAccountId,
}: TransactionLookupProps) {
  const initialExactId = exactStudentId ?? exactAccountId;
  const { transactions } = useTransactions();
  const { auditEvents } = useSession();
  const { students } = useStudents();
  const [query, setQuery] = useState(initialQuery);
  const [exactId, setExactId] = useState<string | undefined>(initialExactId);
  const [start, setStart] = useState(initialStartDate ?? defaultDate);
  const [end, setEnd] = useState(initialEndDate ?? defaultDate);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(highlightTransactionId ? [highlightTransactionId] : []));
  const highlightRef = useRef<HTMLDivElement | null>(null);

  const accountIds = useMemo(() => {
    if (exactId) {
      return [exactId];
    }
    return findLookupAccountIds(students, query);
  }, [students, query, exactId]);
  const [from, to] = start <= end ? [start, end] : [end, start];
  const rows = useMemo(
    () => buildLookupRows({ transactions, auditEvents, accountIds, start: from, end: to }),
    [transactions, auditEvents, accountIds, from, to],
  );
  const auditRows = useMemo(() => describeAuditEvents(auditEvents, transactions, students), [auditEvents, transactions, students]);
  const single = accountIds?.length === 1 ? students.find(s => s.studentId === accountIds[0]) : undefined;

  useEffect(() => {
    highlightRef.current?.scrollIntoView?.({ block: 'center' });
  }, [highlightTransactionId]);

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="rpt-table">
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', padding: '8px 0 12px' }}>
        <input
          className="adm-input"
          aria-label="查詢帳戶"
          placeholder="帳戶編號、姓名或別名；空白＝全部，「櫃台」＝櫃台收支"
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setExactId(undefined);
          }}
          style={{ width: '100%', maxWidth: '340px' }}
        />
        <label className="dim" style={{ fontSize: '13px' }}>營業日</label>
        <input type="date" className="adm-input mono" aria-label="起始營業日" value={start} onChange={e => setStart(e.target.value)} />
        <span className="dim">到</span>
        <input type="date" className="adm-input mono" aria-label="結束營業日" value={end} onChange={e => setEnd(e.target.value)} />
      </div>

      {single && (
        <div role="note" style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', margin: '0 0 12px', fontSize: '14px' }}>
          <strong>{single.studentId} {single.displayName}{single.status !== 'active' ? '（已停用）' : ''}</strong>
          <span>現在餘額 <span className="mono">{money(single.currentBalance)}</span></span>
          <span>{to} 結束時餘額 <span className="mono">{money(balanceAtEndOf(transactions, single, to))}</span></span>
        </div>
      )}
      {accountIds && accountIds.length === 0 && <div className="rpt-empty">找不到符合「{query.trim()}」的帳戶</div>}

      <div className="rpt-th" style={{ display: 'grid', gridTemplateColumns: COLUMNS }}>
        <div>營業日</div>
        <div>時間（台北）</div>
        <div>帳戶</div>
        <div>類型</div>
        <div className="r">應收</div>
        <div className="r">實收</div>
        <div className="r">這筆之後</div>
        <div>備註</div>
        <div>更正</div>
      </div>
      {rows.length === 0 && (!accountIds || accountIds.length > 0) && <div className="rpt-empty">這段期間沒有交易</div>}
      {rows.map(r => {
        const isHighlight = r.transactionId === highlightTransactionId;
        const history = expanded.has(r.transactionId) ? auditRows.filter(a => a.transactionId === r.transactionId) : [];
        return (
          <div key={r.transactionId} ref={isHighlight ? highlightRef : undefined} data-highlight={isHighlight || undefined}>
            <div className="rpt-tr" style={{
              display: 'grid', gridTemplateColumns: COLUMNS,
              background: isHighlight ? 'var(--accent-soft, rgba(234, 140, 40, 0.15))' : undefined,
              textDecoration: r.deleted ? 'line-through' : undefined,
              opacity: r.deleted ? 0.7 : undefined,
            }}>
              <div className="mono">{r.businessDate}</div>
              <div className="mono dim" style={{ fontSize: '12px' }}>{formatTaipeiTime(r.createdAt)}</div>
              <div>{r.studentId === CASHIER_SENTINEL ? '櫃台' : `${r.studentId} ${r.studentName}`}</div>
              <div>{TYPE_LABELS[r.type] ?? r.type}{r.deleted && <span className="pill pill-err" style={{ marginLeft: '4px', fontSize: '11px', textDecoration: 'none' }}>已刪除</span>}</div>
              <div className="r mono">{money(r.mealPrice)}</div>
              <div className="r mono">{money(r.paidAmount)}</div>
              <div className="r mono">{r.afterBalance === null ? '—' : money(r.afterBalance)}</div>
              <div className="dim" style={{ fontSize: '13px' }}>{r.note || '-'}</div>
              <div>
                {r.auditCount > 0 && (
                  <button className="rpt-mini-btn" aria-expanded={expanded.has(r.transactionId)} onClick={() => toggle(r.transactionId)}>
                    {r.auditCount} 次
                  </button>
                )}
              </div>
            </div>
            {history.length > 0 && (
              <div style={{ padding: '4px 12px 10px 120px', fontSize: '13px' }}>
                {history.map(a => (
                  <div key={a.auditEventId} style={{ marginBottom: '4px' }}>
                    <span className="mono dim">{a.time}</span>
                    <span className={a.typeClass} style={{ margin: '0 6px' }}>{a.typeLabel}</span>
                    <span>{a.changes}</span>
                    {a.reason && <span className="dim" style={{ marginLeft: '12px' }}>理由：{a.reason}</span>}
                    <span className="dim" style={{ marginLeft: '12px' }}>{a.operator}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});
