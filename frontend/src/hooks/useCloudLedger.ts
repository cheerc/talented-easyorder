import { useCallback, useEffect, useRef, useState } from 'react';
import type { Firestore } from 'firebase/firestore';
import { createCloudLedgerReader, type CloudLedgerSnapshot } from '../firebase/cloudDayCloseRepository';

export type CloudLedgerView =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; snapshot: CloudLedgerSnapshot };

export interface CloudLedgerController {
  ledger: CloudLedgerView;
  reload: () => void;
}

/**
 * 帳務異常的伺服器快照（契約 §11）。進入雲端模式時讀一次；之後只在呼叫 `reload` 時重讀
 * （打開異常頁、開帳或關帳命令成功後），不隨切頁重讀。換帳號或使用權時重置為載入中。
 */
export function useCloudLedger(db: Firestore, scopeKey: string): CloudLedgerController {
  const [state, setState] = useState<{ scopeKey: string; view: CloudLedgerView }>({ scopeKey, view: { status: 'loading' } });
  const readerRef = useRef<{ db: Firestore; reader: ReturnType<typeof createCloudLedgerReader> } | null>(null);
  const requestRef = useRef(0);

  const fetchLedger = useCallback(() => {
    if (!readerRef.current || readerRef.current.db !== db) {
      readerRef.current = { db, reader: createCloudLedgerReader(db) };
    }
    const request = ++requestRef.current;
    readerRef.current.reader.read().then(
      snapshot => {
        if (request === requestRef.current) setState({ scopeKey, view: { status: 'ready', snapshot } });
      },
      (error: unknown) => {
        if (request !== requestRef.current) return;
        setState({
          scopeKey,
          view: { status: 'error', message: error instanceof Error ? error.message : '無法讀取帳務異常' },
        });
      },
    );
  }, [db, scopeKey]);

  const reload = useCallback(() => {
    // 已有結果時保留舊結果直到新結果回來；其他狀態（載入中、失敗）重置為載入中。
    setState(previous => (previous.scopeKey === scopeKey && previous.view.status === 'ready'
      ? previous : { scopeKey, view: { status: 'loading' } }));
    fetchLedger();
  }, [fetchLedger, scopeKey]);

  useEffect(() => {
    fetchLedger();
    return () => { requestRef.current += 1; };
  }, [fetchLedger]);

  const view: CloudLedgerView = state.scopeKey === scopeKey ? state.view : { status: 'loading' };
  return { ledger: view, reload };
}

export function unclosedPastDayIds(ledger: CloudLedgerView | undefined): string[] {
  if (ledger?.status !== 'ready') return [];
  return ledger.snapshot.anomalies.filter(item => item.kind === 'unclosed-past-day').map(item => item.dayId);
}
