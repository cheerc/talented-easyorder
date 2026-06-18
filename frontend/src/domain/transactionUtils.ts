import type { LedgerTransaction } from './ledger';

/** Returns income amount for display, or null if this tx has no income component */
export function getIncome(tx: LedgerTransaction): number | null {
  if (tx.type === 'payment') return tx.paidAmount;
  if (tx.type === 'order' && tx.paidAmount > 0) return tx.paidAmount;
  return null;
}

/** Returns expense amount for display, or null if this tx has no expense component */
export function getExpense(tx: LedgerTransaction): number | null {
  if (tx.type === 'order') return tx.mealPrice;
  if (tx.type === 'expense') return tx.amount;
  return null;
}
