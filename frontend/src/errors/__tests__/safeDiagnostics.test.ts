import { beforeEach, describe, expect, it } from 'vitest';
import { appendErrorLog } from '../errorLogger';
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

    const raw = localStorage.getItem('easyorder-diagnostics-cloud');
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
    localStorage.setItem('easyorder-diagnostics-cloud', JSON.stringify({ schemaVersion: 1, entries }));

    appendErrorLog({ source: 'auth', message: 'synthetic auth failure' });

    const envelope = JSON.parse(localStorage.getItem('easyorder-diagnostics-cloud')!);
    expect(envelope.entries).toHaveLength(100);
    expect(envelope.entries.every((entry: { occurredAt: string }) => Date.now() - Date.parse(entry.occurredAt) <= 24 * 60 * 60 * 1000)).toBe(true);
  });
});
