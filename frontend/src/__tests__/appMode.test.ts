import { describe, expect, it } from 'vitest';
import { isPrototypeModeName, namespacedStorageName } from '../appMode';

describe('appMode', () => {
  it('recognizes only the prototype Vite mode', () => {
    expect(isPrototypeModeName('prototype')).toBe(true);
    expect(isPrototypeModeName('development')).toBe(false);
    expect(isPrototypeModeName('production')).toBe(false);
    expect(isPrototypeModeName(undefined)).toBe(false);
  });

  it('keeps normal-mode storage names unchanged and suffixes prototype ones', () => {
    expect(namespacedStorageName('easyorder-pos', false)).toBe('easyorder-pos');
    expect(namespacedStorageName('easyorder-pos', true)).toBe('easyorder-pos-prototype');
  });

  it('uses normal-mode names under the test runner', () => {
    expect(namespacedStorageName('pos-storage')).toBe('pos-storage');
  });
});
