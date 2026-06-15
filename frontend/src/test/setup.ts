import '@testing-library/jest-dom';

const localStorageMock = (function () {
  let store: Record<string, string> = {};
  return {
    getItem: function (key: string) {
      return store[key] || null;
    },
    setItem: function (key: string, value: string) {
      store[key] = value.toString();
    },
    removeItem: function (key: string) {
      delete store[key];
    },
    clear: function () {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Minimal IndexedDB mock for crash-draft tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

const fakeIndexedDB = {
  _databases: new Map<string, Map<string, unknown>>(),
  open(name: string): AnyObj {
    if (!fakeIndexedDB._databases.has(name)) {
      fakeIndexedDB._databases.set(name, new Map<string, unknown>());
    }
    const store = fakeIndexedDB._databases.get(name)!;
    const req: AnyObj = {
      result: undefined as AnyObj,
      onupgradeneeded: null as AnyObj,
      onsuccess: null as AnyObj,
      onerror: null as AnyObj,
      error: null,
    };
    req.result = {
      objectStoreNames: { contains: () => true } as AnyObj,
      createObjectStore: () => { /* noop */ },
      transaction: () => {
        const tx: AnyObj = {
          oncomplete: null as AnyObj,
          onerror: null as AnyObj,
          error: null,
        };
        tx.objectStore = () => ({
          put: (value: unknown, key: string) => {
            store.set(key, value);
            const putReq: AnyObj = { result: undefined, onsuccess: null, onerror: null };
            setTimeout(() => { putReq.onsuccess?.({ target: putReq } as AnyObj); }, 0);
            return putReq;
          },
          get: (key: string) => {
            const getReq: AnyObj = { result: store.get(key), onsuccess: null, onerror: null };
            setTimeout(() => { getReq.onsuccess?.({ target: getReq } as AnyObj); }, 0);
            return getReq;
          },
          delete: (key: string) => {
            store.delete(key);
            const delReq: AnyObj = { result: undefined, onsuccess: null, onerror: null };
            setTimeout(() => { delReq.onsuccess?.({ target: delReq } as AnyObj); }, 0);
            return delReq;
          },
        });
        setTimeout(() => { tx.oncomplete?.({ target: tx } as AnyObj); }, 0);
        return tx;
      },
      close: () => { /* noop */ },
    };
    setTimeout(() => { req.onsuccess?.({ target: req } as AnyObj); }, 0);
    return req;
  },
  deleteDatabase(name: string): AnyObj {
    fakeIndexedDB._databases.delete(name);
    const req: AnyObj = { onsuccess: null as AnyObj, onerror: null as AnyObj, onblocked: null as AnyObj, error: null };
    setTimeout(() => { req.onsuccess?.({ target: req } as AnyObj); }, 0);
    return req;
  },
};

Object.defineProperty(window, 'indexedDB', {
  value: fakeIndexedDB,
  writable: true,
  configurable: true,
});

import { vi } from 'vitest';

const mockServices = {
  auth: {
    currentUser: {
      uid: 'uid-counter',
      email: 'counter@talented.com.tw',
      displayName: 'Counter',
    },
  },
  db: {},
};

// Global mocks for Firebase initialization and Auth Gate in test environment
vi.mock('../firebase/firebaseApp', () => ({
  ensureFirebaseInitialized: () => Promise.resolve(mockServices),
  readFirebaseConfig: () => ({}),
  getFirebaseConfigState: () => ({ configured: false, error: 'Mocked config' }),
  isFirebaseConfigured: () => false,
  firebaseConfigState: { configured: false, error: 'Mocked config' },
  isConfigured: false,
}));

vi.mock('../firebase/authService', () => ({
  subscribeOperatorAccess: (
    _auth: unknown,
    _db: unknown,
    onAccess: (access: import('../firebase/authService').OperatorAccess) => void,
  ) => {
    // Immediately authorize the operator in test environment so integration tests pass
    onAccess({
      ok: true,
      profile: {
        uid: 'uid-counter',
        email: 'counter@talented.com.tw',
        displayName: 'Counter',
      },
      role: 'admin',
    });
    return () => {};
  },
  signInWithGoogle: vi.fn(),
  signOutOperator: vi.fn(),
}));

vi.mock('../firebase/firebaseModules', async () => {
  const [authMod, fsMod] = await Promise.all([
    import('firebase/auth'),
    import('firebase/firestore'),
  ]);
  return {
    ensureFirebaseModulesLoaded: vi.fn(),
    getAuthMod: () => authMod,
    getFirestoreMod: () => fsMod,
  };
});
