import type { LedgerTransaction } from './ledger';
import { sortLedgerChronologically } from './ledger';
import type { FaceEnrollmentStatus, StudentAccount } from './student';

/**
 * 刷臉訂餐（talented-faceorder Android 平板）與 easyorder 的交接。
 *
 * CheerC 2026-10-13 決定：
 * - 平板只訂餐、不繳費；要繳費的人到櫃台。平板的訂餐「自動入帳」，不經櫃台確認（分流櫃台人潮）。
 * - 同一人刷第二次：平板給「加訂一份」與「取消訂餐」兩個按鈕；後台接受同一帳號的第二份（兄弟姊妹共用帳號）。
 * - 刷臉的人不輸入文字；取消時餐費一律留在帳戶，若當天有付現金，平板提醒「退餐費請到櫃台。」
 * - 平板的註冊資料一有異動就主動回報，F3 帳戶清單顯示人臉註冊狀態（唯讀）。
 *
 * 這一輪沒有後端，練習模式用「模擬刷臉平板」送事件，規則與日後真平板相同。
 */

/** 刷臉產生的交易記在這個來源（沿用既有、已通過驗證的值，畫面上顯示「刷臉平板」）。 */
export const FACE_SOURCE_DEVICE: LedgerTransaction['sourceDevice'] = 'ipad_handoff';

/** 平板的操作人編號開頭；稽核與交易的 operatorId 用平板編號，例如 faceorder-01。 */
export const FACE_DEVICE_PREFIX = 'faceorder-';

export const FACE_CANCEL_REASON = '平板取消訂餐';
export const FACE_REFUND_NOTICE = '退餐費請到櫃台。';

export const FACE_REJECT_MESSAGES = {
  closed: '今天已關帳，請到櫃台。',
  noMenu: '今天還不能訂餐，請到櫃台。',
  noAccount: '找不到這個帳戶，請到櫃台。',
  inactive: '這個帳戶已停用，請到櫃台。',
  nothingToCancel: '今天沒有訂餐可以取消。',
  invalid: '資料不完整，請到櫃台。',
} as const;

export type FaceEventAction = 'order' | 'cancel';

/** 平板送來的事件（日後是 Firestore faceOrderEvents 文件；見 faceorder docs/PLAN.md §3.3）。 */
export interface FaceOrderRequest {
  /** 平板產生的唯一編號；同一個事件重送只處理一次。 */
  eventId: string;
  deviceId: string;
  action: FaceEventAction;
  /** 訂餐編號＝帳戶編號。 */
  studentId: string;
  /** 共用帳戶時，刷臉的是哪一位（例如兄弟姊妹之一）；顯示在備註。 */
  memberName?: string;
  businessDate: string;
  /** 平板辨識的時間（ISO）。 */
  recognizedAt: string;
}

export type FaceEventStatus = 'accepted' | 'rejected';

/** 後台處理結果，平板依此顯示成功或請到櫃台。 */
export interface FaceOrderEvent extends FaceOrderRequest {
  status: FaceEventStatus;
  /** 退回原因（給平板顯示）。 */
  reason?: string;
  /** 成功但要提醒的話，例如「退餐費請到櫃台。」 */
  notice?: string;
  /** 入帳或取消的那一筆交易。 */
  transactionId?: string;
  /** 帳戶名稱（處理當下）。 */
  studentName?: string;
  /** 訂餐時這個人當天已經有訂餐（第二次刷臉的「加訂一份」）。舊事件沒有這個欄位。 */
  additional?: boolean;
  handledAt: string;
}

/** 平板連線狀態（日後是 Firestore faceDevices/{deviceId}）。 */
export interface FaceDeviceStatus {
  deviceId: string;
  online: boolean;
  lastSeenAt: string;
  appVersion?: string;
  modelVersion?: string;
}

/**
 * 時間一律存 UTC ISO（…Z），和櫃台的 new Date().toISOString() 一致。
 * 交易依 createdAt 字串排序，混入 +08:00 會讓「最後一筆」判斷錯誤（#463 review）。無法解析時用現在時間。
 */
export function normalizeFaceTime(value: string | undefined | null): string {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : new Date().toISOString();
}

const BUSINESS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 事件是否有基本資料且格式正確：缺欄位、日期不是 YYYY-MM-DD、平板編號不是 faceorder- 開頭都算不完整。 */
export function isFaceRequestComplete(request: FaceOrderRequest): boolean {
  return Boolean(request.eventId && request.studentId)
    && typeof request.businessDate === 'string' && BUSINESS_DATE_RE.test(request.businessDate)
    && isFaceDevice(request.deviceId);
}

export function isFaceDevice(operatorId: string | undefined | null): boolean {
  return typeof operatorId === 'string' && operatorId.startsWith(FACE_DEVICE_PREFIX);
}

/** 平板編號給人看的名字：faceorder-01 → 刷臉平板 01。 */
export function faceDeviceLabel(deviceId: string): string {
  const suffix = deviceId.slice(FACE_DEVICE_PREFIX.length);
  return suffix ? `刷臉平板 ${suffix}` : '刷臉平板';
}

/** 刷臉訂餐的備註；共用帳戶時寫出是哪一位。明細上一眼看得出是刷臉的。 */
export function faceOrderNote(memberName?: string): string {
  const name = memberName?.trim();
  return name ? `刷臉訂餐（${name}）` : '刷臉訂餐';
}

export function isFaceTransaction(tx: Pick<LedgerTransaction, 'sourceDevice'>): boolean {
  return tx.sourceDevice === FACE_SOURCE_DEVICE;
}

/** 平板取消時取消哪一筆：這個人當天最後一筆訂餐（不論是刷臉或櫃台登記的）。 */
export function pickOrderToCancel(transactions: LedgerTransaction[], studentId: string, businessDate: string): LedgerTransaction | undefined {
  const orders = transactions.filter(t => t.studentId === studentId && t.businessDate === businessDate && t.type === 'order');
  const sorted = sortLedgerChronologically(orders);
  return sorted[sorted.length - 1];
}

/**
 * 取消時要不要提醒「退餐費請到櫃台。」：被取消的那一筆當場有付現金，或這個人當天在櫃台繳過費。
 * 只用儲值餘額付的（當天沒有付現金）不提醒。餐費一律留在帳戶，退現金由櫃台處理。
 */
export function cancelNeedsRefundNotice(cancelled: LedgerTransaction, transactions: LedgerTransaction[]): boolean {
  if (cancelled.paidAmount > 0) return true;
  return transactions.some(t =>
    t.studentId === cancelled.studentId &&
    t.businessDate === cancelled.businessDate &&
    t.type === 'payment' &&
    t.paidAmount > 0);
}

/**
 * 平板讀得到的「今日訂餐狀態」（日後是 dailyOrderStatus 投影）。只有名字與份數，不含餘額、交易、價格（隱私邊界）。
 * orderCount > 0 時平板顯示「加訂一份」「取消訂餐」兩個按鈕。
 */
export interface FaceDailyStatus {
  studentId: string;
  displayName: string;
  active: boolean;
  orderCount: number;
}

export function faceDailyStatus(
  students: StudentAccount[],
  transactions: LedgerTransaction[],
  businessDate: string,
  studentId: string,
): FaceDailyStatus | null {
  const s = students.find(x => x.studentId === studentId);
  if (!s) return null;
  const orderCount = transactions.filter(t => t.studentId === studentId && t.businessDate === businessDate && t.type === 'order').length;
  return { studentId, displayName: s.displayName, active: s.status === 'active', orderCount };
}

/** 平板回報的註冊異動（新增、停用、重新註冊）；後台更新帳戶的人臉註冊狀態。 */
export interface FaceEnrollmentUpdate {
  deviceId: string;
  studentId: string;
  status: FaceEnrollmentStatus;
  /** 這個帳戶在平板上註冊了幾張臉（共用帳戶可以多張）。 */
  faceCount?: number;
  reportedAt: string;
}

export const FACE_ENROLLMENT_LABELS: Record<FaceEnrollmentStatus, string> = {
  none: '未註冊',
  enrolled: '已註冊',
  disabled: '已停用',
  needs_review: '待確認',
};

/** F1「刷臉訂餐」動態：某一天的刷臉事件，新的在前。 */
export function faceEventsForDate(events: readonly FaceOrderEvent[], businessDate: string, limit = 10): FaceOrderEvent[] {
  return events
    .filter(e => e.businessDate === businessDate)
    .sort((a, b) => b.handledAt.localeCompare(a.handledAt))
    .slice(0, limit);
}

/** 動態上的動作：訂餐／加訂／取消。 */
export function faceEventActionLabel(ev: Pick<FaceOrderEvent, 'action' | 'additional'>): string {
  if (ev.action === 'cancel') return '取消';
  return ev.additional ? '加訂' : '訂餐';
}

/** 動態上的結果：入帳、已取消（附提醒）或退回＋原因。 */
export function faceEventResultLabel(ev: Pick<FaceOrderEvent, 'action' | 'status' | 'reason' | 'notice'>): string {
  if (ev.status === 'rejected') return `退回：${ev.reason ?? '請到櫃台。'}`;
  const base = ev.action === 'cancel' ? '已取消' : '入帳';
  return ev.notice ? `${base} · ${ev.notice}` : base;
}

/** F3 帳戶清單的人臉欄（唯讀）：狀態，平板回報過張數時加「（N 張）」。 */
export function faceEnrollmentText(student: Pick<StudentAccount, 'faceEnrollmentStatus' | 'faceCount'>): string {
  const label = FACE_ENROLLMENT_LABELS[student.faceEnrollmentStatus] ?? FACE_ENROLLMENT_LABELS.none;
  return typeof student.faceCount === 'number' ? `${label}（${student.faceCount} 張）` : label;
}
