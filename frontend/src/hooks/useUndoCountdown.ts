import { useState, useEffect, useCallback, useRef } from 'react';
import { useTransactionActions } from '../store/selectors';
import { emitError } from '../errors/errorBus';

export const UNDO_REASON = '送出後立即撤回';

interface UseUndoCountdownArgs {
  dismissSuccess: () => void;
  setFlashKey: (value: React.SetStateAction<number>) => void;
  setSyncing: (value: React.SetStateAction<boolean>) => void;
  setPriceOverride: (value: React.SetStateAction<number | null>) => void;
  setPriceOverrideLabel: (value: React.SetStateAction<string>) => void;
  /** 稽核紀錄上的操作員。 */
  operatorId?: string;
}

export function useUndoCountdown({
  dismissSuccess,
  setFlashKey,
  setSyncing,
  setPriceOverride,
  setPriceOverrideLabel,
  operatorId,
}: UseUndoCountdownArgs) {
  const [undoCountdown, setUndoCountdown] = useState(0);
  const lastCommittedTxIdRef = useRef<string | null>(null);
  const { deleteTransaction } = useTransactionActions();

  useEffect(() => {
    if (undoCountdown <= 0) {
      if (undoCountdown === 0) lastCommittedTxIdRef.current = null;
      return;
    }
    const t = setTimeout(() => setUndoCountdown(n => {
      const next = n - 1;
      if (next <= 0) lastCommittedTxIdRef.current = null;
      return Math.max(0, next);
    }), 1000);
    return () => clearTimeout(t);
  }, [undoCountdown]);

  const dismissFlash = useCallback(() => {
    dismissSuccess();
    setFlashKey(k => k + 1);
    setSyncing(false);
    setUndoCountdown(0);
    lastCommittedTxIdRef.current = null;
    setPriceOverride(null);
    setPriceOverrideLabel('');
  }, [dismissSuccess, setFlashKey, setSyncing, setPriceOverride, setPriceOverrideLabel]);

  const handleUndo = useCallback(() => {
    const txId = lastCommittedTxIdRef.current;
    if (!txId) return;
    // M2：撤回也留下原單與理由在稽核紀錄。
    const result = deleteTransaction(txId, { reason: UNDO_REASON, operatorId });
    if (!result.ok) {
      emitError({ source: 'storage', message: `撤回失敗：${result.message}`, context: { transactionId: txId } });
    }
    lastCommittedTxIdRef.current = null;
    setUndoCountdown(0);
    dismissFlash();
  }, [dismissFlash, deleteTransaction, operatorId]);

  return { undoCountdown, setUndoCountdown, lastCommittedTxIdRef, dismissFlash, handleUndo };
}
