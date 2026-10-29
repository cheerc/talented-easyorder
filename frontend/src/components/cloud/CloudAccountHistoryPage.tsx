import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { getAuth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { CommandReceipt, CommandResult } from '../../domain/cloudCommands';
import type { CloudLedgerDateRange, CloudReportTransaction } from '../../domain/cloudLedgerReport';
import type { CorrectTransactionPayload } from '../../domain/cloudTransactionMutation';
import { createCloudLedgerDateRange, validateCloudLedgerRange } from '../../domain/cloudLedgerReport';
import { createCloudReadRepository, type CloudReadRepositoryError } from '../../firebase/cloudReadRepository';
import { createCloudStudentRepository, type CloudStudentRecord } from '../../firebase/cloudStudentRepository';
import { createCloudOrderRepository, type CloudTransactionMutationInput } from '../../firebase/cloudOrderRepository';
import { getCloudRecoveryReader } from '../../firebase/cloudRecoveryReader';
import { composePaperRefNote, splitPaperNote } from '../../domain/paperRef';
import { isCurrentCloudActionOwner, useCloudActionOwner, type CloudActionOwnerToken } from './useCloudActionOwner';
import './CloudAccountHistoryPage.css';

export interface CloudAccountHistoryPageProps {
  db: Firestore;
  leaseEpoch: number;
  identityKey: string;
  initialStudentId?: string | null;
  initialRange?: CloudLedgerDateRange | null;
  onNavigationStateChange?: (identityKey: string, state: 'recovering' | 'revoked' | 'resolved') => void;
}

interface HistorySnapshot {
  account: Awaited<ReturnType<ReturnType<typeof createCloudReadRepository>['readAccountHistory']>>;
  audit: Awaited<ReturnType<ReturnType<typeof createCloudReadRepository>['readAuditRange']>>;
}


/** The frozen correction: its command ID, payload and revisions never change once it is first sent. */
interface FrozenMutation {
  id: string;
  scopeKey: string;
  datasetId: string;
  input: CloudTransactionMutationInput;
}

/** What survives an unmount: the frozen command and who it belongs to, never the draft form or the account content. */
interface RecoveryIdentity extends FrozenMutation {
  identityKey: string;
  leaseEpoch: number;
  uid: string;
}

type RecoverableMutation = FrozenMutation | RecoveryIdentity;
const mutationRecoveryRegistry = new Map<string, RecoveryIdentity>();

type RecoveryPhase = 'submitting' | 'checking' | 'unknown';

interface RecoveryView {
  commandId: string;
  phase: RecoveryPhase;
  /** Ten seconds passed without a definite result; the prompt only, never an abort or an unsent proof. */
  timedOut: boolean;
  /** A fresh settled read-only not-found allows an explicit retry with the original ID and frozen input. */
  canRetry: boolean;
}

/**
 * One correction operation per mounted owner: the original submission's independent liveness plus the read-only
 * queries. Nothing of it survives an owner change or an unmount; the registry and the journal keep the identity.
 */
interface MutationOperation {
  owner: CloudActionOwnerToken;
  action: RecoverableMutation;
  datasetId: string;
  uid: string;
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
const RECEIPT_MISMATCH = '伺服器回執與固定更正命令不一致；保留原命令編號，尚未確認完成。';
const UNKNOWN_RESULT = '更正結果待確認；保留原命令編號、payload 與 revisions。請唯讀查詢原命令結果；查詢錯誤或找不到結果都不會自動重送。';

function isRecoveryIdentity(action: RecoverableMutation): action is RecoveryIdentity {
  return 'identityKey' in action;
}

function storeRecoveryIdentity(
  action: FrozenMutation, owner: Pick<CloudActionOwnerToken, 'identityKey' | 'leaseEpoch'>, uid: string,
): void {
  mutationRecoveryRegistry.set(action.scopeKey, {
    ...action, identityKey: owner.identityKey, leaseEpoch: owner.leaseEpoch, uid,
  });
}

function removeRecoveryAction(action: Pick<RecoverableMutation, 'id' | 'scopeKey'>): void {
  if (mutationRecoveryRegistry.get(action.scopeKey)?.id === action.id) mutationRecoveryRegistry.delete(action.scopeKey);
}

function currentUid(db: Firestore): string | null {
  try { return getAuth(db.app).currentUser?.uid ?? null; } catch { return null; }
}

function browserIsOnline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === true;
}

function isAuthorizationLoss(error: unknown): boolean {
  return ['LEASE_LOST', 'UNAUTHORIZED', 'ACCESS_BUSY'].includes(errorCode(error) ?? '');
}

function queryFailureMessage(error: unknown): string {
  const code = errorCode(error);
  if (code === 'MAINTENANCE') return '系統維護中，暫停同編號重試；請稍後重新查詢。';
  if (code === 'QUOTA_EXCEEDED') return '查詢次數已達限制，尚未確認命令不存在；請稍後重新查詢，不可重試。';
  if (code === 'UNSUPPORTED_SCHEMA') return '雲端命令格式不支援，尚未確認操作結果；請聯絡維護者，不可重試。';
  if (code === 'INVALID_INPUT') return '命令編號已存在，但伺服器內容與原操作不符；仍未確認完成，不可重試。';
  return '目前無法安全確認原命令；查詢錯誤不代表命令不存在，暫不可重試。';
}


function errorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error ? String((error as CloudReadRepositoryError).code) : null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '無法完整讀取帳戶歷史';
}

function integerText(value: string, { allowZero = true }: { allowZero?: boolean } = {}): number | null {
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && (allowZero ? number >= 0 : number >= 1) && number <= 1_000_000_000 ? number : null;
}

function formatMoney(value: number): string {
  return `$${new Intl.NumberFormat('zh-TW').format(value)}`;
}

function formatTaipeiTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '時間不正確';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'medium', hour12: false,
  }).format(date);
}

function matchingEnvelope(snapshot: HistorySnapshot, studentId: string, range: CloudLedgerDateRange, leaseEpoch: number): boolean {
  return snapshot.account.complete === true && snapshot.audit.complete === true
    && snapshot.account.datasetId === snapshot.audit.datasetId
    && snapshot.account.sourceSeq === snapshot.audit.sourceSeq
    && snapshot.account.leaseEpoch === snapshot.audit.leaseEpoch
    && snapshot.account.leaseEpoch === leaseEpoch
    && snapshot.account.leaseToday === snapshot.audit.leaseToday
    && snapshot.account.range.startDate === range.startDate && snapshot.account.range.endDate === range.endDate
    && snapshot.audit.range.startDate === range.startDate && snapshot.audit.range.endDate === range.endDate
    && snapshot.account.scope.studentId === studentId && snapshot.audit.scope.studentId === studentId;
}




export function CloudAccountHistoryPage({
  db, leaseEpoch, identityKey, initialStudentId = null, initialRange = null, onNavigationStateChange,
}: CloudAccountHistoryPageProps) {
  const reads = useMemo(() => createCloudReadRepository(db), [db]);
  const studentsRepository = useMemo(() => createCloudStudentRepository(db), [db]);
  const recoveryReader = useMemo(() => getCloudRecoveryReader(db), [db]);
  const orders = useMemo(() => createCloudOrderRepository(db, { recoveryReader }), [db, recoveryReader]);
  const scopeKey = JSON.stringify([identityKey, leaseEpoch]);
  const actionOwnerRef = useCloudActionOwner(identityKey, leaseEpoch);
  const [leaseToday, setLeaseToday] = useState('');
  const [students, setStudents] = useState<CloudStudentRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialStudentId);
  const [search, setSearch] = useState('');
  const [rangeKind, setRangeKind] = useState<CloudLedgerDateRange['kind']>(initialRange?.kind ?? 'today');
  const [anchorDate, setAnchorDate] = useState(initialRange?.startDate ?? '');
  const [startDate, setStartDate] = useState(initialRange?.startDate ?? '');
  const [endDate, setEndDate] = useState(initialRange?.endDate ?? '');
  const [range, setRange] = useState<CloudLedgerDateRange | null>(null);
  const [snapshot, setSnapshot] = useState<HistorySnapshot | null>(null);
  const [readyScopeKey, setReadyScopeKey] = useState<string | null>(null);
  const [action, setAction] = useState<RecoverableMutation | null>(() => mutationRecoveryRegistry.get(scopeKey) ?? null);
  const [recovery, setRecovery] = useState<RecoveryView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [cleanupWarning, setCleanupWarning] = useState('');
  const [formError, setFormError] = useState('');
  const [draft, setDraft] = useState<{ transaction: CloudReportTransaction; kind: 'correct' | 'void' } | null>(null);
  const [mealPriceText, setMealPriceText] = useState('');
  const [paidAmountText, setPaidAmountText] = useState('');
  const [refundAmountText, setRefundAmountText] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const generationRef = useRef(0);
  const operationRef = useRef<MutationOperation | null>(null);
  const navigationRef = useRef(onNavigationStateChange);
  const latestRef = useRef({ range, selectedId, readyScopeKey, scopeKey });
  useEffect(() => {
    navigationRef.current = onNavigationStateChange;
    latestRef.current = { range, selectedId, readyScopeKey, scopeKey };
  });

  const dropOperation = useCallback(() => {
    const operation = operationRef.current;
    if (!operation) return;
    if (operation.timerId !== null) window.clearTimeout(operation.timerId);
    operation.timerId = null;
    operation.completed = true;
    operation.attemptPromise = null;
    operationRef.current = null;
  }, []);

  useEffect(() => () => dropOperation(), [dropOperation, scopeKey]);

  const revokeSensitiveUI = useCallback((owner: CloudActionOwnerToken, error: unknown) => {
    if (!isCurrentCloudActionOwner(actionOwnerRef, owner)) return;
    owner.revoked = true;
    generationRef.current += 1;
    // The registry keeps the identity (and the journal its own entry); only the memory of the operation goes.
    dropOperation();
    setAction(null);
    setRecovery(null);
    setSnapshot(null);
    setStudents([]);
    setSelectedId(null);
    setSearch('');
    setLeaseToday('');
    setRange(null);
    setRangeKind('today');
    setAnchorDate('');
    setStartDate('');
    setEndDate('');
    setLoading(false);
    setLoadError(errorText(error));
    setNotice('');
    setCleanupWarning('');
    setFormError('');
    setDraft(null);
    setMealPriceText('');
    setPaidAmountText('');
    setRefundAmountText('');
    setNote('');
    setReason('');
    setReadyScopeKey(null);
    navigationRef.current?.(owner.identityKey, 'revoked');
  }, [actionOwnerRef, dropOperation]);

  const previousScopeKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    const previous = previousScopeKey.current;
    previousScopeKey.current = scopeKey;
    if (previous === null || previous === scopeKey) return;
    generationRef.current += 1;
    dropOperation();
    setAction(mutationRecoveryRegistry.get(scopeKey) ?? null);
    setRecovery(null);
    setSnapshot(null);
    setReadyScopeKey(null);
    setStudents([]);
    setSelectedId(null);
    setSearch('');
    setLeaseToday('');
    setRange(null);
    setRangeKind('today');
    setAnchorDate('');
    setStartDate('');
    setEndDate('');
    setLoading(true);
    setLoadError('');
    setNotice('');
    setCleanupWarning('');
    setFormError('');
    setDraft(null);
    setMealPriceText('');
    setPaidAmountText('');
    setRefundAmountText('');
    setNote('');
    setReason('');
  }, [dropOperation, identityKey, scopeKey]);


  useEffect(() => {
    let active = true;
    const generation = ++generationRef.current;
    const owner = actionOwnerRef.current;
    if (!owner || !isCurrentCloudActionOwner(actionOwnerRef, owner)) return;
    onNavigationStateChange?.(identityKey, 'resolved');
    const probe: CloudLedgerDateRange = { kind: 'today', startDate: '2000-01-01', endDate: '2000-01-01' };
    void Promise.all([
      reads.readSummary({ range: probe, leaseEpoch }),
      studentsRepository.list(),
    ]).then(([summary, list]) => {
      if (!active || generationRef.current !== generation || !isCurrentCloudActionOwner(actionOwnerRef, owner)) return;
      setSnapshot(null);
      setLoading(true);
      setLoadError('');
      setNotice('');
      setDraft(null);
      setLeaseToday(summary.leaseToday);
      setStudents(list.students);
      const nextRange = initialRange
        ? validateCloudLedgerRange(initialRange)
        : createCloudLedgerDateRange('today', summary.leaseToday);
      setRangeKind(nextRange.kind);
      setAnchorDate(nextRange.startDate);
      setStartDate(nextRange.startDate);
      setEndDate(nextRange.endDate);
      setRange(nextRange);
      setReadyScopeKey(scopeKey);
      const nextStudentId = initialStudentId && list.students.some(student => student.studentId === initialStudentId)
        ? initialStudentId : null;
      setSelectedId(nextStudentId);
      setLoading(nextStudentId !== null);
      onNavigationStateChange?.(identityKey, 'resolved');
    }).catch(error => {
      if (!active || generationRef.current !== generation || !isCurrentCloudActionOwner(actionOwnerRef, owner)) return;
      if (['LEASE_LOST', 'UNAUTHORIZED'].includes(errorCode(error) ?? '')) revokeSensitiveUI(owner, error);
      else {
        setLoadError(errorText(error));
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [actionOwnerRef, bootstrapAttempt, identityKey, initialRange, initialStudentId, leaseEpoch,
    onNavigationStateChange, reads, revokeSensitiveUI, scopeKey, studentsRepository]);

  useEffect(() => {
    if (!range || !selectedId || !leaseToday || readyScopeKey !== scopeKey) return;
    let active = true;
    const generation = ++generationRef.current;
    const owner = actionOwnerRef.current;
    if (!owner || !isCurrentCloudActionOwner(actionOwnerRef, owner)) return;
    const queryInput = { range, studentId: selectedId, leaseEpoch };
    void Promise.all([
      reads.readAccountHistory(queryInput),
      reads.readAuditRange(queryInput),
    ]).then(([account, audit]) => {
      if (!active || generationRef.current !== generation || !isCurrentCloudActionOwner(actionOwnerRef, owner)) return;
      const complete = { account, audit };
      if (!matchingEnvelope(complete, selectedId, range, leaseEpoch)) {
        throw new Error('查帳、日結、稽核與學生版本不一致；未顯示部分資料。');
      }
      setSnapshot(complete);
      setLoading(false);
      setNotice('');
      onNavigationStateChange?.(identityKey, 'resolved');
    }).catch(error => {
      if (!active || generationRef.current !== generation || !isCurrentCloudActionOwner(actionOwnerRef, owner)) return;
      if (['LEASE_LOST', 'UNAUTHORIZED'].includes(errorCode(error) ?? '')) {
        revokeSensitiveUI(owner, error);
        return;
      }
      setSnapshot(null);
      setLoadError(errorText(error));
      setLoading(false);
    });
    return () => { active = false; };
  }, [actionOwnerRef, identityKey, leaseEpoch, leaseToday, onNavigationStateChange, range, reads, readyScopeKey,
    refresh, revokeSensitiveUI, scopeKey, selectedId]);

  const candidateStudents = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return [];
    return students.filter(student => [student.studentCode, student.displayName, ...student.aliases]
      .some(value => value.toLocaleLowerCase().includes(needle)));
  }, [search, students]);
  const currentStudent = snapshot ? {
    ...snapshot.account.student, status: snapshot.account.studentStatus, revision: snapshot.account.studentRevision,
  } : null;
  const rangeDayByDate = useMemo(() => new Map(snapshot?.account.days.map(day => [day.businessDate, day]) ?? []), [snapshot]);
  const visibleAction = action?.scopeKey === scopeKey ? action : null;
  /** A frozen correction from this mount is in progress: every read and write control waits for its result. */
  const visibleFrozen = visibleAction && !isRecoveryIdentity(visibleAction) ? visibleAction : null;

  const loadAgain = useCallback(() => {
    if (visibleFrozen) return;
    if (!range || !selectedId || !leaseToday) {
      setLoading(true);
      setLoadError('');
      setBootstrapAttempt(value => value + 1);
      return;
    }
    setLoading(true);
    setSnapshot(null);
    setLoadError('');
    setRefresh(value => value + 1);
  }, [leaseToday, range, selectedId, visibleFrozen]);

  const submitRange = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (visibleFrozen || !leaseToday) return;
    try {
      const next = rangeKind === 'custom' ? validateCloudLedgerRange({ kind: 'custom', startDate, endDate })
        : createCloudLedgerDateRange(rangeKind, anchorDate || leaseToday);
      setFormError('');
      setLoading(true);
      setSnapshot(null);
      setLoadError('');
      setRange(next);
    } catch (error) { setFormError(errorText(error)); }
  }, [anchorDate, endDate, leaseToday, rangeKind, startDate, visibleFrozen]);

  const canMutate = useCallback((transaction: CloudReportTransaction) => {
    const day = rangeDayByDate.get(transaction.businessDate);
    return transaction.businessDate < (snapshot?.account.leaseToday ?? '')
      && transaction.status === 'active' && day?.status === 'open'
      && day.lastSettlementRevision === 0 && day.revision !== null;
  }, [rangeDayByDate, snapshot?.account.leaseToday]);

  const openDraft = useCallback((transaction: CloudReportTransaction, kind: 'correct' | 'void') => {
    if (visibleFrozen || !canMutate(transaction)) return;
    setDraft({ transaction, kind });
    setMealPriceText(String(transaction.mealPrice));
    setPaidAmountText(String(transaction.paidAmount));
    setRefundAmountText(String(transaction.amount));
    // A paper number in the stored note stays locked (Rules keep it); the form edits only the text after it.
    setNote(splitPaperNote(transaction.note).text);
    setReason('');
    setFormError('');
  }, [canMutate, visibleFrozen]);

  const ownsOperation = (operation: MutationOperation): boolean => (
    operationRef.current === operation && !operation.completed && isCurrentCloudActionOwner(actionOwnerRef, operation.owner)
  );

  const clearTimer = (operation: MutationOperation) => {
    if (operation.timerId !== null) window.clearTimeout(operation.timerId);
    operation.timerId = null;
  };

  const notify = (operation: MutationOperation, state: 'recovering' | 'resolved') => {
    navigationRef.current?.(operation.owner.identityKey, state);
  };

  /** The original submission is over, one way or another, with the receipt still unconfirmed. */
  const showUnknown = (operation: MutationOperation, message: string) => {
    if (!ownsOperation(operation) || operation.receipt) return;
    clearTimer(operation);
    operation.retryAuthorized = false;
    setRecovery({
      commandId: operation.action.id, phase: operation.checking ? 'checking' : 'unknown', timedOut: false, canRetry: false,
    });
    setNotice(message);
  };

  const beginAttempt = (operation: MutationOperation) => {
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
      setRecovery(previous => (previous && previous.commandId === operation.action.id
        ? { ...previous, phase: 'submitting', timedOut: true, canRetry: false }
        : previous));
    }, PROMPT_AFTER_MS);
  };

  /** The one place a receipt is accepted: clean the journal once, then reload the full history from the server. */
  const settleWithReceipt = async (operation: MutationOperation, receipt: CommandReceipt) => {
    if (!ownsOperation(operation) || operation.receipt) return;
    const frozen = operation.action;
    if (receipt.commandId !== frozen.input.commandId || receipt.kind !== frozen.input.kind) {
      showUnknown(operation, RECEIPT_MISMATCH);
      return;
    }
    clearTimer(operation);
    operation.receipt = receipt;
    operation.retryAuthorized = false;
    operation.checking = false;
    operation.querySequence += 1;
    setRecovery({ commandId: frozen.id, phase: 'checking', timedOut: false, canRetry: false });
    let warning = '';
    try {
      const cleaned = await orders.cleanupConfirmedIntent(
        frozen.input, operation.datasetId, operation.uid, () => ownsOperation(operation) && browserIsOnline(),
      );
      if (!cleaned && ownsOperation(operation)) warning = '本機命令追蹤尚未清理；伺服器回執仍已確認。';
    } catch (error) {
      if (!ownsOperation(operation)) return;
      if (isAuthorizationLoss(error)) {
        revokeSensitiveUI(operation.owner, error);
        return;
      }
      warning = '本機命令追蹤清理未完成；伺服器回執仍已確認。';
    }
    if (!ownsOperation(operation)) return;
    removeRecoveryAction(frozen);
    dropOperation();
    setAction(null);
    setRecovery(null);
    setDraft(null);
    setCleanupWarning(warning);
    setNotice(isRecoveryIdentity(frozen)
      ? '原命令收據已確認；依目前完整資料重新讀取帳戶歷史。'
      : '更正收據已確認；正在依新來源序號重讀完整歷史。');
    setSnapshot(null);
    setLoadError('');
    const latest = latestRef.current;
    if (latest.range && latest.selectedId) {
      // A confirmed receipt is not a ready page: navigation stays recovering until the fresh heads load or fail.
      notify(operation, 'recovering');
      setLoading(true);
      setRefresh(value => value + 1);
    } else if (latest.readyScopeKey === latest.scopeKey) {
      setLoading(false);
      notify(operation, 'resolved');
    } else {
      setLoading(true);
      setBootstrapAttempt(value => value + 1);
    }
  };

  const finishResult = async (operation: MutationOperation, result: CommandResult) => {
    if (!ownsOperation(operation) || operation.receipt) return;
    clearTimer(operation);
    if (!result.ok) {
      if (isAuthorizationLoss(result.error)) {
        revokeSensitiveUI(operation.owner, result.error);
        return;
      }
      if (result.error.code === 'UNKNOWN_RESULT' || result.error.code === 'OFFLINE') {
        showUnknown(operation, UNKNOWN_RESULT);
        return;
      }
      // A definite refusal: nothing was recorded, so a later correction starts a new command.
      removeRecoveryAction(operation.action);
      dropOperation();
      setAction(null);
      setRecovery(null);
      if (result.error.code === 'REVISION_CONFLICT') {
        setDraft(null);
        setNotice('資料版本已變更。已重新載入完整歷史；請檢視新資料後重新開啟更正並確認，不會自動重送舊內容。');
        setLoading(true);
        setSnapshot(null);
        setLoadError('');
        setRefresh(value => value + 1);
      } else {
        setNotice(result.error.message);
        if (result.error.code === 'DAY_CLOSED') {
          setLoading(true);
          setSnapshot(null);
          setLoadError('');
          setDraft(null);
          setRefresh(value => value + 1);
        }
      }
      notify(operation, 'resolved');
      return;
    }
    await settleWithReceipt(operation, result.receipt);
  };

  const runAttempt = async (operation: MutationOperation) => {
    const frozen = operation.action;
    if (!ownsOperation(operation) || isRecoveryIdentity(frozen)) return;
    beginAttempt(operation);
    setRecovery({ commandId: frozen.id, phase: 'submitting', timedOut: false, canRetry: false });
    const attempt = operation.attempt;
    const attemptPromise = orders.mutateTransaction(frozen.input);
    operation.attemptPromise = attemptPromise;
    try {
      const result = await attemptPromise;
      if (!ownsOperation(operation) || operation.attempt !== attempt) return;
      operation.attemptSettled = true;
      if (operation.attemptPromise === attemptPromise) operation.attemptPromise = null;
      await finishResult(operation, result);
    } catch (error) {
      if (!ownsOperation(operation) || operation.attempt !== attempt) return;
      operation.attemptSettled = true;
      if (operation.attemptPromise === attemptPromise) operation.attemptPromise = null;
      clearTimer(operation);
      // A receipt confirmed by the query stands: a late failure of the original submission never undoes it.
      if (operation.receipt) return;
      if (isAuthorizationLoss(error)) {
        revokeSensitiveUI(operation.owner, error);
        return;
      }
      showUnknown(operation, UNKNOWN_RESULT);
    }
  };

  const startMutation = (frozen: FrozenMutation) => {
    const owner = actionOwnerRef.current;
    if (!isCurrentCloudActionOwner(actionOwnerRef, owner) || owner.scopeKey !== frozen.scopeKey || operationRef.current) return;
    const uid = currentUid(db);
    if (!uid) {
      revokeSensitiveUI(owner, {
        code: 'UNAUTHORIZED', message: '目前登入身分尚未確認，雲端資料已清除。請重新登入操作員帳號。',
      });
      return;
    }
    const operation: MutationOperation = {
      owner, action: frozen, datasetId: frozen.datasetId, uid, attempt: 0, attemptPromise: null,
      attemptSettled: false, timedOut: false, querySequence: 0, checking: false, retryAuthorized: false,
      receipt: null, timerId: null, completed: false,
    };
    operationRef.current = operation;
    setAction(frozen);
    setCleanupWarning('');
    storeRecoveryIdentity(frozen, owner, uid);
    setNotice('正在送出固定版本的歷史更正…');
    notify(operation, 'recovering');
    void runAttempt(operation);
  };

  /** After a remount only the identity exists; its operation is created on the first explicit query. */
  const operationFor = (intent: RecoverableMutation): MutationOperation | null => {
    const existing = operationRef.current;
    if (existing) return existing.action.id === intent.id ? existing : null;
    const owner = actionOwnerRef.current;
    if (!isCurrentCloudActionOwner(actionOwnerRef, owner) || !isRecoveryIdentity(intent)
      || intent.scopeKey !== owner.scopeKey || intent.identityKey !== owner.identityKey
      || intent.leaseEpoch !== owner.leaseEpoch) return null;
    const operation: MutationOperation = {
      owner, action: intent, datasetId: intent.datasetId, uid: intent.uid, attempt: 0, attemptPromise: null,
      attemptSettled: true, timedOut: false, querySequence: 0, checking: false, retryAuthorized: false,
      receipt: null, timerId: null, completed: false,
    };
    operationRef.current = operation;
    return operation;
  };

  const checkPending = async () => {
    const intent = visibleAction;
    const owner = actionOwnerRef.current;
    if (!intent || !isCurrentCloudActionOwner(actionOwnerRef, owner) || intent.scopeKey !== owner.scopeKey) return;
    const operation = operationFor(intent);
    if (!operation || !ownsOperation(operation) || operation.checking || operation.receipt) return;
    if (!operation.attemptSettled && !operation.timedOut) return;
    const frozen = operation.action;
    const view = (phase: RecoveryPhase, canRetry: boolean): RecoveryView => ({
      commandId: frozen.id, phase, timedOut: !operation.attemptSettled, canRetry,
    });
    if (!browserIsOnline()) {
      operation.retryAuthorized = false;
      setRecovery(view(operation.attemptSettled ? 'unknown' : 'submitting', false));
      setNotice('目前離線；查詢錯誤不代表命令不存在，暫不可重試。');
      return;
    }
    operation.checking = true;
    const attemptAtStart = operation.attempt;
    const settledAtStart = operation.attemptSettled && operation.attemptPromise === null;
    operation.retryAuthorized = false;
    const sequence = ++operation.querySequence;
    setRecovery(view('checking', false));
    setNotice('正在查詢原命令結果…');
    const pending = (message: string, canRetry: boolean) => {
      setRecovery(view(operation.attemptSettled ? 'unknown' : 'submitting', canRetry));
      setNotice(message);
    };
    try {
      const check = await orders.confirmPendingIntent(frozen.input, operation.datasetId, operation.uid);
      if (!ownsOperation(operation) || operation.querySequence !== sequence
        || operation.attempt !== attemptAtStart || operation.receipt) return;
      if (check.status === 'matched') {
        await settleWithReceipt(operation, check.receipt);
        return;
      }
      if (check.status === 'different-dataset') {
        pending('目前伺服器資料集已變更；原更正命令尚未確認，請聯絡維護者，不可重試。', false);
        return;
      }
      if (isRecoveryIdentity(frozen)) {
        pending('伺服器查無原命令收據；原更正內容未保留，請依目前完整資料重新確認。', false);
        notify(operation, 'resolved');
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
    } catch (error) {
      if (!ownsOperation(operation) || operation.querySequence !== sequence || operation.receipt) return;
      if (isAuthorizationLoss(error)) {
        revokeSensitiveUI(operation.owner, error);
        return;
      }
      operation.retryAuthorized = false;
      pending(queryFailureMessage(error), false);
    } finally {
      if (operationRef.current === operation && operation.querySequence === sequence) operation.checking = false;
    }
  };

  const retryPending = () => {
    const operation = operationRef.current;
    if (!operation || !ownsOperation(operation) || !operation.attemptSettled || !operation.retryAuthorized
      || operation.receipt || operation.checking || isRecoveryIdentity(operation.action)) return;
    if (!browserIsOnline()) {
      operation.retryAuthorized = false;
      setRecovery(previous => (previous ? { ...previous, canRetry: false } : previous));
      setNotice('目前離線，沒有重試命令；請恢復連線後重新查詢原命令。');
      return;
    }
    operation.retryAuthorized = false;
    void runAttempt(operation);
  };


  const submitMutation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft || !snapshot || !currentStudent || !range || visibleFrozen || operationRef.current) return;
    const day = rangeDayByDate.get(draft.transaction.businessDate);
    if (!day || day.status !== 'open' || day.lastSettlementRevision !== 0 || day.revision === null
      || draft.transaction.status !== 'active') {
      setFormError('這筆交易所屬營業日已關帳或缺少完整版本，歷史查帳唯讀。');
      return;
    }
    const reasonValue = reason.trim();
    if (!reasonValue) { setFormError('請填寫更正理由。'); return; }
    const common = {
      commandId: crypto.randomUUID(), leaseEpoch, transactionId: draft.transaction.transactionId,
      studentId: selectedId!, dayId: draft.transaction.businessDate,
      expectedTransactionRevision: draft.transaction.revision,
      expectedStudentRevision: currentStudent.revision,
      expectedDayRevision: day.revision,
    };
    if (draft.kind === 'void') {
      const input: CloudTransactionMutationInput = {
        ...common, kind: 'VoidTransaction', payload: { reason: reasonValue },
      };
      setFormError('');
      startMutation({ id: input.commandId, scopeKey, datasetId: snapshot.account.datasetId, input });
      return;
    }

    const lockedPaperRef = splitPaperNote(draft.transaction.note).paperRef;
    const composedNote = lockedPaperRef
      ? composePaperRefNote({ paperRef: lockedPaperRef, text: note, required: true })
      : { ok: true as const, note: note.trim() };
    if (!composedNote.ok) { setFormError(composedNote.error); return; }
    let payload: CorrectTransactionPayload;
    if (draft.transaction.type === 'refund') {
      const amount = integerText(refundAmountText, { allowZero: false });
      if (amount === null || amount > draft.transaction.amount || !note.trim()) {
        setFormError('退款更正金額必須是正整數且不可增加；說明不可空白。');
        return;
      }
      const correction: CorrectTransactionPayload = { mealPrice: 0, paidAmount: 0, amount, note: composedNote.note, reason: reasonValue };
      payload = correction;
    } else if (draft.transaction.type === 'payment') {
      const paidAmount = integerText(paidAmountText, { allowZero: false });
      if (paidAmount === null) { setFormError('收款金額必須是 1 到 1,000,000,000 的整數。'); return; }
      payload = { mealPrice: 0, paidAmount, amount: paidAmount, note: composedNote.note, reason: reasonValue };
    } else {
      const mealPrice = integerText(mealPriceText);
      const paidAmount = integerText(paidAmountText);
      if (mealPrice === null || paidAmount === null || mealPrice > 1_000_000 || paidAmount > 1_000_000) {
        setFormError('餐費與收款必須是 0 到 1,000,000 的整數。');
        return;
      }
      payload = { mealPrice, paidAmount, amount: paidAmount - mealPrice, note: composedNote.note, reason: reasonValue };
    }
    const input: CloudTransactionMutationInput = {
      ...common, kind: 'CorrectTransaction', payload,
    };
    setFormError('');
    startMutation({ id: input.commandId, scopeKey, datasetId: snapshot.account.datasetId, input });
  };


  const statusNode = notice ? <p role="status">{notice}</p> : null;
  const retryButtonDisabled = loading || Boolean(visibleFrozen);

  return (
    <section className="cloud-account-history" aria-label="雲端查帳">
      <header className="cloud-account-history__header"><div><p className="cloud-account-history__eyebrow">F5 · 帳戶完整歷史前綴</p>
        <h2>雲端查帳與歷史更正</h2><p>使用目前學生名單映射帳戶 ID；餘額依目前更正後資料重算，不代表當時現金快照。</p></div>
        {snapshot && <strong>來源序號 H={snapshot.account.sourceSeq}</strong>}
      </header>

      <div className="cloud-account-history__controls">
        <label>搜尋目前帳戶<input aria-label="搜尋目前學生帳戶" value={search} disabled={retryButtonDisabled}
          onChange={event => setSearch(event.target.value)} placeholder="目前編號、姓名或別名" /></label>
        {search.trim() && <div aria-label="目前帳戶候選">{candidateStudents.map(student => <button type="button" key={student.studentId}
          disabled={retryButtonDisabled} onClick={() => {
            setSelectedId(student.studentId); setSnapshot(null); setLoading(true); setLoadError('');
          }}>
          {student.displayName}（{student.studentCode}）
        </button>)}</div>}
        <form className="cloud-account-history__date-form" onSubmit={submitRange}>
          <label>日期範圍<select aria-label="查帳日期範圍" value={rangeKind} disabled={retryButtonDisabled}
            onChange={event => setRangeKind(event.target.value as CloudLedgerDateRange['kind'])}>
            <option value="today">今天</option><option value="week">本週</option><option value="month">本月</option><option value="custom">自訂</option>
          </select></label>
          {rangeKind === 'custom' ? <><label>開始日期<input aria-label="查帳開始日期" type="date" value={startDate} disabled={retryButtonDisabled} onChange={event => setStartDate(event.target.value)} /></label>
            <label>結束日期<input aria-label="查帳結束日期" type="date" value={endDate} disabled={retryButtonDisabled} onChange={event => setEndDate(event.target.value)} /></label></>
            : <label>範圍日期<input aria-label="查帳範圍日期" type="date" value={anchorDate} disabled={retryButtonDisabled} onChange={event => setAnchorDate(event.target.value)} /></label>}
          <button type="submit" disabled={retryButtonDisabled}>查詢完整歷史</button>
        </form>
      </div>
      {formError && <p role="alert">{formError}</p>}
      {loadError && <div role="alert"><p>{loadError}</p><button type="button" disabled={retryButtonDisabled} onClick={loadAgain}>重新讀取</button></div>}
      {loading && <p role="status">正在伺服器完整讀取帳戶歷史前綴、日結與稽核資料；尚未完整前不顯示逐筆餘額或更正入口。</p>}
      {!loading && !selectedId && !loadError && <p>請搜尋並選取目前學生名單中的帳戶。</p>}
      {!loading && snapshot && currentStudent && range && <>
        <p className="cloud-account-history__snapshot" data-testid="account-history-ready">dataset {snapshot.account.datasetId} · {range.startDate}–{range.endDate} · {currentStudent.displayName}（目前編號 {currentStudent.studentCode}） · 來源序號 H={snapshot.account.sourceSeq}</p>
        <dl className="cloud-account-history__balance">
          <div><dt>期初餘額</dt><dd>{formatMoney(snapshot.account.openingBalance)}</dd></div>
          <div><dt>目前帳戶餘額</dt><dd>{formatMoney(snapshot.account.currentBalance)}</dd></div>
          <div><dt>帳戶狀態</dt><dd>{currentStudent.status}</dd></div>
          <div><dt>學生版本</dt><dd>{currentStudent.revision}</dd></div>
        </dl>
        <p><strong>依目前更正後資料重算</strong> · 各筆餘額來自完整前綴驗證；本日結版本另列，不視為交易當時餘額。</p>

        <section aria-labelledby="account-transactions-heading"><h3 id="account-transactions-heading">區間交易與更正入口</h3>
          <div className="cloud-account-history__table-wrap"><table><thead><tr><th>營業日／時間</th><th>交易</th><th>當時姓名</th><th>金額</th><th>重算後餘額</th><th>狀態／回填</th><th>日狀態</th><th>操作</th></tr></thead><tbody>
            {snapshot.account.transactions.map(transaction => {
              const day = rangeDayByDate.get(transaction.businessDate);
              const eligible = canMutate(transaction);
              return <tr key={transaction.transactionId}>
                <td>{transaction.businessDate}<small>{formatTaipeiTime(transaction.createdAt)}</small></td>
                <td>{transaction.type} · {transaction.transactionId}<details><summary>交易與稽核詳情</summary>
                  <dl><dt>最後修改命令</dt><dd>{transaction.lastCommandId}</dd><dt>建立者</dt><dd>{transaction.operatorUid} · {transaction.operatorEmail}</dd>
                    <dt>當時菜單</dt><dd>{transaction.menuNameSnapshot} · {transaction.vendorNameSnapshot}</dd><dt>回填</dt><dd>{transaction.backfilled ? '是' : '否'}</dd>
                    {splitPaperNote(transaction.note).paperRef && <><dt>紙本號</dt><dd data-testid="history-paper-ref">{splitPaperNote(transaction.note).paperRef}</dd></>}
                    <dt>交易備註</dt><dd>{splitPaperNote(transaction.note).text || '—'}</dd></dl>
                  {snapshot.audit.rows.filter(row => row.studentId === selectedId && (row.commandId === transaction.lastCommandId
                    || JSON.stringify(row.before).includes(transaction.transactionId) || JSON.stringify(row.after).includes(transaction.transactionId)))
                    .map(row => <article key={row.commandId}><strong>{row.kind} · {row.commandId} · seq {row.seq} · {row.dateBasis === 'committed-at' ? '按記錄日期歸屬' : '按營業日歸屬'}</strong>
                      <p>{row.reason || '無理由'} · {row.actorUid} · {row.actorEmail} · {formatTaipeiTime(row.committedAt)}</p>
                      <pre>before: {JSON.stringify(row.before, null, 2)}{'\n'}after: {JSON.stringify(row.after, null, 2)}</pre></article>)}
                </details></td>
                <td>{transaction.studentNameSnapshot}</td><td>{formatMoney(transaction.amount)} · 餐費 {formatMoney(transaction.mealPrice)} · 收款 {formatMoney(transaction.paidAmount)}</td>
                <td>{transaction.afterBalance === undefined || transaction.balanceApplicability !== 'verified' ? '未驗證' : formatMoney(transaction.afterBalance)}</td>
                <td>{transaction.status === 'voided' ? '已作廢（保留原列）' : '有效'}{transaction.backfilled ? ' · 回填' : ''}</td>
                <td>{day?.status ?? '無日文件'}{day?.lastSettlementRevision ? ` · 曾關帳第 ${day.lastSettlementRevision} 版` : ''}</td>
                <td>{eligible ? <><button type="button" disabled={Boolean(visibleFrozen)} onClick={() => openDraft(transaction, 'correct')}>更正</button>
                  <button type="button" disabled={Boolean(visibleFrozen)} onClick={() => openDraft(transaction, 'void')}>作廢</button></>
                  : <span>{day?.status === 'closed' || day?.lastSettlementRevision ? '唯讀；現金差額請到日結補記' : '唯讀'}</span>}</td>
              </tr>;
            })}
          </tbody></table></div>
          {snapshot.account.transactions.length === 0 && <p>此範圍沒有帳戶交易；完整前綴餘額仍已驗證。</p>}
        </section>

        <section aria-labelledby="account-settlements-heading"><h3 id="account-settlements-heading">日結版本（全日現金，不代表此帳戶餘額）</h3>
          {snapshot.account.settlements.map(settlement => <article key={`${settlement.businessDate}:${settlement.revision}`}>
            <strong>{settlement.businessDate} · 第 {settlement.revision} 版 · {settlement.status}</strong>
            <p>應有現金 {formatMoney(settlement.expectedCash)} · 實點 {settlement.countedCash === null ? '—' : formatMoney(settlement.countedCash)} · {settlement.actorUid} · {formatTaipeiTime(settlement.committedAt)}</p>
            <p>{settlement.note || '無備註'}</p>
          </article>)}
          {snapshot.account.settlements.length === 0 && <p>此範圍沒有日結版本。</p>}
          {snapshot.account.postCloseEntries.map(entry => <article key={entry.entryId}>
            <strong>{entry.businessDate} · 日結第 {entry.settlementRevision} 版後補記 · {entry.direction === 'income' ? '收入' : '支出'} {formatMoney(entry.amount)}</strong>
            <p>{entry.reason} · {entry.createdBy} · {formatTaipeiTime(entry.createdAt)} · {entry.countedInEffectiveCash ? '計入有效現金' : '未計入有效現金'}</p>
          </article>)}
        </section>

        <section aria-labelledby="account-audit-heading"><h3 id="account-audit-heading">帳戶範圍稽核</h3>
          <p>沒有營業日的操作依台北記錄日期列入；本次稽核只涵蓋此帳戶與選定區間。</p>
          <div className="cloud-account-history__table-wrap"><table><thead><tr><th>seq／命令</th><th>有效日期與依據</th><th>操作人／時間</th><th>理由</th><th>before / after</th></tr></thead><tbody>
            {snapshot.audit.rows.map(row => <tr key={row.commandId}><td>{row.seq} · {row.kind}<small>{row.commandId}</small></td>
              <td>{row.attributedDate} · {row.dateBasis === 'business-date' ? '營業日' : '記錄日（台北）'}<small>原營業日：{row.businessDate ?? '無'}</small></td>
              <td>{row.actorUid} · {row.actorEmail}<small>{formatTaipeiTime(row.committedAt)}</small></td><td>{row.reason ?? '—'}</td>
              <td><details><summary>查看</summary><pre>before: {JSON.stringify(row.before, null, 2)}{'\n'}after: {JSON.stringify(row.after, null, 2)}</pre></details></td></tr>)}
          </tbody></table></div>
        </section>
      </>}

      {draft && snapshot && <form className="cloud-account-history__mutation" aria-label="歷史交易更正" onSubmit={submitMutation}>
        <h3>{draft.kind === 'void' ? '作廢歷史交易' : '更正歷史交易'} · {draft.transaction.transactionId}</h3>
        <p>固定交易版本 {draft.transaction.revision}、學生版本 {currentStudent?.revision ?? '—'}、日期版本 {rangeDayByDate.get(draft.transaction.businessDate)?.revision ?? '—'}。此頁只允許仍未曾關帳的營業日。</p>
        {draft.kind === 'correct' && draft.transaction.type === 'order' && <>
          <label>餐費<input aria-label="更正餐費" inputMode="numeric" disabled={Boolean(visibleFrozen)} value={mealPriceText} onChange={event => setMealPriceText(event.target.value)} /></label>
          <label>收款<input aria-label="更正收款" inputMode="numeric" disabled={Boolean(visibleFrozen)} value={paidAmountText} onChange={event => setPaidAmountText(event.target.value)} /></label>
        </>}
        {draft.kind === 'correct' && draft.transaction.type === 'payment' && <label>收款金額<input aria-label="更正收款金額" inputMode="numeric" disabled={Boolean(visibleFrozen)} value={paidAmountText} onChange={event => setPaidAmountText(event.target.value)} /></label>}
        {draft.kind === 'correct' && draft.transaction.type === 'refund' && <label>退款金額<input aria-label="更正退款金額" inputMode="numeric" disabled={Boolean(visibleFrozen)} value={refundAmountText} onChange={event => setRefundAmountText(event.target.value)} /></label>}
        {draft.kind === 'correct' && splitPaperNote(draft.transaction.note).paperRef && <p data-testid="correction-paper-ref">紙本號 {splitPaperNote(draft.transaction.note).paperRef}（更正時不能修改）</p>}
        {draft.kind === 'correct' && <label>交易備註<input aria-label="交易備註" disabled={Boolean(visibleFrozen)} value={note} onChange={event => setNote(event.target.value)} /></label>}
        <label>更正理由<input aria-label="更正理由" disabled={Boolean(visibleFrozen)} value={reason} onChange={event => setReason(event.target.value)} required /></label>
        <button type="submit" disabled={Boolean(visibleFrozen)}>確認送出</button>
        <button type="button" disabled={Boolean(visibleFrozen)} onClick={() => { setDraft(null); setFormError(''); }}>取消</button>
      </form>}
      {visibleAction && <section className="cloud-account-history__recovery" aria-label={isRecoveryIdentity(visibleAction) ? '待確認歷史更正命令' : '歷史更正命令恢復'}>
        <strong>{!recovery ? '結果確認中，請勿重複操作。'
          : recovery.phase === 'checking' ? '正在查詢原命令結果…'
            : recovery.phase === 'submitting'
              ? recovery.timedOut ? '結果確認中，勿重新收款' : '命令送出中，請勿重複操作。'
              : '結果確認中，請勿重複操作。'}</strong>
        {isRecoveryIdentity(visibleAction)
          ? <p>有一筆歷史更正命令待確認。查詢原收據後，依目前完整資料繼續；不會自動重送。</p>
          : <p>更正命令 ID {visibleAction.id} · 交易 {visibleAction.input.transactionId}</p>}
        {isRecoveryIdentity(visibleAction) && <p>命令編號 {visibleAction.id}</p>}
        <div>
          {isRecoveryIdentity(visibleAction)
            ? <button type="button" disabled={recovery?.phase === 'checking'} onClick={() => void checkPending()}>查詢原命令收據</button>
            : (!recovery || recovery.phase === 'unknown' || (recovery.phase === 'submitting' && recovery.timedOut))
              && <button type="button" onClick={() => void checkPending()}>查詢原命令結果</button>}
          {recovery?.canRetry && <button type="button" onClick={retryPending}>以相同命令編號重試</button>}
        </div>
        {statusNode}
      </section>}
      {!visibleAction && statusNode}
      {cleanupWarning && <p role="status">{cleanupWarning}</p>}
    </section>
  );
}
