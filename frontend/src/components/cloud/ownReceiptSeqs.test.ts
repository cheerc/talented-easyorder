import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { seqWithOwnReceipts, useOwnReceiptSeqs } from './ownReceiptSeqs';

describe('#596 seqWithOwnReceipts', () => {
  it('follows an unbroken run of own receipts from what the page read', () => {
    expect(seqWithOwnReceipts(20, new Set())).toBe(20);
    expect(seqWithOwnReceipts(20, new Set([21]))).toBe(21);
    expect(seqWithOwnReceipts(20, new Set([22, 21, 23]))).toBe(23);
  });

  it('stops at a gap: a seq the page never saw belongs to another device', () => {
    expect(seqWithOwnReceipts(20, new Set([22]))).toBe(20);
    expect(seqWithOwnReceipts(20, new Set([21, 23]))).toBe(21);
  });

  it('ignores receipts the page has already read past', () => {
    expect(seqWithOwnReceipts(25, new Set([21, 22]))).toBe(25);
  });
});

describe('#596 useOwnReceiptSeqs', () => {
  it('collects seqs per scope, ignores bad values, and starts empty in a new scope', () => {
    const { result, rerender } = renderHook(({ scope }) => useOwnReceiptSeqs(scope), { initialProps: { scope: 'a:1' } });
    const oldAdd = result.current.addOwnSeq;
    act(() => { result.current.addOwnSeq(5); result.current.addOwnSeq(5); result.current.addOwnSeq(-1); result.current.addOwnSeq(1.5); });
    expect([...result.current.ownSeqs]).toEqual([5]);

    rerender({ scope: 'a:2' });
    expect(result.current.ownSeqs.size).toBe(0);
    act(() => { oldAdd(6); });
    expect(result.current.ownSeqs.size).toBe(0);
    act(() => { result.current.addOwnSeq(9); });
    expect([...result.current.ownSeqs]).toEqual([9]);

    rerender({ scope: 'a:1' });
    expect(result.current.ownSeqs.size).toBe(0);
  });
});
