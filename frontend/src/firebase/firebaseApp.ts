import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';

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
  auth: ReturnType<typeof getAuth>;
  db: Firestore;
}

let cachedServices: FirebaseServices | null = null;
let emulatorConnected = false;

function initializeFirestoreOnce(app: FirebaseApp): Firestore {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    return getFirestore(app);
  }
}

export function ensureFirebaseInitialized(env: FirebaseEnv = import.meta.env as FirebaseEnv): FirebaseServices {
  if (cachedServices) return cachedServices;

  const state = getFirebaseConfigState(env);
  if (!state.configured) {
    throw new Error(state.error);
  }

  const app = getApps().length > 0 ? getApp() : initializeApp(state.config);
  const auth = getAuth(app);
  const db = initializeFirestoreOnce(app);

  if (env.VITE_FIREBASE_USE_EMULATOR === 'true' && !emulatorConnected) {
    const host = env.VITE_FIRESTORE_EMULATOR_HOST ?? '127.0.0.1';
    const port = Number(env.VITE_FIRESTORE_EMULATOR_PORT ?? '8080');
    connectFirestoreEmulator(db, host, port);
    connectAuthEmulator(
      auth,
      env.VITE_FIREBASE_AUTH_EMULATOR_URL ?? 'http://127.0.0.1:9099',
      { disableWarnings: true },
    );
    emulatorConnected = true;
  }

  cachedServices = { app, auth, db };
  return cachedServices;
}

export const firebaseConfigState = getFirebaseConfigState(import.meta.env as FirebaseEnv);
export const isConfigured = firebaseConfigState.configured;
