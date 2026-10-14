import type { Auth, User } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { getAuthMod, getFirestoreMod } from './firebaseModules';
import { operatorPath } from './firestorePaths';
import { emitError } from '../errors/errorBus';
import { clearSensitiveData } from '../store/posPersistence';

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

const ALLOWED_DOMAIN = import.meta.env.VITE_ALLOWED_EMAIL_DOMAIN ?? 'example.com';

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
        | 'signed_out'
        | 'wrong_domain'
        | 'unverified_email'
        | 'non_google_provider'
        | 'not_whitelisted'
        | 'inactive'
        | 'email_mismatch';
      profile?: OperatorProfile;
    };

export function isAllowedWorkspaceEmail(email: string | null): boolean {
  if (!ALLOWED_DOMAIN) return true;
  return Boolean(email && email.toLowerCase().endsWith('@' + ALLOWED_DOMAIN));
}

export function isGoogleUser(user: User): boolean {
  // 在 Firebase Auth Emulator 測試環境下（VITE_FIREBASE_USE_EMULATOR === 'true'），
  // Playwright E2E 透過 emulator REST API / signInWithEmailAndPassword 登入，允許測試
  if (import.meta.env.VITE_FIREBASE_USE_EMULATOR === 'true') {
    return true;
  }
  if (!user.providerData || user.providerData.length === 0) return true;
  return user.providerData.some(p => p.providerId === 'google.com');
}

export function toOperatorProfile(user: Pick<User, 'uid' | 'email' | 'displayName'>): OperatorProfile {
  return {
    uid: user.uid,
    email: user.email ?? '',
    displayName: user.displayName ?? user.email ?? user.uid,
  };
}

export function shouldForceSignOut(access: OperatorAccess): boolean {
  // 只在明確網域錯誤時強制登出；未核准與停用者需留在登入狀態檢視說明與 UID
  return !access.ok && access.reason === 'wrong_domain';
}

export async function getOperatorAccess(db: Firestore, user: User): Promise<OperatorAccess> {
  const profile = toOperatorProfile(user);

  if (ALLOWED_DOMAIN && !isAllowedWorkspaceEmail(profile.email)) {
    return { ok: false, reason: 'wrong_domain', profile };
  }

  // 規格 §4.1: Google sign-in 要求 email_verified=true
  if (user.emailVerified === false) {
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

  // 規格 §4.1: operators/{uid} 的 email 必須與登入 Google email 精確相符
  if (raw.email && raw.email.toLowerCase() !== profile.email.toLowerCase()) {
    return { ok: false, reason: 'email_mismatch', profile };
  }

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
  const customParams: Record<string, string> = { prompt: 'select_account' };
  if (ALLOWED_DOMAIN) {
    customParams.hd = ALLOWED_DOMAIN;
  }
  provider.setCustomParameters(customParams);

  const credential = await authMod.signInWithPopup(auth, provider);
  return verifyUserAuthorization(auth, db, credential.user);
}

// Ref: #286 — Clear sensitive POS data on signOut to protect PII on shared devices.
export async function signOutOperator(auth: Auth): Promise<void> {
  await clearSensitiveData();
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

    if (ALLOWED_DOMAIN && !isAllowedWorkspaceEmail(profile.email)) {
      try {
        await signOut(auth);
      } catch (err) {
        emitError({
          source: 'auth',
          message: '[auth] force signOut failed: ' + (err instanceof Error ? err.message : String(err)),
        });
      }
      onAccess({ ok: false, reason: 'wrong_domain', profile });
      return;
    }

    if (user.emailVerified === false) {
      onAccess({ ok: false, reason: 'unverified_email', profile });
      return;
    }

    if (!isGoogleUser(user)) {
      onAccess({ ok: false, reason: 'non_google_provider', profile });
      return;
    }

    unsubscribeOperator = onSnapshot(
      doc(db, operatorPath(profile.uid)),
      snapshot => {
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
        if (data.email && data.email.toLowerCase() !== profile.email.toLowerCase()) {
          onAccess({ ok: false, reason: 'email_mismatch', profile });
          return;
        }
        onAccess({ ok: true, profile, role: data.role ?? 'counter' });
      },
      err => {
        emitError({ source: 'auth', message: '[auth] operator onSnapshot error: ' + err.message });
        onAccess({ ok: false, reason: 'not_whitelisted', profile });
      },
    );
  });

  return () => {
    unsubscribeOperator?.();
    unsubscribeAuth();
  };
}
