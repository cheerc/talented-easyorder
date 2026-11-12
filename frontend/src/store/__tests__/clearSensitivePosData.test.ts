import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 特性測試（characterization）：直接驅動真的 clearSensitivePosData()，檢查 storage 結果。
// appMode 的 mock 同時提供 posStore／posPersistence 載入時會用到的 export，
// 讓同一組測試在重構前（會載入 POS store）與重構後（不載入）都能通過。
const mode = vi.hoisted(() => ({ isCloudMode: true }));

vi.mock('../../appMode', () => Object.defineProperties({
  getStorageMode: () => 'cloud',
  isPrototypeMode: false,
  namespacedStorageName: (name: string, storageMode: string) => (storageMode === 'cloud' ? `${name}-cloud` : name),
}, {
  isCloudMode: { enumerable: true, get: () => mode.isCloudMode },
}));

import { clearSensitivePosData } from '../clearSensitivePosData';

const CLOUD_POS_KEY = 'pos-storage-cloud';
const CRASH_DRAFT_DB = 'easyorder-crash-draft-cloud';
const LEGACY_ERROR_LOG_KEY = 'easyorder-error-log';

type FakeRequest = {
  onsuccess: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onblocked: ((event: Event) => void) | null;
};

function mockDeleteDatabase(outcome: 'blocked' | 'error') {
  return vi.spyOn(window.indexedDB, 'deleteDatabase').mockImplementation(() => {
    const request: FakeRequest = { onsuccess: null, onerror: null, onblocked: null };
    setTimeout(() => {
      if (outcome === 'blocked') request.onblocked?.(new Event('blocked'));
      else request.onerror?.(new Event('error'));
    }, 0);
    return request as unknown as IDBOpenDBRequest;
  });
}

/** 讓 localStorage.removeItem 對指定 key 丟錯（clearErrorLog 會吞掉並回傳 false）。 */
function failRemoveItemFor(key: string) {
  const original = localStorage.removeItem.bind(localStorage);
  return vi.spyOn(localStorage, 'removeItem').mockImplementation((name: string) => {
    if (name === key) throw new Error('storage unavailable');
    original(name);
  });
}

describe('clearSensitivePosData（雲端登出清除特性測試）', () => {
  beforeEach(() => {
    mode.isCloudMode = true;
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('只移除 pos-storage-cloud，保留 pos-storage-prototype 與無關 key', async () => {
    localStorage.setItem(CLOUD_POS_KEY, JSON.stringify({ students: [{ name: 'cloud' }] }));
    localStorage.setItem('pos-storage-prototype', JSON.stringify({ students: [{ name: 'prototype' }] }));
    localStorage.setItem('unrelated-key', 'keep');

    await clearSensitivePosData();

    expect(localStorage.getItem(CLOUD_POS_KEY)).toBeNull();
    expect(localStorage.getItem('pos-storage-prototype')).not.toBeNull();
    expect(localStorage.getItem('unrelated-key')).toBe('keep');
  });

  it('storage 本來就是空的時不丟錯', async () => {
    await expect(clearSensitivePosData()).resolves.toBeUndefined();
  });

  it('只以 easyorder-crash-draft-cloud 呼叫 indexedDB.deleteDatabase', async () => {
    const deleteSpy = vi.spyOn(window.indexedDB, 'deleteDatabase');

    await clearSensitivePosData();

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith(CRASH_DRAFT_DB);
  });

  it('deleteDatabase 被擋住（onblocked）時 reject，提示關閉其他分頁', async () => {
    mockDeleteDatabase('blocked');

    await expect(clearSensitivePosData()).rejects.toThrow(/關閉其他 EasyOrder 分頁/);
  });

  it('deleteDatabase 失敗（onerror）時 reject「雲端暫存資料庫清除失敗。」', async () => {
    mockDeleteDatabase('error');

    await expect(clearSensitivePosData()).rejects.toThrow('雲端暫存資料庫清除失敗。');
  });

  it('清掉舊的 easyorder-error-log', async () => {
    localStorage.setItem(LEGACY_ERROR_LOG_KEY, JSON.stringify([{ id: 'e1', message: 'test error' }]));

    await clearSensitivePosData();

    expect(localStorage.getItem(LEGACY_ERROR_LOG_KEY)).toBeNull();
  });

  it('舊錯誤紀錄清除失敗（clearErrorLog 回傳 false）時 reject「舊版本機錯誤紀錄清除失敗。」，pos-storage-cloud 仍已清除', async () => {
    localStorage.setItem(CLOUD_POS_KEY, JSON.stringify({ students: [] }));
    failRemoveItemFor(LEGACY_ERROR_LOG_KEY);

    await expect(clearSensitivePosData()).rejects.toThrow('舊版本機錯誤紀錄清除失敗。');

    expect(localStorage.getItem(CLOUD_POS_KEY)).toBeNull();
  });

  it('IndexedDB 失敗時 localStorage 仍會清除', async () => {
    localStorage.setItem(CLOUD_POS_KEY, JSON.stringify({ students: [] }));
    localStorage.setItem(LEGACY_ERROR_LOG_KEY, '[]');
    mockDeleteDatabase('blocked');

    await expect(clearSensitivePosData()).rejects.toThrow(/關閉其他 EasyOrder 分頁/);

    expect(localStorage.getItem(CLOUD_POS_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_ERROR_LOG_KEY)).toBeNull();
  });

  it('多個清除失敗時錯誤以空白串接成同一則訊息', async () => {
    mockDeleteDatabase('error');
    failRemoveItemFor(LEGACY_ERROR_LOG_KEY);

    await expect(clearSensitivePosData()).rejects.toThrow(
      '雲端暫存資料庫清除失敗。 舊版本機錯誤紀錄清除失敗。',
    );
  });

  it('非雲端模式（isCloudMode: false）完全不動 storage', async () => {
    mode.isCloudMode = false;
    localStorage.setItem(CLOUD_POS_KEY, 'keep');
    localStorage.setItem(LEGACY_ERROR_LOG_KEY, 'keep');
    const deleteSpy = vi.spyOn(window.indexedDB, 'deleteDatabase');

    await clearSensitivePosData();

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem(CLOUD_POS_KEY)).toBe('keep');
    expect(localStorage.getItem(LEGACY_ERROR_LOG_KEY)).toBe('keep');
  });

  it('保留顯示偏好與安全診斷 key', async () => {
    localStorage.setItem('easyorder-ui-tweaks', JSON.stringify({ theme: 'dark' }));
    localStorage.setItem('easyorder-diagnostics-cloud', '[]');
    localStorage.setItem('easyorder-diagnostics-nonprototype', '[]');

    await clearSensitivePosData();

    expect(localStorage.getItem('easyorder-ui-tweaks')).not.toBeNull();
    expect(localStorage.getItem('easyorder-diagnostics-cloud')).toBe('[]');
    expect(localStorage.getItem('easyorder-diagnostics-nonprototype')).toBe('[]');
  });
});
