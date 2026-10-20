import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appendErrorLog, readSafeDiagnostics, SAFE_DIAGNOSTICS_STORAGE_KEY } from '../errorLogger';
import { emitError } from '../errorBus';

const markers = [
  'P13B1-BARE-NAME-王小明',
  'P13B1-AMOUNT-987654321',
  'P13B1-EMAIL-private@example.test',
  'P13B1-URL-https://example.test/path?student=secret',
  'P13B1-STACK-/Users/private/project/App.tsx',
  'P13B1-NESTED-PAYLOAD-秘密',
];

describe('P13b1 non-prototype diagnostic storage', () => {
  beforeEach(() => localStorage.clear());

  it('persists only fixed safe fields for direct, bus, and global error input', () => {
    localStorage.setItem('easyorder-error-log', JSON.stringify([{ message: markers.join(' ') }]));
    localStorage.setItem('easyorder-error-log-prototype', 'prototype-sentinel');
    localStorage.setItem('unrelated-storage-sentinel', 'unrelated-sentinel');

    appendErrorLog({
      source: 'react',
      message: markers.join(' '),
      stack: markers.join('\n'),
      context: { errorCode: markers[0], nested: { payload: markers[5] } } as never,
    });
    emitError({ source: 'firebase', message: markers.join(' '), stack: markers.join('\n') });

    const serializedStorage = Object.keys(localStorage)
      .map(key => `${key}=${localStorage.getItem(key) ?? ''}`)
      .join('\n');
    for (const marker of markers) expect(serializedStorage).not.toContain(marker);
    expect(localStorage.getItem('easyorder-error-log-prototype')).toBe('prototype-sentinel');
    expect(localStorage.getItem('unrelated-storage-sentinel')).toBe('unrelated-sentinel');

    const raw = localStorage.getItem(SAFE_DIAGNOSTICS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const envelope = JSON.parse(raw!);
    expect(envelope).toMatchObject({ schemaVersion: 1 });
    expect(envelope.entries).toHaveLength(2);
    expect(envelope.entries[0]).toEqual({
      type: 'system-error', source: 'firebase', systemCode: 'FIREBASE_ERROR', occurredAt: expect.any(String),
    });
    expect(envelope.entries[1]).toEqual({
      type: 'system-error', source: 'react', systemCode: 'RENDER_CRASH', occurredAt: expect.any(String),
    });
  });

  it('filters expired entries and caps the safe envelope at 100 entries before appending', () => {
    const now = Date.now();
    const entries = Array.from({ length: 101 }, (_, index) => ({
      type: 'system-error',
      source: 'auth',
      systemCode: 'AUTH_ERROR',
      occurredAt: new Date(now - index * 60_000).toISOString(),
    }));
    entries.push({
      type: 'system-error', source: 'auth', systemCode: 'AUTH_ERROR',
      occurredAt: new Date(now - 25 * 60 * 60 * 1000).toISOString(),
    });
    localStorage.setItem(SAFE_DIAGNOSTICS_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, entries }));

    appendErrorLog({ source: 'auth', message: 'synthetic auth failure' });

    const envelope = JSON.parse(localStorage.getItem(SAFE_DIAGNOSTICS_STORAGE_KEY)!);
    expect(envelope.entries).toHaveLength(100);
    expect(envelope.entries.every((entry: { occurredAt: string }) => Date.now() - Date.parse(entry.occurredAt) <= 24 * 60 * 60 * 1000)).toBe(true);
  });

  it('removes crafted fields from persisted storage when the safe envelope is read', () => {
    const marker = 'P13B1-CRAFTED-STORAGE-王小明-private@example.test';
    const safeEntry = {
      type: 'system-error', source: 'auth', systemCode: 'AUTH_ERROR', occurredAt: new Date().toISOString(),
    };
    localStorage.setItem(SAFE_DIAGNOSTICS_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      entries: [
        safeEntry,
        { ...safeEntry, payload: marker },
      ],
    }));

    expect(readSafeDiagnostics()).toEqual([safeEntry]);
    expect(localStorage.getItem(SAFE_DIAGNOSTICS_STORAGE_KEY) ?? '').not.toContain(marker);
  });

  it('canonicalizes duplicate envelope and entry keys before returning a safe decoded entry', () => {
    const marker = 'P13B1-DUPLICATE-PRIVATE-MARKER';
    const occurredAt = new Date().toISOString();
    const raw = `{"schemaVersion":"${marker}","schemaVersion":1,"entries":[{"type":"system-error","source":"${marker}","source":"auth","systemCode":"AUTH_ERROR","occurredAt":"${occurredAt}"}]}`;
    const safeEntry = {
      type: 'system-error', source: 'auth', systemCode: 'AUTH_ERROR', occurredAt,
    };
    localStorage.setItem(SAFE_DIAGNOSTICS_STORAGE_KEY, raw);

    expect(readSafeDiagnostics()).toEqual([safeEntry]);
    expect(localStorage.getItem(SAFE_DIAGNOSTICS_STORAGE_KEY)).toBe(JSON.stringify({ schemaVersion: 1, entries: [safeEntry] }));
    expect(localStorage.getItem(SAFE_DIAGNOSTICS_STORAGE_KEY)).not.toContain(marker);
  });

  it('canonicalizes legal whitespace and escape variants of safe stored records', () => {
    const occurredAt = new Date().toISOString();
    const raw = ` { "schemaVersion" : 1 , "entries" : [ { "type" : "system-error" , "source" : "\\u0061uth" , "systemCode" : "AUTH_ERROR" , "occurredAt" : "${occurredAt}" } ] } `;
    const safeEntry = {
      type: 'system-error', source: 'auth', systemCode: 'AUTH_ERROR', occurredAt,
    };
    localStorage.setItem(SAFE_DIAGNOSTICS_STORAGE_KEY, raw);

    expect(readSafeDiagnostics()).toEqual([safeEntry]);
    expect(localStorage.getItem(SAFE_DIAGNOSTICS_STORAGE_KEY)).toBe(JSON.stringify({ schemaVersion: 1, entries: [safeEntry] }));
  });

  it('fails closed when canonicalization cannot remove or rewrite unsafe bytes', () => {
    const marker = 'P13B1-REWRITE-PRIVATE-MARKER';
    const occurredAt = new Date().toISOString();
    const raw = `{"schemaVersion":"${marker}","schemaVersion":1,"entries":[{"type":"system-error","source":"${marker}","source":"auth","systemCode":"AUTH_ERROR","occurredAt":"${occurredAt}"}]}`;
    localStorage.setItem(SAFE_DIAGNOSTICS_STORAGE_KEY, raw);
    const removeItem = vi.spyOn(localStorage, 'removeItem').mockImplementation(key => {
      if (key === SAFE_DIAGNOSTICS_STORAGE_KEY) throw new Error('storage removal denied');
    });

    expect(() => readSafeDiagnostics()).toThrow();
    expect(localStorage.getItem(SAFE_DIAGNOSTICS_STORAGE_KEY)).toBe(raw);
    removeItem.mockRestore();

    const removeItemAgain = vi.spyOn(localStorage, 'removeItem');
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (key === SAFE_DIAGNOSTICS_STORAGE_KEY) throw new DOMException('quota exceeded', 'QuotaExceededError');
      return Storage.prototype.setItem.call(localStorage, key, value);
    });
    expect(() => readSafeDiagnostics()).toThrow();
    expect(removeItemAgain).toHaveBeenCalledWith(SAFE_DIAGNOSTICS_STORAGE_KEY);
    expect(localStorage.getItem(SAFE_DIAGNOSTICS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(SAFE_DIAGNOSTICS_STORAGE_KEY) ?? '').not.toContain(marker);
    setItem.mockRestore();
    removeItemAgain.mockRestore();
  });

  it('reports a fixed storage failure when the read method is denied', () => {
    const getItem = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('P13B1 storage read marker', 'SecurityError');
    });

    expect(() => readSafeDiagnostics()).toThrow('Safe diagnostic storage is unavailable');
    getItem.mockRestore();
  });

  it('fails closed if the unsafe legacy key cannot be removed', () => {
    const marker = 'P13B1-LEGACY-RAW-private@example.test';
    const legacyKey = 'easyorder-error-log';
    localStorage.setItem(legacyKey, marker);
    const removeItem = vi.spyOn(localStorage, 'removeItem').mockImplementation(key => {
      if (key === legacyKey) throw new Error('storage removal denied');
    });

    expect(() => readSafeDiagnostics()).toThrow();
    expect(localStorage.getItem(legacyKey)).toBe(marker);
    removeItem.mockRestore();
  });
});
