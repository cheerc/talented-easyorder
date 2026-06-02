import type { PersistOptions } from 'zustand/middleware';
import type { PosState } from './posTypes';
import { migratePersistedState } from '../storage/migration';
import { migrateState, validatePersistedState } from '../storage/posStateValidator';
import { appendErrorLog } from '../errors/errorLogger';
import { INITIAL_STUDENTS, INITIAL_TODAY_MENU, INITIAL_TODAY_TX, VENDORS } from '../mocks/initialData';
import { createIndexedDBStorage } from '../storage/indexedDBStorage';

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
        const versionBefore = ((state as Record<string, unknown>).schemaVersion as number) ?? 0;
        const migrationResult = migrateState(state);
        if (migrationResult.ok) {
          // Zustand persist rehydration relies on Object.assign mutation of the store state
          Object.assign(state, migrationResult.state);
          const skipDeep = versionBefore >= 2;
          const validationResult = validatePersistedState(state, { skipDeepValidation: skipDeep });
          if (!validationResult.ok) {
            appendErrorLog({ source: 'storage', message: '[posStore] validation failed after migration: ' + validationResult.reason });
            Object.assign(state, {
              students: INITIAL_STUDENTS,
              transactions: INITIAL_TODAY_TX,
              vendors: VENDORS,
              todayMenu: INITIAL_TODAY_MENU,
              ...defaultState,
            });
          }
        } else {
          appendErrorLog({ source: 'storage', message: '[posStore] migration failed: ' + migrationResult.reason });
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
