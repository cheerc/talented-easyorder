import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type SetStateAction } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { CommandReceipt, CommandResult } from '../../domain/cloudCommands';
import {
  createCloudStudentRepository,
  type CloudStudentList,
  type CloudStudentRecord,
} from '../../firebase/cloudStudentRepository';
import './CloudStudentsPage.css';

export interface CloudStudentsPageProps {
  db: Firestore;
  leaseEpoch: number;
  identityKey: string;
}

type OpeningMode = '' | 'existing-balance' | 'new-student';

interface CreateDraft {
  studentId: string;
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
      displayName: string;
      aliases: string[];
      openingBalance: { amount: number; asOfDate: string; note: string };
    }
  | {
      kind: 'edit';
      commandId: string;
      studentId: string;
      expectedRevision: number;
      displayName?: string;
      aliases?: string[];
    }
  | {
      kind: 'status';
      commandId: string;
      studentId: string;
      expectedRevision: number;
      status: 'active' | 'inactive';
      reason: string;
    };

type RecoveryPhase = 'submitting' | 'unknown' | 'checking' | 'receipt' | 'access-lost';

interface RecoveryState {
  commandId: string;
  command?: PreparedCommand;
  phase: RecoveryPhase;
  receipt?: CommandReceipt;
}

interface PageState {
  identityKey: string;
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
  recovery: RecoveryState | null;
}

const freshCreateDraft = (): CreateDraft => ({
  studentId: '',
  displayName: '',
  aliasesText: '',
  amountText: '',
  note: '',
  openingMode: '',
});

const initialPageState = (identityKey: string): PageState => ({
  identityKey,
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
  recovery: null,
});

function clearDrafts(): Pick<PageState,
  'search' | 'createOpen' | 'createDraft' | 'editingId' | 'editDisplayName' | 'editAliasesText' | 'statusStudent' | 'statusReason'> {
  return {
    search: '',
    createOpen: false,
    createDraft: freshCreateDraft(),
    editingId: null,
    editDisplayName: '',
    editAliasesText: '',
    statusStudent: null,
    statusReason: '',
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

function commandLabel(command: PreparedCommand): string {
  if (command.kind === 'create') return `新增 ${command.studentId}`;
  if (command.kind === 'edit') return `修改 ${command.studentId}`;
  return command.status === 'inactive' ? `停用 ${command.studentId}` : `恢復 ${command.studentId}`;
}

export function CloudStudentsPage({ db, leaseEpoch, identityKey }: CloudStudentsPageProps) {
  const repository = useMemo(() => createCloudStudentRepository(db), [db]);
  const [pageState, setPageStateRaw] = useState<PageState>(() => initialPageState(identityKey));
  const identityRef = useRef(identityKey);
  const generationRef = useRef(0);
  const listRequestRef = useRef(0);
  const commandFlightRef = useRef<symbol | null>(null);
  const revokedIdentityRef = useRef<string | null>(null);
  const pendingCommandIdRef = useRef<string | null>(null);

  if (identityRef.current !== identityKey) {
    identityRef.current = identityKey;
    generationRef.current += 1;
    commandFlightRef.current = null;
    revokedIdentityRef.current = null;
    pendingCommandIdRef.current = null;
  }

  const page = pageState.identityKey === identityKey ? pageState : initialPageState(identityKey);

  const isCurrent = useCallback((key: string, generation: number) => (
    identityRef.current === key && generationRef.current === generation
  ), []);

  const updateFor = useCallback((key: string, generation: number, update: (previous: PageState) => PageState) => {
    setPageStateRaw(previous => {
      if (!isCurrent(key, generation)) return previous;
      const current = previous.identityKey === key ? previous : initialPageState(key);
      return update(current);
    });
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
    commandFlightRef.current = null;
    const retainedCommandId = commandId ?? pendingCommandIdRef.current;
    pendingCommandIdRef.current = retainedCommandId;

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
  }, [isCurrent]);

  const loadSnapshot = useCallback(async (confirmedReceipt?: CommandReceipt) => {
    const key = identityKey;
    const generation = generationRef.current;
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
      if (confirmedReceipt?.commandId === pendingCommandIdRef.current) pendingCommandIdRef.current = null;
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
            ? `已確認 ${confirmedCommand ? commandLabel(confirmedCommand) : '學生操作'} 完成；伺服器名單已重新載入（命令序號 ${confirmedReceipt.seq}）。`
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
  }, [identityKey, isCurrent, repository, revokeAuthorization, updateFor]);

  useEffect(() => {
    const generation = ++generationRef.current;
    setPageStateRaw(initialPageState(identityKey));
    void loadSnapshot();
    return () => {
      listRequestRef.current += 1;
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [identityKey, repository, loadSnapshot]);

  const runPreparedCommand = async (command: PreparedCommand) => {
    const key = identityKey;
    const generation = generationRef.current;
    if (revokedIdentityRef.current === key) return;
    if (!key || !Number.isSafeInteger(leaseEpoch) || leaseEpoch < 1) {
      revokeAuthorization(key, generation, command.commandId, {
        code: 'LEASE_LOST',
        message: '目前沒有有效的操作使用權，學生資料已清除。請重新確認使用權。',
      });
      return;
    }
    if (commandFlightRef.current) return;
    const flightToken = Symbol('cloud-student-command');
    commandFlightRef.current = flightToken;
    pendingCommandIdRef.current = command.commandId;
    const releaseFlight = () => {
      if (commandFlightRef.current === flightToken) commandFlightRef.current = null;
    };

    updateFor(key, generation, previous => ({
      ...previous,
      snapshot: null,
      loading: false,
      loadError: '',
      actionError: '',
      notice: '',
      recovery: { commandId: command.commandId, command, phase: 'submitting' },
    }));

    let result: CommandResult;
    try {
      if (command.kind === 'create') {
        result = await repository.createStudent({
          commandId: command.commandId,
          leaseEpoch,
          studentId: command.studentId,
          displayName: command.displayName,
          aliases: command.aliases,
          openingBalance: command.openingBalance,
        });
      } else if (command.kind === 'edit') {
        result = await repository.editStudent({
          commandId: command.commandId,
          leaseEpoch,
          studentId: command.studentId,
          expectedRevision: command.expectedRevision,
          ...(command.displayName !== undefined ? { displayName: command.displayName } : {}),
          ...(command.aliases !== undefined ? { aliases: command.aliases } : {}),
        });
      } else {
        result = await repository.setStudentStatus({
          commandId: command.commandId,
          leaseEpoch,
          studentId: command.studentId,
          expectedRevision: command.expectedRevision,
          status: command.status,
          reason: command.reason,
        });
      }
    } catch (error) {
      releaseFlight();
      if (!isCurrent(key, generation)) return;
      if (isAuthorizationLoss(error)) {
        revokeAuthorization(key, generation, command.commandId, error);
        return;
      }
      updateFor(key, generation, previous => ({
        ...previous,
        snapshot: null,
        loadError: '',
        actionError: '',
        recovery: { commandId: command.commandId, command, phase: 'unknown' },
      }));
      return;
    }

    if (!isCurrent(key, generation)) {
      releaseFlight();
      return;
    }
    if (!result.ok) {
      if (isAuthorizationLoss(result.error)) {
        releaseFlight();
        revokeAuthorization(key, generation, command.commandId, result.error);
        return;
      }
      if (result.error.code === 'UNKNOWN_RESULT') {
        releaseFlight();
        updateFor(key, generation, previous => ({
          ...previous,
          snapshot: null,
          loadError: '',
          actionError: '',
          recovery: { commandId: command.commandId, command, phase: 'unknown' },
        }));
        return;
      }
      releaseFlight();
      const clearIdentityData = result.error.code === 'OFFLINE';
      pendingCommandIdRef.current = clearIdentityData ? command.commandId : null;
      updateFor(key, generation, previous => ({
        ...previous,
        ...(clearIdentityData ? clearDrafts() : {}),
        snapshot: null,
        loading: false,
        loadError: '操作未完成；請重新載入伺服器名單後繼續。',
        actionError: displayError(result.error),
        recovery: clearIdentityData
          ? { commandId: command.commandId, phase: 'access-lost' }
          : null,
      }));
      return;
    }

    updateFor(key, generation, previous => ({
      ...previous,
      recovery: { commandId: command.commandId, command, phase: 'receipt', receipt: result.receipt },
    }));
    await loadSnapshot(result.receipt);
    releaseFlight();
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
    if (page.recovery || !page.snapshot) return;
    const draft = page.createDraft;
    const studentId = draft.studentId;
    if (!studentId.trim() || studentId.length > 64 || studentId.includes('/') || studentId === '__cashier__') {
      setPageState(previous => ({ ...previous, actionError: '學員編號必須為 1 至 64 字，且不能包含斜線。' }));
      return;
    }
    if (page.snapshot.students.some(student => student.studentId === studentId)) {
      setPageState(previous => ({ ...previous, actionError: `學員編號 ${studentId} 已存在。` }));
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
    void runPreparedCommand({
      kind: 'create',
      commandId,
      studentId,
      displayName,
      aliases: aliases.aliases,
      openingBalance: { amount: parsedAmount === 0 ? 0 : parsedAmount, asOfDate, note: draft.note },
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
    if (page.recovery || !page.snapshot) return;
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
      expectedRevision: student.revision,
      ...(changes.displayName !== undefined ? { displayName: changes.displayName } : {}),
      ...(changes.aliases !== undefined ? { aliases: changes.aliases } : {}),
    });
  };

  const submitStatus = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const student = page.statusStudent;
    if (!student || page.recovery || !page.snapshot) return;
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
      expectedRevision: student.revision,
      status: student.status === 'active' ? 'inactive' : 'active',
      reason,
    });
  };

  const checkPendingCommand = async () => {
    const recovery = page.recovery;
    if (revokedIdentityRef.current === identityKey) return;
    if (!recovery || !recovery.command || recovery.phase === 'submitting' || recovery.phase === 'checking') return;
    if (recovery.phase === 'receipt') {
      if (recovery.receipt) await loadSnapshot(recovery.receipt);
      return;
    }
    const key = identityKey;
    const generation = generationRef.current;
    updateFor(key, generation, previous => ({ ...previous, actionError: '', recovery: { ...recovery, phase: 'checking' } }));
    try {
      const receipt = await repository.readCommand(recovery.commandId);
      if (!isCurrent(key, generation)) return;
      if (!receipt) {
        updateFor(key, generation, previous => ({
          ...previous,
          snapshot: null,
          loadError: '',
          actionError: '伺服器目前尚未找到這筆命令。沒有產生新的命令編號；可用相同編號與原資料重試。',
          recovery: { commandId: recovery.commandId, command: recovery.command, phase: 'unknown' },
        }));
        return;
      }
      if (receipt.commandId !== recovery.commandId) {
        throw new Error('伺服器回傳的命令編號不符，無法確認結果。');
      }
      // A receipt ID alone is not proof that this is the same business command.
      // Re-submit the frozen input under the same ID; the repository compares all
      // semantic fields and returns the stored receipt without another write.
      const verification = recovery.command.kind === 'create'
        ? await repository.createStudent({
          commandId: recovery.command.commandId,
          leaseEpoch,
          studentId: recovery.command.studentId,
          displayName: recovery.command.displayName,
          aliases: recovery.command.aliases,
          openingBalance: recovery.command.openingBalance,
        })
        : recovery.command.kind === 'edit'
          ? await repository.editStudent({
            commandId: recovery.command.commandId,
            leaseEpoch,
            studentId: recovery.command.studentId,
            expectedRevision: recovery.command.expectedRevision,
            ...(recovery.command.displayName !== undefined ? { displayName: recovery.command.displayName } : {}),
            ...(recovery.command.aliases !== undefined ? { aliases: recovery.command.aliases } : {}),
          })
          : await repository.setStudentStatus({
            commandId: recovery.command.commandId,
            leaseEpoch,
            studentId: recovery.command.studentId,
            expectedRevision: recovery.command.expectedRevision,
            status: recovery.command.status,
            reason: recovery.command.reason,
          });
      if (!isCurrent(key, generation)) return;
      if (!verification.ok) {
        if (isAuthorizationLoss(verification.error)) {
          revokeAuthorization(key, generation, recovery.commandId, verification.error);
          return;
        }
        updateFor(key, generation, previous => ({
          ...previous,
          snapshot: null,
          loading: false,
          loadError: '',
          actionError: verification.error.code === 'UNKNOWN_RESULT'
            ? '已找到命令回執，但語義比對結果不明；請使用相同命令編號再查詢。'
            : `命令編號已存在，但伺服器內容與原操作不符，仍未確認完成。${verification.error.message}`,
          recovery: { commandId: recovery.commandId, command: recovery.command, phase: 'unknown' },
        }));
        return;
      }
      updateFor(key, generation, previous => ({
        ...previous,
        recovery: { commandId: recovery.commandId, command: recovery.command, phase: 'receipt', receipt: verification.receipt },
      }));
      await loadSnapshot(verification.receipt);
    } catch (error) {
      if (!isCurrent(key, generation)) return;
      if (isAuthorizationLoss(error)) {
        revokeAuthorization(key, generation, recovery.commandId, error);
        return;
      }
      updateFor(key, generation, previous => ({
        ...previous,
        ...clearDrafts(),
        snapshot: null,
        loading: false,
        loadError: '',
        actionError: `目前無法確認命令結果。${displayError(error)}`,
        recovery: { commandId: recovery.commandId, command: recovery.command, phase: 'unknown' },
      }));
    }
  };

  const busy = page.recovery !== null;
  const visibleStudents = page.snapshot?.students.filter(student => {
    const query = page.search.trim().toLocaleLowerCase();
    if (!query) return true;
    return [student.studentId, student.displayName, ...student.aliases]
      .some(value => value.toLocaleLowerCase().includes(query));
  }) ?? [];

  return (
    <main className="cloud-students" aria-label="雲端學生名單">
      <header className="cloud-students__header">
        <div>
          <p className="cloud-students__eyebrow">雲端資料 · 線上操作</p>
          <h1>學生名單與期初結餘</h1>
          <p className="cloud-students__intro">名單由伺服器完整載入。期初結餘只在新增學生時建立；已建立的期初資料僅供查看。</p>
        </div>
        <button
          type="button"
          className="cloud-students__secondary"
          onClick={() => void loadSnapshot(page.recovery?.phase === 'receipt' ? page.recovery.receipt : undefined)}
          disabled={page.loading || !identityKey || page.authorizationRevoked}
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
              : '結果確認中，請勿重複建立／修改。'}</strong>
          {page.recovery.command && <span>{commandLabel(page.recovery.command)} · 命令編號 {page.recovery.commandId}</span>}
          {!page.recovery.command && <span>命令編號 {page.recovery.commandId}</span>}
          {page.recovery.phase === 'access-lost' && <span>只保留命令編號供稍後同編號核對；請先重新確認登入帳號與使用權。</span>}
          {page.recovery.phase === 'receipt' && page.recovery.receipt && (
            <span>伺服器命令序號 {page.recovery.receipt.seq}</span>
          )}
          <div className="cloud-students__actions">
            {page.recovery.command && page.recovery.phase !== 'submitting' && page.recovery.phase !== 'checking' && page.recovery.phase !== 'receipt' && (
              <button type="button" className="cloud-students__primary" onClick={() => void checkPendingCommand()}>
                查詢原命令結果
              </button>
            )}
            {page.recovery.phase === 'unknown' && page.recovery.command && page.actionError.includes('尚未找到') && (
              <button type="button" className="cloud-students__secondary" onClick={() => void runPreparedCommand(page.recovery!.command!)}>
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
            <span className="cloud-students__count">{visibleStudents.length} / {page.snapshot.students.length} 位</span>
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
              <p>編號會以原字串儲存，例如 001；請自行核對實際結餘。金額沒有預設值，輸入 0 才代表零元。</p>
              <div className="cloud-students__form-grid">
                <label>
                  學員編號
                  <input className="cloud-students__input cloud-students__mono" value={page.createDraft.studentId} maxLength={64} onChange={event => setPageState(previous => ({ ...previous, createDraft: { ...previous.createDraft, studentId: event.target.value } }))} disabled={busy} />
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
            {visibleStudents.length === 0 ? (
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
                    {visibleStudents.map(student => (
                      <tr key={student.studentId} data-testid={`cloud-student-row-${student.studentId}`}>
                        <td className="cloud-students__mono">{student.studentId}</td>
                        <td>
                          {page.editingId === student.studentId ? (
                            <form className="cloud-students__edit-form" aria-label={`編輯學生 ${student.studentId}`} onSubmit={event => submitEdit(event, student)}>
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
                          {page.statusStudent?.studentId === student.studentId ? (
                            <form className="cloud-students__status-form" aria-label={`${student.status === 'active' ? '停用' : '恢復'}學生 ${student.studentId}`} onSubmit={submitStatus}>
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
                              <button type="button" className="cloud-students__secondary" onClick={() => setPageState(previous => ({ ...previous, statusStudent: student, statusReason: '', actionError: '' }))} disabled={busy}>
                                {student.status === 'active' ? '停用' : '恢復'}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
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
