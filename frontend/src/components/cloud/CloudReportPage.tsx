import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { getAuth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { CommandReceipt, CommandResult } from '../../domain/cloudCommands';
import {
  createCloudLedgerDateRange,
  searchCloudReportStudentIds,
  validateCloudLedgerRange,
  type CloudAccessEventsSnapshot,
  type CloudAuditRangeSnapshot,
  type CloudLedgerDateRange,
  type CloudLedgerDateRangeKind,
  type CloudLedgerReport,
  type CloudMergedTransaction,
  type CloudReportTransaction,
} from '../../domain/cloudLedgerReport';
import {
  buildCloudAuditCsv,
  buildCloudMergedTransactionCsv,
  buildCloudPostCloseCsv,
  buildCloudSettlementCsv,
  buildCloudTransactionCsv,
} from '../../domain/cloudLedgerExport';
import { createCloudReadRepository, type CloudReadRepositoryError } from '../../firebase/cloudReadRepository';
import {
  createCloudReportActionRepository,
  type RecordCloudExportInput,
  type RecordCloudPrintInput,
} from '../../firebase/cloudReportActionRepository';
import { getCloudRecoveryReader } from '../../firebase/cloudRecoveryReader';
import { paperRefsIn, splitPaperNote } from '../../domain/paperRef';
import { isCurrentCloudActionOwner, useCloudActionOwner, type CloudActionOwnerToken } from './useCloudActionOwner';
import './CloudReportPage.css';

export interface CloudReportPageProps {
  db: Firestore;
  leaseEpoch: number;
  identityKey: string;
  onNavigationStateChange?: (identityKey: string, state: 'recovering' | 'revoked' | 'resolved') => void;
  onOpenDayClose?: (dayId: string) => void;
  onOpenAccountHistory?: (studentId: string, range: CloudLedgerDateRange) => void;
}

interface QueryRequest {
  range: CloudLedgerDateRange;
  studentId: string | null;
}

/** The handover table is read-only context: its failure never hides the report, but it is never shown unverified. */
type AccessEventsView =
  | { status: 'ready'; snapshot: CloudAccessEventsSnapshot }
  | { status: 'unavailable'; message: string };

interface Snapshot {
  report: CloudLedgerReport;
  /** null when the scope is a single account: lease handovers are not account facts. */
  accessEvents: AccessEventsView | null;
}

interface FrozenAction {
  id: string;
  kind: 'export' | 'print';
  scopeKey: string;
  /** The dataset the report was read from; the read-only confirmation must see the same one. */
  datasetId: string;
  input: RecordCloudExportInput | RecordCloudPrintInput;
  contents: string;
  filename: string;
  title: string;
  rows: readonly (CloudReportTransaction | CloudMergedTransaction)[];
}

/** What survives an unmount: identity only, never the report content or the frozen H. */
interface RecoveryIdentity {
  id: string;
  kind: 'export' | 'print';
  scopeKey: string;
  identityKey: string;
  leaseEpoch: number;
  datasetId: string;
  uid: string;
  input: RecordCloudExportInput | RecordCloudPrintInput;
}

type RecoverableAction = FrozenAction | RecoveryIdentity;
const actionRecoveryRegistry = new Map<string, RecoveryIdentity>();

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
 * One RecordExport/RecordPrint operation per mounted owner: the original submission's independent liveness plus the
 * read-only queries. Nothing of it survives an owner change or an unmount; the registry and journal keep the identity.
 */
interface ActionOperation {
  owner: CloudActionOwnerToken;
  action: RecoverableAction;
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
const RECEIPT_MISMATCH = '伺服器回執與固定命令不一致；保留原命令編號，尚未確認完成。';
const UNKNOWN_RESULT = '操作回應不確定；請唯讀查詢原命令結果。查詢錯誤或找不到結果都不會自動重送。';

function isRecoveryIdentity(action: RecoverableAction): action is RecoveryIdentity {
  return 'identityKey' in action;
}

function storeRecoveryIdentity(
  action: Pick<FrozenAction, 'id' | 'kind' | 'scopeKey' | 'input'>,
  owner: Pick<CloudActionOwnerToken, 'identityKey' | 'leaseEpoch'>,
  datasetId: string,
  uid: string,
): void {
  const current = actionRecoveryRegistry.get(action.scopeKey);
  if (current && current.id !== action.id) return;
  actionRecoveryRegistry.set(action.scopeKey, {
    id: action.id, kind: action.kind, scopeKey: action.scopeKey,
    identityKey: owner.identityKey, leaseEpoch: owner.leaseEpoch, datasetId, uid, input: action.input,
  });
}

function removeRecoveryAction(action: Pick<RecoverableAction, 'id' | 'scopeKey'>): void {
  if (actionRecoveryRegistry.get(action.scopeKey)?.id === action.id) actionRecoveryRegistry.delete(action.scopeKey);
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

function messageOf(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return '無法完整讀取雲端報表';
}

function errorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error ? String((error as CloudReadRepositoryError).code) : null;
}

function money(value: number): string {
  return `$${new Intl.NumberFormat('zh-TW').format(value)}`;
}

function taipeiTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '時間不正確';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'medium', hour12: false,
  }).format(date);
}

function sameEnvelope(report: CloudLedgerReport, audit: CloudAuditRangeSnapshot, request: QueryRequest, leaseEpoch: number): boolean {
  return report.complete === true && audit.complete === true
    && report.datasetId === audit.datasetId
    && report.sourceSeq === audit.sourceSeq
    && report.leaseEpoch === audit.leaseEpoch && report.leaseEpoch === leaseEpoch
    && report.goLiveDate === audit.goLiveDate
    && report.leaseToday === audit.leaseToday
    && report.range.startDate === request.range.startDate && report.range.endDate === request.range.endDate
    && audit.range.startDate === request.range.startDate && audit.range.endDate === request.range.endDate
    && report.scope.studentId === request.studentId && audit.scope.studentId === request.studentId;
}

function sameAccessEventsEnvelope(events: CloudAccessEventsSnapshot, report: CloudLedgerReport, request: QueryRequest, leaseEpoch: number): boolean {
  return events.complete === true
    && events.datasetId === report.datasetId
    && events.sourceSeq === report.sourceSeq
    && events.goLiveDate === report.goLiveDate
    && events.leaseToday === report.leaseToday
    && events.leaseEpoch === leaseEpoch
    && events.range.startDate === request.range.startDate && events.range.endDate === request.range.endDate;
}

const ACCESS_EVENT_KIND_TEXT = {
  acquire: '取得使用權',
  takeover: '接手使用權',
  release: '釋放使用權',
} as const;

function previousHolderText(row: CloudAccessEventsSnapshot['rows'][number]): string {
  if (row.previousHolderState === 'none') return '無';
  return row.previousHolderEmail ?? '（無紀錄）';
}

function csvFor(type: RecordCloudExportInput['exportType'], snapshot: Snapshot, audit: CloudAuditRangeSnapshot | null): string {
  switch (type) {
    case 'transactions-original': return buildCloudTransactionCsv(snapshot.report.transactions);
    case 'transactions-merged': return buildCloudMergedTransactionCsv(snapshot.report.mergedTransactions);
    case 'settlements': return buildCloudSettlementCsv(snapshot.report.settlements, snapshot.report.days);
    case 'post-close-entries': return buildCloudPostCloseCsv(snapshot.report.postCloseEntries, snapshot.report.sourceSeq);
    case 'audit': return buildCloudAuditCsv(audit?.rows ?? [], audit?.sourceSeq ?? snapshot.report.sourceSeq);
  }
}

function actionResultMatches(receipt: CommandReceipt | null, action: Pick<RecoverableAction, 'id' | 'kind'>): receipt is CommandReceipt {
  const expected = action.kind === 'export' ? 'RecordExport' : 'RecordPrint';
  return Boolean(receipt && receipt.commandId === action.id && receipt.kind === expected);
}

function performBrowserAction(action: FrozenAction, performed: Set<string>): void {
  if (performed.has(action.id)) return;
  performed.add(action.id);
  if (action.kind === 'print') {
    window.print();
    return;
  }
  const blob = new Blob([action.contents], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = action.filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

interface ActivePrintLifecycle {
  commandId: string;
  owner: CloudActionOwnerToken;
  handler: () => void;
}

export function CloudReportPage({
  db, leaseEpoch, identityKey, onNavigationStateChange, onOpenDayClose, onOpenAccountHistory,
}: CloudReportPageProps) {
  const reads = useMemo(() => createCloudReadRepository(db), [db]);
  const recoveryReader = useMemo(() => getCloudRecoveryReader(db), [db]);
  const actions = useMemo(() => createCloudReportActionRepository(db, { recoveryReader }), [db, recoveryReader]);
  const scopeKey = JSON.stringify([identityKey, leaseEpoch]);
  const actionOwnerRef = useCloudActionOwner(identityKey, leaseEpoch);
  const [leaseToday, setLeaseToday] = useState('');
  const [rangeKind, setRangeKind] = useState<CloudLedgerDateRangeKind>('today');
  const [rangeAnchor, setRangeAnchor] = useState('');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [query, setQuery] = useState<QueryRequest | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [inputError, setInputError] = useState('');
  const [search, setSearch] = useState('');
  const [scopeStudentId, setScopeStudentId] = useState<string | null>(null);
  const [mode, setMode] = useState<'original' | 'merged'>('original');
  const [pageNumber, setPageNumber] = useState(0);
  const [printDate, setPrintDate] = useState('');
  const [action, setAction] = useState<RecoverableAction | null>(() => actionRecoveryRegistry.get(scopeKey) ?? null);
  const [authorizedPrint, setAuthorizedPrint] = useState<FrozenAction | null>(null);
  const [actionMessage, setActionMessage] = useState('');
  const [auditBusy, setAuditBusy] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryView | null>(null);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [readyScopeKey, setReadyScopeKey] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const operationRef = useRef<ActionOperation | null>(null);
  const navigationRef = useRef(onNavigationStateChange);
  useEffect(() => { navigationRef.current = onNavigationStateChange; });
  const performedActions = useRef(new Set<string>());
  const printLifecycleRef = useRef<ActivePrintLifecycle | null>(null);

  const clearPrintLifecycle = useCallback((commandId?: string, owner?: CloudActionOwnerToken) => {
    const lifecycle = printLifecycleRef.current;
    if (!lifecycle || commandId && lifecycle.commandId !== commandId || owner && lifecycle.owner !== owner) return;
    window.removeEventListener('afterprint', lifecycle.handler);
    printLifecycleRef.current = null;
  }, []);

  const dropOperation = useCallback(() => {
    const operation = operationRef.current;
    if (!operation) return;
    if (operation.timerId !== null) window.clearTimeout(operation.timerId);
    operation.timerId = null;
    operation.completed = true;
    operation.attemptPromise = null;
    operationRef.current = null;
  }, []);

  useEffect(() => () => { clearPrintLifecycle(); dropOperation(); }, [clearPrintLifecycle, dropOperation, scopeKey]);

  const invalidateOwner = useCallback((owner: CloudActionOwnerToken, error: unknown) => {
    if (!isCurrentCloudActionOwner(actionOwnerRef, owner)) return;
    clearPrintLifecycle(undefined, owner);
    owner.revoked = true;
    requestGeneration.current += 1;
    dropOperation();
    setSnapshot(null);
    setQuery(null);
    setReadyScopeKey(null);
    setLoading(false);
    setLoadError(messageOf(error));
    setInputError('');
    setSearch('');
    setScopeStudentId(null);
    setRangeKind('today');
    setRangeAnchor('');
    setCustomStart('');
    setCustomEnd('');
    setLeaseToday('');
    setPageNumber(0);
    setPrintDate('');
    setAction(null);
    setAuthorizedPrint(null);
    setActionMessage('');
    setRecovery(null);
    onNavigationStateChange?.(owner.identityKey, 'revoked');
  }, [actionOwnerRef, clearPrintLifecycle, dropOperation, onNavigationStateChange]);

  const previousScopeKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    const previous = previousScopeKey.current;
    previousScopeKey.current = scopeKey;
    if (previous === null || previous === scopeKey) return;
    requestGeneration.current += 1;
    dropOperation();
    setSnapshot(null);
    setQuery(null);
    setReadyScopeKey(null);
    setLoading(true);
    setLoadError('');
    setInputError('');
    setSearch('');
    setScopeStudentId(null);
    setLeaseToday('');
    setRangeKind('today');
    setRangeAnchor('');
    setCustomStart('');
    setCustomEnd('');
    setPageNumber(0);
    setPrintDate('');
    setAction(actionRecoveryRegistry.get(scopeKey) ?? null);
    setAuthorizedPrint(null);
    setActionMessage('');
    setRecovery(null);
  }, [dropOperation, scopeKey]);

  useEffect(() => {
    let active = true;
    const generation = ++requestGeneration.current;
    const owner = actionOwnerRef.current;
    if (!owner || !isCurrentCloudActionOwner(actionOwnerRef, owner)) return;
    onNavigationStateChange?.(identityKey, 'resolved');
    const bootstrapRange: CloudLedgerDateRange = { kind: 'today', startDate: '2000-01-01', endDate: '2000-01-01' };
    void reads.readSummary({ range: bootstrapRange, leaseEpoch }).then(summary => {
      if (!active || requestGeneration.current !== generation || !isCurrentCloudActionOwner(actionOwnerRef, owner)) return;
      setSnapshot(null);
      setLoadError('');
      setActionMessage('');
      setScopeStudentId(null);
      setSearch('');
      setRangeKind('today');
      setLoading(true);
      setLeaseToday(summary.leaseToday);
      setRangeAnchor(summary.leaseToday);
      const todayRange: CloudLedgerDateRange = {
        kind: 'today', startDate: summary.leaseToday, endDate: summary.leaseToday,
      };
      setCustomStart(todayRange.startDate);
      setCustomEnd(todayRange.endDate);
      setReadyScopeKey(scopeKey);
      setLoading(true);
      setQuery({ range: todayRange, studentId: null });
    }).catch(error => {
      if (!active || requestGeneration.current !== generation || !isCurrentCloudActionOwner(actionOwnerRef, owner)) return;
      if (['LEASE_LOST', 'UNAUTHORIZED'].includes(errorCode(error) ?? '')) invalidateOwner(owner, error);
      else {
        setLoadError(messageOf(error));
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [actionOwnerRef, bootstrapAttempt, identityKey, invalidateOwner, leaseEpoch, onNavigationStateChange, reads, scopeKey]);

  useEffect(() => {
    if (!query || !leaseToday || readyScopeKey !== scopeKey) return;
    let active = true;
    const generation = ++requestGeneration.current;
    const owner = actionOwnerRef.current;
    if (!owner || !isCurrentCloudActionOwner(actionOwnerRef, owner)) return;
    const accessEventsRead: Promise<AccessEventsView | null> = query.studentId === null
      ? reads.readAccessEvents({ range: query.range, leaseEpoch }).then(
        (events): AccessEventsView => ({ status: 'ready', snapshot: events }),
        (error): AccessEventsView => {
          if (['LEASE_LOST', 'UNAUTHORIZED'].includes(errorCode(error) ?? '')) throw error;
          return { status: 'unavailable', message: `使用權交接無法完整讀取：${messageOf(error)}` };
        },
      )
      : Promise.resolve(null);
    void Promise.all([
      reads.readReport({ range: query.range, studentId: query.studentId, leaseEpoch }),
      accessEventsRead,
    ]).then(([report, events]) => {
      if (!active || requestGeneration.current !== generation || !isCurrentCloudActionOwner(actionOwnerRef, owner)) return;
      const accessEvents: AccessEventsView | null = events?.status === 'ready'
        && !sameAccessEventsEnvelope(events.snapshot, report, query, leaseEpoch)
        ? { status: 'unavailable', message: '使用權交接資料版本與報表不一致，未顯示；請重新查詢。' }
        : events;
      setSnapshot({ report, accessEvents });
      setLoading(false);
      setPrintDate(query.range.startDate);
      setActionMessage('');
      onNavigationStateChange?.(identityKey, 'resolved');
    }).catch(error => {
      if (!active || requestGeneration.current !== generation || !isCurrentCloudActionOwner(actionOwnerRef, owner)) return;
      if (['LEASE_LOST', 'UNAUTHORIZED'].includes(errorCode(error) ?? '')) {
        invalidateOwner(owner, error);
        return;
      }
      setSnapshot(null);
      setLoadError(messageOf(error));
      setLoading(false);
    });
    return () => { active = false; };
  }, [actionOwnerRef, identityKey, invalidateOwner, leaseEpoch, leaseToday, onNavigationStateChange, query, reads, readyScopeKey, scopeKey]);

  const candidateIds = useMemo(() => snapshot
    ? searchCloudReportStudentIds(snapshot.report.students, snapshot.report.transactions, search)
    : [], [search, snapshot]);
  const candidateById = useMemo(() => new Map(snapshot?.report.students.map(student => [student.studentId, student]) ?? []), [snapshot]);
  const allRows = useMemo(() => {
    if (!snapshot) return [] as (CloudReportTransaction | CloudMergedTransaction)[];
    return mode === 'original' ? snapshot.report.transactions : snapshot.report.mergedTransactions;
  }, [mode, snapshot]);
  const pageCount = Math.max(1, Math.ceil(allRows.length / 100));
  const visibleRows = allRows.slice(pageNumber * 100, (pageNumber + 1) * 100);
  const visibleAction = action?.scopeKey === scopeKey ? action : null;
  const controlsLocked = loading || auditBusy || Boolean(visibleAction) || authorizedPrint?.scopeKey === scopeKey;

  const submitRange = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!leaseToday || visibleAction) return;
    try {
      const next = rangeKind === 'custom'
        ? validateCloudLedgerRange({ kind: 'custom', startDate: customStart, endDate: customEnd })
        : createCloudLedgerDateRange(rangeKind, rangeAnchor || leaseToday);
      setInputError('');
      setScopeStudentId(null);
      setLoading(true);
      setLoadError('');
      setSnapshot(null);
      setPageNumber(0);
      setQuery({ range: next, studentId: null });
    } catch (error) {
      setInputError(messageOf(error));
    }
  }, [customEnd, customStart, leaseToday, rangeAnchor, rangeKind, visibleAction]);

  const chooseStudent = useCallback((studentId: string | null) => {
    if (!query || visibleAction) return;
    setScopeStudentId(studentId);
    setLoading(true);
    setLoadError('');
    setSnapshot(null);
    setPageNumber(0);
    setQuery({ range: query.range, studentId });
  }, [query, visibleAction]);

  const initiateBrowserAction = useCallback((frozen: FrozenAction, owner: CloudActionOwnerToken) => {
    if (!isCurrentCloudActionOwner(actionOwnerRef, owner)) return false;
    if (frozen.kind === 'print') {
      flushSync(() => setAuthorizedPrint(frozen));
      if (!isCurrentCloudActionOwner(actionOwnerRef, owner)) {
        flushSync(() => setAuthorizedPrint(null));
        return false;
      }
      clearPrintLifecycle();
      const handler = () => {
        const lifecycle = printLifecycleRef.current;
        if (!lifecycle || lifecycle.commandId !== frozen.id || lifecycle.owner !== owner) return;
        clearPrintLifecycle(frozen.id, owner);
        if (isCurrentCloudActionOwner(actionOwnerRef, owner)) {
          setAuthorizedPrint(current => current?.id === frozen.id && current.scopeKey === owner.scopeKey ? null : current);
        }
      };
      printLifecycleRef.current = { commandId: frozen.id, owner, handler };
      window.addEventListener('afterprint', handler);
    }
    if (!isCurrentCloudActionOwner(actionOwnerRef, owner)) {
      if (frozen.kind === 'print') {
        clearPrintLifecycle(frozen.id, owner);
        flushSync(() => setAuthorizedPrint(null));
      }
      return false;
    }
    try {
      performBrowserAction(frozen, performedActions.current);
    } catch (error) {
      if (frozen.kind !== 'print') throw error;
      clearPrintLifecycle(frozen.id, owner);
      flushSync(() => setAuthorizedPrint(null));
      if (isCurrentCloudActionOwner(actionOwnerRef, owner)) {
        removeRecoveryAction(frozen);
        setAction(null);
        setActionMessage('稽核已確認；瀏覽器無法啟動列印。請重新查詢後另行發起列印。');
        onNavigationStateChange?.(owner.identityKey, 'resolved');
      }
      return false;
    }
    return true;
  }, [actionOwnerRef, clearPrintLifecycle, onNavigationStateChange]);

  const ownsOperation = (operation: ActionOperation): boolean => (
    operationRef.current === operation && !operation.completed && isCurrentCloudActionOwner(actionOwnerRef, operation.owner)
  );

  const clearTimer = (operation: ActionOperation) => {
    if (operation.timerId !== null) window.clearTimeout(operation.timerId);
    operation.timerId = null;
  };

  const notify = (operation: ActionOperation, state: 'recovering' | 'resolved') => {
    navigationRef.current?.(operation.owner.identityKey, state);
  };

  /** The original submission is over, one way or another, with the receipt still unconfirmed. */
  const showUnknown = (operation: ActionOperation, message: string) => {
    if (!ownsOperation(operation) || operation.receipt) return;
    clearTimer(operation);
    operation.retryAuthorized = false;
    setRecovery({
      commandId: operation.action.id, phase: operation.checking ? 'checking' : 'unknown', timedOut: false, canRetry: false,
    });
    setActionMessage(message);
  };

  const beginAttempt = (operation: ActionOperation) => {
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

  /** The one place a receipt is accepted: clean the journal once, then output the frozen content at most once. */
  const settleWithReceipt = async (operation: ActionOperation, receipt: CommandReceipt) => {
    if (!ownsOperation(operation) || operation.receipt) return;
    const action = operation.action;
    if (!actionResultMatches(receipt, action)) {
      showUnknown(operation, RECEIPT_MISMATCH);
      return;
    }
    clearTimer(operation);
    operation.receipt = receipt;
    operation.retryAuthorized = false;
    operation.checking = false;
    operation.querySequence += 1;
    setRecovery({ commandId: action.id, phase: 'checking', timedOut: false, canRetry: false });
    let cleanupWarning = '';
    try {
      const cleaned = await actions.cleanupConfirmedIntent(
        action.input, operation.datasetId, operation.uid, () => ownsOperation(operation) && browserIsOnline(),
      );
      if (!cleaned && ownsOperation(operation)) cleanupWarning = '本機命令追蹤尚未清理；伺服器回執仍已確認。';
    } catch (error) {
      if (!ownsOperation(operation)) return;
      if (isAuthorizationLoss(error)) {
        invalidateOwner(operation.owner, error);
        return;
      }
      cleanupWarning = '本機命令追蹤清理未完成；伺服器回執仍已確認。';
    }
    if (!ownsOperation(operation)) return;
    const finish = (message: string) => {
      removeRecoveryAction(action);
      dropOperation();
      setAction(null);
      setRecovery(null);
      setActionMessage(`${message}${cleanupWarning}`);
      notify(operation, 'resolved');
    };
    if (isRecoveryIdentity(action)) {
      // After a remount the content is gone: the audit receipt is confirmed, nothing is output.
      finish('原稽核已確認；原快照未保留，本次未發起輸出。請重新查詢後另行確認輸出。');
      return;
    }
    let started: boolean;
    try {
      started = initiateBrowserAction(action, operation.owner);
    } catch {
      if (!ownsOperation(operation)) return;
      finish('稽核已確認；瀏覽器無法啟動匯出。請重新查詢後另行發起匯出。');
      return;
    }
    // The owner was lost during the output step, or the print could not start (its own message is already shown).
    if (!ownsOperation(operation)) return;
    if (!started) {
      removeRecoveryAction(action);
      dropOperation();
      setRecovery(null);
      return;
    }
    finish(action.kind === 'export' ? '已發起匯出。' : '已發起列印。');
  };

  const finishResult = async (operation: ActionOperation, result: CommandResult) => {
    if (!ownsOperation(operation) || operation.receipt) return;
    clearTimer(operation);
    if (!result.ok) {
      if (isAuthorizationLoss(result.error)) {
        invalidateOwner(operation.owner, result.error);
        return;
      }
      if (result.error.code === 'UNKNOWN_RESULT' || result.error.code === 'OFFLINE') {
        showUnknown(operation, UNKNOWN_RESULT);
        return;
      }
      // A definite refusal: nothing was recorded, so a later action starts a new command.
      const refused = operation.action;
      removeRecoveryAction(refused);
      dropOperation();
      setAction(null);
      setRecovery(null);
      setActionMessage(result.error.message);
      notify(operation, 'resolved');
      return;
    }
    await settleWithReceipt(operation, result.receipt);
  };

  const runAttempt = async (operation: ActionOperation) => {
    const frozen = operation.action;
    if (!ownsOperation(operation) || isRecoveryIdentity(frozen)) return;
    beginAttempt(operation);
    setRecovery({ commandId: frozen.id, phase: 'submitting', timedOut: false, canRetry: false });
    const attempt = operation.attempt;
    const attemptPromise = frozen.kind === 'export'
      ? actions.recordExport(frozen.input as RecordCloudExportInput)
      : actions.recordPrint(frozen.input as RecordCloudPrintInput);
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
        invalidateOwner(operation.owner, error);
        return;
      }
      showUnknown(operation, UNKNOWN_RESULT);
    }
  };

  const recordAction = (frozen: FrozenAction) => {
    const owner = actionOwnerRef.current;
    if (!isCurrentCloudActionOwner(actionOwnerRef, owner) || owner.scopeKey !== frozen.scopeKey || operationRef.current) return;
    const uid = currentUid(db);
    if (!uid) {
      invalidateOwner(owner, {
        code: 'UNAUTHORIZED', message: '目前登入身分尚未確認，雲端資料已清除。請重新登入操作員帳號。',
      });
      return;
    }
    const operation: ActionOperation = {
      owner, action: frozen, datasetId: frozen.datasetId, uid, attempt: 0, attemptPromise: null,
      attemptSettled: false, timedOut: false, querySequence: 0, checking: false, retryAuthorized: false,
      receipt: null, timerId: null, completed: false,
    };
    operationRef.current = operation;
    setAction(frozen);
    storeRecoveryIdentity(frozen, owner, frozen.datasetId, uid);
    setActionMessage('正在確認雲端稽核收據…');
    notify(operation, 'recovering');
    void runAttempt(operation);
  };

  const makeExport = (type: RecordCloudExportInput['exportType'], audit: CloudAuditRangeSnapshot | null = null) => {
    if (!snapshot || !query || controlsLocked || !actionOwnerRef.current
      || (type === 'settlements' || type === 'post-close-entries') && query.studentId !== null) return;
    const id = crypto.randomUUID();
    const input: RecordCloudExportInput = {
      commandId: id, leaseEpoch, range: query.range, scope: { studentId: query.studentId },
      sourceSeq: snapshot.report.sourceSeq, exportType: type,
    };
    const names: Record<RecordCloudExportInput['exportType'], string> = {
      'transactions-original': 'transactions-original', 'transactions-merged': 'transactions-merged',
      settlements: 'settlements', 'post-close-entries': 'post-close-entries', audit: 'audit',
    };
    recordAction({
      id, kind: 'export', scopeKey, datasetId: snapshot.report.datasetId, input,
      contents: csvFor(type, snapshot, audit), filename: `cloud-${names[type]}-${query.range.startDate}_${query.range.endDate}.csv`,
      title: `P${type} · ${query.range.startDate}–${query.range.endDate} · H=${snapshot.report.sourceSeq}`,
      rows: type === 'transactions-merged' ? snapshot.report.mergedTransactions : snapshot.report.transactions,
    });
  };

  /** P16f2 S10: the range audit is read when it is asked for (the CSV), not with every report; it must agree with the report on screen. */
  const exportAudit = async () => {
    if (!snapshot || !query || controlsLocked || !actionOwnerRef.current) return;
    const owner = actionOwnerRef.current;
    const generation = requestGeneration.current;
    const request = query;
    setAuditBusy(true);
    setActionMessage('正在讀取完整稽核資料…');
    try {
      const audit = await reads.readAuditRange({ range: request.range, studentId: request.studentId, leaseEpoch });
      if (requestGeneration.current !== generation || !isCurrentCloudActionOwner(actionOwnerRef, owner)) return;
      if (!sameEnvelope(snapshot.report, audit, request, leaseEpoch)) {
        setActionMessage('報表與稽核版本不一致，請重新查詢完整資料。');
        return;
      }
      setActionMessage('');
      makeExport('audit', audit);
    } catch (error) {
      if (requestGeneration.current !== generation || !isCurrentCloudActionOwner(actionOwnerRef, owner)) return;
      if (['LEASE_LOST', 'UNAUTHORIZED'].includes(errorCode(error) ?? '')) invalidateOwner(owner, error);
      else setActionMessage(messageOf(error));
    } finally {
      setAuditBusy(false);
    }
  };

  const makePrint = () => {
    if (!snapshot || !query || controlsLocked || !actionOwnerRef.current || !/^\d{4}-\d{2}-\d{2}$/.test(printDate)
      || printDate < query.range.startDate || printDate > query.range.endDate) return;
    const id = crypto.randomUUID();
    const printType = mode === 'original' ? 'ledger-original' : 'ledger-merged';
    const input: RecordCloudPrintInput = {
      commandId: id, leaseEpoch, range: query.range, scope: { studentId: query.studentId },
      sourceSeq: snapshot.report.sourceSeq, printType, businessDate: printDate,
    };
    recordAction({
      id, kind: 'print', scopeKey, datasetId: snapshot.report.datasetId, input,
      contents: '', filename: '', title: `雲端帳務 ${query.range.startDate}–${query.range.endDate} · ${query.studentId ?? '全部帳戶'} · H=${snapshot.report.sourceSeq}`,
      rows: mode === 'original' ? snapshot.report.transactions : snapshot.report.mergedTransactions,
    });
  };

  /** After a remount only the identity exists; its operation is created on the first explicit query. */
  const operationFor = (intent: RecoverableAction): ActionOperation | null => {
    const existing = operationRef.current;
    if (existing) return existing.action.id === intent.id ? existing : null;
    const owner = actionOwnerRef.current;
    if (!isCurrentCloudActionOwner(actionOwnerRef, owner) || !isRecoveryIdentity(intent)
      || intent.scopeKey !== owner.scopeKey || intent.identityKey !== owner.identityKey
      || intent.leaseEpoch !== owner.leaseEpoch) return null;
    const operation: ActionOperation = {
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
    const action = operation.action;
    const view = (phase: RecoveryPhase, canRetry: boolean): RecoveryView => ({
      commandId: action.id, phase, timedOut: !operation.attemptSettled, canRetry,
    });
    if (!browserIsOnline()) {
      operation.retryAuthorized = false;
      setRecovery(view(operation.attemptSettled ? 'unknown' : 'submitting', false));
      setActionMessage('目前離線；查詢錯誤不代表命令不存在，暫不可重試。');
      return;
    }
    operation.checking = true;
    const attemptAtStart = operation.attempt;
    const settledAtStart = operation.attemptSettled && operation.attemptPromise === null;
    operation.retryAuthorized = false;
    const sequence = ++operation.querySequence;
    setRecovery(view('checking', false));
    setActionMessage('正在查詢原命令結果…');
    const pending = (message: string, canRetry: boolean) => {
      setRecovery(view(operation.attemptSettled ? 'unknown' : 'submitting', canRetry));
      setActionMessage(message);
    };
    try {
      const check = await actions.confirmPendingIntent(action.input, operation.datasetId, operation.uid);
      if (!ownsOperation(operation) || operation.querySequence !== sequence
        || operation.attempt !== attemptAtStart || operation.receipt) return;
      if (check.status === 'matched') {
        await settleWithReceipt(operation, check.receipt);
        return;
      }
      if (check.status === 'different-dataset') {
        pending('目前伺服器資料集已變更；原稽核登記尚未確認，請聯絡維護者，不可重試。', false);
        return;
      }
      if (isRecoveryIdentity(action)) {
        pending('尚無收據；原快照未保留，不會重送。請再次查詢原命令收據。', false);
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
        invalidateOwner(operation.owner, error);
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
      setActionMessage('目前離線，沒有重試命令；請恢復連線後重新查詢原命令。');
      return;
    }
    operation.retryAuthorized = false;
    void runAttempt(operation);
  };

  const statusNode = actionMessage ? <p role="status">{actionMessage}</p> : null;
  const selectedStudent = scopeStudentId ? candidateById.get(scopeStudentId) : undefined;
  const printAction = authorizedPrint?.scopeKey === scopeKey ? authorizedPrint : null;

  return (
    <>
    <section className="cloud-report" aria-label="雲端報表">
      <header className="cloud-report__header">
        <div><p className="cloud-report__eyebrow">F2 · 完整伺服器快照</p><h2>雲端報表</h2>
          <p>日期範圍由伺服器台北日期 {leaseToday || '讀取中'} 推導；僅在報表與稽核資料版本一致時顯示。</p></div>
        {snapshot && <strong>來源序號 H={snapshot.report.sourceSeq}</strong>}
      </header>

      <form className="cloud-report__controls" onSubmit={submitRange}>
        <label>日期範圍
          <select aria-label="日期範圍" value={rangeKind} disabled={controlsLocked || !leaseToday}
            onChange={event => setRangeKind(event.target.value as CloudLedgerDateRangeKind)}>
            <option value="today">今天</option><option value="week">本週</option><option value="month">本月</option><option value="custom">自訂</option>
          </select>
        </label>
        {rangeKind === 'custom' ? <>
          <label>開始日期<input aria-label="開始日期" type="date" value={customStart} disabled={controlsLocked} onChange={event => setCustomStart(event.target.value)} /></label>
          <label>結束日期<input aria-label="結束日期" type="date" value={customEnd} disabled={controlsLocked} onChange={event => setCustomEnd(event.target.value)} /></label>
          <span>自訂最多 31 日，超出時不會截短。</span>
        </> : <label>範圍日期<input aria-label="範圍日期" type="date" value={rangeAnchor} disabled={controlsLocked} onChange={event => setRangeAnchor(event.target.value)} /></label>}
        <button type="submit" disabled={controlsLocked || !leaseToday}>查詢完整報表</button>
      </form>
      {inputError && <p role="alert">{inputError}</p>}
      {loadError && <div role="alert" className="cloud-report__error"><p>{loadError}</p>
        <button type="button" disabled={Boolean(visibleAction)} onClick={() => {
          if (query) { setLoading(true); setSnapshot(null); setLoadError(''); setQuery({ ...query }); }
          else { setLoading(true); setLoadError(''); setBootstrapAttempt(value => value + 1); }
        }}>重新讀取完整資料</button></div>}

      {loading && <p role="status">正在由伺服器讀取完整交易前綴與稽核資料；目前不提供餘額或輸出。</p>}
      {!loading && snapshot && query && <>
        <p className="cloud-report__snapshot" data-testid="report-ready">完整資料已確認：dataset {snapshot.report.datasetId} · {query.range.startDate}–{query.range.endDate} · {query.studentId ? `帳戶 ${query.studentId}` : '全部帳戶'} · 來源序號 H={snapshot.report.sourceSeq}</p>

        <section aria-labelledby="cloud-report-summary-heading" className="cloud-report__section">
          <div className="cloud-report__section-heading"><h3 id="cloud-report-summary-heading">區間日摘要</h3><button type="button" disabled={controlsLocked || !onOpenDayClose}
            onClick={() => onOpenDayClose?.(snapshot.report.days.find(day => day.businessDate === printDate)?.businessDate ?? snapshot.report.range.startDate)}>
            開啟日結 {printDate || snapshot.report.range.startDate}</button></div>
          <p>日摘要與選定帳戶明細分開呈現；現金存量不會跨日加總，未提供訂餐欠款推估。沒有營業日的操作依記錄日期列入稽核。</p>
          <dl className="cloud-report__totals" aria-label="全日摘要合計">
            <div><dt>有效交易</dt><dd>{snapshot.report.summary.activeTransactionCount}</dd></div>
            <div><dt>便當份數</dt><dd>{snapshot.report.summary.bentoCount}</dd></div>
            <div><dt>其他餐點份數</dt><dd>{snapshot.report.summary.otherMealCount}</dd></div>
            <div><dt>餐費</dt><dd>{money(snapshot.report.summary.mealTotal)}</dd></div>
            <div><dt>收款留存與櫃台收入</dt><dd>{money(snapshot.report.summary.totalIncome)}</dd></div>
            <div><dt>櫃台支出</dt><dd>{money(snapshot.report.summary.totalExpense)}</dd></div>
            <div><dt>帳戶退款</dt><dd>{money(snapshot.report.summary.totalRefund)}</dd></div>
            <div><dt>區間淨現金流</dt><dd>{money(snapshot.report.summary.netCash)}</dd></div>
          </dl>
          <div className="cloud-report__table-wrap"><table><thead><tr><th>營業日</th><th>狀態</th><th>份數</th><th>餐費</th><th>收款留存</th><th>櫃台收入／支出</th><th>帳戶退款</th><th>日結現金</th><th>日結操作</th></tr></thead>
            <tbody>{snapshot.report.days.map(day => <tr key={day.businessDate}>
              <td>{day.businessDate}</td><td>{day.status ?? '未建立'}</td><td>{day.totals ? `${day.totals.bentoCount} + ${day.totals.otherMealCount}` : '—'}</td>
              <td>{day.totals ? money(day.totals.mealTotal) : '—'}</td><td>{day.totals ? money(day.totals.retainedReceipts) : '—'}</td>
              <td>{day.totals ? `${money(day.totals.cashierIncome)} / ${money(day.totals.cashierExpense)}` : '—'}</td>
              <td>{day.totals ? money(day.totals.accountRefunds) : '—'}</td>
              <td>{day.lastSettlementRevision > 0 ? <>{day.settlements.map(version => <div key={version.revision}>
                第 {version.revision} 次實點 {version.countedCash === null ? '—' : money(version.countedCash)}{day.status === 'closed' && version.revision === day.lastSettlementRevision ? ` · 有效現金 ${money(day.effectiveCash ?? version.countedCash ?? 0)}` : ''}
                <small>{version.actorUid} · {taipeiTime(version.committedAt)} · {version.note || '無備註'}</small>
              </div>)}{day.postCloseEntries.map(entry => <small key={entry.entryId}>
                補記 {entry.direction === 'income' ? '收入' : '支出'} {money(entry.amount)} · {entry.reason} · {entry.createdBy} · {taipeiTime(entry.createdAt)} · 原日結第 {entry.settlementRevision} 次 · {entry.countedInEffectiveCash ? '計入有效現金' : '未計入有效現金'}
              </small>)}</> : '未關帳'}</td>
              <td><button type="button" aria-label={`開啟日結 ${day.businessDate}`} disabled={controlsLocked || !onOpenDayClose} onClick={() => onOpenDayClose?.(day.businessDate)}>開啟日結</button></td>
            </tr>)}</tbody></table></div>
        </section>

        <section className="cloud-report__section" aria-labelledby="cloud-report-scope-heading">
          <div className="cloud-report__section-heading"><h3 id="cloud-report-scope-heading">帳戶明細範圍</h3>
            {selectedStudent && <button type="button" disabled={controlsLocked} onClick={() => chooseStudent(null)}>清除帳戶範圍</button>}</div>
          <label>搜尋帳戶<input aria-label="搜尋帳戶" value={search} disabled={controlsLocked} onChange={event => setSearch(event.target.value)} placeholder="編號、現名、別名或範圍內交易快照名" /></label>
          {!scopeStudentId && search.trim() && <div aria-label="候選帳戶">
            {candidateIds.length > 1 && <p>找到多個候選；選取一位後才會改變輸出範圍，目前仍是全部帳戶。</p>}
            {candidateIds.length === 0 ? <p>沒有符合的帳戶。未選取時輸出範圍仍是全部帳戶。</p> : candidateIds.map(studentId => {
              const student = candidateById.get(studentId);
              if (!student) return null;
              return <button type="button" key={studentId} aria-label={`選取 ${student.displayName}（${student.studentCode}）`} disabled={controlsLocked}
                onClick={() => chooseStudent(studentId)}>{student.displayName}（{student.studentCode}）</button>;
            })}
          </div>}
          <p>目前明細範圍：{selectedStudent ? `${selectedStudent.displayName}（${selectedStudent.studentCode}）` : '全部帳戶'}。日摘要與日結數字維持全日口徑。</p>
          {selectedStudent && <button type="button" disabled={controlsLocked || !onOpenAccountHistory}
            aria-label={`開啟查帳：${selectedStudent.displayName}`} onClick={() => onOpenAccountHistory?.(selectedStudent.studentId, query.range)}>
            開啟查帳：{selectedStudent.displayName}</button>}
        </section>

        <section className="cloud-report__section" aria-labelledby="cloud-report-detail-heading">
          <div className="cloud-report__section-heading"><h3 id="cloud-report-detail-heading">完整交易明細</h3>
            <div><label>呈現方式<select aria-label="交易呈現方式" value={mode} disabled={controlsLocked} onChange={event => { setMode(event.target.value as typeof mode); setPageNumber(0); }}>
              <option value="original">原始交易</option><option value="merged">合併交易</option></select></label>
              <span>輸出使用全部 {allRows.length} 筆完整模型，畫面每頁 100 筆。</span></div>
          </div>
          <div className="cloud-report__table-wrap"><table><thead><tr><th>交易識別</th><th>營業日</th><th>帳戶與當時姓名</th><th>類型／狀態</th><th>餐點快照</th><th>金額／份數</th><th>完整歷史餘額</th><th>操作者／台北時間</th><th>回填／說明</th></tr></thead>
            <tbody>{visibleRows.map(row => {
              const merged = 'kind' in row;
              const raw = merged ? row.transactions : [row];
              const transactionIds = merged ? row.transactionIds : [row.transactionId];
              const balance = row.afterBalance;
              const mealText = merged ? row.otherMealItems.join('、') || row.menuNameSnapshot : row.menuNameSnapshot || row.otherItemName || '—';
              return <tr key={`${merged ? 'merged' : 'raw'}:${row.transactionId}`}>
                <td><small>{transactionIds.join(' · ')}</small></td><td>{row.businessDate}</td><td>{row.studentNameSnapshot}（{row.studentId}）</td>
                <td>{merged ? row.kind : row.type} · {row.status === 'active' ? '有效' : '已作廢'}</td><td>{mealText}</td>
                <td>{money(row.amount)} · 餐費 {money(row.mealPrice)} · 收款 {money(row.paidAmount)}{merged && row.orderCount ? ` · ${row.orderCount} 筆訂餐／${row.bentoOrderCount} 份便當` : ''}</td>
                <td>{row.studentId === '__cashier__' ? '不適用' : balance === undefined ? '未驗證' : money(balance)}</td>
                <td>{raw.map(item => <div key={item.transactionId}>{item.operatorUid} · {taipeiTime(item.createdAt)}</div>)}</td>
                <td>{row.backfilled ? '回填' : '—'}{raw.some(item => item.status === 'voided') ? ' · 保留作廢列' : ''}{paperRefsIn(raw.map(item => item.note)).length > 0 && <span data-testid={`report-paper-refs-${row.transactionId}`}>
                  {paperRefsIn(raw.map(item => item.note)).map(paperRef => <span key={paperRef} className="cloud-report__paper-tag">紙本 {paperRef}</span>)}</span>}
                  {raw.map(item => { const { text } = splitPaperNote(item.note); return text && <small key={`note:${item.transactionId}`}>{text}</small>; })}</td>
              </tr>;
            })}</tbody></table></div>
          <div className="cloud-report__pager"><button type="button" disabled={controlsLocked || pageNumber === 0} onClick={() => setPageNumber(value => value - 1)}>上一頁</button>
            <span>第 {pageNumber + 1} / {pageCount} 頁 · 全部 {allRows.length} 筆</span>
            <button type="button" disabled={controlsLocked || pageNumber + 1 >= pageCount} onClick={() => setPageNumber(value => value + 1)}>下一頁</button></div>
        </section>

        <section className="cloud-report__section" aria-labelledby="cloud-report-exports-heading">
          <h3 id="cloud-report-exports-heading">收據確認後輸出</h3>
          <p>輸出固定目前日期、帳戶範圍與來源序號 H={snapshot.report.sourceSeq}；日結與關帳後補記僅支援全部帳戶範圍。</p>
          <div className="cloud-report__actions">
            <button type="button" disabled={controlsLocked} onClick={() => makeExport('transactions-original')}>匯出原始交易 CSV</button>
            <button type="button" disabled={controlsLocked} onClick={() => makeExport('transactions-merged')}>匯出合併交易 CSV</button>
            <button type="button" disabled={controlsLocked || query.studentId !== null} onClick={() => makeExport('settlements')}>匯出日結 CSV</button>
            <button type="button" disabled={controlsLocked || query.studentId !== null} onClick={() => makeExport('post-close-entries')}>匯出關帳後補記 CSV</button>
            <button type="button" aria-label="匯出稽核 CSV" disabled={controlsLocked} onClick={() => void exportAudit()}>匯出稽核 CSV</button>
          </div>
          <label>列印標示日期<select aria-label="列印標示日期" value={printDate} disabled={controlsLocked} onChange={event => setPrintDate(event.target.value)}>
            {snapshot.report.days.map(day => <option key={day.businessDate} value={day.businessDate}>{day.businessDate}</option>)}
          </select></label>
          <button type="button" disabled={controlsLocked || !snapshot.report.days.length} onClick={makePrint}>記錄後列印目前完整明細</button>
        </section>

        {snapshot.accessEvents && <section className="cloud-report__section" aria-labelledby="cloud-report-handover-heading">
          <h3 id="cloud-report-handover-heading">使用權交接</h3>
          {snapshot.accessEvents.status === 'unavailable'
            ? <p>{snapshot.accessEvents.message}</p>
            : !snapshot.accessEvents.snapshot.rows.length
              ? <p>此區間沒有使用權交接紀錄。</p>
              : <>
                <p>唯讀記錄：誰在何時取得、接手或釋放編輯使用權；僅顯示 email，不提供匯出。</p>
                <div className="cloud-report__table-wrap"><table><thead><tr><th>時間（台北）</th><th>種類</th><th>操作人</th><th>前一位持有人</th></tr></thead>
                  <tbody>{snapshot.accessEvents.snapshot.rows.map(row => <tr key={row.epoch}>
                    <td>{taipeiTime(row.at)}</td><td>{ACCESS_EVENT_KIND_TEXT[row.kind]}</td><td>{row.actorEmail}</td><td>{previousHolderText(row)}</td>
                  </tr>)}</tbody></table></div>
              </>}
        </section>}
      </>}

      {visibleAction && <div className="cloud-report__recovery" role="region" aria-label="輸出命令確認">
        <strong>{!recovery ? '結果確認中，請勿重複操作。'
          : recovery.phase === 'checking' ? '正在查詢原命令結果…'
            : recovery.phase === 'submitting'
              ? recovery.timedOut ? '結果確認中，勿重新收款' : '命令送出中，請勿重複操作。'
              : '結果確認中，請勿重複操作。'}</strong>
        <p>{isRecoveryIdentity(visibleAction) ? '有一筆先前輸出命令需要在目前帳戶與版本下重新確認。'
          : `${visibleAction.title} · ID ${visibleAction.id}`}</p>
        {isRecoveryIdentity(visibleAction) && <p>命令編號 {visibleAction.id}</p>}
        <div className="cloud-report__actions">
          {(!recovery || recovery.phase === 'unknown' || (recovery.phase === 'submitting' && recovery.timedOut)) && (
            <button type="button" onClick={() => void checkPending()}>查詢原命令結果</button>
          )}
          {recovery?.canRetry && <button type="button" onClick={retryPending}>以相同命令編號重試</button>}
        </div>
        {statusNode}
      </div>}
      {!visibleAction && statusNode}

    </section>
    {printAction && createPortal(
      <article className="cloud-report__print" aria-label="本次固定列印內容">
        <h1>{printAction.title}</h1>
        <p>營業日標示：{(printAction.input as RecordCloudPrintInput).businessDate} · 範圍：{(printAction.input as RecordCloudPrintInput).range.startDate}–{(printAction.input as RecordCloudPrintInput).range.endDate}
          · 帳戶：{(printAction.input as RecordCloudPrintInput).scope.studentId ?? '全部帳戶'} · 完整資料列數：{printAction.rows.length} · H={printAction.input.sourceSeq}</p>
        <table><thead><tr><th>交易識別</th><th>營業日</th><th>帳戶</th><th>姓名快照</th><th>類型</th><th>金額</th><th>餘額</th><th>來源序號</th></tr></thead>
          <tbody>{printAction.rows.map(row => {
            const transactionIds = 'kind' in row ? row.transactionIds : [row.transactionId];
            return <tr key={row.transactionId} data-merged-row={'kind' in row ? 'true' : undefined}>
              <td>{transactionIds.map((id, index) => <span key={id}>{index > 0 ? ' · ' : ''}{id}</span>)}</td>
              <td>{row.businessDate}</td><td>{row.studentId}</td><td>{row.studentNameSnapshot}</td>
              <td>{'kind' in row ? row.kind : row.type}</td><td>{money(row.amount)}</td><td>{row.afterBalance === undefined ? '—' : money(row.afterBalance)}</td><td>{row.sourceSeq}</td>
            </tr>;
          })}</tbody>
        </table>
      </article>,
      document.body,
    )}
    </>
  );
}
