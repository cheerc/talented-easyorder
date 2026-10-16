/** Versioned, client-side encrypted command archive. No credentials or keys are persisted. */
export const BACKUP_FORMAT = 'easyorder-command-backup' as const;
export const BACKUP_SCHEMA_VERSION = 1 as const;
export const BACKUP_KDF_ITERATIONS = 600_000;
export const BACKUP_MAX_BYTES = 50 * 1024 * 1024;

export interface BackupCommandRecord {
  commandId: string;
  kind: string;
  seq: number;
  datasetId: string;
  schemaVersion: number;
  targets: Record<string, unknown>;
  expectedRevisions: Record<string, unknown>;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  payload: Record<string, unknown>;
  actor: Record<string, unknown>;
  committedAt: unknown;
  businessDate: string | null;
  studentId: string | null;
  reason: string | null;
  cashEffect: Record<string, unknown>;
  inputFingerprint: string;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  datasetId: string;
  commandSchemaVersion: number;
  fromSeq: number;
  toSeq: number;
  headCommandId: string | null;
  previousPackageSha256: string | null;
  generatedAt: string;
  recordCount: number;
  records: BackupCommandRecord[];
  baseState: Record<string, unknown>;
  projectionState: Record<string, unknown>;
  totals: Record<string, unknown> | null;
}

export interface EncryptedBackupFile {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  cipher: 'AES-GCM';
  salt: string;
  iv: string;
  ciphertext: string;
}

export class BackupValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'BackupValidationError'; }
}

function resourcePath(projection: string, targets: Record<string, unknown>): string {
  if (projection === 'day' && typeof targets.dayId === 'string') return `days/${targets.dayId}`;
  if (projection === 'student' && typeof targets.studentId === 'string') return `students/${targets.studentId}`;
  if (projection === 'vendor' && typeof targets.vendorId === 'string') return `vendors/${targets.vendorId}`;
  if (projection === 'transaction' && typeof targets.transactionId === 'string') return `transactions/${targets.transactionId}`;
  if (projection === 'settlement' && typeof targets.dayId === 'string') return `daily_settlements/${targets.dayId}`;
  throw new BackupValidationError(`無法從 targets 對映 ${projection} 投影`);
}

function sameValue(left: unknown, right: unknown): boolean { return stableJson(left) === stableJson(right); }

function recalculateDayTotals(projections: Record<string, unknown>): Record<string, Record<string, number>> {
  const days = Object.entries(projections).filter(([path, value]) => path.startsWith('days/') && value !== null);
  const transactions = Object.entries(projections).filter(([path, value]) => path.startsWith('transactions/') && value !== null)
    .map(([, value]) => value as Record<string, unknown>);
  const result: Record<string, Record<string, number>> = {};
  for (const [path, rawDay] of days) {
    const dayId = path.slice('days/'.length);
    const dayTransactions = transactions.filter(transaction => transaction.businessDate === dayId);
    const active = dayTransactions.filter(transaction => transaction.status === 'active');
    if (dayTransactions.some(transaction => transaction.status !== 'active' && transaction.status !== 'voided')) {
      throw new BackupValidationError(`營業日 ${dayId} 含未知交易狀態，無法重算 totals`);
    }
    const computed = {
      activeTransactionCount: active.length,
      bentoCount: active.filter(transaction => transaction.type === 'order' && transaction.mealKind === 'bento').length,
      otherMealCount: active.filter(transaction => transaction.type === 'order' && transaction.mealKind === 'other').length,
      mealTotal: active.reduce((sum, transaction) => sum + (transaction.type === 'order' ? Number(transaction.mealPrice) : 0), 0),
      retainedReceipts: active.reduce((sum, transaction) => sum + (transaction.type === 'order' || transaction.type === 'payment' ? Number(transaction.paidAmount) : 0), 0),
      cashierIncome: active.reduce((sum, transaction) => sum + (transaction.type === 'expense' ? Number(transaction.paidAmount) : 0), 0),
      cashierExpense: active.reduce((sum, transaction) => sum + (transaction.type === 'expense' ? Number(transaction.mealPrice) : 0), 0),
      accountRefunds: active.reduce((sum, transaction) => sum + (transaction.type === 'refund' ? Number(transaction.amount) : 0), 0),
    };
    if (Object.values(computed).some(number => !Number.isSafeInteger(number) || number < 0)) {
      throw new BackupValidationError(`營業日 ${dayId} 重算 totals 超出有效整數範圍`);
    }
    const storedDay = rawDay as Record<string, unknown>;
    if (!sameValue(storedDay.totals, computed)) throw new BackupValidationError(`營業日 ${dayId} 的 day totals 與 command 重播結果不同`);
    result[dayId] = computed;
  }
  return result;
}

function replayProjections(records: BackupCommandRecord[], initial: Record<string, unknown>): Record<string, unknown> {
  const state = structuredClone(initial);
  for (const record of records) {
    const before = record.before ?? {};
    const after = record.after ?? {};
    for (const projection of ['day', 'student', 'vendor', 'transaction', 'settlement']) {
      if (!(projection in before) && !(projection in after)) continue;
      if (!(projection in before) || !(projection in after)) {
        throw new BackupValidationError(`command ${record.commandId} 的 ${projection} before/after 投影不完整`);
      }
      const key = resourcePath(projection, record.targets);
      const hasPrevious = Object.hasOwn(state, key);
      const previous = hasPrevious ? state[key] : null;
      if (!sameValue(previous, before[projection])) {
        throw new BackupValidationError(`command seq ${record.seq} ${projection} before 與前序重播狀態不符`);
      }
      state[key] = after[projection];
    }
    const unknownProjection = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter(key => key !== 'head' && !['day', 'student', 'vendor', 'transaction', 'settlement'].includes(key));
    if (unknownProjection.length) throw new BackupValidationError(`command seq ${record.seq} 含未知投影：${unknownProjection.join(', ')}`);
  }
  recalculateDayTotals(state);
  return state;
}

export function replayBackupProjections(records: BackupCommandRecord[], initial: Record<string, unknown> = {}): Record<string, unknown> {
  return replayProjections(records, initial);
}

export function recalculateBackupTotals(projections: Record<string, unknown>): Record<string, Record<string, number>> {
  return recalculateDayTotals(projections);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  try { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
  catch { throw new BackupValidationError('備份加密資料格式損毀'); }
}

function utf8(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(value));
}

function exactBuffer(bytes: Uint8Array<ArrayBufferLike>): ArrayBuffer {
  return Uint8Array.from(bytes).buffer as ArrayBuffer;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBufferLike>, iterations: number): Promise<CryptoKey> {
  if (typeof password !== 'string' || password.length < 1) throw new BackupValidationError('請輸入備份密碼');
  const material = await crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: exactBuffer(salt), iterations }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(',')}}`;
}

export async function sha256Hex(value: BufferSource | Uint8Array<ArrayBufferLike> | string): Promise<string> {
  const bytes = typeof value === 'string' ? utf8(value) : value;
  const digestInput = bytes instanceof ArrayBuffer ? bytes : exactBuffer(
    new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  );
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', digestInput));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function validateManifest(value: unknown): asserts value is BackupManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BackupValidationError('備份 manifest 格式不支援');
  const manifest = value as Partial<BackupManifest>;
  const fromSeq = manifest.fromSeq as number;
  const toSeq = manifest.toSeq as number;
  if (manifest.format !== BACKUP_FORMAT || manifest.schemaVersion !== BACKUP_SCHEMA_VERSION
    || typeof manifest.datasetId !== 'string' || manifest.datasetId.length === 0
    || manifest.commandSchemaVersion !== 1
    || !Number.isSafeInteger(manifest.fromSeq) || !Number.isSafeInteger(manifest.toSeq)
    || (manifest.fromSeq as number) < 0 || (manifest.toSeq as number) < (manifest.fromSeq as number)
    || !Array.isArray(manifest.records) || manifest.recordCount !== manifest.records.length
    || toSeq - fromSeq !== manifest.recordCount
    || (toSeq === 0 ? manifest.headCommandId !== null : typeof manifest.headCommandId !== 'string')
    || typeof manifest.generatedAt !== 'string'
    || !manifest.baseState || typeof manifest.baseState !== 'object' || Array.isArray(manifest.baseState)
    || !manifest.projectionState || typeof manifest.projectionState !== 'object' || Array.isArray(manifest.projectionState)
    || !manifest.totals || typeof manifest.totals !== 'object' || Array.isArray(manifest.totals)
    || (manifest.previousPackageSha256 !== null && !/^[a-f0-9]{64}$/.test(manifest.previousPackageSha256 ?? ''))) {
    throw new BackupValidationError('備份 manifest 欄位或範圍不一致');
  }
  const totalsKeys = ['activeTransactionCount', 'bentoCount', 'otherMealCount', 'mealTotal', 'retainedReceipts', 'cashierIncome', 'cashierExpense', 'accountRefunds'];
  for (const [dayId, totals] of Object.entries(manifest.totals)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayId) || !totals || typeof totals !== 'object' || Array.isArray(totals)
      || JSON.stringify(Object.keys(totals).sort()) !== JSON.stringify([...totalsKeys].sort())
      || Object.values(totals).some(item => !Number.isSafeInteger(item) || (item as number) < 0)) {
      throw new BackupValidationError(`備份 totals 的營業日 ${dayId} 格式無效`);
    }
  }
  const ids = new Set<string>();
  const targetKeysByKind: Record<string, string[]> = {
    EnsureDay: ['dayId'], CreateStudent: ['studentId'], ChangeStudentCode: ['studentId'],
    EditStudent: ['studentId'], SetStudentStatus: ['studentId'], CorrectOpening: ['studentId', 'dayId'],
    SaveVendor: ['vendorId'], RemoveVendor: ['vendorId'], SetDayMenu: ['dayId'], SetOpeningCash: ['dayId'],
    CreateOrder: ['transactionId', 'studentId', 'dayId'], CreatePayment: ['transactionId', 'studentId', 'dayId'],
    CreateCashMovement: ['transactionId', 'dayId'], CreateRefund: ['transactionId', 'studentId', 'dayId'],
    CorrectTransaction: ['transactionId', 'studentId', 'dayId'], VoidTransaction: ['transactionId', 'studentId', 'dayId'],
    CancelKeepDeposit: ['transactionId', 'studentId', 'dayId'], CancelRefund: ['transactionId', 'studentId', 'dayId'],
    Undo: ['transactionId', 'studentId', 'dayId'], CloseDay: ['dayId', 'settlementRevision'],
    ReopenDay: ['dayId', 'settlementRevision'], RecordExport: [], RecordPrint: [], RecordBackup: [],
  };
  const payloadFieldsByKind: Record<string, { required: string[]; optional?: string[] }> = {
    EnsureDay: { required: ['businessDate'] }, CreateStudent: { required: ['studentCode', 'displayName', 'aliases', 'openingBalance'] },
    ChangeStudentCode: { required: ['studentCode', 'reason'] }, EditStudent: { required: [], optional: ['displayName', 'aliases'] },
    SetStudentStatus: { required: ['status', 'reason'] }, CorrectOpening: { required: ['amount', 'note', 'reason'] },
    SaveVendor: { required: ['vendorId', 'name', 'phone', 'note', 'status'] }, RemoveVendor: { required: ['reason'] },
    SetDayMenu: { required: ['selectionDate', 'itemName', 'price', 'vendorId', 'vendorNameSnapshot', 'inheritedFromDate'] },
    SetOpeningCash: { required: ['openingCash'] },
    CreateOrder: { required: ['mealPrice', 'paidAmount', 'mealKind'], optional: ['menuRevision', 'otherItemName', 'note'] },
    CreatePayment: { required: ['paidAmount'], optional: ['note'] },
    CreateCashMovement: { required: ['mealPrice', 'paidAmount', 'reason'] }, CreateRefund: { required: ['amount', 'reason'] },
    CorrectTransaction: { required: ['mealPrice', 'paidAmount', 'note', 'reason'] }, VoidTransaction: { required: ['reason'] },
    CancelKeepDeposit: { required: ['reason'] }, CancelRefund: { required: ['reason'] }, Undo: { required: ['targetCommandId', 'reason'] },
    CloseDay: { required: ['countedCash'], optional: ['note', 'expectedCash'] }, ReopenDay: { required: ['reason'] },
    RecordExport: { required: ['exportType', 'sourceSeq'], optional: ['dateRange'] },
    RecordPrint: { required: ['printType', 'businessDate', 'sourceSeq'] },
    RecordBackup: { required: ['backupType', 'sourceSeq', 'fromSeq', 'toSeq', 'sha256'] },
  };
  const revisionProjection: Record<string, string> = {
    day: 'day', student: 'student', vendor: 'vendor', transaction: 'transaction', settlement: 'settlement',
  };
  manifest.records.forEach((record, index) => {
    const seq = fromSeq + index + 1;
    const targets = record?.targets;
    const before = record?.before;
    const after = record?.after;
    const expectedTargets = targetKeysByKind[record?.kind ?? ''];
    const payloadFields = payloadFieldsByKind[record?.kind ?? ''];
    const payloadNames = record?.payload && typeof record.payload === 'object' ? Object.keys(record.payload) : [];
    const targetNames = targets && typeof targets === 'object' ? Object.keys(targets).sort() : [];
    const beforeNames = before && typeof before === 'object' ? Object.keys(before).sort() : [];
    const afterNames = after && typeof after === 'object' ? Object.keys(after).sort() : [];
    const expectedRevisions = record?.expectedRevisions as Record<string, unknown> | undefined;
    const validRevisionKeys = expectedRevisions && Object.entries(expectedRevisions).every(([key, revision]) =>
      Number.isSafeInteger(revision) && (revision as number) >= 0
      && (key === 'headSeq' || key in revisionProjection));
    const headBefore = before?.head as Record<string, unknown> | undefined;
    const headAfter = after?.head as Record<string, unknown> | undefined;
    if (!record || record.seq !== seq || !record.commandId || ids.has(record.commandId)
      || record.datasetId !== manifest.datasetId || record.schemaVersion !== manifest.commandSchemaVersion
      || !record.kind || !record.targets || !record.expectedRevisions || !record.payload || !record.actor
      || !record.cashEffect || !/^[a-f0-9]{64}$/.test(record.inputFingerprint)
      || !expectedTargets || !(JSON.stringify(targetNames) === JSON.stringify([...expectedTargets].sort())
        || record.kind === 'Undo' && JSON.stringify(targetNames) === JSON.stringify(['dayId', 'transactionId']))
      || !payloadFields || payloadFields.required.some(key => !payloadNames.includes(key))
      || payloadNames.some(key => ![...payloadFields.required, ...(payloadFields.optional ?? [])].includes(key))
      || !validRevisionKeys || !before || !after || !headBefore || !headAfter
      || headBefore.seq !== seq - 1 || headAfter.seq !== seq || headAfter.lastCommandId !== record.commandId
      || !beforeNames.includes('head') || !afterNames.includes('head')) {
      throw new BackupValidationError(`備份命令鏈在 seq ${seq} 不連續或欄位無效`);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.commandId)
      || !/^[a-f0-9]{64}$/.test(record.inputFingerprint)
      || !record.actor || typeof record.actor.uid !== 'string' || !record.actor.uid
      || typeof record.actor.email !== 'string' || !record.actor.email.includes('@')) {
      throw new BackupValidationError(`command seq ${seq} actor、commandId 或 fingerprint 欄位無效`);
    }
    const cashEffect = record.cashEffect as Record<string, unknown>;
    const cashKeys = ['before', 'after', 'delta', 'reasonKind', 'refundAmount'];
    if (JSON.stringify(Object.keys(cashEffect).sort()) !== JSON.stringify([...cashKeys].sort())
      || cashKeys.filter(key => key !== 'reasonKind').some(key => !Number.isSafeInteger(cashEffect[key]))
      || !['collection', 'payout', 'refund', 'correction', 'reversal', 'none'].includes(String(cashEffect.reasonKind))) {
      throw new BackupValidationError(`command seq ${seq} cashEffect schema 無效`);
    }
    if (record.kind === 'RecordBackup') {
      const payload = record.payload;
      if (headBefore.datasetId !== manifest.datasetId || headAfter.datasetId !== manifest.datasetId
        || headBefore.schemaVersion !== manifest.commandSchemaVersion || headAfter.schemaVersion !== manifest.commandSchemaVersion
        || beforeNames.join(',') !== 'head' || afterNames.join(',') !== 'head'
        || payload.backupType !== 'command-incremental' || payload.sourceSeq !== seq - 1
        || payload.toSeq !== payload.sourceSeq || !Number.isSafeInteger(payload.fromSeq)
        || (payload.fromSeq as number) < 0 || (payload.fromSeq as number) > (payload.toSeq as number)
        || !/^[a-f0-9]{64}$/.test(String(payload.sha256))) {
        throw new BackupValidationError(`RecordBackup receipt 在 seq ${seq} 無法驗證`);
      }
    } else {
      for (const [revisionName, projectionName] of Object.entries(revisionProjection)) {
        if (!(revisionName in (expectedRevisions ?? {}))) continue;
        const expected = (expectedRevisions as Record<string, number>)[revisionName];
        const snapshot = before?.[projectionName] as Record<string, unknown> | null | undefined;
        const actual = snapshot === null ? 0 : snapshot?.revision ?? snapshot?.settlementRevision;
        if (actual !== expected) throw new BackupValidationError(`command seq ${seq} ${revisionName} before revision 不一致`);
        const afterSnapshot = after?.[projectionName] as Record<string, unknown> | null | undefined;
        const afterRevision = afterSnapshot?.revision ?? afterSnapshot?.settlementRevision;
        if (afterRevision !== expected + 1) throw new BackupValidationError(`command seq ${seq} ${revisionName} after revision 不連續`);
      }
      if ('headSeq' in expectedRevisions && expectedRevisions.headSeq !== headBefore.seq) {
        throw new BackupValidationError(`command seq ${seq} headSeq before revision 不一致`);
      }
    }
    ids.add(record.commandId);
  });
  if (manifest.recordCount > 0 && manifest.records.at(-1)?.commandId !== manifest.headCommandId) {
    throw new BackupValidationError('manifest headCommandId 與最後一筆 command 不一致');
  }
  if (fromSeq === 0 && Object.keys(manifest.baseState).length !== 0) {
    throw new BackupValidationError('首次完整備份的 baseState 必須為空');
  }
  const replayed = replayProjections(manifest.records, manifest.baseState);
  if (!sameValue(replayed, manifest.projectionState)) throw new BackupValidationError('projectionState 與 command 重播結果不同');
  const replayedTotals = recalculateDayTotals(replayed);
  if (!sameValue(replayedTotals, manifest.totals)) throw new BackupValidationError('manifest totals 與 command 重播結果不同');
}

export function validateBackupManifest(value: unknown): BackupManifest {
  validateManifest(value);
  return value;
}

export function createBackupManifest(args: Omit<BackupManifest, 'format' | 'schemaVersion' | 'recordCount'>): BackupManifest {
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION,
    ...args, recordCount: args.records.length,
  };
  validateManifest(manifest);
  return manifest;
}

export async function encryptBackup(manifest: BackupManifest, password: string): Promise<Uint8Array<ArrayBuffer>> {
  validateManifest(manifest);
  const plaintext = utf8(stableJson(manifest));
  if (plaintext.byteLength > BACKUP_MAX_BYTES) throw new BackupValidationError('備份超過 50 MiB 上限；本次沒有產生備份');
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const key = await deriveKey(password, salt, BACKUP_KDF_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const container: EncryptedBackupFile = {
    format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION,
    kdf: 'PBKDF2-SHA256', iterations: BACKUP_KDF_ITERATIONS,
    cipher: 'AES-GCM', salt: bytesToBase64(salt), iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
  const bytes = utf8(stableJson(container));
  if (bytes.byteLength > BACKUP_MAX_BYTES) throw new BackupValidationError('加密備份超過 50 MiB 上限');
  return bytes;
}

export async function decryptBackup(bytes: BufferSource, password: string): Promise<BackupManifest> {
  const input = bytes instanceof ArrayBuffer
    ? new Uint8Array(bytes)
    : new Uint8Array(exactBuffer(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
  if (input.byteLength > BACKUP_MAX_BYTES) throw new BackupValidationError('備份超過 50 MiB 上限');
  let container: EncryptedBackupFile;
  try { container = JSON.parse(new TextDecoder().decode(input)) as EncryptedBackupFile; }
  catch { throw new BackupValidationError('備份檔格式損毀'); }
  if (container.format !== BACKUP_FORMAT || container.schemaVersion !== BACKUP_SCHEMA_VERSION
    || container.kdf !== 'PBKDF2-SHA256' || container.cipher !== 'AES-GCM'
    || !Number.isSafeInteger(container.iterations) || container.iterations < BACKUP_KDF_ITERATIONS
    || typeof container.salt !== 'string' || typeof container.iv !== 'string' || typeof container.ciphertext !== 'string') {
    throw new BackupValidationError('備份加密格式或參數不支援');
  }
  const salt = base64ToBytes(container.salt); const iv = base64ToBytes(container.iv);
  if (salt.length !== 16 || iv.length !== 12) throw new BackupValidationError('備份 salt 或 IV 長度錯誤');
  try {
    const key = await deriveKey(password, salt, container.iterations);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: exactBuffer(iv) }, key, exactBuffer(base64ToBytes(container.ciphertext)));
    const manifest: unknown = JSON.parse(new TextDecoder().decode(plaintext));
    validateManifest(manifest);
    return manifest;
  } catch (error) {
    if (error instanceof BackupValidationError) throw error;
    throw new BackupValidationError('密碼錯誤或備份內容已損毀');
  }
}

export async function verifyBackupFile(file: File, password: string, expectedSha256: string): Promise<BackupManifest> {
  if (file.size > BACKUP_MAX_BYTES) throw new BackupValidationError('備份超過 50 MiB 上限');
  const bytes = await file.arrayBuffer();
  if (await sha256Hex(bytes) !== expectedSha256) throw new BackupValidationError('重新選取的檔案與已產生備份不同');
  return decryptBackup(bytes, password);
}
