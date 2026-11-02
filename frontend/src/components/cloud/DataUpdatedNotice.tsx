// #587 P2: the cloud pages that hold a form or a long list do not reload by themselves (that would drop what the operator is
// typing). They show this one line instead when another device of the same account has written since the page last read, and let
// the operator reload when it suits them.
import { useDataHead } from '../../providers/FirebaseProvider';
import './DataUpdatedNotice.css';

export interface DataUpdatedNoticeProps {
  /** The data sequence of what the page shows; `null` while it shows nothing yet. */
  pageSeq: number | null;
  /** The page's own reload. */
  onReload: () => void;
  /** True while the page itself is reading or has a command of its own in flight: its own writes must not look like another device's. */
  hidden?: boolean;
}

export function DataUpdatedNotice({ pageSeq, onReload, hidden = false }: DataUpdatedNoticeProps) {
  const head = useDataHead();
  if (hidden || head === null || pageSeq === null || head.seq <= pageSeq) return null;
  return (
    <div className="data-updated-notice" role="status" data-testid="data-updated-notice">
      <span>其他裝置已更新資料。</span>
      <button type="button" className="data-updated-notice__button" onClick={onReload}>重新載入</button>
    </div>
  );
}
