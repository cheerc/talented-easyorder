import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// #709 P2：prototype 入口移除後，MODE=prototype 不能再進 POS，必須和缺設定一樣 fail closed。
// 驅動真的 App 與真的 appMode（stubEnv + resetModules 後動態 import），不 mock validateAppModeConfig。
const FIREBASE_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
] as const;

describe('App：MODE=prototype 且無 Firebase 設定（#709 P2）', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('顯示「Firebase 設定錯誤」與 alert，不進入本機 POS', async () => {
    vi.stubEnv('MODE', 'prototype');
    for (const key of FIREBASE_ENV_KEYS) vi.stubEnv(key, '');
    vi.resetModules();
    const { default: App } = await import('../App');

    render(<App />);

    const main = await screen.findByRole('main', { name: 'Firebase 設定錯誤' });
    expect(main).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('正式模式缺少必要 Firebase 設定');
  });
});
