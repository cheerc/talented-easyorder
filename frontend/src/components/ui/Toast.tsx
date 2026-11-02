import { useEffect, useRef, useState, type ReactNode } from 'react';
import './Toast.css';

interface ToastProps {
  /** 一句話；空字串表示沒有內容。 */
  message: string;
  /** 例如撤回列。 */
  action?: ReactNode;
  /** 自動隱藏的毫秒數，預設 4000。只在 message 換新時開始計時；單獨改變時長不會重新計時。 */
  durationMs?: number;
  testId?: string;
}

/**
 * 固定在畫面底部中央的短暫通知（#585）。逾時只隱藏畫面，不清呼叫端的狀態。
 * 外層 live region 永遠存在，內容才會被可靠朗讀。
 */
export function Toast({ message, action, durationMs = 4000, testId = 'toast' }: ToastProps) {
  // Which message has been dismissed (by its timer or its close button). A timer of an older message that fires before its
  // cleanup ran can only dismiss that older message, never the one on screen.
  const [dismissed, setDismissed] = useState<string | null>(null);
  // A new message shows again: adjust state while rendering (React's documented pattern) instead of in an effect.
  const [shownMessage, setShownMessage] = useState(message);
  if (shownMessage !== message) {
    setShownMessage(message);
    setDismissed(null);
  }
  const durationRef = useRef(durationMs);
  useEffect(() => { durationRef.current = durationMs; });
  useEffect(() => {
    const timer = window.setTimeout(() => setDismissed(message), durationRef.current);
    return () => window.clearTimeout(timer);
  }, [message]);

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {dismissed !== message && (message || action) && (
        <div className="toast" data-testid={testId}>
          {message && <span className="toast__text">{message}</span>}
          {action}
          <button type="button" className="toast__close" aria-label="關閉通知" onClick={() => setDismissed(message)}>×</button>
        </div>
      )}
    </div>
  );
}
