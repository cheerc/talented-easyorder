import { useEffect, useRef } from 'react';

/**
 * #691 P9: the system signs out by itself a fixed eight hours after the operator took over the lease. Activity never extends
 * it, there is no setting and no countdown before it. The timer only ever takes access away (the sign-out releases the lease
 * through the normal flow); it never grants, extends or proves access, so it does not replace the server's checks
 * (frontend/CLAUDE.md: no local countdown authorizes anything; REVIEW.md 🔴 #5).
 */
export const AUTO_SIGN_OUT_MS = 8 * 60 * 60 * 1000;

/** How often the elapsed time is compared with the fixed limit; a computer that slept is noticed at the next check. */
export const AUTO_SIGN_OUT_CHECK_MS = 30_000;

/** The one line the login screen shows after an automatic sign-out. */
export const AUTO_SIGN_OUT_NOTICE = '已超過 8 小時，系統已自動登出。';

interface AutoSignOutInput {
  /** The fixed time has passed for the confirmed holder (FirebaseProvider). */
  due: boolean;
  /** A command is unresolved or an error awaits handling: signing out now would cut it off, so it waits. */
  locked: boolean;
  /** The normal sign-out flow of the operator menu (confirm results, release the lease, then sign out). */
  signOut: (() => void) | undefined;
  /** Records the reason so that the login screen can say it. */
  onSigningOut: () => void;
}

/** Signs out once when the fixed time is due and nothing is pending; a locked page defers it until it is released. */
export function useAutoSignOut({ due, locked, signOut, onSigningOut }: AutoSignOutInput): void {
  const firedRef = useRef(false);
  useEffect(() => {
    if (!due) {
      firedRef.current = false;
      return;
    }
    if (locked || firedRef.current || !signOut) return;
    firedRef.current = true;
    onSigningOut();
    signOut();
  }, [due, locked, signOut, onSigningOut]);
}
