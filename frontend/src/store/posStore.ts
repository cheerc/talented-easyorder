import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PosState } from './posTypes';
import { defaultState, posPersistenceConfig } from './posPersistence';
import { createTransactionActions } from './posActions/transactionActions';
import { createSessionActions } from './posActions/sessionActions';
import { createMenuActions } from './posActions/menuActions';
import {
  INITIAL_STUDENTS, INITIAL_TODAY_MENU, INITIAL_TODAY_TX, VENDORS
} from '../mocks/initialData';

export { type PosState, type BusinessDateStatus } from './posTypes';
export { CASHIER_SENTINEL, mergeLedgerTransactions } from '../domain/ledger';

export const usePosStore = create<PosState>()(
  persist(
    (set, get) => ({
      students: INITIAL_STUDENTS,
      transactions: INITIAL_TODAY_TX,
      vendors: VENDORS,
      todayMenu: INITIAL_TODAY_MENU,
      ...defaultState,
      ...createMenuActions(set),
      ...createSessionActions(set, get),
      ...createTransactionActions(set, get),
    }),
    posPersistenceConfig,
  )
);
