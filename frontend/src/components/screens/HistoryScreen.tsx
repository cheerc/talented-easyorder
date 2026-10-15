import React, { useEffect, useRef, useState } from "react";
import { SettlementHistoryTable } from '../report/SettlementHistoryTable';
import { AuditTrailTable } from '../report/AuditTrailTable';
import { TransactionLookup } from '../report/TransactionLookup';
import type { AuditRowView } from '../../domain/auditView';
import { CASHIER_SENTINEL } from '../../domain/ledger';
import { CASHIER_QUERY } from '../../domain/transactionLookup';

type Subtab = 'settlement' | 'audit' | 'lookup';

export interface HistoryLookupTarget {
  query?: string;
  exactStudentId?: string;
  startDate?: string;
  endDate?: string;
  highlight?: string;
}

interface HistoryScreenProps {
  /** 目前檢視的營業日；交易查詢預設查這一天。 */
  viewDate?: string;
  initialSubtab?: Subtab;
  lookupTarget?: HistoryLookupTarget | null;
}

interface LookupTarget {
  query: string;
  exactStudentId?: string;
  date: string;
  startDate?: string;
  endDate?: string;
  highlight?: string;
  key: number;
}

export const HistoryScreen = React.memo(function HistoryScreen({
  viewDate,
  initialSubtab,
  lookupTarget,
}: HistoryScreenProps) {
  const [subtab, setSubtab] = useState<Subtab>(() => initialSubtab ?? (lookupTarget ? 'lookup' : 'settlement'));
  const [target, setTarget] = useState<LookupTarget>(() => {
    if (lookupTarget) {
      return {
        query: lookupTarget.query ?? '',
        exactStudentId: lookupTarget.exactStudentId,
        date: viewDate ?? '',
        startDate: lookupTarget.startDate,
        endDate: lookupTarget.endDate,
        highlight: lookupTarget.highlight,
        key: 0,
      };
    }
    return { query: '', date: viewDate ?? '', key: 0 };
  });
  const [targetDate, setTargetDate] = useState(viewDate);
  const prevLookupTargetRef = useRef(lookupTarget);

  useEffect(() => {
    if (lookupTarget && lookupTarget !== prevLookupTargetRef.current) {
      prevLookupTargetRef.current = lookupTarget;
      setSubtab('lookup');
      setTarget(t => ({
        query: lookupTarget.query ?? '',
        exactStudentId: lookupTarget.exactStudentId,
        date: viewDate ?? '',
        startDate: lookupTarget.startDate,
        endDate: lookupTarget.endDate,
        highlight: lookupTarget.highlight,
        key: t.key + 1,
      }));
    }
  }, [lookupTarget, viewDate]);

  // 換檢視日期時，若非經由跳轉鎖定特定帳戶，交易查詢回到那一天（render 期間調整）。
  if (targetDate !== viewDate) {
    setTargetDate(viewDate);
    if (!lookupTarget) {
      setTarget(t => ({ query: '', date: viewDate ?? '', key: t.key + 1 }));
    }
  }

  // M3 F12：稽核列「看原單」→ 交易查詢，帶入帳戶與當天，並標出那一筆。
  const openOriginal = (row: AuditRowView) => {
    const query = row.studentId === CASHIER_SENTINEL ? CASHIER_QUERY : row.studentId ?? '';
    setTarget(t => ({ query, date: row.businessDate, highlight: row.transactionId, key: t.key + 1 }));
    setSubtab('lookup');
  };

  const tabs: { id: Subtab; label: string }[] = [
    { id: 'settlement', label: '結帳歷史' },
    { id: 'audit', label: '稽核軌跡' },
    { id: 'lookup', label: '交易查詢' },
  ];

  return (
    <div className="screen history">
      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '0', marginBottom: '16px' }}>
          {tabs.map(t => (
            <button key={t.id} className={`tab ${subtab === t.id ? 'tab-on' : ''}`} onClick={() => setSubtab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {subtab === 'settlement' && <SettlementHistoryTable />}
      {subtab === 'audit' && <AuditTrailTable onOpenOriginal={openOriginal} />}
      {subtab === 'lookup' && (
        <TransactionLookup
          key={target.key}
          defaultDate={target.date}
          initialStartDate={target.startDate}
          initialEndDate={target.endDate}
          initialQuery={target.query}
          exactStudentId={target.exactStudentId}
          highlightTransactionId={target.highlight}
        />
      )}
    </div>
  );
});
