import {
  Timestamp, collection, doc, documentId, getDocFromServer, getDocsFromServer, limit, orderBy, query, startAfter, where,
  type DocumentData, type Firestore, type Query, type QueryDocumentSnapshot, type QuerySnapshot,
} from 'firebase/firestore';
import {
  BackupValidationError, createBackupManifest, recalculateBackupTotals, replayBackupProjections, validateBackupManifest,
  type BackupCommandRecord, type BackupManifest,
} from './cloudBackup';
import { commandPath, dataHeadPath } from './firestorePaths';

const PAGE_SIZE = 100;
const MAX_RECORDS = 100_000;

export interface BackupHead { datasetId: string; schemaVersion: number; seq: number; lastCommandId: string | null }
export interface CloudBackupRepositoryOptions {
  /** Server-side reads only; tests can inject a deterministic caller identity. */
  currentUid: () => string | null;
  /** Test seams for proving that a concurrent append stays beyond the captured H. */
  pageSize?: number;
  afterPageRead?: (lastSeq: number) => Promise<void>;
}

export interface CloudBackupExport {
  head: BackupHead;
  fromSeq: number;
  toSeq: number;
  previousPackageSha256: string | null;
  manifest: BackupManifest;
  packageSha256: string | null;
}

function recordFromSnapshot(snapshot: QueryDocumentSnapshot, datasetId: string, schemaVersion: number): BackupCommandRecord {
  const raw = snapshot.data();
  const allowedKinds = new Set([
    'EnsureDay', 'CreateStudent', 'ChangeStudentCode', 'EditStudent', 'SetStudentStatus', 'CorrectOpening',
    'SaveVendor', 'RemoveVendor', 'SetDayMenu', 'SetOpeningCash', 'CreateOrder', 'CreatePayment',
    'CreateCashMovement', 'CreateRefund', 'CorrectTransaction', 'VoidTransaction', 'CancelKeepDeposit',
    'CancelRefund', 'Undo', 'CloseDay', 'ReopenDay', 'BackfillOpeningCash', 'StartBackfill', 'RecordPostCloseEntry', 'RecordExport', 'RecordPrint', 'RecordBackup',
  ]);
  if (!raw || typeof raw !== 'object' || raw.commandId !== snapshot.id || !allowedKinds.has(String(raw.kind))
    || raw.schemaVersion !== undefined && raw.schemaVersion !== schemaVersion
    || !Number.isSafeInteger(raw.seq) || !Number.isSafeInteger(raw.leaseEpoch) || raw.leaseEpoch < 0
    || !raw.targets || typeof raw.targets !== 'object' || !raw.expectedRevisions || typeof raw.expectedRevisions !== 'object'
    || !raw.payload || typeof raw.payload !== 'object' || !raw.actor || typeof raw.actor !== 'object'
    || !raw.cashEffect || typeof raw.cashEffect !== 'object' || typeof raw.inputFingerprint !== 'string') {
    throw new BackupValidationError(`command ${snapshot.id} schema 不支援，備份已停止`);
  }
  return {
    commandId: snapshot.id, kind: String(raw.kind), seq: Number(raw.seq), leaseEpoch: Number(raw.leaseEpoch), datasetId, schemaVersion,
    targets: raw.targets, expectedRevisions: raw.expectedRevisions,
    before: serializable(raw.before ?? null) as Record<string, unknown> | null,
    after: serializable(raw.after ?? null) as Record<string, unknown> | null,
    payload: serializable(raw.payload) as Record<string, unknown>,
    actor: serializable(raw.actor) as Record<string, unknown>, committedAt: serializable(raw.committedAt ?? null),
    businessDate: typeof raw.businessDate === 'string' ? raw.businessDate : null,
    studentId: typeof raw.studentId === 'string' ? raw.studentId : null,
    reason: typeof raw.reason === 'string' ? raw.reason : null,
    cashEffect: raw.cashEffect, inputFingerprint: raw.inputFingerprint,
  };
}

function serializable(value: unknown): unknown {
  if (value instanceof Timestamp) return { _type: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (Array.isArray(value)) return value.map(serializable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, serializable(nested)]));
  }
  return value;
}

function validHead(value: unknown): BackupHead {
  if (!value || typeof value !== 'object') throw new BackupValidationError('雲端 dataHead schema 不支援');
  const head = value as Record<string, unknown>;
  if (head.schemaVersion !== 1 || typeof head.datasetId !== 'string' || !head.datasetId
    || !Number.isSafeInteger(head.seq) || (head.seq as number) < 0
    || (head.lastCommandId !== null && typeof head.lastCommandId !== 'string')) {
    throw new BackupValidationError('雲端 dataHead schema 不支援');
  }
  if ((head.seq === 0) !== (head.lastCommandId === null)) throw new BackupValidationError('dataHead 序號與尾端 command 不一致');
  return { datasetId: head.datasetId, schemaVersion: 1, seq: head.seq as number, lastCommandId: head.lastCommandId as string | null };
}

export function createCloudBackupRepository(db: Firestore, options: CloudBackupRepositoryOptions) {
  const pageSize = options.pageSize ?? PAGE_SIZE;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > PAGE_SIZE) throw new BackupValidationError('備份分頁大小不合法');
  async function readHead(): Promise<BackupHead> {
    if (!options.currentUid()) throw new BackupValidationError('需要有效操作員使用權才能讀取備份來源');
    const snapshot = await getDocFromServer(doc(db, dataHeadPath()));
    if (!snapshot.exists()) throw new BackupValidationError('雲端 dataHead 不存在');
    return validHead(snapshot.data());
  }

  async function exportRange(args: {
    fromSeq: number;
    previousManifest?: BackupManifest | null;
    previousPackageSha256?: string | null;
    generatedAt?: string;
  }): Promise<CloudBackupExport> {
    const head = await readHead();
    const { fromSeq } = args;
    if (!Number.isSafeInteger(fromSeq) || fromSeq < 0 || fromSeq > head.seq) throw new BackupValidationError('備份起始序號不合法');
    const previous = args.previousManifest ? validateBackupManifest(args.previousManifest) : null;
    if (fromSeq === 0) {
      if (previous !== null || (args.previousPackageSha256 ?? null) !== null) throw new BackupValidationError('首次完整備份不可帶前包');
    } else {
      if (!previous || previous.datasetId !== head.datasetId || previous.commandSchemaVersion !== head.schemaVersion
        || previous.toSeq !== fromSeq || !args.previousPackageSha256
        || !/^[a-f0-9]{64}$/.test(args.previousPackageSha256)) {
        throw new BackupValidationError('增量備份缺少相容且可讀的前包 manifest 或 SHA-256');
      }
    }
    const targetSeq = head.seq;
    const records: BackupCommandRecord[] = [];
    let lastSeq = fromSeq;
    let lastDocument: QueryDocumentSnapshot | null = null;
    while (lastSeq < targetSeq || lastDocument) {
      if (records.length >= MAX_RECORDS) throw new BackupValidationError('單次備份超過 100,000 筆上限');
      const pageLimit = Math.min(pageSize, MAX_RECORDS - records.length);
      const page: Query<DocumentData> = query(
        collection(db, 'commands'), where('seq', '>', fromSeq), where('seq', '<=', targetSeq),
        orderBy('seq', 'asc'), orderBy(documentId(), 'asc'),
        ...(lastDocument ? [startAfter(lastDocument)] : []),
        limit(pageLimit),
      );
      const result: QuerySnapshot<DocumentData> = await getDocsFromServer(page);
      if (result.empty) {
        if (lastSeq < targetSeq) throw new BackupValidationError(`備份命令鏈缺少 seq ${lastSeq + 1}`);
        break;
      }
      for (const snapshot of result.docs) {
        const record = recordFromSnapshot(snapshot, head.datasetId, head.schemaVersion);
        if (record.seq !== lastSeq + 1) throw new BackupValidationError(`備份命令鏈在 seq ${lastSeq + 1} 中斷或重複`);
        // A document ID lookup cross-check prevents a query result from masking a path mismatch.
        const exact = await getDocFromServer(doc(db, commandPath(snapshot.id)));
        if (!exact.exists() || exact.id !== record.commandId || exact.data().seq !== record.seq) {
          throw new BackupValidationError(`seq ${record.seq} command 文件識別不一致`);
        }
        records.push(record);
        lastSeq = record.seq;
        lastDocument = snapshot;
        if (records.length > MAX_RECORDS) throw new BackupValidationError('單次備份超過 100,000 筆上限');
      }
      await options.afterPageRead?.(lastSeq);
      if (result.size < pageLimit) break;
    }
    if (lastSeq !== targetSeq || records.length !== targetSeq - fromSeq) throw new BackupValidationError('雲端命令範圍未完整取得');
    if (records.length > 0 && records.at(-1)?.commandId !== head.lastCommandId) {
      throw new BackupValidationError('dataHead 尾端 command 與備份範圍不一致');
    }
    if (records.length === 0 && targetSeq > 0 && previous?.headCommandId !== head.lastCommandId) {
      throw new BackupValidationError('空增量的前包尾端 command 與 dataHead 不一致');
    }
    const baseState = previous?.projectionState ?? {};
    if (fromSeq > 0 && !previous?.projectionState) throw new BackupValidationError('前包缺少可驗證的 projectionState');
    const projectionState = replayBackupProjections(records, baseState);
    const totals = recalculateBackupTotals(projectionState);
    const manifest = createBackupManifest({
      datasetId: head.datasetId, commandSchemaVersion: head.schemaVersion,
      fromSeq, toSeq: targetSeq, headCommandId: head.lastCommandId,
      previousPackageSha256: args.previousPackageSha256 ?? null,
      generatedAt: args.generatedAt ?? new Date().toISOString(), records,
      baseState, projectionState, totals,
    });
    return { head, fromSeq, toSeq: targetSeq, previousPackageSha256: args.previousPackageSha256 ?? null, manifest, packageSha256: null };
  }

  return { readHead, exportRange };
}
