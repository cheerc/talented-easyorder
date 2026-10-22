import { describe, expect, it, vi } from 'vitest';
vi.unmock('../firebaseApp');
import { getFirebaseConfigState, isFirebaseConfigured, readFirebaseConfig, readFirestoreEndpoint } from '../firebaseApp';

describe('readFirebaseConfig', () => {
  it('reads Vite Firebase env vars into a Firebase app config', () => {
    const config = readFirebaseConfig({
      VITE_FIREBASE_API_KEY: 'api-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'easyorder.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'talented-easyorder-prod',
      VITE_FIREBASE_APP_ID: 'app-id',
      VITE_FIREBASE_MESSAGING_SENDER_ID: 'sender',
      VITE_FIREBASE_STORAGE_BUCKET: 'talented-easyorder-prod.appspot.com',
    });

    expect(config).toEqual({
      apiKey: 'api-key',
      authDomain: 'easyorder.firebaseapp.com',
      projectId: 'talented-easyorder-prod',
      appId: 'app-id',
      messagingSenderId: 'sender',
      storageBucket: 'talented-easyorder-prod.appspot.com',
    });
  });

  it('fails fast when a required env var is missing', () => {
    expect(() => readFirebaseConfig({})).toThrow('Missing Firebase env var: VITE_FIREBASE_API_KEY');
  });

  it('exposes config state without initializing Firebase at module load', () => {
    expect(isFirebaseConfigured({})).toBe(false);
    expect(getFirebaseConfigState({})).toEqual({
      configured: false,
      error: 'Missing Firebase env var: VITE_FIREBASE_API_KEY',
    });
  });

  it('treats Firebase as not configured in prototype mode even with full env (M0 S-ENV)', () => {
    const fullEnv = {
      VITE_FIREBASE_API_KEY: 'api-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'easyorder.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'talented-easyorder-prod',
      VITE_FIREBASE_APP_ID: 'app-id',
      VITE_FIREBASE_MESSAGING_SENDER_ID: 'sender',
      VITE_FIREBASE_STORAGE_BUCKET: 'talented-easyorder-prod.appspot.com',
    };
    expect(isFirebaseConfigured({ ...fullEnv, MODE: 'development' })).toBe(true);
    expect(isFirebaseConfigured({ ...fullEnv, MODE: 'prototype' })).toBe(false);
    expect(getFirebaseConfigState({ ...fullEnv, MODE: 'prototype' })).toEqual({
      configured: false,
      error: '本機練習模式不連線 Firebase',
    });
  });

  it('config state is valid when no VITE_RECAPTCHA_SITE_KEY is set (#287)', () => {
    // App Check is opt-in — missing reCAPTCHA key should not affect config
    const state = getFirebaseConfigState({
      VITE_FIREBASE_API_KEY: 'key',
      VITE_FIREBASE_AUTH_DOMAIN: 'domain',
      VITE_FIREBASE_PROJECT_ID: 'proj',
      VITE_FIREBASE_APP_ID: 'app',
      VITE_FIREBASE_MESSAGING_SENDER_ID: 'sender',
      VITE_FIREBASE_STORAGE_BUCKET: 'bucket',
      // No VITE_RECAPTCHA_SITE_KEY
    });
    expect(state.configured).toBe(true);
  });
});

describe('readFirestoreEndpoint', () => {
  it('requires an explicit production HTTPS origin and explicit Emulator host and port', () => {
    expect(readFirestoreEndpoint({ VITE_FIRESTORE_ENDPOINT: 'https://firestore.googleapis.com' })).toEqual({
      kind: 'production', host: 'firestore.googleapis.com', identity: 'https://firestore.googleapis.com',
    });
    expect(readFirestoreEndpoint({
      VITE_FIREBASE_USE_EMULATOR: 'true', VITE_FIRESTORE_EMULATOR_HOST: '127.0.0.1', VITE_FIRESTORE_EMULATOR_PORT: '8080',
    })).toEqual({ kind: 'emulator', host: '127.0.0.1', port: 8080, identity: 'http://127.0.0.1:8080' });
    expect(() => readFirestoreEndpoint({})).toThrow('Missing Firebase env var: VITE_FIRESTORE_ENDPOINT');
    expect(() => readFirestoreEndpoint({ VITE_FIRESTORE_ENDPOINT: 'http://firestore.googleapis.com' })).toThrow(/HTTPS origin/);
    expect(() => readFirestoreEndpoint({ VITE_FIREBASE_USE_EMULATOR: 'true', VITE_FIRESTORE_EMULATOR_PORT: '8080' })).toThrow('Missing Firebase env var: VITE_FIRESTORE_EMULATOR_HOST');
  });
});
