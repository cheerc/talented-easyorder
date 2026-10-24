// @ts-expect-error Node-only file access reads the index file, the recorded query shapes and the production sources.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { IndexConfig } from '../capacityModel';

/**
 * P16e index coverage. The Emulator does not check composite indexes, so a query that needs one fails only in production
 * ("requires an index"); and an index nothing uses only costs storage. This test closes both holes from the query shapes the
 * meter recorded while the production repositories ran on the real Rules (`docs/ops/p16-query-shapes.json`, checked equal to a
 * fresh recording by `cloudCapacity.spec.ts`):
 * - every shape that needs a composite index has one in `firestore.indexes.json`;
 * - every composite index is needed by some shape;
 * - the fields the queries filter or order on are never exempted from the automatic single-field indexes, and every other field
 *   of a `commands` or `transactions` document is (the documents of these two collections are what a day adds, so an index entry
 *   per field per document is the biggest part of what the two years of storage hold);
 * - a production query on a field this test has not seen fails the test, so adding one means recording its shape.
 */
declare const process: { cwd: () => string };

const root = `${process.cwd()}/..`;
const json = <T>(path: string) => JSON.parse(readFileSync(`${root}/${path}`, 'utf8') as string) as T;

interface Shape { collection: string; where: string[]; orderBy: string[]; operations: string[] }
const indexes = json<IndexConfig>('firestore.indexes.json');
const shapes = json<{ shapes: Shape[] }>('docs/ops/p16-query-shapes.json').shapes;
const footprints = json<{ fields: Record<string, string[]> }>('docs/ops/p16-storage-footprints.json');

const fieldOf = (text: string) => text.split(' ')[0]!;
const directionOf = (text: string) => (text.split(' ')[1] === 'desc' ? 'desc' : 'asc');
const NAME = '__name__';

interface Required { equality: string[]; tail: Array<{ name: string; direction: 'asc' | 'desc' }> }

/**
 * The composite index a shape needs, or null: the equality fields (any order), then the range field or the fields it orders by,
 * each in the direction the query orders it; the document name is implicit. A shape with no equality filter and at most one
 * ordered field is served by the single-field indexes.
 */
function requiredComposite(shape: Shape): Required | null {
  const equality = [...new Set(shape.where.filter(item => item.endsWith(' ==')).map(fieldOf).filter(name => name !== NAME))];
  const ranges = shape.where.filter(item => !item.endsWith(' ==')).map(fieldOf).filter(name => name !== NAME);
  const ordered = shape.orderBy.filter(item => fieldOf(item) !== NAME).map(item => ({ name: fieldOf(item), direction: directionOf(item) }));
  const wanted = ordered.length > 0 ? ordered : [...new Set(ranges)].map(name => ({ name, direction: 'asc' as const }));
  const tail = wanted.filter((item, index) => wanted.findIndex(other => other.name === item.name) === index && !equality.includes(item.name));
  if (tail.length === 0) return null;
  if (equality.length === 0 && tail.length <= 1) return null;
  return { equality, tail };
}

/** A composite covers a requirement when its first fields are the equality fields (any order) and the rest is the same sequence. */
function covers(fields: IndexField[], required: Required): boolean {
  if (fields.length !== required.equality.length + required.tail.length) return false;
  const head = fields.slice(0, required.equality.length);
  const rest = fields.slice(required.equality.length);
  return head.every(item => required.equality.includes(item.name))
    && rest.map(item => `${item.name} ${item.direction}`).join(',') === required.tail.map(item => `${item.name} ${item.direction}`).join(',');
}

interface IndexField { name: string; direction: 'asc' | 'desc' }
const composites = indexes.indexes.map(index => ({
  collection: index.collectionGroup,
  fields: index.fields.filter(field => field.fieldPath !== NAME)
    .map((field): IndexField => ({ name: field.fieldPath, direction: field.order === 'DESCENDING' ? 'desc' : 'asc' })),
}));

describe('P16e index coverage', () => {
  it('has a composite index for every recorded query that needs one', () => {
    const missing: string[] = [];
    for (const shape of shapes) {
      const required = requiredComposite(shape);
      if (!required) continue;
      const found = composites.some(index => index.collection === shape.collection.replace(/^.*\//, '') && covers(index.fields, required));
      if (!found) missing.push(`${shape.collection}: ${JSON.stringify(required)} (run by ${shape.operations.join(', ')})`);
    }
    expect(missing).toEqual([]);
  });

  it('has no composite index that no recorded query needs', () => {
    const unused = composites.filter(index => !shapes.some(shape => {
      const required = requiredComposite(shape);
      return required !== null && shape.collection.replace(/^.*\//, '') === index.collection && covers(index.fields, required);
    }));
    expect(unused.map(index => `${index.collection}: ${index.fields.map(field => `${field.name} ${field.direction}`).join(', ')}`)).toEqual([]);
  });

  it('records shapes for the queries the production repositories run (a recorded set that is missing an operation is not a coverage proof)', () => {
    const operations = new Set(shapes.flatMap(shape => shape.operations));
    for (const name of ['load.orders', 'load.report', 'load.accountHistory', 'load.auditDay', 'load.auditStudent', 'load.auditRange', 'load.accessEvents', 'load.reportClosedDay', 'load.backupExport', 'load.ledgerScan', 'load.dayVendors', 'load.students']) {
      expect(operations.has(name), name).toBe(true);
    }
  });

  const queried = new Set(shapes.flatMap(shape => [...shape.where, ...shape.orderBy].map(fieldOf)).filter(name => name !== NAME));
  const overrides = (indexes.fieldOverrides ?? []).filter(override => override.indexes.length === 0);
  const exempted = (collection: string) => new Set(overrides.filter(override => override.collectionGroup === collection).map(override => override.fieldPath));

  it('never exempts a field that a query filters or orders on', () => {
    const wrong = overrides.filter(override => queried.has(override.fieldPath)).map(override => `${override.collectionGroup}.${override.fieldPath}`);
    expect(wrong).toEqual([]);
  });

  it('exempts every field of a command and of a transaction that no query uses, so that a document adds the index entries of the queried fields only', () => {
    for (const collection of ['commands', 'transactions']) {
      const fields = footprints.fields[collection];
      expect(fields, `${collection} fields are in the footprints`).toBeDefined();
      const skipped = exempted(collection);
      const indexedWithoutQuery = fields!.filter(name => !queried.has(name) && !skipped.has(name));
      expect(indexedWithoutQuery, `${collection}: fields indexed although no query uses them`).toEqual([]);
    }
  });

  it('sees every field the production queries filter or order on in the recorded shapes', () => {
    const dir = `${root}/frontend/src/firebase`;
    const used = new Set<string>();
    for (const file of readdirSync(dir) as string[]) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file.endsWith('.spec.ts')) continue;
      const text = readFileSync(`${dir}/${file}`, 'utf8') as string;
      for (const found of text.matchAll(/\b(?:where|orderBy)\(\s*'([A-Za-z0-9_.]+)'/g)) used.add(found[1]!);
    }
    expect([...used].filter(name => !queried.has(name)).sort()).toEqual([]);
  });
});
