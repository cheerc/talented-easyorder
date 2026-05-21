import type { PosMode } from '../../domain/posFlow';

export const fmt = (n: number) => new Intl.NumberFormat('zh-TW').format(Math.abs(n));
export const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '');

export function getQuickAmounts(input: {
  mode: PosMode;
  todayPrice: number;
  currentDebt: number;
}): number[] {
  if (input.mode === 'payment') return [100, 500, 1000, 2000, 3000];

  const amounts = [input.todayPrice, 100, 200, 500, 1000];
  if (input.currentDebt > 0) {
    amounts.splice(1, 0, input.todayPrice + input.currentDebt);
  }
  return [...new Set(amounts)].filter(amount => Number.isInteger(amount) && amount > 0);
}
