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
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
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

          const newTransactions = [...state.transactions];
          newTransactions[txIndex] = newTx;

          // Recalculate balance for this student (brute force for prototype simplicity)
          // In a real app we'd need to re-sequence all 'after' balances
          const studentIndex = state.students.findIndex(s => s.id === oldTx.sid);
          if (studentIndex === -1) return { transactions: newTransactions };

          const diff = newTx.amount - oldTx.amount;
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
          const tx = state.transactions.find(t => t.id === id);
          if (!tx) return state;

          const studentIndex = state.students.findIndex(s => s.id === tx.sid);
          const newTransactions = state.transactions.filter(t => t.id !== id);

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
