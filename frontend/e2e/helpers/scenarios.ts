// #669：具名、可重建的業務情境 fixture（demo-easyorder Emulator 專用，只用合成資料）。
//
// 每個 scenario 用 Admin REST 建立「前置狀態」，回傳到達狀態需要的識別值與 `cleanup()`。
// Admin REST 會略過 Rules，所以只能建立前置狀態；被測的行為（停用、恢復、移除、補開帳…）必須走 UI 正式命令。
// cleanup 移除該 scenario 寫的文件、UI 命令留下的 receipt，並把 `system/dataHead` 還原成建立前的樣子。
// 日期一律用 `findUnusedDays` 探測，不覆寫其他 suite 的資料；「今天」的 scenario 在今天已有營業日時直接失敗。
import type { Page } from '@playwright/test';
import { PROJECT, removeDocument, upsertDocument } from './seed';

const FIRESTORE = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const ADMIN = { Authorization: 'Bearer owner' };

/** `ui-closeout.spec.ts` 與 `scenarios.spec.ts` 共用的待核對命令 journal 命名空間（對應 App 的 localStorage key）。 */
export const JOURNAL_NAMESPACE = 'easyorder-cloud-command-journal:v1:demo-easyorder:%5BDEFAULT%5D';
export const PENDING_COMMAND_ID = 'a0652000-0000-4000-8000-000000000001';

const SEED_ACTOR = 'synthetic-scenario';
const SEED_COMMAND = 'a0669000-0000-4000-8000-000000000001';
const ZERO_TOTALS = {
  activeTransactionCount: 0, bentoCount: 0, otherMealCount: 0, mealTotal: 0,
  retainedReceipts: 0, cashierIncome: 0, cashierExpense: 0, accountRefunds: 0,
};

export interface ScenarioHandle {
  /** 移除 scenario 寫的文件並還原 dataHead；可重複呼叫。 */
  cleanup(): Promise<void>;
}

export function taipeiToday(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date());
}

export function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10);
}

type RawFields = Record<string, { stringValue?: string; integerValue?: string }>;

async function readRaw(collection: string, id: string): Promise<RawFields | null> {
  const response = await fetch(`${FIRESTORE}/${collection}/${encodeURIComponent(id)}`, { headers: ADMIN });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`無法讀取 ${collection}/${id}：${response.status}`);
  return ((await response.json()) as { fields?: RawFields }).fields ?? {};
}

async function listRaw(collection: string): Promise<Array<{ id: string; fields: RawFields }>> {
  const response = await fetch(`${FIRESTORE}/${collection}?pageSize=300`, { headers: ADMIN });
  if (!response.ok) throw new Error(`無法列出 ${collection}：${response.status}`);
  const body = (await response.json()) as { documents?: Array<{ name: string; fields?: RawFields }> };
  return (body.documents ?? []).map(item => ({ id: item.name.split('/').at(-1) ?? '', fields: item.fields ?? {} }));
}

/** 該營業日已存在就丟錯：不覆寫別的 suite（或上一輪殘留）的狀態。 */
export async function assertDayAbsent(day: string): Promise<void> {
  if ((await readRaw('days', day)) !== null) throw new Error(`days/${day} 已存在；scenario 不覆寫既有營業日`);
}

/**
 * 在近 30 天內尋找沒有被使用的營業日（升冪，最舊的在前）。`adjacent` 要求連續日期。
 * 從 5 天前起算，避開今天與昨天，讓其他 suite 用「今天／昨天」的流程不會撞到。
 */
export async function findUnusedDays(count: number, options: { adjacent: boolean }): Promise<string[]> {
  const today = taipeiToday();
  const used = async (day: string) => (await readRaw('days', day)) !== null;
  if (options.adjacent) {
    for (let oldest = 5 + count - 1; oldest < 30; oldest++) {
      const days = Array.from({ length: count }, (_, index) => shiftDay(today, -(oldest - index)));
      if ((await Promise.all(days.map(used))).every(isUsed => !isUsed)) return days;
    }
  } else {
    const found: string[] = [];
    for (let offset = 29; offset >= 5 && found.length < count; offset--) {
      const day = shiftDay(today, -offset);
      if (!(await used(day))) found.push(day);
    }
    if (found.length === count) return found;
  }
  throw new Error('近期沒有可用的合成 fixture 日期');
}

interface HeadSnapshot { seq: number; lastCommandId: string | null; goLiveDate: string }

async function captureHead(): Promise<HeadSnapshot> {
  const fields = await readRaw('system', 'dataHead');
  if (!fields) throw new Error('無法讀取 demo dataHead');
  return {
    seq: Number(fields.seq?.integerValue ?? 0),
    lastCommandId: fields.lastCommandId?.stringValue ?? null,
    goLiveDate: String(fields.goLiveDate?.stringValue ?? ''),
  };
}

/** UI 正式命令留下的 receipt 與推進的 head 一併還原，後面的 case 才會從同一個 head 開始。 */
async function restoreHead(original: HeadSnapshot): Promise<void> {
  for (const command of await listRaw('commands')) {
    if (Number(command.fields.seq?.integerValue ?? 0) > original.seq) await removeDocument('commands', command.id);
  }
  await upsertDocument('system', 'dataHead', {
    seq: original.seq, lastCommandId: original.lastCommandId, goLiveDate: original.goLiveDate,
  });
}

/** 建立 cleanup：先跑自己的移除，再還原 dataHead；重複呼叫只會做一次。 */
function cleanupAfter(original: HeadSnapshot, remove: () => Promise<void>): () => Promise<void> {
  let done = false;
  return async () => {
    if (done) return;
    done = true;
    await remove();
    await restoreHead(original);
  };
}

function openDayData(menu: Record<string, unknown> | null, openingCash: number | null, openedBy: string | null) {
  return {
    status: 'open', revision: 2, menu, openingCash, openedBy, openedAt: openingCash === null ? null : new Date(),
    totals: ZERO_TOTALS, lastSettlementRevision: 0, lastCommandId: SEED_COMMAND, updatedAt: new Date(),
  };
}

function vendorData(vendorId: string, name: string, status: 'active' | 'inactive') {
  return {
    vendorId, name, phone: '', note: '', status, deleted: false,
    createdAt: new Date(), revision: 1, lastCommandId: SEED_COMMAND, updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------- 今天的營業日（F1a／F1b）

export interface OpenDayScenario extends ScenarioHandle { today: string }

async function openToday(menu: Record<string, unknown> | null, extra: () => Promise<() => Promise<void>> = async () => async () => undefined) {
  const today = taipeiToday();
  await assertDayAbsent(today);
  const head = await captureHead();
  await upsertDocument('days', today, openDayData(menu, 1000, SEED_ACTOR));
  const removeExtra = await extra();
  const cleanup = cleanupAfter(head, async () => {
    await removeDocument('days', today);
    await removeExtra();
  });
  return { today, cleanup };
}

export interface OpenDayWithMenuScenario extends OpenDayScenario {
  vendorId: string; vendorName: string; menuName: string; menuPrice: number;
  studentId: string; studentCode: string; studentName: string;
}

/** F1a：今天已開帳且有菜單；有一個使用中的合成供應商與一位合成學生。 */
export async function seedOpenDayWithMenu(): Promise<OpenDayWithMenuScenario> {
  const today = taipeiToday();
  const vendorId = 'v-scenario-a';
  const vendorName = '合成供應商甲';
  const menuName = '合成日餐盒';
  const menuPrice = 90;
  const studentId = '00000000-0000-4000-8000-0000000669a1';
  const studentCode = '951';
  const studentName = '測試學生 001';
  const menu = {
    businessDate: today, itemName: menuName, price: menuPrice, vendorId, vendorNameSnapshot: vendorName,
    updatedAt: new Date(), revision: 1, inheritedFromDate: null,
  };
  const { cleanup } = await openToday(menu, async () => {
    await upsertDocument('vendors', vendorId, vendorData(vendorId, vendorName, 'active'));
    await upsertDocument('students', studentId, {
      studentId, studentCode, displayName: studentName, aliases: [], status: 'active',
      openingBalance: { amount: 100, asOfDate: today, note: '', createdAt: new Date() },
      currentBalance: 100, createdAt: new Date(), revision: 1, lastCommandId: SEED_COMMAND, updatedAt: new Date(),
    });
    await upsertDocument('studentCodes', studentCode, { studentId, lastCommandId: SEED_COMMAND, updatedAt: new Date() });
    return async () => {
      await removeDocument('studentCodes', studentCode);
      await removeDocument('students', studentId);
      await removeDocument('vendors', vendorId);
    };
  });
  return { today, vendorId, vendorName, menuName, menuPrice, studentId, studentCode, studentName, cleanup };
}

/** F1b：今天已開帳、沒有菜單（「今日尚未設定菜單」）。 */
export async function seedOpenDayWithoutMenu(): Promise<OpenDayScenario> {
  const { today, cleanup } = await openToday(null);
  return { today, cleanup };
}

// ---------------------------------------------------------------- 過去的營業日（F2a、補開帳、回填、R1）

export interface PastDaysScenario extends ScenarioHandle { days: string[] }

/** F2a：N 個過去的未關帳營業日（已開帳、沒有交易）；goLiveDate 提前到最早一天。 */
export async function seedUnclosedPastDays(count: number): Promise<PastDaysScenario> {
  const days = await findUnusedDays(count, { adjacent: false });
  const head = await captureHead();
  await upsertDocument('system', 'dataHead', { goLiveDate: days[0] });
  for (const day of days) await upsertDocument('days', day, openDayData(null, 800, SEED_ACTOR));
  const cleanup = cleanupAfter(head, async () => { for (const day of days) await removeDocument('days', day); });
  return { days, cleanup };
}

export interface UnopenedPastDayScenario extends ScenarioHandle { dayId: string }

/** 補開帳：過去日存在但沒有開帳現金（例如為更正期初建立的營業日）。 */
export async function seedUnopenedPastDay(): Promise<UnopenedPastDayScenario> {
  const [dayId] = await findUnusedDays(1, { adjacent: false });
  const head = await captureHead();
  await upsertDocument('system', 'dataHead', { goLiveDate: dayId });
  await upsertDocument('days', dayId, openDayData(null, null, null));
  const cleanup = cleanupAfter(head, async () => { await removeDocument('days', dayId); });
  return { dayId, cleanup };
}

export interface BackfillScenario extends ScenarioHandle { dayId: string; reason: string }

/** 回填中：過去日已開帳且有回填標記，尚未關帳。 */
export async function seedBackfillInProgress(): Promise<BackfillScenario> {
  const [dayId] = await findUnusedDays(1, { adjacent: false });
  const reason = '合成情境：停電補登';
  const head = await captureHead();
  await upsertDocument('system', 'dataHead', { goLiveDate: dayId });
  await upsertDocument('days', dayId, openDayData(null, 800, SEED_ACTOR));
  await upsertDocument('backfillDays', dayId, {
    dayId, reason, startedBy: SEED_ACTOR, startedAt: new Date(), commandId: SEED_COMMAND,
  });
  const cleanup = cleanupAfter(head, async () => {
    await removeDocument('backfillDays', dayId);
    await removeDocument('days', dayId);
  });
  return { dayId, reason, cleanup };
}

export interface AdjacentCashGapScenario extends ScenarioHandle { olderDay: string; newerDay: string; days: string[] }

/**
 * R1：相鄰兩個已關帳營業日，舊日關帳現金 1000、新日開帳 950；頂部出現「異常 1」，帳務檢查有補記捷徑。
 * 從 `ui-closeout.spec.ts` 原樣抽出。
 */
export async function seedAdjacentCashGap(): Promise<AdjacentCashGapScenario> {
  const days = await findUnusedDays(2, { adjacent: true });
  const head = await captureHead();
  await upsertDocument('system', 'dataHead', { goLiveDate: days[0] });
  for (const [index, day] of days.entries()) {
    const cash = index ? 950 : 1000;
    await upsertDocument('days', day, {
      status: 'closed', revision: 1, menu: null, openingCash: cash, openedBy: 'synthetic-ui', openedAt: new Date(),
      totals: ZERO_TOTALS, lastSettlementRevision: 1, lastCommandId: PENDING_COMMAND_ID, updatedAt: new Date(),
    });
    await upsertDocument(`days/${day}/settlements`, '1', {
      dayId: day, revision: 1, status: 'closed', totals: ZERO_TOTALS, openingCash: cash, expectedCash: cash, countedCash: cash,
      difference: 0, note: '', actorUid: 'synthetic-ui', actorEmail: 'synthetic@example.test', sourceSeq: 1,
      committedAt: new Date(), previousRevision: 0, lastCommandId: PENDING_COMMAND_ID,
    });
  }
  const cleanup = cleanupAfter(head, async () => {
    for (const day of days) {
      await removeDocument(`days/${day}/settlements`, '1');
      await removeDocument('days', day);
    }
  });
  return { olderDay: days[0], newerDay: days[1], days, cleanup };
}

// ---------------------------------------------------------------- 供應商（F4）

export interface VendorsScenario extends ScenarioHandle {
  activeId: string; activeName: string; inactiveId: string; inactiveName: string;
}

/** F4：一個使用中、一個已停用的合成供應商，供停用／恢復／移除流程（本身經 UI 走正式命令）。 */
export async function seedVendors(): Promise<VendorsScenario> {
  const activeId = 'v-scenario-active';
  const inactiveId = 'v-scenario-inactive';
  const activeName = '合成供應商甲';
  const inactiveName = '合成供應商乙';
  const head = await captureHead();
  await upsertDocument('vendors', activeId, vendorData(activeId, activeName, 'active'));
  await upsertDocument('vendors', inactiveId, vendorData(inactiveId, inactiveName, 'inactive'));
  const cleanup = cleanupAfter(head, async () => {
    await removeDocument('vendors', activeId);
    await removeDocument('vendors', inactiveId);
  });
  return { activeId, activeName, inactiveId, inactiveName, cleanup };
}

// ---------------------------------------------------------------- 待核對命令（R2）

export interface PendingCommandScenario extends ScenarioHandle { commandId: string }

/**
 * R2：待核對命令；`.cloud-pending-recovery` 顯示命令編號。journal 是瀏覽器 localStorage，
 * 必須在「取得系統使用權」之前呼叫。從 `ui-closeout.spec.ts` 抽出。
 */
export async function seedPendingCommand(page: Page, uid: string, commandId = PENDING_COMMAND_ID): Promise<PendingCommandScenario> {
  const head = await readRaw('system', 'dataHead');
  const datasetId = head?.datasetId?.stringValue;
  if (!datasetId) throw new Error('無法讀取 demo dataset 編號');
  await page.evaluate(({ uid, commandId, datasetId, namespace }) => {
    localStorage.setItem(`${namespace}:${commandId}`, JSON.stringify({ commandId, datasetId, uid }));
  }, { uid, commandId, datasetId, namespace: JOURNAL_NAMESPACE });
  const cleanup = async () => {
    await page.evaluate(({ namespace, commandId }) => localStorage.removeItem(`${namespace}:${commandId}`), {
      namespace: JOURNAL_NAMESPACE, commandId,
    }).catch(() => undefined);
  };
  return { commandId, cleanup };
}
