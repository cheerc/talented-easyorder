import { describe, expect, it } from 'vitest';
import { effectiveClosingCash, isPostCloseEntryCounted, postCloseNet } from '../postCloseEntries';

const entry = (settlementRevision: number, direction: 'income' | 'expense', amount: number) => ({ settlementRevision, direction, amount });

describe('關帳後補記的有效關帳現金（契約 §15.3）', () => {
  it('收入加、支出減，只計入目前日結版本的補記', () => {
    const entries = [entry(1, 'expense', 50), entry(1, 'income', 20), entry(2, 'expense', 999)];
    expect(postCloseNet(entries, 1)).toBe(-30);
    expect(postCloseNet(entries, 2)).toBe(-999);
    expect(postCloseNet(entries, 3)).toBe(0);
  });

  it('重開再關帳後（版號往後），舊補記不再計入', () => {
    const entries = [entry(1, 'expense', 50)];
    expect(effectiveClosingCash(1000, entries, 1)).toBe(950);
    expect(effectiveClosingCash(950, entries, 3)).toBe(950);
    expect(isPostCloseEntryCounted({ settlementRevision: 1 }, 1)).toBe(true);
    expect(isPostCloseEntryCounted({ settlementRevision: 1 }, 3)).toBe(false);
  });

  it('沒有補記時有效關帳現金就是實點', () => {
    expect(effectiveClosingCash(1000, [], 1)).toBe(1000);
  });
});
