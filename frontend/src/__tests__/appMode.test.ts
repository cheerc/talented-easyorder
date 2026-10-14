import { describe, expect, it } from 'vitest';
import {
  canResetData,
  canSeedData,
  getStorageMode,
  hasFirebaseConfig,
  isCloudModeName,
  namespacedStorageName,
  validateAppModeConfig,
} from '../appMode';

describe('appMode: 雲端模式判斷與儲存隔離', () => {
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

  it('Cloud mode 判斷：非 prototype 且有 Firebase config', () => {
    expect(isCloudModeName('production', completeFirebaseEnv)).toBe(true);
    expect(isCloudModeName('development', completeFirebaseEnv)).toBe(true);
    // prototype 模式即使有 Firebase config 也不是 cloud
    expect(isCloudModeName('prototype', completeFirebaseEnv)).toBe(false);
    // 沒有 Firebase config 不是 cloud
    expect(isCloudModeName('production', {})).toBe(false);
  });

  it('StorageMode 解析：prototype > cloud > local-only', () => {
    expect(getStorageMode('prototype', completeFirebaseEnv)).toBe('prototype');
    expect(getStorageMode('production', completeFirebaseEnv)).toBe('cloud');
    expect(getStorageMode('production', {})).toBe('local-only');
  });

  it('驗收條件：正式模式缺 Firebase config 不可無聲降級 local-only', () => {
    const validResult = validateAppModeConfig('production', completeFirebaseEnv);
    expect(validResult.ok).toBe(true);

    const invalidResult = validateAppModeConfig('production', {});
    expect(invalidResult.ok).toBe(false);
    if (!invalidResult.ok) {
      expect(invalidResult.error).toContain('不可無聲降級為 local-only 儲存');
    }

    // prototype 模式允許無 Firebase config
    const protoResult = validateAppModeConfig('prototype', {});
    expect(protoResult.ok).toBe(true);
  });

  it('Cloud mode 禁止 seed / reset 入口', () => {
    expect(canResetData('cloud')).toBe(false);
    expect(canSeedData('cloud')).toBe(false);

    expect(canResetData('prototype')).toBe(true);
    expect(canSeedData('prototype')).toBe(true);
    expect(canResetData('local-only')).toBe(true);
    expect(canSeedData('local-only')).toBe(true);
  });

  it('儲存命名空間隔離：prototype、cloud、local-only 各自獨立', () => {
    expect(namespacedStorageName('pos-storage', 'prototype')).toBe('pos-storage-prototype');
    expect(namespacedStorageName('pos-storage', 'cloud')).toBe('pos-storage-cloud');
    expect(namespacedStorageName('pos-storage', 'local-only')).toBe('pos-storage');

    // 兼容 boolean 呼叫
    expect(namespacedStorageName('pos-storage', true)).toBe('pos-storage-prototype');
    expect(namespacedStorageName('pos-storage', false)).toBe('pos-storage');
  });
});
