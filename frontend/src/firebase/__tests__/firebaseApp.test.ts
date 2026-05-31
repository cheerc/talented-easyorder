import { describe, expect, it, vi } from 'vitest';
vi.unmock('../firebaseApp');
import { getFirebaseConfigState, isFirebaseConfigured, readFirebaseConfig } from '../firebaseApp';

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
});
