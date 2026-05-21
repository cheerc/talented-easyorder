import { useState } from 'react';
import { fmt } from '../pos-components';
import { NumericInput } from '../ui/NumericInput';
import type { LedgerTotals } from '../../domain/ledgerReport';

interface CashClosePanelProps {
  totals: LedgerTotals;
  businessDate: string;
  dateStatus: string;
  hasQueuedRows: boolean;
  queuedRowCount?: number;
  hasFailedConflict: boolean;
  openingCash: number;
  onClose: (countedCash: number, note: string) => void;
}

export function CashClosePanel({
  totals,
  businessDate,
  dateStatus,
  hasQueuedRows,
  hasFailedConflict,
  openingCash,
  onClose,
  queuedRowCount = 0,
}: CashClosePanelProps) {
  const [countedCash, setCountedCash] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [queuedAccepted, setQueuedAccepted] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const countedNum = countedCash === '' ? 0 : countedCash;
  const expectedDrawerCash = openingCash + totals.netCash;
  const difference = countedNum - expectedDrawerCash;
  const cashEntered = countedCash !== '';
  if (dateStatus === 'closed') {
    return (
      <div className="card cash-close-panel" style={{ marginBottom: '16px', padding: '16px 20px', opacity: 0.6, pointerEvents: 'none' }}>
        <div className="card-h" style={{ marginBottom: '12px' }}>
          結帳關帳
          <span className="pill" style={{ marginLeft: '8px', background: 'var(--c-warn)' }}>已關閉</span>
        </div>
      </div>
    );
  }

  const canClose =
    note.trim().length > 0 &&
    (!hasFailedConflict) &&
    (!hasQueuedRows || queuedAccepted);

  return (
    <div className="card cash-close-panel" style={{ marginBottom: '16px', padding: '16px 20px' }}>
      <div className="card-h" style={{ marginBottom: '12px' }}>
        結帳關帳
        {dateStatus === 'closed' && <span className="pill" style={{ marginLeft: '8px', background: 'var(--c-warn)' }}>已關閉</span>}
        {dateStatus === 'reopened' && <span className="pill" style={{ marginLeft: '8px', background: 'var(--accent)' }}>已重開</span>}
      </div>

      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <div className="dim" style={{ fontSize: '12px', marginBottom: '4px' }}>開帳金額</div>
          <div className="mono" style={{ fontSize: '20px', fontWeight: 600 }}>${fmt(openingCash)}</div>
        </div>
        <div>
          <div className="dim" style={{ fontSize: '12px', marginBottom: '4px' }}>淨現金</div>
          <div className="mono" style={{ fontSize: '20px', fontWeight: 600 }}>${fmt(totals.netCash)}</div>
        </div>
        <div>
          <div className="dim" style={{ fontSize: '12px', marginBottom: '4px' }}>系統應有抽屜現金</div>
          <div className="mono" style={{ fontSize: '20px', fontWeight: 600 }}>${fmt(expectedDrawerCash)}</div>
        </div>
        <div>
          <label className="dim" htmlFor="counted-cash" style={{ fontSize: '12px', marginBottom: '4px', display: 'block' }}>
            實際點算金額
          </label>
          <NumericInput
            id="counted-cash"
            aria-label="實際點算金額"
            className="adm-input mono"
            style={{ width: '140px', fontSize: '18px' }}
            value={countedCash}
            placeholder="抽屜總現金"
            onChange={v => setCountedCash(v === '' ? '' : Number(v))}
          />
        </div>
        <div>
          <div className="dim" style={{ fontSize: '12px', marginBottom: '4px' }}>差異</div>
          <div className={'mono ' + (difference === 0 ? '' : difference > 0 ? 'pos' : 'warn')}
               style={{ fontSize: '20px', fontWeight: 600 }}>
            {!cashEntered ? '—' : difference === 0 ? '✓ 平' : `${difference > 0 ? '+' : '−'}$${fmt(Math.abs(difference))}`}
          </div>
        </div>
        <div style={{ flex: '1', minWidth: '200px' }}>
          <div className="dim" style={{ fontSize: '12px', marginBottom: '4px' }}>
            備註 <span style={{color:'var(--c-warn)',fontSize:'11px'}}>（必填）</span>
          </div>
          <input className="adm-input" value={note} placeholder="請輸入關帳備註"
                 onChange={e => setNote(e.target.value)} style={{ width: '100%' }} />
        </div>

        {hasQueuedRows && queuedRowCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="checkbox" id="queued-accept" checked={queuedAccepted} onChange={e => setQueuedAccepted(e.target.checked)} />
            <label htmlFor="queued-accept" style={{ fontSize: '12px', cursor: 'pointer', color: 'var(--c-warn)' }}>
              尚有 {queuedRowCount} 筆交易未上傳雲端，仍要結帳
            </label>
          </div>
        )}

        <button
          className="btn-confirm"
          disabled={!canClose}
          style={!canClose ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
          onClick={() => setShowConfirm(true)}>
          確認關帳
        </button>
      </div>
      {hasFailedConflict && (
        <div className="dim" style={{ color: 'var(--c-warn)', marginTop: '8px', fontSize: '12px' }}>⚠ 有同步失敗或衝突記錄，無法關帳</div>
      )}

      {showConfirm && (
        <div className="dialog-overlay" onClick={() => setShowConfirm(false)}>
          <div className="dialog-box" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <div className="dialog-h">確認關帳</div>
            <div className="dialog-body">
              <div className="dialog-row"><label>日期</label><span className="mono">{businessDate}</span></div>
              <div className="dialog-row"><label>開帳金額</label><span className="mono">${fmt(openingCash)}</span></div>
              <div className="dialog-row"><label>淨現金</label><span className="mono">${fmt(totals.netCash)}</span></div>
              <div className="dialog-row"><label>系統應有抽屜現金</label><span className="mono">${fmt(expectedDrawerCash)}</span></div>
              <div className="dialog-row"><label>實際點算</label><span className="mono">${fmt(countedNum)}</span></div>
              <div className="dialog-row">
                <label>差異</label>
                <span className={'mono ' + (difference === 0 ? '' : difference > 0 ? 'pos' : 'warn')}>{difference === 0 ? '✓ 平' : `$${fmt(difference)}`}</span>
              </div>
              {note && <div className="dialog-row"><label>備註</label><span>{note}</span></div>}
              {hasQueuedRows && <div className="dialog-row"><label>⚠</label><span style={{fontSize:'12px',color:'var(--c-warn)'}}>仍有未同步資料，已確認接受</span></div>}
            </div>
            <div className="dialog-foot">
              <button className="btn-cancel" onClick={() => setShowConfirm(false)}>取消</button>
              <button className="btn-confirm" onClick={() => { onClose(countedNum, note); setShowConfirm(false); }}>確定關帳</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}