// M0：本機練習快照（完整 JSON 匯出／還原）與「只清除練習交易」。
// 見 docs/superpowers/specs/frontend-prototype-workflow-spec.md §3 S-DATA。

import type { StudentAccount } from './student';
import type { Vendor, TodayMenu } from './menu';
import type { LedgerTransaction } from './ledger';
import type { LedgerAuditEvent } from './ledgerAudit';
import type { DailySettlement } from './cashClose';
import type { DailyCashSession } from './cashSession';
import { CASHIER_SENTINEL, recalculateStudentBalances } from './ledger';
import { validatePersistedState } from '../storage/posStateValidator';

export const SNAPSHOT_FORMAT = 'easyorder-practice-snapshot';
export const SNAPSHOT_SCHEMA_VERSION = 1;

/** 快照涵蓋的完整資料集；與持久化的欄位相同。 */
export interface PracticeDataset {
  students: StudentAccount[];
  transactions: LedgerTransaction[];
  vendors: Vendor[];
  todayMenu: TodayMenu;
  auditEvents: LedgerAuditEvent[];
  dailySettlements: DailySettlement[];
  businessDateStatuses: Record<string, 'open' | 'closed' | 'reopened'>;
  cashSessions: Record<string, DailyCashSession>;
}

export interface PracticeSnapshot {
  format: typeof SNAPSHOT_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  data: PracticeDataset;
}

export interface DatasetCounts {
  students: number;
  vendors: number;
  transactions: number;
  auditEvents: number;
  dailySettlements: number;
  cashSessions: number;
}

export function countDataset(d: PracticeDataset): DatasetCounts {
  return {
    students: d.students.length,
    vendors: d.vendors.length,
    transactions: d.transactions.length,
    auditEvents: d.auditEvents.length,
    dailySettlements: d.dailySettlements.length,
    cashSessions: Object.keys(d.cashSessions).length,
  };
}

export function pickDataset(state: PracticeDataset): PracticeDataset {
  return {
    students: state.students,
    transactions: state.transactions,
    vendors: state.vendors,
    todayMenu: state.todayMenu,
    auditEvents: state.auditEvents,
    dailySettlements: state.dailySettlements,
    businessDateStatuses: state.businessDateStatuses,
    cashSessions: state.cashSessions,
  };
}

export function buildSnapshot(state: PracticeDataset, exportedAt: string): PracticeSnapshot {
  return { format: SNAPSHOT_FORMAT, schemaVersion: SNAPSHOT_SCHEMA_VERSION, exportedAt, data: pickDataset(state) };
}

/** 下載檔名，例如 `easyorder-practice-20261012-0930.json`（以本機時間）。用 ASCII，部分瀏覽器會丟掉非 ASCII 檔名。 */
export function snapshotFileName(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `easyorder-practice-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.json`;
}

export type ParseSnapshotResult =
  | { ok: true; snapshot: PracticeSnapshot; counts: DatasetCounts }
  | { ok: false; reason: string };

/**
 * 解析並完整驗證快照。任何一項不合格都回傳原因，不產生部分資料；
 * 呼叫端只在 ok 時一次替換整個資料集。
 */
export function parseSnapshot(text: string): ParseSnapshotResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: '檔案不是有效的 JSON。' };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: '檔案內容不是快照。' };
  const r = raw as Record<string, unknown>;
  if (r.format !== SNAPSHOT_FORMAT) return { ok: false, reason: '這不是便當櫃台的練習快照檔。' };
  if (r.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    return { ok: false, reason: `不支援的快照版本：${String(r.schemaVersion)}（目前支援 ${SNAPSHOT_SCHEMA_VERSION}）。` };
  }
  if (typeof r.exportedAt !== 'string') return { ok: false, reason: '快照缺少匯出時間。' };

  const validation = validatePersistedState(r.data);
  if (!validation.ok) return { ok: false, reason: `資料格式不正確：${validation.reason}` };
  const data = r.data as PracticeDataset;

  const ids = new Set<string>();
  for (const s of data.students) {
    if (ids.has(s.studentId)) return { ok: false, reason: `帳戶編號重複：${s.studentId}` };
    ids.add(s.studentId);
  }
  const txIds = new Set<string>();
  for (const t of data.transactions) {
    if (txIds.has(t.transactionId)) return { ok: false, reason: `交易編號重複：${t.transactionId}` };
    txIds.add(t.transactionId);
    if (t.studentId !== CASHIER_SENTINEL && !ids.has(t.studentId)) {
      return { ok: false, reason: `交易 ${t.transactionId} 指向不存在的帳戶 ${t.studentId}。` };
    }
  }

  const snapshot: PracticeSnapshot = { format: SNAPSHOT_FORMAT, schemaVersion: SNAPSHOT_SCHEMA_VERSION, exportedAt: r.exportedAt, data };
  return { ok: true, snapshot, counts: countDataset(data) };
}

/**
 * 只清除練習交易：保留名單（含期初）、供應商與今日菜單；
 * 交易、更正稽核、關帳、營業日狀態與開帳一併清除，餘額回到期初。
 */
export function clearTransactionsKeepRoster(state: PracticeDataset): PracticeDataset {
  const { students } = recalculateStudentBalances(state.students, []);
  return {
    students,
    transactions: [],
    vendors: state.vendors,
    todayMenu: state.todayMenu,
    auditEvents: [],
    dailySettlements: [],
    businessDateStatuses: {},
    cashSessions: {},
  };
}
