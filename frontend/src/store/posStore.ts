import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  type Student, type Transaction, type Vendor, type TodayMenu,
  INITIAL_STUDENTS, INITIAL_TODAY_MENU, INITIAL_TODAY_TX, VENDORS
} from '../mocks/initialData';

interface PosState {
  students: Student[];
  transactions: Transaction[];
  vendors: Vendor[];
  todayMenu: TodayMenu;

  // Actions
  setTodayMenu: (menu: TodayMenu) => void;
  setVendors: (vendors: Vendor[]) => void;
  processTransaction: (
    studentId: string,
    type: Transaction['type'],
    mealPrice: number,
    paidAmount: number,
    note?: string
  ) => void;
  updateTransaction: (id: string, updates: Partial<Transaction>) => void;
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
          const studentIndex = state.students.findIndex(s => s.id === studentId);
          if (studentIndex === -1) return state;

          const student = state.students[studentIndex];
          const amount = paidAmount - mealPrice;
          const newBalance = student.balance + amount;

          const newStudents = [...state.students];
          newStudents[studentIndex] = { ...student, balance: newBalance };

          const newTransaction: Transaction = {
            id: crypto.randomUUID(),
            date: new Date().toISOString().split('T')[0],
            time: new Date().toLocaleTimeString('en-US', { hour12: false }),
            sid: student.id,
            name: student.name,
            type,
            mealPrice,
            paidAmount,
            amount: amount,
            after: newBalance,
            note: note || (type === 'order' ? state.todayMenu.name : type),
          };

          return {
            students: newStudents,
            transactions: [newTransaction, ...state.transactions]
          };
        });
      },

      updateTransaction: (id, updates) => {
        set((state) => {
          const txIndex = state.transactions.findIndex(t => t.id === id);
          if (txIndex === -1) return state;

          const oldTx = state.transactions[txIndex];
          const newTx = { ...oldTx, ...updates };

          // Recalculate amount
          newTx.amount = (newTx.paidAmount || 0) - (newTx.mealPrice || 0);

          const diff = newTx.amount - oldTx.amount;
          newTx.after = oldTx.after + diff;

          const newTransactions = [...state.transactions];
          newTransactions[txIndex] = newTx;

          // Propagate diff to all newer transactions for this student
          for (let i = 0; i < txIndex; i++) {
            if (newTransactions[i].sid === oldTx.sid) {
              newTransactions[i] = { 
                ...newTransactions[i], 
                after: newTransactions[i].after + diff 
              };
            }
          }

          const studentIndex = state.students.findIndex(s => s.id === oldTx.sid);
          if (studentIndex === -1) return { transactions: newTransactions };

          const newStudents = [...state.students];
          newStudents[studentIndex] = { 
            ...newStudents[studentIndex], 
            balance: newStudents[studentIndex].balance + diff 
          };

          return { transactions: newTransactions, students: newStudents };
        });
      },

      deleteTransaction: (id) => {
        set((state) => {
          const txIndex = state.transactions.findIndex(t => t.id === id);
          if (txIndex === -1) return state;

          const tx = state.transactions[txIndex];
          const studentIndex = state.students.findIndex(s => s.id === tx.sid);

          const newTransactions = [...state.transactions];
          for (let i = 0; i < txIndex; i++) {
            if (newTransactions[i].sid === tx.sid) {
              newTransactions[i] = { 
                ...newTransactions[i], 
                after: newTransactions[i].after - tx.amount 
              };
            }
          }
          newTransactions.splice(txIndex, 1);

          if (studentIndex === -1) return { transactions: newTransactions };

          const newStudents = [...state.students];
          newStudents[studentIndex] = { 
            ...newStudents[studentIndex], 
            balance: newStudents[studentIndex].balance - tx.amount 
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
    { name: 'pos-storage' }
  )
);
