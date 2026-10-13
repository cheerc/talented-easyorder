import { useState } from 'react';
import { fmt } from '../pos-components';
import { NumericInput } from '../ui/NumericInput';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import type { LedgerTotals } from '../../domain/ledgerReport';
import type { LedgerMutationResult } from '../../domain/ledgerAudit';
import { OPENING_CASH_MISSING_MESSAGE, CASH_DIFFERENCE_NOTE_MESSAGE } from '../../domain/cashClose';

interface CashClosePanelProps {
  /** M3：這一天全部交易的合計（不受 F2 的區間與搜尋影響）。 */
  totals: LedgerTotals;
  businessDate: string;
  dateStatus: string;
  hasQueuedRows: boolean;
  queuedRowCount?: number;
  hasFailedConflict: boolean;
  /** 本人在 F3 確認過的開帳金額；null 表示還沒設定，不能關帳。 */
  openingCash: number | null;
  onClose: (countedCash: number, note: string) => LedgerMutationResult;
  /** M3：放在 F2「日末點現金」裡展開時，不再自己畫卡片與標題。 */
  embedded?: boolean;
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
  embedded = false,
}: CashClosePanelProps) {
  const [countedCash, setCountedCash] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [queuedAccepted, setQueuedAccepted] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const countedNum = countedCash === '' ? 0 : countedCash;
  const hasOpeningCash = openingCash !== null;
  const expectedDrawerCash = (openingCash ?? 0) + totals.netCash;
  const difference = countedNum - expectedDrawerCash;
  const cashEntered = countedCash !== '';
  const needsNote = cashEntered && difference !== 0;
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

  // M3：要先有開帳金額、輸入實際點算；差額為 0 不必寫原因，有差額一定要寫。
  const canClose =
    hasOpeningCash &&
    cashEntered &&
    (!needsNote || note.trim().length > 0) &&
    (!hasFailedConflict) &&
    (!hasQueuedRows || queuedAccepted);

  const confirmClose = () => {
    const result = onClose(countedNum, note);
    setShowConfirm(false);
    setCloseError(result.ok ? null : result.message);
  };

  return (
    <div className={embedded ? 'cash-close-panel' : 'card cash-close-panel'} style={embedded ? undefined : { marginBottom: '16px', padding: '16px 20px' }}>
      {!embedded && (
        <div className="card-h" style={{ marginBottom: '12px' }}>
          結帳關帳
          {dateStatus === 'reopened' && <span className="pill" style={{ marginLeft: '8px', background: 'var(--accent)' }}>已重開</span>}
        </div>
      )}

      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <div className="dim" style={{ fontSize: '12px', marginBottom: '4px' }}>開帳金額</div>
          <div className="mono" style={{ fontSize: '20px', fontWeight: 600 }}>{openingCash !== null ? `$${fmt(openingCash)}` : '未設定'}</div>
        </div>
        <div>
          <div className="dim" style={{ fontSize: '12px', marginBottom: '4px' }}>淨現金</div>
          <div className="mono" style={{ fontSize: '20px', fontWeight: 600 }}>${fmt(totals.netCash)}</div>
        </div>
        <div>
          <div className="dim" style={{ fontSize: '12px', marginBottom: '4px' }}>系統應有抽屜現金</div>
          <div className="mono" style={{ fontSize: '20px', fontWeight: 600 }}>{hasOpeningCash ? `$${fmt(expectedDrawerCash)}` : '—'}</div>
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
            onChange={v => { setCountedCash(v === '' ? '' : Number(v)); setCloseError(null); }}
          />
        </div>
        <div>
          <div className="dim" style={{ fontSize: '12px', marginBottom: '4px' }}>差異</div>
          <div className={'mono ' + (difference === 0 ? '' : difference > 0 ? 'pos' : 'warn')}
               style={{ fontSize: '20px', fontWeight: 600 }}>
            {!cashEntered || !hasOpeningCash ? '—' : difference === 0 ? '✓ 平' : `${difference > 0 ? '+' : '−'}$${fmt(Math.abs(difference))}`}
          </div>
        </div>
        <div style={{ flex: '1', minWidth: '200px' }}>
          <div className="dim" style={{ fontSize: '12px', marginBottom: '4px' }}>
            備註 <span style={{color: needsNote ? 'var(--c-warn)' : 'var(--ink-3)',fontSize:'11px'}}>{needsNote ? '（有差額，必填原因）' : '（選填）'}</span>
          </div>
          <input className="adm-input" aria-label="關帳備註" value={note} placeholder={needsNote ? '例如：點算短少10，待查' : '選填'}
                 onChange={e => { setNote(e.target.value); setCloseError(null); }} style={{ width: '100%' }} />
        </div>

        {hasQueuedRows && queuedRowCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="checkbox" id="queued-accept" checked={queuedAccepted} onChange={e => setQueuedAccepted(e.target.checked)} />
            <label htmlFor="queued-accept" style={{ fontSize: '12px', cursor: 'pointer', color: 'var(--c-warn)' }}>
              尚有 {queuedRowCount} 筆交易未上傳雲端，仍要結帳
            </label>
          </div>
        )}

        <Button
          variant="primary"
          disabled={!canClose}
          onClick={() => setShowConfirm(true)}
        >
          確認關帳
        </Button>
      </div>
      {!hasOpeningCash && (
        <div role="status" style={{ color: 'var(--c-warn)', marginTop: '8px', fontSize: '13px' }}>{OPENING_CASH_MISSING_MESSAGE}</div>
      )}
      {hasOpeningCash && needsNote && !note.trim() && (
        <div style={{ color: 'var(--c-warn)', marginTop: '8px', fontSize: '13px' }}>{CASH_DIFFERENCE_NOTE_MESSAGE}</div>
      )}
      {closeError && (
        <div role="alert" style={{ color: 'var(--c-warn)', marginTop: '8px', fontSize: '13px' }}>沒有關帳：{closeError}</div>
      )}
      {hasFailedConflict && (
        <div className="dim" style={{ color: 'var(--c-warn)', marginTop: '8px', fontSize: '12px' }}>⚠ 有同步失敗或衝突記錄，無法關帳</div>
      )}

      <Modal open={showConfirm} title="確認關帳" onClose={() => setShowConfirm(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><label>日期</label><span className="mono">{businessDate}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><label>開帳金額</label><span className="mono">${fmt(openingCash ?? 0)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><label>淨現金</label><span className="mono">${fmt(totals.netCash)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><label>系統應有抽屜現金</label><span className="mono">${fmt(expectedDrawerCash)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><label>實際點算</label><span className="mono">${fmt(countedNum)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <label>差異</label>
            <span className={'mono ' + (difference === 0 ? '' : difference > 0 ? 'pos' : 'warn')}>{difference === 0 ? '✓ 平' : `${difference > 0 ? '+' : '−'}$${fmt(Math.abs(difference))}`}</span>
          </div>
          {note && <div style={{ display: 'flex', justifyContent: 'space-between' }}><label>備註</label><span>{note}</span></div>}
          {hasQueuedRows && <div style={{ display: 'flex', justifyContent: 'space-between' }}><label>⚠</label><span style={{fontSize:'12px',color:'var(--c-warn)'}}>仍有未同步資料，已確認接受</span></div>}
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => setShowConfirm(false)}>取消</Button>
          <Button variant="primary" onClick={confirmClose}>確定關帳</Button>
        </div>
      </Modal>
    </div>
  );
}