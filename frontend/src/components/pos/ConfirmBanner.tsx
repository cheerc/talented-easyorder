import React, { useEffect } from "react";
import { fmt, sign } from './utils';

interface FlashData {
  id: number;
  name: string;
  sid: string;
  detail: string;
  amount: number;
  after?: number;
}
/**
 * M4：成功畫面出現後這段時間內的 Enter 不算「下一位」，擋住送出後很快的第二下（連按兩下）。
 * 正常一下 Enter 的人看完成功畫面再按，不會這麼快。
 */
export const NEXT_ENTER_GUARD_MS = 400;

interface ConfirmBannerProps {
  flash: FlashData | null;
  onDismiss: () => void;
  onUndo?: () => void;
  undoCountdown?: number;
}
export const ConfirmBanner = React.memo(function ConfirmBanner({ flash, onDismiss, onUndo, undoCountdown }: ConfirmBannerProps) {
  useEffect(() => {
    if (!flash) return;
    const shownAt = Date.now();
    // 送出那一下的 Enter 還按著（看到長按的重複事件）時，要等放開（keyup）才接受下一次 Enter。
    let enterHeld = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
        // M2 L05：焦點在撤回鍵上時，Enter／空白鍵交給按鈕本身，不當成「下一位」。
        if (e.key !== 'Escape' && e.target instanceof HTMLElement && e.target.dataset.undo === 'true') return;
        e.preventDefault();
        if (e.key !== 'Escape') {
          // M1 K08／M4：送出那一下的長按、還沒放開、或送出後很快的第二下，都不能把成功畫面關掉直接帶到下一位。
          if (e.repeat) { enterHeld = true; return; }
          if (enterHeld || Date.now() - shownAt < NEXT_ENTER_GUARD_MS) return;
        }
        onDismiss();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') enterHeld = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [flash, onDismiss]);

  if (!flash) return null;
  return (
    <div className="flash" key={flash.id} role="status" aria-live="polite">
      <div className="flash-card">
        <div className="flash-tick" data-testid="payment-success">✓</div>
        <div className="flash-body">
          <div className="flash-name">{flash.name}{flash.sid && <> <span className="mono flash-id">#{flash.sid}</span></>}</div>
          <div className="flash-detail">{flash.detail}</div>
          <div className={'flash-amt mono ' + (flash.amount > 0 ? 'pos' : 'neg')}>
            {sign(flash.amount)}${fmt(flash.amount)}
          </div>
        </div>
        {flash.after !== undefined && (
          <div className="flash-after">
            <div className="flash-after-lbl">餘額</div>
            <div className="flash-after-num mono">
              {flash.after < 0 ? '−' : ''}${fmt(flash.after)}
            </div>
          </div>
        )}
      </div>
      <div className="flash-count" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <span><span className="kbd kbd-light">↵</span> 下一位 · <span className="kbd kbd-light">Esc</span> 關閉</span>
        {onUndo && undoCountdown !== undefined && undoCountdown > 0 && (
          <button
            className="rpt-mini-btn rpt-mini-del"
            data-undo="true"
            onClick={(e) => { e.stopPropagation(); onUndo(); }}
            style={{ padding: '4px 12px', fontSize: '13px' }}
          >
            撤回這筆（{undoCountdown} 秒）
          </button>
        )}
      </div>
    </div>
  );
});
