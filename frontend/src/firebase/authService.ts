import type { Auth, User } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { getAuthMod, getFirestoreMod } from './firebaseModules';
import { operatorPath } from './firestorePaths';
import { emitError } from '../errors/errorBus';
import { clearSensitivePosData } from '../store/clearSensitivePosData';

// Ref: #285 — Runtime type guard for Firestore operator doc data.
// P03: 等權白名單，不強制要求 role，但相容舊有可選 role 欄位
export interface OperatorDocData {
  uid?: string;
  email?: string;
  displayName?: string;
  active?: boolean;
  role?: 'counter' | 'admin';
}

export function isValidOperatorDoc(data: unknown): data is OperatorDocData {
  if (data == null || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  if ('active' in obj && typeof obj.active !== 'boolean') return false;
  if ('role' in obj && obj.role !== 'counter' && obj.role !== 'admin' && obj.role !== undefined) {
    return false;
  }
  if ('email' in obj && typeof obj.email !== 'string') return false;
  return true;
}

export interface OperatorProfile {
  uid: string;
  email: string;
  displayName: string;
}

export type OperatorAccess =
  | { ok: true; profile: OperatorProfile; role?: 'counter' | 'admin' }
  | {
      ok: false;
      reason:
        | 'checking'
        | 'signed_out'
        | 'unverified_email'
        | 'non_google_provider'
        | 'not_whitelisted'
        | 'inactive'
        | 'email_mismatch';
      profile?: OperatorProfile;
    };

export function isGoogleUser(user: User): boolean {
  return Boolean(user.providerData?.some(provider => provider.providerId === 'google.com'));
}

export function toOperatorProfile(user: Pick<User, 'uid' | 'email' | 'displayName'>): OperatorProfile {
  return {
    uid: user.uid,
    email: user.email ?? '',
    displayName: user.displayName ?? user.email ?? user.uid,
  };
}

export async function getOperatorAccess(db: Firestore, user: User): Promise<OperatorAccess> {
  const profile = toOperatorProfile(user);

  // 規格 §4.1: Google sign-in 要求 email_verified=true
  if (user.emailVerified !== true) {
    return { ok: false, reason: 'unverified_email', profile };
  }

  if (!isGoogleUser(user)) {
    return { ok: false, reason: 'non_google_provider', profile };
  }

  const { getDoc, doc } = getFirestoreMod();
  const snapshot = await getDoc(doc(db, operatorPath(profile.uid)));
  const raw = snapshot.data();
  if (!raw) return { ok: false, reason: 'not_whitelisted', profile };
  if (!isValidOperatorDoc(raw)) {
    emitError({ source: 'auth', message: '[auth] operator doc has unexpected shape' });
    return { ok: false, reason: 'not_whitelisted', profile };
  }
  if (!raw.active) return { ok: false, reason: 'inactive', profile };

  // Rules require the same exact email value as the verified Auth token.
  if (raw.email !== profile.email) {
    return { ok: false, reason: 'email_mismatch', profile };
  }

  return { ok: true, profile, role: raw.role ?? 'counter' };
}

export async function verifyUserAuthorization(auth: Auth, db: Firestore, user: User): Promise<OperatorAccess> {
  void auth;
  return getOperatorAccess(db, user);
}

export async function signInWithGoogle(auth: Auth, db: Firestore): Promise<OperatorAccess> {
  const authMod = getAuthMod();
  // 規格 §4.1, plan §P03: Browser-session Auth persistence
  if (typeof authMod.setPersistence === 'function' && authMod.browserSessionPersistence) {
    try {
      await authMod.setPersistence(auth, authMod.browserSessionPersistence);
    } catch {
      // best-effort
    }
  }

  const provider = new authMod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  const credential = await authMod.signInWithPopup(auth, provider);
  return verifyUserAuthorization(auth, db, credential.user);
}

// Ref: #286 — Clear sensitive POS data on signOut to protect PII on shared devices.
export async function signOutOperator(auth: Auth): Promise<void> {
  let cleanupError: unknown;
  try {
    await clearSensitivePosData();
  } catch (error) {
    cleanupError = error;
  }
  await getAuthMod().signOut(auth);
  if (cleanupError) {
    emitError({
      source: 'storage',
      message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
    });
  }
}

export function subscribeOperatorAccess(
  auth: Auth,
  db: Firestore,
  onAccess: (access: OperatorAccess) => void,
): () => void {
  const { onIdTokenChanged } = getAuthMod();
  const { doc, onSnapshot } = getFirestoreMod();
  let unsubscribeOperator: (() => void) | null = null;
  let generation = 0;

  const unsubscribeAuth = onIdTokenChanged(auth, async user => {
    const currentGeneration = ++generation;
    unsubscribeOperator?.();
    unsubscribeOperator = null;
    onAccess({ ok: false, reason: 'checking' });

    if (!user) {
      if (currentGeneration === generation) onAccess({ ok: false, reason: 'signed_out' });
      return;
    }

    const profile = toOperatorProfile(user);

    if (user.emailVerified !== true) {
      if (currentGeneration === generation) onAccess({ ok: false, reason: 'unverified_email', profile });
      return;
    }

    if (!isGoogleUser(user)) {
      if (currentGeneration === generation) onAccess({ ok: false, reason: 'non_google_provider', profile });
      return;
    }

    unsubscribeOperator = onSnapshot(
      doc(db, operatorPath(profile.uid)),
      snapshot => {
        if (currentGeneration !== generation) return;
        const raw = snapshot.data();
        const data = isValidOperatorDoc(raw) ? raw : null;
        if (raw && !data) {
          emitError({ source: 'auth', message: '[auth] operator doc has unexpected shape' });
        }
        if (!raw || !data) {
          onAccess({ ok: false, reason: 'not_whitelisted', profile });
          return;
        }
        if (!data.active) {
          onAccess({ ok: false, reason: 'inactive', profile });
          return;
        }
        if (data.email !== profile.email) {
          onAccess({ ok: false, reason: 'email_mismatch', profile });
          return;
        }
        onAccess({ ok: true, profile, role: data.role ?? 'counter' });
      },
      err => {
        if (currentGeneration !== generation) return;
        emitError({ source: 'auth', message: '[auth] operator onSnapshot error: ' + err.message });
        onAccess({ ok: false, reason: 'not_whitelisted', profile });
      },
    );
  });

  return () => {
    generation += 1;
    unsubscribeOperator?.();
    unsubscribeAuth();
  };
}
