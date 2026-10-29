import { beforeEach, describe, expect, it, vi } from 'vitest';

// 輸入法組字狀態必須在模組載入時就開始追蹤；若等到第一次按快捷鍵才註冊，
// 組字已開始的畫面會漏判，F 鍵仍會切頁。
describe('navigationKeys — composition tracking', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('detects composition started before the first navigation key is inspected', async () => {
    const { isCompositionKey } = await import('../navigationKeys');
    const event = new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true });

    window.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    expect(isCompositionKey(event)).toBe(true);

    window.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(isCompositionKey(event)).toBe(false);
  });

  it('detects per-event composition and the legacy keyCode 229', async () => {
    const { isCompositionKey } = await import('../navigationKeys');

    expect(isCompositionKey(new KeyboardEvent('keydown', { key: 'F2', isComposing: true }))).toBe(true);
    const legacy = new KeyboardEvent('keydown', { key: 'F2' });
    Object.defineProperty(legacy, 'keyCode', { value: 229 });
    expect(isCompositionKey(legacy)).toBe(true);
    expect(isCompositionKey(new KeyboardEvent('keydown', { key: 'F2' }))).toBe(false);
  });
});
