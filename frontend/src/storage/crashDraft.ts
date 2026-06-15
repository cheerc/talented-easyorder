import type { PosTransactionDraft } from '../domain/posTransaction';
import { emitError } from '../errors/errorBus';

/**
 * Crash Draft — same-origin IndexedDB persistence for in-progress POS transactions.
 *
 * Lifecycle:
 *   saveCrashDraft() — called on each transaction field change
 *   loadCrashDraft() — checked on app mount (crash recovery)
 *   clearCrashDraft() — called on successful transaction commit
 *
 * Stored in `easyorder-crash-draft` / drafts / current-draft (single draft only).
 * The draft includes studentId for recovery UX (pre-fills student selector).
 * Database is auto-deleted on commit; no data leaves the browser.
 */

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
  let db: IDBDatabase | null = null;
  try {
    db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(draft, DRAFT_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    emitError({ source: 'storage', message: 'crashDraft save failed' });
  } finally {
    db?.close();
  }
}

export async function loadCrashDraft(): Promise<PosTransactionDraft | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(DRAFT_KEY);
    const result = await new Promise<PosTransactionDraft | undefined>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return result ?? null;
  } catch {
    emitError({ source: 'storage', message: 'crashDraft load failed' });
    return null;
  } finally {
    db?.close();
  }
}

export function clearCrashDraft(): void {
  try {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onerror = () => { /* ignore */ };
  } catch {
    emitError({ source: 'storage', message: 'crashDraft delete failed' });
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
