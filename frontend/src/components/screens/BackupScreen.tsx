import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Firestore } from 'firebase/firestore';
import { useFirebaseOptional } from '../../providers/FirebaseProvider';
import type { CommandReceipt, CommandResult } from '../../domain/cloudCommands';
import { createCloudBackupRepository } from '../../firebase/cloudBackupRepository';
import { createCloudBackupCommandRepository, type RecordBackupIntent } from '../../firebase/cloudBackupCommandRepository';
import { getCloudRecoveryReader } from '../../firebase/cloudRecoveryReader';
import { decryptBackup, encryptBackup, sha256Hex, verifyBackupFile, type BackupManifest } from '../../firebase/cloudBackup';

type BackupStage = 'idle' | 'generated' | 'downloadRequested' | 'verifiedLocal';
type RecoveryPhase = 'submitting' | 'checking' | 'unknown';

interface RecoveryView {
  commandId: string;
  phase: RecoveryPhase;
  /** Ten seconds passed without a definite result; the prompt only, never an abort or an unsent proof. */
  timedOut: boolean;
  /** A fresh settled read-only not-found allows an explicit retry with the original ID and frozen input. */
  canRetry: boolean;
  message: string;
}

/**
 * One RecordBackup operation per mounted owner: the frozen intent and the independent liveness of the original
 * submission promise. Nothing of it survives an owner change or an unmount; the journal keeps only the identity.
 */
interface BackupOperation {
  generation: number;
  db: Firestore;
  uid: string;
  leaseEpoch: number;
  datasetId: string;
  intent: Readonly<RecordBackupIntent> | null;
  repository: ReturnType<typeof createCloudBackupCommandRepository>;
  attempt: number;
  attemptPromise: Promise<CommandResult> | null;
  attemptSettled: boolean;
  timedOut: boolean;
  querySequence: number;
  checking: boolean;
  retryAuthorized: boolean;
  receipt: CommandReceipt | null;
  timerId: number | null;
  completed: boolean;
}

const PROMPT_AFTER_MS = 10_000;

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
}

function isAuthorizationLoss(error: unknown): boolean {
  return ['LEASE_LOST', 'UNAUTHORIZED', 'ACCESS_BUSY'].includes(errorCode(error));
}

function browserIsOnline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === true;
}

function queryFailureMessage(error: unknown): string {
  const code = errorCode(error);
  if (code === 'MAINTENANCE') return '系統維護中，暫停同編號重試；請稍後重新查詢。';
  if (code === 'QUOTA_EXCEEDED') return '查詢次數已達限制，尚未確認命令不存在；請稍後重新查詢，不可重試。';
  if (code === 'UNSUPPORTED_SCHEMA') return '雲端命令格式不支援，尚未確認操作結果；請聯絡維護者，不可重試。';
  if (code === 'INVALID_INPUT') return '命令編號已存在，但伺服器內容與原操作不符；仍未確認完成，不可重試。';
  return '目前無法安全確認原命令；查詢錯誤不代表命令不存在，暫不可重試。';
}

interface BackupScreenProps {
  /** Reports whether an unconfirmed RecordBackup is outstanding, so the host can lock its own commands. */
  onRecoveryChange?: (active: boolean) => void;
  /** The host holds its own unconfirmed command; this screen starts nothing meanwhile. */
  locked?: boolean;
}

export const BackupScreen = React.memo(function BackupScreen({ onRecoveryChange, locked = false }: BackupScreenProps) {
  const firebase = useFirebaseOptional();
  const fb = firebase?.fb ?? null;
  const access = firebase?.access ?? { ok: false as const };
  const lease = firebase?.lease ?? { isHolder: false, epoch: 0 };
  const [stage, setStage] = useState<BackupStage>('idle');
  const [headSeq, setHeadSeq] = useState<number | null>(null);
  const [fromSeq, setFromSeq] = useState(0);
  const [packageBytes, setPackageBytes] = useState<Uint8Array<ArrayBuffer> | null>(null);
  const [packageSha, setPackageSha] = useState<string | null>(null);
  const [manifest, setManifest] = useState<BackupManifest | null>(null);
  const [previousManifest, setPreviousManifest] = useState<BackupManifest | null>(null);
  const [previousPackageSha, setPreviousPackageSha] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryView | null>(null);
  // The saved file is being read back; no command exists yet, but the host must already treat the backup as in flight.
  const [verifying, setVerifying] = useState(false);
  const [cleanupNote, setCleanupNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const flowRef = useRef(0);
  const operationRef = useRef<BackupOperation | null>(null);
  const generationRef = useRef(0);

  // The Lite pair is registered with the Firestore instance; without it nothing is submitted or confirmed.
  const db = fb?.db ?? null;
  const recoveryReader = useMemo(() => {
    if (!db) return null;
    try { return getCloudRecoveryReader(db); } catch { return null; }
  }, [db]);
  const commandRepository = useMemo(
    () => (db && recoveryReader ? createCloudBackupCommandRepository(db, { recoveryReader }) : null),
    [db, recoveryReader],
  );

  // Awaited continuations read the latest committed owner, never a stale render closure.
  const uid = access.ok ? access.profile.uid : null;
  const latestRef = useRef({ db, uid, isHolder: lease.isHolder, epoch: lease.epoch });
  useEffect(() => { latestRef.current = { db, uid, isHolder: lease.isHolder, epoch: lease.epoch }; });
  const onRecoveryChangeRef = useRef(onRecoveryChange);
  useEffect(() => { onRecoveryChangeRef.current = onRecoveryChange; });
  // Awaited continuations read the live lock, never the value captured when the handler started.
  const lockedRef = useRef(locked);
  useEffect(() => { lockedRef.current = locked; });

  const clearTimer = (operation: BackupOperation) => {
    if (operation.timerId !== null) window.clearTimeout(operation.timerId);
    operation.timerId = null;
  };

  const dropOperation = useCallback(() => {
    const operation = operationRef.current;
    if (!operation) return;
    if (operation.timerId !== null) window.clearTimeout(operation.timerId);
    operation.timerId = null;
    operation.completed = true;
    operation.intent = null;
    operation.attemptPromise = null;
    operationRef.current = null;
  }, []);

  const resetAll = useCallback(() => {
    flowRef.current += 1;
    generationRef.current += 1;
    dropOperation();
    setStage('idle'); setHeadSeq(null); setPackageBytes(null); setPackageSha(null);
    setManifest(null); setPreviousManifest(null); setPreviousPackageSha(null); setPassword(''); setError(''); setBusy(false);
    setRecovery(null); setCleanupNote(''); setVerifying(false);
  }, [dropOperation]);

  // Losing the lease or access drops the whole screen, the frozen intent included. The journal keeps the identity.
  useEffect(() => {
    resetAll();
    return () => { flowRef.current += 1; generationRef.current += 1; dropOperation(); };
  }, [access.ok, lease.isHolder, lease.epoch, resetAll, dropOperation]);

  const recoveryActive = recovery !== null;
  const hostLockNeeded = recoveryActive || verifying;
  useEffect(() => { onRecoveryChangeRef.current?.(hostLockNeeded); }, [hostLockNeeded]);
  useEffect(() => () => { onRecoveryChangeRef.current?.(false); }, []);

  const ownsOperation = (operation: BackupOperation): operation is BackupOperation & { intent: Readonly<RecordBackupIntent> } => {
    const current = latestRef.current;
    return operationRef.current === operation && !operation.completed && operation.intent !== null
      && generationRef.current === operation.generation
      && current.db === operation.db && current.uid === operation.uid
      && current.isHolder && current.epoch === operation.leaseEpoch;
  };

  const revoke = () => { resetAll(); };

  const showUnknown = (operation: BackupOperation, message: string) => {
    if (!ownsOperation(operation) || operation.receipt) return;
    clearTimer(operation);
    setRecovery({
      commandId: operation.intent.commandId, phase: operation.checking ? 'checking' : 'unknown',
      timedOut: false, canRetry: false, message,
    });
  };

  const beginAttempt = (operation: BackupOperation) => {
    clearTimer(operation);
    operation.attempt += 1;
    operation.attemptPromise = null;
    operation.attemptSettled = false;
    operation.timedOut = false;
    operation.retryAuthorized = false;
    operation.querySequence += 1;
    operation.checking = false;
    const attempt = operation.attempt;
    // The ten-second mark is only a status prompt: no abort, no new ID, no automatic retry.
    operation.timerId = window.setTimeout(() => {
      if (!ownsOperation(operation) || operation.attempt !== attempt || operation.attemptSettled || operation.receipt) return;
      operation.timedOut = true;
      setRecovery(previous => (previous && previous.commandId === operation.intent.commandId
        ? { ...previous, phase: 'submitting', timedOut: true, canRetry: false }
        : previous));
    }, PROMPT_AFTER_MS);
  };

  const settleWithReceipt = async (operation: BackupOperation, receipt: CommandReceipt) => {
    if (!ownsOperation(operation) || operation.receipt) return;
    const intent = operation.intent;
    if (receipt.commandId !== intent.commandId) {
      showUnknown(operation, '伺服器回執命令編號不符；保留原命令編號，尚未確認完成。');
      return;
    }
    clearTimer(operation);
    operation.receipt = receipt;
    operation.retryAuthorized = false;
    operation.checking = false;
    operation.querySequence += 1;
    // The file was verified in this mount before the command was frozen; the receipt only confirms the registration.
    setRecovery(null); setError(''); setStage('verifiedLocal');
    try {
      const cleaned = await operation.repository.cleanupConfirmedIntent(
        intent, operation.datasetId, operation.uid, () => ownsOperation(operation) && browserIsOnline(),
      );
      if (!cleaned && ownsOperation(operation)) setCleanupNote('本機命令追蹤尚未清理；伺服器回執仍已確認。');
    } catch (cause) {
      if (!ownsOperation(operation)) return;
      if (isAuthorizationLoss(cause)) { revoke(); return; }
      setCleanupNote('本機命令追蹤清理未完成；伺服器回執仍已確認。');
    }
  };

  const finishResult = async (operation: BackupOperation, result: CommandResult) => {
    if (!ownsOperation(operation) || operation.receipt) return;
    clearTimer(operation);
    if (!result.ok) {
      if (isAuthorizationLoss(result.error)) { revoke(); return; }
      if (result.error.code === 'UNKNOWN_RESULT' || result.error.code === 'OFFLINE') {
        showUnknown(operation, '操作回應不確定；請唯讀查詢原命令結果。查詢錯誤或找不到結果都不會自動重送。');
        return;
      }
      // A definite refusal: nothing was recorded, so a later verification starts a new operation.
      dropOperation();
      setRecovery(null);
      setError(result.error.message);
      return;
    }
    await settleWithReceipt(operation, result.receipt);
  };

  const runAttempt = async (operation: BackupOperation) => {
    if (!ownsOperation(operation)) return;
    beginAttempt(operation);
    setError('');
    setRecovery({ commandId: operation.intent.commandId, phase: 'submitting', timedOut: false, canRetry: false, message: '' });
    const attempt = operation.attempt;
    const attemptPromise = operation.repository.commitRecordBackupIntent(operation.intent);
    operation.attemptPromise = attemptPromise;
    try {
      const result = await attemptPromise;
      if (!ownsOperation(operation) || operation.attempt !== attempt) return;
      operation.attemptSettled = true;
      if (operation.attemptPromise === attemptPromise) operation.attemptPromise = null;
      await finishResult(operation, result);
    } catch (cause) {
      if (!ownsOperation(operation) || operation.attempt !== attempt) return;
      operation.attemptSettled = true;
      if (operation.attemptPromise === attemptPromise) operation.attemptPromise = null;
      clearTimer(operation);
      // A receipt confirmed by the query stands: a late failure of the original submission never undoes it.
      if (operation.receipt) return;
      if (isAuthorizationLoss(cause)) { revoke(); return; }
      showUnknown(operation, '操作回應不確定；請唯讀查詢原命令結果。查詢錯誤或找不到結果都不會自動重送。');
    }
  };

  const checkPending = async () => {
    const operation = operationRef.current;
    if (!operation || !ownsOperation(operation) || operation.checking || operation.receipt) return;
    if (!operation.attemptSettled && !operation.timedOut) return;
    const commandId = operation.intent.commandId;
    if (!browserIsOnline()) {
      operation.retryAuthorized = false;
      setRecovery(previous => (previous ? { ...previous, canRetry: false, message: '目前離線；查詢錯誤不代表命令不存在，暫不可重試。' } : previous));
      return;
    }
    operation.checking = true;
    const attemptAtStart = operation.attempt;
    const settledAtStart = operation.attemptSettled && operation.attemptPromise === null;
    operation.retryAuthorized = false;
    const sequence = ++operation.querySequence;
    setRecovery(previous => (previous ? { ...previous, phase: 'checking', canRetry: false, message: '' } : previous));
    const pending = (message: string, canRetry: boolean) => {
      const settledNow = operation.attemptSettled;
      setRecovery({ commandId, phase: settledNow ? 'unknown' : 'submitting', timedOut: !settledNow, canRetry, message });
    };
    try {
      const check = await operation.repository.confirmPendingIntent(operation.intent, operation.datasetId, operation.uid);
      if (!ownsOperation(operation) || operation.querySequence !== sequence
        || operation.attempt !== attemptAtStart || operation.receipt) return;
      if (check.status === 'matched') {
        await settleWithReceipt(operation, check.receipt);
        return;
      }
      if (check.status === 'different-dataset') {
        pending('目前伺服器資料集已變更；原備份登記尚未確認，請聯絡維護者，不可重試。', false);
        return;
      }
      // Only a successful fresh not-found that began after the same attempt settled can allow an explicit retry.
      const mayRetry = settledAtStart && operation.attemptSettled && operation.attemptPromise === null;
      operation.retryAuthorized = mayRetry;
      pending(mayRetry
        ? '伺服器目前尚未找到這筆命令。沒有產生新的命令編號；確認後可明確選擇同編號重試。'
        : settledAtStart
          ? '原命令狀態在查詢期間改變；這次查詢不能授權重試。請重新查詢原命令。'
          : operation.attemptSettled
            ? '這次查詢開始時原命令仍在送出中；未找到結果不能授權重試。請在原命令結束後重新查詢。'
            : '查詢尚未找到回執，但原命令仍在送出中；目前不能重試。請等待原命令結束後再查詢。', mayRetry);
    } catch (cause) {
      if (!ownsOperation(operation) || operation.querySequence !== sequence || operation.receipt) return;
      if (isAuthorizationLoss(cause)) { revoke(); return; }
      operation.retryAuthorized = false;
      pending(queryFailureMessage(cause), false);
    } finally {
      if (operationRef.current === operation && operation.querySequence === sequence) operation.checking = false;
    }
  };

  const retryPending = () => {
    const operation = operationRef.current;
    if (!operation || !ownsOperation(operation) || !operation.attemptSettled || !operation.retryAuthorized
      || operation.receipt || operation.checking) return;
    if (!browserIsOnline()) {
      operation.retryAuthorized = false;
      setRecovery(previous => (previous ? { ...previous, canRetry: false, message: '目前離線，沒有重試命令；請恢復連線後重新查詢原命令。' } : previous));
      return;
    }
    operation.retryAuthorized = false;
    void runAttempt(operation);
  };

  const readPrevious = async (file: File) => {
    const id = ++flowRef.current;
    try {
      const bytes = await file.arrayBuffer();
      const loaded = await decryptBackup(bytes, password);
      if (id !== flowRef.current || !lease.isHolder) return;
      const hash = await sha256Hex(new Uint8Array(bytes));
      if (id !== flowRef.current || !lease.isHolder) return;
      setPreviousManifest(loaded); setPreviousPackageSha(hash); setFromSeq(loaded.toSeq); setError('');
    } catch (cause) { if (id === flowRef.current) setError(cause instanceof Error ? cause.message : '無法讀取前次備份'); }
  };

  const generate = async () => {
    if (!fb?.db || !access.ok || !lease.isHolder || !password || locked || recoveryActive) return;
    const id = ++flowRef.current;
    dropOperation();
    setRecovery(null); setCleanupNote('');
    setBusy(true); setError(''); setPackageBytes(null); setPackageSha(null); setManifest(null); setStage('idle');
    try {
      const repository = createCloudBackupRepository(fb.db, { currentUid: () => lease.isHolder ? access.profile.uid : null });
      const exported = await repository.exportRange({
        fromSeq, previousManifest,
        previousPackageSha256: previousPackageSha,
      });
      if (id !== flowRef.current || !lease.isHolder) return;
      const bytes = await encryptBackup(exported.manifest, password);
      const hash = await sha256Hex(bytes);
      if (id !== flowRef.current || !lease.isHolder) return;
      setHeadSeq(exported.toSeq); setPackageBytes(bytes); setPackageSha(hash); setManifest(exported.manifest); setStage('generated');
    } catch (cause) { if (id === flowRef.current) setError(cause instanceof Error ? cause.message : '備份產生失敗'); }
    finally { if (id === flowRef.current) setBusy(false); }
  };

  const download = () => {
    if (!packageBytes || !manifest) return;
    const blob = new Blob([packageBytes.buffer], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `easyorder-backup-${manifest.fromSeq}-${manifest.toSeq}.eobackup`;
    document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    setStage('downloadRequested');
  };

  const verifySelected = async (file: File | undefined) => {
    if (!file || !manifest || !packageSha || !fb?.db || !access.ok || !lease.isHolder || locked) return;
    // A second selection never resends: an unconfirmed command is resolved only by its own query or explicit retry.
    if (operationRef.current) return;
    const id = ++flowRef.current;
    setBusy(true); setError(''); setVerifying(true);
    // Synchronously, so the host's own commands are locked before this handler yields.
    onRecoveryChangeRef.current?.(true);
    try {
      const readback = await verifyBackupFile(file, password, packageSha);
      if (readback.datasetId !== manifest.datasetId || readback.fromSeq !== manifest.fromSeq || readback.toSeq !== manifest.toSeq) {
        throw new Error('重新選取的備份範圍或 dataset 不一致');
      }
      if (id !== flowRef.current || !lease.isHolder) return;
      if (lockedRef.current) throw new Error('日結命令確認中，沒有登記備份；請先完成日結結果確認，再重新選取檔案。');
      if (!commandRepository) throw new Error('無法建立唯讀查證通道，沒有登記備份；請重新載入頁面。');
      let commandId: string;
      try { commandId = crypto.randomUUID(); } catch { throw new Error('瀏覽器無法建立安全的命令編號，沒有登記備份。請重新載入安全連線後再試。'); }
      const intent: Readonly<RecordBackupIntent> = Object.freeze({
        commandId, leaseEpoch: lease.epoch,
        payload: Object.freeze({
          backupType: 'command-incremental' as const, sourceSeq: manifest.toSeq, fromSeq: manifest.fromSeq,
          toSeq: manifest.toSeq, sha256: packageSha,
        }),
      });
      const operation: BackupOperation = {
        generation: generationRef.current, db: fb.db, uid: access.profile.uid, leaseEpoch: lease.epoch,
        datasetId: manifest.datasetId, intent, repository: commandRepository,
        attempt: 0, attemptPromise: null, attemptSettled: false, timedOut: false, querySequence: 0,
        checking: false, retryAuthorized: false, receipt: null, timerId: null, completed: false,
      };
      operationRef.current = operation;
      if (fileRef.current) fileRef.current.value = '';
      setBusy(false); setVerifying(false);
      await runAttempt(operation);
    } catch (cause) { if (id === flowRef.current) setError(cause instanceof Error ? cause.message : '本機備份驗證失敗'); }
    finally {
      if (id === flowRef.current) {
        setBusy(false); setVerifying(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    }
  };

  const controlsDisabled = busy || locked || recoveryActive;
  const canQuery = recovery !== null && (recovery.phase === 'unknown' || (recovery.phase === 'submitting' && recovery.timedOut));

  return <section className="screen backup" aria-label="每日增量備份">
    <div className="card bk-flow">
      <h2 className="bk-flow-h">每日加密備份</h2>
      <p className="bk-flow-sub">手動下載每日增量。下載後請重新選取檔案驗證；第二份副本需由操作者複製至公司受控電腦或加密離線媒體並確認。</p>
      {locked && <p role="note">日結命令確認中，暫停備份操作；請先完成日結結果確認。</p>}
      <label>備份密碼
        <input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} disabled={controlsDisabled} />
      </label>
      <label>前次可讀備份（首次完整備份可留空）
        <input type="file" accept=".eobackup,application/json" onChange={event => { const file = event.target.files?.[0]; if (file) void readPrevious(file); }} disabled={controlsDisabled} />
      </label>
      {previousManifest && <p>前包已解密：seq {previousManifest.fromSeq}–{previousManifest.toSeq}，增量從 {previousManifest.toSeq + 1} 開始。</p>}
      {headSeq !== null && <p role="status">固定匯出 head H={headSeq}；範圍 {fromSeq}–{headSeq}。{stage === 'verifiedLocal' ? '本機副本已驗證。' : `狀態：${stage}。`}</p>}
      <div className="rest-btns">
        <button type="button" className="btn-confirm" onClick={() => void generate()} disabled={controlsDisabled || !lease.isHolder || !password || (fromSeq > 0 && !previousManifest)}>
          {busy ? '處理中…' : '產生加密備份'}
        </button>
        <button type="button" className="btn-confirm" onClick={download} disabled={!packageBytes || controlsDisabled}>下載備份</button>
      </div>
      {packageBytes && <label>重新選取剛存下的備份檔
        <input ref={fileRef} type="file" accept=".eobackup,application/json" disabled={controlsDisabled || stage === 'verifiedLocal'}
          onChange={event => void verifySelected(event.target.files?.[0])} />
      </label>}
      {recovery && (
        <div className="bk-recovery" role="alert" aria-label="命令結果確認">
          <strong>{recovery.phase === 'checking'
            ? '正在查詢原命令結果…'
            : recovery.phase === 'submitting'
              ? recovery.timedOut ? '結果確認中，勿重新收款' : '命令送出中，請勿重複操作。'
              : '結果確認中，請勿重複操作。'}</strong>
          <span>備份登記 · 命令編號 {recovery.commandId}</span>
          {recovery.message && <span>{recovery.message}</span>}
          <div className="rest-btns">
            {canQuery && <button type="button" className="btn-confirm" onClick={() => void checkPending()}>查詢原命令結果</button>}
            {recovery.canRetry && <button type="button" className="btn-confirm" onClick={retryPending}>以相同命令編號重試</button>}
          </div>
        </div>
      )}
      {stage === 'verifiedLocal' && <p role="status">備份雜湊與 manifest 已從本機檔案驗證，且已登記 RecordBackup。</p>}
      {cleanupNote && <p role="status">{cleanupNote}</p>}
      {error && <p role="alert">{error}</p>}
      <p>產生備份與瀏覽器發起下載都不代表檔案已存好；只有重新選取、解密並比對成功後才登記。取消、錯誤或失去使用權不會推進驗證狀態。</p>
    </div>
  </section>;
});
