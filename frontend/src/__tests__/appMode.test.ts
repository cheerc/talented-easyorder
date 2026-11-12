import { describe, expect, it } from 'vitest';
import { hasFirebaseConfig, validateAppModeConfig } from '../appMode';

describe('appMode: Firebase 設定判斷與 fail closed', () => {
  const completeFirebaseEnv = {
    VITE_FIREBASE_API_KEY: 'test-api-key',
    VITE_FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: 'test-project',
    VITE_FIREBASE_APP_ID: '1:123:web:abc',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789',
    VITE_FIREBASE_STORAGE_BUCKET: 'test.appspot.com',
  };

  it('正確識別完整的 Firebase 環境設定', () => {
    expect(hasFirebaseConfig(completeFirebaseEnv)).toBe(true);
    expect(hasFirebaseConfig({})).toBe(false);
    expect(hasFirebaseConfig({ VITE_FIREBASE_API_KEY: 'only-key' })).toBe(false);
  });

  it('驗收條件：缺 Firebase config 不可無聲降級 local-only', () => {
    const validResult = validateAppModeConfig(completeFirebaseEnv);
    expect(validResult.ok).toBe(true);

    const invalidResult = validateAppModeConfig({});
    expect(invalidResult.ok).toBe(false);
    if (!invalidResult.ok) {
      expect(invalidResult.error).toContain('不可無聲降級為 local-only 儲存');
    }

    // 只缺一項也 fail closed；Vite mode（含 prototype）不影響結果（#709）。
    expect(validateAppModeConfig({ ...completeFirebaseEnv, VITE_FIREBASE_APP_ID: '', MODE: 'prototype' }).ok).toBe(false);
  });
});
