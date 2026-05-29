import React, { useState } from "react";
import { SettlementHistoryTable } from '../report/SettlementHistoryTable';
import { AuditTrailTable } from '../report/AuditTrailTable';

export const HistoryScreen = React.memo(function HistoryScreen() {
  const [subtab, setSubtab] = useState<'settlement' | 'audit'>('settlement');

  return (
    <div className="screen history">
      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '0', marginBottom: '16px' }}>
          <button
            className={`tab ${subtab === 'settlement' ? 'tab-on' : ''}`}
            onClick={() => setSubtab('settlement')}
          >
            結帳歷史
          </button>
          <button
            className={`tab ${subtab === 'audit' ? 'tab-on' : ''}`}
            onClick={() => setSubtab('audit')}
          >
            稽核軌跡
          </button>
        </div>
      </div>

      {subtab === 'settlement' ? (
        <SettlementHistoryTable />
      ) : (
        <AuditTrailTable />
      )}
    </div>
  );
});
