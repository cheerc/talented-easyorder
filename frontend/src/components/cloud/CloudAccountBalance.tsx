import { StatusBadge } from '../ui/StatusBadge';
import { formatAccountBalance, type BalanceCurrency } from './accountBalance';

export function CloudAccountBalance({ amount, currency = 'NT$' }: {
  amount: number;
  currency?: BalanceCurrency;
}) {
  return (
    <span className="cloud-account-balance">
      <span className="cloud-account-balance__amount">{formatAccountBalance(amount, currency)}</span>
      {amount < 0 && (
        <StatusBadge variant="warn" className="cloud-account-balance__debt">欠款</StatusBadge>
      )}
    </span>
  );
}
