import type { PersistOptions } from 'zustand/middleware';
import type { PosState } from './posTypes';
import { migratePersistedState } from '../storage/migration';
import { validatePersistedState } from '../storage/posStateValidator';
import { appendErrorLog } from '../errors/errorLogger';
import { INITIAL_STUDENTS, INITIAL_TODAY_MENU, INITIAL_TODAY_TX, VENDORS } from '../mocks/initialData';
import { createIndexedDBStorage } from '../storage/indexedDBStorage';

// TODO: [future] encrypt sensitive fields before IndexedDB persist (#286)

const POS_STORAGE_KEY = 'pos-storage';

/**
 * Ref: #286 — Clear sensitive POS data from IndexedDB and localStorage on signOut.
 * On shared kiosk/iPad devices, this prevents student PII (names, balances,
 * transactions) from persisting after the operator signs out.
 */
export async function clearSensitiveData(): Promise<void> {
  try {
    // Clear IndexedDB
    if (typeof indexedDB !== 'undefined') {
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('easyorder-pos');
        req.onsuccess = () => resolve();
        req.onerror = () => resolve(); // best-effort
        req.onblocked = () => resolve();
      });
      // Also clear crash draft
      const reqCrash = indexedDB.deleteDatabase('easyorder-crash-draft');
      reqCrash.onerror = () => { /* best-effort */ };
    }
  } catch { /* best-effort */ }

  try {
    // Clear localStorage fallback
    localStorage.removeItem(POS_STORAGE_KEY);
  } catch { /* best-effort */ }
}

export const defaultState = {
  auditEvents: [] as PosState['auditEvents'],
  dailySettlements: [] as PosState['dailySettlements'],
  businessDateStatuses: {} as PosState['businessDateStatuses'],
  cashSessions: {} as PosState['cashSessions'],
};

export const posPersistenceConfig: PersistOptions<PosState> = {
  name: 'pos-storage',
  storage: createIndexedDBStorage(),
  version: 2,
  onRehydrateStorage: () => {
    return (state, error) => {
      try {
        if (error || !state) {
          appendErrorLog({ source: 'storage', message: '[posStore] rehydration failed: ' + String(error) });
          return;
        }
        const version = ((state as Record<string, unknown>).schemaVersion as number) ?? 0;
        const skipDeep = version >= 2;
        const validationResult = validatePersistedState(state, { skipDeepValidation: skipDeep });
        if (!validationResult.ok) {
          appendErrorLog({ source: 'storage', message: '[posStore] validation failed: ' + validationResult.reason });
          Object.assign(state, {
            students: INITIAL_STUDENTS,
            transactions: INITIAL_TODAY_TX,
            vendors: VENDORS,
            todayMenu: INITIAL_TODAY_MENU,
            ...defaultState,
          });
        }
      } catch (e) {
        appendErrorLog({ source: 'storage', message: '[posStore] rehydration crashed: ' + String(e) });
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
  migrate: migratePersistedState,
};
