import { unclosedPastDayIds, type CloudLedgerView } from '../../hooks/useCloudLedger';
import './LedgerUnclosedBanner.css';

/** 開帳區與日結頁共用：過去有未關帳的日子時，每次開帳、關帳都看得到的警示（契約 §11）。 */
export function LedgerUnclosedBanner({ ledger, onOpenAnomalies }: {
  ledger: CloudLedgerView | undefined;
  onOpenAnomalies?: () => void;
}) {
  const days = unclosedPastDayIds(ledger);
  if (days.length === 0) return null;
  return (
    <div className="cloud-ledger-banner" role="alert" aria-label="過去未關帳警示">
      <span>
        過去有 {days.length} 天尚未關帳（{days.join('、')}），請儘速處理，避免帳務核對越來越困難。
      </span>
      {onOpenAnomalies && (
        <button type="button" onClick={onOpenAnomalies}>查看帳務異常</button>
      )}
    </div>
  );
}
