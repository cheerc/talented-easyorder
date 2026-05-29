import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useServiceWorkerCleanup } from '../useServiceWorkerCleanup';

describe('useServiceWorkerCleanup', () => {
  it('unregisters all service worker registrations', async () => {
    const unregister = vi.fn().mockResolvedValue(undefined);
    const getRegistrations = vi.fn().mockResolvedValue([{ unregister }]);
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistrations },
      configurable: true,
    });

    renderHook(() => useServiceWorkerCleanup());

    await vi.waitFor(() => {
      expect(getRegistrations).toHaveBeenCalled();
    });
    // unregister is called in .then() — wait for microtask
    await new Promise(r => setTimeout(r, 10));
    expect(unregister).toHaveBeenCalled();
  });

  it('deletes all cache entries', async () => {
    const deleteFn = vi.fn().mockResolvedValue(true);
    const keys = vi.fn().mockResolvedValue(['cache-v1', 'cache-v2']);
    Object.defineProperty(window, 'caches', {
      value: { keys, delete: deleteFn },
      configurable: true,
    });

    renderHook(() => useServiceWorkerCleanup());

    await vi.waitFor(() => {
      expect(keys).toHaveBeenCalled();
    });
    await new Promise(r => setTimeout(r, 10));
    expect(deleteFn).toHaveBeenCalledWith('cache-v1');
    expect(deleteFn).toHaveBeenCalledWith('cache-v2');
  });

  it('handles empty registrations gracefully', async () => {
    const getRegistrations = vi.fn().mockResolvedValue([]);
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistrations },
      configurable: true,
    });

    expect(() => {
      renderHook(() => useServiceWorkerCleanup());
    }).not.toThrow();

    await vi.waitFor(() => {
      expect(getRegistrations).toHaveBeenCalled();
    });
  });
});
