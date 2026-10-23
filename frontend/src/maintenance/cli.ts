/**
 * Argument handling, dispatch and exit codes of `scripts/easyorder-data-maintenance.mjs`.
 * Exit codes: 0 done, 64 usage error, 2 a check failed (the data, the chain or the target is not acceptable),
 * 75 a restore paused at its write limit (resume it), 1 unexpected failure.
 */
import path from 'node:path';
import { BackupValidationError } from '../firebase/cloudBackup';
import { RestError, TargetError, createFirestoreRest, resolveTarget, type FetchLike, type FirestoreRest } from './firestoreRest';
import {
  RestoreExecError, assertNoBusinessDocuments, checkFreshTarget, executeRestore, progressFileName, readTargetHead,
} from './restoreExecutor';
import { MAX_BATCH_DOCUMENTS, RestorePlanError, buildRestorePlan, type RestorePlan } from './restorePlan';
import { RestoreChainError, loadChain, parseChainFile, replayTo } from './restoreChain';
import { DEFAULT_MAX_WRITES_PER_DAY, buildValidateReport, formatValidateSummary } from './restoreReport';

export interface CliIo {
  readFile(path: string): Promise<Uint8Array<ArrayBuffer>>;
  writeFile(path: string, data: string): Promise<void>;
  /** The backup password: from the terminal without echo, or the first line of a pipe. Never from an argument. */
  readPassword(): Promise<string>;
  stdout(text: string): void;
  stderr(text: string): void;
  /** A monotonic millisecond clock, for timings. */
  now(): number;
  /** The wall clock, for the timestamps written to a target. */
  clock(): Date;
  /** Environment variables: the Emulator host and the short-lived access token live here, never in an argument. */
  env: Record<string, string | undefined>;
  fetch: FetchLike;
  isTty(): boolean;
  /** One typed line from the terminal (the confirmation of a real restore). */
  readLine(prompt: string): Promise<string>;
}

export const EXIT_OK = 0;
export const EXIT_UNEXPECTED = 1;
export const EXIT_CHECK_FAILED = 2;
export const EXIT_USAGE = 64;
export const EXIT_PAUSED = 75;

const SUBCOMMANDS = ['validate', 'init', 'restore', 'resume', 'verify', 'finalize'] as const;
const LATER_PHASE: Record<string, string> = { verify: 'P15c', finalize: 'P15c' };

const USAGE = `用法：node scripts/easyorder-data-maintenance.mjs <子命令> [選項]

子命令：
  validate  離線驗證備份鏈並輸出匿名對帳（不連線、不寫入）
              --manifest <chain.json>  還原鏈檔（必填）
              --to-seq <H>             重播到第 H 筆命令（預設最後一包的 toSeq）
              --report <out.json>      另存匿名對帳報告
  init      在全新的隔離專案建立維護模式的 system/dataHead（預設只試算）
              --project <id> --dataset <id> --go-live-date <YYYY-MM-DD>
              --execute                真的寫入（沒給 --execute 或給 --dry-run 都只試算）
              --out <manifest.json>    另存 bootstrap manifest
  restore   把備份鏈分批還原到已 init 的隔離專案（預設只試算，什麼都不寫）
              --project <id> --manifest <chain.json> [--to-seq <H>]
              --dry-run | --execute    兩者互斥；都沒給視為 --dry-run
              --max-writes <N>         本次最多寫入 N 份文件（預設 ${DEFAULT_MAX_WRITES_PER_DAY}）；
                                       到上限就在批界停下並以結束碼 75 離開，隔天用 resume 繼續
              --batch-size <N>         單批文件數 1–${MAX_BATCH_DOCUMENTS}（預設 ${MAX_BATCH_DOCUMENTS}）；續跑時必須與原來相同
  resume    續跑中斷的還原（同一個 --manifest、--to-seq 與批次大小；必須帶 --execute）
              --project <id> --manifest <chain.json> [--to-seq <H>] --execute [--max-writes <N>] [--batch-size <N>]
  verify    逐文件對帳還原結果（尚未提供）
  finalize  重建 operators 與空租約並解除維護（尚未提供）

目標由環境決定：有 FIRESTORE_EMULATOR_HOST 時只寫 Emulator 且 --project 必須以 demo- 開頭；
沒有時寫 Google Firestore，需要環境變數 EASYORDER_ACCESS_TOKEN（短期 access token），
--project 不得以 demo- 開頭，且 --execute 必須在終端機輸入確認字串。
備份密碼只從標準輸入讀取（終端機不回顯；管線讀第一行），不接受命令列參數。
結束碼：0 完成、64 用法錯誤、2 檢查失敗、75 達到寫入上限而暫停、1 非預期錯誤。
`;

class UsageError extends Error {}

interface FlagSpec { values: string[]; booleans: string[] }

/** `--name value`, `--name=value` and bare booleans; rejects a password, unknown, duplicate and valueless options. */
function parseFlags(args: string[], spec: FlagSpec): Map<string, string> {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (!token.startsWith('--')) throw new UsageError(`不認得的參數：${token}`);
    const equals = token.indexOf('=');
    const name = equals >= 0 ? token.slice(0, equals) : token;
    if (name === '--password' || name === '--passphrase') {
      throw new UsageError('不接受命令列密碼；請由標準輸入輸入備份密碼，避免密碼留在 shell 歷史或 CI 記錄');
    }
    const isBoolean = spec.booleans.includes(name);
    if (!isBoolean && !spec.values.includes(name)) throw new UsageError(`不認得的選項：${name}`);
    if (values.has(name)) throw new UsageError(`選項 ${name} 重複`);
    if (isBoolean) {
      if (equals >= 0) throw new UsageError(`選項 ${name} 不需要值`);
      values.set(name, 'true');
      continue;
    }
    let value: string | undefined;
    if (equals >= 0) value = token.slice(equals + 1);
    else { value = args[index + 1]; index += 1; }
    if (value === undefined || value === '' || (equals < 0 && value.startsWith('--'))) throw new UsageError(`選項 ${name} 需要一個值`);
    values.set(name, value);
  }
  return values;
}

function positiveInteger(raw: string | undefined, name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1 || Number(raw) > max) {
    throw new UsageError(`${name} 必須是 1 到 ${max === Number.MAX_SAFE_INTEGER ? '安全整數上限' : max} 的整數`);
  }
  return Number(raw);
}

function parseToSeq(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new UsageError('--to-seq 必須是非負整數');
  return Number(raw);
}

interface ValidateArgs { manifest: string; toSeq: number | null; report: string | null }

function parseValidateArgs(args: string[]): ValidateArgs {
  const values = parseFlags(args, { values: ['--manifest', '--to-seq', '--report'], booleans: [] });
  const manifest = values.get('--manifest');
  if (!manifest) throw new UsageError('缺少 --manifest <還原鏈檔>');
  return { manifest, toSeq: parseToSeq(values.get('--to-seq')), report: values.get('--report') ?? null };
}

interface RestoreArgs {
  project: string; manifest: string; toSeq: number | null; execute: boolean; maxWrites: number; batchSize: number;
}

function parseRestoreArgs(command: 'restore' | 'resume', args: string[]): RestoreArgs {
  const values = parseFlags(args, {
    values: ['--project', '--manifest', '--to-seq', '--max-writes', '--batch-size'], booleans: ['--dry-run', '--execute'],
  });
  const project = values.get('--project');
  if (!project) throw new UsageError('缺少 --project <專案 ID>');
  const manifest = values.get('--manifest');
  if (!manifest) throw new UsageError('缺少 --manifest <還原鏈檔>');
  if (values.has('--dry-run') && values.has('--execute')) throw new UsageError('--dry-run 與 --execute 不能同時使用');
  const execute = values.has('--execute');
  if (command === 'resume' && !execute) throw new UsageError('resume 只能搭配 --execute（要試算請用 restore --dry-run）');
  return {
    project, manifest, toSeq: parseToSeq(values.get('--to-seq')), execute,
    maxWrites: positiveInteger(values.get('--max-writes'), '--max-writes', DEFAULT_MAX_WRITES_PER_DAY),
    batchSize: positiveInteger(values.get('--batch-size'), '--batch-size', MAX_BATCH_DOCUMENTS, MAX_BATCH_DOCUMENTS),
  };
}

interface InitArgs { project: string; dataset: string; goLiveDate: string; execute: boolean; out: string | null }

function parseInitArgs(args: string[]): InitArgs {
  const values = parseFlags(args, { values: ['--project', '--dataset', '--go-live-date', '--out'], booleans: ['--dry-run', '--execute'] });
  const project = values.get('--project');
  if (!project) throw new UsageError('缺少 --project <專案 ID>');
  const dataset = values.get('--dataset');
  if (!dataset) throw new UsageError('缺少 --dataset <資料集 ID>');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(dataset)) throw new UsageError('--dataset 只能含英數字、點、底線與連字號，最長 128 字');
  const goLiveDate = values.get('--go-live-date');
  if (!goLiveDate) throw new UsageError('缺少 --go-live-date <YYYY-MM-DD>');
  const parsed = new Date(`${goLiveDate}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(goLiveDate) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== goLiveDate) {
    throw new UsageError('--go-live-date 必須是有效的 YYYY-MM-DD 日期');
  }
  if (values.has('--dry-run') && values.has('--execute')) throw new UsageError('--dry-run 與 --execute 不能同時使用');
  return { project, dataset, goLiveDate, execute: values.has('--execute'), out: values.get('--out') ?? null };
}

async function readChainFile(chainPath: string, io: CliIo): Promise<Uint8Array<ArrayBuffer>> {
  try { return await io.readFile(chainPath); }
  catch { throw new RestoreChainError(`讀不到還原鏈檔 ${chainPath}`); }
}

async function runValidate(args: ValidateArgs, io: CliIo): Promise<number> {
  const startedAt = io.now();
  const text = new TextDecoder().decode(await readChainFile(args.manifest, io));
  const chainFile = parseChainFile(text);
  const chain = await loadChain(args.manifest, chainFile, () => io.readPassword(), io);
  const replayed = replayTo(chain, args.toSeq ?? chain.lastSeq, io);
  const report = await buildValidateReport(chain, replayed, io.now() - startedAt);
  if (args.report) await io.writeFile(args.report, `${JSON.stringify(report, null, 2)}\n`);
  io.stdout(formatValidateSummary(report));
  return EXIT_OK;
}

/** A real (non-Emulator) project is only written after the operator types the exact phrase on a terminal. */
async function confirm(io: CliIo, phrase: string): Promise<void> {
  const typed = await io.readLine(`確認要寫入正式 Firestore 專案，請輸入 ${phrase} ：`);
  if (typed !== phrase) throw new UsageError('確認字串不符，未寫入任何資料');
}

function requireTerminalForRealTarget(execute: boolean, emulator: boolean, io: CliIo): void {
  if (execute && !emulator && !io.isTty()) throw new UsageError('對非 Emulator 專案使用 --execute 必須在終端機執行，並輸入確認字串（標準輸入不是終端機）');
}

const timestampMarker = (date: Date) => ({ _type: 'timestamp' as const, seconds: Math.floor(date.getTime() / 1000), nanoseconds: (date.getTime() % 1000) * 1_000_000 });

async function runInit(args: InitArgs, io: CliIo): Promise<number> {
  const target = resolveTarget(args.project, io.env);
  requireTerminalForRealTarget(args.execute, target.emulator, io);
  const rest = createFirestoreRest(target, io.fetch);
  if (await readTargetHead(rest)) throw new RestoreExecError('目標已經有 system/dataHead；init 只在全新的專案執行');
  await assertNoBusinessDocuments(rest);
  if (!args.execute) {
    io.stdout(`試算（不寫入）：目標 ${args.project} 是全新的，init 會建立 system/dataHead（資料集 ${args.dataset}、seq 0、maintenance true、goLiveDate ${args.goLiveDate}）。加上 --execute 才會寫入。\n`);
    return EXIT_OK;
  }
  if (!target.emulator) await confirm(io, `INIT ${args.project} ${args.dataset}`);
  const now = io.clock();
  const dataHead = { schemaVersion: 1, datasetId: args.dataset, seq: 0, lastCommandId: null, maintenance: true, goLiveDate: args.goLiveDate };
  await rest.commit([{ kind: 'create', path: 'system/dataHead', data: { ...dataHead, updatedAt: timestampMarker(now) } }]);
  const manifest = {
    manifestVersion: 1, projectId: args.project, createdAt: now.toISOString(),
    bootstrapMethod: 'IAM/Admin SDK local maintenance tool', dataHead: { ...dataHead, updatedAt: now.toISOString() },
    createdPaths: ['system/dataHead'], financialDocumentsCreated: false,
  };
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  if (args.out) await io.writeFile(args.out, text);
  io.stdout(`已建立 ${args.project} 的 system/dataHead（資料集 ${args.dataset}，維護模式）。\n${text}`);
  return EXIT_OK;
}

function formatPlanSummary(plan: RestorePlan, args: RestoreArgs): string {
  const c = plan.counts;
  const days = Math.max(1, Math.ceil(plan.documentCount / args.maxWrites));
  return [
    `試算（不寫入）：資料集 ${plan.datasetId} 重播到 seq ${plan.toSeq}，還原到 ${args.project}`,
    `文件 ${plan.documentCount} 份（命令 ${c.commands}、投影 ${c.projections}、學生代號 ${c.studentCodes}、dataHead ${c.head}），分 ${plan.batches.length} 批（每批最多 ${plan.batchSize} 份）`,
    `預估寫入 ${plan.documentCount} 次，以每日 ${args.maxWrites} 次計約 ${days} 天`,
    '目標檢查通過：dataHead 已 init 且維護中，其餘集合皆空。加上 --execute 才會寫入。',
    '',
  ].join('\n');
}

async function runRestore(command: 'restore' | 'resume', args: RestoreArgs, io: CliIo): Promise<number> {
  const target = resolveTarget(args.project, io.env);
  requireTerminalForRealTarget(args.execute, target.emulator, io);
  const rest: FirestoreRest = createFirestoreRest(target, io.fetch);
  const startedAt = io.now();
  const chainFile = parseChainFile(new TextDecoder().decode(await readChainFile(args.manifest, io)));
  const chain = await loadChain(args.manifest, chainFile, () => io.readPassword(), io);
  const replayed = replayTo(chain, args.toSeq ?? chain.lastSeq, io);
  const plan = await buildRestorePlan(chain, replayed, { batchSize: args.batchSize });

  if (!args.execute) {
    await checkFreshTarget(rest, plan);
    io.stdout(formatPlanSummary(plan, args));
    return EXIT_OK;
  }
  const largest = plan.batches.reduce((most, batch) => Math.max(most, batch.length), 0);
  if (args.maxWrites < largest) throw new UsageError(`--max-writes ${args.maxWrites} 小於單批 ${largest} 份文件，一批都寫不下；請調高或用 --batch-size 縮小批次`);
  if (!target.emulator) {
    if (command === 'restore') await checkFreshTarget(rest, plan);
    await confirm(io, `RESTORE ${args.project} ${plan.datasetId} ${plan.toSeq}`);
  }
  // Emulator-only seam for the crash-after-commit test; a real project can never reach it.
  const crashAfter = target.emulator ? io.env.EASYORDER_EMULATOR_CRASH_AFTER_BATCH : undefined;
  const result = await executeRestore({
    rest, plan, mode: command, project: args.project, io, maxWrites: args.maxWrites,
    progressPath: path.join(path.dirname(args.manifest), progressFileName(args.project, plan.datasetId, plan.toSeq)),
    afterCommit: crashAfter === undefined ? undefined : index => {
      if (index === Number(crashAfter)) throw new Error('模擬提交後當機（EASYORDER_EMULATOR_CRASH_AFTER_BATCH）');
    },
  });
  io.stdout([
    `還原到 ${args.project}：資料集 ${plan.datasetId}，seq ${plan.toSeq}`,
    `本次寫入 ${result.writesThisRun} 筆（累計 ${result.writes}/${plan.documentCount}，批 ${result.completedBatches}/${result.totalBatches}）`,
    ...(result.adoptedBatches > 0 ? [`接續上次已提交但未記錄的 ${result.adoptedBatches} 批，沒有重寫`] : []),
    `耗時 ${Math.round(io.now() - startedAt)} ms`,
    '',
  ].join('\n'));
  if (result.status === 'paused') {
    io.stderr(`已達 --max-writes ${args.maxWrites}，在批界停下：剩餘 ${result.remainingWrites} 筆寫入。明天用 resume 繼續（同一個 --manifest、--to-seq 與 --batch-size）。\n`);
    return EXIT_PAUSED;
  }
  io.stdout('還原完成，目標仍在維護模式；下一步是 verify 與 finalize（P15c 提供）。\n');
  return EXIT_OK;
}

export async function main(argv: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined) { io.stderr(USAGE); return EXIT_USAGE; }
  if (command === '--help' || command === '-h' || command === 'help') { io.stdout(USAGE); return EXIT_OK; }
  if (!(SUBCOMMANDS as readonly string[]).includes(command)) {
    io.stderr(`不認得的子命令：${command}\n\n${USAGE}`);
    return EXIT_USAGE;
  }
  const later = LATER_PHASE[command];
  if (later) {
    io.stderr(`子命令 ${command} 尚未提供（${later} 才會實作）；目前可用 validate、init、restore、resume。\n`);
    return EXIT_USAGE;
  }
  try {
    if (command === 'init') return await runInit(parseInitArgs(rest), io);
    if (command === 'restore' || command === 'resume') return await runRestore(command, parseRestoreArgs(command, rest), io);
    return await runValidate(parseValidateArgs(rest), io);
  } catch (error) {
    if (error instanceof UsageError) { io.stderr(`用法錯誤：${error.message}\n`); return EXIT_USAGE; }
    if (error instanceof TargetError) { io.stderr(`目標不合法：${error.message}\n`); return EXIT_USAGE; }
    if (error instanceof RestoreChainError || error instanceof BackupValidationError) {
      io.stderr(`驗證失敗：${error.message}\n`);
      return EXIT_CHECK_FAILED;
    }
    if (error instanceof RestorePlanError || error instanceof RestoreExecError) {
      io.stderr(`檢查失敗：${error.message}\n`);
      return EXIT_CHECK_FAILED;
    }
    if (error instanceof RestError) { io.stderr(`目標存取失敗：${error.message}\n`); return EXIT_UNEXPECTED; }
    io.stderr(`非預期錯誤：${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_UNEXPECTED;
  }
}
