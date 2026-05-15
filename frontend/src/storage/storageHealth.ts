export interface StorageHealth {
  localStorage: boolean;
  indexedDB: boolean;
  ok: boolean;
}

export type FallbackMode = 'full' | 'localStorage-only' | 'indexedDB-only' | 'none';

export function checkStorageHealth(): StorageHealth {
  let localStorageOk = true;
  try {
    const key = '__storage_health_test__';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
  } catch {
    localStorageOk = false;
  }

  const indexedDBOk = typeof indexedDB !== 'undefined' && indexedDB !== undefined;

  return {
    localStorage: localStorageOk,
    indexedDB: indexedDBOk,
    ok: localStorageOk && indexedDBOk,
  };
}

export function getFallbackMode(health: StorageHealth): FallbackMode {
  if (health.ok) return 'full';
  if (health.localStorage && !health.indexedDB) return 'localStorage-only';
  if (!health.localStorage && health.indexedDB) return 'indexedDB-only';
  return 'none';
}
