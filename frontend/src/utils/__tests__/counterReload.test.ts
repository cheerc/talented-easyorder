import { afterEach, describe, expect, it } from 'vitest';
import { clearCounterStart, isCounterStart } from '../counterReload';

describe('counterReload (#710)', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('只有 #counter 才算帶標記', () => {
    expect(isCounterStart()).toBe(false);
    window.history.replaceState(null, '', '/#other');
    expect(isCounterStart()).toBe(false);
    window.history.replaceState(null, '', '/#counter');
    expect(isCounterStart()).toBe(true);
  });

  it('清除標記時保留路徑與查詢字串，且不新增歷史紀錄', () => {
    window.history.replaceState(null, '', '/app?x=1#counter');
    const length = window.history.length;
    clearCounterStart();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/app?x=1');
    expect(window.history.length).toBe(length);
  });
  // reloadToCounter 的整頁重新整理 jsdom 做不到，由 e2e/cloud-shell.spec.ts 驗證。
});
