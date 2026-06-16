import { describe, it, expect, afterEach } from 'vitest';
import { writeHandoffIntent, readHandoffIntent, subscribeHandoffChannel } from '../ipadHandoff';
import type { IpadHandoffMessage } from '../ipadHandoff';

const validMsg: IpadHandoffMessage = {
  version: 1,
  timestamp: Date.now(),
  action: 'order',
  studentId: 's001',
  sourceDevice: 'ipad_handoff',
};

afterEach(() => {
  sessionStorage.clear();
});

describe('#313 — handoff PII protection via BroadcastChannel', () => {
  it('writeHandoffIntent does NOT persist to sessionStorage when BroadcastChannel is available', () => {
    const channel = 'test-handoff';
    writeHandoffIntent(channel, validMsg);

    // BroadcastChannel is available in jsdom, so sessionStorage should be empty
    const stored = sessionStorage.getItem(channel);
    expect(stored).toBeNull();
  });

  it('readHandoffIntent returns null when sessionStorage is empty (BroadcastChannel path)', () => {
    const result = readHandoffIntent('test-handoff');
    expect(result).toBeNull();
  });

  it('readHandoffIntent cleans up sessionStorage fallback after read', () => {
    // Simulate fallback: directly write to sessionStorage
    sessionStorage.setItem('test-fallback', JSON.stringify(validMsg));

    const result = readHandoffIntent('test-fallback');
    expect(result).toEqual(validMsg);
    // Should be cleaned up after read
    expect(sessionStorage.getItem('test-fallback')).toBeNull();
  });

  it('subscribeHandoffChannel receives messages', async () => {
    const channel = 'test-subscribe';
    const received: IpadHandoffMessage[] = [];

    const unsub = subscribeHandoffChannel(channel, (msg) => {
      received.push(msg);
    });

    // Send a message via writeHandoffIntent
    writeHandoffIntent(channel, validMsg);

    // BroadcastChannel is async — wait a tick
    await new Promise(r => setTimeout(r, 10));

    expect(received.length).toBe(1);
    expect(received[0].studentId).toBe('s001');
    expect(received[0].action).toBe('order');

    unsub();
  });

  it('subscribeHandoffChannel ignores invalid messages', async () => {
    const channel = 'test-invalid';
    const received: IpadHandoffMessage[] = [];

    const unsub = subscribeHandoffChannel(channel, (msg) => {
      received.push(msg);
    });

    // Send invalid data via BroadcastChannel
    const bc = new BroadcastChannel(channel);
    bc.postMessage({ invalid: true });
    bc.close();

    await new Promise(r => setTimeout(r, 10));

    expect(received.length).toBe(0);

    unsub();
  });
});
