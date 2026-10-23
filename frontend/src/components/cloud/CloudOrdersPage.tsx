import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { CommandReceipt, CommandResult } from '../../domain/cloudCommands';
import type { PendingReceiptCheck } from '../../firebase/cloudCommandRepository';
import { normalizeStudentCode } from '../../domain/student';
import { expectedCashFromTotals } from '../../domain/cloudLedgerProjection';
import {
  applyTransactionMutation,
  mutationCashEffect,
  studentContribution,
  UNDO_REASON,
  UNDO_WINDOW_MS,
  type TransactionMutationKind,
  type TransactionMutationPayload,
} from '../../domain/cloudTransactionMutation';
import {
  createCloudOrderRepository,
  type CloudOrderRepository,
  type CloudOrderSnapshot,
  type CloudOrderTransactionRecord,
  type CreateCloudCashMovementInput,
  type CreateCloudOrderInput,
  type CreateCloudPaymentInput,
  type CreateCloudRefundInput,
  type CloudTransactionMutationInput,
} from '../../firebase/cloudOrderRepository';
import { getCloudRecoveryReader } from '../../firebase/cloudRecoveryReader';
import type { CloudStudentRecord } from '../../firebase/cloudStudentRepository';
import { isBackfilled, type CloudBackfillDay } from '../../firebase/cloudDayCloseRepository';
import { composePaperRefNote, splitPaperNote } from '../../domain/paperRef';
import { formatTaipeiTime } from '../../utils/dateTime';
import { cloudPendingJournalForRepository, type PendingCommandIdentity } from '../../firebase/cloudPendingJournal';
import './CloudOrdersPage.css';

export interface CloudOrdersPageProps {
  db: Firestore;
  leaseEpoch: number;
  identityKey: string;
  onNavigationStateChange?: (identityKey: string, state: 'recovering' | 'revoked' | 'resolved') => void;
  /** 第一次載入時要顯示的回填營業日（例如從日結頁或異常頁帶過來）；沒提供則顯示伺服器今天。 */
  initialBackfillDayId?: string;
}

interface PreparedMeta {
  /** Who or what the command is for, shown in notices: `001 王小明` or `櫃台支出 $80`. */
  label: string;
  datasetId: string;
}

/** Frozen F1 command: commandId and transactionId never change while its result is unresolved. */
type PreparedCommand =
  | ({ kind: 'order' } & Omit<CreateCloudOrderInput, 'leaseEpoch'> & PreparedMeta)
  | ({ kind: 'payment' } & Omit<CreateCloudPaymentInput, 'leaseEpoch'> & PreparedMeta)
  | ({ kind: 'cash' } & Omit<CreateCloudCashMovementInput, 'leaseEpoch'> & PreparedMeta)
  | ({ kind: 'refund' } & Omit<CreateCloudRefundInput, 'leaseEpoch'> & PreparedMeta)
  | ({ kind: 'mutation'; commandId: string; input: Omit<CloudTransactionMutationInput, 'leaseEpoch'> } & PreparedMeta);

/** P10a：剛確認入帳的新增，5 秒內可由原建立者撤回（spec §7.2）。 */
interface UndoOffer {
  commandId: string;
  transactionId: string;
  label: string;
  expiresAt: number;
}

type EditAction = 'correct' | 'void' | 'cancel-keep' | 'cancel-refund';

/** P10a：E 付款明細或櫃台收支列上的更正／作廢／取消表單。 */
interface EditDraft {
  transactionId: string;
  action: EditAction;
  mealPriceText: string;
  paidAmountText: string;
  amountText: string;
  /** The text after the paper number when the row has one; the whole note otherwise. */
  note: string;
  /** The paper number of the row (P13d2). It is locked: Rules keep it through every correction. */
  paperRef: string | null;
  reason: string;
}

const CASHIER_ID = '__cashier__';

/** F1 entry: today's meal (Q), other meal, or a payment (W). */
type EntryMode = 'bento' | 'other' | 'payment';

type RecoveryPhase = 'submitting' | 'unknown' | 'retrying' | 'confirmed';
type RecoveryQueryStatus = '' | 'not-found-pending' | 'not-found-settled' | 'error';

interface RecoveryView {
  command: PreparedCommand;
  phase: RecoveryPhase;
  elapsed10s: boolean;
  queryPending: boolean;
  queryStatus: RecoveryQueryStatus;
  queryMessage: string;
  retryAllowed: boolean;
}

interface OrdersRecoveryOperation {
  token: number;
  completionToken: number;
  command: PreparedCommand;
  db: Firestore;
  app: unknown;
  identityKey: string;
  uid: string;
  leaseEpoch: number;
  datasetId: string;
  scopeKey: string;
  generation: number;
  originalPromisePending: boolean;
  attemptPromisePending: boolean;
  receiptQueryPending: boolean;
  receiptConfirmed: boolean;
  receipt: CommandReceipt | null;
  refreshInFlight: boolean;
  cleanupPending: boolean;
  backfillView: boolean;
  receiptQueryVersion: number;
  retryAuthorizedQueryVersion: number | null;
  elapsed10s: boolean;
  completed: boolean;
  timer: number | null;
}

interface OrdersPageState {
  scopeKey: string;
  authorizationRevoked: boolean;
  snapshot: CloudOrderSnapshot | null;
  loading: boolean;
  loadError: string;
  actionError: string;
  notice: string;
  /** The past backfill day this page asked for; null shows today (contract §13). */
  viewDayId: string | null;
  search: string;
  selectedStudentId: string | null;
  mode: EntryMode;
  otherItemName: string;
  otherPriceText: string;
  paidAmountText: string;
  note: string;
  /** Paper number of the order or payment being entered (P13d2). */
  paperRefText: string;
  confirmDuplicateOpen: boolean;
  paymentDetailsOpen: boolean;
  cashOpen: boolean;
  cashDirection: 'expense' | 'income';
  cashAmountText: string;
  cashReason: string;
  cashPaperRefText: string;
  /** P09b：W 面板內的退款框；確認對話框開著時才送出。 */
  refundOpen: boolean;
  refundAmountText: string;
  refundReason: string;
  refundConfirmOpen: boolean;
  edit: EditDraft | null;
  undoOffer: UndoOffer | null;
  recovery: RecoveryView | null;
}

const freshDraft = () => ({
  search: '',
  selectedStudentId: null,
  mode: 'bento' as EntryMode,
  otherItemName: '',
  otherPriceText: '',
  paidAmountText: '',
  note: '',
  paperRefText: '',
  confirmDuplicateOpen: false,
  paymentDetailsOpen: false,
  cashOpen: false,
  cashDirection: 'expense' as const,
  cashAmountText: '',
  cashReason: '',
  cashPaperRefText: '',
  refundOpen: false,
  refundAmountText: '',
  refundReason: '',
  refundConfirmOpen: false,
  edit: null as EditDraft | null,
});

function initialState(scopeKey: string): OrdersPageState {
  return {
    scopeKey,
    authorizationRevoked: false,
    snapshot: null,
    loading: true,
    loadError: '',
    actionError: '',
    notice: '',
    viewDayId: null,
    ...freshDraft(),
    undoOffer: null,
    recovery: null,
  };
}

function errorCode(error: unknown): string {
  return error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
}

function errorText(error: unknown): string {
  const code = errorCode(error);
  if (code === 'OFFLINE') return '目前無法連線到雲端，沒有顯示本機或不完整資料。請恢復連線後重新載入。';
  if (code === 'LEASE_LOST' || code === 'ACCESS_BUSY') return '目前使用權已變更，訂餐資料已清除。請重新確認使用權。';
  if (code === 'UNAUTHORIZED') return '目前帳號沒有雲端訂餐資料存取權，資料已清除。請重新登入確認權限。';
  if (code === 'QUOTA_EXCEEDED') return '雲端讀取額度不足，沒有顯示部分資料。請稍後重新載入。';
  if (code === 'MAINTENANCE') return '系統正在維護，暫停訂餐。請稍後重新載入。';
  if (code === 'STALE_SNAPSHOT') return '載入期間伺服器資料有變動，沒有顯示部分資料。請重新載入。';
  if (code === 'INCOMPLETE_SNAPSHOT' || code === 'RECONCILIATION_FAILED' || code === 'UNSUPPORTED_SCHEMA') {
    const message = error instanceof Error ? error.message : '';
    return `伺服器資料無法安全顯示，沒有顯示份數或金額。${message ? `（${message}）` : ''}請聯絡系統維護者。`;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return '雲端訂餐資料無法讀取。請重新載入。';
}

function isAuthorizationLoss(error: unknown): boolean {
  return ['LEASE_LOST', 'UNAUTHORIZED', 'ACCESS_BUSY'].includes(errorCode(error));
}

function uidFromIdentityKey(identityKey: string, leaseEpoch: number): string | null {
  const suffix = `:${leaseEpoch}`;
  if (!identityKey.endsWith(suffix)) return null;
  const uid = identityKey.slice(0, -suffix.length);
  return uid || null;
}

function freezePreparedCommand(command: PreparedCommand): PreparedCommand {
  if (command.kind === 'mutation') {
    return Object.freeze({
      ...command,
      input: Object.freeze({ ...command.input, payload: Object.freeze({ ...command.input.payload }) }),
    }) as PreparedCommand;
  }
  return Object.freeze({ ...command }) as PreparedCommand;
}

const MUTATION_NOUN: Record<TransactionMutationKind, string> = {
  CorrectTransaction: '更正',
  VoidTransaction: '作廢',
  CancelKeepDeposit: '取消訂餐（留款）',
  CancelRefund: '取消訂餐並退款',
  Undo: '撤回',
};

function commandNoun(command: PreparedCommand): string {
  if (command.kind === 'mutation') return MUTATION_NOUN[command.input.kind];
  if (command.kind === 'order') return '訂餐';
  if (command.kind === 'payment') return '繳費';
  if (command.kind === 'refund') return '退款';
  return '櫃台收支';
}

function successText(command: PreparedCommand, seq: number): string {
  if (command.kind === 'mutation') {
    if (command.input.kind === 'Undo') return `已撤回 ${command.label}，帳戶餘額與現金已回復（命令序號 ${seq}）`;
    return `已確認 ${command.label} 的${commandNoun(command)}完成（命令序號 ${seq}）`;
  }
  if (command.kind === 'order') return `已確認 ${command.label} 訂餐完成（命令序號 ${seq}）`;
  if (command.kind === 'payment') return `已確認 ${command.label} 繳費 $${command.paidAmount} 完成（命令序號 ${seq}）`;
  if (command.kind === 'refund') return `已確認 ${command.label} 退款 $${command.amount} 完成（命令序號 ${seq}）`;
  return `已確認${command.label}入帳（命令序號 ${seq}）`;
}

function sendCommand(repository: CloudOrderRepository, command: PreparedCommand, leaseEpoch: number) {
  if (command.kind === 'mutation') {
    return repository.mutateTransaction({ ...command.input, leaseEpoch } as CloudTransactionMutationInput);
  }
  if (command.kind === 'payment') {
    return repository.createPayment({
      commandId: command.commandId,
      transactionId: command.transactionId,
      leaseEpoch,
      studentId: command.studentId,
      dayId: command.dayId,
      expectedStudentRevision: command.expectedStudentRevision,
      expectedDayRevision: command.expectedDayRevision,
      paidAmount: command.paidAmount,
      note: command.note,
    });
  }
  if (command.kind === 'refund') {
    return repository.createRefund({
      commandId: command.commandId,
      transactionId: command.transactionId,
      leaseEpoch,
      studentId: command.studentId,
      dayId: command.dayId,
      expectedStudentRevision: command.expectedStudentRevision,
      expectedDayRevision: command.expectedDayRevision,
      amount: command.amount,
      reason: command.reason,
    });
  }
  if (command.kind === 'cash') {
    return repository.createCashMovement({
      commandId: command.commandId,
      transactionId: command.transactionId,
      leaseEpoch,
      dayId: command.dayId,
      expectedDayRevision: command.expectedDayRevision,
      direction: command.direction,
      amount: command.amount,
      reason: command.reason,
    });
  }
  return repository.createOrder({
    commandId: command.commandId,
    transactionId: command.transactionId,
    leaseEpoch,
    studentId: command.studentId,
    dayId: command.dayId,
    expectedStudentRevision: command.expectedStudentRevision,
    expectedDayRevision: command.expectedDayRevision,
    mealKind: command.mealKind,
    mealPrice: command.mealPrice,
    paidAmount: command.paidAmount,
    menuRevision: command.menuRevision,
    otherItemName: command.otherItemName,
    note: command.note,
  });
}

function definiteFailureText(command: PreparedCommand, code: string, message: string): string {
  if (code === 'LOCAL_STORAGE_UNAVAILABLE') return '尚未送出，無法安全保存確認編號；請重試本機儲存檢查，或改用紙本流程。';
  if (code === 'MAINTENANCE') return '系統正在維護，這筆沒有入帳。請稍後重新確認結果，再決定後續操作。';
  if (code === 'QUOTA_EXCEEDED') return '雲端額度不足，這筆沒有入帳。請稍後確認額度恢復後再操作。';
  if (code === 'UNSUPPORTED_SCHEMA') return '伺服器資料格式不支援，這筆沒有入帳。請保留畫面並聯絡系統維護者。';
  if (command.kind === 'mutation') {
    const noun = commandNoun(command);
    if (code === 'REVISION_CONFLICT') return `這筆交易、學生或營業日已在別處變更，${noun}沒有生效。已重新讀取最新資料，請確認後再操作。`;
    if (code === 'DAY_CLOSED') return `這個營業日已關帳，${noun}沒有生效。`;
    return `${noun}沒有生效：${message || '伺服器拒絕了這筆命令'}`;
  }
  if (code === 'REVISION_CONFLICT') return '伺服器上的學生、菜單或營業日已變更，這筆沒有入帳。已重新讀取最新資料，請確認金額後再登記。';
  if (code === 'DAY_CLOSED') return '這個營業日已關帳，這筆沒有入帳。';
  if (code === 'MAINTENANCE') return '系統正在維護，這筆沒有入帳。';
  if (code === 'QUOTA_EXCEEDED') return '雲端額度不足，這筆沒有入帳。';
  return `這筆沒有入帳：${message || '伺服器拒絕了這筆命令'}`;
}

/** Strict non-negative integer text: rejects 1e3, 1.5, -1 and anything parseInt would silently truncate. */
function parseAmount(text: string, emptyAs: number | null): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return emptyAs;
  if (!/^\d{1,7}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value <= 1_000_000 ? value : null;
}

function newId(): string | null {
  try {
    return crypto.randomUUID();
  } catch {
    return null;
  }
}

/** The paper number of a row as its own tag (P13d2); null when the row has none. */
function PaperTag({ tx }: { tx: CloudOrderTransactionRecord }) {
  const { paperRef } = splitPaperNote(tx.note);
  return paperRef ? <span className="cloud-orders__paper-tag" data-testid={`paper-tag-${tx.transactionId}`}>紙本 {paperRef}</span> : null;
}

function itemLabel(tx: CloudOrderTransactionRecord): string {
  if (tx.type === 'payment') return '繳費';
  if (tx.type === 'refund') return `退款：${tx.note}`;
  if (tx.mealKind === 'bento') return `今日餐點：${tx.menuNameSnapshot}`;
  return `其他餐點：${tx.otherItemName ?? ''}`;
}

function signedMoney(value: number): string {
  if (value === 0) return '不變';
  return value > 0 ? `+$${value}` : `−$${Math.abs(value)}`;
}

function cashierLabel(tx: CloudOrderTransactionRecord): string {
  return tx.paidAmount > 0 ? `櫃台收入 $${tx.paidAmount}` : `櫃台支出 $${tx.mealPrice}`;
}

function editDraftFor(tx: CloudOrderTransactionRecord, action: EditAction): EditDraft {
  const { paperRef, text } = splitPaperNote(tx.note);
  return {
    transactionId: tx.transactionId,
    action,
    mealPriceText: String(tx.mealPrice),
    paidAmountText: String(tx.paidAmount),
    amountText: tx.type === 'refund' ? String(tx.amount)
      : tx.type === 'expense' ? String(tx.paidAmount > 0 ? tx.paidAmount : tx.mealPrice) : '',
    note: text,
    paperRef,
    reason: '',
  };
}

/** Builds the mutation the edit form describes; amounts are checked here, the reason only on submit. */
function editMutation(tx: CloudOrderTransactionRecord, edit: EditDraft): TransactionMutationPayload | { error: string } {
  const reason = edit.reason.trim();
  if (edit.action === 'void') return { kind: 'VoidTransaction', payload: { reason } };
  if (edit.action === 'cancel-keep') return { kind: 'CancelKeepDeposit', payload: { reason } };
  if (edit.action === 'cancel-refund') return { kind: 'CancelRefund', payload: { reason } };
  let note = edit.note.trim();
  if (edit.paperRef) {
    // The number is locked (Rules keep it); only the text after it was edited. Expense and refund rows keep a reason.
    if (!note && (tx.type === 'expense' || tx.type === 'refund')) {
      return { error: tx.type === 'refund' ? '更正後的退款原因不能空白' : '更正後的收支原因不能空白' };
    }
    const composed = composePaperRefNote({ paperRef: edit.paperRef, text: note, required: true });
    if (!composed.ok) return { error: composed.error };
    note = composed.note;
  }
  const amountError = { error: '金額必須是 0 到 1,000,000 的整數' };
  if (tx.type === 'order') {
    const mealPrice = parseAmount(edit.mealPriceText, null);
    const paidAmount = parseAmount(edit.paidAmountText, 0);
    if (mealPrice === null || paidAmount === null) return amountError;
    return { kind: 'CorrectTransaction', payload: { mealPrice, paidAmount, amount: paidAmount - mealPrice, note, reason } };
  }
  if (tx.type === 'payment') {
    const paidAmount = parseAmount(edit.paidAmountText, null);
    if (paidAmount === null) return amountError;
    return { kind: 'CorrectTransaction', payload: { mealPrice: 0, paidAmount, amount: paidAmount, note, reason } };
  }
  const value = parseAmount(edit.amountText, null);
  if (value === null) return amountError;
  if (tx.type === 'refund') {
    return { kind: 'CorrectTransaction', payload: { mealPrice: 0, paidAmount: 0, amount: value, note, reason } };
  }
  const income = tx.paidAmount > 0;
  const mealPrice = income ? 0 : value;
  const paidAmount = income ? value : 0;
  return { kind: 'CorrectTransaction', payload: { mealPrice, paidAmount, amount: paidAmount - mealPrice, note, reason } };
}

interface MutationPreview {
  cashDelta: number;
  reasonKind: string;
  balanceBefore: number | null;
  balanceAfter: number | null;
}

/** Same arithmetic as Rules (shared module), so the preview shows exactly what the server will accept. */
function previewMutation(
  tx: CloudOrderTransactionRecord,
  mutation: TransactionMutationPayload,
  student: CloudStudentRecord | null,
): MutationPreview | { error: string } {
  try {
    const after = applyTransactionMutation(tx, mutation);
    const effect = mutationCashEffect(mutation.kind, tx, after);
    const balanceAfter = student ? student.currentBalance - studentContribution(tx) + studentContribution(after) : null;
    if (tx.type === 'refund' && balanceAfter !== null && balanceAfter < 0) {
      return { error: `退款更正後帳戶餘額會變成 $${balanceAfter}，不能是負數` };
    }
    return { cashDelta: effect.delta, reasonKind: effect.reasonKind, balanceBefore: student?.currentBalance ?? null, balanceAfter };
  } catch (error) {
    return { error: error instanceof Error ? error.message : '這筆交易不能這樣修改' };
  }
}

const REASON_KIND_TEXT: Record<string, string> = {
  correction: '（帳本更正）',
  refund: '（退還現金給學生）',
  reversal: '（沖回）',
  none: '',
};

function recentSummary(transactions: CloudOrderTransactionRecord[]): string {
  const bento = transactions.filter(tx => tx.type === 'order' && tx.mealKind === 'bento').length;
  const other = transactions.filter(tx => tx.type === 'order' && tx.mealKind === 'other').length;
  if (bento > 0 && other > 0) return `今日餐點 ${bento}・其他餐點 ${other}`;
  if (bento > 0) return `今日餐點 ${bento}`;
  if (other > 0) return `其他餐點 ${other}`;
  const payments = transactions.some(tx => tx.type === 'payment');
  const refunds = transactions.some(tx => tx.type === 'refund');
  if (refunds) return payments ? '繳費・退款' : '僅退款';
  return '僅繳費';
}

export function CloudOrdersPage({ db, leaseEpoch, identityKey, onNavigationStateChange, initialBackfillDayId }: CloudOrdersPageProps) {
  const recoveryReader = useMemo(() => getCloudRecoveryReader(db), [db]);
  const repository = useMemo(() => createCloudOrderRepository(db, { recoveryReader }), [db, recoveryReader]);
  // Which business day the page reads: null is the server's today. Commands refresh through the same ref.
  const viewDayRef = useRef<string | null>(initialBackfillDayId ?? null);
  const backfillDaysRef = useRef<CloudBackfillDay[] | null>(null);
  const generationRef = useRef(0);
  const loadRequestRef = useRef(0);
  const flightRef = useRef(false);
  const revokedRef = useRef(false);
  const operationRef = useRef<OrdersRecoveryOperation | null>(null);
  const recoveryTokenRef = useRef(0);
  const renderedOwnerRef = useRef({ db, app: db.app, identityKey, leaseEpoch, version: 0 });
  const renderedOwner = renderedOwnerRef.current;
  if (renderedOwner.db !== db || renderedOwner.app !== db.app
    || renderedOwner.identityKey !== identityKey || renderedOwner.leaseEpoch !== leaseEpoch) {
    const activeOperation = operationRef.current;
    if (activeOperation?.timer !== null && activeOperation?.timer !== undefined) window.clearTimeout(activeOperation.timer);
    if (activeOperation) activeOperation.completed = true;
    operationRef.current = null;
    flightRef.current = false;
    renderedOwnerRef.current = { db, app: db.app, identityKey, leaseEpoch, version: renderedOwner.version + 1 };
  }
  const scopeKey = `${identityKey}:${leaseEpoch}:${renderedOwnerRef.current.version}`;
  const [pageState, setPageStateRaw] = useState<OrdersPageState>(() => initialState(scopeKey));
  const scopeRef = useRef(scopeKey);
  const searchInputRef = useRef<HTMLInputElement>(null);

  if (scopeRef.current !== scopeKey) {
    scopeRef.current = scopeKey;
    generationRef.current += 1;
    loadRequestRef.current += 1;
    flightRef.current = false;
    revokedRef.current = false;
    viewDayRef.current = null;
  }

  const page = pageState.scopeKey === scopeKey ? pageState : initialState(scopeKey);
  const snapshotRef = useRef(page.snapshot);
  snapshotRef.current = page.snapshot;

  const isCurrent = useCallback((key: string, generation: number) => (
    scopeRef.current === key && generationRef.current === generation
  ), []);

  const isOperationOwnerCurrent = useCallback((operation: OrdersRecoveryOperation) => (
    scopeRef.current === operation.scopeKey
      && generationRef.current === operation.generation
      && renderedOwnerRef.current.db === operation.db
      && renderedOwnerRef.current.app === operation.app
      && renderedOwnerRef.current.identityKey === operation.identityKey
      && renderedOwnerRef.current.leaseEpoch === operation.leaseEpoch
      && identityKey === operation.identityKey
      && leaseEpoch === operation.leaseEpoch
      && (snapshotRef.current === null || snapshotRef.current.datasetId === operation.datasetId)
      && !revokedRef.current
  ), [identityKey, leaseEpoch]);

  const isOperationCurrent = useCallback((operation: OrdersRecoveryOperation) => (
    operationRef.current === operation && !operation.completed && isOperationOwnerCurrent(operation)
  ), [isOperationOwnerCurrent]);

  const updateFor = useCallback((key: string, generation: number, update: (previous: OrdersPageState) => OrdersPageState) => {
    setPageStateRaw(previous => {
      if (!isCurrent(key, generation)) return previous;
      return update(previous.scopeKey === key ? previous : initialState(key));
    });
  }, [isCurrent]);

  const revoke = useCallback((key: string, generation: number, error: unknown, pendingCommandId: string | null) => {
    if (!isCurrent(key, generation)) return;
    // Invalidate every in-flight read and command before React commits the masked state.
    const activeOperation = operationRef.current;
    if (activeOperation && activeOperation.scopeKey === key) {
      if (activeOperation.timer !== null) window.clearTimeout(activeOperation.timer);
      activeOperation.timer = null;
      activeOperation.completed = true;
      operationRef.current = null;
    }
    revokedRef.current = true;
    generationRef.current += 1;
    loadRequestRef.current += 1;
    flightRef.current = false;
    onNavigationStateChange?.(identityKey, 'revoked');
    setPageStateRaw(previous => {
      if (previous.scopeKey !== key) return previous;
      return {
        ...initialState(key),
        authorizationRevoked: true,
        loading: false,
        loadError: errorText(error),
        actionError: pendingCommandId
          ? `命令 ${pendingCommandId} 的結果尚未確認，勿重新收款。重新取得使用權後會用同一編號查詢。`
          : '',
      };
    });
  }, [identityKey, isCurrent, onNavigationStateChange]);

  const loadSnapshot = useCallback(async (
    options: { keepDraft?: boolean; notice?: string; actionError?: string; dayId?: string | null; reuseBackfillDays?: boolean } = {},
  ): Promise<boolean> => {
    const key = scopeKey;
    const generation = generationRef.current;
    if (revokedRef.current) return false;
    const requestId = ++loadRequestRef.current;
    if (options.dayId !== undefined) viewDayRef.current = options.dayId;
    const dayId = viewDayRef.current;
    snapshotRef.current = null;
    updateFor(key, generation, previous => ({
      ...previous,
      snapshot: null,
      loading: true,
      loadError: '',
      viewDayId: dayId,
      ...(options.keepDraft ? {} : freshDraft()),
      confirmDuplicateOpen: false,
      paymentDetailsOpen: false,
      notice: options.notice ?? '',
      actionError: options.actionError ?? '',
    }));
    try {
      // After a counter operation the days being backfilled cannot have changed on this page, so the list is reused.
      const known = options.reuseBackfillDays ? backfillDaysRef.current : null;
      const snapshot = await repository.loadSnapshot({ dayId, ...(known ? { knownBackfillDays: known } : {}) });
      if (!isCurrent(key, generation) || requestId !== loadRequestRef.current) return false;
      const activeOperation = operationRef.current;
      if (activeOperation?.receiptConfirmed && activeOperation.datasetId !== snapshot.datasetId) {
        snapshotRef.current = null;
        updateFor(key, generation, previous => ({
          ...previous,
          ...freshDraft(),
          snapshot: null,
          loading: false,
          loadError: '已確認命令所屬的資料集已變更；請重新取得使用權並查證，不要再次送出原操作。',
        }));
        return false;
      }
      backfillDaysRef.current = snapshot.backfillDaysError === null ? snapshot.backfillDays : null;
      snapshotRef.current = snapshot;
      updateFor(key, generation, previous => ({
        ...previous,
        snapshot,
        loading: false,
        loadError: '',
        selectedStudentId: snapshot.students.some(student => student.studentId === previous.selectedStudentId)
          ? previous.selectedStudentId
          : null,
      }));
      return true;
    } catch (error) {
      if (!isCurrent(key, generation) || requestId !== loadRequestRef.current) return false;
      snapshotRef.current = null;
      if (isAuthorizationLoss(error)) {
        revoke(key, generation, error, null);
        return false;
      }
      updateFor(key, generation, previous => ({
        ...previous,
        ...freshDraft(),
        snapshot: null,
        loading: false,
        loadError: errorText(error),
      }));
      return false;
    }
  }, [isCurrent, repository, revoke, scopeKey, updateFor]);

  useEffect(() => {
    const generation = ++generationRef.current;
    revokedRef.current = false;
    backfillDaysRef.current = null;
    setPageStateRaw(initialState(scopeKey));
    if (!identityKey) {
      onNavigationStateChange?.(identityKey, 'revoked');
      return;
    }
    void loadSnapshot();
    return () => {
      loadRequestRef.current += 1;
      const activeOperation = operationRef.current;
      if (activeOperation?.scopeKey === scopeKey) {
        if (activeOperation.timer !== null) window.clearTimeout(activeOperation.timer);
        activeOperation.timer = null;
        activeOperation.completed = true;
        operationRef.current = null;
        flightRef.current = false;
      }
      if (generationRef.current === generation) generationRef.current += 1;
    };
    // loadSnapshot is stable per scope; re-run only when the identity/lease scope changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  const hasRecovery = page.recovery !== null;
  useEffect(() => {
    if (!identityKey) return;
    onNavigationStateChange?.(identityKey, page.authorizationRevoked ? 'revoked' : hasRecovery ? 'recovering' : 'resolved');
  }, [hasRecovery, identityKey, onNavigationStateChange, page.authorizationRevoked]);

  const snapshot = page.snapshot;
  const today = snapshot?.today ?? '';
  // The day every row, total and command on the page belongs to: today, or a backfill day (contract §13).
  const businessDate = snapshot?.businessDate ?? today;
  const backfill = snapshot?.backfill ?? null;
  const backfillView = backfill !== null;
  const dayWord = backfillView ? '這一天' : '今日';
  const day = snapshot?.day ?? null;
  const todayMenu = day?.menu ?? null;
  const txBackfilled = (tx: CloudOrderTransactionRecord) => (
    backfill !== null && isBackfilled({ businessDate: tx.businessDate, createdAt: new Date(tx.createdAt) }, backfill)
  );
  const activeTransactions = useMemo(
    () => (snapshot?.transactions ?? []).filter(tx => tx.status === 'active'),
    [snapshot],
  );
  const allTransactions = useMemo(() => snapshot?.transactions ?? [], [snapshot]);
  const studentsById = useMemo(
    () => new Map((snapshot?.students ?? []).map(student => [student.studentId, student])),
    [snapshot],
  );
  const selectedStudent = page.selectedStudentId ? studentsById.get(page.selectedStudentId) ?? null : null;
  const selectedTransactions = useMemo(
    () => activeTransactions.filter(tx => tx.studentId === page.selectedStudentId),
    [activeTransactions, page.selectedStudentId],
  );
  const selectedAllTransactions = useMemo(
    () => allTransactions.filter(tx => tx.studentId === page.selectedStudentId),
    [allTransactions, page.selectedStudentId],
  );
  const selectedOrderCount = selectedTransactions.filter(tx => tx.type === 'order').length;

  const filteredStudents = useMemo(() => {
    const q = page.search.trim().toLowerCase();
    if (!q || !snapshot) return [];
    const norm = normalizeStudentCode(q);
    const normCode = norm.ok ? norm.code : '';
    return snapshot.students.filter(student =>
      (normCode && student.studentCode === normCode)
      || student.studentCode.includes(q)
      || student.displayName.toLowerCase().includes(q)
      || student.aliases.some(alias => alias.toLowerCase().includes(q)));
  }, [page.search, snapshot]);

  const recentAccounts = useMemo(() => {
    const seen = new Set<string>();
    const items: Array<{ student: CloudStudentRecord; summary: string }> = [];
    for (let index = activeTransactions.length - 1; index >= 0; index -= 1) {
      const studentId = activeTransactions[index].studentId;
      if (seen.has(studentId)) continue;
      seen.add(studentId);
      const student = studentsById.get(studentId);
      if (!student) continue;
      items.push({ student, summary: recentSummary(activeTransactions.filter(tx => tx.studentId === studentId)) });
    }
    return items;
  }, [activeTransactions, studentsById]);

  const orderingBlocked = !snapshot ? '雲端資料尚未載入'
    : businessDate < snapshot.goLiveDate ? `伺服器營業日 ${businessDate} 早於系統啟用日期 ${snapshot.goLiveDate}，不能訂餐`
      : !day ? `${dayWord}（${businessDate}）營業日尚未建立，請先到「日期與供應商」建立營業日`
        : day.status === 'closed' ? `${dayWord}已關帳，不能訂餐、繳費或新增櫃台收支`
          : backfillView && day.lastSettlementRevision > 0 ? `${businessDate} 已經關過帳，不能再用回填補登；請回到今天作業`
            : '';

  // Inactive accounts can still pay (spec §6.1) but never order, whatever mode was last chosen.
  const mode: EntryMode = selectedStudent?.status === 'inactive' ? 'payment' : page.mode;
  const mealPrice = mode === 'payment' ? 0
    : mode === 'bento' ? todayMenu?.price ?? null : parseAmount(page.otherPriceText, null);
  const paidAmount = parseAmount(page.paidAmountText, mode === 'payment' ? null : 0);
  const busy = page.recovery !== null || operationRef.current !== null;
  const previewBalance = selectedStudent && mealPrice !== null && paidAmount !== null
    ? selectedStudent.currentBalance + paidAmount - mealPrice
    : null;
  const cashierRows = useMemo(() => allTransactions.filter(tx => tx.type === 'expense'), [allTransactions]);
  const cashPosition = day ? expectedCashFromTotals(day.openingCash, day.totals) : null;
  const cashAmount = parseAmount(page.cashAmountText, null);
  const refundAmount = parseAmount(page.refundAmountText, null);
  const refundValid = selectedStudent !== null && refundAmount !== null && refundAmount >= 1
    && refundAmount <= selectedStudent.currentBalance;
  const refundPreviewBalance = selectedStudent && refundValid ? selectedStudent.currentBalance - refundAmount! : null;

  const selectStudent = (student: CloudStudentRecord) => {
    if (operationRef.current) return;
    setPageStateRaw(previous => ({
      ...previous,
      selectedStudentId: student.studentId,
      search: '',
      actionError: '',
      notice: '',
      cashOpen: false,
      refundOpen: false,
      refundAmountText: '',
      refundReason: '',
      refundConfirmOpen: false,
      mode: student.status === 'inactive' ? 'payment' : previous.mode,
    }));
  };

  const cancelSelection = useCallback(() => {
    if (operationRef.current || pageState.recovery) return;
    setPageStateRaw(previous => ({ ...previous, ...freshDraft(), actionError: '' }));
    searchInputRef.current?.focus();
  }, [pageState.recovery]);

  const updateRecoveryView = (operation: OrdersRecoveryOperation, update: (view: RecoveryView) => RecoveryView) => {
    if (!isOperationCurrent(operation)) return;
    updateFor(operation.scopeKey, operation.generation, previous => (
      previous.recovery?.command.commandId === operation.command.commandId
        ? { ...previous, recovery: update(previous.recovery) }
        : previous
    ));
  };

  const clearOperationTimer = (operation: OrdersRecoveryOperation) => {
    if (operation.timer !== null) {
      window.clearTimeout(operation.timer);
      operation.timer = null;
    }
  };

  const completeSuccess = async (operation: OrdersRecoveryOperation, receipt: CommandReceipt) => {
    if (!isOperationCurrent(operation) || receipt.commandId !== operation.command.commandId) return;
    if (operation.receiptConfirmed) return;
    operation.receiptConfirmed = true;
    operation.receipt = receipt;
    operation.receiptQueryPending = false;
    operation.refreshInFlight = true;
    operation.completionToken = ++recoveryTokenRef.current;
    const completionToken = operation.completionToken;
    clearOperationTimer(operation);

    updateRecoveryView(operation, previous => ({
      ...previous,
      phase: 'confirmed',
      elapsed10s: true,
      queryPending: false,
      queryStatus: '',
      queryMessage: '',
      retryAllowed: false,
    }));

    // The server context and receipt have already been verified outside the journal's Web Lock.
    // Only this short local removal uses the synchronous current-owner predicate.
    const record: PendingCommandIdentity = {
      commandId: operation.command.commandId,
      datasetId: operation.datasetId,
      uid: operation.uid,
    };
    const cleanupJournalIdentity = async (): Promise<boolean> => {
      try {
        const journal = cloudPendingJournalForRepository(operation.db);
        const removed = await journal.removeIf(record, () => (
          operationRef.current === operation
            && operation.completionToken === completionToken
            && isOperationOwnerCurrent(operation)
            && (typeof navigator === 'undefined' || navigator.onLine)
        ));
        if (operationRef.current !== operation || operation.completionToken !== completionToken
          || !isOperationOwnerCurrent(operation)) return false;
        if (removed) return false;
        const remaining = await journal.readAll();
        if (operationRef.current !== operation || operation.completionToken !== completionToken
          || !isOperationOwnerCurrent(operation)) return false;
        return remaining.records.some(item => (
          item.commandId === record.commandId && item.datasetId === record.datasetId && item.uid === record.uid
        ));
      } catch {
        if (operationRef.current !== operation || operation.completionToken !== completionToken
          || !isOperationOwnerCurrent(operation)) return false;
        return true;
      }
    };

    const [cleanupPending, headsReady] = await Promise.all([
      cleanupJournalIdentity(),
      loadSnapshot({ reuseBackfillDays: true }),
    ]);
    if (operationRef.current !== operation || operation.completionToken !== completionToken
      || !isOperationOwnerCurrent(operation)) return;
    operation.cleanupPending = cleanupPending;
    operation.refreshInFlight = false;
    if (headsReady) finishConfirmedOperation(operation, receipt);
  };

  const finishConfirmedOperation = (operation: OrdersRecoveryOperation, receipt: CommandReceipt) => {
    if (!isOperationCurrent(operation) || !operation.receiptConfirmed
      || receipt.commandId !== operation.command.commandId) return;
    const command = operation.command;
    // Rules refuse Undo outside today, so a backfilled row is corrected or voided instead of offering a 5-second undo.
    const undoOffer: UndoOffer | null = command.kind === 'mutation' || operation.backfillView ? null : {
      commandId: command.commandId,
      transactionId: command.transactionId,
      label: `${command.label} 的${commandNoun(command)}`,
      expiresAt: Date.now() + UNDO_WINDOW_MS,
    };
    operation.completed = true;
    clearOperationTimer(operation);
    operationRef.current = null;
    flightRef.current = false;
    updateFor(operation.scopeKey, operation.generation, previous => ({
      ...previous,
      recovery: null,
      undoOffer,
      notice: successText(command, receipt.seq),
      actionError: operation.cleanupPending
        ? '伺服器已確認入帳，但本機待核對編號尚未清除；請保留編號並勿重新收款。'
        : '',
    }));
  };

  const retryConfirmedSnapshot = async () => {
    const operation = operationRef.current;
    const receipt = operation?.receipt;
    if (!operation || !receipt || !isOperationCurrent(operation) || operation.refreshInFlight) return;
    operation.refreshInFlight = true;
    const headsReady = await loadSnapshot({ reuseBackfillDays: true });
    if (!isOperationCurrent(operation)) return;
    operation.refreshInFlight = false;
    if (headsReady) finishConfirmedOperation(operation, receipt);
  };

  const invalidateOperation = (operation: OrdersRecoveryOperation, error: unknown) => {
    if (operation.timer !== null) window.clearTimeout(operation.timer);
    operation.timer = null;
    operation.completed = true;
    if (operationRef.current === operation) operationRef.current = null;
    flightRef.current = false;
    revoke(operation.scopeKey, operation.generation, error, operation.command.commandId);
  };

  const finishAttempt = async (operation: OrdersRecoveryOperation, result: CommandResult, isRetry: boolean) => {
    operation.attemptPromisePending = false;
    if (!isRetry) operation.originalPromisePending = false;
    if (!isOperationCurrent(operation)) return;
    flightRef.current = operation.originalPromisePending || operation.attemptPromisePending;
    if (operation.receiptConfirmed) return;

    if (result.ok && result.receipt.commandId === operation.command.commandId) {
      await completeSuccess(operation, result.receipt);
      return;
    }
    if (!result.ok && isAuthorizationLoss(result.error)) {
      invalidateOperation(operation, result.error);
      return;
    }
    if (result.ok || result.error.code === 'UNKNOWN_RESULT' || result.error.code === 'OFFLINE') {
      updateRecoveryView(operation, previous => ({
        ...previous,
        phase: 'unknown',
        queryPending: false,
        queryStatus: '',
        queryMessage: '',
        retryAllowed: false,
      }));
      return;
    }

    // A definite rejection means no command was committed; reload server revisions before another business action.
    operation.completed = true;
    clearOperationTimer(operation);
    if (operationRef.current === operation) operationRef.current = null;
    updateFor(operation.scopeKey, operation.generation, previous => ({ ...previous, recovery: null }));
    await loadSnapshot({
      keepDraft: true,
      actionError: definiteFailureText(operation.command, result.error.code, result.error.message),
    });
  };

  const runAttempt = async (operation: OrdersRecoveryOperation, isRetry: boolean) => {
    if (!isOperationCurrent(operation) || operation.attemptPromisePending) return;
    operation.attemptPromisePending = true;
    operation.retryAuthorizedQueryVersion = null;
    flightRef.current = true;
    updateRecoveryView(operation, previous => ({
      ...previous,
      phase: isRetry ? 'retrying' : 'submitting',
      queryPending: false,
      queryStatus: '',
      queryMessage: '',
      retryAllowed: false,
    }));
    let result: CommandResult;
    try {
      result = await sendCommand(repository, operation.command, operation.leaseEpoch);
    } catch (error) {
      result = { ok: false, error: { code: isAuthorizationLoss(error) ? 'LEASE_LOST' : 'UNKNOWN_RESULT', message: errorText(error) } };
    }
    await finishAttempt(operation, result, isRetry);
  };

  const dispatch = (untrustedCommand: PreparedCommand) => {
    const generation = generationRef.current;
    if (operationRef.current || flightRef.current || revokedRef.current) return;
    const uid = uidFromIdentityKey(identityKey, leaseEpoch);
    const currentSnapshot = snapshotRef.current;
    if (!identityKey || !uid || !Number.isSafeInteger(leaseEpoch) || leaseEpoch < 1
      || !currentSnapshot || currentSnapshot.datasetId !== untrustedCommand.datasetId) {
      revoke(scopeKey, generation, { code: 'LEASE_LOST' }, untrustedCommand.commandId);
      return;
    }
    const command = freezePreparedCommand(untrustedCommand);
    const operation: OrdersRecoveryOperation = {
      token: ++recoveryTokenRef.current,
      completionToken: 0,
      command,
      db,
      app: db.app,
      identityKey,
      uid,
      leaseEpoch,
      datasetId: currentSnapshot.datasetId,
      scopeKey,
      generation,
      originalPromisePending: true,
      attemptPromisePending: false,
      receiptQueryPending: false,
      receiptConfirmed: false,
      receipt: null,
      refreshInFlight: false,
      cleanupPending: false,
      backfillView,
      receiptQueryVersion: 0,
      retryAuthorizedQueryVersion: null,
      elapsed10s: false,
      completed: false,
      timer: null,
    };
    operationRef.current = operation;
    flightRef.current = true;
    onNavigationStateChange?.(identityKey, 'recovering');
    updateFor(scopeKey, generation, previous => ({
      ...previous,
      actionError: '',
      notice: '',
      confirmDuplicateOpen: false,
      refundConfirmOpen: false,
      undoOffer: null,
      recovery: {
        command,
        phase: 'submitting',
        elapsed10s: false,
        queryPending: false,
        queryStatus: '',
        queryMessage: '',
        retryAllowed: false,
      },
    }));
    operation.timer = window.setTimeout(() => {
      if (!isOperationCurrent(operation)) return;
      operation.elapsed10s = true;
      updateRecoveryView(operation, previous => ({ ...previous, elapsed10s: true }));
    }, 10_000);
    void runAttempt(operation, false);
  };

  const queryRecovery = async () => {
    const operation = operationRef.current;
    if (!operation || operation.receiptConfirmed || !isOperationCurrent(operation) || operation.receiptQueryPending
      || (!operation.elapsed10s && operation.originalPromisePending)) return;
    operation.receiptQueryPending = true;
    const queryVersion = ++operation.receiptQueryVersion;
    const retryEligibleWhenStarted = !operation.attemptPromisePending;
    operation.retryAuthorizedQueryVersion = null;
    updateRecoveryView(operation, previous => ({
      ...previous,
      queryPending: true,
      queryStatus: '',
      queryMessage: '',
      retryAllowed: false,
    }));
    const record: PendingCommandIdentity = {
      commandId: operation.command.commandId,
      datasetId: operation.datasetId,
      uid: operation.uid,
    };
    try {
      const context = await repository.getPendingRecoveryContextWithRecoveryReader(operation.leaseEpoch);
      if (!isOperationCurrent(operation) || operation.receiptQueryVersion !== queryVersion) return;
      if (context.uid !== operation.uid || context.leaseEpoch !== operation.leaseEpoch
        || context.datasetId !== operation.datasetId) {
        invalidateOperation(operation, { code: 'LEASE_LOST' });
        return;
      }
      const checked: PendingReceiptCheck = await repository.confirmPendingWithRecoveryReader(record, operation.leaseEpoch);
      if (!isOperationCurrent(operation) || operation.receiptQueryVersion !== queryVersion) return;
      if (checked.status === 'different-dataset') {
        invalidateOperation(operation, { code: 'LEASE_LOST' });
        return;
      }
      if (checked.status === 'matched') {
        if (checked.receipt.commandId !== operation.command.commandId) {
          operation.receiptQueryPending = false;
          updateRecoveryView(operation, previous => ({
            ...previous,
            queryPending: false,
            queryStatus: 'error',
            queryMessage: '伺服器回傳的命令編號不一致；已保留原編號，請勿重新收款。',
            retryAllowed: false,
          }));
          return;
        }
        await completeSuccess(operation, checked.receipt);
        return;
      }
      operation.receiptQueryPending = false;
      const canRetry = retryEligibleWhenStarted && !operation.attemptPromisePending && !context.maintenance;
      operation.retryAuthorizedQueryVersion = canRetry ? queryVersion : null;
      updateRecoveryView(operation, previous => ({
        ...previous,
        queryPending: false,
        queryStatus: context.maintenance ? 'error' : canRetry ? 'not-found-settled' : 'not-found-pending',
        queryMessage: context.maintenance
          ? '系統正在維護，請稍後重新查詢；保留命令編號，勿重新收款。'
          : canRetry
            ? '伺服器目前未查到；這不代表確定未入帳。保留編號後，可明確選擇以原編號重試。'
            : '伺服器目前未查到；原操作仍待回應或重試仍在進行，請勿再次送出。',
        retryAllowed: canRetry,
      }));
    } catch (error) {
      if (!isOperationCurrent(operation) || operation.receiptQueryVersion !== queryVersion) return;
      if (isAuthorizationLoss(error)) {
        invalidateOperation(operation, error);
        return;
      }
      operation.receiptQueryPending = false;
      const code = errorCode(error);
      const message = code === 'MAINTENANCE'
        ? '系統正在維護，請稍後重新查詢；保留命令編號，勿重新收款。'
        : code === 'QUOTA_EXCEEDED'
          ? '雲端額度不足，目前無法查詢結果；稍後再查詢，勿重新收款。'
          : '目前無法安全確認伺服器結果；保留原編號，勿重新收款。';
      updateRecoveryView(operation, previous => ({
        ...previous,
        queryPending: false,
        queryStatus: 'error',
        queryMessage: message,
        retryAllowed: false,
      }));
    }
  };

  const submitOrder = () => {
    if (!snapshot || !day || !selectedStudent || busy || operationRef.current || orderingBlocked) return;
    if (selectedStudent.status !== 'active') {
      setPageStateRaw(previous => ({ ...previous, confirmDuplicateOpen: false, actionError: '此帳戶已停用，禁止新增餐點' }));
      return;
    }
    if (mode === 'payment') return;
    if (mode === 'bento' && !todayMenu) {
      setPageStateRaw(previous => ({
        ...previous,
        confirmDuplicateOpen: false,
        actionError: backfillView ? '這一天尚未設定菜單，無法訂購當日餐點；請到「日期與供應商」選這一天設定菜單，或登記其他餐點' : '今日尚未設定菜單，無法訂購今日餐點',
      }));
      return;
    }
    const otherItemName = page.otherItemName.trim();
    if (mode === 'other' && (!otherItemName || otherItemName.length > 100)) {
      setPageStateRaw(previous => ({ ...previous, confirmDuplicateOpen: false, actionError: '其他餐點品名必填且不能超過 100 字' }));
      return;
    }
    if (mealPrice === null) {
      setPageStateRaw(previous => ({ ...previous, confirmDuplicateOpen: false, actionError: '餐點單價必須是 0 到 1,000,000 的整數' }));
      return;
    }
    if (paidAmount === null) {
      setPageStateRaw(previous => ({ ...previous, confirmDuplicateOpen: false, actionError: '實收金額必須是 0 到 1,000,000 的整數' }));
      return;
    }
    const composed = composePaperRefNote({ paperRef: page.paperRefText, text: page.note, required: backfillView });
    if (!composed.ok) {
      setPageStateRaw(previous => ({ ...previous, confirmDuplicateOpen: false, actionError: composed.error }));
      return;
    }
    const commandId = newId();
    const transactionId = newId();
    if (!commandId || !transactionId) {
      setPageStateRaw(previous => ({ ...previous, confirmDuplicateOpen: false, actionError: '此瀏覽器無法產生安全的命令編號，未送出。' }));
      return;
    }
    const command: PreparedCommand = {
      kind: 'order',
      commandId,
      transactionId,
      studentId: selectedStudent.studentId,
      dayId: businessDate,
      expectedStudentRevision: selectedStudent.revision,
      expectedDayRevision: day.revision,
      mealKind: mode,
      mealPrice,
      paidAmount,
      menuRevision: mode === 'bento' ? todayMenu!.revision : null,
      otherItemName: mode === 'other' ? otherItemName : null,
      note: composed.note,
      label: `${selectedStudent.studentCode} ${selectedStudent.displayName}`,
      datasetId: snapshot.datasetId,
    };
    dispatch(command);
  };

  const submitPayment = () => {
    if (!snapshot || !day || !selectedStudent || busy || operationRef.current || orderingBlocked) return;
    const amount = parseAmount(page.paidAmountText, null);
    if (page.paidAmountText.trim().startsWith('-')) {
      setPageStateRaw(previous => ({ ...previous, actionError: '收款金額不能是負數。要退錢給學生請用「退款」。' }));
      return;
    }
    if (amount === null || amount < 1) {
      setPageStateRaw(previous => ({ ...previous, actionError: '繳費金額必須是 1 到 1,000,000 的整數' }));
      return;
    }
    const composed = composePaperRefNote({ paperRef: page.paperRefText, text: page.note, required: backfillView });
    if (!composed.ok) {
      setPageStateRaw(previous => ({ ...previous, actionError: composed.error }));
      return;
    }
    const commandId = newId();
    const transactionId = newId();
    if (!commandId || !transactionId) {
      setPageStateRaw(previous => ({ ...previous, actionError: '此瀏覽器無法產生安全的命令編號，未送出。' }));
      return;
    }
    const command: PreparedCommand = {
      kind: 'payment',
      commandId,
      transactionId,
      studentId: selectedStudent.studentId,
      dayId: businessDate,
      expectedStudentRevision: selectedStudent.revision,
      expectedDayRevision: day.revision,
      paidAmount: amount,
      note: composed.note,
      label: `${selectedStudent.studentCode} ${selectedStudent.displayName}`,
      datasetId: snapshot.datasetId,
    };
    dispatch(command);
  };

  const submitCashMovement = (event?: FormEvent) => {
    event?.preventDefault();
    if (!snapshot || !day || busy || operationRef.current || orderingBlocked) return;
    if (cashAmount === null || cashAmount < 1) {
      setPageStateRaw(previous => ({ ...previous, actionError: '櫃台收支金額必須是 1 到 1,000,000 的整數' }));
      return;
    }
    const reason = page.cashReason.trim();
    if (!reason || reason.length > 500) {
      setPageStateRaw(previous => ({ ...previous, actionError: '櫃台收支原因必填，且不能超過 500 字' }));
      return;
    }
    const composed = composePaperRefNote({ paperRef: page.cashPaperRefText, text: reason, required: backfillView });
    if (!composed.ok) {
      setPageStateRaw(previous => ({ ...previous, actionError: composed.error }));
      return;
    }
    const commandId = newId();
    const transactionId = newId();
    if (!commandId || !transactionId) {
      setPageStateRaw(previous => ({ ...previous, actionError: '此瀏覽器無法產生安全的命令編號，未送出。' }));
      return;
    }
    const direction = page.cashDirection;
    const command: PreparedCommand = {
      kind: 'cash',
      commandId,
      transactionId,
      dayId: businessDate,
      expectedDayRevision: day.revision,
      direction,
      amount: cashAmount,
      reason: composed.note,
      label: `櫃台${direction === 'income' ? '收入' : '支出'} $${cashAmount}`,
      datasetId: snapshot.datasetId,
    };
    dispatch(command);
  };

  /** 驗證退款框；通過才打開確認對話框（spec §7.2：退款一律先確認）。 */
  const requestRefund = (event?: FormEvent) => {
    event?.preventDefault();
    if (!snapshot || !day || !selectedStudent || busy || operationRef.current || orderingBlocked || backfillView) return;
    if (selectedStudent.currentBalance < 1) {
      setPageStateRaw(previous => ({ ...previous, refundConfirmOpen: false, actionError: '帳戶餘額不是正數，沒有可退的金額' }));
      return;
    }
    if (refundAmount === null || refundAmount < 1 || refundAmount > selectedStudent.currentBalance) {
      setPageStateRaw(previous => ({
        ...previous,
        refundConfirmOpen: false,
        actionError: `退款金額必須是 1 到 ${selectedStudent.currentBalance} 的整數（不能超過目前餘額）`,
      }));
      return;
    }
    const reason = page.refundReason.trim();
    if (!reason || reason.length > 500) {
      setPageStateRaw(previous => ({ ...previous, refundConfirmOpen: false, actionError: '退款原因必填，且不能超過 500 字' }));
      return;
    }
    setPageStateRaw(previous => ({ ...previous, actionError: '', refundConfirmOpen: true }));
  };

  const submitRefund = () => {
    if (!snapshot || !day || !selectedStudent || busy || operationRef.current || orderingBlocked || backfillView || !refundValid) return;
    const reason = page.refundReason.trim();
    if (!reason || reason.length > 500) return;
    const commandId = newId();
    const transactionId = newId();
    if (!commandId || !transactionId) {
      setPageStateRaw(previous => ({ ...previous, refundConfirmOpen: false, actionError: '此瀏覽器無法產生安全的命令編號，未送出。' }));
      return;
    }
    const command: PreparedCommand = {
      kind: 'refund',
      commandId,
      transactionId,
      studentId: selectedStudent.studentId,
      dayId: businessDate,
      expectedStudentRevision: selectedStudent.revision,
      expectedDayRevision: day.revision,
      amount: refundAmount!,
      reason,
      label: `${selectedStudent.studentCode} ${selectedStudent.displayName}`,
      datasetId: snapshot.datasetId,
    };
    dispatch(command);
  };

  /** Freezes one mutation of an existing row with the revisions this screen last read (spec §6.2). */
  const submitMutation = (tx: CloudOrderTransactionRecord, mutation: TransactionMutationPayload, label: string): boolean => {
    if (!snapshot || !day || busy || operationRef.current || orderingBlocked) return false;
    const student = tx.studentId === CASHIER_ID ? null : studentsById.get(tx.studentId) ?? null;
    if (tx.studentId !== CASHIER_ID && !student) {
      setPageStateRaw(previous => ({ ...previous, actionError: '找不到這筆交易的帳戶，請重新載入。' }));
      return false;
    }
    const commandId = newId();
    if (!commandId) {
      setPageStateRaw(previous => ({ ...previous, actionError: '此瀏覽器無法產生安全的命令編號，未送出。' }));
      return false;
    }
    const command: PreparedCommand = {
      kind: 'mutation',
      commandId,
      input: {
        commandId,
        transactionId: tx.transactionId,
        studentId: tx.studentId,
        dayId: tx.businessDate,
        expectedTransactionRevision: tx.revision,
        expectedStudentRevision: student ? student.revision : null,
        expectedDayRevision: day.revision,
        ...mutation,
      } as Omit<CloudTransactionMutationInput, 'leaseEpoch'>,
      label,
      datasetId: snapshot.datasetId,
    };
    dispatch(command);
    return true;
  };

  const undoTransaction = page.undoOffer
    ? allTransactions.find(tx => tx.transactionId === page.undoOffer!.transactionId && tx.status === 'active') ?? null
    : null;
  const undoMutation: TransactionMutationPayload | null = page.undoOffer
    ? { kind: 'Undo', payload: { targetCommandId: page.undoOffer.commandId, reason: UNDO_REASON } }
    : null;
  const undoPreview = undoTransaction && undoMutation
    ? previewMutation(undoTransaction, undoMutation, studentsById.get(undoTransaction.studentId) ?? null)
    : null;

  const undoLast = () => {
    const offer = page.undoOffer;
    if (!offer || !undoTransaction || !undoMutation || operationRef.current) return;
    if (Date.now() > offer.expiresAt) {
      setPageStateRaw(previous => ({ ...previous, undoOffer: null }));
      return;
    }
    submitMutation(undoTransaction, undoMutation, offer.label);
  };

  const openEdit = (tx: CloudOrderTransactionRecord, action: EditAction) => {
    if (busy || operationRef.current || tx.status !== 'active') return;
    setPageStateRaw(previous => ({
      ...previous,
      paymentDetailsOpen: false,
      edit: editDraftFor(tx, action),
      actionError: '',
      notice: '',
    }));
  };

  const updateEdit = (change: Partial<EditDraft>) => {
    setPageStateRaw(previous => (previous.edit ? { ...previous, edit: { ...previous.edit, ...change } } : previous));
  };

  const editTransaction = page.edit
    ? allTransactions.find(tx => tx.transactionId === page.edit!.transactionId) ?? null
    : null;
  const editStudent = editTransaction && editTransaction.studentId !== CASHIER_ID
    ? studentsById.get(editTransaction.studentId) ?? null
    : null;
  const editBuilt = editTransaction && page.edit ? editMutation(editTransaction, page.edit) : null;
  const editPreview = editTransaction && editBuilt && !('error' in editBuilt)
    ? previewMutation(editTransaction, editBuilt, editStudent)
    : editBuilt && 'error' in editBuilt ? editBuilt : null;

  const submitEdit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!page.edit || !editTransaction || !editBuilt || busy || operationRef.current) return;
    if ('error' in editBuilt) {
      setPageStateRaw(previous => ({ ...previous, actionError: editBuilt.error }));
      return;
    }
    if (editPreview && 'error' in editPreview) {
      setPageStateRaw(previous => ({ ...previous, actionError: editPreview.error }));
      return;
    }
    const reason = page.edit.reason.trim();
    if (!reason || reason.length > 500) {
      setPageStateRaw(previous => ({ ...previous, actionError: '理由必填，且不能超過 500 字' }));
      return;
    }
    const label = editTransaction.studentId === CASHIER_ID
      ? cashierLabel(editTransaction)
      : editStudent ? `${editStudent.studentCode} ${editStudent.displayName}` : '';
    submitMutation(editTransaction, editBuilt, label);
  };

  const openRefundPanel = () => {
    if (busy || operationRef.current || !selectedStudent || backfillView) return;
    const balance = selectedStudent.currentBalance;
    setPageStateRaw(previous => ({
      ...previous,
      refundOpen: true,
      refundAmountText: balance > 0 ? String(Math.min(balance, 1_000_000)) : '',
      refundReason: '',
      refundConfirmOpen: false,
      actionError: '',
      notice: '',
    }));
  };

  const openCashPanel = () => {
    if (busy || operationRef.current) return;
    setPageStateRaw(previous => ({ ...previous, ...freshDraft(), cashOpen: true, actionError: '', notice: '' }));
  };

  const requestSubmit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!selectedStudent || busy || operationRef.current) return;
    if (mode === 'payment') {
      submitPayment();
      return;
    }
    if (selectedOrderCount > 0) {
      // Say what is wrong with the paper number before asking the operator to confirm anything.
      const composed = composePaperRefNote({ paperRef: page.paperRefText, text: page.note, required: backfillView });
      if (!composed.ok) {
        setPageStateRaw(previous => ({ ...previous, actionError: composed.error }));
        return;
      }
      setPageStateRaw(previous => ({ ...previous, confirmDuplicateOpen: true }));
      return;
    }
    submitOrder();
  };

  const retryRecovery = () => {
    const operation = operationRef.current;
    if (!operation || !isOperationCurrent(operation) || operation.originalPromisePending
      || operation.attemptPromisePending || operation.receiptQueryPending
      || operation.retryAuthorizedQueryVersion === null
      || operation.retryAuthorizedQueryVersion !== operation.receiptQueryVersion) return;
    operation.retryAuthorizedQueryVersion = null;
    operation.receiptQueryVersion += 1;
    void runAttempt(operation, true);
  };

  const undoExpiresAt = page.undoOffer?.expiresAt ?? null;
  useEffect(() => {
    if (undoExpiresAt === null) return;
    // The window is a screen convenience, not a security boundary (spec §7.2): Rules re-check creator, revision 1 and date.
    const timer = window.setTimeout(() => {
      setPageStateRaw(previous => (previous.undoOffer?.expiresAt === undoExpiresAt ? { ...previous, undoOffer: null } : previous));
    }, Math.max(0, undoExpiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [undoExpiresAt]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (pageState.recovery) return;
      if (pageState.confirmDuplicateOpen || pageState.paymentDetailsOpen || pageState.refundConfirmOpen || pageState.edit) {
        if (event.key === 'Escape') {
          setPageStateRaw(previous => ({
            ...previous, confirmDuplicateOpen: false, paymentDetailsOpen: false, refundConfirmOpen: false, edit: null,
          }));
        }
        return;
      }
      const tag = document.activeElement?.tagName.toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelSelection();
        return;
      }
      if (typing) return;
      if (event.key === 'q' || event.key === 'Q') {
        event.preventDefault();
        setPageStateRaw(previous => ({ ...previous, mode: 'bento' }));
      } else if ((event.key === 'w' || event.key === 'W') && pageState.selectedStudentId) {
        event.preventDefault();
        setPageStateRaw(previous => ({ ...previous, mode: 'payment' }));
      } else if ((event.key === 'e' || event.key === 'E') && pageState.selectedStudentId) {
        event.preventDefault();
        setPageStateRaw(previous => ({ ...previous, paymentDetailsOpen: true }));
      } else if ((event.key === 'a' || event.key === 'A') && !pageState.selectedStudentId) {
        event.preventDefault();
        setPageStateRaw(previous => ({ ...previous, ...freshDraft(), cashOpen: true, actionError: '', notice: '' }));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cancelSelection, pageState.confirmDuplicateOpen, pageState.edit, pageState.paymentDetailsOpen, pageState.refundConfirmOpen, pageState.recovery, pageState.selectedStudentId]);

  const bentoCount = day?.totals.bentoCount ?? 0;
  const otherMealCount = day?.totals.otherMealCount ?? 0;

  return (
    <div className="cloud-orders" data-testid="cloud-orders-page">
      <header className="cloud-orders__header">
        <div className="cloud-orders__header-info">
          <h2>雲端櫃台點餐</h2>
          <span className="cloud-orders__date-label">營業日：{businessDate || '—'}</span>
          {snapshot && (snapshot.backfillDays.length > 0 || backfillView) && (
            <label className="cloud-orders__day-switch">
              切換營業日
              <select
                data-testid="orders-day-select"
                value={backfillView ? businessDate : ''}
                disabled={busy || page.loading}
                onChange={event => void loadSnapshot({ dayId: event.target.value === '' ? null : event.target.value })}
              >
                <option value="">今天（{snapshot.today}）</option>
                {snapshot.backfillDays.map(item => (
                  <option key={item.dayId} value={item.dayId}>回填中 {item.dayId}</option>
                ))}
              </select>
            </label>
          )}
          {snapshot?.backfillDaysError && (
            <span className="cloud-orders__muted" data-testid="orders-backfill-list-error">
              無法讀取回填中的日子清單（{snapshot.backfillDaysError}）；今天的作業不受影響。
            </span>
          )}
        </div>
        {snapshot && (
          <div className="cloud-orders__topbar-counts" data-testid="cloud-topbar-counts">
            <div className="cloud-orders__topbar-row" data-testid="cloud-topbar-bento">
              <span className="cloud-orders__topbar-label" title={todayMenu ? todayMenu.itemName : '未設定'}>
                {backfillView ? '當日餐點' : '今日餐點'}（{todayMenu ? todayMenu.itemName : '未設定'}）
              </span>
              <span className="cloud-orders__topbar-number">{bentoCount}</span>
            </div>
            <div className="cloud-orders__topbar-row" data-testid="cloud-topbar-other">
              <span className="cloud-orders__topbar-label">其他餐點</span>
              <span className="cloud-orders__topbar-number">{otherMealCount}</span>
            </div>
          </div>
        )}
      </header>

      {page.loading && (
        <div className="cloud-orders__notice" data-testid="cloud-orders-loading" role="status">
          正在從伺服器讀取訂餐資料…
        </div>
      )}

      {snapshot && backfill && (
        <div className="cloud-orders__backfill-banner" role="status" data-testid="backfill-banner">
          <strong>正在回填 {backfill.dayId}（原因：{backfill.reason}）</strong>
          <span>
            這裡補登的訂餐、繳費與櫃台收支都記在 {backfill.dayId}，並標為「回填」。回填中不能退款，也不能撤回或取消並退款。
          </span>
          <button
            type="button"
            className="cloud-orders__btn-secondary"
            onClick={() => void loadSnapshot({ dayId: null })}
            disabled={busy || page.loading}
            data-testid="leave-backfill-button"
          >
            離開回填
          </button>
        </div>
      )}

      {page.recovery && (
        <div className="cloud-orders__error" role="alert" data-testid="order-recovery-panel">
          {page.recovery.phase === 'confirmed' ? (
            <>
              <p><strong>伺服器已確認入帳，正在重新載入資料</strong></p>
              <p>原命令編號 <strong data-testid="order-recovery-command-id">{page.recovery.command.commandId}</strong> 保持不變。</p>
              {page.loadError && (
                <p data-testid="order-recovery-heads-error">
                  已確認入帳，但重新讀取訂餐資料失敗：{page.loadError}。請重新載入資料；不要再次送出原操作。
                </p>
              )}
              <button
                type="button"
                onClick={() => void retryConfirmedSnapshot()}
                disabled={page.loading}
                data-testid="order-recovery-heads-reload"
              >
                {page.loading ? '正在重新載入資料…' : '重新載入已確認資料'}
              </button>
            </>
          ) : page.recovery.phase === 'submitting' && !page.recovery.elapsed10s ? (
            <p>
              正在送出 {page.recovery.command.label} 的{commandNoun(page.recovery.command)}，
              請等待伺服器確認，勿重新收款。
            </p>
          ) : (
            <>
              <p><strong>結果確認中，勿重新收款。</strong></p>
              <p>
                {page.recovery.command.label} 的{commandNoun(page.recovery.command)}尚未確認。命令編號{' '}
                <strong data-testid="order-recovery-command-id">{page.recovery.command.commandId}</strong> 保持不變；請先查詢原命令結果。
              </p>
              {page.recovery.queryMessage && <p data-testid="order-recovery-query-status">{page.recovery.queryMessage}</p>}
              <button
                type="button"
                onClick={() => void queryRecovery()}
                disabled={page.recovery.queryPending}
                data-testid="order-recovery-query"
              >
                {page.recovery.queryPending ? '正在查詢原命令結果…' : '查詢原命令結果'}
              </button>
              {page.recovery.retryAllowed && (
                <button type="button" onClick={retryRecovery} data-testid="order-recovery-retry">
                  以原編號重試原操作
                </button>
              )}
            </>
          )}
        </div>
      )}

      {page.notice && (
        <div className="cloud-orders__notice" role="status" aria-live="polite">{page.notice}</div>
      )}

      {page.undoOffer && !busy && (
        <div className="cloud-orders__notice cloud-orders__undo-bar" data-testid="undo-bar">
          <span>
            送錯了？5 秒內可撤回 {page.undoOffer.label}
            {undoPreview && !('error' in undoPreview) && `：現金 ${signedMoney(undoPreview.cashDelta)}`}
            {undoPreview && !('error' in undoPreview) && undoPreview.balanceAfter !== null && `，餘額回到 $${undoPreview.balanceAfter}`}
          </span>
          <button
            type="button"
            className="cloud-orders__btn-secondary"
            onClick={undoLast}
            disabled={!undoTransaction || page.loading || Boolean(orderingBlocked) || (undoPreview !== null && 'error' in undoPreview)}
            data-testid="undo-button"
          >
            撤回
          </button>
        </div>
      )}

      {page.actionError && (
        <div className="cloud-orders__error" role="alert">{page.actionError}</div>
      )}

      {page.loadError && page.recovery?.phase !== 'confirmed' && (
        <div className="cloud-orders__error" role="alert">
          {page.loadError}
          {!page.authorizationRevoked && (
            <button type="button" onClick={() => void loadSnapshot()}>重新載入</button>
          )}
          {!page.authorizationRevoked && page.viewDayId !== null && (
            <button type="button" onClick={() => void loadSnapshot({ dayId: null })} data-testid="back-to-today-button">回到今天</button>
          )}
        </div>
      )}

      {snapshot && !page.authorizationRevoked && (
        <div className="cloud-orders__content">
          <div className="cloud-orders__main-panel">
            {orderingBlocked && (
              <div className="cloud-orders__error" role="alert" data-testid="ordering-blocked">{orderingBlocked}</div>
            )}
            <div className="cloud-orders__card">
              {!selectedStudent ? (
                <div className="cloud-orders__search-group">
                  <label htmlFor="cloud-student-search">搜尋學員</label>
                  <input
                    id="cloud-student-search"
                    ref={searchInputRef}
                    className="cloud-orders__search-input"
                    type="text"
                    placeholder="輸入編號、姓名或別名..."
                    value={page.search}
                    onChange={event => {
                      const value = event.target.value;
                      setPageStateRaw(previous => ({ ...previous, search: value }));
                    }}
                    aria-label="搜尋編號、姓名或別名"
                    autoComplete="off"
                    disabled={busy}
                  />
                  {filteredStudents.length > 0 && (
                    <ul className="cloud-orders__search-dropdown" role="listbox">
                      {filteredStudents.slice(0, 10).map(student => (
                        <li
                          key={student.studentId}
                          className={`cloud-orders__search-item ${student.status === 'inactive' ? 'cloud-orders__search-item--inactive' : ''}`}
                          onClick={() => selectStudent(student)}
                          data-testid={`search-result-${student.studentCode}`}
                          role="option"
                          aria-selected="false"
                        >
                          <span>
                            <strong>{student.studentCode}</strong> {student.displayName}
                            {student.status === 'inactive' && <span className="cloud-orders__student-badge">已停用</span>}
                          </span>
                          <span>結餘 ${student.currentBalance}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {!page.cashOpen && (
                    <div className="cloud-orders__actions">
                      <button
                        type="button"
                        className="cloud-orders__btn-secondary"
                        onClick={openCashPanel}
                        disabled={busy || Boolean(orderingBlocked)}
                        data-testid="open-cash-movement-button"
                      >
                        櫃台收支（A）
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="cloud-orders__selected-student" data-testid="selected-student-card">
                  <div className="cloud-orders__selected-info">
                    <span>編號：<strong>{selectedStudent.studentCode}</strong></span>
                    <span>姓名：<strong>{selectedStudent.displayName}</strong></span>
                    <span>目前餘額：${selectedStudent.currentBalance}</span>
                    {selectedStudent.status === 'inactive' && <span className="cloud-orders__student-badge">已停用</span>}
                  </div>
                  <button type="button" className="cloud-orders__btn-secondary" onClick={cancelSelection} disabled={busy}>
                    更換學員
                  </button>
                </div>
              )}
            </div>

            {!selectedStudent && page.cashOpen && (
              <div className="cloud-orders__card" data-testid="cash-movement-card">
                <form onSubmit={submitCashMovement} aria-label="櫃台收支">
                  <h3>櫃台收支</h3>
                  <p className="cloud-orders__muted">櫃台自己的現金進出，不影響任何學生餘額。</p>
                  <div className="cloud-orders__mode-selector">
                    <button
                      type="button"
                      className="cloud-orders__mode-btn"
                      aria-pressed={page.cashDirection === 'expense'}
                      onClick={() => setPageStateRaw(previous => ({ ...previous, cashDirection: 'expense' }))}
                      disabled={busy}
                    >
                      支出
                    </button>
                    <button
                      type="button"
                      className="cloud-orders__mode-btn"
                      aria-pressed={page.cashDirection === 'income'}
                      onClick={() => setPageStateRaw(previous => ({ ...previous, cashDirection: 'income' }))}
                      disabled={busy}
                    >
                      收入
                    </button>
                  </div>
                  <div className="cloud-orders__form-grid">
                    <div className="cloud-orders__field">
                      <label htmlFor="cash-amount">金額（必填）</label>
                      <input
                        id="cash-amount"
                        type="text"
                        inputMode="numeric"
                        placeholder="0"
                        value={page.cashAmountText}
                        onChange={event => {
                          const value = event.target.value;
                          setPageStateRaw(previous => ({ ...previous, cashAmountText: value }));
                        }}
                        disabled={busy}
                        autoFocus
                      />
                    </div>
                    <div className="cloud-orders__field">
                      <label htmlFor="cash-reason">原因（必填）</label>
                      <input
                        id="cash-reason"
                        type="text"
                        placeholder={page.cashDirection === 'expense' ? '例如：付餐費給廠商' : '例如：零錢補充'}
                        value={page.cashReason}
                        onChange={event => {
                          const value = event.target.value;
                          setPageStateRaw(previous => ({ ...previous, cashReason: value }));
                        }}
                        maxLength={500}
                        disabled={busy}
                      />
                    </div>
                    <div className="cloud-orders__field">
                      <label htmlFor="cash-paper-ref">{backfillView ? '紙本號（必填）' : '紙本號（選填）'}</label>
                      <input
                        id="cash-paper-ref"
                        type="text"
                        placeholder="例如：A-0123"
                        value={page.cashPaperRefText}
                        onChange={event => {
                          const value = event.target.value;
                          setPageStateRaw(previous => ({ ...previous, cashPaperRefText: value }));
                        }}
                        maxLength={20}
                        disabled={busy}
                      />
                    </div>
                  </div>
                  {page.cashDirection === 'expense' && (
                    <div className="cloud-orders__actions">
                      <button
                        type="button"
                        className="cloud-orders__btn-secondary"
                        onClick={() => setPageStateRaw(previous => ({ ...previous, cashReason: '付餐費給廠商' }))}
                        disabled={busy}
                      >
                        付餐費給廠商
                      </button>
                    </div>
                  )}
                  <div className="cloud-orders__preview-bar">
                    <span>
                      現金影響：{cashAmount === null || cashAmount < 1
                        ? '金額格式不正確'
                        : `${page.cashDirection === 'income' ? '+' : '−'}$${cashAmount}`}
                    </span>
                  </div>
                  <div className="cloud-orders__actions">
                    <button
                      type="submit"
                      className="cloud-orders__btn-primary"
                      disabled={busy || Boolean(orderingBlocked) || !page.cashAmountText.trim() || !page.cashReason.trim()}
                      data-testid="submit-cash-movement-button"
                    >
                      {busy ? '等待伺服器確認…' : '確認登記（Enter）'}
                    </button>
                    <button type="button" className="cloud-orders__btn-secondary" onClick={cancelSelection} disabled={busy}>
                      取消（Esc）
                    </button>
                  </div>
                </form>
              </div>
            )}

            {selectedStudent && (
              <div className="cloud-orders__card">
                {selectedStudent.status === 'inactive' && (
                  <div className="cloud-orders__error" role="alert">此帳戶已停用，禁止新增餐點；仍可繳費或退款。</div>
                )}
                <form onSubmit={requestSubmit} aria-label={mode === 'payment' ? '繳費' : '訂餐'}>
                  <div className="cloud-orders__mode-selector">
                    <button
                      type="button"
                      className="cloud-orders__mode-btn"
                      aria-pressed={mode === 'bento'}
                      onClick={() => setPageStateRaw(previous => ({ ...previous, mode: 'bento' }))}
                      disabled={busy || selectedStudent.status === 'inactive'}
                    >
                      今日餐點（Q）
                    </button>
                    <button
                      type="button"
                      className="cloud-orders__mode-btn"
                      aria-pressed={mode === 'other'}
                      onClick={() => setPageStateRaw(previous => ({ ...previous, mode: 'other' }))}
                      disabled={busy || selectedStudent.status === 'inactive'}
                    >
                      其他餐點
                    </button>
                    <button
                      type="button"
                      className="cloud-orders__mode-btn"
                      aria-pressed={mode === 'payment'}
                      onClick={() => setPageStateRaw(previous => ({ ...previous, mode: 'payment' }))}
                      disabled={busy}
                    >
                      繳費（W）
                    </button>
                  </div>

                  {mode === 'bento' && (
                    <div className="cloud-orders__bento-info">
                      {todayMenu ? (
                        <p>品名：<strong>{todayMenu.itemName}</strong>｜單價：<strong>${todayMenu.price}</strong></p>
                      ) : backfillView ? (
                        <p className="cloud-orders__error">{backfill?.dayId} 尚未設定菜單，無法訂購當日餐點；請到「日期與供應商」選這一天設定菜單，或只登記其他餐點。</p>
                      ) : (
                        <p className="cloud-orders__error">今日尚未設定菜單，無法訂購今日餐點；其他餐點仍可登記。</p>
                      )}
                    </div>
                  )}
                  {mode === 'other' && (
                    <div className="cloud-orders__form-grid">
                      <div className="cloud-orders__field">
                        <label htmlFor="other-item-name">餐點品名（必填）</label>
                        <input
                          id="other-item-name"
                          type="text"
                          placeholder="例如：炒麵、水餃"
                          value={page.otherItemName}
                          onChange={event => {
                            const value = event.target.value;
                            setPageStateRaw(previous => ({ ...previous, otherItemName: value }));
                          }}
                          maxLength={100}
                          disabled={busy}
                        />
                      </div>
                      <div className="cloud-orders__field">
                        <label htmlFor="other-item-price">餐點單價（必填）</label>
                        <input
                          id="other-item-price"
                          type="text"
                          inputMode="numeric"
                          placeholder="0"
                          value={page.otherPriceText}
                          onChange={event => {
                            const value = event.target.value;
                            setPageStateRaw(previous => ({ ...previous, otherPriceText: value }));
                          }}
                          disabled={busy}
                        />
                      </div>
                    </div>
                  )}
                  {mode === 'payment' && (
                    <p className="cloud-orders__muted">繳費只記實際留存的現金，不計找零；金額會加進帳戶餘額。要退錢給學生請用「退款」。</p>
                  )}

                  <div className="cloud-orders__form-grid">
                    <div className="cloud-orders__field">
                      <label htmlFor="paid-amount">{mode === 'payment' ? '繳費金額（必填）' : '實收金額（留空為 0 元）'}</label>
                      <input
                        id="paid-amount"
                        type="text"
                        inputMode="numeric"
                        placeholder="0"
                        value={page.paidAmountText}
                        onChange={event => {
                          const value = event.target.value;
                          setPageStateRaw(previous => ({ ...previous, paidAmountText: value }));
                        }}
                        disabled={busy}
                      />
                    </div>
                    <div className="cloud-orders__field">
                      <label htmlFor="paper-ref">{backfillView ? '紙本號（必填）' : '紙本號（選填）'}</label>
                      <input
                        id="paper-ref"
                        type="text"
                        placeholder="例如：A-0123"
                        value={page.paperRefText}
                        onChange={event => {
                          const value = event.target.value;
                          setPageStateRaw(previous => ({ ...previous, paperRefText: value }));
                        }}
                        maxLength={20}
                        disabled={busy}
                      />
                    </div>
                    <div className="cloud-orders__field">
                      <label htmlFor="order-note">備註（選填）</label>
                      <input
                        id="order-note"
                        type="text"
                        placeholder="選填備註..."
                        value={page.note}
                        onChange={event => {
                          const value = event.target.value;
                          setPageStateRaw(previous => ({ ...previous, note: value }));
                        }}
                        maxLength={500}
                        disabled={busy}
                      />
                    </div>
                  </div>

                  <div className="cloud-orders__preview-bar">
                    {mode !== 'payment' && <span>本次餐費：{mealPrice === null ? '—' : `$${mealPrice}`}</span>}
                    <span>
                      {mode === 'payment' ? '繳費金額' : '實收金額'}：
                      {paidAmount === null || (mode === 'payment' && paidAmount < 1) ? '金額格式不正確' : `$${paidAmount}`}
                    </span>
                    <span>
                      預估結餘：{previewBalance === null ? '—' : `$${previewBalance}`}
                      {previewBalance !== null && previewBalance < 0 && (
                        <strong className="cloud-orders__debt">（欠款 ${Math.abs(previewBalance)}）</strong>
                      )}
                    </span>
                  </div>

                  <div className="cloud-orders__actions">
                    <button
                      type="submit"
                      className="cloud-orders__btn-primary"
                      disabled={
                        busy
                        || Boolean(orderingBlocked)
                        || (mode === 'bento' && !todayMenu)
                        || (mode === 'other' && (!page.otherItemName.trim() || !page.otherPriceText.trim()))
                        || (mode === 'payment' && !page.paidAmountText.trim())
                      }
                      data-testid="submit-order-button"
                    >
                      {busy ? '等待伺服器確認…' : '確認登記（Enter）'}
                    </button>
                    {mode === 'payment' && !page.refundOpen && (
                      <button
                        type="button"
                        className="cloud-orders__btn-secondary"
                        onClick={openRefundPanel}
                        disabled={busy || Boolean(orderingBlocked) || backfillView}
                        title={backfillView ? '回填中不能退款：退款會動到現場現金，只能在今天做' : undefined}
                        data-testid="open-refund-button"
                      >
                        退款
                      </button>
                    )}
                    {mode === 'payment' && backfillView && (
                      <span className="cloud-orders__muted" data-testid="backfill-refund-note">
                        回填中不能退款：退款會動到現場現金，只能在今天做。
                      </span>
                    )}
                    <button
                      type="button"
                      className="cloud-orders__btn-secondary"
                      onClick={() => setPageStateRaw(previous => ({ ...previous, paymentDetailsOpen: true }))}
                      disabled={busy}
                      data-testid="open-payment-details-button"
                    >
                      付款明細（E）
                    </button>
                    <button type="button" className="cloud-orders__btn-secondary" onClick={cancelSelection} disabled={busy}>
                      取消（Esc）
                    </button>
                  </div>
                </form>
              </div>
            )}

            {selectedStudent && mode === 'payment' && page.refundOpen && (
              <div className="cloud-orders__card" data-testid="refund-card">
                <form onSubmit={requestRefund} aria-label="退款">
                  <h3>退款</h3>
                  <p className="cloud-orders__muted">
                    從帳戶餘額退還現金給學生，會從今日應有現金扣除。目前餘額 ${selectedStudent.currentBalance}。
                  </p>
                  {selectedStudent.currentBalance < 1 && (
                    <p className="cloud-orders__error" data-testid="refund-no-balance">帳戶餘額不是正數，沒有可退的金額。</p>
                  )}
                  <div className="cloud-orders__form-grid">
                    <div className="cloud-orders__field">
                      <label htmlFor="refund-amount">退款金額（必填）</label>
                      <input
                        id="refund-amount"
                        type="text"
                        inputMode="numeric"
                        placeholder="0"
                        value={page.refundAmountText}
                        onChange={event => {
                          const value = event.target.value;
                          setPageStateRaw(previous => ({ ...previous, refundAmountText: value }));
                        }}
                        disabled={busy}
                      />
                    </div>
                    <div className="cloud-orders__field">
                      <label htmlFor="refund-reason">退款原因（必填）</label>
                      <input
                        id="refund-reason"
                        type="text"
                        placeholder="例如：學期結束退還餘額"
                        value={page.refundReason}
                        onChange={event => {
                          const value = event.target.value;
                          setPageStateRaw(previous => ({ ...previous, refundReason: value }));
                        }}
                        maxLength={500}
                        disabled={busy}
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="cloud-orders__preview-bar">
                    <span>現金影響：{refundValid ? `−$${refundAmount}` : '金額格式不正確'}</span>
                    <span>退款後餘額：{refundPreviewBalance === null ? '—' : `$${refundPreviewBalance}`}</span>
                  </div>
                  <div className="cloud-orders__actions">
                    <button
                      type="submit"
                      className="cloud-orders__btn-primary"
                      disabled={busy || Boolean(orderingBlocked) || !page.refundAmountText.trim() || !page.refundReason.trim()}
                      data-testid="submit-refund-button"
                    >
                      {busy ? '等待伺服器確認…' : '確認退款'}
                    </button>
                    <button
                      type="button"
                      className="cloud-orders__btn-secondary"
                      onClick={() => setPageStateRaw(previous => ({
                        ...previous, refundOpen: false, refundAmountText: '', refundReason: '', refundConfirmOpen: false, actionError: '',
                      }))}
                      disabled={busy}
                    >
                      取消退款
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>

          <div className="cloud-orders__side-panel">
            {day && cashPosition && (
              <div className="cloud-orders__card" data-testid="cloud-cash-summary">
                <h3>{backfillView ? '當日現金' : '今日現金'}</h3>
                <dl className="cloud-orders__cash-list">
                  <dt>開帳現金</dt>
                  <dd>{day.openingCash === null ? '尚未確認' : `$${day.openingCash}`}</dd>
                  <dt>學生收款</dt>
                  <dd>${day.totals.retainedReceipts}</dd>
                  <dt>櫃台收入</dt>
                  <dd>${day.totals.cashierIncome}</dd>
                  <dt>櫃台支出</dt>
                  <dd>${day.totals.cashierExpense}</dd>
                  <dt>帳戶退款</dt>
                  <dd data-testid="cloud-account-refunds">${day.totals.accountRefunds}</dd>
                  <dt>應有現金</dt>
                  <dd data-testid="cloud-expected-cash">
                    {cashPosition.expectedCash === null ? '開帳現金未確認，無法計算' : `$${cashPosition.expectedCash}`}
                  </dd>
                </dl>
                {cashierRows.length > 0 && (
                  <ul className="cloud-orders__recent-list" data-testid="cash-movement-list">
                    {cashierRows.map(tx => (
                      <li
                        key={tx.transactionId}
                        className={`cloud-orders__recent-item ${tx.status === 'voided' ? 'cloud-orders__row--voided' : ''}`}
                        data-testid={`cash-row-${tx.transactionId}`}
                      >
                        <span>{formatTaipeiTime(tx.createdAt)} {tx.paidAmount > 0 ? '收入' : '支出'} ${tx.paidAmount > 0 ? tx.paidAmount : tx.mealPrice}</span>
                        <span className="cloud-orders__recent-badge">{tx.status === 'voided' ? '已作廢' : splitPaperNote(tx.note).text}</span>
                        <PaperTag tx={tx} />
                        {txBackfilled(tx) && <span className="cloud-orders__backfill-tag" data-testid={`backfill-tag-${tx.transactionId}`}>回填</span>}
                        {tx.status === 'active' && (
                          <span className="cloud-orders__row-actions">
                            <button type="button" onClick={() => openEdit(tx, 'correct')} disabled={busy || Boolean(orderingBlocked)}>更正</button>
                            <button type="button" onClick={() => openEdit(tx, 'void')} disabled={busy || Boolean(orderingBlocked)}>作廢</button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="cloud-orders__card" data-testid="recent-accounts-card">
              <h3>最近帳戶</h3>
              {recentAccounts.length === 0 ? (
                <p className="cloud-orders__muted">今日尚無學生交易紀錄</p>
              ) : (
                <ul className="cloud-orders__recent-list" data-testid="recent-accounts-list">
                  {recentAccounts.map(({ student, summary }) => (
                    <li
                      key={student.studentId}
                      className="cloud-orders__recent-item"
                      onClick={() => { if (!busy) selectStudent(student); }}
                      data-testid={`recent-item-${student.studentCode}`}
                    >
                      <span><strong>{student.studentCode}</strong> {student.displayName}</span>
                      <span className="cloud-orders__recent-badge">
                        {summary}
                        {activeTransactions.some(tx => tx.studentId === student.studentId && txBackfilled(tx)) && (
                          <span className="cloud-orders__backfill-tag" data-testid={`backfill-tag-recent-${student.studentCode}`}>回填</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {page.confirmDuplicateOpen && selectedStudent && !busy && (
        <div className="cloud-orders__modal-backdrop" role="dialog" aria-modal="true" aria-label="確認加訂餐點">
          <div className="cloud-orders__modal">
            <h3>確認加訂餐點</h3>
            <p>{selectedStudent.displayName} 今天已訂 {selectedOrderCount} 份餐點，確定要再加訂 1 份嗎？</p>
            <div className="cloud-orders__actions">
              <button type="button" className="cloud-orders__btn-primary" onClick={submitOrder} data-testid="confirm-duplicate-button">
                確認加訂
              </button>
              <button
                type="button"
                className="cloud-orders__btn-secondary"
                onClick={() => setPageStateRaw(previous => ({ ...previous, confirmDuplicateOpen: false }))}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {page.refundConfirmOpen && selectedStudent && refundValid && !busy && (
        <div className="cloud-orders__modal-backdrop" role="dialog" aria-modal="true" aria-label="確認退款">
          <div className="cloud-orders__modal" data-testid="refund-confirm-modal">
            <h3>確認退款</h3>
            <p>確定從 {selectedStudent.displayName} 的帳戶退還 ${refundAmount} 現金嗎？退款後餘額 ${refundPreviewBalance}</p>
            <div className="cloud-orders__actions">
              <button type="button" className="cloud-orders__btn-primary" onClick={submitRefund} data-testid="confirm-refund-button">
                確認退款
              </button>
              <button
                type="button"
                className="cloud-orders__btn-secondary"
                onClick={() => setPageStateRaw(previous => ({ ...previous, refundConfirmOpen: false }))}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {page.edit && editTransaction && !busy && (
        <div className="cloud-orders__modal-backdrop" role="dialog" aria-modal="true" aria-label="修改交易">
          <div className="cloud-orders__modal" data-testid="edit-transaction-modal">
            <form onSubmit={submitEdit} aria-label="修改交易">
              <h3>
                修改：{editTransaction.studentId === CASHIER_ID
                  ? cashierLabel(editTransaction)
                  : `${editStudent?.displayName ?? ''} ${itemLabel(editTransaction)}`}
              </h3>
              <div className="cloud-orders__mode-selector">
                <button
                  type="button"
                  className="cloud-orders__mode-btn"
                  aria-pressed={page.edit.action === 'correct'}
                  onClick={() => updateEdit({ action: 'correct' })}
                >
                  更正金額或備註
                </button>
                {editTransaction.type === 'order' ? (
                  <>
                    <button
                      type="button"
                      className="cloud-orders__mode-btn"
                      aria-pressed={page.edit.action === 'cancel-keep'}
                      onClick={() => updateEdit({ action: 'cancel-keep' })}
                    >
                      {editTransaction.paidAmount > 0 ? '取消訂餐，錢留在帳戶' : '取消訂餐'}
                    </button>
                    {editTransaction.paidAmount > 0 && backfillView && (
                      <p className="cloud-orders__muted" data-testid="backfill-cancel-refund-note">
                        回填中不能「取消訂餐並退還現金」：退現金只能在今天做。
                      </p>
                    )}
                    {editTransaction.paidAmount > 0 && !backfillView && (
                      <button
                        type="button"
                        className="cloud-orders__mode-btn"
                        aria-pressed={page.edit.action === 'cancel-refund'}
                        onClick={() => updateEdit({ action: 'cancel-refund' })}
                      >
                        取消訂餐並退還 ${editTransaction.paidAmount}
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    className="cloud-orders__mode-btn"
                    aria-pressed={page.edit.action === 'void'}
                    onClick={() => updateEdit({ action: 'void' })}
                  >
                    作廢（記錯了）
                  </button>
                )}
              </div>

              {page.edit.action === 'correct' && (
                <div className="cloud-orders__form-grid">
                  {editTransaction.type === 'order' && (
                    <div className="cloud-orders__field">
                      <label htmlFor="edit-meal-price">餐費</label>
                      <input
                        id="edit-meal-price"
                        type="text"
                        inputMode="numeric"
                        value={page.edit.mealPriceText}
                        onChange={event => updateEdit({ mealPriceText: event.target.value })}
                      />
                    </div>
                  )}
                  {(editTransaction.type === 'order' || editTransaction.type === 'payment') && (
                    <div className="cloud-orders__field">
                      <label htmlFor="edit-paid-amount">{editTransaction.type === 'payment' ? '繳費金額' : '實收金額'}</label>
                      <input
                        id="edit-paid-amount"
                        type="text"
                        inputMode="numeric"
                        value={page.edit.paidAmountText}
                        onChange={event => updateEdit({ paidAmountText: event.target.value })}
                      />
                    </div>
                  )}
                  {(editTransaction.type === 'expense' || editTransaction.type === 'refund') && (
                    <div className="cloud-orders__field">
                      <label htmlFor="edit-amount">
                        {editTransaction.type === 'refund' ? '退款金額' : editTransaction.paidAmount > 0 ? '收入金額' : '支出金額'}
                      </label>
                      <input
                        id="edit-amount"
                        type="text"
                        inputMode="numeric"
                        value={page.edit.amountText}
                        onChange={event => updateEdit({ amountText: event.target.value })}
                      />
                    </div>
                  )}
                  {page.edit.paperRef && (
                    <p className="cloud-orders__muted" data-testid="edit-paper-ref">紙本號 {page.edit.paperRef}（更正時不能修改）</p>
                  )}
                  <div className="cloud-orders__field">
                    <label htmlFor="edit-note">
                      {editTransaction.type === 'refund' ? '退款原因' : editTransaction.type === 'expense' ? '收支原因' : '備註'}
                    </label>
                    <input
                      id="edit-note"
                      type="text"
                      value={page.edit.note}
                      onChange={event => updateEdit({ note: event.target.value })}
                      maxLength={500}
                    />
                  </div>
                </div>
              )}

              <div className="cloud-orders__field">
                <label htmlFor="edit-reason">修改理由（必填，會留在稽核紀錄）</label>
                <input
                  id="edit-reason"
                  type="text"
                  placeholder="例如：收款金額記錯"
                  value={page.edit.reason}
                  onChange={event => updateEdit({ reason: event.target.value })}
                  maxLength={500}
                  autoFocus
                />
              </div>

              <div className="cloud-orders__preview-bar" data-testid="edit-preview">
                {editPreview && 'error' in editPreview ? (
                  <span className="cloud-orders__error">{editPreview.error}</span>
                ) : editPreview ? (
                  <>
                    <span>現金影響：{signedMoney(editPreview.cashDelta)}{REASON_KIND_TEXT[editPreview.reasonKind] ?? ''}</span>
                    {editPreview.balanceAfter !== null && (
                      <span>帳戶餘額：${editPreview.balanceBefore} → ${editPreview.balanceAfter}</span>
                    )}
                    {page.edit.action === 'void' && editPreview.cashDelta !== 0 && (
                      <span data-testid="void-ledger-warning">
                        作廢只更正帳本，不是今天退現金或收現金；要把錢退給學生請改用退款。
                      </span>
                    )}
                  </>
                ) : null}
              </div>

              <div className="cloud-orders__actions">
                <button
                  type="submit"
                  className="cloud-orders__btn-primary"
                  disabled={!page.edit.reason.trim() || Boolean(orderingBlocked) || (editPreview !== null && 'error' in editPreview)}
                  data-testid="submit-edit-button"
                >
                  {page.edit.action === 'correct' ? '確認更正' : page.edit.action === 'void' ? '確認作廢' : '確認取消'}
                </button>
                <button
                  type="button"
                  className="cloud-orders__btn-secondary"
                  onClick={() => setPageStateRaw(previous => ({ ...previous, edit: null, actionError: '' }))}
                >
                  返回
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {page.paymentDetailsOpen && selectedStudent && (
        <div className="cloud-orders__modal-backdrop" role="dialog" aria-modal="true" aria-label="付款明細">
          <div className="cloud-orders__modal" data-testid="payment-details-modal">
            <h3>{selectedStudent.displayName} 今日付款明細</h3>
            {selectedAllTransactions.length === 0 ? (
              <p className="cloud-orders__muted">今日尚無交易紀錄</p>
            ) : (
              <table className="cloud-orders__table">
                <thead>
                  <tr><th>時間</th><th>項目</th><th>餐費</th><th>收款</th><th>退款</th><th>修改</th></tr>
                </thead>
                <tbody>
                  {selectedAllTransactions.map(tx => (
                    <tr
                      key={tx.transactionId}
                      className={tx.status === 'voided' ? 'cloud-orders__row--voided' : ''}
                      data-testid={`detail-row-${tx.transactionId}`}
                    >
                      <td>{formatTaipeiTime(tx.createdAt)}</td>
                      <td>
                        {itemLabel(tx)}
                        {tx.status === 'voided' && <span className="cloud-orders__student-badge">已作廢</span>}
                        {txBackfilled(tx) && <span className="cloud-orders__backfill-tag" data-testid={`backfill-tag-${tx.transactionId}`}>回填</span>}
                        <PaperTag tx={tx} />
                      </td>
                      <td>${tx.mealPrice}</td>
                      <td>${tx.paidAmount}</td>
                      <td>{tx.type === 'refund' ? `$${tx.amount}` : '—'}</td>
                      <td>
                        {tx.status === 'active' && (
                          <span className="cloud-orders__row-actions">
                            <button type="button" onClick={() => openEdit(tx, 'correct')} disabled={busy || Boolean(orderingBlocked)}>更正</button>
                            {tx.type === 'order' ? (
                              <button type="button" onClick={() => openEdit(tx, 'cancel-keep')} disabled={busy || Boolean(orderingBlocked)}>取消</button>
                            ) : (
                              <button type="button" onClick={() => openEdit(tx, 'void')} disabled={busy || Boolean(orderingBlocked)}>作廢</button>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="cloud-orders__preview-bar" data-testid="payment-details-summary">
              <span>今日餐費：${selectedTransactions.reduce((sum, tx) => sum + tx.mealPrice, 0)}</span>
              <span>今日收款：${selectedTransactions.reduce((sum, tx) => sum + tx.paidAmount, 0)}</span>
              <span>今日退款：${selectedTransactions.reduce((sum, tx) => sum + (tx.type === 'refund' ? tx.amount : 0), 0)}</span>
              <span>帳戶餘額：${selectedStudent.currentBalance}</span>
            </div>
            <div className="cloud-orders__actions">
              <button
                type="button"
                className="cloud-orders__btn-secondary"
                onClick={() => setPageStateRaw(previous => ({ ...previous, paymentDetailsOpen: false }))}
                data-testid="close-payment-details-button"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
