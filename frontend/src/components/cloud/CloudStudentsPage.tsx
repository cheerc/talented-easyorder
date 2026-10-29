import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type SetStateAction } from 'react';
import { getAuth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { CommandReceipt, CommandResult } from '../../domain/cloudCommands';
import { normalizeStudentCodeOrThrow } from '../../domain/student';
import {
  createCloudStudentRepository,
  type CloudStudentCommandIntent,
  type CloudStudentList,
  type CloudStudentRecord,
} from '../../firebase/cloudStudentRepository';
import { getCloudRecoveryReader } from '../../firebase/cloudRecoveryReader';
import './CloudStudentsPage.css';

export interface CloudStudentsPageProps {
  db: Firestore;
  leaseEpoch: number;
  identityKey: string;
  onNavigationStateChange?: (identityKey: string, state: 'recovering' | 'revoked' | 'resolved') => void;
  onDraftCleared?: () => void;
}

type OpeningMode = '' | 'existing-balance' | 'new-student';

interface CreateDraft {
  studentCode: string;
  displayName: string;
  aliasesText: string;
  amountText: string;
  note: string;
  openingMode: OpeningMode;
}

type PreparedCommand =
  | {
      kind: 'create';
      commandId: string;
      studentId: string;
      studentCode: string;
      displayName: string;
      aliases: string[];
      openingBalance: { amount: number; asOfDate: string; note: string };
    }
  | {
      kind: 'edit';
      commandId: string;
      studentId: string;
      studentCode: string;
      expectedRevision: number;
      displayName?: string;
      aliases?: string[];
    }
  | {
      kind: 'code';
      commandId: string;
      studentId: string;
      studentCode: string;
      expectedRevision: number;
      newStudentCode: string;
      reason: string;
    }
  | {
      kind: 'status';
      commandId: string;
      studentId: string;
      studentCode: string;
      expectedRevision: number;
      status: 'active' | 'inactive';
      reason: string;
    }
  | {
      kind: 'opening-day';
      commandId: string;
      studentCode: string;
      dayId: string;
    }
  | {
      kind: 'opening';
      commandId: string;
      studentId: string;
      studentCode: string;
      dayId: string;
      expectedStudentRevision: number;
      expectedDayRevision: number;
      amount: number;
      note: string;
      reason: string;
    };

type OpeningDayView =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'ready'; revision: number; status: 'open' | 'closed' | 'reopened' }
  | { state: 'error'; message: string };

type RecoveryPhase = 'submitting' | 'unknown' | 'checking' | 'receipt' | 'access-lost';

interface RecoveryState {
  commandId: string;
  command?: PreparedCommand;
  phase: RecoveryPhase;
  timedOut?: boolean;
  canRetry?: boolean;
  receipt?: CommandReceipt;
}

interface PageState {
  identityKey: string;
  scopeVersion: number;
  authorizationRevoked: boolean;
  snapshot: CloudStudentList | null;
  loading: boolean;
  loadError: string;
  actionError: string;
  notice: string;
  search: string;
  createOpen: boolean;
  createDraft: CreateDraft;
  editingId: string | null;
  editDisplayName: string;
  editAliasesText: string;
  statusStudent: CloudStudentRecord | null;
  statusReason: string;
  codeStudent: CloudStudentRecord | null;
  changeCodeValue: string;
  changeCodeReason: string;
  openingStudent: CloudStudentRecord | null;
  openingAmountText: string;
  openingNote: string;
  openingReason: string;
  openingDay: OpeningDayView;
  recovery: RecoveryState | null;
}

interface StudentCommandOperation {
  token: symbol;
  identityKey: string;
  generation: number;
  db: Firestore;
  app: Firestore['app'];
  uid: string;
  leaseEpoch: number;
  datasetId: string;
  command: PreparedCommand;
  intent: CloudStudentCommandIntent;
  attempt: number;
  attemptPromise: Promise<CommandResult> | null;
  attemptSettled: boolean;
  querySequence: number;
  checking: boolean;
  retryAuthorized: boolean;
  receipt: CommandReceipt | null;
  listReloadStarted: boolean;
  completed: boolean;
  timerId: number | null;
};

const freshCreateDraft = (): CreateDraft => ({
  studentCode: '',
  displayName: '',
  aliasesText: '',
  amountText: '',
  note: '',
  openingMode: '',
});

function freezePreparedCommand(command: PreparedCommand): PreparedCommand {
  const copy = JSON.parse(JSON.stringify(command)) as PreparedCommand;
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  };
  freeze(copy);
  return copy;
}

function intentFor(command: PreparedCommand, leaseEpoch: number): CloudStudentCommandIntent {
  if (command.kind === 'create') return {
    kind: 'create',
    input: {
      commandId: command.commandId, leaseEpoch, studentId: command.studentId,
      studentCode: command.studentCode, displayName: command.displayName,
      aliases: [...command.aliases], openingBalance: { ...command.openingBalance },
    },
  };
  if (command.kind === 'edit') return {
    kind: 'edit',
    input: {
      commandId: command.commandId, leaseEpoch, studentId: command.studentId,
      expectedRevision: command.expectedRevision,
      ...(command.displayName !== undefined ? { displayName: command.displayName } : {}),
      ...(command.aliases !== undefined ? { aliases: [...command.aliases] } : {}),
    },
  };
  if (command.kind === 'code') return {
    kind: 'change-code',
    input: {
      commandId: command.commandId, leaseEpoch, studentId: command.studentId,
      expectedRevision: command.expectedRevision, studentCode: command.newStudentCode, reason: command.reason,
    },
  };
  if (command.kind === 'status') return {
    kind: 'status',
    input: {
      commandId: command.commandId, leaseEpoch, studentId: command.studentId,
      expectedRevision: command.expectedRevision, status: command.status, reason: command.reason,
    },
  };
  if (command.kind === 'opening-day') return {
    kind: 'ensure-day',
    input: { commandId: command.commandId, leaseEpoch, dayId: command.dayId },
  };
  return {
    kind: 'correct-opening',
    input: {
      commandId: command.commandId, leaseEpoch, studentId: command.studentId, dayId: command.dayId,
      expectedStudentRevision: command.expectedStudentRevision, expectedDayRevision: command.expectedDayRevision,
      amount: command.amount, note: command.note, reason: command.reason,
    },
  };
}

const initialPageState = (identityKey: string, scopeVersion = 0): PageState => ({
  identityKey,
  scopeVersion,
  authorizationRevoked: false,
  snapshot: null,
  loading: true,
  loadError: '',
  actionError: '',
  notice: '',
  search: '',
  createOpen: false,
  createDraft: freshCreateDraft(),
  editingId: null,
  editDisplayName: '',
  editAliasesText: '',
  statusStudent: null,
  statusReason: '',
  codeStudent: null,
  changeCodeValue: '',
  changeCodeReason: '',
  openingStudent: null,
  openingAmountText: '',
  openingNote: '',
  openingReason: '',
  openingDay: { state: 'loading' },
  recovery: null,
});

function clearDrafts(): Pick<PageState,
  'search' | 'createOpen' | 'createDraft' | 'editingId' | 'editDisplayName' | 'editAliasesText' | 'statusStudent' | 'statusReason' | 'codeStudent' | 'changeCodeValue' | 'changeCodeReason'
  | 'openingStudent' | 'openingAmountText' | 'openingNote' | 'openingReason' | 'openingDay'> {
  return {
    search: '',
    createOpen: false,
    createDraft: freshCreateDraft(),
    editingId: null,
    editDisplayName: '',
    editAliasesText: '',
    statusStudent: null,
    statusReason: '',
    codeStudent: null,
    changeCodeValue: '',
    changeCodeReason: '',
    openingStudent: null,
    openingAmountText: '',
    openingNote: '',
    openingReason: '',
    openingDay: { state: 'loading' },
  };
}

function clientTaipeiDate(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function splitAliases(text: string): string[] {
  return text.split(/[\n,，、;；]/).map(alias => alias.trim()).filter(Boolean);
}

function validateAliases(text: string): { ok: true; aliases: string[] } | { ok: false; message: string } {
  const aliases = splitAliases(text);
  if (aliases.length > 10) return { ok: false, message: '別名最多 10 個。' };
  if (aliases.some(alias => alias.length > 100)) return { ok: false, message: '每個別名不得超過 100 字。' };
  return { ok: true, aliases };
}

function displayError(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: unknown }).code);
    if (code === 'OFFLINE') return '目前無法連線到雲端，學生資料已清除。請恢復連線後重新載入。';
    if (code === 'LEASE_LOST' || code === 'ACCESS_BUSY') return '目前使用權已變更，學生資料已清除。請重新確認使用權。';
    if (code === 'UNAUTHORIZED') return '目前帳號沒有學生資料存取權，學生資料已清除。請重新登入確認權限。';
    if (code === 'QUOTA_EXCEEDED') return '雲端讀取額度不足，沒有顯示不完整名單。請稍後重新載入。';
    if (code === 'MAINTENANCE') return '系統正在維護，沒有顯示學生資料。請稍後重新載入。';
    if (code === 'INCOMPLETE_SNAPSHOT') return '伺服器學生名單不完整，沒有顯示部分資料。請重新載入。';
    if (code === 'STALE_SNAPSHOT') return '載入期間伺服器資料有變動，沒有顯示部分資料。請重新載入。';
    if (code === 'UNSUPPORTED_SCHEMA') return '伺服器資料格式目前無法安全讀取，沒有顯示部分資料。請聯絡系統維護者。';
    if (code === 'UNKNOWN_RESULT') return '伺服器讀取結果不明，沒有顯示完整名單。請重新載入。';
    if (code === 'LOCAL_STORAGE_UNAVAILABLE') return '尚未送出，無法安全保存確認編號；請重試本機儲存檢查，或改用紙本流程。';
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  if (error instanceof Error && error.message) return error.message;
  return '雲端操作無法完成，學生資料已清除。請重新載入後再試。';
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
}

function isAuthorizationLoss(error: unknown): boolean {
  return ['LEASE_LOST', 'UNAUTHORIZED', 'ACCESS_BUSY'].includes(errorCode(error));
}

function formatBalance(amount: number): string {
  return `NT$ ${new Intl.NumberFormat('zh-TW').format(amount)}`;
}

function parseOpeningAmount(text: string): number | null {
  if (!/^-?\d+$/.test(text)) return null;
  const amount = Number(text);
  if (!Number.isSafeInteger(amount) || amount < -1_000_000_000 || amount > 1_000_000_000) return null;
  return amount === 0 ? 0 : amount;
}

function commandLabel(command: PreparedCommand): string {
  if (command.kind === 'create') return `新增 ${command.studentCode}`;
  if (command.kind === 'edit') return `修改 ${command.studentCode}`;
  if (command.kind === 'code') return `改編號 ${command.studentCode} → ${command.newStudentCode}`;
  if (command.kind === 'opening-day') return `建立期初日營業日 ${command.dayId}（${command.studentCode} 期初更正前置）`;
  if (command.kind === 'opening') return `更正 ${command.studentCode} 期初為 ${formatBalance(command.amount)}`;
  return command.status === 'inactive' ? `停用 ${command.studentCode}` : `恢復 ${command.studentCode}`;
}

interface OpeningCorrectionFormProps {
  student: CloudStudentRecord;
  day: OpeningDayView;
  amountText: string;
  note: string;
  reason: string;
  busy: boolean;
  onAmountChange: (value: string) => void;
  onNoteChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onEnsureDay: () => void;
  onRetryDay: () => void;
  onCancel: () => void;
}

function OpeningCorrectionForm({
  student, day, amountText, note, reason, busy,
  onAmountChange, onNoteChange, onReasonChange, onSubmit, onEnsureDay, onRetryDay, onCancel,
}: OpeningCorrectionFormProps) {
  const dayId = student.openingBalance.asOfDate;
  const amount = parseOpeningAmount(amountText);
  const nextBalance = amount === null ? null : student.currentBalance - student.openingBalance.amount + amount;
  const cancel = <button type="button" className="cloud-students__secondary" onClick={onCancel} disabled={busy}>取消</button>;

  if (day.state !== 'ready' || day.status === 'closed') {
    return (
      <div className="cloud-students__status-form cloud-students__opening-form" role="group" aria-label={`更正期初 ${student.studentCode}`}>
        <p>更正期初（期初日 {dayId}）</p>
        {day.state === 'loading' && <span role="status">正在向伺服器確認期初日營業日…</span>}
        {day.state === 'error' && <span role="alert">{day.message}</span>}
        {day.state === 'missing' && (
          <span>期初日 {dayId} 還沒有營業日資料。期初更正會記在期初日，請先建立該營業日；建立營業日不影響現金。</span>
        )}
        {day.state === 'ready' && (
          <span role="alert">期初日 {dayId} 已關帳。請先到「日結」頁填寫原因重開該日，更正期初後再重新關帳。</span>
        )}
        <div className="cloud-students__actions">
          {day.state === 'missing' && (
            <button type="button" className="cloud-students__primary" onClick={onEnsureDay} disabled={busy}>先建立營業日 {dayId}</button>
          )}
          {(day.state === 'error' || day.state === 'ready') && (
            <button type="button" className="cloud-students__secondary" onClick={onRetryDay} disabled={busy}>重新確認營業日</button>
          )}
          {cancel}
        </div>
      </div>
    );
  }

  return (
    <form className="cloud-students__status-form cloud-students__opening-form" aria-label={`更正期初 ${student.studentCode}`} onSubmit={onSubmit}>
      <p>更正期初（期初日 {dayId} 不變）</p>
      <label>期初結餘（整數新臺幣）<input className="cloud-students__input cloud-students__mono" type="text" inputMode="numeric" value={amountText} onChange={event => onAmountChange(event.target.value)} disabled={busy} /></label>
      <label>期初備註（選填，最多 500 字）<input className="cloud-students__input" value={note} maxLength={500} onChange={event => onNoteChange(event.target.value)} disabled={busy} /></label>
      <label>更正原因（必填）<textarea className="cloud-students__input" rows={2} maxLength={500} value={reason} onChange={event => onReasonChange(event.target.value)} disabled={busy} /></label>
      <dl className="cloud-students__opening-preview" aria-label="期初更正預覽">
        <dt>期初</dt>
        <dd>{formatBalance(student.openingBalance.amount)} → {amount === null ? '（金額未完成）' : formatBalance(amount)}</dd>
        <dt>目前結餘</dt>
        <dd>{formatBalance(student.currentBalance)} → {nextBalance === null ? '（金額未完成）' : formatBalance(nextBalance)}</dd>
      </dl>
      <small>只調整這位學生的期初與目前結餘，不影響今日現金，也不改期初日。</small>
      <div className="cloud-students__actions">
        <button type="submit" className="cloud-students__primary" disabled={busy}>確認更正期初</button>
        {cancel}
      </div>
    </form>
  );
}

export function CloudStudentsPage({ db, leaseEpoch, identityKey, onNavigationStateChange, onDraftCleared }: CloudStudentsPageProps) {
  const recoveryReader = useMemo(() => getCloudRecoveryReader(db), [db]);
  const repository = useMemo(() => createCloudStudentRepository(db, { recoveryReader }), [db, recoveryReader]);
  let currentUid: string | null = null;
  try { currentUid = getAuth(db.app).currentUser?.uid ?? null; } catch { /* fail closed */ }
  const [pageState, setPageStateRaw] = useState<PageState>(() => initialPageState(identityKey));
  const identityRef = useRef(identityKey);
  const generationRef = useRef(0);
  const listRequestRef = useRef(0);
  const revokedIdentityRef = useRef<string | null>(null);
  const pendingCommandIdRef = useRef<string | null>(null);
  const openingDayRequestRef = useRef(0);
  const operationRef = useRef<StudentCommandOperation | null>(null);
  const scopeRef = useRef({ db, uid: currentUid, identityKey, leaseEpoch, version: 0 });

  if (scopeRef.current.db !== db || scopeRef.current.uid !== currentUid
    || scopeRef.current.identityKey !== identityKey || scopeRef.current.leaseEpoch !== leaseEpoch) {
    const oldOperation = operationRef.current;
    if (oldOperation?.timerId !== null && oldOperation?.timerId !== undefined) {
      window.clearTimeout(oldOperation.timerId);
    }
    if (oldOperation) oldOperation.completed = true;
    operationRef.current = null;
    generationRef.current += 1;
    listRequestRef.current += 1;
    openingDayRequestRef.current += 1;
    revokedIdentityRef.current = null;
    pendingCommandIdRef.current = null;
    scopeRef.current = { db, uid: currentUid, identityKey, leaseEpoch, version: scopeRef.current.version + 1 };
  }
  if (identityRef.current !== identityKey) {
    identityRef.current = identityKey;
    revokedIdentityRef.current = null;
    pendingCommandIdRef.current = null;
  }
  const scopeVersion = scopeRef.current.version;

  const page = pageState.identityKey === identityKey && pageState.scopeVersion === scopeVersion
    ? pageState
    : initialPageState(identityKey, scopeVersion);

  const isCurrent = useCallback((key: string, generation: number) => (
    identityRef.current === key && generationRef.current === generation
  ), []);

  const updateFor = useCallback((key: string, generation: number, update: (previous: PageState) => PageState) => {
    setPageStateRaw(previous => {
      if (!isCurrent(key, generation)) return previous;
      const current = previous.identityKey === key && previous.scopeVersion === scopeRef.current.version
        ? previous
        : initialPageState(key, scopeRef.current.version);
      return update(current);
    });
  }, [isCurrent]);

  const ownsOperation = useCallback((operation: StudentCommandOperation) => {
    let authenticatedUid: string | null = null;
    try { authenticatedUid = getAuth(operation.app).currentUser?.uid ?? null; } catch { /* fail closed */ }
    return operationRef.current === operation
      && !operation.completed
      && isCurrent(operation.identityKey, operation.generation)
      && scopeRef.current.db === operation.db
      && scopeRef.current.db.app === operation.app
      && scopeRef.current.uid === operation.uid
      && scopeRef.current.identityKey === operation.identityKey
      && scopeRef.current.leaseEpoch === operation.leaseEpoch
      && authenticatedUid === operation.uid;
  }, [isCurrent]);

  const setPageState = (action: SetStateAction<PageState>) => updateFor(identityKey, generationRef.current, previous => (
    typeof action === 'function' ? action(previous) : action
  ));

  const revokeAuthorization = useCallback((
    key: string,
    generation: number,
    commandId: string | null,
    error: unknown,
  ) => {
    if (!isCurrent(key, generation)) return;

    // Invalidate every list, command, and receipt request before scheduling a
    // React update. Their later completions must not restore identity data.
    revokedIdentityRef.current = key;
    generationRef.current += 1;
    listRequestRef.current += 1;
    const operation = operationRef.current;
    if (operation?.timerId !== null && operation?.timerId !== undefined) window.clearTimeout(operation.timerId);
    operationRef.current = null;
    const retainedCommandId = commandId ?? pendingCommandIdRef.current;
    pendingCommandIdRef.current = retainedCommandId;
    onNavigationStateChange?.(key, 'revoked');

    setPageStateRaw(previous => {
      if (previous.identityKey !== key) return previous;
      const onlyCommandId = retainedCommandId ?? previous.recovery?.commandId ?? null;
      return {
        ...previous,
        ...clearDrafts(),
        authorizationRevoked: true,
        snapshot: null,
        loading: false,
        loadError: displayError(error),
        actionError: '',
        notice: '',
        recovery: onlyCommandId ? { commandId: onlyCommandId, phase: 'access-lost' } : null,
      };
    });
  }, [isCurrent, onNavigationStateChange]);

  const loadSnapshot = useCallback(async (confirmedReceipt?: CommandReceipt) => {
    const key = identityKey;
    const generation = generationRef.current;
    const operation = operationRef.current;
    if (operation && !confirmedReceipt) return;
    if (confirmedReceipt && operation && operation.command.commandId !== confirmedReceipt.commandId) return;
    if (revokedIdentityRef.current === key) return;
    const requestId = ++listRequestRef.current;
    updateFor(key, generation, previous => ({
      ...previous,
      snapshot: null,
      loading: true,
      loadError: '',
      actionError: '',
      notice: confirmedReceipt ? '已找到伺服器回執，正在重新載入完整學生名單…' : '',
    }));

    try {
      const snapshot = await repository.list();
      if (!isCurrent(key, generation) || requestId !== listRequestRef.current) return;
      const confirmedOperation = operationRef.current;
      const resolvesOperation = confirmedReceipt
        && confirmedOperation?.command.commandId === confirmedReceipt.commandId
        && !confirmedOperation.completed;
      if (resolvesOperation && confirmedOperation) {
        if (!ownsOperation(confirmedOperation)) return;
        if (snapshot.datasetId !== confirmedOperation.datasetId) {
          onNavigationStateChange?.(key, 'recovering');
          updateFor(key, generation, previous => ({
            ...previous,
            ...clearDrafts(),
            snapshot: null,
            loading: false,
            loadError: '',
            actionError: '命令回執已確認，但伺服器名單屬於不同資料集；資料集已變更。原操作維持已確認狀態，請聯絡系統維護者確認，請勿重試。',
            recovery: {
              commandId: confirmedReceipt.commandId,
              command: confirmedOperation.command,
              phase: 'receipt',
              receipt: confirmedReceipt,
              canRetry: false,
            },
            notice: '',
          }));
          return;
        }
      }
      if (resolvesOperation) {
        confirmedOperation.completed = true;
        if (confirmedOperation.timerId !== null) window.clearTimeout(confirmedOperation.timerId);
        operationRef.current = null;
        pendingCommandIdRef.current = null;
      } else if (confirmedReceipt?.commandId === pendingCommandIdRef.current) {
        pendingCommandIdRef.current = null;
      }
      if (resolvesOperation && confirmedReceipt) onDraftCleared?.();
      updateFor(key, generation, previous => {
        const confirmsPending = confirmedReceipt
          && previous.recovery?.commandId === confirmedReceipt.commandId
          && previous.recovery.command !== undefined;
        const confirmedCommand = confirmsPending ? previous.recovery?.command : null;
        return {
          ...previous,
          ...(confirmsPending ? clearDrafts() : {}),
          snapshot,
          loading: false,
          loadError: '',
          actionError: '',
          recovery: confirmsPending ? null : previous.recovery,
          notice: confirmsPending
            ? `已確認 ${confirmedCommand ? commandLabel(confirmedCommand) : '學生操作'} 完成；伺服器名單已重新載入（命令序號 ${confirmedReceipt.seq}）。${
              confirmedCommand?.kind === 'opening-day' ? '請再按該學生的「更正期初」繼續。' : ''}`
            : previous.notice,
        };
      });
    } catch (error) {
      if (!isCurrent(key, generation) || requestId !== listRequestRef.current) return;
      if (isAuthorizationLoss(error)) {
        revokeAuthorization(key, generation, confirmedReceipt?.commandId ?? null, error);
        return;
      }
      updateFor(key, generation, previous => {
        const recovery = confirmedReceipt && previous.recovery?.commandId === confirmedReceipt.commandId
          ? { ...previous.recovery, phase: 'receipt' as const, receipt: confirmedReceipt }
          : previous.recovery;
        return {
          ...previous,
          ...clearDrafts(),
          snapshot: null,
          loading: false,
          loadError: displayError(error),
          actionError: confirmedReceipt
            ? '已找到命令回執，但尚未完成伺服器名單再次讀取；請重新載入確認。'
            : '',
          recovery,
          notice: '',
        };
      });
    }
  }, [identityKey, isCurrent, onDraftCleared, onNavigationStateChange, ownsOperation, repository, revokeAuthorization, updateFor]);

  useEffect(() => {
    const generation = ++generationRef.current;
    setPageStateRaw(initialPageState(identityKey, scopeVersion));
    void loadSnapshot();
    return () => {
      listRequestRef.current += 1;
      if (generationRef.current === generation) {
        const operation = operationRef.current;
        if (operation?.generation === generation) {
          if (operation.timerId !== null) window.clearTimeout(operation.timerId);
          operation.completed = true;
          operationRef.current = null;
        }
        generationRef.current += 1;
      }
    };
  }, [identityKey, repository, loadSnapshot, scopeVersion]);

  const hasRecovery = page.recovery !== null;
  useEffect(() => {
    onNavigationStateChange?.(
      identityKey,
      page.authorizationRevoked ? 'revoked' : hasRecovery ? 'recovering' : 'resolved',
    );
  }, [hasRecovery, identityKey, onNavigationStateChange, page.authorizationRevoked]);

  const clearOperationTimer = (operation: StudentCommandOperation) => {
    if (operation.timerId !== null) window.clearTimeout(operation.timerId);
    operation.timerId = null;
  };

  const beginAttempt = (operation: StudentCommandOperation) => {
    clearOperationTimer(operation);
    operation.attempt += 1;
    operation.attemptSettled = false;
    operation.retryAuthorized = false;
    operation.querySequence += 1;
    operation.checking = false;
    operation.receipt = null;
    operation.listReloadStarted = false;
    const attemptNumber = operation.attempt;
    operation.timerId = window.setTimeout(() => {
      if (!ownsOperation(operation) || operation.attempt !== attemptNumber || operation.attemptSettled || operation.receipt) return;
      updateFor(operation.identityKey, operation.generation, previous => ({
        ...previous,
        actionError: '',
        recovery: previous.recovery?.commandId === operation.command.commandId
          ? { ...previous.recovery, phase: 'submitting', timedOut: true, canRetry: false }
          : previous.recovery,
      }));
    }, 10_000);
  };

  const showUnknownResult = (operation: StudentCommandOperation, message: string) => {
    if (!ownsOperation(operation) || operation.receipt) return;
    clearOperationTimer(operation);
    updateFor(operation.identityKey, operation.generation, previous => ({
      ...previous,
      snapshot: null,
      loading: false,
      loadError: '',
      actionError: message,
      recovery: {
        commandId: operation.command.commandId,
        command: operation.command,
        phase: operation.checking ? 'checking' : 'unknown',
        timedOut: false,
        canRetry: false,
      },
    }));
  };

  const settleWithReceipt = async (operation: StudentCommandOperation, receipt: CommandReceipt, clearJournal = false) => {
    if (!ownsOperation(operation) || operation.receipt) return;
    if (receipt.commandId !== operation.command.commandId) {
      showUnknownResult(operation, '伺服器回傳的命令編號不符，尚未確認完成；請重新查詢原命令。');
      return;
    }
    clearOperationTimer(operation);
    operation.receipt = receipt;
    operation.retryAuthorized = false;
    operation.checking = false;
    operation.querySequence += 1;
    operation.listReloadStarted = true;
    updateFor(operation.identityKey, operation.generation, previous => ({
      ...previous,
      actionError: '',
      recovery: {
        commandId: operation.command.commandId,
        command: operation.command,
        phase: 'receipt',
        receipt,
      },
    }));
    if (clearJournal) {
      void repository.cleanupConfirmedIntent(operation.intent, operation.datasetId, operation.uid, () => {
        let currentUid: string | null = null;
        try { currentUid = getAuth(operation.app).currentUser?.uid ?? null; } catch { /* fail closed */ }
        return generationRef.current === operation.generation
          && identityRef.current === operation.identityKey
          && scopeRef.current.db === operation.db
          && scopeRef.current.db.app === operation.app
          && scopeRef.current.uid === operation.uid
          && scopeRef.current.identityKey === operation.identityKey
          && scopeRef.current.leaseEpoch === operation.leaseEpoch
          && currentUid === operation.uid
          && typeof navigator !== 'undefined'
          && navigator.onLine;
      }).catch(() => {
        // Local cleanup is best-effort and cannot change the confirmed business result.
      });
    }
    await loadSnapshot(receipt);
  };

  const runPreparedCommand = async (command: PreparedCommand, retryOperation?: StudentCommandOperation) => {
    let operation = retryOperation;
    if (operation) {
      if (!ownsOperation(operation) || !operation.attemptSettled || !operation.retryAuthorized
        || operation.receipt || operation.checking) return;
      operation.retryAuthorized = false;
      operation.command = freezePreparedCommand(operation.command);
    } else {
      if (operationRef.current || page.recovery || !page.snapshot) return;
      const key = identityKey;
      const generation = generationRef.current;
      if (revokedIdentityRef.current === key) return;
      if (!key || !Number.isSafeInteger(leaseEpoch) || leaseEpoch < 1) {
        revokeAuthorization(key, generation, command.commandId, {
          code: 'LEASE_LOST', message: '目前沒有有效的操作使用權，學生資料已清除。請重新確認使用權。',
        });
        return;
      }
      let uid: string | null = null;
      try { uid = getAuth(db.app).currentUser?.uid ?? null; } catch { /* no initialized Auth means no safe command scope */ }
      if (!uid) {
        revokeAuthorization(key, generation, command.commandId, {
          code: 'UNAUTHORIZED', message: '目前登入身分尚未確認，學生資料已清除。請重新登入操作員帳號。',
        });
        return;
      }
      const frozenCommand = freezePreparedCommand(command);
      operation = {
        token: Symbol('cloud-student-operation'),
        identityKey: key,
        generation,
        db,
        app: db.app,
        uid,
        leaseEpoch,
        datasetId: page.snapshot.datasetId,
        command: frozenCommand,
        intent: intentFor(frozenCommand, leaseEpoch),
        attempt: 0,
        attemptPromise: null,
        attemptSettled: false,
        querySequence: 0,
        checking: false,
        retryAuthorized: false,
        receipt: null,
        listReloadStarted: false,
        completed: false,
        timerId: null,
      };
      operationRef.current = operation;
      pendingCommandIdRef.current = frozenCommand.commandId;
      onNavigationStateChange?.(key, 'recovering');
    }

    if (!ownsOperation(operation)) return;
    beginAttempt(operation);
    updateFor(operation.identityKey, operation.generation, previous => ({
      ...previous,
      snapshot: null,
      loading: false,
      loadError: '',
      actionError: '',
      notice: '',
      recovery: {
        commandId: operation!.command.commandId,
        command: operation!.command,
        phase: 'submitting',
        timedOut: false,
        canRetry: false,
      },
    }));

    const attemptNumber = operation.attempt;
    const attemptPromise = repository.commitStudentCommand(operation.intent);
    operation.attemptPromise = attemptPromise;
    try {
      const result = await attemptPromise;
      if (!ownsOperation(operation) || operation.attempt !== attemptNumber) return;
      operation.attemptSettled = true;
      clearOperationTimer(operation);
      if (operation.receipt || operation.completed) return;
      if (!result.ok) {
        if (isAuthorizationLoss(result.error)) {
          revokeAuthorization(operation.identityKey, operation.generation, operation.command.commandId, result.error);
          return;
        }
        if (result.error.code === 'UNKNOWN_RESULT' || result.error.code === 'OFFLINE') {
          showUnknownResult(operation, '操作回應不確定；請唯讀查詢原命令結果，查詢錯誤或找不到結果都不會自動重送。');
          return;
        }
        if (result.error.code === 'LOCAL_STORAGE_UNAVAILABLE') {
          operation.completed = true;
          operationRef.current = null;
          pendingCommandIdRef.current = null;
          updateFor(operation.identityKey, operation.generation, previous => ({
            ...previous,
            actionError: '尚未送出，無法安全保存確認編號；請重試本機儲存檢查，或改用紙本流程。',
            recovery: null,
          }));
          return;
        }
        operation.completed = true;
        operationRef.current = null;
        pendingCommandIdRef.current = null;
        updateFor(operation.identityKey, operation.generation, previous => ({
          ...previous,
          snapshot: null,
          loading: false,
          loadError: '操作未完成；請重新載入伺服器名單後繼續。',
          actionError: displayError(result.error),
          recovery: null,
        }));
        return;
      }
      await settleWithReceipt(operation, result.receipt);
    } catch (error) {
      if (!ownsOperation(operation) || operation.attempt !== attemptNumber) return;
      operation.attemptSettled = true;
      clearOperationTimer(operation);
      if (operation.receipt || operation.completed) return;
      if (isAuthorizationLoss(error)) {
        revokeAuthorization(operation.identityKey, operation.generation, operation.command.commandId, error);
        return;
      }
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN_RESULT';
      if (code === 'LOCAL_STORAGE_UNAVAILABLE') {
        operation.completed = true;
        operationRef.current = null;
        pendingCommandIdRef.current = null;
        updateFor(operation.identityKey, operation.generation, previous => ({
          ...previous,
          actionError: '尚未送出，無法安全保存確認編號；請重試本機儲存檢查，或改用紙本流程。',
          recovery: null,
        }));
        return;
      }
      showUnknownResult(operation, '操作回應不確定；請唯讀查詢原命令結果，查詢錯誤或找不到結果都不會自動重送。');
    } finally {
      if (operation.attemptPromise === attemptPromise) operation.attemptPromise = null;
    }
  };

  const makeCommandId = (): string | null => {
    try {
      return crypto.randomUUID();
    } catch {
      updateFor(identityKey, generationRef.current, previous => ({
        ...previous,
        actionError: '瀏覽器無法建立安全的命令編號，沒有送出操作。請重新載入安全連線後再試。',
      }));
      return null;
    }
  };

  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (operationRef.current || page.recovery || !page.snapshot) return;
    const draft = page.createDraft;
    let studentCode: string;
    try {
      studentCode = normalizeStudentCodeOrThrow(draft.studentCode);
    } catch {
      setPageState(previous => ({ ...previous, actionError: '學員編號必須是有效數字編號（001–999999）。' }));
      return;
    }
    if (page.snapshot.students.some(student => student.studentCode === studentCode)) {
      setPageState(previous => ({ ...previous, actionError: `學員編號 ${studentCode} 已存在。` }));
      return;
    }
    const displayName = draft.displayName.trim();
    if (!displayName || displayName.length > 100) {
      setPageState(previous => ({ ...previous, actionError: '姓名必須為 1 至 100 字。' }));
      return;
    }
    const aliases = validateAliases(draft.aliasesText);
    if (!aliases.ok) {
      setPageState(previous => ({ ...previous, actionError: aliases.message }));
      return;
    }
    if (draft.amountText === '' || !/^-?\d+$/.test(draft.amountText)) {
      setPageState(previous => ({ ...previous, actionError: '期初結餘必須明確輸入整數；沒有結餘請輸入 0。' }));
      return;
    }
    const parsedAmount = Number(draft.amountText);
    if (!Number.isSafeInteger(parsedAmount) || parsedAmount < -1_000_000_000 || parsedAmount > 1_000_000_000) {
      setPageState(previous => ({ ...previous, actionError: '期初結餘限 -1,000,000,000 至 1,000,000,000 元的整數。' }));
      return;
    }
    if (draft.note.length > 500) {
      setPageState(previous => ({ ...previous, actionError: '期初備註不得超過 500 字。' }));
      return;
    }
    if (!draft.openingMode) {
      setPageState(previous => ({ ...previous, actionError: '請選擇期初結餘沿用既有餘額，或建立新學生。' }));
      return;
    }
    const asOfDate = draft.openingMode === 'existing-balance' ? page.snapshot.goLiveDate : clientTaipeiDate();
    const commandId = makeCommandId();
    if (!commandId) return;
    const studentId = makeCommandId() ?? `student-${commandId}`;
    void runPreparedCommand({
      kind: 'create',
      commandId,
      studentId,
      studentCode,
      displayName,
      aliases: aliases.aliases,
      openingBalance: { amount: parsedAmount === 0 ? 0 : parsedAmount, asOfDate, note: draft.note },
    });
  };

  const submitChangeCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const student = page.codeStudent;
    if (operationRef.current || !student || page.recovery || !page.snapshot) return;
    let studentCode: string;
    try {
      studentCode = normalizeStudentCodeOrThrow(page.changeCodeValue);
    } catch {
      setPageState(previous => ({ ...previous, actionError: '學員編號必須是有效數字編號（001–999999）。' }));
      return;
    }
    if (studentCode === student.studentCode) {
      setPageState(previous => ({ ...previous, actionError: '新編號與原編號相同，無需變更。' }));
      return;
    }
    const existing = page.snapshot.students.find(s => s.studentCode === studentCode);
    if (existing) {
      setPageState(previous => ({
        ...previous,
        actionError: `編號 ${studentCode} 已經有人使用（${existing.displayName}）。若欲互換號碼請經由暫時空號分步調換。`,
      }));
      return;
    }
    const reason = page.changeCodeReason.trim();
    if (!reason || reason.length > 500) {
      setPageState(previous => ({ ...previous, actionError: '請輸入具體的改編號原因（1 至 500 字）。' }));
      return;
    }
    const commandId = makeCommandId();
    if (!commandId) return;
    void runPreparedCommand({
      kind: 'code',
      commandId,
      studentId: student.studentId,
      studentCode: student.studentCode,
      expectedRevision: student.revision,
      newStudentCode: studentCode,
      reason,
    });
  };

  const beginEdit = (student: CloudStudentRecord) => {
    setPageState(previous => ({
      ...previous,
      actionError: '',
      editingId: student.studentId,
      editDisplayName: student.displayName,
      editAliasesText: student.aliases.join('、'),
    }));
  };

  const submitEdit = (event: FormEvent<HTMLFormElement>, student: CloudStudentRecord) => {
    event.preventDefault();
    if (operationRef.current || page.recovery || !page.snapshot) return;
    const displayName = page.editDisplayName.trim();
    if (!displayName || displayName.length > 100) {
      setPageState(previous => ({ ...previous, actionError: '姓名必須為 1 至 100 字。' }));
      return;
    }
    const aliases = validateAliases(page.editAliasesText);
    if (!aliases.ok) {
      setPageState(previous => ({ ...previous, actionError: aliases.message }));
      return;
    }
    const changes: Pick<PreparedCommand, 'kind'> & { displayName?: string; aliases?: string[] } = { kind: 'edit' };
    if (displayName !== student.displayName) changes.displayName = displayName;
    if (aliases.aliases.length !== student.aliases.length
      || aliases.aliases.some((alias, index) => alias !== student.aliases[index])) {
      changes.aliases = aliases.aliases;
    }
    if (changes.displayName === undefined && changes.aliases === undefined) {
      setPageState(previous => ({ ...previous, editingId: null, notice: '姓名與別名沒有變更。' }));
      return;
    }
    const commandId = makeCommandId();
    if (!commandId) return;
    void runPreparedCommand({
      kind: 'edit',
      commandId,
      studentId: student.studentId,
      studentCode: student.studentCode,
      expectedRevision: student.revision,
      ...(changes.displayName !== undefined ? { displayName: changes.displayName } : {}),
      ...(changes.aliases !== undefined ? { aliases: changes.aliases } : {}),
    });
  };

  const submitStatus = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const student = page.statusStudent;
    if (operationRef.current || !student || page.recovery || !page.snapshot) return;
    const reason = page.statusReason.trim();
    if (!reason || reason.length > 500) {
      setPageState(previous => ({ ...previous, actionError: '請輸入具體的停用或恢復原因（最多 500 字）。' }));
      return;
    }
    const commandId = makeCommandId();
    if (!commandId) return;
    void runPreparedCommand({
      kind: 'status',
      commandId,
      studentId: student.studentId,
      studentCode: student.studentCode,
      expectedRevision: student.revision,
      status: student.status === 'active' ? 'inactive' : 'active',
      reason,
    });
  };

  const beginOpening = async (student: CloudStudentRecord) => {
    const key = identityKey;
    const generation = generationRef.current;
    const requestId = ++openingDayRequestRef.current;
    const dayId = student.openingBalance.asOfDate;
    setPageState(previous => ({
      ...previous,
      actionError: '',
      openingStudent: student,
      openingAmountText: String(student.openingBalance.amount),
      openingNote: student.openingBalance.note,
      openingReason: '',
      openingDay: { state: 'loading' },
    }));
    const stillWanted = (previous: PageState) => requestId === openingDayRequestRef.current
      && previous.openingStudent?.studentId === student.studentId;
    try {
      const day = await repository.readOpeningDay(dayId);
      if (!isCurrent(key, generation)) return;
      updateFor(key, generation, previous => (stillWanted(previous) ? {
        ...previous,
        openingDay: day ? { state: 'ready', revision: day.revision, status: day.status } : { state: 'missing' },
      } : previous));
    } catch (error) {
      if (!isCurrent(key, generation)) return;
      if (isAuthorizationLoss(error)) {
        revokeAuthorization(key, generation, null, error);
        return;
      }
      updateFor(key, generation, previous => (stillWanted(previous) ? {
        ...previous,
        openingDay: { state: 'error', message: `無法確認期初日營業日。${displayError(error)}` },
      } : previous));
    }
  };

  const closeOpening = () => {
    openingDayRequestRef.current += 1;
    setPageState(previous => ({
      ...previous,
      openingStudent: null,
      openingAmountText: '',
      openingNote: '',
      openingReason: '',
      openingDay: { state: 'loading' },
      actionError: '',
    }));
  };

  const submitOpeningDay = () => {
    const student = page.openingStudent;
    if (operationRef.current || !student || page.recovery || !page.snapshot || page.openingDay.state !== 'missing') return;
    const commandId = makeCommandId();
    if (!commandId) return;
    void runPreparedCommand({
      kind: 'opening-day',
      commandId,
      studentCode: student.studentCode,
      dayId: student.openingBalance.asOfDate,
    });
  };

  const submitOpening = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const student = page.openingStudent;
    const day = page.openingDay;
    if (operationRef.current || !student || page.recovery || !page.snapshot || day.state !== 'ready') return;
    if (day.status === 'closed') {
      setPageState(previous => ({ ...previous, actionError: '期初日已關帳，請先到「日結」頁填寫原因重開該日，再更正期初。' }));
      return;
    }
    const amount = parseOpeningAmount(page.openingAmountText);
    if (amount === null) {
      setPageState(previous => ({ ...previous, actionError: '期初結餘限 -1,000,000,000 至 1,000,000,000 元的整數；沒有結餘請輸入 0。' }));
      return;
    }
    if (page.openingNote.length > 500) {
      setPageState(previous => ({ ...previous, actionError: '期初備註不得超過 500 字。' }));
      return;
    }
    if (amount === student.openingBalance.amount && page.openingNote === student.openingBalance.note) {
      setPageState(previous => ({ ...previous, actionError: '期初金額與備註都沒有變更，無需更正。' }));
      return;
    }
    const reason = page.openingReason.trim();
    if (!reason || reason.length > 500) {
      setPageState(previous => ({ ...previous, actionError: '請輸入具體的期初更正原因（1 至 500 字）。' }));
      return;
    }
    const commandId = makeCommandId();
    if (!commandId) return;
    void runPreparedCommand({
      kind: 'opening',
      commandId,
      studentId: student.studentId,
      studentCode: student.studentCode,
      dayId: student.openingBalance.asOfDate,
      expectedStudentRevision: student.revision,
      expectedDayRevision: day.revision,
      amount,
      note: page.openingNote,
      reason,
    });
  };

  const checkPendingCommand = async () => {
    const recovery = page.recovery;
    const operation = operationRef.current;
    if (revokedIdentityRef.current === identityKey) return;
    if (!recovery || !recovery.command || !operation || operation.command.commandId !== recovery.commandId
      || operation.checking || (recovery.phase === 'submitting' && !recovery.timedOut)) return;
    if (recovery.phase === 'receipt') {
      if (recovery.receipt) await loadSnapshot(recovery.receipt);
      return;
    }
    if (recovery.phase === 'access-lost' || recovery.phase === 'checking') return;
    if (!ownsOperation(operation)) return;
    operation.checking = true;
    const attemptAtQueryStart = operation.attempt;
    const attemptWasSettledAtQueryStart = operation.attemptSettled;
    operation.retryAuthorized = false;
    const querySequence = ++operation.querySequence;
    updateFor(operation.identityKey, operation.generation, previous => ({
      ...previous,
      actionError: '',
      recovery: { ...recovery, phase: 'checking', canRetry: false },
    }));
    try {
      const check = await repository.confirmPendingIntent(operation.intent, operation.datasetId, operation.uid);
      if (!ownsOperation(operation) || operation.querySequence !== querySequence
        || operation.attempt !== attemptAtQueryStart || operation.receipt) return;
      if (check.status === 'matched') {
        await settleWithReceipt(operation, check.receipt, true);
        return;
      }
      if (check.status === 'different-dataset') {
        operation.retryAuthorized = false;
        updateFor(operation.identityKey, operation.generation, previous => ({
          ...previous,
          snapshot: null,
          loading: false,
          loadError: '',
          actionError: '目前伺服器資料集已變更；原操作尚未確認，請聯絡維護者，不可重試。',
          recovery: { commandId: operation.command.commandId, command: operation.command, phase: 'unknown', canRetry: false },
        }));
        return;
      }
      const mayAuthorizeRetry = attemptWasSettledAtQueryStart && operation.attemptSettled;
      if (mayAuthorizeRetry) operation.retryAuthorized = true;
      updateFor(operation.identityKey, operation.generation, previous => ({
        ...previous,
        snapshot: null,
        loading: false,
        loadError: '',
        actionError: mayAuthorizeRetry
          ? '伺服器目前尚未找到這筆命令。沒有產生新的命令編號；確認後可明確選擇同編號重試。'
          : attemptWasSettledAtQueryStart
            ? '原命令狀態在查詢期間改變；這次查詢不能授權重試。請重新查詢原命令。'
            : operation.attemptSettled
              ? '這次查詢開始時原命令仍在送出中；未找到結果不能授權重試。請在原命令結束後重新查詢。'
              : '查詢尚未找到回執，但原命令仍在送出中；目前不能重試。請等待原命令結束後再查詢。',
        recovery: {
          commandId: operation.command.commandId,
          command: operation.command,
          phase: operation.attemptSettled ? 'unknown' : 'submitting',
          timedOut: !operation.attemptSettled,
          canRetry: operation.retryAuthorized,
        },
      }));
    } catch (error) {
      if (!ownsOperation(operation) || operation.querySequence !== querySequence || operation.receipt) return;
      if (isAuthorizationLoss(error)) {
        revokeAuthorization(operation.identityKey, operation.generation, operation.command.commandId, error);
        return;
      }
      operation.retryAuthorized = false;
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      const guidance = code === 'MAINTENANCE'
        ? '系統維護中，暫停同編號重試；請稍後重新查詢。'
        : code === 'QUOTA_EXCEEDED'
          ? '查詢次數已達限制，尚未確認命令不存在；請稍後重新查詢，不可重試。'
          : code === 'UNSUPPORTED_SCHEMA'
            ? '雲端命令格式不支援，尚未確認操作結果；請聯絡維護者，不可重試。'
            : code === 'INVALID_INPUT'
              ? '命令編號已存在，但伺服器內容與原操作不符；仍未確認完成，不可重試。'
            : '目前無法安全確認原命令；查詢錯誤不代表命令不存在，暫不可重試。';
      updateFor(operation.identityKey, operation.generation, previous => ({
        ...previous,
        snapshot: null,
        loading: false,
        loadError: '',
        actionError: guidance,
        recovery: {
          commandId: operation.command.commandId,
          command: operation.command,
          phase: operation.attemptSettled ? 'unknown' : 'submitting',
          timedOut: !operation.attemptSettled,
          canRetry: false,
        },
      }));
    } finally {
      if (operationRef.current === operation && operation.querySequence === querySequence) operation.checking = false;
    }
  };

  const busy = page.recovery !== null;

  const sortedStudents = useMemo(() => {
    if (!page.snapshot) return [];
    return [...page.snapshot.students].sort((a, b) => {
      const na = parseInt(a.studentCode, 10);
      const nb = parseInt(b.studentCode, 10);
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return a.studentCode.localeCompare(b.studentCode);
    });
  }, [page.snapshot]);

  type DisplayRow =
    | { type: 'student'; student: CloudStudentRecord }
    | { type: 'gap'; startCode: string; endCode: string; count: number; prefillCode: string };

  const displayRows = useMemo((): DisplayRow[] => {
    const query = page.search.trim().toLocaleLowerCase();
    if (query) {
      return sortedStudents
        .filter(student => [student.studentCode, student.displayName, ...student.aliases]
          .some(value => value.toLocaleLowerCase().includes(query)))
        .map(student => ({ type: 'student', student }));
    }

    if (sortedStudents.length === 0) return [];

    const studentByCode = new Map<number, CloudStudentRecord>();
    const nonNumericStudents: CloudStudentRecord[] = [];
    let maxCode = 0;
    for (const student of sortedStudents) {
      const num = parseInt(student.studentCode, 10);
      if (Number.isFinite(num)) {
        studentByCode.set(num, student);
        if (num > maxCode) maxCode = num;
      } else {
        nonNumericStudents.push(student);
      }
    }

    const rows: DisplayRow[] = [];
    let n = 1;
    while (n <= maxCode) {
      if (studentByCode.has(n)) {
        rows.push({ type: 'student', student: studentByCode.get(n)! });
        n += 1;
      } else {
        const gapStart = n;
        while (n <= maxCode && !studentByCode.has(n)) {
          n += 1;
        }
        const gapEnd = n - 1;
        const count = gapEnd - gapStart + 1;
        const startCode = gapStart < 1000 ? String(gapStart).padStart(3, '0') : String(gapStart);
        const endCode = gapEnd < 1000 ? String(gapEnd).padStart(3, '0') : String(gapEnd);
        rows.push({
          type: 'gap',
          startCode,
          endCode,
          count,
          prefillCode: startCode,
        });
      }
    }
    for (const student of nonNumericStudents) {
      rows.push({ type: 'student', student });
    }
    return rows;
  }, [sortedStudents, page.search]);

  const visibleStudentCount = displayRows.filter(r => r.type === 'student').length;

  return (
    <main className="cloud-students" aria-label="雲端學生名單">
      <header className="cloud-students__header">
        <div>
          <p className="cloud-students__eyebrow">雲端資料 · 線上操作</p>
          <h1>學生名單與期初結餘</h1>
          <p className="cloud-students__intro">名單由伺服器完整載入。期初結餘在新增學生時建立；之後只能以「更正期初」修改金額與備註，期初日不變，並須填寫原因。</p>
        </div>
        <button
          type="button"
          className="cloud-students__secondary"
          onClick={() => void loadSnapshot(page.recovery?.phase === 'receipt' ? page.recovery.receipt : undefined)}
          disabled={page.loading || busy || !identityKey || page.authorizationRevoked}
        >
          {page.loading ? '載入中…' : '重新載入名單'}
        </button>
      </header>

      {page.loadError && <div className="cloud-students__alert" role="alert">{page.loadError}</div>}
      {page.actionError && <div className="cloud-students__alert" role="alert">{page.actionError}</div>}
      {page.authorizationRevoked && (
        <div className="cloud-students__notice" role="status">
          授權狀態已失效。請重新登入並取得有效使用權；若登入狀態尚未更新，重新載入整頁會再次向伺服器驗證。
        </div>
      )}
      {page.notice && <div className="cloud-students__notice" role="status">{page.notice}</div>}

      {page.recovery && (
        <section className="cloud-students__recovery" aria-label="命令結果確認" role="alert">
          <strong>{page.recovery.phase === 'receipt'
            ? '已找到伺服器回執，名單尚待再次讀取。'
            : page.recovery.phase === 'access-lost'
              ? '使用權已變更；敏感操作內容已清除。'
            : page.recovery.phase === 'checking'
              ? '正在查詢原命令結果…'
              : page.recovery.phase === 'submitting' && page.recovery.timedOut
                ? '結果確認中，勿重新收款'
              : '結果確認中，請勿重複建立／修改。'}</strong>
          {page.recovery.command && <span>{commandLabel(page.recovery.command)} · 命令編號 {page.recovery.commandId}</span>}
          {!page.recovery.command && <span>命令編號 {page.recovery.commandId}</span>}
          {page.recovery.phase === 'access-lost' && <span>只保留命令編號供稍後同編號核對；請先重新確認登入帳號與使用權。</span>}
          {page.recovery.phase === 'receipt' && page.recovery.receipt && (
            <span>伺服器命令序號 {page.recovery.receipt.seq}</span>
          )}
          <div className="cloud-students__actions">
            {page.recovery.command && (page.recovery.phase === 'unknown'
              || (page.recovery.phase === 'submitting' && page.recovery.timedOut)) && (
              <button type="button" className="cloud-students__primary" onClick={() => void checkPendingCommand()}>
                查詢原命令結果
              </button>
            )}
            {page.recovery.phase === 'unknown' && page.recovery.command && page.recovery.canRetry && (
              <button
                type="button"
                className="cloud-students__secondary"
                onClick={() => {
                  const operation = operationRef.current;
                  if (operation) void runPreparedCommand(operation.command, operation);
                }}
              >
                以相同命令編號重試
              </button>
            )}
            {page.recovery.phase === 'receipt' && (
              <button type="button" className="cloud-students__secondary" onClick={() => void loadSnapshot(page.recovery?.receipt)} disabled={page.loading}>
                重新讀取伺服器名單
              </button>
            )}
            {page.recovery.phase === 'access-lost' && page.snapshot && (
              <button
                type="button"
                className="cloud-students__secondary"
                onClick={() => {
                  pendingCommandIdRef.current = null;
                  setPageState(previous => ({ ...previous, recovery: null, actionError: '', notice: '請依保留的命令編號完成人工核對後，再繼續操作。' }));
                }}
              >
                我已記下命令編號並完成人工核對，清除追蹤
              </button>
            )}
          </div>
        </section>
      )}

      {page.loading && <div className="cloud-students__loading" role="status">正在從伺服器載入完整學生名單…</div>}

      {page.snapshot && !page.loading && (
        <>
          <section className="cloud-students__toolbar" aria-label="學生名單工具">
            <label className="cloud-students__search-label" htmlFor="cloud-student-search">搜尋編號、姓名或別名</label>
            <input
              id="cloud-student-search"
              className="cloud-students__input"
              value={page.search}
              onChange={event => setPageState(previous => ({ ...previous, search: event.target.value }))}
              placeholder="輸入編號、姓名或別名"
              disabled={busy}
            />
            <span className="cloud-students__count">{visibleStudentCount} / {page.snapshot.students.length} 位</span>
            <button
              type="button"
              className="cloud-students__primary"
              onClick={() => setPageState(previous => ({
                ...previous,
                createOpen: !previous.createOpen,
                actionError: '',
                createDraft: previous.createOpen ? freshCreateDraft() : previous.createDraft,
              }))}
              disabled={busy}
            >
              {page.createOpen ? '收起新增表單' : '新增學生'}
            </button>
          </section>

          {page.createOpen && (
            <form className="cloud-students__form" aria-label="新增學生" onSubmit={submitCreate}>
              <h2>手動新增學生</h2>
              <p>編號會以正規化形式儲存（例如 001、099、1000）；請自行核對實際結餘。金額沒有預設值，輸入 0 才代表零元。</p>
              <div className="cloud-students__form-grid">
                <label>
                  學員編號
                  <input className="cloud-students__input cloud-students__mono" value={page.createDraft.studentCode} maxLength={6} placeholder="001 至 999999" onChange={event => setPageState(previous => ({ ...previous, createDraft: { ...previous.createDraft, studentCode: event.target.value } }))} disabled={busy} />
                </label>
                <label>
                  姓名
                  <input className="cloud-students__input" value={page.createDraft.displayName} maxLength={100} onChange={event => setPageState(previous => ({ ...previous, createDraft: { ...previous.createDraft, displayName: event.target.value } }))} disabled={busy} />
                </label>
                <label className="cloud-students__field-wide">
                  別名（逗號、頓號或換行分隔；最多 10 個）
                  <textarea className="cloud-students__input" value={page.createDraft.aliasesText} rows={2} onChange={event => setPageState(previous => ({ ...previous, createDraft: { ...previous.createDraft, aliasesText: event.target.value } }))} disabled={busy} />
                </label>
                <label>
                  期初結餘（整數新臺幣，可為正、0 或負數）
                  <input className="cloud-students__input cloud-students__mono" type="text" inputMode="numeric" value={page.createDraft.amountText} onChange={event => setPageState(previous => ({ ...previous, createDraft: { ...previous.createDraft, amountText: event.target.value } }))} disabled={busy} />
                </label>
                <label>
                  期初備註（選填，最多 500 字）
                  <input className="cloud-students__input" value={page.createDraft.note} maxLength={500} onChange={event => setPageState(previous => ({ ...previous, createDraft: { ...previous.createDraft, note: event.target.value } }))} disabled={busy} />
                </label>
                <fieldset className="cloud-students__field-wide cloud-students__opening-choice">
                  <legend>期初基準（請明確選擇）</legend>
                  <label>
                    <input type="radio" name="opening-mode" value="existing-balance" checked={page.createDraft.openingMode === 'existing-balance'} onChange={() => setPageState(previous => ({ ...previous, createDraft: { ...previous.createDraft, openingMode: 'existing-balance' } }))} disabled={busy} />
                    沿用既有核對結餘，期初日為 {page.snapshot.goLiveDate}
                  </label>
                  <label>
                    <input type="radio" name="opening-mode" value="new-student" checked={page.createDraft.openingMode === 'new-student'} onChange={() => setPageState(previous => ({ ...previous, createDraft: { ...previous.createDraft, openingMode: 'new-student' } }))} disabled={busy} />
                    建立新學生，期初日預填臺北今天 {clientTaipeiDate()}（伺服器會再次核對日期）
                  </label>
                  <small>瀏覽器日期只用於顯示與預填；伺服器日期檢查才是最後依據。日期不符時請先確認連線與系統時間，不會自動改寫未確認的命令。</small>
                </fieldset>
              </div>
              <div className="cloud-students__actions">
                <button type="submit" className="cloud-students__primary" disabled={busy}>建立學生</button>
                <button type="button" className="cloud-students__secondary" onClick={() => setPageState(previous => ({ ...previous, createOpen: false, createDraft: freshCreateDraft(), actionError: '' }))} disabled={busy}>取消</button>
              </div>
            </form>
          )}

          <section className="cloud-students__list" aria-label="學生名單">
            {displayRows.length === 0 ? (
              <div className="cloud-students__empty" role="status">
                {page.search.trim() ? `找不到符合「${page.search.trim()}」的學生。` : '目前伺服器名單是空的，請手動新增學生。'}
              </div>
            ) : (
              <div className="cloud-students__table-wrap">
                <table>
                  <thead>
                    <tr><th>編號</th><th>姓名與別名</th><th>狀態</th><th>目前結餘</th><th>期初資料</th><th>操作</th></tr>
                  </thead>
                  <tbody>
                    {displayRows.map(row => {
                      if (row.type === 'gap') {
                        return (
                          <tr
                            key={`gap-${row.startCode}-${row.endCode}`}
                            className="cloud-students__gap-row"
                            data-testid={`cloud-student-gap-${row.startCode}`}
                            onClick={() => setPageState(previous => ({
                              ...previous,
                              createOpen: true,
                              actionError: '',
                              createDraft: { ...freshCreateDraft(), studentCode: row.prefillCode },
                            }))}
                            style={{ cursor: 'pointer', background: 'rgba(0, 0, 0, 0.03)' }}
                          >
                            <td colSpan={6} style={{ textAlign: 'center', padding: '10px' }}>
                              <strong>{row.count === 1 ? `${row.startCode} 尚無人使用` : `${row.startCode}–${row.endCode} 尚無人使用（${row.count} 個號碼）`}</strong>
                              <span style={{ marginLeft: '8px', fontSize: '0.85em', opacity: 0.8 }}>（點擊填入新增表單）</span>
                            </td>
                          </tr>
                        );
                      }
                      const student = row.student;
                      return (
                        <tr key={student.studentId} data-testid={`cloud-student-row-${student.studentCode}`}>
                          <td className="cloud-students__mono">{student.studentCode}</td>
                          <td>
                            {page.editingId === student.studentId ? (
                              <form className="cloud-students__edit-form" aria-label={`編輯學生 ${student.studentCode}`} onSubmit={event => submitEdit(event, student)}>
                                <label>姓名<input className="cloud-students__input" value={page.editDisplayName} maxLength={100} onChange={event => setPageState(previous => ({ ...previous, editDisplayName: event.target.value }))} disabled={busy} /></label>
                                <label>別名<textarea className="cloud-students__input" rows={2} value={page.editAliasesText} onChange={event => setPageState(previous => ({ ...previous, editAliasesText: event.target.value }))} disabled={busy} /></label>
                                <div className="cloud-students__actions">
                                  <button type="submit" className="cloud-students__primary" disabled={busy}>儲存姓名與別名</button>
                                  <button type="button" className="cloud-students__secondary" onClick={() => setPageState(previous => ({ ...previous, editingId: null, actionError: '' }))} disabled={busy}>取消</button>
                                </div>
                              </form>
                            ) : (
                              <>
                                <strong>{student.displayName}</strong>
                                {student.aliases.length > 0 && <div className="cloud-students__aliases">別名：{student.aliases.join('、')}</div>}
                              </>
                            )}
                          </td>
                          <td><span className={`cloud-students__status cloud-students__status--${student.status}`}>{student.status === 'active' ? '使用中' : '已停用'}</span></td>
                          <td className="cloud-students__balance">{formatBalance(student.currentBalance)}</td>
                          <td>
                            <details className="cloud-students__opening-details">
                              <summary>查看期初資料</summary>
                              <dl>
                                <dt>期初結餘</dt><dd>{formatBalance(student.openingBalance.amount)}</dd>
                                <dt>期初日期</dt><dd>{student.openingBalance.asOfDate}</dd>
                                <dt>期初備註</dt><dd>{student.openingBalance.note || '（無）'}</dd>
                              </dl>
                            </details>
                          </td>
                          <td>
                            {page.codeStudent?.studentId === student.studentId ? (
                              <form className="cloud-students__code-form" aria-label={`改編號 ${student.studentCode}`} onSubmit={submitChangeCode}>
                                <p>修改編號（原編號 {student.studentCode}）</p>
                                <label>新編號<input className="cloud-students__input cloud-students__mono" value={page.changeCodeValue} maxLength={6} placeholder="例如 015" onChange={event => setPageState(previous => ({ ...previous, changeCodeValue: event.target.value }))} disabled={busy} /></label>
                                <label>改號原因（必填）<textarea className="cloud-students__input" rows={2} maxLength={500} value={page.changeCodeReason} onChange={event => setPageState(previous => ({ ...previous, changeCodeReason: event.target.value }))} disabled={busy} /></label>
                                <div className="cloud-students__actions">
                                  <button type="submit" className="cloud-students__primary" disabled={busy}>確認改號</button>
                                  <button type="button" className="cloud-students__secondary" onClick={() => setPageState(previous => ({ ...previous, codeStudent: null, changeCodeValue: '', changeCodeReason: '', actionError: '' }))} disabled={busy}>取消</button>
                                </div>
                              </form>
                            ) : page.openingStudent?.studentId === student.studentId ? (
                              <OpeningCorrectionForm
                                student={student}
                                day={page.openingDay}
                                amountText={page.openingAmountText}
                                note={page.openingNote}
                                reason={page.openingReason}
                                busy={busy}
                                onAmountChange={value => setPageState(previous => ({ ...previous, openingAmountText: value }))}
                                onNoteChange={value => setPageState(previous => ({ ...previous, openingNote: value }))}
                                onReasonChange={value => setPageState(previous => ({ ...previous, openingReason: value }))}
                                onSubmit={submitOpening}
                                onEnsureDay={submitOpeningDay}
                                onRetryDay={() => void beginOpening(student)}
                                onCancel={closeOpening}
                              />
                            ) : page.statusStudent?.studentId === student.studentId ? (
                              <form className="cloud-students__status-form" aria-label={`${student.status === 'active' ? '停用' : '恢復'}學生 ${student.studentCode}`} onSubmit={submitStatus}>
                                <p>{student.status === 'active' ? '確認停用這位學生？' : '確認恢復這位學生？'}</p>
                                <label>原因（必填）<textarea className="cloud-students__input" rows={2} maxLength={500} value={page.statusReason} onChange={event => setPageState(previous => ({ ...previous, statusReason: event.target.value }))} disabled={busy} /></label>
                                <div className="cloud-students__actions">
                                  <button type="submit" className="cloud-students__primary" disabled={busy}>{student.status === 'active' ? '確認停用' : '確認恢復'}</button>
                                  <button type="button" className="cloud-students__secondary" onClick={() => setPageState(previous => ({ ...previous, statusStudent: null, statusReason: '', actionError: '' }))} disabled={busy}>取消</button>
                                </div>
                              </form>
                            ) : (
                              <div className="cloud-students__row-actions">
                                <button type="button" className="cloud-students__secondary" onClick={() => beginEdit(student)} disabled={busy}>編輯姓名與別名</button>
                                <button type="button" className="cloud-students__secondary" onClick={() => setPageState(previous => ({ ...previous, codeStudent: student, changeCodeValue: '', changeCodeReason: '', actionError: '' }))} disabled={busy}>改編號</button>
                                <button type="button" className="cloud-students__secondary" onClick={() => void beginOpening(student)} disabled={busy}>更正期初</button>
                                <button type="button" className="cloud-students__secondary" onClick={() => setPageState(previous => ({ ...previous, statusStudent: student, statusReason: '', actionError: '' }))} disabled={busy}>
                                  {student.status === 'active' ? '停用' : '恢復'}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p className="cloud-students__footnote">學生資料由雲端伺服器提供。編號、姓名及期初資料不會儲存在本機離線草稿。</p>
        </>
      )}

      {!page.snapshot && !page.loading && !page.recovery && (
        <section className="cloud-students__unavailable" aria-label="學生名單未載入">
          <p>名單尚未從伺服器完整載入，沒有顯示空白名單或本機資料。</p>
          <button type="button" className="cloud-students__primary" onClick={() => void loadSnapshot()} disabled={!identityKey}>重新載入伺服器名單</button>
        </section>
      )}
    </main>
  );
}

export default CloudStudentsPage;
