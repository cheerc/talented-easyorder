import { describe, expect, it } from 'vitest';
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
});
