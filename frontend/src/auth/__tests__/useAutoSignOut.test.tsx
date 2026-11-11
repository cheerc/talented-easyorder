import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AUTO_SIGN_OUT_CHECK_MS, AUTO_SIGN_OUT_MS, AUTO_SIGN_OUT_NOTICE, useAutoSignOut } from '../autoSignOut';

/**
 * #691 P9: the fixed eight hours after login end in the normal sign-out flow. The local timer can only take access away, never
 * grant it, and a sign-out that would interrupt a pending command waits until the page is no longer locked.
 */
describe('auto sign-out: one constant, the notice, and the deferral', () => {
  it('is eight hours from login, checked every 30 seconds, with the one-line notice shown on the login screen', () => {
    expect(AUTO_SIGN_OUT_MS).toBe(8 * 60 * 60 * 1000);
    expect(AUTO_SIGN_OUT_CHECK_MS).toBe(30_000);
    expect(AUTO_SIGN_OUT_NOTICE).toBe('已超過 8 小時，系統已自動登出。');
  });

  it('does nothing while the eight hours are not due', () => {
    const signOut = vi.fn();
    const onSigningOut = vi.fn();
    renderHook(() => useAutoSignOut({ due: false, locked: false, signOut, onSigningOut }));
    expect(signOut).not.toHaveBeenCalled();
    expect(onSigningOut).not.toHaveBeenCalled();
  });

  it('notes the reason, then signs out once, as soon as it is due and nothing is pending', () => {
    const order: string[] = [];
    const signOut = vi.fn(() => { order.push('signOut'); });
    const onSigningOut = vi.fn(() => { order.push('note'); });
    const { rerender } = renderHook(props => useAutoSignOut(props), {
      initialProps: { due: true, locked: false, signOut, onSigningOut },
    });
    expect(order).toEqual(['note', 'signOut']);

    // Re-rendering while still due never signs out a second time.
    rerender({ due: true, locked: false, signOut, onSigningOut });
    rerender({ due: true, locked: false, signOut, onSigningOut });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('waits while the page is locked by an unresolved command and signs out once it is released', () => {
    const signOut = vi.fn();
    const onSigningOut = vi.fn();
    const { rerender } = renderHook(props => useAutoSignOut(props), {
      initialProps: { due: true, locked: true, signOut, onSigningOut },
    });
    expect(signOut).not.toHaveBeenCalled();
    expect(onSigningOut).not.toHaveBeenCalled();

    rerender({ due: true, locked: true, signOut, onSigningOut });
    expect(signOut).not.toHaveBeenCalled();

    rerender({ due: true, locked: false, signOut, onSigningOut });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(onSigningOut).toHaveBeenCalledTimes(1);
  });

  it('is armed again for the next login after the due flag was cleared', () => {
    const signOut = vi.fn();
    const onSigningOut = vi.fn();
    const { rerender } = renderHook(props => useAutoSignOut(props), {
      initialProps: { due: true, locked: false, signOut, onSigningOut },
    });
    rerender({ due: false, locked: false, signOut, onSigningOut });
    rerender({ due: true, locked: false, signOut, onSigningOut });
    expect(signOut).toHaveBeenCalledTimes(2);
  });

  it('does nothing when there is no operator to sign out', () => {
    const onSigningOut = vi.fn();
    renderHook(() => useAutoSignOut({ due: true, locked: false, signOut: undefined, onSigningOut }));
    expect(onSigningOut).not.toHaveBeenCalled();
  });
});
