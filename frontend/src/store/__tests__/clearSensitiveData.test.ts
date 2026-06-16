import { describe, expect, it, vi, beforeEach } from 'vitest';
vi.unmock('../../store/posPersistence');
import { clearSensitiveData } from '../../store/posPersistence';

describe('clearSensitiveData (#286)', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset fakeIndexedDB databases
    (window.indexedDB as unknown as { _databases: Map<string, unknown> })._databases?.clear();
  });

  it('removes pos-storage from localStorage', async () => {
    localStorage.setItem('pos-storage', JSON.stringify({ students: [{ name: 'test' }] }));
    expect(localStorage.getItem('pos-storage')).not.toBeNull();

    await clearSensitiveData();

    expect(localStorage.getItem('pos-storage')).toBeNull();
  });

  it('does not throw when storage is already empty', async () => {
    await expect(clearSensitiveData()).resolves.toBeUndefined();
  });

  it('attempts to delete IndexedDB databases', async () => {
    const deleteSpy = vi.spyOn(window.indexedDB, 'deleteDatabase');
    await clearSensitiveData();

    // Should attempt to delete both easyorder-pos and easyorder-crash-draft
    expect(deleteSpy).toHaveBeenCalledWith('easyorder-pos');
    expect(deleteSpy).toHaveBeenCalledWith('easyorder-crash-draft');
    deleteSpy.mockRestore();
  });

  // Ref: #315 — Error log must be cleared on signOut
  it('clears error log from localStorage on signOut', async () => {
    localStorage.setItem('easyorder-error-log', JSON.stringify([{ id: 'e1', message: 'test error' }]));
    expect(localStorage.getItem('easyorder-error-log')).not.toBeNull();

    await clearSensitiveData();

    expect(localStorage.getItem('easyorder-error-log')).toBeNull();
  });
});
