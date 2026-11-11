/** 雲端帳戶餘額的唯一格式來源（#687）：貨幣一律 `$`、千分位；欠款為 `−$N 欠款`。 */
export const DEBT_LABEL = '欠款';

/** 只含金額：`$1,000`、`−$40`。畫面要附「欠款」警示樣式時搭配 `CloudAccountBalance`。 */
export function formatAccountBalance(amount: number): string {
  const value = new Intl.NumberFormat('zh-TW').format(Math.abs(amount));
  return amount < 0 ? `−$${value}` : `$${value}`;
}

/** 純文字（提示句、預覽）：負值為 `−$40 欠款`，其餘同 `formatAccountBalance`。 */
export function formatAccountBalanceText(amount: number): string {
  return amount < 0 ? `${formatAccountBalance(amount)} ${DEBT_LABEL}` : formatAccountBalance(amount);
}
