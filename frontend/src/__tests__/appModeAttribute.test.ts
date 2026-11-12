import { describe, it, expect } from 'vitest';
import { applyAppModeAttribute, APP_MODE_ATTRIBUTE } from '../appMode';

describe('html 的 data-app-mode（等比放大與雲端字型只在雲端模式生效）', () => {
  it('在 html 設 data-app-mode="cloud"', () => {
    const el = document.createElement('html');
    applyAppModeAttribute(el);
    expect(el.getAttribute(APP_MODE_ATTRIBUTE)).toBe('cloud');
  });
});
