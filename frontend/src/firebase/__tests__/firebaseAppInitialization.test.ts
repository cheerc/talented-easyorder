import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const app = { name: '[DEFAULT]', options: { projectId: 'demo-easyorder' } };
  const auth = { name: 'auth' };
  const db = { name: 'db' };
  const memoryCache = { name: 'memory-cache' };
  return {
    app,
    auth,
    db,
    memoryCache,
    getApps: vi.fn(() => [] as unknown[]),
    getApp: vi.fn(() => app),
    initializeApp: vi.fn(() => app),
    ensureFirebaseModulesLoaded: vi.fn(async () => undefined),
    getAuth: vi.fn(() => auth),
    connectAuthEmulator: vi.fn(),
    initializeFirestore: vi.fn(() => db),
    getFirestore: vi.fn(() => db),
    memoryLocalCache: vi.fn(() => memoryCache),
    persistentLocalCache: vi.fn(() => ({ name: 'persistent-cache' })),
    persistentMultipleTabManager: vi.fn(() => ({ name: 'persistent-tabs' })),
    clearIndexedDbPersistence: vi.fn<() => Promise<void>>(async () => undefined),
    connectFirestoreEmulator: vi.fn(),
  };
});

vi.mock('firebase/app', () => ({
  getApp: mocks.getApp,
  getApps: mocks.getApps,
  initializeApp: mocks.initializeApp,
}));

vi.mock('../firebaseModules', () => ({
  ensureFirebaseModulesLoaded: mocks.ensureFirebaseModulesLoaded,
  getAuthMod: () => ({ getAuth: mocks.getAuth, connectAuthEmulator: mocks.connectAuthEmulator }),
  getFirestoreMod: () => ({
    initializeFirestore: mocks.initializeFirestore,
    getFirestore: mocks.getFirestore,
    memoryLocalCache: mocks.memoryLocalCache,
    persistentLocalCache: mocks.persistentLocalCache,
    persistentMultipleTabManager: mocks.persistentMultipleTabManager,
    clearIndexedDbPersistence: mocks.clearIndexedDbPersistence,
    connectFirestoreEmulator: mocks.connectFirestoreEmulator,
  }),
}));

const env = {
  MODE: 'production',
  VITE_FIREBASE_API_KEY: 'api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-easyorder.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-easyorder',
  VITE_FIREBASE_APP_ID: 'app-id',
  VITE_FIREBASE_MESSAGING_SENDER_ID: 'sender-id',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-easyorder.appspot.com',
};

async function loadFirebaseAppModule() {
  // The shared test setup mocks FirebaseProvider's import for most tests.
  // This file exercises the real initializer against explicit SDK mocks.
  vi.doUnmock('../firebaseApp');
  vi.resetModules();
  return import('../firebaseApp');
}

describe('ensureFirebaseInitialized storage boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApps.mockReset().mockReturnValue([]);
    mocks.getApp.mockReset().mockReturnValue(mocks.app);
    mocks.initializeApp.mockReset().mockReturnValue(mocks.app);
    mocks.ensureFirebaseModulesLoaded.mockReset().mockResolvedValue(undefined);
    mocks.getAuth.mockReset().mockReturnValue(mocks.auth);
    mocks.connectAuthEmulator.mockReset();
    mocks.initializeFirestore.mockReset().mockReturnValue(mocks.db);
    mocks.getFirestore.mockReset().mockReturnValue(mocks.db);
    mocks.memoryLocalCache.mockReset().mockReturnValue(mocks.memoryCache);
    mocks.persistentLocalCache.mockReset().mockReturnValue({ name: 'persistent-cache' });
    mocks.persistentMultipleTabManager.mockReset().mockReturnValue({ name: 'persistent-tabs' });
    mocks.clearIndexedDbPersistence.mockReset().mockResolvedValue(undefined);
    mocks.connectFirestoreEmulator.mockReset();
  });

  it('uses a memory-only cache and clears the legacy Firestore namespace before returning services', async () => {
    let releaseCleanup!: () => void;
    mocks.clearIndexedDbPersistence.mockImplementation(() => {
      indexedDB.deleteDatabase('firestore/[DEFAULT]/demo-easyorder/main');
      return new Promise<void>(resolve => { releaseCleanup = resolve; });
    });
    const { ensureFirebaseInitialized } = await loadFirebaseAppModule();

    let settled = false;
    const result = ensureFirebaseInitialized(env).then(services => {
      settled = true;
      return services;
    });

    await vi.waitFor(() => expect(mocks.clearIndexedDbPersistence).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    expect(mocks.initializeFirestore).toHaveBeenCalledWith(mocks.app, { localCache: mocks.memoryCache });
    expect(mocks.memoryLocalCache).toHaveBeenCalledOnce();
    expect(mocks.persistentLocalCache).not.toHaveBeenCalled();
    expect(mocks.persistentMultipleTabManager).not.toHaveBeenCalled();
    expect(mocks.clearIndexedDbPersistence).toHaveBeenCalledWith(mocks.db);

    releaseCleanup();
    await expect(result).resolves.toMatchObject({ app: mocks.app, auth: mocks.auth, db: mocks.db });
    expect(mocks.getFirestore).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent calls and exposes the same initialized services only after cleanup', async () => {
    let releaseCleanup!: () => void;
    mocks.clearIndexedDbPersistence.mockImplementation(() => {
      indexedDB.deleteDatabase('firestore/[DEFAULT]/demo-easyorder/main');
      return new Promise<void>(resolve => { releaseCleanup = resolve; });
    });
    const { ensureFirebaseInitialized } = await loadFirebaseAppModule();

    const first = ensureFirebaseInitialized(env);
    const second = ensureFirebaseInitialized(env);
    expect(first).toBe(second);
    await vi.waitFor(() => expect(mocks.clearIndexedDbPersistence).toHaveBeenCalledOnce());
    expect(mocks.initializeApp).toHaveBeenCalledOnce();
    expect(mocks.initializeFirestore).toHaveBeenCalledOnce();

    releaseCleanup();
    const [firstServices, secondServices] = await Promise.all([first, second]);
    expect(firstServices).toBe(secondServices);
  });

  it('notifies only live subscribers when a shared Firestore cleanup becomes blocked', async () => {
    const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    const request = new EventTarget() as unknown as IDBOpenDBRequest;
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: { deleteDatabase: vi.fn(() => request) } as unknown as IDBFactory,
    });

    let releaseCleanup!: () => void;
    mocks.clearIndexedDbPersistence.mockImplementation(() => new Promise<void>(resolve => { releaseCleanup = resolve; }));
    try {
      const { ensureFirebaseInitialized } = await loadFirebaseAppModule();
      const staleController = new AbortController();
      const staleSubscriber = vi.fn();
      const liveSubscriber = vi.fn();
      const first = ensureFirebaseInitialized(env, {
        onFirestoreCleanupBlocked: staleSubscriber,
        signal: staleController.signal,
      });
      staleController.abort();
      const second = ensureFirebaseInitialized(env, { onFirestoreCleanupBlocked: liveSubscriber });

      expect(second).toBe(first);
      await vi.waitFor(() => expect(mocks.clearIndexedDbPersistence).toHaveBeenCalledOnce());
      request.dispatchEvent(new Event('blocked'));

      expect(staleSubscriber).not.toHaveBeenCalled();
      expect(liveSubscriber).toHaveBeenCalledOnce();

      releaseCleanup();
      await Promise.all([first, second]);
      const afterSuccess = vi.fn();
      await ensureFirebaseInitialized(env, { onFirestoreCleanupBlocked: afterSuccess });
      expect(afterSuccess).not.toHaveBeenCalled();
    } finally {
      if (originalIndexedDb) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDb);
      else delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    }
  });

  it('replays an already observed blocked state only to a new subscriber in that pending attempt', async () => {
    const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    const request = new EventTarget() as unknown as IDBOpenDBRequest;
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: { deleteDatabase: vi.fn(() => request) } as unknown as IDBFactory,
    });

    let releaseCleanup!: () => void;
    mocks.clearIndexedDbPersistence.mockImplementation(() => new Promise<void>(resolve => { releaseCleanup = resolve; }));
    try {
      const { ensureFirebaseInitialized } = await loadFirebaseAppModule();
      const first = ensureFirebaseInitialized(env);
      await vi.waitFor(() => expect(mocks.clearIndexedDbPersistence).toHaveBeenCalledOnce());
      request.dispatchEvent(new Event('blocked'));

      const lateSubscriber = vi.fn();
      const second = ensureFirebaseInitialized(env, { onFirestoreCleanupBlocked: lateSubscriber });
      expect(second).toBe(first);
      expect(lateSubscriber).toHaveBeenCalledOnce();

      releaseCleanup();
      await Promise.all([first, second]);
      const retrySubscriber = vi.fn();
      await ensureFirebaseInitialized(env, { onFirestoreCleanupBlocked: retrySubscriber });
      expect(retrySubscriber).not.toHaveBeenCalled();
    } finally {
      if (originalIndexedDb) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDb);
      else delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    }
  });

  it('does not mark a rejected initialization ready and allows a clean explicit retry', async () => {
    const blocked = Object.assign(new Error('delete blocked'), { code: 'failed-precondition' });
    mocks.clearIndexedDbPersistence.mockRejectedValueOnce(blocked).mockResolvedValueOnce(undefined);
    const { ensureFirebaseInitialized } = await loadFirebaseAppModule();

    await expect(ensureFirebaseInitialized(env)).rejects.toThrow();
    const retriedServices = await ensureFirebaseInitialized(env);

    expect(retriedServices.db).toBe(mocks.db);
    expect(mocks.initializeFirestore).toHaveBeenCalledOnce();
    expect(mocks.memoryLocalCache).toHaveBeenCalledOnce();
    expect(mocks.clearIndexedDbPersistence).toHaveBeenCalledTimes(2);
    expect(mocks.getFirestore).not.toHaveBeenCalled();
  });

  it('fails closed when another Firestore settings instance already exists', async () => {
    mocks.initializeFirestore.mockImplementation(() => {
      throw Object.assign(new Error('already initialized with different options'), { code: 'failed-precondition' });
    });
    const { ensureFirebaseInitialized } = await loadFirebaseAppModule();

    await expect(ensureFirebaseInitialized(env)).rejects.toThrow('already initialized');
    expect(mocks.getFirestore).not.toHaveBeenCalled();
    expect(mocks.clearIndexedDbPersistence).not.toHaveBeenCalled();
  });

  it('does not initialize Firebase when formal configuration is incomplete', async () => {
    const { ensureFirebaseInitialized } = await loadFirebaseAppModule();

    await expect(ensureFirebaseInitialized({ MODE: 'production' })).rejects.toThrow('Missing Firebase env var');
    expect(mocks.getApps).not.toHaveBeenCalled();
    expect(mocks.initializeApp).not.toHaveBeenCalled();
    expect(mocks.initializeFirestore).not.toHaveBeenCalled();
  });
});
