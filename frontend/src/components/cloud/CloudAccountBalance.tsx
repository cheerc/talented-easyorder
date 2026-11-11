import '../ui/StatusBadge.css';
import { DEBT_LABEL, formatAccountBalance } from './accountBalance';

export function CloudAccountBalance({ amount }: { amount: number }) {
  return (
    <span className="cloud-account-balance">
      <span className="cloud-account-balance__amount">{formatAccountBalance(amount)}</span>
      {amount < 0 && <>{' '}<span className="cloud-account-balance__debt">{DEBT_LABEL}</span></>}
    </span>
  );
}
