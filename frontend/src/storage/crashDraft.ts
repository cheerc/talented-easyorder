import type { PosTransactionDraft } from '../domain/posTransaction';

const DB_NAME = 'easyorder-crash-draft';
const STORE_NAME = 'drafts';
const DRAFT_KEY = 'current-draft';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveCrashDraft(draft: PosTransactionDraft): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(draft, DRAFT_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // IndexedDB unavailable — silently skip
  }
}

export async function loadCrashDraft(): Promise<PosTransactionDraft | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(DRAFT_KEY);
    const result = await new Promise<PosTransactionDraft | undefined>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result ?? null;
  } catch {
    return null;
  }
}

export function clearCrashDraft(): void {
  try {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onerror = () => { /* ignore */ };
  } catch {
    // IndexedDB unavailable — silently skip
  }
}

export async function isCrashDraftAvailable(): Promise<boolean> {
  try {
    if (typeof indexedDB === 'undefined' || indexedDB === undefined) return false;
    const draft = await loadCrashDraft();
    return draft !== null;
  } catch {
    return false;
  }
}
