import { describe, expect, it } from 'vitest';

/**
 * P16a write-surface guard (spec §9: the client writes only through a command transaction or the lease).
 * It reads the source text of every production module under `src/` and fails when a Firestore write API appears in a file
 * that is not on the allow-list. `src/maintenance/` is a Node CLI that writes over REST and never ships in the bundle, so
 * it is not scanned; the second test below makes sure nothing in the app imports it.
 */

/** The only production modules that may write to Firestore: command + projections in one transaction, and the lease. */
const WRITE_ALLOWLIST = ['firebase/activeAccountLease.ts', 'firebase/cloudCommandRepository.ts'];

const sources = import.meta.glob(
  [
    '../../**/*.{ts,tsx}',
    '!../../**/__tests__/**',
    '!../../**/*.{test,spec}.{ts,tsx}',
    '!../../test/**',
    '!../../maintenance/**',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

/** Glob keys are relative to this file (`src/firebase/__tests__`), so a file next to `firebase/` shows up as `../x.ts`. */
function relativeName(key: string): string {
  const parts = ['firebase', '__tests__'];
  for (const segment of key.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.') parts.push(segment);
  }
  return parts.join('/');
}

/** Comments often name the APIs they explain; only code counts. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

const WRITE_API = /\b(?:setDoc|updateDoc|deleteDoc|addDoc|writeBatch|runTransaction)\b|\b(?:tx|trx|transaction|batch)\.(?:set|update|delete)\s*\(/;

function usesWriteApi(text: string): boolean {
  return WRITE_API.test(stripComments(text));
}

const filesWithWrites = () => Object.entries(sources)
  .filter(([, text]) => usesWriteApi(text))
  .map(([key]) => relativeName(key))
  .sort();

describe('P16a client write surface', () => {
  it('scans the production sources and finds the two allowed writers, so the guard is not vacuous', () => {
    const names = Object.keys(sources).map(relativeName);
    expect(names.length).toBeGreaterThan(100);
    for (const allowed of WRITE_ALLOWLIST) expect(names, allowed).toContain(allowed);
    expect(names.some(name => name.includes('__tests__') || /\.(test|spec)\./.test(name) || name.startsWith('maintenance/'))).toBe(false);
  });

  it('recognises every write form and ignores comments', () => {
    for (const code of [
      'await setDoc(ref, data);', 'await updateDoc(ref, data);', 'await deleteDoc(ref);', 'await addDoc(col, data);',
      'const batch = writeBatch(db);', 'await runTransaction(db, async () => {});', 'tx.set(ref, data);', 'tx.update(ref, data);',
      'tx.delete(ref);', 'transaction.set (ref, data);', 'batch.update(ref, data);', 'const { doc, setDoc } = getFirestoreMod();',
    ]) expect(usesWriteApi(code), code).toBe(true);
    for (const code of [
      '// setDoc is not allowed here\nconst x = 1;', '/* tx.set(ref) */ const y = 2;', 'const reset = setDocumentTitle();',
      'map.set(key, value);', 'cache.delete(key);',
    ]) expect(usesWriteApi(code), code).toBe(false);
  });

  it('only the command repository and the lease write to Firestore', () => {
    expect(filesWithWrites()).toEqual(WRITE_ALLOWLIST);
  });

  it('no production module imports the Node maintenance CLI', () => {
    const importers = Object.entries(sources)
      .filter(([, text]) => /\bfrom\s+['"][^'"]*\/maintenance\//.test(text) || /\bimport\(\s*['"][^'"]*\/maintenance\//.test(text))
      .map(([key]) => relativeName(key));
    expect(importers).toEqual([]);
  });
});
