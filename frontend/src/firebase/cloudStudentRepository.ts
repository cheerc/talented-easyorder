import { getAuth, type User } from 'firebase/auth';
import {
  Timestamp,
  collection,
  doc,
  documentId,
  getDocFromServer,
  getDocsFromServer,
  limit,
  orderBy,
  query,
  startAfter,
  type DocumentSnapshot,
  type Firestore,
} from 'firebase/firestore';
import type { CommandErrorCode, CommandReceipt, CommandResult } from '../domain/cloudCommands';
import { STUDENT_CODE_REGEX } from '../domain/student';
import {
  createCloudCommandRepository,
  type CloudCommandRepositoryOptions,
} from './cloudCommandRepository';
import { dataHeadPath } from './firestorePaths';

type Data = Record<string, unknown>;
type CurrentUser = Pick<User, 'uid' | 'email' | 'emailVerified' | 'providerData'>;

const STUDENT_PAGE_SIZE = 200;
const MAX_STUDENTS = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CloudStudentRecord {
  studentId: string;
  studentCode: string;
  displayName: string;
  aliases: string[];
  status: 'active' | 'inactive';
  openingBalance: {
    amount: number;
    asOfDate: string;
    note: string;
    createdAt: string;
  };
  currentBalance: number;
  createdAt: string;
  revision: number;
  lastCommandId: string;
  updatedAt: string;
}

export interface CloudStudentList {
  students: CloudStudentRecord[];
  seq: number;
  datasetId: string;
  goLiveDate: string;
}

export type CloudStudentReadErrorCode = CommandErrorCode | 'INCOMPLETE_SNAPSHOT' | 'STALE_SNAPSHOT';

export class CloudStudentRepositoryError extends Error {
  readonly code: CloudStudentReadErrorCode;

  constructor(code: CloudStudentReadErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'CloudStudentRepositoryError';
  }
}

export type CloudStudentRepositoryOptions = CloudCommandRepositoryOptions;

export interface CreateCloudStudentInput {
  commandId: string;
  leaseEpoch: number;
  studentId: string;
  studentCode: string;
  displayName: string;
  aliases: string[];
  openingBalance: { amount: number; asOfDate: string; note: string };
}

export interface ChangeCloudStudentCodeInput {
  commandId: string;
  leaseEpoch: number;
  studentId: string;
  expectedRevision: number;
  studentCode: string;
  reason: string;
}

export interface EditCloudStudentInput {
  commandId: string;
  leaseEpoch: number;
  studentId: string;
  expectedRevision: number;
  displayName?: string;
  aliases?: string[];
}

export interface SetCloudStudentStatusInput {
  commandId: string;
  leaseEpoch: number;
  studentId: string;
  expectedRevision: number;
  status: 'active' | 'inactive';
  reason: string;
}

function plainRecord(value: unknown): value is Data {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: unknown, keys: string[]): value is Data {
  if (!plainRecord(value)) return false;
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function integer(value: unknown, minimum: number, maximum = 1_000_000_000): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && !Object.is(value, -0)
    && value >= minimum
    && value <= maximum;
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validStudentId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function validStudentCode(value: unknown): value is string {
  return typeof value === 'string' && STUDENT_CODE_REGEX.test(value);
}

function timestampIso(value: unknown): string | null {
  if (!(value instanceof Timestamp)) return null;
  const date = value.toDate();
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function decodeHead(value: unknown): { seq: number; datasetId: string; goLiveDate: string; maintenance: boolean } {
  if (!exactKeys(value, ['schemaVersion', 'datasetId', 'seq', 'lastCommandId', 'maintenance', 'goLiveDate', 'updatedAt'])
    || value.schemaVersion !== 1
    || typeof value.datasetId !== 'string' || value.datasetId.length < 1 || value.datasetId.length > 128
    || !integer(value.seq, 0, Number.MAX_SAFE_INTEGER)
    || (value.lastCommandId !== null && (typeof value.lastCommandId !== 'string' || !UUID.test(value.lastCommandId)))
    || typeof value.maintenance !== 'boolean'
    || !validDate(value.goLiveDate)
    || !(value.updatedAt instanceof Timestamp)) {
    throw new CloudStudentRepositoryError('UNSUPPORTED_SCHEMA', '雲端 dataHead schema 不支援');
  }
  if (value.maintenance) throw new CloudStudentRepositoryError('MAINTENANCE', '系統正在維護，暫停讀取學生名單');
  if ((value.seq === 0) !== (value.lastCommandId === null)) {
    throw new CloudStudentRepositoryError('UNSUPPORTED_SCHEMA', '雲端 dataHead 序號與 command 狀態不一致');
  }
  return { seq: value.seq, datasetId: value.datasetId, goLiveDate: value.goLiveDate, maintenance: value.maintenance };
}

function decodeStudent(id: string, value: unknown): CloudStudentRecord {
  const keys = ['studentId', 'studentCode', 'displayName', 'aliases', 'status', 'openingBalance', 'currentBalance', 'createdAt', 'revision', 'lastCommandId', 'updatedAt'];
  if (!validStudentId(id)
    || !exactKeys(value, keys)
    || value.studentId !== id
    || !validStudentCode(value.studentCode)
    || typeof value.displayName !== 'string' || value.displayName.length < 1 || value.displayName.length > 100
    || !Array.isArray(value.aliases) || value.aliases.length > 10
    || !value.aliases.every(alias => typeof alias === 'string' && alias.length > 0 && alias.length <= 100)
    || (value.status !== 'active' && value.status !== 'inactive')
    || !exactKeys(value.openingBalance, ['amount', 'asOfDate', 'note', 'createdAt'])
    || !integer(value.openingBalance.amount, -1_000_000_000)
    || !validDate(value.openingBalance.asOfDate)
    || typeof value.openingBalance.note !== 'string' || value.openingBalance.note.length > 500
    || !(value.openingBalance.createdAt instanceof Timestamp)
    || !integer(value.currentBalance, -1_000_000_000)
    || !UUID.test(String(value.lastCommandId))
    || !integer(value.revision, 1, Number.MAX_SAFE_INTEGER)) {
    throw new CloudStudentRepositoryError('UNSUPPORTED_SCHEMA', `學生文件 ${id} schema 不支援`);
  }
  const createdAt = timestampIso(value.createdAt);
  const updatedAt = timestampIso(value.updatedAt);
  const openingCreatedAt = timestampIso(value.openingBalance.createdAt);
  if (!createdAt || !updatedAt || !openingCreatedAt) {
    throw new CloudStudentRepositoryError('UNSUPPORTED_SCHEMA', `學生文件 ${id} 缺少伺服器 Timestamp`);
  }
  return {
    studentId: id,
    studentCode: value.studentCode,
    displayName: value.displayName,
    aliases: [...value.aliases] as string[],
    status: value.status,
    openingBalance: {
      amount: value.openingBalance.amount,
      asOfDate: value.openingBalance.asOfDate,
      note: value.openingBalance.note,
      createdAt: openingCreatedAt,
    },
    currentBalance: value.currentBalance,
    createdAt,
    revision: value.revision,
    lastCommandId: value.lastCommandId as string,
    updatedAt,
  };
}

function readError(error: unknown): CloudStudentRepositoryError {
  if (error instanceof CloudStudentRepositoryError) return error;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code.includes('permission-denied')) return new CloudStudentRepositoryError('LEASE_LOST', '目前帳號沒有讀取學生名單的有效使用權');
  if (code.includes('unauthenticated')) return new CloudStudentRepositoryError('UNAUTHORIZED', '請重新登入 Google 操作員帳號');
  if (code.includes('resource-exhausted')) return new CloudStudentRepositoryError('QUOTA_EXCEEDED', '目前讀取次數已達服務限制');
  if (code.includes('unavailable') || code.includes('deadline-exceeded') || code.includes('cancelled')) {
    return new CloudStudentRepositoryError('OFFLINE', '無法連線確認雲端學生名單');
  }
  return new CloudStudentRepositoryError('UNKNOWN_RESULT', '無法從伺服器確認學生名單');
}

function assertAuthenticated(options: CloudStudentRepositoryOptions): void {
  const user = options.currentUser ? options.currentUser() : getCurrentUser();
  if (!user || !user.uid || !user.email || user.emailVerified !== true
    || !user.providerData.some(provider => provider.providerId === 'google.com')) {
    throw new CloudStudentRepositoryError('UNAUTHORIZED', '需要已驗證的 Google 操作員身分');
  }
}

function getCurrentUser(): CurrentUser | null {
  try {
    return getAuth().currentUser;
  } catch {
    return null;
  }
}

async function readHead(db: Firestore): Promise<ReturnType<typeof decodeHead>> {
  const snapshot = await getDocFromServer(doc(db, dataHeadPath()));
  if (!snapshot.exists()) throw new CloudStudentRepositoryError('UNSUPPORTED_SCHEMA', '雲端 dataHead 尚未初始化');
  return decodeHead(snapshot.data());
}

export async function listCloudStudents(db: Firestore, options: CloudStudentRepositoryOptions = {}): Promise<CloudStudentList> {
  try {
    assertAuthenticated(options);
    const before = await readHead(db);
    const students: CloudStudentRecord[] = [];
    const studentsCollection = collection(db, 'students');
    let cursor: DocumentSnapshot | undefined;
    let hasMore = true;

    while (hasMore) {
      const remainingProbeCount = MAX_STUDENTS + 1 - students.length;
      const pageLimit = Math.min(STUDENT_PAGE_SIZE, remainingProbeCount);
      if (pageLimit <= 0) {
        throw new CloudStudentRepositoryError('INCOMPLETE_SNAPSHOT', '學生名單超過 500 人，需使用分頁畫面');
      }
      const constraints = [orderBy(documentId()), ...(cursor ? [startAfter(cursor)] : []), limit(pageLimit)];
      const page = await getDocsFromServer(query(studentsCollection, ...constraints));
      if (students.length + page.size > MAX_STUDENTS) {
        throw new CloudStudentRepositoryError('INCOMPLETE_SNAPSHOT', '學生名單超過 500 人，未載入不完整名單');
      }
      for (const snapshot of page.docs) students.push(decodeStudent(snapshot.id, snapshot.data()));
      hasMore = page.size === pageLimit;
      cursor = page.docs.at(-1);
      if (students.length > MAX_STUDENTS) {
        throw new CloudStudentRepositoryError('INCOMPLETE_SNAPSHOT', '學生名單超過 500 人，未載入不完整名單');
      }
    }

    const after = await readHead(db);
    if (before.seq !== after.seq || before.datasetId !== after.datasetId || before.goLiveDate !== after.goLiveDate) {
      throw new CloudStudentRepositoryError('STALE_SNAPSHOT', '讀取期間雲端資料有更新，請重新載入名單');
    }
    return { students, seq: after.seq, datasetId: after.datasetId, goLiveDate: after.goLiveDate };
  } catch (error) {
    throw readError(error);
  }
}

export { CloudStudentRepositoryError as StudentRepositoryReadError };

export function createCloudStudentRepository(db: Firestore, options: CloudStudentRepositoryOptions = {}) {
  const commands = createCloudCommandRepository(db, options);

  return {
    list: () => listCloudStudents(db, options),
    createStudent(input: CreateCloudStudentInput): Promise<CommandResult> {
      return commands.commitCommand({
        commandId: input.commandId,
        kind: 'CreateStudent',
        leaseEpoch: input.leaseEpoch,
        targets: { studentId: input.studentId },
        expectedRevisions: { student: 0 },
        payload: {
          studentCode: input.studentCode,
          displayName: input.displayName,
          aliases: input.aliases,
          openingBalance: input.openingBalance,
        },
      });
    },
    changeStudentCode(input: ChangeCloudStudentCodeInput): Promise<CommandResult> {
      const { commandId, leaseEpoch, studentId, expectedRevision, studentCode, reason } = input;
      return commands.commitCommand({
        commandId,
        kind: 'ChangeStudentCode',
        leaseEpoch,
        targets: { studentId },
        expectedRevisions: { student: expectedRevision },
        payload: {
          studentCode,
          reason,
        },
      });
    },
    editStudent(input: EditCloudStudentInput): Promise<CommandResult> {
      const { commandId, leaseEpoch, studentId, expectedRevision, ...payload } = input;
      return commands.commitCommand({
        commandId,
        kind: 'EditStudent',
        leaseEpoch,
        targets: { studentId },
        expectedRevisions: { student: expectedRevision },
        payload,
      });
    },
    setStudentStatus(input: SetCloudStudentStatusInput): Promise<CommandResult> {
      const { commandId, leaseEpoch, studentId, expectedRevision, ...payload } = input;
      return commands.commitCommand({
        commandId,
        kind: 'SetStudentStatus',
        leaseEpoch,
        targets: { studentId },
        expectedRevisions: { student: expectedRevision },
        payload,
      });
    },
    readCommand(commandId: string): Promise<CommandReceipt | null> {
      return commands.readCommand(commandId);
    },
  };
}
