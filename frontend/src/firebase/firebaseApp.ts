import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { ensureFirebaseModulesLoaded, getAuthMod, getFirestoreMod } from './firebaseModules';

export interface FirebaseEnv {
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
let emulatorConnected = false;
let appCheckInitialized = false;

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

function initializeFirestoreOnce(app: FirebaseApp): Firestore {
  const { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager } = getFirestoreMod();
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
}

export async function ensureFirebaseInitialized(env: FirebaseEnv = import.meta.env as FirebaseEnv): Promise<FirebaseServices> {
  if (cachedServices) return cachedServices;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const state = getFirebaseConfigState(env);
    if (!state.configured) {
      throw new Error(state.error);
    }

    await ensureFirebaseModulesLoaded();

    const app = getApps().length > 0 ? getApp() : initializeApp(state.config);
    const auth = getAuthMod().getAuth(app);
    const db = initializeFirestoreOnce(app);

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
        const win = window as unknown as { emulatorSignIn?: (email: string, pass: string) => unknown };
        win.emulatorSignIn = (email: string, pass: string) => {
          return getAuthMod().signInWithEmailAndPassword(auth, email, pass);
        };
      }
    }

    cachedServices = { app, auth, db };

    // Ref: #287 — App Check after services are ready, before returning
    await initializeAppCheckOnce(app, env);

    return cachedServices;
  })();

  return initPromise;
}

export const firebaseConfigState = getFirebaseConfigState(import.meta.env as FirebaseEnv);
export const isConfigured = firebaseConfigState.configured;
