/**
 * Read-back comparison of a restored target with the plan the chain implies (Ruling R11/R12). It reads every business
 * document, compares it with the expected document, recomputes what can be recomputed from the target alone (day
 * totals, student balances, command and settlement numbering) and reports counts only: never a name, code, balance,
 * path or document content.
 */
import { recalculateBackupTotals, stableJson } from '../firebase/cloudBackup';
import { deriveStudentBalance, type CloudTransactionInput } from '../domain/cloudLedgerProjection';
import type { FirestoreRest } from './firestoreRest';
import { readTargetHead } from './restoreExecutor';
import type { LoadedChain } from './restoreChain';
import type { RestorePlan } from './restorePlan';
import { RESTORE_REPORT_FORMAT } from './restoreReport';

const CATEGORIES = ['commands', 'days', 'settlements', 'students', 'vendors', 'transactions', 'backfillDays', 'postCloseEntries', 'studentCodes'] as const;
type Category = typeof CATEGORIES[number];

/** The top-level collections that are listed; settlements are listed per day. */
const TOP_LEVEL = ['commands', 'days', 'students', 'studentCodes', 'transactions', 'vendors', 'backfillDays', 'postCloseEntries'] as const;

function categoryOf(path: string): Category | null {
  if (/^days\/[^/]+\/settlements\/[^/]+$/.test(path)) return 'settlements';
  const [top, id, rest] = path.split('/');
  if (id !== undefined && rest === undefined && (TOP_LEVEL as readonly string[]).includes(top!)) return top as Category;
  return null;
}

export interface CategoryDiff { expected: number; actual: number; missing: number; extra: number; different: number }

export interface VerifyReport {
  format: typeof RESTORE_REPORT_FORMAT;
  version: 1;
  mode: 'verify';
  ok: boolean;
  datasetId: string;
  toSeq: number;
  collections: Record<Category, CategoryDiff>;
  commandSeq: { first: number | null; last: number | null; contiguous: boolean; gaps: number };
  dataHead: { datasetMatches: boolean; seqMatches: boolean; lastCommandMatches: boolean; maintenance: boolean };
  totals: { matches: boolean };
  balances: { checked: number; mismatches: number };
  settlements: { contiguous: boolean };
  reads: number;
  timing: { readMs: number; compareMs: number; totalMs: number };
}

const round = (value: number) => Math.round(value * 10) / 10;

function timestampText(value: unknown): string {
  const marker = value as { seconds?: unknown; nanoseconds?: unknown } | null;
  return typeof marker?.seconds === 'number' && typeof marker.nanoseconds === 'number'
    ? `${String(marker.seconds).padStart(14, '0')}.${String(marker.nanoseconds).padStart(9, '0')}`
    : '';
}

function transactionInput(path: string, data: Record<string, unknown>): CloudTransactionInput {
  return {
    transactionId: typeof data.transactionId === 'string' ? data.transactionId : path.slice(path.indexOf('/') + 1),
    studentId: String(data.studentId ?? ''), businessDate: String(data.businessDate ?? ''), createdAt: timestampText(data.createdAt),
    type: data.type as CloudTransactionInput['type'], mealKind: data.mealKind as CloudTransactionInput['mealKind'],
    mealPrice: data.mealPrice as number | undefined, paidAmount: data.paidAmount as number | undefined,
    amount: data.amount as number | undefined, status: data.status as string | undefined,
  };
}

export async function verifyTarget(
  rest: FirestoreRest, chain: LoadedChain, plan: RestorePlan, clock: () => number,
): Promise<VerifyReport> {
  const startedAt = clock();
  const actual = new Map<string, Record<string, unknown>>();
  for (const name of TOP_LEVEL) {
    for (const item of await rest.listDocuments(name)) actual.set(item.path, item.data);
  }
  for (const path of [...actual.keys()]) {
    if (!/^days\/[^/]+$/.test(path)) continue;
    for (const item of await rest.listDocuments(`${path}/settlements`)) actual.set(item.path, item.data);
  }
  const head = await readTargetHead(rest);
  const reads = actual.size + 1;
  const readMs = clock() - startedAt;

  const compareStartedAt = clock();
  const expected = new Map<string, Record<string, unknown>>();
  for (const batch of plan.batches) for (const write of batch) if (write.kind === 'create') expected.set(write.path, write.data);

  const collections = Object.fromEntries(CATEGORIES.map(name => [name, { expected: 0, actual: 0, missing: 0, extra: 0, different: 0 }])) as Record<Category, CategoryDiff>;
  for (const [path, data] of expected) {
    const category = categoryOf(path)!;
    const entry = collections[category];
    entry.expected += 1;
    const found = actual.get(path);
    if (found === undefined) entry.missing += 1;
    else if (stableJson(found) !== stableJson(data)) entry.different += 1;
  }
  for (const path of actual.keys()) {
    const category = categoryOf(path);
    if (category === null) continue;
    collections[category].actual += 1;
    if (!expected.has(path)) collections[category].extra += 1;
  }

  const seqs = [...actual.entries()].filter(([path]) => categoryOf(path) === 'commands').map(([, data]) => data.seq)
    .filter((seq): seq is number => Number.isSafeInteger(seq));
  const present = new Set(seqs.filter(seq => seq >= 1 && seq <= plan.toSeq));
  const gaps = plan.toSeq - present.size;
  const commandSeq = {
    first: seqs.length > 0 ? Math.min(...seqs) : null, last: seqs.length > 0 ? Math.max(...seqs) : null,
    contiguous: gaps === 0 && collections.commands.extra === 0, gaps,
  };

  const lastRecord = plan.toSeq > 0 ? chain.records[plan.toSeq - 1]! : null;
  const dataHead = {
    datasetMatches: head?.datasetId === plan.datasetId, seqMatches: head?.seq === plan.toSeq,
    lastCommandMatches: (head?.lastCommandId ?? null) === (lastRecord?.commandId ?? null) && head !== null,
    maintenance: head?.maintenance === true,
  };

  const projections: Record<string, unknown> = {};
  for (const [path, data] of actual) {
    const category = categoryOf(path);
    if (category !== null && category !== 'commands' && category !== 'studentCodes') projections[path] = data;
  }
  const totalsMatch = stableJson(recalculateBackupTotals(projections)) === stableJson(plan.expectedTotals);

  const byStudent = new Map<string, CloudTransactionInput[]>();
  for (const [path, data] of actual) {
    if (categoryOf(path) !== 'transactions') continue;
    const input = transactionInput(path, data);
    byStudent.set(input.studentId, [...(byStudent.get(input.studentId) ?? []), input]);
  }
  let checked = 0;
  let mismatches = 0;
  for (const [path, data] of actual) {
    if (categoryOf(path) !== 'students') continue;
    checked += 1;
    const opening = data.openingBalance as { amount?: unknown } | undefined;
    const derived = deriveStudentBalance(Number(opening?.amount ?? Number.NaN), byStudent.get(path.slice('students/'.length)) ?? []);
    if (!derived.complete || derived.currentBalance !== data.currentBalance) mismatches += 1;
  }

  const versions = new Map<string, number[]>();
  for (const path of actual.keys()) {
    const match = /^days\/([^/]+)\/settlements\/([^/]+)$/.exec(path);
    if (match) versions.set(match[1]!, [...(versions.get(match[1]!) ?? []), Number(match[2])]);
  }
  const settlementsContiguous = [...versions.values()].every(numbers =>
    numbers.every(Number.isSafeInteger) && [...numbers].sort((left, right) => left - right).every((value, index) => value === index + 1));

  const ok = CATEGORIES.every(name => collections[name].missing === 0 && collections[name].extra === 0 && collections[name].different === 0)
    && commandSeq.contiguous && dataHead.datasetMatches && dataHead.seqMatches && dataHead.lastCommandMatches
    && totalsMatch && mismatches === 0 && settlementsContiguous;
  const compareMs = clock() - compareStartedAt;
  return {
    format: RESTORE_REPORT_FORMAT, version: 1, mode: 'verify', ok, datasetId: plan.datasetId, toSeq: plan.toSeq,
    collections, commandSeq, dataHead, totals: { matches: totalsMatch }, balances: { checked, mismatches },
    settlements: { contiguous: settlementsContiguous }, reads,
    timing: { readMs: round(readMs), compareMs: round(compareMs), totalMs: round(clock() - startedAt) },
  };
}

export function formatVerifySummary(report: VerifyReport): string {
  const rows = CATEGORIES.map(name => {
    const c = report.collections[name];
    return `  ${name}：預期 ${c.expected}、實際 ${c.actual}${c.missing + c.extra + c.different === 0 ? '' : `（缺 ${c.missing}、多 ${c.extra}、內容不同 ${c.different}）`}`;
  });
  return [
    `${report.ok ? '對帳通過' : '對帳失敗'}：資料集 ${report.datasetId}，seq ${report.toSeq}`,
    ...rows,
    `命令 seq：${report.commandSeq.contiguous ? '連續' : `缺號 ${report.commandSeq.gaps}`}；dataHead：seq ${report.dataHead.seqMatches ? '相符' : '不符'}、最後命令 ${report.dataHead.lastCommandMatches ? '相符' : '不符'}、維護 ${report.dataHead.maintenance ? '中' : '已解除'}`,
    `每日合計：${report.totals.matches ? '相符' : '不符'}；學生餘額重算：檢查 ${report.balances.checked}、不符 ${report.balances.mismatches}；日結版本：${report.settlements.contiguous ? '連續' : '不連續'}`,
    `讀取 ${report.reads} 份文件，耗時 ${report.timing.totalMs} ms`,
    '',
  ].join('\n');
}
