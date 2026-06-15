import type { Auth, User } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { getAuthMod, getFirestoreMod } from './firebaseModules';
import { operatorPath } from './firestorePaths';
import { emitError } from '../errors/errorBus';

// Ref: #285 — Runtime type guard for Firestore operator doc data.
// Replaces unsafe `as` cast to catch server-side doc shape changes.
interface OperatorDocData {
  active?: boolean;
  role?: 'counter' | 'admin';
}

export function isValidOperatorDoc(data: unknown): data is OperatorDocData {
  if (data == null || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;
  if ('active' in obj && typeof obj.active !== 'boolean') return false;
  if ('role' in obj && obj.role !== 'counter' && obj.role !== 'admin') return false;
  return true;
}

const ALLOWED_DOMAIN = import.meta.env.VITE_ALLOWED_EMAIL_DOMAIN ?? 'talented.com.tw';

export interface OperatorProfile {
  uid: string;
  email: string;
  displayName: string;
}

export type OperatorAccess =
  | { ok: true; profile: OperatorProfile; role: 'counter' | 'admin' }
  | { ok: false; reason: 'signed_out' | 'wrong_domain' | 'not_whitelisted' | 'inactive'; profile?: OperatorProfile };

export function isAllowedWorkspaceEmail(email: string | null): boolean {
  return Boolean(email && email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN));
}

export function toOperatorProfile(user: Pick<User, 'uid' | 'email' | 'displayName'>): OperatorProfile {
  return {
    uid: user.uid,
    email: user.email ?? '',
    displayName: user.displayName ?? user.email ?? user.uid,
  };
}

export function shouldForceSignOut(access: OperatorAccess): boolean {
  return !access.ok && access.reason !== 'signed_out';
}

export async function getOperatorAccess(db: Firestore, user: User): Promise<OperatorAccess> {
  const profile = toOperatorProfile(user);
  if (!isAllowedWorkspaceEmail(profile.email)) {
    return { ok: false, reason: 'wrong_domain', profile };
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
  return { ok: true, profile, role: raw.role ?? 'counter' };
}

export async function verifyUserAuthorization(auth: Auth, db: Firestore, user: User): Promise<OperatorAccess> {
  const access = await getOperatorAccess(db, user);
  if (shouldForceSignOut(access)) {
    await getAuthMod().signOut(auth);
  }
  return access;
}

export async function signInWithGoogle(auth: Auth, db: Firestore): Promise<OperatorAccess> {
  const { GoogleAuthProvider, signInWithPopup } = getAuthMod();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ hd: ALLOWED_DOMAIN, prompt: 'select_account' });
  const credential = await signInWithPopup(auth, provider);
  return verifyUserAuthorization(auth, db, credential.user);
}

export function signOutOperator(auth: Auth): Promise<void> {
  return getAuthMod().signOut(auth);
}

export function subscribeOperatorAccess(
  auth: Auth,
  db: Firestore,
  onAccess: (access: OperatorAccess) => void,
): () => void {
  const { onAuthStateChanged, signOut } = getAuthMod();
  const { doc, onSnapshot } = getFirestoreMod();
  let unsubscribeOperator: (() => void) | null = null;
  const unsubscribeAuth = onAuthStateChanged(auth, async user => {
    unsubscribeOperator?.();
    unsubscribeOperator = null;

    if (!user) {
      onAccess({ ok: false, reason: 'signed_out' });
      return;
    }

    const profile = toOperatorProfile(user);
    if (!isAllowedWorkspaceEmail(profile.email)) {
      onAccess({ ok: false, reason: 'wrong_domain', profile });
      try {
        await signOut(auth);
      } catch (err) {
        emitError({
          source: 'auth',
          message: '[auth] force signOut failed: ' + (err instanceof Error ? err.message : String(err)),
        });
      }
      return;
    }

    unsubscribeOperator = onSnapshot(doc(db, operatorPath(profile.uid)), async snapshot => {
      const raw = snapshot.data();
      const data = isValidOperatorDoc(raw) ? raw : null;
      if (raw && !data) {
        emitError({ source: 'auth', message: '[auth] operator doc has unexpected shape' });
      }
      if (!raw || !data) {
        onAccess({ ok: false, reason: 'not_whitelisted', profile });
        try {
          await signOut(auth);
        } catch (err) {
          emitError({
            source: 'auth',
            message: '[auth] force signOut failed: ' + (err instanceof Error ? err.message : String(err)),
          });
        }
        return;
      }
      if (!data.active) {
        onAccess({ ok: false, reason: 'inactive', profile });
        try {
          await signOut(auth);
        } catch (err) {
          emitError({
            source: 'auth',
            message: '[auth] force signOut failed: ' + (err instanceof Error ? err.message : String(err)),
          });
        }
        return;
      }
      onAccess({ ok: true, profile, role: data.role ?? 'counter' });
    });
  });

  return () => {
    unsubscribeOperator?.();
    unsubscribeAuth();
  };
}
