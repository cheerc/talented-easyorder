import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { usePosStore } from '../posStore';
import { createLocalAccount } from '../../domain/student';
import { FACE_REFUND_NOTICE, FACE_REJECT_MESSAGES, FACE_SOURCE_DEVICE, faceDailyStatus, type FaceOrderRequest } from '../../domain/faceOrder';
import { buildPosTransactionDraft } from '../../domain/posTransaction';
import { resolveMenuForDate } from '../../domain/menu';
import { operatorLabel } from '../../domain/operatorId';

// 刷臉訂餐自動入帳（CheerC 2026-10-13）。帳戶：001 甲 期初 200、002 乙 期初 0；晚餐 90。
const D = '2026-10-14';
let seq = 0;
const req = (studentId: string, action: 'order' | 'cancel' = 'order', extra: Partial<FaceOrderRequest> = {}): FaceOrderRequest => ({
  eventId: `ev-${++seq}`, deviceId: 'faceorder-01', action, studentId, businessDate: D, recognizedAt: `${D}T10:00:00.000Z`, ...extra,
});
const s = () => usePosStore.getState();
const T = `${D}T02:00:00.000Z`;
const t = (n: number) => `${D}T02:00:0${n}.000Z`;
const bal = (id: string) => s().students.find(x => x.studentId === id)!.currentBalance;

function counterOrder(studentId: string, paid: number) {
  const st = s();
  const student = st.students.find(x => x.studentId === studentId)!;
  const r = st.commitPosTransactionDraft(buildPosTransactionDraft({
    intent: { businessDate: D, studentId, type: 'order', mealPrice: 90, paidAmount: paid, note: '', sourceDevice: 'pc' },
    student, menu: resolveMenuForDate(st.menusByDate, st.todayMenu, D).menu,
  }));
  if (!r.ok) throw new Error(r.message);
}

beforeEach(() => {
  s().startBlankData();
  s().addLocalStudent(createLocalAccount({ studentId: '001', displayName: '測試甲', openingBalance: 200, openingNote: '', asOfDate: D }, 'now'));
  s().addLocalStudent(createLocalAccount({ studentId: '002', displayName: '測試乙', openingBalance: 0, openingNote: '', asOfDate: D }, 'now'));
  s().setMenuForDate(D, { itemName: '排骨便當', price: 90, vendorId: '', vendorNameSnapshot: '' }, 'now');
});

describe('刷臉訂餐自動入帳', () => {
  it('訂餐：今日便當、應收 90、實收 0，來源刷臉平板，備註寫刷臉（含成員），帳戶扣 90', () => {
    const ev = s().handleFaceEvent(req('001', 'order', { memberName: '小甲' }), `${D}T10:00:01.000Z`);
    expect(ev).toMatchObject({ status: 'accepted', studentName: '測試甲' });
    const tx = s().transactions.find(t => t.transactionId === ev.transactionId)!;
    expect(tx).toMatchObject({ type: 'order', mealPrice: 90, paidAmount: 0, sourceDevice: FACE_SOURCE_DEVICE, operatorId: 'faceorder-01', note: '刷臉訂餐（小甲）' });
    expect(bal('001')).toBe(110);
    expect(operatorLabel(tx.operatorId)).toBe('刷臉平板 01');
    expect(s().faceDevices['faceorder-01']).toMatchObject({ online: true });
  });

  it('同一帳號第二份照樣入帳（兄弟姊妹共用）；同一事件重送不重複入帳', () => {
    const first = req('001');
    s().handleFaceEvent(first, t(1));
    s().handleFaceEvent(req('001'), t(2));
    const again = s().handleFaceEvent(first, t(3));
    expect(again.handledAt).toBe(t(1));
    expect(s().faceEvents.map(e => e.additional)).toEqual([true, undefined]);
    expect(s().transactions.filter(t => t.type === 'order')).toHaveLength(2);
    expect(bal('001')).toBe(20);
    expect(s().faceEvents).toHaveLength(2);
    expect(faceDailyStatus(s().students, s().transactions, D, '001')).toEqual({ studentId: '001', displayName: '測試甲', active: true, orderCount: 2 });
  });

  it('退回：找不到帳戶、停用、關帳、沒設晚餐；都不入帳', () => {
    expect(s().handleFaceEvent(req('999'), T).reason).toBe(FACE_REJECT_MESSAGES.noAccount);
    s().setLocalStudentStatus('002', 'inactive', 'now');
    expect(s().handleFaceEvent(req('002'), T).reason).toBe(FACE_REJECT_MESSAGES.inactive);
    expect(s().handleFaceEvent(req('001', 'order', { businessDate: '2026-10-01' }), T).reason).toBe(FACE_REJECT_MESSAGES.noMenu);
    s().setBusinessDateStatus(D, 'closed');
    expect(s().handleFaceEvent(req('001'), T).reason).toBe(FACE_REJECT_MESSAGES.closed);
    expect(s().transactions).toHaveLength(0);
    expect(s().faceEvents.every(e => e.status === 'rejected')).toBe(true);
  });
});

describe('刷臉取消訂餐', () => {
  it('取消最後一筆；沒付現金（用儲值）不提醒；稽核留理由與平板', () => {
    s().handleFaceEvent(req('001'), t(1));
    const ev = s().handleFaceEvent(req('001', 'cancel'), t(2));
    expect(ev).toMatchObject({ status: 'accepted' });
    expect(ev.notice).toBeUndefined();
    expect(s().transactions.filter(t => t.type === 'order')).toHaveLength(0);
    expect(bal('001')).toBe(200);
    const audit = s().auditEvents[s().auditEvents.length - 1];
    expect(audit).toMatchObject({ reason: '平板取消訂餐', operatorId: 'faceorder-01' });
  });

  it('今天在櫃台付了現金：錢留在帳戶，提醒「退餐費請到櫃台。」', () => {
    counterOrder('002', 100);
    const ev = s().handleFaceEvent(req('002', 'cancel'), T);
    expect(ev.notice).toBe(FACE_REFUND_NOTICE);
    // 原單改成繳費 100：餘額 100，櫃台現金不變（沒有退錢）。
    expect(bal('002')).toBe(100);
    expect(s().transactions.find(t => t.studentId === '002')).toMatchObject({ type: 'payment', paidAmount: 100 });
  });

  it('今天沒有訂餐可取消、已關帳都退回', () => {
    expect(s().handleFaceEvent(req('001', 'cancel'), T).reason).toBe(FACE_REJECT_MESSAGES.nothingToCancel);
    s().handleFaceEvent(req('001'), T);
    s().setBusinessDateStatus(D, 'closed');
    expect(s().handleFaceEvent(req('001', 'cancel'), T).reason).toBe(FACE_REJECT_MESSAGES.closed);
    expect(s().transactions.filter(t => t.type === 'order')).toHaveLength(1);
  });
});

describe('#463 review：時間一律存 UTC、資料不完整不寫入', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('平板傳 +08:00 時間也存成 UTC；平板 10:00 訂、櫃台 10:01 訂，取消的是櫃台那筆（最後一筆）', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 台北 10:00 平板訂餐（平板送台北時間字串）
    vi.setSystemTime(new Date('2026-10-14T02:00:00.000Z'));
    const ordered = s().handleFaceEvent(req('002'), '2026-10-14T10:00:00+08:00');
    expect(ordered.handledAt).toBe('2026-10-14T02:00:00.000Z');
    const faceTx = s().transactions.find(t => t.transactionId === ordered.transactionId)!;
    expect(faceTx.createdAt).toBe('2026-10-14T02:00:00.000Z');
    // 台北 10:01 櫃台訂餐（櫃台存 UTC）
    vi.setSystemTime(new Date('2026-10-14T02:01:00.000Z'));
    counterOrder('002', 0);
    const counterTx = s().transactions.find(t => t.studentId === '002' && t.transactionId !== ordered.transactionId)!;
    vi.setSystemTime(new Date('2026-10-14T02:02:00.000Z'));
    const cancelled = s().handleFaceEvent(req('002', 'cancel'), '2026-10-14T10:02:00+08:00');
    expect(cancelled.transactionId).toBe(counterTx.transactionId);
    expect(s().transactions.some(t => t.transactionId === faceTx.transactionId)).toBe(true);
  });

  it('無法解析的時間改用現在時間（UTC）', () => {
    const ev = s().handleFaceEvent(req('001'), 'not-a-time');
    expect(ev.handledAt).toMatch(/Z$/);
    expect(Number.isNaN(new Date(ev.handledAt).getTime())).toBe(false);
  });

  it('註冊回報與平板狀態的時間也存成 UTC', () => {
    s().applyFaceEnrollment({ deviceId: 'faceorder-01', studentId: '001', status: 'enrolled', reportedAt: '2026-10-14T10:00:00+08:00' });
    expect(s().students.find(x => x.studentId === '001')!.updatedAt).toBe('2026-10-14T02:00:00.000Z');
    expect(s().faceDevices['faceorder-01'].lastSeenAt).toBe('2026-10-14T02:00:00.000Z');
    s().setFaceDeviceStatus({ deviceId: 'faceorder-01', online: false, lastSeenAt: '2026-10-14T11:00:00+08:00' });
    expect(s().faceDevices['faceorder-01'].lastSeenAt).toBe('2026-10-14T03:00:00.000Z');
  });

  it.each([
    ['缺 eventId', { eventId: '' }],
    ['缺 studentId', { studentId: '' }],
    ['缺 businessDate', { businessDate: '' }],
    ['缺 deviceId', { deviceId: '' }],
  ])('資料不完整（%s）：退回但不寫入事件、不登記平板', (_label, extra) => {
    const ev = s().handleFaceEvent(req('001', 'order', extra), T);
    expect(ev).toMatchObject({ status: 'rejected', reason: FACE_REJECT_MESSAGES.invalid });
    expect(s().faceEvents).toEqual([]);
    expect(s().faceDevices).toEqual({});
    expect(s().transactions).toEqual([]);
  });

  it('資料不完整的事件不會被重送快取命中：補齊後同一 eventId 照常處理', () => {
    const bad = req('001', 'order', { businessDate: '' });
    expect(s().handleFaceEvent(bad, T).status).toBe('rejected');
    const fixed = s().handleFaceEvent({ ...bad, businessDate: D }, T);
    expect(fixed.status).toBe('accepted');
    expect(s().faceEvents).toHaveLength(1);
  });

  it.each([
    ['日期格式不對', { businessDate: '2026/10/14' }],
    ['日期不是 YYYY-MM-DD', { businessDate: '20261014' }],
    ['平板編號不是 faceorder- 開頭', { deviceId: 'ipad-01' }],
  ])('格式檢查（%s）：當資料不完整退回、不寫入', (_label, extra) => {
    const ev = s().handleFaceEvent(req('001', 'order', extra), T);
    expect(ev).toMatchObject({ status: 'rejected', reason: FACE_REJECT_MESSAGES.invalid });
    expect(s().faceEvents).toEqual([]);
    expect(s().faceDevices).toEqual({});
    expect(s().transactions).toEqual([]);
  });
});

describe('人臉註冊異動與平板狀態', () => {
  it('平板回報註冊狀態與張數，更新帳戶；找不到帳戶回傳 false', () => {
    expect(s().applyFaceEnrollment({ deviceId: 'faceorder-01', studentId: '001', status: 'enrolled', faceCount: 2, reportedAt: T })).toBe(true);
    expect(s().students.find(x => x.studentId === '001')).toMatchObject({ faceEnrollmentStatus: 'enrolled', faceCount: 2 });
    expect(s().applyFaceEnrollment({ deviceId: 'faceorder-01', studentId: '999', status: 'enrolled', reportedAt: T })).toBe(false);
    s().setFaceDeviceStatus({ deviceId: 'faceorder-01', online: false, lastSeenAt: t(2) });
    expect(s().faceDevices['faceorder-01']).toMatchObject({ online: false, lastSeenAt: t(2) });
  });

  it('只清除練習交易時，刷臉事件一起清掉', () => {
    s().handleFaceEvent(req('001'), T);
    s().clearPracticeTransactions();
    expect(s().faceEvents).toEqual([]);
    expect(s().transactions).toEqual([]);
  });
});
