import { getAuth, type User } from 'firebase/auth';
import {
  Timestamp,
  doc,
  getDocFromServer,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import type { CommandErrorCode, CommandReceipt, CommandResult } from '../domain/cloudCommands';
import {
  decodeEnabledCommandDoc,
  fingerprintCommandInput,
  normalizeEnabledCommandInput,
  sameCommandSemantics,
  type CanonicalEnabledInput,
  type StoredEnabledCommandDoc,
} from '../domain/cloudCommandSchema';
import { accessLeasePath, commandPath, dataHeadPath, dayPath, studentPath, transactionPath } from './firestorePaths';

type Data = Record<string, unknown>;
type CurrentUser = Pick<User, 'uid' | 'email' | 'emailVerified' | 'providerData'>;

export interface CloudCommandRepositoryOptions {
  /** Injection seam for emulator tests; production callers use Firebase Auth currentUser. */
  currentUser?: () => CurrentUser | null;
}

class RejectCommand extends Error {
  readonly code: CommandErrorCode;

  constructor(code: CommandErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export class CloudCommandReadError extends Error {
  readonly code: CommandErrorCode;

  constructor(code: CommandErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'CloudCommandReadError';
  }
}

function errorResult(code: CommandErrorCode, message: string): CommandResult {
  return { ok: false, error: { code, message } };
}

function plainRecord(value: unknown): value is Data {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: unknown, keys: string[]): value is Data {
  if (!plainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function integer(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= minimum;
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function decodeHead(value: unknown): Data {
  const keys = ['schemaVersion', 'datasetId', 'seq', 'lastCommandId', 'maintenance', 'goLiveDate', 'updatedAt'];
  if (!hasExactKeys(value, keys)
    || value.schemaVersion !== 1
    || typeof value.datasetId !== 'string' || value.datasetId.length === 0
    || !integer(value.seq)
    || (value.lastCommandId !== null && typeof value.lastCommandId !== 'string')
    || typeof value.maintenance !== 'boolean'
    || !validDate(value.goLiveDate)
    || !(value.updatedAt instanceof Timestamp)) {
    throw new RejectCommand('UNSUPPORTED_SCHEMA', '雲端 dataHead schema 不支援');
  }
  return value;
}

function decodeLease(value: unknown): Data {
  if (!hasExactKeys(value, ['holderUid', 'epoch', 'updatedAt'])
    || (value.holderUid !== null && (typeof value.holderUid !== 'string' || value.holderUid.length === 0))
    || !integer(value.epoch)
    || !(value.updatedAt instanceof Timestamp)) {
    throw new RejectCommand('UNSUPPORTED_SCHEMA', '雲端 accessLease schema 不支援');
  }
  return value;
}

function decodeStudent(value: unknown): Data {
  const keys = ['studentId', 'displayName', 'aliases', 'status', 'openingBalance', 'currentBalance', 'createdAt', 'revision', 'lastCommandId', 'updatedAt'];
  if (!hasExactKeys(value, keys)
    || typeof value.studentId !== 'string'
    || typeof value.displayName !== 'string' || value.displayName.length < 1 || value.displayName.length > 100
    || !Array.isArray(value.aliases) || value.aliases.length > 10 || !value.aliases.every(x => typeof x === 'string' && x.length <= 100)
    || (value.status !== 'active' && value.status !== 'inactive')
    || !plainRecord(value.openingBalance)
    || !hasExactKeys(value.openingBalance, ['amount', 'asOfDate', 'note', 'createdAt'])
    || !integer(value.openingBalance.amount, -1_000_000_000)
    || !validDate(value.openingBalance.asOfDate)
    || typeof value.openingBalance.note !== 'string'
    || !(value.openingBalance.createdAt instanceof Timestamp)
    || !integer(value.currentBalance, -1_000_000_000)
    || Math.abs(value.currentBalance) > 1_000_000_000
    || !(value.createdAt instanceof Timestamp)
    || !integer(value.revision, 1)
    || typeof value.lastCommandId !== 'string'
    || !(value.updatedAt instanceof Timestamp)) {
    throw new RejectCommand('UNSUPPORTED_SCHEMA', '學生文件 schema 不支援');
  }
  return value;
}

function decodeDay(value: unknown): Data {
  const keys = ['status', 'revision', 'menu', 'openingCash', 'openedBy', 'openedAt', 'totals', 'lastSettlementRevision', 'lastCommandId', 'updatedAt'];
  if (!hasExactKeys(value, keys)
    || !['open', 'closed', 'reopened'].includes(String(value.status))
    || !integer(value.revision, 1)
    || (value.openingCash !== null && (!integer(value.openingCash) || value.openingCash > 20_000))
    || (value.openedBy !== null && typeof value.openedBy !== 'string')
    || (value.openedAt !== null && !(value.openedAt instanceof Timestamp))
    || !plainRecord(value.totals)
    || !hasExactKeys(value.totals, ['activeTransactionCount', 'bentoCount', 'otherMealCount', 'mealTotal', 'retainedReceipts', 'cashierIncome', 'cashierExpense'])
    || !Object.values(value.totals).every(n => integer(n))
    || !integer(value.lastSettlementRevision)
    || typeof value.lastCommandId !== 'string'
    || !(value.updatedAt instanceof Timestamp)) {
    throw new RejectCommand('UNSUPPORTED_SCHEMA', '營業日文件 schema 不支援');
  }
  if (value.menu !== null) {
    const menu = value.menu;
    if (!plainRecord(menu)
      || !hasExactKeys(menu, ['businessDate', 'itemName', 'price', 'vendorId', 'vendorNameSnapshot', 'updatedAt', 'revision', 'inheritedFromDate'])
      || !validDate(menu.businessDate)
      || typeof menu.itemName !== 'string' || menu.itemName.length < 1 || menu.itemName.length > 100
      || !integer(menu.price, 1) || menu.price > 1_000_000
      || typeof menu.vendorId !== 'string' || !menu.vendorId
      || typeof menu.vendorNameSnapshot !== 'string' || !menu.vendorNameSnapshot
      || !(menu.updatedAt instanceof Timestamp)
      || !integer(menu.revision, 1)
      || (menu.inheritedFromDate !== null && !validDate(menu.inheritedFromDate))) {
      throw new RejectCommand('UNSUPPORTED_SCHEMA', '營業日菜單 schema 不支援');
    }
  }
  return value;
}

function getCurrentUser(options: CloudCommandRepositoryOptions): CurrentUser | null {
  if (options.currentUser) return options.currentUser();
  try {
    return getAuth().currentUser;
  } catch {
    return null;
  }
}

function requireVerifiedGoogle(user: CurrentUser | null): asserts user is CurrentUser {
  if (!user || !user.uid || !user.email || user.emailVerified !== true
    || !user.providerData.some(provider => provider.providerId === 'google.com')) {
    throw new RejectCommand('UNAUTHORIZED', '需要已驗證的 Google 操作員身分');
  }
}

function checkOperator(raw: unknown, user: CurrentUser): void {
  if (!plainRecord(raw) || raw.uid !== user.uid || raw.email !== user.email || raw.active !== true) {
    throw new RejectCommand('UNAUTHORIZED', '此 Google 身分不是啟用中的操作員');
  }
}

function checkLease(raw: unknown, input: CanonicalEnabledInput, user: CurrentUser): void {
  const lease = decodeLease(raw);
  if (lease.holderUid !== user.uid || lease.epoch !== input.leaseEpoch) {
    throw new RejectCommand('LEASE_LOST', '目前使用權租約已變更，請重新確認');
  }
  // Expiration authority remains the Firestore Rules request.time comparison.
}

function checkRevision(actual: unknown, expected: number, label: string): void {
  if (actual !== expected) throw new RejectCommand('REVISION_CONFLICT', `${label} 已變更，請重新載入`);
}

function requireDateAfterGoLive(date: string, goLiveDate: string): void {
  if (date < goLiveDate) throw new RejectCommand('INVALID_INPUT', '營業日早於系統啟用日期');
}

function buildReceipt(stored: StoredEnabledCommandDoc): CommandReceipt {
  if (!(stored.committedAt instanceof Timestamp)) throw new RejectCommand('UNSUPPORTED_SCHEMA', 'receipt 缺少伺服器 Timestamp');
  return {
    commandId: stored.commandId,
    seq: stored.seq,
    committedAt: stored.committedAt.toDate().toISOString(),
    kind: stored.kind,
    targets: stored.targets,
    result: stored.after ?? {},
  };
}

function storedInput(stored: StoredEnabledCommandDoc): unknown {
  return {
    commandId: stored.commandId,
    kind: stored.kind,
    leaseEpoch: stored.leaseEpoch,
    targets: stored.targets,
    expectedRevisions: stored.expectedRevisions,
    payload: stored.payload,
  };
}

async function assertStoredReceiptMatches(stored: StoredEnabledCommandDoc, input: CanonicalEnabledInput, fingerprint: string): Promise<void> {
  if (!sameCommandSemantics(input, storedInput(stored))) {
    throw new RejectCommand('INVALID_INPUT', 'commandId 已用於不同的命令內容');
  }
  const storedNormalized = normalizeEnabledCommandInput(storedInput(stored));
  const actualFingerprint = await fingerprintCommandInput(storedNormalized);
  if (stored.inputFingerprint !== actualFingerprint || stored.inputFingerprint !== fingerprint) {
    throw new RejectCommand('UNSUPPORTED_SCHEMA', 'receipt semantic input 與 fingerprint 不一致');
  }
}

function mapTransactionError(error: unknown): CommandErrorCode {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: unknown }).code);
    if (code.includes('resource-exhausted')) return 'QUOTA_EXCEEDED';
    if (code.includes('permission-denied')) return 'LEASE_LOST';
    if (code.includes('unavailable') || code.includes('deadline-exceeded') || code.includes('cancelled')) return 'UNKNOWN_RESULT';
    if (code.includes('aborted')) return 'REVISION_CONFLICT';
  }
  return 'UNKNOWN_RESULT';
}

function resultFromUnknownError(message = '提交回應不確定，請用原 commandId 查詢結果'): CommandResult {
  return errorResult('UNKNOWN_RESULT', message);
}

export function createCloudCommandRepository(db: Firestore, options: CloudCommandRepositoryOptions = {}) {
  async function verifiedReceipt(commandId: string): Promise<StoredEnabledCommandDoc | null> {
    const snapshot = await getDocFromServer(doc(db, commandPath(commandId)));
    if (!snapshot.exists()) return null;
    return decodeEnabledCommandDoc(snapshot.data());
  }

  async function readCommand(commandId: string): Promise<CommandReceipt | null> {
    if (typeof commandId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(commandId)) {
      throw new CloudCommandReadError('INVALID_INPUT', 'commandId 必須是 UUID');
    }
    try {
      requireVerifiedGoogle(getCurrentUser(options));
      const stored = await verifiedReceipt(commandId);
      return stored ? buildReceipt(stored) : null;
    } catch (error) {
      if (error instanceof CloudCommandReadError) throw error;
      if (error instanceof RejectCommand) throw new CloudCommandReadError(error.code, error.message);
      // null is reserved for a successful server read that confirmed absence.
      const code = mapTransactionError(error);
      throw new CloudCommandReadError(code, '無法從伺服器確認 command receipt');
    }
  }

  async function commitCommand(untrustedInput: unknown): Promise<CommandResult> {
    let input: CanonicalEnabledInput;
    let user: CurrentUser;
    let fingerprint: string;
    try {
      input = normalizeEnabledCommandInput(untrustedInput);
      const candidateUser = getCurrentUser(options);
      requireVerifiedGoogle(candidateUser);
      user = candidateUser;
      fingerprint = await fingerprintCommandInput(input);
    } catch (error) {
      if (error instanceof RejectCommand) return errorResult(error.code, error.message);
      if (error instanceof Error && error.name === 'InvalidCloudCommandInput') return errorResult('INVALID_INPUT', error.message);
      return errorResult('UNSUPPORTED_SCHEMA', error instanceof Error ? error.message : '無法驗證命令內容');
    }

    const commandRef = doc(db, commandPath(input.commandId));
    const headRef = doc(db, dataHeadPath());
    const leaseRef = doc(db, accessLeasePath());
    const operatorRef = doc(db, `operators/${user.uid}`);
    const targetDayId = input.kind === 'EnsureDay' ? input.targets.dayId : input.targets.dayId;
    const dayRef = doc(db, dayPath(targetDayId));
    const targetStudentRef = input.kind === 'EnsureDay' ? null : doc(db, studentPath(input.targets.studentId));
    const targetTransactionRef = input.kind === 'CreateOrder' || input.kind === 'CreatePayment'
      ? doc(db, transactionPath(input.targets.transactionId))
      : null;

    try {
      const transactionOutcome = await runTransaction(db, async tx => {
        // Complete every read before the first write. These server transaction reads never use cache.
        const commandSnapshot = await tx.get(commandRef);
        const headSnapshot = await tx.get(headRef);
        const operatorSnapshot = await tx.get(operatorRef);
        const leaseSnapshot = await tx.get(leaseRef);

        if (!operatorSnapshot.exists()) throw new RejectCommand('UNAUTHORIZED', '操作員文件不存在');
        checkOperator(operatorSnapshot.data(), user);
        if (!leaseSnapshot.exists()) throw new RejectCommand('LEASE_LOST', '使用權租約不存在');
        checkLease(leaseSnapshot.data(), input, user);
        if (!headSnapshot.exists()) throw new RejectCommand('UNSUPPORTED_SCHEMA', 'dataHead 尚未由維護者初始化');
        const headBefore = decodeHead(headSnapshot.data());
        if (headBefore.maintenance) throw new RejectCommand('MAINTENANCE', '系統正在維護，暫停新命令');

        if (commandSnapshot.exists()) {
          const stored = decodeEnabledCommandDoc(commandSnapshot.data());
          if (stored.commandId !== input.commandId) throw new RejectCommand('UNSUPPORTED_SCHEMA', 'receipt commandId 與文件路徑不一致');
          // Historical actor/lease epoch do not authorize a new read; the current operator/lease above does.
          await assertStoredReceiptMatches(stored, input, fingerprint);
          return { existing: stored } as const;
        }

        const daySnapshot = await tx.get(dayRef);
        let studentBefore: Data | null = null;
        let transactionExists = false;
        if (targetStudentRef) {
          const studentSnapshot = await tx.get(targetStudentRef);
          if (!studentSnapshot.exists()) throw new RejectCommand('INVALID_INPUT', '目標學生不存在');
          studentBefore = decodeStudent(studentSnapshot.data());
        }
        if (targetTransactionRef) {
          const transactionSnapshot = await tx.get(targetTransactionRef);
          transactionExists = transactionSnapshot.exists();
        }

        const seq = Number(headBefore.seq) + 1;
        const now = serverTimestamp();
        const headAfter: Data = { ...headBefore, seq, lastCommandId: input.commandId, updatedAt: now };
        const zeroCash = { before: 0, after: 0, delta: 0, reasonKind: 'none' as const, refundAmount: 0 };

        if (input.kind === 'EnsureDay') {
          if (daySnapshot.exists()) throw new RejectCommand('INVALID_INPUT', '該營業日已存在；不會重設或重開日期');
          const businessDate = input.payload.businessDate;
          requireDateAfterGoLive(businessDate, String(headBefore.goLiveDate));
          const dayAfter: Data = {
            status: 'open', revision: 1, menu: null, openingCash: null, openedBy: null, openedAt: null,
            totals: { activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0, mealTotal: 0, retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0 },
            lastSettlementRevision: 0, lastCommandId: input.commandId, updatedAt: now,
          };
          const stored: StoredEnabledCommandDoc = {
            commandId: input.commandId, kind: input.kind, seq, leaseEpoch: input.leaseEpoch,
            actor: { uid: user.uid, email: user.email! }, committedAt: now as Timestamp,
            businessDate, studentId: null, targets: input.targets, expectedRevisions: input.expectedRevisions,
            before: { head: headBefore, day: null },
            after: { head: headAfter, day: dayAfter },
            reason: null, cashEffect: zeroCash, payload: input.payload, inputFingerprint: fingerprint,
          };
          tx.set(dayRef, dayAfter);
          tx.update(headRef, headAfter);
          tx.set(commandRef, stored);
          return { existing: null } as const;
        }

        if (!daySnapshot.exists() || !studentBefore || !targetStudentRef || !targetTransactionRef) {
          throw new RejectCommand('INVALID_INPUT', '建立交易需要已存在的營業日與學生');
        }
        if (transactionExists) throw new RejectCommand('INVALID_INPUT', 'transactionId 已存在');
        const dayBefore = decodeDay(daySnapshot.data());
        checkRevision(studentBefore.revision, input.expectedRevisions.student, '學生版本');
        checkRevision(dayBefore.revision, input.expectedRevisions.day, '營業日版本');
        checkRevision(0, input.expectedRevisions.transaction, '交易版本');
        if (dayBefore.status === 'closed') throw new RejectCommand('DAY_CLOSED', '該日已關帳');
        requireDateAfterGoLive(input.targets.dayId, String(headBefore.goLiveDate));
        if (studentBefore.status !== 'active') throw new RejectCommand('INVALID_INPUT', '停用學生不能新增交易');
        const opening = studentBefore.openingBalance as Data;
        if (String(opening.asOfDate) > input.targets.dayId) throw new RejectCommand('INVALID_INPUT', '營業日早於學生期初日');

        const orderInput = input.kind === 'CreateOrder' ? input : null;
        const order = orderInput !== null;
        const mealPrice = orderInput?.payload.mealPrice ?? 0;
        const mealKind = orderInput?.payload.mealKind ?? null;
        const paidAmount = input.payload.paidAmount;
        const note = input.payload.note;
        const menu = dayBefore.menu as Data | null;
        if (orderInput?.payload.mealKind === 'bento') {
          if (!menu || orderInput.payload.menuRevision !== menu.revision || mealPrice !== menu.price) {
            throw new RejectCommand('REVISION_CONFLICT', '菜單或單價已變更，請重新確認');
          }
        }
        const currentBalance = Number(studentBefore.currentBalance);
        const nextBalance = currentBalance + paidAmount - mealPrice;
        if (!Number.isSafeInteger(nextBalance) || Math.abs(nextBalance) > 1_000_000_000) {
          throw new RejectCommand('INVALID_INPUT', '餘額超出允許範圍');
        }
        const totalsBefore = dayBefore.totals as Data;
        const totalsAfter = {
          ...totalsBefore,
          activeTransactionCount: Number(totalsBefore.activeTransactionCount) + 1,
          bentoCount: Number(totalsBefore.bentoCount) + (mealKind === 'bento' ? 1 : 0),
          otherMealCount: Number(totalsBefore.otherMealCount) + (mealKind === 'other' ? 1 : 0),
          mealTotal: Number(totalsBefore.mealTotal) + mealPrice,
          retainedReceipts: Number(totalsBefore.retainedReceipts) + paidAmount,
        };
        if (Object.values(totalsAfter).some(value => !Number.isSafeInteger(value) || Math.abs(value as number) > 1_000_000_000)) {
          throw new RejectCommand('INVALID_INPUT', '營業日合計超出允許範圍');
        }

        const studentAfter: Data = {
          ...studentBefore,
          currentBalance: nextBalance,
          revision: Number(studentBefore.revision) + 1,
          lastCommandId: input.commandId,
          updatedAt: now,
        };
        const dayAfter: Data = {
          ...dayBefore,
          revision: Number(dayBefore.revision) + 1,
          totals: totalsAfter,
          lastCommandId: input.commandId,
          updatedAt: now,
        };
        const transactionAfter: Data = {
          transactionId: input.targets.transactionId,
          studentId: input.targets.studentId,
          businessDate: input.targets.dayId,
          type: order ? 'order' : 'payment',
          mealKind,
          mealPrice,
          paidAmount,
          amount: paidAmount - mealPrice,
          studentNameSnapshot: studentBefore.displayName,
          menuNameSnapshot: mealKind === 'bento' ? menu?.itemName : '',
          menuPriceSnapshot: mealKind === 'bento' ? menu?.price : 0,
          vendorIdSnapshot: mealKind === 'bento' ? menu?.vendorId : '',
          vendorNameSnapshot: mealKind === 'bento' ? menu?.vendorNameSnapshot : '',
          otherItemName: orderInput?.payload.otherItemName ?? null,
          status: 'active', revision: 1, createdAt: now, createdSeq: seq,
          operatorUid: user.uid, operatorEmail: user.email,
          sourceDevice: 'pc', note,
          lastCommandId: input.commandId, updatedAt: now,
        };
        const cashEffect = {
          before: 0, after: paidAmount, delta: paidAmount,
          reasonKind: paidAmount > 0 ? 'collection' as const : 'none' as const,
          refundAmount: 0,
        };
        const storedCommon = {
          commandId: input.commandId, seq, leaseEpoch: input.leaseEpoch,
          actor: { uid: user.uid, email: user.email! }, committedAt: now as Timestamp,
          businessDate: input.targets.dayId, studentId: input.targets.studentId,
          targets: input.targets, expectedRevisions: input.expectedRevisions,
          before: { head: headBefore, student: studentBefore, day: dayBefore, transaction: null },
          after: { head: headAfter, student: studentAfter, day: dayAfter, transaction: transactionAfter },
          reason: null, cashEffect, inputFingerprint: fingerprint,
        };
        const stored: StoredEnabledCommandDoc = input.kind === 'CreateOrder'
          ? { ...storedCommon, kind: 'CreateOrder', payload: input.payload }
          : { ...storedCommon, kind: 'CreatePayment', payload: input.payload };
        // All gets above are completed before the first write.
        tx.update(targetStudentRef, studentAfter);
        tx.update(dayRef, dayAfter);
        tx.set(targetTransactionRef, transactionAfter);
        tx.update(headRef, headAfter);
        tx.set(commandRef, stored);
        return { existing: null } as const;
      }, { maxAttempts: 5 });

      if (transactionOutcome.existing) {
        return { ok: true, receipt: buildReceipt(transactionOutcome.existing) };
      }
      try {
        const stored = await verifiedReceipt(input.commandId);
        if (!stored) return resultFromUnknownError();
        await assertStoredReceiptMatches(stored, input, fingerprint);
        return { ok: true, receipt: buildReceipt(stored) };
      } catch {
        // A successful transaction followed by an unreadable receipt is ambiguous, never a definite failure.
        return resultFromUnknownError();
      }
    } catch (error) {
      if (error instanceof RejectCommand) return errorResult(error.code, error.message);
      if (error && typeof error === 'object' && 'name' in error && (error as { name?: string }).name === 'InvalidCloudCommandInput') {
        return errorResult('INVALID_INPUT', error instanceof Error ? error.message : '命令內容不合法');
      }

      const resultCode = mapTransactionError(error);
      try {
        const stored = await verifiedReceipt(input.commandId);
        if (stored) {
          await assertStoredReceiptMatches(stored, input, fingerprint);
          return { ok: true, receipt: buildReceipt(stored) };
        }
        if (resultCode === 'REVISION_CONFLICT' || resultCode === 'LEASE_LOST' || resultCode === 'QUOTA_EXCEEDED') {
          return errorResult(resultCode, '提交遭伺服器拒絕；請保留 commandId 並確認目前狀態');
        }
      } catch (readError) {
        if (readError instanceof RejectCommand && readError.code === 'INVALID_INPUT') {
          return errorResult(readError.code, readError.message);
        }
      }
      return resultFromUnknownError();
    }
  }

  return { commitCommand, readCommand };
}
