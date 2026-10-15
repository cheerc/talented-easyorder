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
  where,
  type CollectionReference,
  type DocumentSnapshot,
  type QueryFieldFilterConstraint,
  type Firestore,
} from 'firebase/firestore';
import type { CommandErrorCode, CommandReceipt, CommandResult } from '../domain/cloudCommands';
import {
  createCloudCommandRepository,
  type CloudCommandRepositoryOptions,
} from './cloudCommandRepository';
import { accessLeasePath, dataHeadPath, dayPath } from './firestorePaths';

type Data = Record<string, unknown>;
type CurrentUser = Pick<User, 'uid' | 'email' | 'emailVerified' | 'providerData'>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 200;
const MAX_VENDOR_DOCUMENTS = 500;
const MAX_SOURCE_DAY_DOCUMENTS = 2_000;
const INITIAL_SOURCE_WINDOW_DAYS = 32;
const MAX_SOURCE_WINDOW_DAYS = 4_096;

export interface CloudVendorRecord {
  vendorId: string;
  name: string;
  phone: string;
  note: string;
  status: 'active' | 'inactive';
  deleted: boolean;
  createdAt: string;
  revision: number;
  lastCommandId: string;
  updatedAt: string;
}

export interface CloudDayMenuRecord {
  businessDate: string;
  itemName: string;
  price: number;
  vendorId: string;
  vendorNameSnapshot: string;
  updatedAt: string;
  revision: number;
  inheritedFromDate: string | null;
}

export interface CloudDayTotalsRecord {
  activeTransactionCount: number;
  bentoCount: number;
  otherMealCount: number;
  mealTotal: number;
  retainedReceipts: number;
  cashierIncome: number;
  cashierExpense: number;
}

export interface CloudDayRecord {
  dayId: string;
  status: 'open' | 'closed' | 'reopened';
  revision: number;
  menu: CloudDayMenuRecord | null;
  openingCash: number | null;
  openedBy: string | null;
  openedAt: string | null;
  totals: CloudDayTotalsRecord;
  lastSettlementRevision: number;
  lastCommandId: string;
  updatedAt: string;
}

export type InheritanceBlock = 'vendor-missing' | 'vendor-inactive' | 'vendor-deleted' | 'vendor-renamed';

export interface CloudMenuSource {
  sourceDayId: string;
  menu: CloudDayMenuRecord;
  sourceVendor: CloudVendorRecord | null;
  blocked: InheritanceBlock | null;
}

export interface CloudDayVendorSnapshot {
  dayId: string;
  selectionDate: string;
  day: CloudDayRecord | null;
  vendors: CloudVendorRecord[];
  latestEarlierMenu: CloudMenuSource | null;
  seq: number;
  datasetId: string;
  goLiveDate: string;
}

export type CloudDayVendorReadErrorCode = CommandErrorCode | 'INCOMPLETE_SNAPSHOT' | 'STALE_SNAPSHOT';

export class CloudDayVendorRepositoryError extends Error {
  readonly code: CloudDayVendorReadErrorCode;

  constructor(code: CloudDayVendorReadErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'CloudDayVendorRepositoryError';
  }
}

export type CloudDayVendorRepositoryOptions = CloudCommandRepositoryOptions & {
  /** Test seam for bounded paging; production uses 200. */
  pageSize?: number;
};

export interface EnsureDayInput {
  commandId: string;
  leaseEpoch: number;
  dayId: string;
}

export interface SaveVendorInput {
  commandId: string;
  leaseEpoch: number;
  vendorId: string;
  expectedRevision: number;
  name: string;
  phone: string;
  note: string;
  status: 'active' | 'inactive';
}

export interface RemoveVendorInput {
  commandId: string;
  leaseEpoch: number;
  vendorId: string;
  expectedRevision: number;
  reason: string;
}

export interface SetDayMenuInput {
  commandId: string;
  leaseEpoch: number;
  dayId: string;
  selectionDate: string;
  expectedRevision: number;
  expectedHeadSeq: number;
  itemName: string;
  price: number;
  vendorId: string;
  vendorNameSnapshot: string;
  inheritedFromDate: string | null;
}

export interface SetOpeningCashInput {
  commandId: string;
  leaseEpoch: number;
  dayId: string;
  expectedRevision: number;
  openingCash: number;
}

export interface CloudDayVendorRepository {
  loadSnapshot(targetDayId?: string): Promise<CloudDayVendorSnapshot>;
  ensureDay(input: EnsureDayInput): Promise<CommandResult>;
  saveVendor(input: SaveVendorInput): Promise<CommandResult>;
  removeVendor(input: RemoveVendorInput): Promise<CommandResult>;
  setDayMenu(input: SetDayMenuInput): Promise<CommandResult>;
  setOpeningCash(input: SetOpeningCashInput): Promise<CommandResult>;
  readCommand(commandId: string): Promise<CommandReceipt | null>;
}

function isPlainRecord(value: unknown): value is Data {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: unknown, keys: string[]): value is Data {
  if (!isPlainRecord(value)) return false;
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validVendorId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 64 && !value.includes('/');
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0)
    && value >= minimum && value <= maximum;
}

function timestampIso(value: unknown): string | null {
  if (!(value instanceof Timestamp)) return null;
  const date = value.toDate();
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function taipeiDate(timestamp: Timestamp): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(timestamp.toDate());
  const part = (type: string) => parts.find(value => value.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function currentUser(options: CloudDayVendorRepositoryOptions): CurrentUser | null {
  if (options.currentUser) return options.currentUser();
  try {
    return getAuth().currentUser;
  } catch {
    return null;
  }
}

function requireGoogleUser(options: CloudDayVendorRepositoryOptions): CurrentUser {
  const user = currentUser(options);
  if (!user?.uid || !user.email || user.emailVerified !== true
    || !user.providerData.some(provider => provider.providerId === 'google.com')) {
    throw new CloudDayVendorRepositoryError('UNAUTHORIZED', '需要已驗證的 Google 操作員身分');
  }
  return user;
}

function readError(error: unknown): CloudDayVendorRepositoryError {
  if (error instanceof CloudDayVendorRepositoryError) return error;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code.includes('permission-denied')) return new CloudDayVendorRepositoryError('LEASE_LOST', '目前帳號沒有讀取營業日或供應商資料的有效使用權');
  if (code.includes('unauthenticated')) return new CloudDayVendorRepositoryError('UNAUTHORIZED', '請重新登入 Google 操作員帳號');
  if (code.includes('resource-exhausted')) return new CloudDayVendorRepositoryError('QUOTA_EXCEEDED', '目前讀取次數已達服務限制');
  if (code.includes('unavailable') || code.includes('deadline-exceeded') || code.includes('cancelled')) {
    return new CloudDayVendorRepositoryError('OFFLINE', '無法連線確認雲端營業日與供應商資料');
  }
  return new CloudDayVendorRepositoryError('UNKNOWN_RESULT', '無法從伺服器確認雲端營業日與供應商資料');
}

function decodeHead(value: unknown): { seq: number; datasetId: string; goLiveDate: string } {
  if (!hasExactKeys(value, ['schemaVersion', 'datasetId', 'seq', 'lastCommandId', 'maintenance', 'goLiveDate', 'updatedAt'])
    || value.schemaVersion !== 1 || typeof value.datasetId !== 'string' || !value.datasetId
    || !integer(value.seq) || (value.lastCommandId !== null && typeof value.lastCommandId !== 'string')
    || typeof value.maintenance !== 'boolean' || !validDate(value.goLiveDate)
    || !(value.updatedAt instanceof Timestamp)) {
    throw new CloudDayVendorRepositoryError('UNSUPPORTED_SCHEMA', '雲端 dataHead schema 不支援');
  }
  if (value.maintenance) throw new CloudDayVendorRepositoryError('MAINTENANCE', '系統正在維護，暫停讀取營業日與供應商資料');
  return { seq: value.seq, datasetId: value.datasetId, goLiveDate: value.goLiveDate };
}

function decodeLease(value: unknown, uid: string): { selectionDate: string } {
  if (!hasExactKeys(value, ['holderUid', 'epoch', 'updatedAt'])
    || value.holderUid !== uid || !integer(value.epoch) || !(value.updatedAt instanceof Timestamp)) {
    throw new CloudDayVendorRepositoryError('LEASE_LOST', '目前沒有有效的伺服器使用權租約');
  }
  return { selectionDate: taipeiDate(value.updatedAt) };
}

function decodeVendor(id: string, value: unknown): CloudVendorRecord {
  if (!validVendorId(id) || !hasExactKeys(value, [
    'vendorId', 'name', 'phone', 'note', 'status', 'deleted', 'createdAt', 'revision', 'lastCommandId', 'updatedAt',
  ]) || value.vendorId !== id
    || typeof value.name !== 'string' || value.name.length < 1 || value.name.length > 100
    || typeof value.phone !== 'string' || value.phone.length > 100
    || typeof value.note !== 'string' || value.note.length > 500
    || (value.status !== 'active' && value.status !== 'inactive') || typeof value.deleted !== 'boolean'
    || !integer(value.revision, 1) || typeof value.lastCommandId !== 'string' || !UUID.test(value.lastCommandId)) {
    throw new CloudDayVendorRepositoryError('UNSUPPORTED_SCHEMA', `供應商文件 ${id} schema 不支援`);
  }
  const createdAt = timestampIso(value.createdAt);
  const updatedAt = timestampIso(value.updatedAt);
  if (!createdAt || !updatedAt) throw new CloudDayVendorRepositoryError('UNSUPPORTED_SCHEMA', `供應商文件 ${id} 缺少伺服器 Timestamp`);
  return {
    vendorId: id, name: value.name, phone: value.phone, note: value.note,
    status: value.status, deleted: value.deleted, createdAt,
    revision: value.revision, lastCommandId: value.lastCommandId, updatedAt,
  };
}

function decodeDay(id: string, value: unknown): CloudDayRecord {
  const keys = [
    'status', 'revision', 'menu', 'openingCash', 'openedBy', 'openedAt', 'totals',
    'lastSettlementRevision', 'lastCommandId', 'updatedAt',
  ];
  if (!validDate(id) || !hasExactKeys(value, keys)
    || !['open', 'closed', 'reopened'].includes(String(value.status))
    || !integer(value.revision, 1)
    || (value.openingCash !== null && !integer(value.openingCash, 0, 20_000))
    || (value.openedBy !== null && (typeof value.openedBy !== 'string' || !value.openedBy))
    || (value.openedAt !== null && !(value.openedAt instanceof Timestamp))
    || ((value.openingCash === null) !== (value.openedBy === null))
    || ((value.openingCash === null) !== (value.openedAt === null))
    || !hasExactKeys(value.totals, [
      'activeTransactionCount', 'bentoCount', 'otherMealCount', 'mealTotal',
      'retainedReceipts', 'cashierIncome', 'cashierExpense',
    ]) || !integer(value.totals.activeTransactionCount)
    || !integer(value.totals.bentoCount)
    || !integer(value.totals.otherMealCount)
    || !integer(value.totals.mealTotal, 0, 1_000_000_000)
    || !integer(value.totals.retainedReceipts, 0, 1_000_000_000)
    || !integer(value.totals.cashierIncome, 0, 1_000_000_000)
    || !integer(value.totals.cashierExpense, 0, 1_000_000_000)
    || !integer(value.lastSettlementRevision)
    || typeof value.lastCommandId !== 'string' || !UUID.test(value.lastCommandId)) {
    throw new CloudDayVendorRepositoryError('UNSUPPORTED_SCHEMA', `營業日文件 ${id} schema 不支援`);
  }
  let menu: CloudDayMenuRecord | null = null;
  if (value.menu !== null) {
    const raw = value.menu;
    if (!hasExactKeys(raw, [
      'businessDate', 'itemName', 'price', 'vendorId', 'vendorNameSnapshot', 'updatedAt', 'revision', 'inheritedFromDate',
    ]) || raw.businessDate !== id || !validDate(raw.businessDate)
      || typeof raw.itemName !== 'string' || raw.itemName.length < 1 || raw.itemName.length > 100
      || !integer(raw.price, 1, 1_000_000) || !validVendorId(raw.vendorId)
      || typeof raw.vendorNameSnapshot !== 'string' || raw.vendorNameSnapshot.length < 1 || raw.vendorNameSnapshot.length > 100
      || !integer(raw.revision, 1) || (raw.inheritedFromDate !== null && !validDate(raw.inheritedFromDate))) {
      throw new CloudDayVendorRepositoryError('UNSUPPORTED_SCHEMA', `營業日 ${id} 菜單 schema 不支援`);
    }
    const updatedAt = timestampIso(raw.updatedAt);
    if (!updatedAt) throw new CloudDayVendorRepositoryError('UNSUPPORTED_SCHEMA', `營業日 ${id} 菜單缺少伺服器 Timestamp`);
    menu = {
      businessDate: id, itemName: raw.itemName, price: raw.price, vendorId: raw.vendorId,
      vendorNameSnapshot: raw.vendorNameSnapshot, updatedAt, revision: raw.revision,
      inheritedFromDate: raw.inheritedFromDate,
    };
  }
  const updatedAt = timestampIso(value.updatedAt);
  const openedAt = value.openedAt === null ? null : timestampIso(value.openedAt);
  if (!updatedAt || (value.openedAt !== null && !openedAt)) {
    throw new CloudDayVendorRepositoryError('UNSUPPORTED_SCHEMA', `營業日 ${id} 缺少伺服器 Timestamp`);
  }
  const totals = value.totals as Data;
  return {
    dayId: id,
    status: value.status as CloudDayRecord['status'],
    revision: value.revision,
    menu,
    openingCash: value.openingCash as number | null,
    openedBy: value.openedBy as string | null,
    openedAt,
    totals: {
      activeTransactionCount: totals.activeTransactionCount as number,
      bentoCount: totals.bentoCount as number,
      otherMealCount: totals.otherMealCount as number,
      mealTotal: totals.mealTotal as number,
      retainedReceipts: totals.retainedReceipts as number,
      cashierIncome: totals.cashierIncome as number,
      cashierExpense: totals.cashierExpense as number,
    },
    lastSettlementRevision: value.lastSettlementRevision as number,
    lastCommandId: value.lastCommandId as string,
    updatedAt,
  };
}

async function readHead(db: Firestore): Promise<ReturnType<typeof decodeHead>> {
  const snapshot = await getDocFromServer(doc(db, dataHeadPath()));
  if (!snapshot.exists()) throw new CloudDayVendorRepositoryError('UNSUPPORTED_SCHEMA', '雲端 dataHead 尚未初始化');
  return decodeHead(snapshot.data());
}

async function readVendorRecords(db: Firestore, pageSize: number): Promise<CloudVendorRecord[]> {
  const vendors: CloudVendorRecord[] = [];
  const vendorCollection = collection(db, 'vendors');
  let cursor: DocumentSnapshot | undefined;
  while (vendors.length < MAX_VENDOR_DOCUMENTS) {
    const remaining = MAX_VENDOR_DOCUMENTS - vendors.length;
    const size = Math.min(pageSize, remaining);
    const page = await getDocsFromServer(query(
      vendorCollection,
      orderBy(documentId()),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(size),
    ));
    for (const snapshot of page.docs) vendors.push(decodeVendor(snapshot.id, snapshot.data()));
    if (page.docs.length < size) return vendors;
    cursor = page.docs[page.docs.length - 1];
  }
  const probe = await getDocsFromServer(query(
    vendorCollection, orderBy(documentId()), startAfter(cursor!), limit(1),
  ));
  if (!probe.empty) throw new CloudDayVendorRepositoryError('INCOMPLETE_SNAPSHOT', '供應商數量超過完整讀取上限 500');
  return vendors;
}

function shiftDayId(dayId: string, days: number): string | null {
  const value = new Date(Date.parse(`${dayId}T00:00:00.000Z`) + days * 86_400_000);
  if (Number.isNaN(value.getTime()) || value.getUTCFullYear() < 1) return null;
  return value.toISOString().slice(0, 10);
}

// Firestore Emulator rejects document-ID DESC scans ("descending key scans"), so the newest
// eligible source is found by walking calendar-date windows backwards. Each window is read in
// ascending document-ID order and then processed newest-first, so the processing order, the
// 2,000-document scan cap and every strict row decode match a descending document-ID scan.
async function readSourceWindow(
  days: CollectionReference,
  bounds: QueryFieldFilterConstraint[],
  maximum: number,
  pageSize: number,
): Promise<DocumentSnapshot[]> {
  const found: DocumentSnapshot[] = [];
  let cursor: DocumentSnapshot | undefined;
  while (found.length < maximum) {
    const size = Math.min(pageSize, maximum - found.length);
    const page = await getDocsFromServer(query(
      days,
      ...bounds,
      orderBy(documentId()),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(size),
    ));
    found.push(...page.docs);
    if (page.docs.length < size) break;
    cursor = page.docs[page.docs.length - 1];
  }
  return found;
}

async function readLatestEarlierMenu(
  db: Firestore,
  targetDayId: string,
  selectionDate: string,
  vendors: CloudVendorRecord[],
  pageSize: number,
): Promise<CloudMenuSource | null> {
  const days = collection(db, 'days');
  const eligible = [where(documentId(), '<', targetDayId), where(documentId(), '<=', selectionDate)];
  const previousDay = shiftDayId(targetDayId, -1);
  const newest = previousDay !== null && previousDay < selectionDate ? previousDay : selectionDate;
  let upper: string | null = null;
  let span = INITIAL_SOURCE_WINDOW_DAYS;
  let scanned = 0;
  for (;;) {
    const remaining = MAX_SOURCE_DAY_DOCUMENTS - scanned;
    // Canonical day IDs hold at most one document per calendar date, so a window no wider than
    // the remaining cap cannot overflow unless malformed IDs exist.
    span = Math.max(1, Math.min(span, remaining));
    const windowNewest: string | null = upper === null ? newest : shiftDayId(upper, -1);
    const lower: string | null = windowNewest === null ? null : shiftDayId(windowNewest, -(span - 1));
    const bounds = [
      ...eligible,
      ...(upper === null ? [] : [where(documentId(), '<', upper)]),
      ...(lower === null ? [] : [where(documentId(), '>=', lower)]),
    ];
    const window = await readSourceWindow(days, bounds, remaining + 1, pageSize);
    if (window.length > remaining) {
      // More physical rows than the cap allows: narrow the window so only its newest rows count.
      if (span > 1 && lower !== null) {
        span = Math.max(1, Math.floor(span / 2));
        continue;
      }
      throw new CloudDayVendorRepositoryError('INCOMPLETE_SNAPSHOT', '最近菜單來源超過完整掃描上限 2,000 個營業日');
    }
    for (const snapshot of window.reverse()) {
      scanned += 1;
      const day = decodeDay(snapshot.id, snapshot.data());
      if (!day.menu) continue;
      const vendor = vendors.find(item => item.vendorId === day.menu!.vendorId) ?? null;
      let blocked: InheritanceBlock | null = null;
      if (!vendor) blocked = 'vendor-missing';
      else if (vendor.deleted) blocked = 'vendor-deleted';
      else if (vendor.status !== 'active') blocked = 'vendor-inactive';
      else if (vendor.name !== day.menu.vendorNameSnapshot) blocked = 'vendor-renamed';
      return { sourceDayId: snapshot.id, menu: day.menu, sourceVendor: vendor, blocked };
    }
    if (lower === null) return null;
    const older = await getDocsFromServer(query(
      days, ...eligible, where(documentId(), '<', lower), orderBy(documentId()), limit(1),
    ));
    if (older.empty) return null;
    if (scanned >= MAX_SOURCE_DAY_DOCUMENTS) {
      throw new CloudDayVendorRepositoryError('INCOMPLETE_SNAPSHOT', '最近菜單來源超過完整掃描上限 2,000 個營業日');
    }
    upper = lower;
    span = Math.min(span * 2, MAX_SOURCE_WINDOW_DAYS);
  }
}

export function createCloudDayVendorRepository(
  db: Firestore,
  options: CloudDayVendorRepositoryOptions = {},
): CloudDayVendorRepository {
  const pageSize = options.pageSize ?? PAGE_SIZE;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > PAGE_SIZE) {
    throw new RangeError('pageSize must be an integer from 1 through 200');
  }
  const commandRepository = createCloudCommandRepository(db, options);

  async function loadSnapshot(targetDayId?: string): Promise<CloudDayVendorSnapshot> {
    try {
      const user = requireGoogleUser(options);
      const before = await readHead(db);
      const leaseSnapshot = await getDocFromServer(doc(db, accessLeasePath()));
      if (!leaseSnapshot.exists()) throw new CloudDayVendorRepositoryError('LEASE_LOST', '使用權租約不存在');
      const { selectionDate } = decodeLease(leaseSnapshot.data(), user.uid);
      const dayId = targetDayId ?? selectionDate;
      if (!validDate(dayId)) throw new CloudDayVendorRepositoryError('INVALID_INPUT', '營業日必須是 YYYY-MM-DD');
      if (dayId < before.goLiveDate) throw new CloudDayVendorRepositoryError('INVALID_INPUT', '營業日早於系統啟用日期');

      const [daySnapshot, physicalVendors] = await Promise.all([
        getDocFromServer(doc(db, dayPath(dayId))),
        readVendorRecords(db, pageSize),
      ]);
      const visibleVendors = physicalVendors.filter(vendor => !vendor.deleted);
      const latestEarlierMenu = await readLatestEarlierMenu(db, dayId, selectionDate, physicalVendors, pageSize);
      const leaseAfter = await getDocFromServer(doc(db, accessLeasePath()));
      if (!leaseAfter.exists() || decodeLease(leaseAfter.data(), user.uid).selectionDate !== selectionDate) {
        throw new CloudDayVendorRepositoryError('STALE_SNAPSHOT', '伺服器租約日期在讀取期間更新，請重新載入');
      }
      const after = await readHead(db);
      if (before.seq !== after.seq || before.datasetId !== after.datasetId || before.goLiveDate !== after.goLiveDate) {
        throw new CloudDayVendorRepositoryError('STALE_SNAPSHOT', '讀取期間雲端資料已變更，請重新載入');
      }
      return {
        dayId,
        selectionDate,
        day: daySnapshot.exists() ? decodeDay(dayId, daySnapshot.data()) : null,
        vendors: visibleVendors,
        latestEarlierMenu,
        seq: before.seq,
        datasetId: before.datasetId,
        goLiveDate: before.goLiveDate,
      };
    } catch (error) {
      throw readError(error);
    }
  }

  return {
    loadSnapshot,
    ensureDay: input => commandRepository.commitCommand({
      commandId: input.commandId, kind: 'EnsureDay', leaseEpoch: input.leaseEpoch,
      targets: { dayId: input.dayId }, expectedRevisions: { day: 0 },
      payload: { businessDate: input.dayId },
    }),
    saveVendor: input => commandRepository.commitCommand({
      commandId: input.commandId, kind: 'SaveVendor', leaseEpoch: input.leaseEpoch,
      targets: { vendorId: input.vendorId }, expectedRevisions: { vendor: input.expectedRevision },
      payload: {
        vendorId: input.vendorId, name: input.name, phone: input.phone, note: input.note, status: input.status,
      },
    }),
    removeVendor: input => commandRepository.commitCommand({
      commandId: input.commandId, kind: 'RemoveVendor', leaseEpoch: input.leaseEpoch,
      targets: { vendorId: input.vendorId }, expectedRevisions: { vendor: input.expectedRevision },
      payload: { reason: input.reason },
    }),
    setDayMenu: input => commandRepository.commitCommand({
      commandId: input.commandId, kind: 'SetDayMenu', leaseEpoch: input.leaseEpoch,
      targets: { dayId: input.dayId },
      expectedRevisions: { day: input.expectedRevision, headSeq: input.expectedHeadSeq },
      payload: {
        selectionDate: input.selectionDate, itemName: input.itemName, price: input.price,
        vendorId: input.vendorId, vendorNameSnapshot: input.vendorNameSnapshot,
        inheritedFromDate: input.inheritedFromDate,
      },
    }),
    setOpeningCash: input => commandRepository.commitCommand({
      commandId: input.commandId, kind: 'SetOpeningCash', leaseEpoch: input.leaseEpoch,
      targets: { dayId: input.dayId }, expectedRevisions: { day: input.expectedRevision },
      payload: { openingCash: input.openingCash },
    }),
    readCommand: commandRepository.readCommand,
  };
}
