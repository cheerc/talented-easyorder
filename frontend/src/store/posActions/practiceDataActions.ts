import type { PosState } from '../posTypes';
import type { StudentAccount } from '../../domain/student';
import type { LedgerAuditEvent } from '../../domain/ledgerAudit';
import { defaultState } from '../posPersistence';
import { clearTransactionsKeepRoster, type PracticeDataset } from '../../domain/practiceSnapshot';
import {
  EMPTY_TODAY_MENU, INITIAL_STUDENTS, INITIAL_TODAY_MENU, INITIAL_TODAY_TX, VENDORS,
} from '../../mocks/initialData';

// M0：本機練習資料。起點只有「空白」與「範例」兩種，並分開命名。
// 見 docs/superpowers/specs/frontend-prototype-workflow-spec.md §3 S-DATA／S-ROSTER。

export function createPracticeDataActions(
  set: (partial: Partial<PosState> | ((state: PosState) => Partial<PosState>)) => void,
): Pick<PosState, 'startBlankData' | 'loadSampleData' | 'addLocalStudent' | 'restoreDataset' | 'clearPracticeTransactions' | 'setSimulationDate' | 'updateLocalStudent' | 'setLocalStudentStatus'> {
  return {
    startBlankData: () => set({
      students: [],
      transactions: [],
      vendors: [],
      todayMenu: EMPTY_TODAY_MENU,
      ...defaultState,
    }),

    loadSampleData: () => set({
      students: INITIAL_STUDENTS,
      transactions: INITIAL_TODAY_TX,
      vendors: VENDORS,
      todayMenu: INITIAL_TODAY_MENU,
      ...defaultState,
    }),

    addLocalStudent: (account: StudentAccount) => set((state) => {
      // 呼叫端已用 validateNewAccount 檢查；這裡再擋一次重複編號，避免覆蓋既有帳戶。
      if (state.students.some(s => s.studentId === account.studentId)) return {};
      return { students: [...state.students, account] };
    }),

    // 快照已由 parseSnapshot 完整驗證；一次替換整個資料集。
    restoreDataset: (dataset: PracticeDataset) => set({ ...dataset }),

    clearPracticeTransactions: () => set((state) => clearTransactionsKeepRoster(state)),

    setSimulationDate: (date) => set({ simulationDate: date }),

    updateLocalStudent: (studentId, changes, now) => set((state) => {
      const target = state.students.find(s => s.studentId === studentId);
      if (!target) return {};

      const oldId = studentId;
      const isCodeChanged = Boolean(changes.newStudentId && changes.newStudentId !== oldId);
      const newId = isCodeChanged ? changes.newStudentId! : oldId;

      // 檢查新編號是否與其他帳戶重複
      if (isCodeChanged && state.students.some(s => s.studentId === newId && s.studentId !== oldId)) {
        return {};
      }

      // 1. 更新學生名冊
      const nextStudents = state.students.map(s => s.studentId === oldId
        ? {
            ...s,
            studentId: newId,
            displayName: changes.displayName,
            aliases: changes.aliases,
            updatedAt: now,
            revision: s.revision + 1,
          }
        : s
      );

      if (!isCodeChanged) {
        return { students: nextStudents };
      }

      // 2. 交易歷史中 studentId 同步更新
      const nextTransactions = state.transactions.map(t =>
        t.studentId === oldId ? { ...t, studentId: newId } : t
      );

      // 3. 稽核紀錄同步更新
      const updateRef = (obj: Record<string, unknown> | null): Record<string, unknown> | null => {
        if (!obj || typeof obj !== 'object') return obj;
        if (obj.studentId === oldId) {
          return { ...obj, studentId: newId };
        }
        return obj;
      };

      const updatedAuditEvents = (state.auditEvents || []).map(e => {
        let changed = false;
        let nextEntityId = e.entityId;
        if (e.entityId === oldId) {
          nextEntityId = newId;
          changed = true;
        }
        const nextBefore = updateRef(e.before);
        const nextAfter = updateRef(e.after);
        if (nextBefore !== e.before || nextAfter !== e.after) {
          changed = true;
        }
        return changed
          ? { ...e, entityId: nextEntityId, before: nextBefore, after: nextAfter }
          : e;
      });

      const changeEvent: LedgerAuditEvent = {
        auditEventId: `audit-change-code-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        eventType: 'transaction_edited',
        entityType: 'transaction',
        entityId: newId,
        businessDate: state.simulationDate || new Date().toISOString().slice(0, 10),
        before: { studentId: oldId, displayName: target.displayName },
        after: { studentId: newId, displayName: changes.displayName },
        reason: changes.reason || '修改學生編號',
        operatorId: 'operator',
        createdAt: now,
      };

      // 4. 刷臉紀錄
      const nextFaceEvents = (state.faceEvents || []).map(fe =>
        fe.studentId === oldId ? { ...fe, studentId: newId } : fe
      );

      return {
        students: nextStudents,
        transactions: nextTransactions,
        auditEvents: [...updatedAuditEvents, changeEvent],
        faceEvents: nextFaceEvents,
      };
    }),

    setLocalStudentStatus: (studentId, status, now) => set((state) => ({
      students: state.students.map(s => s.studentId === studentId && s.status !== status
        ? { ...s, status, updatedAt: now, revision: s.revision + 1 }
        : s),
    })),
  };
}
