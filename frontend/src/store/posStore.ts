import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StudentAccount } from '../domain/student';
import type { Vendor, TodayMenu } from '../domain/menu';
import type { LedgerTransaction } from '../domain/ledger';
import { createStudentSnapshot } from '../domain/student';
import { createMenuSnapshot } from '../domain/menu';
import { createLedgerTransaction, calculateTransactionAmount } from '../domain/ledger';
import {
  INITIAL_STUDENTS, INITIAL_TODAY_MENU, INITIAL_TODAY_TX, VENDORS
} from '../mocks/initialData';

interface PosState {
  students: StudentAccount[];
  transactions: LedgerTransaction[];
  vendors: Vendor[];
  todayMenu: TodayMenu;

  setTodayMenu: (menu: TodayMenu) => void;
  setVendors: (vendors: Vendor[]) => void;
  processTransaction: (
    studentId: string,
    type: LedgerTransaction['type'],
    mealPrice: number,
    paidAmount: number,
    note?: string
  ) => void;
  updateTransaction: (id: string, updates: Partial<LedgerTransaction>) => void;
  deleteTransaction: (id: string) => void;
  resetData: () => void;
}

export const usePosStore = create<PosState>()(
  persist(
    (set) => ({
      students: INITIAL_STUDENTS,
      transactions: INITIAL_TODAY_TX,
      vendors: VENDORS,
      todayMenu: INITIAL_TODAY_MENU,

      setTodayMenu: (menu) => set({ todayMenu: menu }),
      setVendors: (vendors) => set({ vendors }),

      processTransaction: (studentId, type, mealPrice, paidAmount, note) => {
        set((state) => {
          const studentIndex = state.students.findIndex(s => s.studentId === studentId);
          if (studentIndex === -1) return state;

          const student = state.students[studentIndex];
          const now = new Date().toISOString();
          const amount = calculateTransactionAmount(mealPrice, paidAmount);
          const newBalance = student.currentBalance + amount;

          const newStudents = [...state.students];
          newStudents[studentIndex] = { ...student, currentBalance: newBalance };

          const newTransaction = createLedgerTransaction({
            transactionId: crypto.randomUUID(),
            businessDate: state.todayMenu.businessDate,
            createdAt: now,
            studentSnapshot: createStudentSnapshot(student),
            menuSnapshot: createMenuSnapshot(state.todayMenu),
            type,
            mealPrice,
            paidAmount,
            previousBalance: student.currentBalance,
            sourceDevice: 'pc',
            note: note || (type === 'order' ? state.todayMenu.itemName : type),
          });

          return {
            students: newStudents,
            transactions: [newTransaction, ...state.transactions]
          };
        });
      },

      updateTransaction: (id, updates) => {
        set((state) => {
          const txIndex = state.transactions.findIndex(t => t.transactionId === id);
          if (txIndex === -1) return state;

          const oldTx = state.transactions[txIndex];
          const newTx = { ...oldTx, ...updates };

          newTx.amount = calculateTransactionAmount(newTx.mealPrice, newTx.paidAmount);

          const diff = newTx.amount - oldTx.amount;
          newTx.afterBalance = oldTx.afterBalance + diff;

          const newTransactions = [...state.transactions];
          newTransactions[txIndex] = newTx;

          for (let i = 0; i < txIndex; i++) {
            if (newTransactions[i].studentId === oldTx.studentId) {
              newTransactions[i] = {
                ...newTransactions[i],
                afterBalance: newTransactions[i].afterBalance + diff
              };
            }
          }

          const studentIndex = state.students.findIndex(s => s.studentId === oldTx.studentId);
          if (studentIndex === -1) return { transactions: newTransactions };

          const newStudents = [...state.students];
          newStudents[studentIndex] = {
            ...newStudents[studentIndex],
            currentBalance: newStudents[studentIndex].currentBalance + diff
          };

          return { transactions: newTransactions, students: newStudents };
        });
      },

      deleteTransaction: (id) => {
        set((state) => {
          const txIndex = state.transactions.findIndex(t => t.transactionId === id);
          if (txIndex === -1) return state;

          const tx = state.transactions[txIndex];
          const studentIndex = state.students.findIndex(s => s.studentId === tx.studentId);

          const newTransactions = [...state.transactions];
          for (let i = 0; i < txIndex; i++) {
            if (newTransactions[i].studentId === tx.studentId) {
              newTransactions[i] = {
                ...newTransactions[i],
                afterBalance: newTransactions[i].afterBalance - tx.amount
              };
            }
          }
          newTransactions.splice(txIndex, 1);

          if (studentIndex === -1) return { transactions: newTransactions };

          const newStudents = [...state.students];
          newStudents[studentIndex] = {
            ...newStudents[studentIndex],
            currentBalance: newStudents[studentIndex].currentBalance - tx.amount
          };

          return { transactions: newTransactions, students: newStudents };
        });
      },

      resetData: () => set({
        students: INITIAL_STUDENTS,
        transactions: INITIAL_TODAY_TX,
        todayMenu: INITIAL_TODAY_MENU
      })
    }),
    {
      name: 'pos-storage',
      version: 1,
      migrate: (persistedState) => {
        const state = persistedState as Record<string, unknown>;
        if (!state) return state as PosState;

        // Normalize old-shape students {id, name, balance} → StudentAccount
        const rawStudents = state.students as Array<Record<string, unknown>> | undefined;
        if (rawStudents && rawStudents.length > 0 && 'id' in rawStudents[0] && !('studentId' in rawStudents[0])) {
          state.students = rawStudents.map((s: Record<string, unknown>) => ({
            studentId: s.id as string,
            displayName: (s.name as string) || '',
            status: 'active',
            currentBalance: (s.balance as number) ?? 0,
            aliases: [],
            faceEnrollmentStatus: 'none',
            createdAt: '2026-01-10T08:00:00Z',
            updatedAt: '2026-01-10T08:00:00Z',
            revision: 1,
          }));
        }

        // Normalize old-shape transactions → LedgerTransaction
        const rawTx = state.transactions as Array<Record<string, unknown>> | undefined;
        if (rawTx && rawTx.length > 0 && 'id' in rawTx[0] && !('transactionId' in rawTx[0])) {
          state.transactions = rawTx.map((t: Record<string, unknown>) => ({
            transactionId: t.id as string,
            businessDate: (t.date as string) || '',
            createdAt: `${t.date}T${t.time}.000Z`,
            studentId: t.sid as string,
            studentNameSnapshot: t.name as string,
            type: t.type as LedgerTransaction['type'],
            mealPrice: (t.mealPrice as number) ?? 0,
            paidAmount: (t.paidAmount as number) ?? 0,
            amount: (t.amount as number) ?? 0,
            afterBalance: t.after as number,
            menuNameSnapshot: (t.note as string) || '',
            vendorNameSnapshot: '',
            sourceDevice: 'pc' as const,
            syncStatus: 'local' as const,
            revision: 1,
            note: (t.note as string) || '',
          }));
        }

        // Normalize old-shape vendors {id, name, phone, note} → Vendor
        const rawVendors = state.vendors as Array<Record<string, unknown>> | undefined;
        if (rawVendors && rawVendors.length > 0 && 'id' in rawVendors[0] && !('vendorId' in rawVendors[0])) {
          state.vendors = rawVendors.map((v: Record<string, unknown>) => ({
            vendorId: v.id as string,
            name: (v.name as string) || '',
            phone: (v.phone as string) || '',
            note: (v.note as string) || '',
            status: 'active' as const,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            revision: 1,
          }));
        }

        // Normalize old-shape todayMenu {date, name, price, vendor} → TodayMenu
        const rawMenu = state.todayMenu as Record<string, unknown> | undefined;
        if (rawMenu && 'date' in rawMenu && !('businessDate' in rawMenu)) {
          const vendorName = (rawMenu.vendor as string) || '';
          const oldVendors = (state.vendors as Vendor[]) || [];
          const matchedVendor = oldVendors.find(v => v.name === vendorName);
          state.todayMenu = {
            businessDate: rawMenu.date as string,
            itemName: (rawMenu.name as string) || '',
            price: (rawMenu.price as number) ?? 0,
            vendorId: matchedVendor?.vendorId || 'v1',
            vendorNameSnapshot: vendorName,
            updatedAt: '2026-05-07T07:00:00Z',
            revision: 1,
          };
        }

        return state as PosState;
      },
    }
  )
);
