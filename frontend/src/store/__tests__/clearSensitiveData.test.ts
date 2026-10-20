import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.unmock('../../store/posPersistence');

vi.mock('../../appMode', () => ({
  getStorageMode: () => 'cloud',
  isCloudMode: true,
  namespacedStorageName: (name: string, mode: string) => mode === 'cloud' ? `${name}-cloud` : name,
}));

import { clearSensitiveData } from '../../store/posPersistence';

describe('clearSensitiveData (#286)', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset fakeIndexedDB databases
    (window.indexedDB as unknown as { _databases: Map<string, unknown> })._databases?.clear();
  });

  it('removes only the Cloud namespace from localStorage', async () => {
    localStorage.setItem('pos-storage-cloud', JSON.stringify({ students: [{ name: 'test' }] }));
    localStorage.setItem('pos-storage-prototype', JSON.stringify({ students: [{ name: 'prototype' }] }));
    expect(localStorage.getItem('pos-storage-cloud')).not.toBeNull();

    await clearSensitiveData();

    expect(localStorage.getItem('pos-storage-cloud')).toBeNull();
    expect(localStorage.getItem('pos-storage-prototype')).not.toBeNull();
  });

  it('does not throw when storage is already empty', async () => {
    await expect(clearSensitiveData()).resolves.toBeUndefined();
  });

  it('attempts to delete IndexedDB databases', async () => {
    const deleteSpy = vi.spyOn(window.indexedDB, 'deleteDatabase');
    await clearSensitiveData();

    // Cloud cleanup deletes only its crash-draft namespace; P13 memory cache remains planned.
    expect(deleteSpy).toHaveBeenCalledWith('easyorder-crash-draft-cloud');
    expect(deleteSpy).not.toHaveBeenCalledWith('easyorder-pos');
    deleteSpy.mockRestore();
  });

  it('reports a blocked Cloud crash-draft deletion instead of treating it as cleared', async () => {
    const databaseName = 'easyorder-crash-draft-cloud';
    const legacyHandle = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('drafts');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    try {
      await expect(clearSensitiveData()).rejects.toThrow(/關閉其他 EasyOrder 分頁/);
    } finally {
      legacyHandle.close();
    }
  });

  // Error logs are included in Cloud auth cleanup.
  it('clears the error log during Cloud auth cleanup', async () => {
    localStorage.setItem('easyorder-error-log', JSON.stringify([{ id: 'e1', message: 'test error' }]));
    expect(localStorage.getItem('easyorder-error-log')).not.toBeNull();

    await clearSensitiveData();

    expect(localStorage.getItem('easyorder-error-log')).toBeNull();
  });
});
