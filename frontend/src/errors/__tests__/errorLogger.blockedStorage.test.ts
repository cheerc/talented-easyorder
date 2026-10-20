import { describe, expect, it, vi } from 'vitest';

describe('P13b1 denied localStorage property', () => {
  it('keeps logger and command repository imports safe and fails closed on storage APIs', async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    window.localStorage.setItem('unrelated-storage-sentinel', 'preserved');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('P13B1 denied storage marker', 'SecurityError'); },
    });
    vi.resetModules();

    try {
      const repository = await import('../../firebase/cloudCommandRepository');
      expect(repository.createCloudCommandRepository).toBeTypeOf('function');

      const logger = await import('../errorLogger');
      expect(logger.clearSafeDiagnostics()).toBe(false);
      expect(() => logger.readSafeDiagnostics()).toThrow();
      expect(() => logger.appendCommandDiagnostic({
        commandId: null,
        kind: null,
        errorCode: 'UNKNOWN_RESULT',
      })).not.toThrow();
    } finally {
      if (originalDescriptor) Object.defineProperty(window, 'localStorage', originalDescriptor);
      else Reflect.deleteProperty(window, 'localStorage');
      vi.resetModules();
    }

    expect(window.localStorage.getItem('unrelated-storage-sentinel')).toBe('preserved');
  });
});
