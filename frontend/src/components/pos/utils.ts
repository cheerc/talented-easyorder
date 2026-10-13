export interface KeyboardEventWithFlag extends KeyboardEvent { __handledByExpensePanel?: boolean }

export const fmt = (n: number) => new Intl.NumberFormat('zh-TW').format(Math.abs(n));
export const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '');
/** 金額：負數前面加「−」（fmt 只給絕對值）。淨現金、應有現金可能是負的，不能顯示成正數。 */
export const money = (n: number) => `${n < 0 ? '−' : ''}$${fmt(n)}`;

export function getQuickAmounts(input: {
  mode: import('../../domain/posFlow').PosMode;
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
