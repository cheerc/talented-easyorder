import React, { useEffect } from "react";
import { fmt, sign } from './utils';

interface FlashData {
  id: number;
  name: string;
  sid: string;
  detail: string;
  amount: number;
  after: number;
}
interface ConfirmBannerProps {
  flash: FlashData | null;
  onDismiss: () => void;
  onUndo?: () => void;
  undoCountdown?: number;
}
export const ConfirmBanner = React.memo(function ConfirmBanner({ flash, onDismiss, onUndo, undoCountdown }: ConfirmBannerProps) {
  useEffect(() => {
    if (!flash) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
        e.preventDefault();
        onDismiss();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flash, onDismiss]);

  if (!flash) return null;
  return (
    <div className="flash" key={flash.id} role="status" aria-live="polite">
      <div className="flash-card">
        <div className="flash-tick">✓</div>
        <div className="flash-body">
          <div className="flash-name">{flash.name} <span className="mono flash-id">#{flash.sid}</span></div>
          <div className="flash-detail">{flash.detail}</div>
          <div className={'flash-amt mono ' + (flash.amount > 0 ? 'pos' : 'neg')}>
            {sign(flash.amount)}${fmt(flash.amount)}
          </div>
        </div>
        <div className="flash-after">
          <div className="flash-after-lbl">餘額</div>
          <div className="flash-after-num mono">
            {flash.after < 0 ? '−' : ''}${fmt(flash.after)}
          </div>
        </div>
      </div>
      <div className="flash-count" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <span><span className="kbd kbd-light">↵</span> 下一位 · <span className="kbd kbd-light">Esc</span> 關閉</span>
        {onUndo && undoCountdown !== undefined && undoCountdown > 0 && (
          <button
            className="rpt-mini-btn rpt-mini-del"
            onClick={(e) => { e.stopPropagation(); onUndo(); }}
            style={{ padding: '4px 12px', fontSize: '13px' }}
          >
            復原 ({undoCountdown}s)
          </button>
        )}
      </div>
    </div>
  );
});
