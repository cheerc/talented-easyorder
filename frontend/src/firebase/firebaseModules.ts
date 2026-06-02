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
