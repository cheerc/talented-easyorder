/**
 * Target checks, batch commits, the progress file and resume (Rulings R7, R8, R10). Every batch is written with
 * `exists=false`, so a document can never be written twice; resume is driven by what the target really holds, and the
 * progress file only has to prove it belongs to the same plan.
 */
import { stableJson } from '../firebase/cloudBackup';
import { AlreadyExistsError, type FirestoreRest, type RestWrite } from './firestoreRest';
import type { RestorePlan } from './restorePlan';

export class RestoreExecError extends Error {
  constructor(message: string) { super(message); this.name = 'RestoreExecError'; }
}

export const PROGRESS_FORMAT = 'easyorder-restore-progress' as const;

/** Every collection a restore fills; the target must have none of them before the first batch. */
const BUSINESS_COLLECTIONS = ['commands', 'days', 'students', 'studentCodes', 'transactions', 'vendors', 'backfillDays', 'postCloseEntries'] as const;

export interface ProgressFile {
  format: typeof PROGRESS_FORMAT;
  version: 1;
  planDigest: string;
  project: string;
  datasetId: string;
  toSeq: number;
  completedBatches: number;
  totalBatches: number;
  /** Documents of the completed batches. */
  writes: number;
  startedAt: string;
}

export interface ProgressIo {
  readFile(path: string): Promise<Uint8Array<ArrayBuffer>>;
  writeFile(path: string, data: string): Promise<void>;
  clock(): Date;
}

export function progressFileName(project: string, datasetId: string, toSeq: number): string {
  return `.easyorder-restore-${project}-${datasetId}-${toSeq}.json`;
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export async function readTargetHead(rest: FirestoreRest): Promise<Record<string, unknown> | null> {
  return (await rest.batchGet(['system/dataHead'])).get('system/dataHead') ?? null;
}

/** Fails closed when the target holds any document of the business collections or of the `settlements` group. */
export async function assertNoBusinessDocuments(rest: FirestoreRest): Promise<void> {
  for (const name of BUSINESS_COLLECTIONS) {
    if (await rest.collectionHasDocuments(name)) throw new RestoreExecError(`目標已經有 ${name} 文件；還原只能寫入乾淨的隔離專案`);
  }
  if (await rest.groupHasDocuments('settlements')) throw new RestoreExecError('目標已經有 settlements 文件；還原只能寫入乾淨的隔離專案');
}

/** The dataHead a restore may write into: initialised for this dataset and still in maintenance. */
function assertInitialisedHead(head: Record<string, unknown> | null, plan: RestorePlan): Record<string, unknown> {
  if (!head) throw new RestoreExecError('目標沒有 system/dataHead；請先執行 init 建立維護模式的 dataHead');
  if (head.maintenance !== true) throw new RestoreExecError('目標的 dataHead.maintenance 不是 true；還原只能寫入維護中的專案');
  if (head.datasetId !== plan.expectedHead.datasetId) throw new RestoreExecError('目標 dataHead 的 datasetId 與還原鏈不同');
  if (plan.expectedHead.goLiveDate !== null && head.goLiveDate !== plan.expectedHead.goLiveDate) {
    throw new RestoreExecError('目標 dataHead 的 goLiveDate 與命令鏈不同');
  }
  if (plan.expectedHead.schemaVersion !== null && head.schemaVersion !== plan.expectedHead.schemaVersion) {
    throw new RestoreExecError('目標 dataHead 的 schemaVersion 與命令鏈不同');
  }
  return head;
}

/** R8, for a fresh restore: an initialised head at seq 0 and nothing else. Read-only. */
export async function checkFreshTarget(rest: FirestoreRest, plan: RestorePlan): Promise<void> {
  const head = assertInitialisedHead(await readTargetHead(rest), plan);
  if (head.seq !== 0 || head.lastCommandId !== null) throw new RestoreExecError('目標 dataHead 不在 seq 0；還原只能從空的專案開始，請改用 resume 續跑');
  await assertNoBusinessDocuments(rest);
}

type BatchState = 'none' | 'all';

/** What the target holds for one batch: every document equal to the plan, or none of them. Anything else fails closed. */
async function batchState(rest: FirestoreRest, batch: RestWrite[]): Promise<BatchState> {
  const found = await rest.batchGet(batch.map(write => write.path));
  let present = 0;
  let absent = 0;
  for (const write of batch) {
    const actual = found.get(write.path) ?? null;
    if (write.kind === 'create') {
      if (actual === null) absent += 1;
      else if (stableJson(actual) === stableJson(write.data)) present += 1;
      else throw new RestoreExecError(`目標的 ${write.path.split('/')[0]} 文件內容與還原計畫不同`);
    } else if (actual === null) {
      throw new RestoreExecError('目標的 system/dataHead 不見了');
    } else if (write.fields.every(field => stableJson(actual[field]) === stableJson(write.data[field]))) {
      present += 1;
    } else if (actual.seq === 0 && actual.lastCommandId === null) {
      absent += 1;
    } else {
      throw new RestoreExecError('目標 dataHead 的 seq 與還原計畫不同');
    }
  }
  if (present === batch.length) return 'all';
  if (absent === batch.length) return 'none';
  throw new RestoreExecError('目標只有這一批的部分文件；一批是原子提交，不應該發生，停止以免寫壞');
}

/** Fail-closed reading of a progress file: it must belong to this project, dataset, H and plan digest. */
export function parseProgress(text: string, expected: { digest: string; project: string; datasetId: string; toSeq: number; totalBatches: number }): ProgressFile {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new RestoreExecError('進度檔不是有效的 JSON'); }
  if (!isRecord(value) || value.format !== PROGRESS_FORMAT || value.version !== 1) throw new RestoreExecError('進度檔格式不正確');
  const { completedBatches, totalBatches, writes } = value;
  if (typeof value.planDigest !== 'string' || typeof value.project !== 'string' || typeof value.datasetId !== 'string'
    || !Number.isSafeInteger(value.toSeq) || !Number.isSafeInteger(completedBatches) || !Number.isSafeInteger(totalBatches)
    || !Number.isSafeInteger(writes) || typeof value.startedAt !== 'string') {
    throw new RestoreExecError('進度檔欄位不完整');
  }
  if (value.project !== expected.project || value.datasetId !== expected.datasetId || value.toSeq !== expected.toSeq) {
    throw new RestoreExecError('進度檔屬於另一個專案、資料集或 --to-seq');
  }
  if (value.planDigest !== expected.digest || totalBatches !== expected.totalBatches) {
    throw new RestoreExecError('進度檔的計畫 digest 與目前的還原鏈、--to-seq 或批次大小不同；不是同一個還原，拒絕續跑');
  }
  if ((completedBatches as number) < 0 || (completedBatches as number) > expected.totalBatches) throw new RestoreExecError('進度檔的已完成批數超出範圍');
  return value as unknown as ProgressFile;
}

export type ExecuteMode = 'restore' | 'resume';

export interface ExecuteOptions {
  rest: FirestoreRest;
  plan: RestorePlan;
  mode: ExecuteMode;
  project: string;
  progressPath: string;
  io: ProgressIo;
  /** Most documents this run may write; the run stops at the batch boundary that would pass it (R10). */
  maxWrites: number;
  /** Emulator-only test seam: called after a batch committed and before its progress is recorded. */
  afterCommit?: (batchIndex: number) => void;
}

export interface ExecuteResult {
  status: 'complete' | 'paused';
  /** Documents this run committed. */
  writesThisRun: number;
  completedBatches: number;
  totalBatches: number;
  /** Documents of the completed batches, over all runs. */
  writes: number;
  remainingWrites: number;
  /** Batches that an earlier run had committed but not recorded. */
  adoptedBatches: number;
}

const batchWrites = (plan: RestorePlan, until: number) => plan.batches.slice(0, until).reduce((sum, batch) => sum + batch.length, 0);

async function readProgress(options: ExecuteOptions): Promise<string | null> {
  try { return new TextDecoder().decode(await options.io.readFile(options.progressPath)); } catch { return null; }
}

export async function executeRestore(options: ExecuteOptions): Promise<ExecuteResult> {
  const { rest, plan, mode, project, progressPath, io, maxWrites } = options;
  const totalBatches = plan.batches.length;
  const expected = { digest: plan.digest, project, datasetId: plan.datasetId, toSeq: plan.toSeq, totalBatches };
  const existing = await readProgress(options);

  let progress: ProgressFile;
  if (mode === 'restore') {
    if (existing !== null) {
      throw new RestoreExecError(`已經有進度檔 ${progressPath}；這個還原已開始過，請用 resume 續跑（要重來請先確認目標並移除進度檔）`);
    }
    await checkFreshTarget(rest, plan);
    progress = {
      format: PROGRESS_FORMAT, version: 1, planDigest: plan.digest, project, datasetId: plan.datasetId, toSeq: plan.toSeq,
      completedBatches: 0, totalBatches, writes: 0, startedAt: io.clock().toISOString(),
    };
    // Recorded before the first commit so a crash right after it can still be resumed.
    await io.writeFile(progressPath, `${JSON.stringify(progress, null, 2)}\n`);
  } else {
    if (existing === null) throw new RestoreExecError(`找不到進度檔 ${progressPath}；resume 只能接續已開始的還原（同一個 --manifest、--to-seq 與批次大小）`);
    progress = parseProgress(existing, expected);
    assertInitialisedHead(await readTargetHead(rest), plan);
    if (progress.completedBatches > 0) {
      // A progress file that claims more than the target holds is forged or stale.
      const last = plan.batches[progress.completedBatches - 1]!;
      if (await batchState(rest, last) !== 'all') throw new RestoreExecError('進度檔記錄已完成的批次，目標卻沒有對應文件；進度檔不可信，拒絕續跑');
    }
  }

  const record = async (completed: number) => {
    progress = { ...progress, completedBatches: completed, writes: batchWrites(plan, completed) };
    await io.writeFile(progressPath, `${JSON.stringify(progress, null, 2)}\n`);
  };

  let completed = progress.completedBatches;
  let writesThisRun = 0;
  let adoptedBatches = 0;
  // A resumed run looks at the target for each batch until it finds one that is not there yet; after that, exists=false protects the rest.
  let looking = mode === 'resume';
  for (let index = completed; index < totalBatches; index += 1) {
    const batch = plan.batches[index]!;
    if (looking) {
      if (await batchState(rest, batch) === 'all') {
        adoptedBatches += 1;
        completed = index + 1;
        await record(completed);
        continue;
      }
      looking = false;
    }
    if (writesThisRun + batch.length > maxWrites) {
      return { status: 'paused', writesThisRun, completedBatches: completed, totalBatches, writes: batchWrites(plan, completed),
        remainingWrites: plan.documentCount - batchWrites(plan, completed), adoptedBatches };
    }
    try { await rest.commit(batch); }
    catch (error) {
      if (error instanceof AlreadyExistsError) throw new RestoreExecError('目標在提交時已經有這批文件；請用 resume 重新檢查目標');
      throw error;
    }
    options.afterCommit?.(index);
    writesThisRun += batch.length;
    completed = index + 1;
    await record(completed);
  }
  return { status: 'complete', writesThisRun, completedBatches: completed, totalBatches, writes: batchWrites(plan, completed), remainingWrites: 0, adoptedBatches };
}
