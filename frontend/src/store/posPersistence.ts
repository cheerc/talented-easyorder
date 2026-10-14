import type { PersistOptions, PersistStorage, StorageValue } from 'zustand/middleware';
import type { PosState } from './posTypes';
import { migratePersistedState } from '../storage/migration';
import { validatePersistedState } from '../storage/posStateValidator';
import { appendErrorLog, clearErrorLog } from '../errors/errorLogger';
import { INITIAL_STUDENTS, INITIAL_TODAY_MENU, INITIAL_TODAY_TX, VENDORS } from '../mocks/initialData';
import { createIndexedDBStorage } from '../storage/indexedDBStorage';
import { getStorageMode, isCloudMode, namespacedStorageName, type StorageMode } from '../appMode';

// TODO: [future] encrypt sensitive fields before IndexedDB persist (#286)

/**
 * 記憶體快取 Storage（In-memory Persist Storage）。
 * 規格 §5, §8：Cloud mode 不把完整帳務 persist 到 IndexedDB/localStorage，
 * 使用純記憶體快取；登出或重新整理時清除。
 */
export function createMemoryStorage(): PersistStorage<unknown> {
  const memoryMap = new Map<string, StorageValue<unknown>>();
  return {
    async getItem(name: string): Promise<StorageValue<unknown> | null> {
      return memoryMap.get(name) ?? null;
    },
    async setItem(name: string, value: StorageValue<unknown>): Promise<void> {
      memoryMap.set(name, value);
    },
    async removeItem(name: string): Promise<void> {
      memoryMap.delete(name);
    },
  };
}

/**
 * Ref: #286 — Clear sensitive POS data from IndexedDB and localStorage on signOut.
 * On shared kiosk/iPad devices, this prevents student PII (names, balances,
 * transactions) from persisting after the operator signs out.
 */
export async function clearSensitiveData(): Promise<void> {
  try {
    // Clear IndexedDB across namespaces
    if (typeof indexedDB !== 'undefined') {
      const dbNames = [
        namespacedStorageName('easyorder-pos', 'local-only'),
        namespacedStorageName('easyorder-pos', 'prototype'),
        namespacedStorageName('easyorder-pos', 'cloud'),
      ];
      await Promise.all(
        dbNames.map(
          dbName =>
            new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(dbName);
              req.onsuccess = () => resolve();
              req.onerror = () => resolve(); // best-effort
              req.onblocked = () => resolve();
            }),
        ),
      );
      // Also clear crash draft
      const crashDbNames = [
        namespacedStorageName('easyorder-crash-draft', 'local-only'),
        namespacedStorageName('easyorder-crash-draft', 'prototype'),
        namespacedStorageName('easyorder-crash-draft', 'cloud'),
      ];
      for (const cName of crashDbNames) {
        const reqCrash = indexedDB.deleteDatabase(cName);
        reqCrash.onerror = () => { /* best-effort */ };
      }
    }
  } catch { /* best-effort */ }

  try {
    // Clear localStorage fallback across namespaces
    localStorage.removeItem(namespacedStorageName('pos-storage', 'local-only'));
    localStorage.removeItem(namespacedStorageName('pos-storage', 'prototype'));
    localStorage.removeItem(namespacedStorageName('pos-storage', 'cloud'));
    // Ref: #315 — Clear error log on signOut (may contain sensitive context)
    clearErrorLog();
  } catch { /* best-effort */ }
}

export const defaultState = {
  auditEvents: [] as PosState['auditEvents'],
  dailySettlements: [] as PosState['dailySettlements'],
  businessDateStatuses: {} as PosState['businessDateStatuses'],
  cashSessions: {} as PosState['cashSessions'],
  menusByDate: {} as PosState['menusByDate'],
  faceEvents: [] as PosState['faceEvents'],
  faceDevices: {} as PosState['faceDevices'],
};

/**
 * 建立依 mode 隔離的 Zustand 持久化設定：
 * - Cloud mode：使用記憶體快取（不寫入 IndexedDB / localStorage），且不把完整帳務持久化至本地磁碟。
 * - Prototype / local-only 模式：保留原 IndexedDB persist。
 */
export function createPosPersistenceConfig(
  mode: StorageMode = getStorageMode(),
): PersistOptions<PosState> {
  const isCloud = mode === 'cloud';
  const storageKey = namespacedStorageName('pos-storage', mode);

  return {
    name: storageKey,
    storage: isCloud ? createMemoryStorage() : createIndexedDBStorage(),
    version: 2,
    partialize: (state) => {
      if (isCloud) {
        // Cloud 模式下不把完整帳務 persist 到本機資料庫
        return {} as unknown as PosState;
      }
      return {
        students: state.students,
        transactions: state.transactions,
        vendors: state.vendors,
        todayMenu: state.todayMenu,
        menusByDate: state.menusByDate,
        auditEvents: state.auditEvents,
        dailySettlements: state.dailySettlements,
        businessDateStatuses: state.businessDateStatuses,
        cashSessions: state.cashSessions,
        simulationDate: state.simulationDate,
        faceEvents: state.faceEvents,
        faceDevices: state.faceDevices,
      } as unknown as PosState;
    },
    onRehydrateStorage: () => {
      if (isCloud) {
        // Cloud 模式不從本地 rehydrate 舊帳務資料
        return undefined;
      }
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
}

export const posPersistenceConfig: PersistOptions<PosState> = createPosPersistenceConfig(
  isCloudMode ? 'cloud' : getStorageMode(),
);
