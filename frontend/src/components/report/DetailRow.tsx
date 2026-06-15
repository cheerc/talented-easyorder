import React from 'react';
import { fmt } from '../pos-components';
import type { MergedTransaction } from '../../domain/ledger';
import type { ReportTransactionView } from '../../domain/transactionViews';
import { CASHIER_SENTINEL } from '../../store/posStore';

export interface DetailRowProps {
  tx: ReportTransactionView;
  locked: boolean;
  displayMode: 'merged' | 'original';
  onEditClick: (t: ReportTransactionView) => void;
  onDeleteClick: (t: ReportTransactionView) => void;
}

export const DETAIL_ROW_HEIGHT = 40;

const TYPE_LABEL: Record<string, string> = { order: '訂餐', payment: '繳費', expense: '支出' };

export const DetailRow = React.memo(function DetailRow({ tx: t, locked, displayMode, onEditClick, onDeleteClick }: DetailRowProps) {
  const merged = t as Partial<MergedTransaction>;
  return (
    <div key={`d-${t.transactionId}`} className="rpt-detail-row" style={{ display: 'grid', gridTemplateColumns: '80px 60px 100px 1fr 1fr 1fr auto', height: DETAIL_ROW_HEIGHT, alignItems: 'center', padding: '0 18px' }}>
      <div className="mono dim">{t.createdAt.slice(11, 19)}</div>
      <div className="dim">{TYPE_LABEL[t.type] ?? t.type}</div>
      <div className="dim"></div>
      <div className={'r mono ' + (t.mealPrice > 0 ? 'neg' : t.mealPrice < 0 ? 'pos' : '')}>
        {t.mealPrice !== 0 ? <>{t.mealPrice > 0 ? '−' : '+'}${fmt(Math.abs(t.mealPrice))}</> : <>-</>}
      </div>
      <div className={'r mono ' + (t.paidAmount > 0 ? 'pos' : '')}>
        {t.paidAmount > 0 ? (
          <>
            +${fmt(t.paidAmount)}
            {displayMode === 'merged' && (merged.depositAmount ?? 0) > 0 && (
              <span style={{ fontSize: '11px', color: '#16a34a', marginLeft: '4px' }}>
                (儲 +${fmt(merged.depositAmount!)})
              </span>
            )}
          </>
        ) : (
          <>-</>
        )}
      </div>
      <div className={'r mono ' + (t.afterBalance < 0 ? 'warn' : '')}>
        {displayMode === 'merged' && (merged.unpaidAmount ?? 0) > 0 ? (
          <span className="warn" style={{ fontWeight: 600 }}>
            待繳費 ${fmt(merged.unpaidAmount!)}
          </span>
        ) : (
          <>{t.afterBalance < 0 ? '−' : ''}${fmt(Math.abs(t.afterBalance))}</>
        )}
      </div>
      <div className="rpt-detail-actions">
        <span className="dim italic rpt-detail-note">{t.note}</span>
        <div className="rpt-row-actions">
        {locked ? (
          <span className="dim" style={{fontSize:'11px'}}>🔒 已關帳</span>
        ) : displayMode === 'merged' && t.studentId !== CASHIER_SENTINEL ? (
          <span className="dim" style={{fontSize:'11px'}}>🔒 請切換至原始模式進行編輯或刪除</span>
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
});
