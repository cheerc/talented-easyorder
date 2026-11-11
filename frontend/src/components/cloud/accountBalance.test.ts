import { describe, expect, it } from 'vitest';
import { DEBT_LABEL, formatAccountBalance, formatAccountBalanceText } from './accountBalance';

describe('accountBalance（#687：雲端帳戶餘額唯一格式來源）', () => {
  it('formats the amount with a $ sign and thousands separators; negatives use the minus sign', () => {
    expect(formatAccountBalance(0)).toBe('$0');
    expect(formatAccountBalance(15)).toBe('$15');
    expect(formatAccountBalance(1000)).toBe('$1,000');
    expect(formatAccountBalance(-40)).toBe('−$40');
    expect(formatAccountBalance(-1234)).toBe('−$1,234');
  });

  it('adds the 欠款 label only to negative balances in plain-text output', () => {
    expect(DEBT_LABEL).toBe('欠款');
    expect(formatAccountBalanceText(-1234)).toBe('−$1,234 欠款');
    expect(formatAccountBalanceText(-1)).toBe('−$1 欠款');
    expect(formatAccountBalanceText(0)).toBe('$0');
    expect(formatAccountBalanceText(1000)).toBe('$1,000');
  });
});
