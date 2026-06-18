/**
 * Ref: #321 — Firebase SDK lazy-loading module.
 * Dynamic import() defers the 349KB Firestore SDK and 125KB Auth SDK
 * until actually needed (after app shell renders). Combined with
 * manualChunks in vite.config.ts, this ensures the SDKs are in
 * separate chunks that load on demand, not at initial page load.
 */
let _authMod: typeof import('firebase/auth') | null = null;
let _fsMod: typeof import('firebase/firestore') | null = null;

export async function ensureFirebaseModulesLoaded() {
  if (!_authMod || !_fsMod) {
    [_authMod, _fsMod] = await Promise.all([
      import('firebase/auth'),
      import('firebase/firestore'),
    ]);
  }
}

export function getAuthMod() {
  if (!_authMod) throw new Error('Firebase Auth module not loaded');
  return _authMod;
}

export function getFirestoreMod() {
  if (!_fsMod) throw new Error('Firebase Firestore module not loaded');
  return _fsMod;
}
