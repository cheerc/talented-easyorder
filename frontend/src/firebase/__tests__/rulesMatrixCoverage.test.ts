// @ts-expect-error Node-only file access reads the Rules file that the matrix has to cover.
import { readFileSync } from 'node:fs';
// @ts-expect-error Node-only path access locates the Rules file.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_COMMAND_KINDS } from '../../domain/cloudCommands';
import { COLLECTION_MATRIX, KIND_MATRIX, MUTATIONS } from './rulesMatrix';

declare const process: { cwd: () => string };

/** Every `match` block of the real Rules below the documents root. */
function rulesMatches(): string[] {
  const rules = readFileSync(path.resolve(process.cwd(), '../firestore.rules'), 'utf8') as string;
  return [...rules.matchAll(/^\s*match (\/[^\s]+) \{/gm)].map(found => found[1]!).filter(pattern => !pattern.startsWith('/databases/'));
}

describe('P16b Rules matrix coverage (R6)', () => {
  it('defines the ten mutation classes M1 to M10, each with a title', () => {
    expect(MUTATIONS.map(item => item.id)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10']);
    for (const item of MUTATIONS) expect(item.title.length, item.id).toBeGreaterThan(0);
  });

  it('has an entry for every command kind and no entry for an unknown kind', () => {
    expect(ALL_COMMAND_KINDS).toHaveLength(27);
    expect(Object.keys(KIND_MATRIX).sort()).toEqual([...ALL_COMMAND_KINDS].sort());
  });

  it('names the scenario step of every kind and explains every mutation class that does not apply', () => {
    const known = new Set<string>(MUTATIONS.map(item => item.id));
    for (const kind of ALL_COMMAND_KINDS) {
      const entry = KIND_MATRIX[kind];
      expect(entry?.step ?? '', `${kind} step`).not.toBe('');
      for (const [id, reason] of Object.entries(entry?.notApplicable ?? {})) {
        expect(known.has(id), `${kind} ${id} is a known mutation`).toBe(true);
        expect((reason ?? '').length, `${kind} ${id} reason`).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it('covers every match block of firestore.rules in the collection matrix, and only those', () => {
    expect(COLLECTION_MATRIX.map(entry => entry.match).sort()).toEqual(rulesMatches().sort());
  });

  it('gives every collection entry a sample document and a reader class', () => {
    for (const entry of COLLECTION_MATRIX) {
      expect(entry.doc.length, entry.match).toBeGreaterThan(0);
      expect(['holder', 'approved', 'self', 'none'], entry.match).toContain(entry.readers);
    }
  });
});
