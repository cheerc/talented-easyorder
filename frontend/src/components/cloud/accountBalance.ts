export type BalanceCurrency = 'NT$' | '$';

export function formatAccountBalance(amount: number, currency: BalanceCurrency = 'NT$'): string {
  const value = new Intl.NumberFormat('zh-TW').format(Math.abs(amount));
  const formatted = currency === 'NT$' ? `NT$ ${value}` : `$${value}`;
  return amount < 0 ? `−${formatted}` : formatted;
}
