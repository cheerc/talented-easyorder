import { useState, useEffect, useRef, type MutableRefObject } from 'react';
import { clearCrashDraft } from '../storage/crashDraft';

// Ref: #281 — Extracted from App.tsx to reduce AppContent complexity.
// Manages commit lifecycle effects: syncing indicator, lastSync timestamp,
// crash draft cleanup, and undo countdown trigger.

/** 送出後可以撤回的秒數。 */
export const UNDO_SECONDS = 5;

export interface UseCommitLifecycleArgs {
  stateKind: string;
  /** 成功畫面那一筆的交易編號（posFlow success 狀態帶的），不是成功時為 null。 */
  successTransactionId: string | null;
  lastCommittedTxIdRef: MutableRefObject<string | null>;
  setUndoCountdown: (n: number) => void;
  setSyncing: (value: boolean) => void;
}

export interface UseCommitLifecycleResult {
  lastSync: string;
}

export function useCommitLifecycle({
  stateKind,
  successTransactionId,
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
      // M2 L05：成功畫面一出現就開始撤回倒數，撤回鍵和成功畫面同時看得到。
      // 以前倒數要等成功畫面關掉才開始，那時浮層已經不見，撤回鍵從來沒有出現過。
      if (successTransactionId) {
        lastCommittedTxIdRef.current = successTransactionId;
        setUndoCountdown(UNDO_SECONDS);
      }
      clearCrashDraft();
      prevKindRef.current = stateKind;
      return () => clearTimeout(t);
    }
    prevKindRef.current = stateKind;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setSyncing/setUndoCountdown are stable setters from parent; lastCommittedTxIdRef is a ref. Only stateKind transitions should trigger this effect.
  }, [stateKind]);

  return { lastSync };
}
