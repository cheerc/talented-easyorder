import type { FaceDeviceStatus, FaceOrderEvent } from './faceOrder';
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
  /** 依營業日保存的晚餐設定。 */
  menusByDate: Record<string, TodayMenu>;
  auditEvents: LedgerAuditEvent[];
  dailySettlements: DailySettlement[];
  businessDateStatuses: Record<string, 'open' | 'closed' | 'reopened'>;
  cashSessions: Record<string, DailyCashSession>;
  /** 練習模式的模擬營業日；null 表示使用實際日期。 */
  simulationDate: string | null;
  /** 刷臉平板送來的事件與處理結果（舊快照沒有，還原時視為空）。 */
  faceEvents: FaceOrderEvent[];
  faceDevices: Record<string, FaceDeviceStatus>;
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

export function pickDataset(
  state: Omit<PracticeDataset, 'simulationDate' | 'menusByDate' | 'faceEvents' | 'faceDevices'> & {
    simulationDate?: string | null;
    menusByDate?: Record<string, TodayMenu>;
    faceEvents?: FaceOrderEvent[];
    faceDevices?: Record<string, FaceDeviceStatus>;
  },
): PracticeDataset {
  return {
    students: state.students,
    transactions: state.transactions,
    vendors: state.vendors,
    todayMenu: state.todayMenu,
    menusByDate: state.menusByDate ?? {},
    auditEvents: state.auditEvents,
    dailySettlements: state.dailySettlements,
    businessDateStatuses: state.businessDateStatuses,
    cashSessions: state.cashSessions,
    simulationDate: state.simulationDate ?? null,
    faceEvents: state.faceEvents ?? [],
    faceDevices: state.faceDevices ?? {},
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cashSessionProblem(date: string, session: unknown): string | null {
  if (typeof session !== 'object' || session === null) return '不是物件';
  const c = session as Record<string, unknown>;
  if (typeof c.cashSessionId !== 'string') return '缺少編號';
  if (c.businessDate !== date) return '日期與索引不一致';
  if (!Number.isSafeInteger(c.openingCash)) return '開帳金額不是整數';
  if (c.status !== 'open' && c.status !== 'closed') return `狀態不正確：${String(c.status)}`;
  return null;
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
  if (r.format !== SNAPSHOT_FORMAT) return { ok: false, reason: '這不是訂餐櫃台的練習快照檔。' };
  if (r.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    return { ok: false, reason: `不支援的快照版本：${String(r.schemaVersion)}（目前支援 ${SNAPSHOT_SCHEMA_VERSION}）。` };
  }
  if (typeof r.exportedAt !== 'string') return { ok: false, reason: '快照缺少匯出時間。' };

  const validation = validatePersistedState(r.data);
  if (!validation.ok) return { ok: false, reason: `資料格式不正確：${validation.reason}` };
  const rawData = r.data as Record<string, unknown>;
  const data = { ...(r.data as Omit<PracticeDataset, 'simulationDate' | 'menusByDate'>), menusByDate: {}, simulationDate: null, faceEvents: [], faceDevices: {} } as PracticeDataset;

  const sim = rawData.simulationDate;
  if (sim !== undefined && sim !== null) {
    if (typeof sim !== 'string' || !DATE_RE.test(sim)) return { ok: false, reason: `模擬營業日格式不正確：${String(sim)}` };
    data.simulationDate = sim;
  }

  // 舊快照沒有 menusByDate：視為尚未有日期設定，沿用 todayMenu。內容已由 validatePersistedState 檢查。
  if (rawData.menusByDate !== undefined) data.menusByDate = rawData.menusByDate as Record<string, TodayMenu>;

  // 刷臉事件與平板狀態：舊快照沒有，視為空。
  if (rawData.faceEvents !== undefined) {
    if (!Array.isArray(rawData.faceEvents)) return { ok: false, reason: '刷臉事件格式不正確。' };
    for (const e of rawData.faceEvents as unknown[]) {
      const ev = e as Record<string, unknown>;
      if (typeof ev !== 'object' || ev === null || typeof ev.eventId !== 'string' || typeof ev.studentId !== 'string'
        || (ev.action !== 'order' && ev.action !== 'cancel') || (ev.status !== 'accepted' && ev.status !== 'rejected')) {
        return { ok: false, reason: '刷臉事件格式不正確。' };
      }
    }
    data.faceEvents = rawData.faceEvents as FaceOrderEvent[];
  }
  if (rawData.faceDevices !== undefined) {
    if (typeof rawData.faceDevices !== 'object' || rawData.faceDevices === null || Array.isArray(rawData.faceDevices)) {
      return { ok: false, reason: '平板狀態格式不正確。' };
    }
    data.faceDevices = rawData.faceDevices as Record<string, FaceDeviceStatus>;
  }

  for (const [date, session] of Object.entries(data.cashSessions as Record<string, unknown>)) {
    const reason = cashSessionProblem(date, session);
    if (reason) return { ok: false, reason: `開帳資料不正確（${date}）：${reason}` };
  }

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
    if (!Number.isSafeInteger(t.amount) || !Number.isSafeInteger(t.afterBalance)) {
      return { ok: false, reason: `交易 ${t.transactionId} 的金額不是整數。` };
    }
  }

  // 不直接相信檔案裡的餘額：以期初＋交易重算，與 App 內的重算規則一致。
  const { students, transactions: studentTx } = recalculateStudentBalances(data.students, data.transactions);
  const cashierTx = data.transactions.filter(t => t.studentId === CASHIER_SENTINEL);
  data.students = students;
  data.transactions = [...studentTx, ...cashierTx].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const snapshot: PracticeSnapshot = { format: SNAPSHOT_FORMAT, schemaVersion: SNAPSHOT_SCHEMA_VERSION, exportedAt: r.exportedAt, data };
  return { ok: true, snapshot, counts: countDataset(data) };
}

/**
 * 只清除練習交易：保留名單（含期初）、供應商與各日菜單；
 * 交易、更正稽核、關帳、營業日狀態與開帳一併清除，餘額回到期初。
 */
export function clearTransactionsKeepRoster(state: PracticeDataset): PracticeDataset {
  const { students } = recalculateStudentBalances(state.students, []);
  return {
    students,
    transactions: [],
    vendors: state.vendors,
    todayMenu: state.todayMenu,
    menusByDate: state.menusByDate,
    auditEvents: [],
    dailySettlements: [],
    businessDateStatuses: {},
    cashSessions: {},
    simulationDate: state.simulationDate,
    // 刷臉事件跟著交易一起清掉；平板登記保留。
    faceEvents: [],
    faceDevices: state.faceDevices,
  };
}
