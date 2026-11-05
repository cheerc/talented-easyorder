import { describe, it, expect } from 'vitest';
import { applyAppModeAttribute, APP_MODE_ATTRIBUTE } from '../appMode';

describe('html 的 data-app-mode（等比放大與雲端字型只在雲端模式生效）', () => {
  it('雲端（非 prototype）模式在 html 設 data-app-mode="cloud"', () => {
    const el = document.createElement('html');
    applyAppModeAttribute(el, false);
    expect(el.getAttribute(APP_MODE_ATTRIBUTE)).toBe('cloud');
  });

  it('prototype 模式不帶該屬性，並清掉殘留值', () => {
    const el = document.createElement('html');
    el.setAttribute(APP_MODE_ATTRIBUTE, 'cloud');
    applyAppModeAttribute(el, true);
    expect(el.hasAttribute(APP_MODE_ATTRIBUTE)).toBe(false);
  });
});
