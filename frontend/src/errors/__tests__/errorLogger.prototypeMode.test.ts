import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// #709 P2：prototype 入口移除後，MODE=prototype 不能再走自由文字 logger。
// 與其他模式一樣只寫安全診斷（只含來源與固定代碼）。
describe('errorLogger：MODE=prototype（#709 P2）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    localStorage.clear();
  });

  it('appendErrorLog 寫入安全診斷，不寫 easyorder-error-log-prototype 自由文字', async () => {
    vi.stubEnv('MODE', 'prototype');
    vi.resetModules();
    const { appendErrorLog, SAFE_DIAGNOSTICS_STORAGE_KEY } = await import('../errorLogger');

    appendErrorLog({ source: 'react', message: '學生: 王小明, 餘額: 500', stack: 'Error: boom\n    at x (file.ts:1:1)' });

    const raw = localStorage.getItem(SAFE_DIAGNOSTICS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const envelope = JSON.parse(raw as string) as { entries: Array<{ type: string; systemCode?: string }> };
    expect(envelope.entries).toHaveLength(1);
    expect(envelope.entries[0]).toMatchObject({ type: 'system-error', systemCode: 'RENDER_CRASH' });
    expect(raw).not.toContain('王小明');
    expect(localStorage.getItem('easyorder-error-log-prototype')).toBeNull();
  });
});
