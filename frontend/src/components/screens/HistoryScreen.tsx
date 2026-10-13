import React, { useState } from "react";
import { SettlementHistoryTable } from '../report/SettlementHistoryTable';
import { AuditTrailTable } from '../report/AuditTrailTable';
import { TransactionLookup } from '../report/TransactionLookup';
import type { AuditRowView } from '../../domain/auditView';
import { CASHIER_SENTINEL } from '../../domain/ledger';
import { CASHIER_QUERY } from '../../domain/transactionLookup';

type Subtab = 'settlement' | 'audit' | 'lookup';

interface HistoryScreenProps {
  /** 目前檢視的營業日；交易查詢預設查這一天。 */
  viewDate?: string;
}

interface LookupTarget { query: string; date: string; highlight?: string; key: number }

export const HistoryScreen = React.memo(function HistoryScreen({ viewDate }: HistoryScreenProps) {
  const [subtab, setSubtab] = useState<Subtab>('settlement');
  const [target, setTarget] = useState<LookupTarget>({ query: '', date: viewDate ?? '', key: 0 });
  const [targetDate, setTargetDate] = useState(viewDate);
  // 換檢視日期時，交易查詢回到那一天（render 期間調整）。
  if (targetDate !== viewDate) {
    setTargetDate(viewDate);
    setTarget(t => ({ query: '', date: viewDate ?? '', key: t.key + 1 }));
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
          initialQuery={target.query}
          highlightTransactionId={target.highlight}
        />
      )}
    </div>
  );
});
