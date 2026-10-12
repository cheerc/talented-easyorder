import type { PosState } from '../posTypes';
import type { StudentAccount } from '../../domain/student';
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

    updateLocalStudent: (studentId, changes, now) => set((state) => ({
      students: state.students.map(s => s.studentId === studentId
        ? { ...s, displayName: changes.displayName, aliases: changes.aliases, updatedAt: now, revision: s.revision + 1 }
        : s),
    })),

    setLocalStudentStatus: (studentId, status, now) => set((state) => ({
      students: state.students.map(s => s.studentId === studentId && s.status !== status
        ? { ...s, status, updatedAt: now, revision: s.revision + 1 }
        : s),
    })),
  };
}
