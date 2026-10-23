/**
 * Argument handling, dispatch and exit codes of `scripts/easyorder-data-maintenance.mjs`.
 * Exit codes: 0 done, 64 usage error, 2 a check failed (the data or the chain is not acceptable), 1 unexpected failure.
 */
import { BackupValidationError } from '../firebase/cloudBackup';
import { RestoreChainError, loadChain, parseChainFile, replayTo } from './restoreChain';
import { buildValidateReport, formatValidateSummary } from './restoreReport';

export interface CliIo {
  readFile(path: string): Promise<Uint8Array<ArrayBuffer>>;
  writeFile(path: string, data: string): Promise<void>;
  /** The backup password: from the terminal without echo, or the first line of a pipe. Never from an argument. */
  readPassword(): Promise<string>;
  stdout(text: string): void;
  stderr(text: string): void;
  now(): number;
}

export const EXIT_OK = 0;
export const EXIT_UNEXPECTED = 1;
export const EXIT_CHECK_FAILED = 2;
export const EXIT_USAGE = 64;

const SUBCOMMANDS = ['validate', 'init', 'restore', 'resume', 'verify', 'finalize'] as const;
const LATER_PHASE: Record<string, string> = {
  init: 'P15b', restore: 'P15b', resume: 'P15b', verify: 'P15c', finalize: 'P15c',
};

const USAGE = `用法：node scripts/easyorder-data-maintenance.mjs <子命令> [選項]

子命令：
  validate  離線驗證備份鏈並輸出匿名對帳（不連線、不寫入）
              --manifest <chain.json>  還原鏈檔（必填）
              --to-seq <H>             重播到第 H 筆命令（預設最後一包的 toSeq）
              --report <out.json>      另存匿名對帳報告
  init      建立隔離專案的 dataHead（尚未提供）
  restore   分批還原到隔離專案，預設只試算（尚未提供）
  resume    續跑中斷的還原（尚未提供）
  verify    逐文件對帳還原結果（尚未提供）
  finalize  重建 operators 與空租約並解除維護（尚未提供）

備份密碼只從標準輸入讀取（終端機不回顯；管線讀第一行），不接受命令列參數。
結束碼：0 完成、64 用法錯誤、2 驗證失敗、1 非預期錯誤。
`;

interface ValidateArgs { manifest: string; toSeq: number | null; report: string | null }

class UsageError extends Error {}

function parseValidateArgs(args: string[]): ValidateArgs {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (!token.startsWith('--')) throw new UsageError(`不認得的參數：${token}`);
    const equals = token.indexOf('=');
    const name = equals >= 0 ? token.slice(0, equals) : token;
    if (name === '--password' || name === '--passphrase') {
      throw new UsageError('不接受命令列密碼；請由標準輸入輸入備份密碼，避免密碼留在 shell 歷史或 CI 記錄');
    }
    if (!['--manifest', '--to-seq', '--report'].includes(name)) throw new UsageError(`不認得的選項：${name}`);
    if (values.has(name)) throw new UsageError(`選項 ${name} 重複`);
    let value: string | undefined;
    if (equals >= 0) value = token.slice(equals + 1);
    else { value = args[index + 1]; index += 1; }
    if (value === undefined || value === '' || (equals < 0 && value.startsWith('--'))) throw new UsageError(`選項 ${name} 需要一個值`);
    values.set(name, value);
  }
  const manifest = values.get('--manifest');
  if (!manifest) throw new UsageError('缺少 --manifest <還原鏈檔>');
  const rawToSeq = values.get('--to-seq');
  let toSeq: number | null = null;
  if (rawToSeq !== undefined) {
    if (!/^\d+$/.test(rawToSeq) || !Number.isSafeInteger(Number(rawToSeq))) throw new UsageError('--to-seq 必須是非負整數');
    toSeq = Number(rawToSeq);
  }
  return { manifest, toSeq, report: values.get('--report') ?? null };
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

async function readChainFile(chainPath: string, io: CliIo): Promise<Uint8Array<ArrayBuffer>> {
  try { return await io.readFile(chainPath); }
  catch { throw new RestoreChainError(`讀不到還原鏈檔 ${chainPath}`); }
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
    io.stderr(`子命令 ${command} 尚未提供（${later} 才會實作）；目前只有 validate 可用。\n`);
    return EXIT_USAGE;
  }
  try {
    return await runValidate(parseValidateArgs(rest), io);
  } catch (error) {
    if (error instanceof UsageError) { io.stderr(`用法錯誤：${error.message}\n`); return EXIT_USAGE; }
    if (error instanceof RestoreChainError || error instanceof BackupValidationError) {
      io.stderr(`驗證失敗：${error.message}\n`);
      return EXIT_CHECK_FAILED;
    }
    io.stderr(`非預期錯誤：${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_UNEXPECTED;
  }
}
