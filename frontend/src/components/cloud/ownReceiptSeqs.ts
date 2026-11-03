// #596: the page's own commands that do not make it read again (an export, a print, a backup record) still move the data head.
// The notice must not take those for another device's write, so the page remembers the receipt seqs of its own commands. A receipt
// only counts while it follows what the page already knows without a gap: a foreign write in between would be a seq the page never
// saw, and then the notice has to show.
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** The newest seq the page can call its own: what it read, followed by an unbroken run of its own receipts. */
export function seqWithOwnReceipts(sourceSeq: number, ownSeqs: ReadonlySet<number>): number {
  let seq = sourceSeq;
  while (ownSeqs.has(seq + 1)) seq += 1;
  return seq;
}

const NONE: ReadonlySet<number> = new Set();

/**
 * Receipt seqs of the page's own commands, per authorization scope: a new scope (another account, lease epoch or dataset owner)
 * starts empty, and a late receipt of an old scope is dropped.
 */
export function useOwnReceiptSeqs(scopeKey: string): { ownSeqs: ReadonlySet<number>; addOwnSeq: (seq: number) => void } {
  const [state, setState] = useState<{ scopeKey: string; seqs: ReadonlySet<number> }>({ scopeKey, seqs: NONE });
  const scopeRef = useRef(scopeKey);
  useLayoutEffect(() => { scopeRef.current = scopeKey; }, [scopeKey]);
  const addOwnSeq = useCallback((seq: number) => {
    if (scopeRef.current !== scopeKey || !Number.isSafeInteger(seq) || seq < 0) return;
    setState(previous => {
      const seqs = previous.scopeKey === scopeKey ? previous.seqs : NONE;
      return seqs.has(seq) ? previous : { scopeKey, seqs: new Set(seqs).add(seq) };
    });
  }, [scopeKey]);
  return { ownSeqs: state.scopeKey === scopeKey ? state.seqs : NONE, addOwnSeq };
}
