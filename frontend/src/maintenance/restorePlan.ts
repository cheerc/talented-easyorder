/**
 * The restore plan (Ruling R6): a deterministic list of documents cut into batches. The same chain and the same H
 * always give the same batches and the same digest, which is what lets `resume` prove it continues the same restore.
 */
import { sha256Hex, stableJson, type BackupCommandRecord } from '../firebase/cloudBackup';
import type { LoadedChain, Replayed } from './restoreChain';
import { RestError, encodeFields, type RestWrite } from './firestoreRest';

export const MAX_BATCH_DOCUMENTS = 100;
export const MAX_BATCH_BYTES = 8 * 1024 * 1024;

export class RestorePlanError extends Error {
  constructor(message: string) { super(message); this.name = 'RestorePlanError'; }
}

export interface ExpectedHead {
  datasetId: string;
  /** From the first command's `before.head`; null when H is 0 and there is no command to read it from. */
  schemaVersion: number | null;
  goLiveDate: string | null;
}

export interface RestorePlan {
  datasetId: string;
  toSeq: number;
  batchSize: number;
  batches: RestWrite[][];
  documentCount: number;
  counts: { commands: number; projections: number; studentCodes: number; head: number };
  digest: string;
  expectedHead: ExpectedHead;
}

const byPath = (left: [string, unknown], right: [string, unknown]) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function commandDocument(record: BackupCommandRecord): Record<string, unknown> {
  // A command document has exactly the sixteen envelope keys; the backup adds datasetId and schemaVersion.
  const document: Record<string, unknown> = { ...record };
  delete document.datasetId;
  delete document.schemaVersion;
  return document;
}

/** The `studentCodes/{code}` index as the Rules build it: the last Create/ChangeStudentCode that set the code, minus changed-away codes. */
function deriveStudentCodes(records: BackupCommandRecord[]): Map<string, { studentId: string; lastCommandId: string; updatedAt: unknown }> {
  const codes = new Map<string, { studentId: string; lastCommandId: string; updatedAt: unknown }>();
  for (const record of records) {
    if (record.kind !== 'CreateStudent' && record.kind !== 'ChangeStudentCode') continue;
    const studentId = record.targets.studentId;
    const code = record.payload.studentCode;
    if (typeof studentId !== 'string' || typeof code !== 'string') throw new RestorePlanError(`seq ${record.seq} 的學生代號命令缺少 studentId 或 studentCode`);
    if (record.kind === 'ChangeStudentCode') {
      const before = isRecord(record.before) && isRecord(record.before.student) ? record.before.student.studentCode : undefined;
      if (typeof before !== 'string') throw new RestorePlanError(`seq ${record.seq} 的 ChangeStudentCode 缺少原代號`);
      codes.delete(before);
    }
    codes.set(code, { studentId, lastCommandId: record.commandId, updatedAt: record.committedAt });
  }
  return codes;
}

function documentBytes(data: Record<string, unknown>): number {
  try { return new TextEncoder().encode(JSON.stringify(encodeFields(data))).length; }
  catch (error) {
    if (error instanceof RestError) throw new RestorePlanError(error.message);
    throw error;
  }
}

/** Cuts documents into batches of at most `batchSize` documents and `MAX_BATCH_BYTES`; the dataHead update is its own batch. */
function cut(writes: RestWrite[], batchSize: number): RestWrite[][] {
  const batches: RestWrite[][] = [];
  let current: RestWrite[] = [];
  let bytes = 0;
  for (const write of writes) {
    const size = documentBytes(write.data);
    if (size > MAX_BATCH_BYTES) throw new RestorePlanError('有一份文件超過單批 8 MiB 上限，無法還原');
    if (current.length >= batchSize || (current.length > 0 && bytes + size > MAX_BATCH_BYTES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(write);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export async function buildRestorePlan(chain: LoadedChain, replayed: Replayed, options: { batchSize?: number } = {}): Promise<RestorePlan> {
  const batchSize = options.batchSize ?? MAX_BATCH_DOCUMENTS;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_DOCUMENTS) {
    throw new RestorePlanError(`單批文件數必須是 1 到 ${MAX_BATCH_DOCUMENTS}`);
  }
  const records = chain.records.slice(0, replayed.toSeq);

  const commands: RestWrite[] = records.map(record => ({ kind: 'create', path: `commands/${record.commandId}`, data: commandDocument(record) }));
  const projections: RestWrite[] = Object.entries(replayed.projections)
    .filter((entry): entry is [string, Record<string, unknown>] => entry[1] !== null && isRecord(entry[1]))
    .sort(byPath)
    .map(([path, data]) => ({ kind: 'create', path, data }));

  const derived = deriveStudentCodes(records);
  const finalStudents = projections.filter(item => /^students\/[^/]+$/.test(item.path)).map(item => item.data);
  const finalCodes = new Map(finalStudents.map(student => [String(student.studentCode), String(student.studentId)]));
  const derivedCodes = new Map([...derived].map(([code, entry]) => [code, entry.studentId]));
  if (stableJson([...finalCodes].sort()) !== stableJson([...derivedCodes].sort())) {
    throw new RestorePlanError('由命令歷程推導的學生代號索引與重播後的學生文件不一致');
  }
  const studentCodes: RestWrite[] = [...derived].sort((left, right) => (left[0] < right[0] ? -1 : 1))
    .map(([code, entry]) => ({ kind: 'create', path: `studentCodes/${code}`, data: { ...entry } }));

  const batches = cut([...commands, ...projections, ...studentCodes], batchSize);
  let expectedHead: ExpectedHead = { datasetId: chain.datasetId, schemaVersion: null, goLiveDate: null };
  let head = 0;
  if (records.length > 0) {
    const first = records[0]!.before;
    const last = records[records.length - 1]!.after;
    const firstHead = isRecord(first) && isRecord(first.head) ? first.head : null;
    const lastHead = isRecord(last) && isRecord(last.head) ? last.head : null;
    if (!firstHead || !lastHead || lastHead.seq !== replayed.toSeq || lastHead.datasetId !== chain.datasetId) {
      throw new RestorePlanError('命令鏈的 dataHead 資訊與 seq／datasetId 不一致');
    }
    expectedHead = {
      datasetId: chain.datasetId,
      schemaVersion: typeof firstHead.schemaVersion === 'number' ? firstHead.schemaVersion : null,
      goLiveDate: typeof firstHead.goLiveDate === 'string' ? firstHead.goLiveDate : null,
    };
    // Only seq, lastCommandId and updatedAt move, exactly as the Rules allow; maintenance stays true until finalize.
    batches.push([{
      kind: 'update', path: 'system/dataHead', fields: ['seq', 'lastCommandId', 'updatedAt'],
      data: { seq: lastHead.seq, lastCommandId: lastHead.lastCommandId, updatedAt: lastHead.updatedAt },
    }]);
    head = 1;
  }

  const digest = await sha256Hex(stableJson({ datasetId: chain.datasetId, toSeq: replayed.toSeq, batches }));
  return {
    datasetId: chain.datasetId, toSeq: replayed.toSeq, batchSize, batches,
    documentCount: commands.length + projections.length + studentCodes.length + head,
    counts: { commands: commands.length, projections: projections.length, studentCodes: studentCodes.length, head },
    digest, expectedHead,
  };
}
