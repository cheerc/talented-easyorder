import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { StudentAccount } from '../domain/student';
import type { Vendor, TodayMenu } from '../domain/menu';
import type { LedgerTransaction } from '../domain/ledger';
import { createStudentSnapshot } from '../domain/student';
import { createMenuSnapshot } from '../domain/menu';
import { createLedgerTransaction, calculateTransactionAmount } from '../domain/ledger';
import { createCorrectionTransaction, createVoidTransaction, createLedgerAuditEvent } from '../domain/ledgerAudit';
import { validateCashClose, createDailySettlement, reopenBusinessDate as reopenSettlement } from '../domain/cashClose';
import { calculateLedgerTotals, getEffectiveLedgerRows } from '../domain/ledgerReport';
import type { PosTransactionDraft } from '../domain/posTransaction';
import type { DailyCashSession } from '../domain/cashSession';
import { createDailyCashSession } from '../domain/cashSession';
import { validatePersistedState } from '../storage/posStateValidator';
import {
  INITIAL_STUDENTS, INITIAL_TODAY_MENU, INITIAL_TODAY_TX, VENDORS
} from '../mocks/initialData';

interface LedgerCorrectionInput {
  transactionId: string;
  updates: Partial<LedgerTransaction>;
  reason: string;
  operatorId: string;
}

interface LedgerVoidInput {
  transactionId: string;
  reason: string;
  operatorId: string;
}

interface CloseBusinessDateInput {
  businessDate: string;
  countedCash: number;
  note: string;
  queuedSettlementAccepted: boolean;
  operatorId: string;
}

interface ReopenBusinessDateInput {
  businessDate: string;
  reason: string;
  operatorId: string;
}

interface CloseBusinessDateInput {
  businessDate: string;
  countedCash: number;
  note: string;
  queuedSettlementAccepted: boolean;
  operatorId: string;
}

interface ReopenBusinessDateInput {
  businessDate: string;
  reason: string;
  operatorId: string;
}

interface OpenCashSessionInput {
  businessDate: string;
  openingCash: number;
  operatorId: string;
  openedAt: string;
}

interface OpenCashSessionInput {
  businessDate: string;
  openingCash: number;
  operatorId: string;
  openedAt: string;
}

export type BusinessDateStatus = 'open' | 'closed' | 'reopened';

interface PosState {
  students: StudentAccount[];
  transactions: LedgerTransaction[];
  vendors: Vendor[];
  todayMenu: TodayMenu;
  auditEvents: import('../domain/ledgerAudit').LedgerAuditEvent[];
  dailySettlements: import('../domain/cashClose').DailySettlement[];
  businessDateStatuses: Record<string, BusinessDateStatus>;
  cashSessions: Record<string, DailyCashSession>;

  setTodayMenu: (menu: TodayMenu) => void;
  setVendors: (vendors: Vendor[]) => void;
  commitPosTransactionDraft: (draft: PosTransactionDraft) => void;
  processTransaction: (
    studentId: string,
    type: LedgerTransaction['type'],
    mealPrice: number,
    paidAmount: number,
    note?: string
  ) => void;
  updateTransaction: (id: string, updates: Partial<LedgerTransaction>) => void;
  deleteTransaction: (id: string) => void;
  correctTransaction: (input: LedgerCorrectionInput) => void;
  voidTransaction: (input: LedgerVoidInput) => void;
  hardDeleteLocalDraft: (input: LedgerVoidInput) => void;
  setBusinessDateStatus: (date: string, status: BusinessDateStatus) => void;
  openCashSession: (input: OpenCashSessionInput) => void;
  openCashSession: (input: OpenCashSessionInput) => void;
  closeBusinessDate: (input: CloseBusinessDateInput) => void;
  reopenBusinessDate: (input: ReopenBusinessDateInput) => void;
  getBusinessDateStatus: (businessDate: string) => BusinessDateStatus;
  resetData: () => void;
}

const defaultState = {
  auditEvents: [] as import('../domain/ledgerAudit').LedgerAuditEvent[],
  dailySettlements: [] as import('../domain/cashClose').DailySettlement[],
  businessDateStatuses: {} as Record<string, BusinessDateStatus>,
  cashSessions: {} as Record<string, DailyCashSession>,
};

export const usePosStore = create<PosState>()(
  persist(
    (set, get) => ({
      students: INITIAL_STUDENTS,
      transactions: INITIAL_TODAY_TX,
      vendors: VENDORS,
      todayMenu: INITIAL_TODAY_MENU,
      ...defaultState,

      setTodayMenu: (menu) => set({ todayMenu: menu }),
      setVendors: (vendors) => set({ vendors }),

      openCashSession: (input) => {
        set((state) => {
          if (state.cashSessions[input.businessDate]) return state;

          return {
            cashSessions: {
              ...state.cashSessions,
              [input.businessDate]: createDailyCashSession({
                businessDate: input.businessDate,
                openingCash: input.openingCash,
                openedBy: input.operatorId,
                openedAt: input.openedAt,
              }),
            },
          };
        });
      },

      openCashSession: (input) => {
        set((state) => {
          if (state.cashSessions[input.businessDate]) return state;

          return {
            cashSessions: {
              ...state.cashSessions,
              [input.businessDate]: createDailyCashSession({
                businessDate: input.businessDate,
                openingCash: input.openingCash,
                openedBy: input.operatorId,
                openedAt: input.openedAt,
              }),
            },
          };
        });
      },

      commitPosTransactionDraft: (draft) => {
        set((state) => {
          const studentIndex = state.students.findIndex(s => s.studentId === draft.intent.studentId);
          if (studentIndex === -1) return state;

          const student = state.students[studentIndex];
          const now = new Date().toISOString();

          const newStudents = [...state.students];
          newStudents[studentIndex] = { ...student, currentBalance: draft.expectedBalanceAfter };

          const newTransaction = createLedgerTransaction({
            transactionId: crypto.randomUUID(),
            businessDate: draft.intent.businessDate,
            createdAt: now,
            studentSnapshot: draft.snapshots.student,
            menuSnapshot: draft.snapshots.menu,
            type: draft.intent.type,
            mealPrice: draft.intent.mealPrice,
            paidAmount: draft.intent.paidAmount,
            previousBalance: student.currentBalance,
            sourceDevice: draft.intent.sourceDevice,
            note: draft.intent.note,
          });

          return {
            students: newStudents,
            transactions: [newTransaction, ...state.transactions],
          };
        });
      },

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

      correctTransaction: (input) => {
        const state = get();
        const { transactionId, updates, reason, operatorId } = input;

        const txIndex = state.transactions.findIndex(t => t.transactionId === transactionId);
        if (txIndex === -1) return;

        const original = state.transactions[txIndex];
        const dateStatus = state.businessDateStatuses[original.businessDate];
        if (dateStatus === 'closed') return;
        const now = new Date().toISOString();

        const auditEvent = createLedgerAuditEvent({
          auditEventId: `evt-${Date.now()}`,
          eventType: 'transaction_corrected',
          entityType: 'transaction',
          entityId: transactionId,
          businessDate: original.businessDate,
          before: { mealPrice: original.mealPrice, paidAmount: original.paidAmount },
          after: { mealPrice: updates.mealPrice, paidAmount: updates.paidAmount },
          reason,
          operatorId,
          createdAt: now,
        });

        const newTx = createCorrectionTransaction(
          original,
          {
            mealPrice: updates.mealPrice ?? original.mealPrice,
            paidAmount: updates.paidAmount ?? original.paidAmount,
            note: updates.note ?? original.note,
            type: original.type,
          },
          original.afterBalance,
          {
            auditEventId: auditEvent.auditEventId,
            eventType: 'transaction_corrected',
            entityType: 'transaction',
            entityId: transactionId,
            businessDate: original.businessDate,
            before: auditEvent.before,
            after: auditEvent.after,
            reason,
            operatorId,
            createdAt: now,
          },
        );

        const studentIndex = state.students.findIndex(s => s.studentId === original.studentId);
        const updatedStudents = [...state.students];
        if (studentIndex !== -1) {
          updatedStudents[studentIndex] = {
            ...updatedStudents[studentIndex],
            currentBalance: newTx.afterBalance,
          };
        }

        set({
          transactions: [...state.transactions, newTx],
          auditEvents: [...state.auditEvents, auditEvent],
          students: updatedStudents,
        });
      },

      voidTransaction: (input) => {
        const state = get();
        const { transactionId, reason, operatorId } = input;

        const txIndex = state.transactions.findIndex(t => t.transactionId === transactionId);
        if (txIndex === -1) return;

        const original = state.transactions[txIndex];
        const dateStatus = state.businessDateStatuses[original.businessDate];
        if (dateStatus === 'closed') return;

        const now = new Date().toISOString();

        const auditEvent = createLedgerAuditEvent({
          auditEventId: `evt-${Date.now()}`,
          eventType: 'transaction_voided',
          entityType: 'transaction',
          entityId: transactionId,
          businessDate: original.businessDate,
          before: { amount: original.amount },
          after: { amount: -original.amount },
          reason,
          operatorId,
          createdAt: now,
        });

        const voidTx = createVoidTransaction(original, reason, operatorId, now);

        const studentIndex = state.students.findIndex(s => s.studentId === original.studentId);
        const updatedStudents = [...state.students];
        if (studentIndex !== -1) {
          updatedStudents[studentIndex] = {
            ...updatedStudents[studentIndex],
            currentBalance: updatedStudents[studentIndex].currentBalance + voidTx.amount,
          };
        }

        set(state => ({
          transactions: state.transactions.map(t =>
            t.transactionId === transactionId
              ? { ...t, voidedAt: now, voidedBy: operatorId, voidReason: reason }
              : t
          ).concat(voidTx),
          auditEvents: [...state.auditEvents, auditEvent],
          students: updatedStudents,
        }));
      },

      hardDeleteLocalDraft: (input) => {
        const state = get();
        const { transactionId, reason, operatorId } = input;

        const txIndex = state.transactions.findIndex(t => t.transactionId === transactionId);
        if (txIndex === -1) return;

        const original = state.transactions[txIndex];
        if (original.syncStatus !== 'local') return;

        const dateStatus = state.businessDateStatuses[original.businessDate];
        if (dateStatus === 'closed') return;

        const now = new Date().toISOString();

        const auditEvent = createLedgerAuditEvent({
          auditEventId: `evt-${Date.now()}`,
          eventType: 'transaction_hard_deleted',
          entityType: 'transaction',
          entityId: transactionId,
          businessDate: original.businessDate,
          before: { ...original },
          after: null,
          reason,
          operatorId,
          createdAt: now,
        });

        set(state => ({
          transactions: state.transactions.filter(t => t.transactionId !== transactionId),
          auditEvents: [...state.auditEvents, auditEvent],
        }));
      },

      setBusinessDateStatus: (date, status) => {
        set(state => ({
          businessDateStatuses: { ...state.businessDateStatuses, [date]: status },
        }));
      },

      closeBusinessDate: (input) => {
        const state = get();
        const { businessDate, countedCash, note, queuedSettlementAccepted, operatorId } = input;

        if (state.businessDateStatuses[businessDate] === 'closed') return;

        const dayTx = state.transactions.filter(t => t.businessDate === businessDate);
        const effective = getEffectiveLedgerRows(dayTx);
        const totals = calculateLedgerTotals(effective);

        const hasQueued = dayTx.some(t => t.syncStatus === 'queued');
        const hasFailed = dayTx.some(t => t.syncStatus === 'failed');
        const hasConflict = dayTx.some(t => t.syncStatus === 'conflict');

        const validation = validateCashClose(totals.netCash, countedCash, hasFailed, hasConflict, hasQueued, note);
        if (!validation.ok) return;

        if (hasQueued && !queuedSettlementAccepted) return;

        const cashSession = state.cashSessions[businessDate];
        const openingCash = cashSession?.openingCash ?? 0;

        const now = new Date().toISOString();
        const settlement = createDailySettlement(businessDate, totals, openingCash, countedCash, note, operatorId, now, hasQueued);

        set(state => ({
          dailySettlements: [...state.dailySettlements, settlement],
          businessDateStatuses: { ...state.businessDateStatuses, [businessDate]: 'closed' },
        }));
      },

      reopenBusinessDate: (input) => {
        const state = get();
        const { businessDate, reason, operatorId } = input;

        if (state.businessDateStatuses[businessDate] === 'open') return;

        const existing = state.dailySettlements
          .filter(s => s.businessDate === businessDate)
          .sort((a, b) => b.settlementRevision - a.settlementRevision)[0];

        if (!existing) return;

        const now = new Date().toISOString();
        const reopened = reopenSettlement(existing, reason, operatorId, now);

        set(state => ({
          dailySettlements: [...state.dailySettlements, reopened],
          businessDateStatuses: { ...state.businessDateStatuses, [businessDate]: 'reopened' },
        }));
      },

      getBusinessDateStatus: (businessDate) => {
        return get().businessDateStatuses[businessDate] || 'open';
      },

      resetData: () => set({
        students: INITIAL_STUDENTS,
        transactions: INITIAL_TODAY_TX,
        todayMenu: INITIAL_TODAY_MENU,
        ...defaultState,
      }),
    }),
    {
      name: 'pos-storage',
      version: 2,
      onRehydrateStorage: () => {
        return (state, error) => {
          if (error || !state) {
            console.error('[posStore] rehydration failed:', error);
            return;
          }
          const result = validatePersistedState(state);
          if (!result.ok) {
            console.error('[posStore] rehydration validation failed:', result.reason);
            Object.assign(state, {
              students: INITIAL_STUDENTS,
              transactions: INITIAL_TODAY_TX,
              vendors: VENDORS,
              todayMenu: INITIAL_TODAY_MENU,
              ...defaultState,
            });
          }
        };
      },
      migrate: (persistedState) => {
        const state = persistedState as Record<string, unknown>;
        if (!state) return state as PosState;

        // v2: add audit state fields
        if (!('auditEvents' in state)) state.auditEvents = [];
        if (!('dailySettlements' in state)) state.dailySettlements = [];
        if (!('businessDateStatuses' in state)) state.businessDateStatuses = {};

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
        if (rawTx && rawTx.length > 0) {
          state.transactions = rawTx.map((t: Record<string, unknown>) => {
            const hasId = 'id' in t && !('transactionId' in t);
            const hasSyncStatus = 'syncStatus' in t;
            return {
              ...t,
              transactionId: hasId ? t.id as string : (t.transactionId as string),
              syncStatus: hasSyncStatus ? t.syncStatus : 'local',
            };
          });
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