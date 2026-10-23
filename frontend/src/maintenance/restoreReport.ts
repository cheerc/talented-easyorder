/**
 * The anonymous reconciliation report (Ruling R12). It carries counts, per-day totals, a balance sum, content digests
 * and timings — never a name, student code, individual balance, UID, e-mail or remark, and never the password.
 */
import { sha256Hex, stableJson } from '../firebase/cloudBackup';
import type { LoadedChain, Replayed } from './restoreChain';

/** Spark allows 20,000 writes a day; a restore plans to stay 10% below it. */
export const DEFAULT_MAX_WRITES_PER_DAY = 18_000;

export const RESTORE_REPORT_FORMAT = 'easyorder-restore-report' as const;

const COLLECTIONS = ['days', 'settlements', 'students', 'vendors', 'transactions', 'backfillDays', 'postCloseEntries'] as const;
type Collection = typeof COLLECTIONS[number];

function collectionOf(projectionPath: string): Collection | null {
  if (/^days\/[^/]+$/.test(projectionPath)) return 'days';
  if (/^days\/[^/]+\/settlements\/[^/]+$/.test(projectionPath)) return 'settlements';
  for (const name of ['students', 'vendors', 'transactions', 'backfillDays', 'postCloseEntries'] as const) {
    if (projectionPath.startsWith(`${name}/`) && projectionPath.indexOf('/', name.length + 1) < 0) return name;
  }
  return null;
}

export interface ValidateReport {
  format: typeof RESTORE_REPORT_FORMAT;
  version: 1;
  mode: 'validate';
  datasetId: string;
  commandSchemaVersion: number;
  toSeq: number;
  chain: { packageCount: number; lastSeq: number; packages: Array<{ number: number; fromSeq: number; toSeq: number; recordCount: number; sha256: string }> };
  commandSeq: { first: number | null; last: number; contiguous: true };
  packageBoundary: { atPackage: number | null; matchesPackageProjection: true | null };
  collections: Record<'commands' | Collection | 'studentCodes', number>;
  days: Record<string, { status: string | null; totals: Record<string, number>; settlementVersions: number }>;
  students: { count: number; balanceSum: number };
  digests: Record<'commands' | Collection, string>;
  timing: { decryptMs: number; replayMs: number; totalMs: number };
  writes: { documents: number; maxWritesPerDay: number; estimatedDays: number };
}

const round = (value: number) => Math.round(value * 10) / 10;

export async function buildValidateReport(chain: LoadedChain, replayed: Replayed, totalMs: number, maxWritesPerDay = DEFAULT_MAX_WRITES_PER_DAY): Promise<ValidateReport> {
  const grouped: Record<Collection, Array<[string, unknown]>> = {
    days: [], settlements: [], students: [], vendors: [], transactions: [], backfillDays: [], postCloseEntries: [],
  };
  for (const [projectionPath, value] of Object.entries(replayed.projections)) {
    if (value === null) continue;
    const collection = collectionOf(projectionPath);
    if (collection) grouped[collection].push([projectionPath, value]);
  }
  for (const entries of Object.values(grouped)) entries.sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));

  const days: ValidateReport['days'] = {};
  for (const [projectionPath, value] of grouped.days) {
    const dayId = projectionPath.slice('days/'.length);
    const status = (value as Record<string, unknown>).status;
    days[dayId] = {
      status: typeof status === 'string' ? status : null,
      totals: replayed.totals[dayId] ?? {},
      settlementVersions: grouped.settlements.filter(([settlementPath]) => settlementPath.startsWith(`days/${dayId}/settlements/`)).length,
    };
  }
  const students = grouped.students.map(([, value]) => value as Record<string, unknown>);
  const balanceSum = students.reduce((sum, student) => sum + (Number.isSafeInteger(student.currentBalance) ? Number(student.currentBalance) : 0), 0);
  const studentCodes = new Set(students.map(student => student.studentCode).filter((code): code is string => typeof code === 'string' && code.length > 0));

  const digests = {} as ValidateReport['digests'];
  for (const collection of COLLECTIONS) digests[collection] = await sha256Hex(stableJson(grouped[collection]));
  digests.commands = await sha256Hex(stableJson(chain.records.slice(0, replayed.toSeq)));

  const collections = {
    commands: replayed.toSeq, studentCodes: studentCodes.size,
    days: grouped.days.length, settlements: grouped.settlements.length, students: grouped.students.length,
    vendors: grouped.vendors.length, transactions: grouped.transactions.length,
    backfillDays: grouped.backfillDays.length, postCloseEntries: grouped.postCloseEntries.length,
  };
  // One write per command, per projection document and per student-code index entry, plus the final dataHead.
  const documents = collections.commands + COLLECTIONS.reduce((sum, name) => sum + collections[name], 0) + collections.studentCodes + 1;
  return {
    format: RESTORE_REPORT_FORMAT, version: 1, mode: 'validate',
    datasetId: chain.datasetId, commandSchemaVersion: chain.commandSchemaVersion, toSeq: replayed.toSeq,
    chain: {
      packageCount: chain.packages.length, lastSeq: chain.lastSeq,
      packages: chain.packages.map((item, index) => ({
        number: index + 1, fromSeq: item.manifest.fromSeq, toSeq: item.manifest.toSeq, recordCount: item.manifest.recordCount, sha256: item.sha256,
      })),
    },
    commandSeq: { first: replayed.toSeq > 0 ? 1 : null, last: replayed.toSeq, contiguous: true },
    packageBoundary: { atPackage: replayed.boundaryPackage, matchesPackageProjection: replayed.boundaryPackage === null ? null : true },
    collections, days, students: { count: students.length, balanceSum }, digests,
    timing: { decryptMs: round(chain.decryptMs), replayMs: round(replayed.replayMs), totalMs: round(totalMs) },
    writes: { documents, maxWritesPerDay, estimatedDays: Math.max(1, Math.ceil(documents / maxWritesPerDay)) },
  };
}

/** The lines a person reads. Same anonymity rule as the JSON. */
export function formatValidateSummary(report: ValidateReport): string {
  const c = report.collections;
  return [
    `驗證通過：資料集 ${report.datasetId}，重播到 seq ${report.toSeq}（共 ${report.chain.packageCount} 個備份包，最後 seq ${report.chain.lastSeq}）`,
    `命令 ${c.commands}、營業日 ${c.days}、日結版本 ${c.settlements}、學生 ${c.students}（餘額總和 ${report.students.balanceSum}）、供應商 ${c.vendors}、交易 ${c.transactions}、回填標記 ${c.backfillDays}、關帳後收支 ${c.postCloseEntries}`,
    `預估還原寫入 ${report.writes.documents} 次，以每日 ${report.writes.maxWritesPerDay} 次計約 ${report.writes.estimatedDays} 天`,
    `耗時：解密 ${report.timing.decryptMs} ms、重播 ${report.timing.replayMs} ms、合計 ${report.timing.totalMs} ms`,
    '',
  ].join('\n');
}
