import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';

const mocks = vi.hoisted(() => ({
  doc: vi.fn(() => { throw new Error('uninitialized Firestore client'); }),
  getDocFromServer: vi.fn(),
  onSnapshot: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  Timestamp: class Timestamp {},
  doc: mocks.doc,
  getDocFromServer: mocks.getDocFromServer,
  onSnapshot: mocks.onSnapshot,
  runTransaction: mocks.runTransaction,
  serverTimestamp: mocks.serverTimestamp,
}));

import {
  acquireLease,
  getLeaseStatus,
  releaseLease,
  subscribeLease,
} from '../activeAccountLease';

describe('activeAccountLease: unavailable Firestore fails closed', () => {
  it('does not fabricate a successful acquire from a non-Firestore object', async () => {
    const result = await acquireLease({} as Firestore, 'operator-a', 0);

    expect(result.status).toBe('lost');
    expect(mocks.runTransaction).not.toHaveBeenCalled();
  });

  it('does not treat a local UID or an unreadable lease as confirmed holder access', async () => {
    const state = await getLeaseStatus({} as Firestore, 'operator-a');

    expect(state.isKnown).toBe(false);
    expect(state.isHolder).toBe(false);
    expect(state.updatedAt).toBeNull();
  });

  it('does not fabricate successful release or a holder subscription update', async () => {
    const onUpdate = vi.fn();
    const released = await releaseLease({} as Firestore, 'operator-a', 0);
    const unsubscribe = subscribeLease({} as Firestore, 'operator-a', onUpdate);

    expect(released).toBe(false);
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ isKnown: false, isHolder: false }));
    expect(typeof unsubscribe).toBe('function');
  });
});
