import { useState, useEffect, useRef, type MutableRefObject } from 'react';
import { usePosStore } from '../store/posStore';
import { clearCrashDraft } from '../storage/crashDraft';

// Ref: #281 — Extracted from App.tsx to reduce AppContent complexity.
// Manages commit lifecycle effects: syncing indicator, lastSync timestamp,
// crash draft cleanup, and undo countdown trigger.

export interface UseCommitLifecycleArgs {
  stateKind: string;
  lastCommittedTxIdRef: MutableRefObject<string | null>;
  setUndoCountdown: (n: number) => void;
  setSyncing: (value: boolean) => void;
}

export interface UseCommitLifecycleResult {
  lastSync: string;
}

export function useCommitLifecycle({
  stateKind,
  lastCommittedTxIdRef,
  setUndoCountdown,
  setSyncing,
}: UseCommitLifecycleArgs): UseCommitLifecycleResult {
  const [lastSync, setLastSync] = useState('剛剛');
  const commitTxIdRef = useRef<string | null>(null);
  const prevKindRef = useRef(stateKind);

  useEffect(() => {
    if (stateKind === 'committing' && commitTxIdRef.current === null) {
      commitTxIdRef.current = `tx-${Date.now()}`;
    }
    if (stateKind !== 'committing') commitTxIdRef.current = null;
    if (prevKindRef.current !== 'success' && stateKind === 'success') {
      setSyncing(true);
      const t = setTimeout(() => {
        setSyncing(false);
        setLastSync(new Date().toLocaleTimeString('en-US', { hour12: false }).slice(0, 5));
      }, 800);
      const latestTx = usePosStore.getState().transactions[0];
      if (latestTx && latestTx.syncStatus === 'local') lastCommittedTxIdRef.current = latestTx.transactionId;
      clearCrashDraft();
      prevKindRef.current = stateKind;
      return () => {
        clearTimeout(t);
        if (lastCommittedTxIdRef.current) setTimeout(() => setUndoCountdown(5), 0);
      };
    }
    prevKindRef.current = stateKind;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setSyncing/setUndoCountdown are stable setters from parent; lastCommittedTxIdRef is a ref. Only stateKind transitions should trigger this effect.
  }, [stateKind]);

  return { lastSync };
}
