import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { CommandErrorCode } from '../../domain/cloudCommands';
import {
  CLOUD_PENDING_JOURNAL_PAGE_SIZE,
  CLOUD_PENDING_JOURNAL_CAPACITY,
  cloudPendingJournalForRepository,
  PendingJournalUnavailableError,
  type PendingCommandIdentity,
  type PendingJournalChangeSource,
} from '../../firebase/cloudPendingJournal';
import { createCloudCommandRepository, type PendingReceiptCheck } from '../../firebase/cloudCommandRepository';
import './CloudPendingRecoveryBoundary.css';

type RowStatus = 'in-flight' | 'not-found' | 'read-error' | 'different-dataset' | 'confirmed';

interface PendingRow {
  record: PendingCommandIdentity;
  status: RowStatus;
  seq?: number;
  cleanupPending?: boolean;
}

interface RecoveryState {
  initialReady: boolean;
  shellMounted: boolean;
  busy: boolean;
  error: 'journal' | 'query' | null;
  errorCode: CommandErrorCode | null;
  rows: PendingRow[];
  total: number;
  gateRequired: boolean;
  continued: boolean;
  pageIndex: number;
}

const initialState: RecoveryState = {
  initialReady: false,
  shellMounted: false,
  busy: true,
  error: null,
  errorCode: null,
  rows: [],
  total: 0,
  gateRequired: true,
  continued: false,
  pageIndex: 0,
};

function sameIdentityList(left: readonly PendingCommandIdentity[], right: readonly PendingCommandIdentity[]): boolean {
  return left.length === right.length && left.every((record, index) => (
    record.commandId === right[index]?.commandId
      && record.datasetId === right[index]?.datasetId
      && record.uid === right[index]?.uid
  ));
}

function codeOf(error: unknown): CommandErrorCode | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  const value = (error as { code?: unknown }).code;
  return typeof value === 'string' ? value as CommandErrorCode : null;
}

function statusText(row: PendingRow): string {
  switch (row.status) {
    case 'in-flight': return '同分頁的提交仍在執行；保留編號，勿另送。';
    case 'not-found': return '伺服器目前未查到；這不代表確定未入帳。保留編號，不要重新收款。';
    case 'read-error': return '目前無法安全確認伺服器結果；保留編號。';
    case 'different-dataset': return '原資料集與目前不同；已保留編號，需由維護者核對。';
    case 'confirmed': return row.cleanupPending
      ? '已確認原命令入帳；本機追蹤編號尚未清除，之後會再核對。'
      : '已確認原命令入帳。';
  }
}

function blocksIndependentWork(row: PendingRow): boolean {
  return row.status !== 'confirmed';
}

export interface CloudPendingRecoveryBoundaryProps {
  db: Firestore;
  uid: string;
  leaseEpoch: number;
  children: (hasUnresolvedPendingCommands: boolean) => ReactNode;
}

export function CloudPendingRecoveryBoundary({ db, uid, leaseEpoch, children }: CloudPendingRecoveryBoundaryProps) {
  const journal = useMemo(() => cloudPendingJournalForRepository(db), [db]);
  const repository = useMemo(() => createCloudCommandRepository(db), [db]);
  const [state, setState] = useState<RecoveryState>(initialState);
  const [manualConfirmation, setManualConfirmation] = useState(false);
  const generationRef = useRef(0);
  const initialReadyRef = useRef(false);
  const mountedShellRef = useRef(false);
  const pendingRefreshRef = useRef(false);

  const recover = useCallback(async (
    source: 'initial' | 'same-tab' | 'other-tab' | 'retry',
  ) => {
    const generation = ++generationRef.current;
    const initial = source === 'initial';
    const external = source === 'other-tab';
    let scannedRecords: PendingCommandIdentity[] | null = null;
    const rows: PendingRow[] = [];
    if (external) setManualConfirmation(false);
    setState(previous => ({
      ...previous,
      busy: true,
      error: null,
      errorCode: null,
      ...(initial ? { initialReady: false, shellMounted: false, gateRequired: true, continued: false } : {}),
      ...(external ? { gateRequired: true, continued: false } : {}),
    }));
    try {
      await journal.migrateLegacyOrderSlot();
      const snapshot = await journal.readAll();
      if (!snapshot.complete || snapshot.total !== snapshot.records.length || snapshot.total > CLOUD_PENDING_JOURNAL_CAPACITY) {
        throw new PendingJournalUnavailableError();
      }
      scannedRecords = snapshot.records;
      const before = await repository.getPendingRecoveryContext(leaseEpoch);
      if (before.uid !== uid || before.leaseEpoch !== leaseEpoch) {
        const error = new Error('holder changed') as Error & { code: CommandErrorCode };
        error.code = 'LEASE_LOST';
        throw error;
      }

      const removed = new Set<string>();
      for (let offset = 0; offset < snapshot.records.length; offset += CLOUD_PENDING_JOURNAL_PAGE_SIZE) {
        if (generation !== generationRef.current) return;
        const page = snapshot.records.slice(offset, offset + CLOUD_PENDING_JOURNAL_PAGE_SIZE);
        const checks = page.map(record => journal.isInFlight(record, leaseEpoch)
          ? null
          : before.datasetId === record.datasetId ? record : null);
        const queryRecords = page.filter((record, index) => checks[index] === record);
        let queryResults: PendingReceiptCheck[] = [];
        let pageError: unknown = null;
        if (queryRecords.length > 0) {
          try {
            queryResults = await repository.confirmPendingPage(queryRecords, leaseEpoch);
          } catch (error) {
            pageError = error;
          }
        }
        let queryIndex = 0;
        for (let index = 0; index < page.length; index += 1) {
          const record = page[index];
          if (journal.isInFlight(record, leaseEpoch)) {
            rows.push({ record, status: 'in-flight' });
            continue;
          }
          if (record.datasetId !== before.datasetId) {
            rows.push({ record, status: 'different-dataset' });
            continue;
          }
          if (pageError) {
            rows.push({ record, status: 'read-error' });
            continue;
          }
          const result = queryResults[queryIndex++];
          if (!result) throw new PendingJournalUnavailableError();
          if (result.status === 'different-dataset') {
            rows.push({ record, status: 'different-dataset' });
          } else if (result.status === 'not-found') {
            rows.push({ record, status: 'not-found' });
          } else {
            try {
              const didRemove = await journal.removeIf(record);
              if (didRemove) removed.add(record.commandId);
              else rows.push({ record, status: 'confirmed', seq: result.receipt.seq, cleanupPending: true });
            } catch {
              rows.push({ record, status: 'confirmed', seq: result.receipt.seq, cleanupPending: true });
            }
          }
        }
        if (pageError) {
          const code = codeOf(pageError);
          if (code === 'LEASE_LOST' || code === 'UNAUTHORIZED' || code === 'MAINTENANCE') throw pageError;
        }
      }

      const after = await repository.getPendingRecoveryContext(leaseEpoch);
      if (before.uid !== after.uid || before.datasetId !== after.datasetId || before.leaseEpoch !== after.leaseEpoch) {
        const error = new Error('recovery context changed') as Error & { code: CommandErrorCode };
        error.code = 'LEASE_LOST';
        throw error;
      }
      const finalSnapshot = await journal.readAll();
      if (!finalSnapshot.complete || finalSnapshot.total !== finalSnapshot.records.length) throw new PendingJournalUnavailableError();
      if (initial) {
        const expectedRemaining = snapshot.records.filter(record => !removed.has(record.commandId));
        if (!sameIdentityList(expectedRemaining, finalSnapshot.records)) throw new PendingJournalUnavailableError();
      }
      const rowsById = new Map(rows.map(row => [row.record.commandId, row]));
      const finalRows = finalSnapshot.records.map(record => rowsById.get(record.commandId) ?? {
        record,
        status: journal.isInFlight(record, leaseEpoch) ? 'in-flight' as const : 'read-error' as const,
      });
      const unresolved = finalRows.some(blocksIndependentWork);
      if (generation !== generationRef.current) return;
      initialReadyRef.current = true;
      pendingRefreshRef.current = false;
      const shellMounted = mountedShellRef.current || !unresolved;
      mountedShellRef.current = shellMounted;
      setManualConfirmation(false);
      setState(previous => ({
        ...previous,
        initialReady: true,
        shellMounted,
        busy: false,
        error: null,
        errorCode: null,
        rows: finalRows,
        total: finalSnapshot.total,
        gateRequired: unresolved && (initial || external || previous.gateRequired),
        continued: initial || external ? false : previous.continued,
        pageIndex: 0,
      }));
    } catch (error) {
      if (generation !== generationRef.current) return;
      const journalFailure = error instanceof PendingJournalUnavailableError;
      initialReadyRef.current = !initial;
      const rowsById = new Map(rows.map(row => [row.record.commandId, row]));
      const visibleRows = scannedRecords
        ? scannedRecords.map(record => rowsById.get(record.commandId) ?? {
          record,
          status: journal.isInFlight(record, leaseEpoch) ? 'in-flight' as const : 'read-error' as const,
        })
        : null;
      setState(previous => ({
        ...previous,
        initialReady: !initial || previous.initialReady,
        shellMounted: previous.shellMounted,
        busy: false,
        error: journalFailure ? 'journal' : 'query',
        errorCode: codeOf(error),
        ...(visibleRows ? { rows: visibleRows, total: visibleRows.length } : {}),
        gateRequired: true,
        continued: false,
        pageIndex: 0,
      }));
    }
  }, [journal, leaseEpoch, repository, uid]);

  useEffect(() => {
    initialReadyRef.current = false;
    mountedShellRef.current = false;
    void recover('initial');
    return () => { generationRef.current += 1; };
  }, [recover]);

  useEffect(() => journal.subscribe((source: PendingJournalChangeSource) => {
    if (!initialReadyRef.current) {
      pendingRefreshRef.current = true;
      return;
    }
    if (source === 'storage-cleared') {
      setState(previous => ({ ...previous, error: 'journal', gateRequired: true, continued: false, busy: false }));
      setManualConfirmation(false);
      return;
    }
    void recover(source === 'other-tab' ? 'other-tab' : 'same-tab');
  }), [journal, recover]);

  useEffect(() => {
    if (state.initialReady && pendingRefreshRef.current) {
      pendingRefreshRef.current = false;
      void recover('same-tab');
    }
  }, [recover, state.initialReady]);

  const hasUnresolved = state.rows.some(row => row.status !== 'confirmed');
  const blockers = state.rows.filter(blocksIndependentWork);
  const canManualContinue = blockers.length > 0 && blockers.every(row => row.status === 'not-found') && !state.busy;
  const gateLocked = !state.initialReady || state.busy && (state.gateRequired || !state.shellMounted)
    || state.error !== null || state.gateRequired && !state.continued;
  const pageStart = state.pageIndex * CLOUD_PENDING_JOURNAL_PAGE_SIZE;
  const visibleRows = state.rows.slice(pageStart, pageStart + CLOUD_PENDING_JOURNAL_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(state.rows.length / CLOUD_PENDING_JOURNAL_PAGE_SIZE));

  const retryOne = async (record: PendingCommandIdentity) => {
    try {
      const [result] = await repository.confirmPendingPage([record], leaseEpoch);
      if (result.status === 'matched') {
        try {
          const removed = await journal.removeIf(record);
          setState(previous => ({
            ...previous,
            rows: removed
              ? previous.rows.filter(row => row.record.commandId !== record.commandId)
              : previous.rows.map(row => row.record.commandId === record.commandId
                ? { record, status: 'confirmed', seq: result.receipt.seq, cleanupPending: true }
                : row),
            total: removed ? Math.max(0, previous.total - 1) : previous.total,
            gateRequired: removed ? previous.rows.some(row => row.record.commandId !== record.commandId && blocksIndependentWork(row)) : previous.gateRequired,
            continued: false,
          }));
        } catch {
          setState(previous => ({
            ...previous,
            rows: previous.rows.map(row => row.record.commandId === record.commandId
              ? { record, status: 'confirmed', seq: result.receipt.seq, cleanupPending: true }
              : row),
          }));
        }
      } else {
        setState(previous => ({
          ...previous,
          rows: previous.rows.map(row => row.record.commandId === record.commandId
            ? { record, status: result.status === 'different-dataset' ? 'different-dataset' : 'not-found' }
            : row),
          gateRequired: true,
          continued: false,
        }));
      }
    } catch (error) {
      setState(previous => ({
        ...previous,
        rows: previous.rows.map(row => row.record.commandId === record.commandId
          ? { record, status: 'read-error' }
          : row),
        gateRequired: true,
        continued: false,
        error: codeOf(error) === 'LOCAL_STORAGE_UNAVAILABLE' ? 'journal' : null,
        errorCode: codeOf(error),
      }));
    }
  };

  const manualContinue = () => {
    if (!canManualContinue || !manualConfirmation) return;
    mountedShellRef.current = true;
    setState(previous => ({ ...previous, shellMounted: true, continued: true, gateRequired: false }));
  };

  return (
    <>
      <section className={`cloud-pending-recovery${gateLocked ? ' cloud-pending-recovery--blocked' : ''}`} aria-label="待核對命令">
        <h2>待核對命令</h2>
        {!state.initialReady && state.busy && <p role="status">正在檢查本機追蹤編號及伺服器回執；完成前不開放新操作。</p>}
        {state.error === 'journal' && (
          <div role="alert">
            <p>本機待核對日誌無法安全讀取或保存。資料未確認，已停止開放新操作；請聯絡系統維護者。</p>
          </div>
        )}
        {state.error === 'query' && (
          <div role="alert">
            <p>{state.errorCode === 'LEASE_LOST' || state.errorCode === 'UNAUTHORIZED'
              ? '登入身分或使用權已變更，待核對結果仍保留。請重新確認使用權後再查。'
              : '目前無法從伺服器安全核對待決命令；結果未確認，請確認連線後重試。'}</p>
          </div>
        )}
        {state.error && <button type="button" onClick={() => void recover('retry')} disabled={state.busy}>重新檢查</button>}
        {state.initialReady && state.error === null && state.rows.length === 0 && (
          <p role="status">目前沒有待核對命令。</p>
        )}
        {state.rows.length > 0 && (
          <>
            <p>共有 {state.total} 筆最小追蹤編號；每頁最多 {CLOUD_PENDING_JOURNAL_PAGE_SIZE} 筆，最多保留 {CLOUD_PENDING_JOURNAL_CAPACITY} 筆。未決編號不會自動淘汰。</p>
            <ul className="cloud-pending-recovery__list">
              {visibleRows.map(row => (
                <li key={row.record.commandId}>
                  <code>{row.record.commandId}</code>
                  <span>{statusText(row)}{row.status === 'confirmed' && row.seq ? `（伺服器序號 ${row.seq}）` : ''}</span>
                  {(row.status === 'not-found' || row.status === 'read-error') && (
                    <button type="button" onClick={() => void retryOne(row.record)} disabled={state.busy}>再查這筆編號</button>
                  )}
                </li>
              ))}
            </ul>
            {pageCount > 1 && (
              <div className="cloud-pending-recovery__pages">
                <button type="button" onClick={() => setState(previous => ({ ...previous, pageIndex: Math.max(0, previous.pageIndex - 1) }))} disabled={state.pageIndex === 0}>上一頁</button>
                <span>第 {state.pageIndex + 1} / {pageCount} 頁</span>
                <button type="button" onClick={() => setState(previous => ({ ...previous, pageIndex: Math.min(pageCount - 1, previous.pageIndex + 1) }))} disabled={state.pageIndex + 1 >= pageCount}>下一頁</button>
              </div>
            )}
            {canManualContinue && state.gateRequired && (
              <div className="cloud-pending-recovery__manual">
                <p>伺服器目前未查到的編號仍可能已入帳；不可重新收款或重登。</p>
                <label>
                  <input type="checkbox" checked={manualConfirmation} onChange={event => setManualConfirmation(event.target.checked)} />
                  我確認本筆結果尚未確定，不得重新收款或重登；只繼續其他獨立作業，待保留編號人工核對。
                </label>
                <button type="button" onClick={manualContinue} disabled={!manualConfirmation}>保留編號，移交人工核對並繼續其他作業</button>
              </div>
            )}
            {state.gateRequired && blockers.some(row => row.status === 'different-dataset') && (
              <p role="alert">存在其他資料集的待核對編號，需先由系統維護者核對；不會使用目前資料集查詢或清除。</p>
            )}
            {state.gateRequired && blockers.some(row => row.status === 'read-error' || row.status === 'in-flight') && (
              <p role="alert">部分編號仍無法確認或原提交仍在執行；請先重新查詢，不可把它當成未入帳。</p>
            )}
          </>
        )}
      </section>
      {state.shellMounted && (
        <div inert={gateLocked} aria-hidden={gateLocked || undefined}>
          {children(hasUnresolved)}
        </div>
      )}
    </>
  );
}
