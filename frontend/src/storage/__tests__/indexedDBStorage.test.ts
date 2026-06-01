import { describe, expect, it, vi } from 'vitest';
import { createIndexedDBStorage } from '../indexedDBStorage';

describe('createIndexedDBStorage', () => {
  describe('getItem', () => {
    it('returns null when no data exists for the key', async () => {
      const storage = createIndexedDBStorage();
      const result = await storage.getItem('nonexistent-key');
      expect(result).toBeNull();
    });
  });

  describe('setItem and getItem round-trip', () => {
    it('stores and retrieves a state value', async () => {
      const storage = createIndexedDBStorage();
      const value = { state: { students: [], transactions: [] }, version: 2 };

      await storage.setItem('test-key', value);
      const result = await storage.getItem('test-key');

      expect(result).toEqual(value);
    });

    it('stores and retrieves a complex nested state', async () => {
      const storage = createIndexedDBStorage();
      const value = {
        state: {
          students: [{ studentId: 's1', displayName: 'Alice', currentBalance: 500 }],
          transactions: [{ transactionId: 'tx-1', amount: -100 }],
          vendors: [{ vendorId: 'v1', name: 'Vendor A' }],
          todayMenu: { businessDate: '2026-05-15', itemName: 'Lunch', price: 60 },
        },
        version: 2,
      };

      await storage.setItem('complex-key', value);
      const result = await storage.getItem('complex-key');

      expect(result).toEqual(value);
    });
  });

  describe('removeItem', () => {
    it('removes stored data', async () => {
      const storage = createIndexedDBStorage();
      const value = { state: { students: [] }, version: 2 };

      await storage.setItem('remove-test', value);
      await storage.removeItem('remove-test');
      const result = await storage.getItem('remove-test');

      expect(result).toBeNull();
    });

    it('does not throw when removing non-existent key', async () => {
      const storage = createIndexedDBStorage();
      await expect(storage.removeItem('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('overwrite', () => {
    it('overwrites existing data for the same key', async () => {
      const storage = createIndexedDBStorage();
      const v1 = { state: { students: ['old'] }, version: 1 };
      const v2 = { state: { students: ['new'] }, version: 2 };

      await storage.setItem('overwrite-key', v1);
      await storage.setItem('overwrite-key', v2);
      const result = await storage.getItem('overwrite-key');

      expect(result).toEqual(v2);
    });
  });

  describe('connection singleton (_dbPromise)', () => {
    it('reuses cached connection without re-calling indexedDB.open', async () => {
      const storage = createIndexedDBStorage();
      // First operation primes _dbPromise
      await storage.setItem('init', { state: {}, version: 2 });

      const openSpy = vi.spyOn(window.indexedDB, 'open');

      // Subsequent operations should NOT trigger new indexedDB.open calls
      await storage.setItem('k1', { state: { a: 1 }, version: 2 });
      await storage.setItem('k2', { state: { b: 2 }, version: 2 });
      await storage.getItem('init');

      expect(openSpy).not.toHaveBeenCalled();
    });

    it('shares data across separate createIndexedDBStorage instances', async () => {
      const storage1 = createIndexedDBStorage();
      const storage2 = createIndexedDBStorage();

      await storage1.setItem('shared', { state: { x: 1 }, version: 2 });
      const result = await storage2.getItem('shared');

      expect(result).toEqual({ state: { x: 1 }, version: 2 });
    });
  });
});
