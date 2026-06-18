import type { LedgerTransaction } from './ledger';

/** Returns the income amount if the transaction represents income, or null. */
export function getIncome(tx: LedgerTransaction): number | null {
  if (tx.type === 'payment') return tx.paidAmount;
  if (tx.type === 'order' && tx.paidAmount > 0) return tx.paidAmount;
  return null;
}

/** Returns the expense amount (positive) if the transaction represents an expense, or null. */
export function getExpense(tx: LedgerTransaction): number | null {
  if (tx.type === 'order') return tx.mealPrice;
  if (tx.type === 'expense') return tx.amount;
  return null;
}
