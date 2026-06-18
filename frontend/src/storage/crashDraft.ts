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
 *
 * Ref: #312 — Drafts have a 24h TTL. On load, expired drafts are silently purged
 * to prevent stale PII from persisting indefinitely.
 */

const DB_NAME = 'easyorder-crash-draft';
const STORE_NAME = 'drafts';
const DRAFT_KEY = 'current-draft';
const DB_VERSION = 1;
/** Ref: #312 — Maximum age of a crash draft before it's considered expired (24 hours). */
export const CRASH_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

/** Internal envelope that wraps the draft with a timestamp for TTL enforcement. */
interface CrashDraftEnvelope {
  draft: PosTransactionDraft;
  savedAt: number;
}

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
    // Ref: #312 — Wrap draft with savedAt timestamp for TTL enforcement
    const envelope: CrashDraftEnvelope = { draft, savedAt: Date.now() };
    tx.objectStore(STORE_NAME).put(envelope, DRAFT_KEY);
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
    const result = await new Promise<CrashDraftEnvelope | PosTransactionDraft | undefined>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!result) return null;

    // Ref: #312 — Support both old (plain draft) and new (envelope) formats
    if ('savedAt' in result && 'draft' in result) {
      const envelope = result as CrashDraftEnvelope;
      if (Date.now() - envelope.savedAt > CRASH_DRAFT_TTL_MS) {
        // Expired — purge silently
        clearCrashDraft();
        return null;
      }
      return envelope.draft;
    }
    // Legacy format (pre-#312): treat as valid, no TTL check
    return result as PosTransactionDraft;
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
