import { afterEach, describe, expect, it, vi } from 'vitest';

// #709 P2（R11）：MODE=prototype 加完整 Firebase 設定時會跑雲端 app，
// 登出清除不能因為 appMode 仍判定「不是 cloud」而直接跳過。
// 用真的 appMode（stubEnv + resetModules 後動態 import），不 mock appMode。
describe('clearSensitivePosData：MODE=prototype 加完整 Firebase 設定（#709 P2 / R11）', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('仍清掉 pos-storage-cloud，並刪除 easyorder-crash-draft-cloud', async () => {
    vi.stubEnv('MODE', 'prototype');
    vi.stubEnv('VITE_FIREBASE_API_KEY', 'api-key');
    vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'easyorder.firebaseapp.com');
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo-easyorder');
    vi.stubEnv('VITE_FIREBASE_APP_ID', 'app-id');
    vi.stubEnv('VITE_FIREBASE_MESSAGING_SENDER_ID', 'sender');
    vi.stubEnv('VITE_FIREBASE_STORAGE_BUCKET', 'demo-easyorder.appspot.com');
    vi.resetModules();
    localStorage.setItem('pos-storage-cloud', JSON.stringify({ students: [{ name: 'cloud' }] }));
    localStorage.setItem('unrelated-key', 'keep');
    const deleteSpy = vi.spyOn(window.indexedDB, 'deleteDatabase');
    const { clearSensitivePosData } = await import('../clearSensitivePosData');

    await clearSensitivePosData();

    expect(localStorage.getItem('pos-storage-cloud')).toBeNull();
    expect(localStorage.getItem('unrelated-key')).toBe('keep');
    expect(deleteSpy).toHaveBeenCalledWith('easyorder-crash-draft-cloud');
  });
});
