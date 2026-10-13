import type { PosState } from '../posTypes';
import { createLedgerTransaction, rebalanceAccounts } from '../../domain/ledger';
import { createStudentSnapshot } from '../../domain/student';
import { createMenuSnapshot, isMenuReady, resolveMenuForDate } from '../../domain/menu';
import {
  FACE_CANCEL_REASON, FACE_REFUND_NOTICE, FACE_REJECT_MESSAGES, FACE_SOURCE_DEVICE,
  cancelNeedsRefundNotice, faceOrderNote, pickOrderToCancel,
  type FaceOrderEvent, type FaceOrderRequest,
} from '../../domain/faceOrder';

/**
 * 刷臉訂餐：平板送來的事件自動入帳或取消（CheerC 2026-10-13 決定，不經櫃台確認）。
 * 關帳鎖、稽核、餘額重算都沿用櫃台的同一套規則。
 */
export function createFaceActions(
  set: (partial: Partial<PosState> | ((state: PosState) => Partial<PosState>)) => void,
  get: () => PosState,
): Pick<PosState, 'handleFaceEvent' | 'applyFaceEnrollment' | 'setFaceDeviceStatus'> {
  const record = (event: FaceOrderEvent) => {
    set((state) => ({
      faceEvents: [event, ...state.faceEvents],
      faceDevices: {
        ...state.faceDevices,
        [event.deviceId]: { ...(state.faceDevices[event.deviceId] ?? {}), deviceId: event.deviceId, online: true, lastSeenAt: event.handledAt },
      },
    }));
    return event;
  };

  return {
    handleFaceEvent: (request: FaceOrderRequest, now: string): FaceOrderEvent => {
      const state = get();
      // 同一個事件重送（例如平板沒收到回覆又送一次）：回傳第一次的結果，不重複入帳。
      const existing = state.faceEvents.find(e => e.eventId === request.eventId);
      if (existing) return existing;

      const reject = (reason: string, studentName?: string) =>
        record({ ...request, status: 'rejected', reason, studentName, handledAt: now });

      if (!request.eventId || !request.studentId || !request.businessDate || !request.deviceId) {
        return reject(FACE_REJECT_MESSAGES.invalid);
      }
      const student = state.students.find(s => s.studentId === request.studentId);
      if (!student) return reject(FACE_REJECT_MESSAGES.noAccount);
      if (student.status !== 'active') return reject(FACE_REJECT_MESSAGES.inactive, student.displayName);
      if (state.businessDateStatuses[request.businessDate] === 'closed') {
        return reject(FACE_REJECT_MESSAGES.closed, student.displayName);
      }

      if (request.action === 'cancel') {
        const target = pickOrderToCancel(state.transactions, student.studentId, request.businessDate);
        if (!target) return reject(FACE_REJECT_MESSAGES.nothingToCancel, student.displayName);
        const notice = cancelNeedsRefundNotice(target, state.transactions) ? FACE_REFUND_NOTICE : undefined;
        // 餐費一律留在帳戶：有收款的訂單改成同金額的繳費；沒收款的直接取消。原單與理由寫進稽核。
        const result = state.deleteOrderWithRefundCheck(target.transactionId, {
          reason: FACE_CANCEL_REASON,
          operatorId: request.deviceId,
          keepPaymentAsDeposit: true,
        });
        if (!result.deleted) return reject(result.message ?? FACE_REJECT_MESSAGES.invalid, student.displayName);
        return record({
          ...request, status: 'accepted', notice, transactionId: target.transactionId,
          studentName: student.displayName, handledAt: now,
        });
      }

      const menu = resolveMenuForDate(state.menusByDate, state.todayMenu, request.businessDate).menu;
      if (!isMenuReady(menu)) return reject(FACE_REJECT_MESSAGES.noMenu, student.displayName);

      // 平板只訂今日便當、不收錢：應收是當天價格，實收 0。同一帳號可以第二份（兄弟姊妹共用）。
      const tx = createLedgerTransaction({
        transactionId: crypto.randomUUID(),
        businessDate: request.businessDate,
        createdAt: now,
        studentSnapshot: createStudentSnapshot(student),
        menuSnapshot: createMenuSnapshot(menu),
        type: 'order',
        mealPrice: menu.price,
        paidAmount: 0,
        previousBalance: student.currentBalance,
        sourceDevice: FACE_SOURCE_DEVICE,
        operatorId: request.deviceId,
        note: faceOrderNote(request.memberName),
      });
      const latest = get();
      set(rebalanceAccounts(latest.students, latest.transactions, [tx, ...latest.transactions], [student.studentId]));
      return record({
        ...request, status: 'accepted', transactionId: tx.transactionId,
        studentName: student.displayName, handledAt: now,
      });
    },

    applyFaceEnrollment: (update) => {
      const state = get();
      if (!state.students.some(s => s.studentId === update.studentId)) return false;
      set({
        students: state.students.map(s => s.studentId === update.studentId
          ? {
            ...s,
            faceEnrollmentStatus: update.status,
            ...(update.faceCount !== undefined ? { faceCount: update.faceCount } : {}),
            updatedAt: update.reportedAt,
            revision: s.revision + 1,
          }
          : s),
        faceDevices: {
          ...state.faceDevices,
          [update.deviceId]: { ...(state.faceDevices[update.deviceId] ?? {}), deviceId: update.deviceId, online: true, lastSeenAt: update.reportedAt },
        },
      });
      return true;
    },

    setFaceDeviceStatus: (status) => set((state) => ({
      faceDevices: { ...state.faceDevices, [status.deviceId]: { ...(state.faceDevices[status.deviceId] ?? {}), ...status } },
    })),
  };
}
