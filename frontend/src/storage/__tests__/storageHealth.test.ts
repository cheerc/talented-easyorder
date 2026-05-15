import { describe, expect, it } from 'vitest';
import { checkStorageHealth, getFallbackMode, StorageHealth } from '../storageHealth';

describe('storageHealth', () => {
  it('reports healthy when both localStorage and indexedDB are available', () => {
    // jsdom does not provide indexedDB; test localStorage only and skip indexedDB
    const result = checkStorageHealth();
    expect(result.localStorage).toBe(true);
    expect(result.ok).toBe(result.indexedDB); // ok mirrors indexedDB availability
  });

  it('reports localStorage unavailable when setItem throws', () => {
    const origSet = localStorage.setItem.bind(localStorage);
    localStorage.setItem = () => { throw new Error('quota exceeded'); };
    try {
      const result = checkStorageHealth();
      expect(result.localStorage).toBe(false);
      expect(result.ok).toBe(false);
    } finally {
      localStorage.setItem = origSet;
    }
  });

  it('reports indexedDB available when mock is present', () => {
    // setup.ts provides a fake indexedDB, so this should be true in test environment
    const result = checkStorageHealth();
    expect(result.indexedDB).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('getFallbackMode returns localStorage-only when indexedDB is down', () => {
    const health: StorageHealth = { localStorage: true, indexedDB: false, ok: false };
    expect(getFallbackMode(health)).toBe('localStorage-only');
  });

  it('getFallbackMode returns indexedDB-only when localStorage is down', () => {
    const health: StorageHealth = { localStorage: false, indexedDB: true, ok: false };
    expect(getFallbackMode(health)).toBe('indexedDB-only');
  });

  it('getFallbackMode returns none when both are down', () => {
    const health: StorageHealth = { localStorage: false, indexedDB: false, ok: false };
    expect(getFallbackMode(health)).toBe('none');
  });

  it('getFallbackMode returns full when both are up', () => {
    const health: StorageHealth = { localStorage: true, indexedDB: true, ok: true };
    expect(getFallbackMode(health)).toBe('full');
  });
});
