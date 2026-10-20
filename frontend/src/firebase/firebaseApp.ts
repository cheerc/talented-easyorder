import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { ensureFirebaseModulesLoaded, getAuthMod, getFirestoreMod } from './firebaseModules';
import { isPrototypeModeName } from '../appMode';

export interface FirebaseEnv {
  MODE?: string;
  VITE_FIREBASE_API_KEY?: string;
  VITE_FIREBASE_AUTH_DOMAIN?: string;
  VITE_FIREBASE_PROJECT_ID?: string;
  VITE_FIREBASE_APP_ID?: string;
  VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  VITE_FIREBASE_STORAGE_BUCKET?: string;
  VITE_FIREBASE_USE_EMULATOR?: string;
  VITE_FIRESTORE_EMULATOR_HOST?: string;
  VITE_FIRESTORE_EMULATOR_PORT?: string;
  VITE_FIREBASE_AUTH_EMULATOR_URL?: string;
  VITE_RECAPTCHA_SITE_KEY?: string;
}

function required(env: FirebaseEnv, key: keyof FirebaseEnv): string {
  const value = env[key];
  if (!value) throw new Error(`Missing Firebase env var: ${key}`);
  return value;
}

export type FirebaseConfigState =
  | { configured: true; config: FirebaseOptions }
  | { configured: false; error: string };

export function readFirebaseConfig(env: FirebaseEnv): FirebaseOptions {
  return {
    apiKey: required(env, 'VITE_FIREBASE_API_KEY'),
    authDomain: required(env, 'VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: required(env, 'VITE_FIREBASE_PROJECT_ID'),
    appId: required(env, 'VITE_FIREBASE_APP_ID'),
    messagingSenderId: required(env, 'VITE_FIREBASE_MESSAGING_SENDER_ID'),
    storageBucket: required(env, 'VITE_FIREBASE_STORAGE_BUCKET'),
  };
}

export function getFirebaseConfigState(env: FirebaseEnv): FirebaseConfigState {
  // M0：本機練習模式即使有 Firebase env 也不連線。
  if (isPrototypeModeName(env.MODE)) {
    return { configured: false, error: '本機練習模式不連線 Firebase' };
  }
  try {
    return { configured: true, config: readFirebaseConfig(env) };
  } catch (error) {
    return {
      configured: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function isFirebaseConfigured(env: FirebaseEnv): boolean {
  return getFirebaseConfigState(env).configured;
}

export interface FirebaseServices {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

let cachedServices: FirebaseServices | null = null;
let initPromise: Promise<FirebaseServices> | null = null;
interface FirestoreCleanupSubscriber {
  callback: () => void;
  signal?: AbortSignal;
  detach: () => void;
}

interface FirebaseInitializationAttempt {
  subscribe: (options: FirebaseInitializationOptions) => void;
  notifyCleanupBlocked: () => void;
  dispose: () => void;
}

let initAttempt: FirebaseInitializationAttempt | null = null;
let initializedMemoryFirestore: Firestore | null = null;
let emulatorConnected = false;
let appCheckInitialized = false;

export interface FirebaseInitializationOptions {
  onFirestoreCleanupBlocked?: () => void;
  signal?: AbortSignal;
}

function createInitializationAttempt(): FirebaseInitializationAttempt {
  let cleanupBlocked = false;
  const subscribers = new Set<FirestoreCleanupSubscriber>();

  const subscribe = (options: FirebaseInitializationOptions) => {
    const callback = options.onFirestoreCleanupBlocked;
    const signal = options.signal;
    if (!callback || signal?.aborted) return;
    if (cleanupBlocked) {
      callback();
      return;
    }

    const subscriber: FirestoreCleanupSubscriber = {
      callback,
      signal,
      detach: () => {
        subscribers.delete(subscriber);
        signal?.removeEventListener('abort', subscriber.detach);
      },
    };
    subscribers.add(subscriber);
    signal?.addEventListener('abort', subscriber.detach, { once: true });
  };

  const notifyCleanupBlocked = () => {
    if (cleanupBlocked) return;
    cleanupBlocked = true;
    for (const subscriber of [...subscribers]) {
      const shouldNotify = !subscriber.signal?.aborted;
      subscriber.detach();
      if (shouldNotify) subscriber.callback();
    }
  };

  const dispose = () => {
    for (const subscriber of [...subscribers]) subscriber.detach();
  };

  return { subscribe, notifyCleanupBlocked, dispose };
}

// Ref: #287 — Initialize Firebase App Check with ReCaptchaV3Provider.
// Skips silently when VITE_RECAPTCHA_SITE_KEY is absent (dev without reCAPTCHA).
// Debug token enabled in development mode for local testing.
async function initializeAppCheckOnce(app: FirebaseApp, env: FirebaseEnv): Promise<void> {
  if (appCheckInitialized) return;
  appCheckInitialized = true;

  const siteKey = env.VITE_RECAPTCHA_SITE_KEY;
  if (!siteKey) return; // App Check opt-in via env var

  try {
    // Enable debug token in dev mode
    if (import.meta.env.DEV) {
      (globalThis as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    const { initializeAppCheck, ReCaptchaV3Provider } = await import('firebase/app-check');
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch {
    // App Check failure should not block app startup
  }
}

function initializeMemoryFirestore(app: FirebaseApp): Firestore {
  if (initializedMemoryFirestore) return initializedMemoryFirestore;
  const { initializeFirestore, memoryLocalCache } = getFirestoreMod();
  // An existing Firestore instance may have persistent settings. Do not adopt it:
  // its cache policy cannot be proven safe for Cloud mode.
  const db = initializeFirestore(app, { localCache: memoryLocalCache() });
  initializedMemoryFirestore = db;
  return db;
}

function observeBlockedFirestoreCleanup<T>(
  app: FirebaseApp,
  projectId: string,
  onBlocked: (() => void) | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (!onBlocked || typeof indexedDB === 'undefined') return operation();

  const factory = indexedDB;
  const databaseName = `firestore/${app.name}/${projectId}/main`;
  const previousDescriptor = Object.getOwnPropertyDescriptor(factory, 'deleteDatabase');
  const originalDeleteDatabase = factory.deleteDatabase.bind(factory);
  try {
    Object.defineProperty(factory, 'deleteDatabase', {
      configurable: true,
      writable: true,
      value: (name: string) => {
        const request = originalDeleteDatabase(name);
        if (name === databaseName) request.addEventListener('blocked', onBlocked, { once: true });
        return request;
      },
    });
  } catch {
    return operation();
  }

  const restore = () => {
    if (previousDescriptor) {
      Object.defineProperty(factory, 'deleteDatabase', previousDescriptor);
    } else {
      delete (factory as unknown as { deleteDatabase?: unknown }).deleteDatabase;
    }
  };
  return operation().finally(restore);
}

export function ensureFirebaseInitialized(
  env: FirebaseEnv = import.meta.env as FirebaseEnv,
  options: FirebaseInitializationOptions = {},
): Promise<FirebaseServices> {
  const state = getFirebaseConfigState(env);
  if (!state.configured) return Promise.reject(new Error(state.error));
  if (cachedServices) return Promise.resolve(cachedServices);
  if (initPromise) {
    initAttempt?.subscribe(options);
    return initPromise;
  }

  const attempt = createInitializationAttempt();
  attempt.subscribe(options);

  const pending = (async () => {
    await ensureFirebaseModulesLoaded();

    const app = getApps().length > 0 ? getApp() : initializeApp(state.config);
    const auth = getAuthMod().getAuth(app);
    const db = initializeMemoryFirestore(app);

    // Firestore persistence can outlive prior releases. Clear only this app's
    // known database before any Firestore reads begin, then keep this session
    // on an in-memory cache.
    const { clearIndexedDbPersistence } = getFirestoreMod();
    await observeBlockedFirestoreCleanup(app, state.config.projectId!, attempt.notifyCleanupBlocked, () =>
      clearIndexedDbPersistence(db),
    );

    if (env.VITE_FIREBASE_USE_EMULATOR === 'true' && !emulatorConnected) {
      const host = env.VITE_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1';
      const port = Number(env.VITE_FIRESTORE_EMULATOR_PORT ?? '8080');
      getFirestoreMod().connectFirestoreEmulator(db, host, port);
      getAuthMod().connectAuthEmulator(
        auth,
        env.VITE_FIREBASE_AUTH_EMULATOR_URL ?? 'http://127.0.0.1:9099',
        { disableWarnings: true },
      );
      emulatorConnected = true;

      if (typeof window !== 'undefined') {
        const syntheticGoogleSubject = (email: string): string => {
          const hex = Array.from(new TextEncoder().encode(email.toLowerCase()))
            .map(byte => byte.toString(16).padStart(2, '0'))
            .join('');
          return BigInt(`0x${hex}`).toString(10);
        };
        const base64UrlJson = (value: Record<string, unknown>): string =>
          btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        const googleCredentialFor = (email: string) => {
          const nowSeconds = Math.floor(Date.now() / 1000);
          const idToken = [
            base64UrlJson({ alg: 'none', typ: 'JWT' }),
            base64UrlJson({
              iss: 'https://accounts.google.com',
              aud: state.config.projectId,
              sub: syntheticGoogleSubject(email),
              email,
              email_verified: true,
              name: email.split('@')[0],
              given_name: 'E2E',
              family_name: 'Operator',
              iat: nowSeconds,
              exp: nowSeconds + 60 * 60,
            }),
            'e2e-emulator-signature',
          ].join('.');
          const authMod = getAuthMod();
          return authMod.GoogleAuthProvider.credential(idToken);
        };
        const signInGoogle = async (email: string) => {
          const result = await getAuthMod().signInWithCredential(auth, googleCredentialFor(email));
          return {
            uid: result.user.uid,
            email: result.user.email,
            providerIds: result.user.providerData.map(provider => provider.providerId),
          };
        };
        const win = window as unknown as {
          emulatorSignIn?: (email: string, legacyUnusedPassword?: string) => Promise<{ uid: string; email: string | null; providerIds: string[] }>;
          emulatorSignInGoogle?: (email: string) => Promise<{ uid: string; email: string | null; providerIds: string[] }>;
        };
        win.emulatorSignInGoogle = signInGoogle;
        // Keep the old helper name for fixtures while never authenticating through password.
        win.emulatorSignIn = email => signInGoogle(email);
      }
    }

    // Ref: #287 — App Check after services are ready, before returning
    await initializeAppCheckOnce(app, env);

    cachedServices = { app, auth, db };
    return cachedServices;
  })();

  initPromise = pending;
  initAttempt = attempt;
  void pending.then(
    () => {
      attempt.dispose();
      if (initAttempt === attempt) initAttempt = null;
    },
    () => {
      attempt.dispose();
      if (initPromise === pending) initPromise = null;
      if (initAttempt === attempt) initAttempt = null;
    },
  );
  return pending;
}

export const firebaseConfigState = getFirebaseConfigState(import.meta.env as FirebaseEnv);
export const isConfigured = firebaseConfigState.configured;
