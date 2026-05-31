import type { PersistStorage, StorageValue } from 'zustand/middleware';

const DB_NAME = 'easyorder-pos';
const STORE_NAME = 'persist';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function indexedDBStorage(): {
  getItem: (name: string) => Promise<StorageValue<unknown> | null>;
  setItem: (name: string, value: StorageValue<unknown>) => Promise<void>;
  removeItem: (name: string) => Promise<void>;
} {
  async function withStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, mode);
    return tx.objectStore(STORE_NAME);
  }

  return {
    async getItem(name: string): Promise<StorageValue<unknown> | null> {
      const store = await withStore('readonly');
      return new Promise((resolve, reject) => {
        const request = store.get(name);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    },

    async setItem(name: string, value: StorageValue<unknown>): Promise<void> {
      const store = await withStore('readwrite');
      return new Promise((resolve, reject) => {
        const request = store.put(value, name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    },

    async removeItem(name: string): Promise<void> {
      const store = await withStore('readwrite');
      return new Promise((resolve, reject) => {
        const request = store.delete(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    },
  };
}

function localStorageStorage(): {
  getItem: (name: string) => Promise<StorageValue<unknown> | null>;
  setItem: (name: string, value: StorageValue<unknown>) => Promise<void>;
  removeItem: (name: string) => Promise<void>;
} {
  return {
    async getItem(name: string): Promise<StorageValue<unknown> | null> {
      const raw = localStorage.getItem(name);
      if (raw === null) return null;
      return JSON.parse(raw);
    },

    async setItem(name: string, value: StorageValue<unknown>): Promise<void> {
      localStorage.setItem(name, JSON.stringify(value));
    },

    async removeItem(name: string): Promise<void> {
      localStorage.removeItem(name);
    },
  };
}

export function createIndexedDBStorage(): PersistStorage<unknown> {
  const isIndexedDBAvailable = (() => {
    try {
      if (typeof indexedDB === 'undefined' || window.indexedDB === undefined) return false;
      return true;
    } catch {
      return false;
    }
  })();

  if (isIndexedDBAvailable) {
    const idb = indexedDBStorage();

    return {
      async getItem(name: string): Promise<StorageValue<unknown> | null> {
        const result = await idb.getItem(name);
        if (result !== null) return result;

        const raw = localStorage.getItem(name);
        if (raw === null) return null;
        const parsed = JSON.parse(raw) as StorageValue<unknown>;
        await idb.setItem(name, parsed);
        localStorage.removeItem(name);
        return parsed;
      },
      setItem: idb.setItem,
      removeItem: idb.removeItem,
    };
  }

  const ls = localStorageStorage();
  return {
    getItem: ls.getItem,
    setItem: ls.setItem,
    removeItem: ls.removeItem,
  };
}
