import { describe, expect, it } from 'vitest';
import {
  documentBytes, dailyUsage, indexEntryBytes, projectStorage, worstCaseWorkload, documentNameBytes, readAuthorizationCalls,
  type CostTable, type IndexConfig, type WorkloadLine,
} from '../capacityModel';

/**
 * P16d capacity model: every expected number below is worked out by hand from the official rules the model cites
 * (Firestore storage size: string = UTF-8 bytes + 1, name = collection and document ids + 16, document = name + field names +
 * values + 32, collection-scope index entry = name + parent name + field name + value + 32), on two operations, three
 * documents and one composite index.
 */
const table: CostTable = {
  schemaVersion: 1,
  operations: {
    // 6 client reads, 2 Rules read-authorization calls (1 deduped), 3 writes
    'command.Small': { reads: { fixed: 6, perUnit: 0 }, readAuthorization: { fixed: 2, perUnit: 0 }, readAuthorizationDeduped: { fixed: 1, perUnit: 0 }, writes: 3, deletes: 0 },
    // heavier command: 9 reads, 5 authorization (2 deduped), 4 writes
    'command.Big': { reads: { fixed: 9, perUnit: 0 }, readAuthorization: { fixed: 5, perUnit: 0 }, readAuthorizationDeduped: { fixed: 2, perUnit: 0 }, writes: 4, deletes: 0 },
    // a list that reads 1 + 2 per unit, authorised once per query (2 calls + 2 per extra page of 10 units)
    'load.List': { unit: 'item', reads: { fixed: 1, perUnit: 2 }, readAuthorization: { fixed: 2, perUnit: 0.2 }, readAuthorizationDeduped: { fixed: 2, perUnit: 0.2 }, writes: 0, deletes: 0 },
  },
  rules: {
    Small: { commitAccessCalls: 11, commitDistinctDocuments: 5, source: 'fixture' },
    Big: { commitAccessCalls: 19, commitDistinctDocuments: 7, source: 'fixture' },
  },
};

describe('P16d capacity model: daily usage', () => {
  const workload: WorkloadLine[] = [
    { operation: 'command.Small', perDay: 10 },
    { operation: 'command.Big', perDay: 2 },
    { operation: 'load.List', perDay: 3, units: 50 },
  ];

  it('adds client reads, read authorization and the Rules commit closure of every command, once per execution', () => {
    const usage = dailyUsage(table, workload);
    // Small: 10 × (6 + 2 + 11) = 190; Big: 2 × (9 + 5 + 19) = 66; List: 3 × (1 + 2×50 + 2 + 0.2×50) = 3 × 113 = 339
    expect(usage.reads.conservative).toBe(190 + 66 + 339);
    // deduped: Small 10 × (6 + 1 + 5) = 120; Big 2 × (9 + 2 + 7) = 36; List 3 × (101 + 12) = 339
    expect(usage.reads.deduped).toBe(120 + 36 + 339);
    expect(usage.writes).toBe(10 * 3 + 2 * 4);
    expect(usage.deletes).toBe(0);
    expect(usage.lines.map(line => [line.operation, line.reads])).toEqual([
      ['command.Small', 190], ['command.Big', 66], ['load.List', 339],
    ]);
  });

  it('rejects an operation or a command kind that the cost table does not know, instead of counting it as free', () => {
    expect(() => dailyUsage(table, [{ operation: 'command.Missing', perDay: 1 }])).toThrow(/command\.Missing/);
    const withoutRules: CostTable = { ...table, rules: {} };
    expect(() => dailyUsage(withoutRules, [{ operation: 'command.Small', perDay: 1 }])).toThrow(/Small/);
    expect(() => dailyUsage(table, [{ operation: 'load.List', perDay: 1 }])).toThrow(/units/);
  });

  it('worst case: every business command is the kind that costs the most reads, the other lines stay', () => {
    const worst = worstCaseWorkload(table, workload, ['command.Small', 'command.Big']);
    expect(worst).toEqual([
      { operation: 'command.Big', perDay: 12 },
      { operation: 'load.List', perDay: 3, units: 50 },
    ]);
    // Big costs 9 + 5 + 19 = 33 against Small 6 + 2 + 11 = 19
    expect(dailyUsage(table, worst).reads.conservative).toBe(12 * 33 + 339);
  });
});

describe('P16d capacity model: operations with their own Rules commit cost, and read authorization', () => {
  it('uses the operation\'s own Rules commit cost when it has one (a lease change is not a command kind)', () => {
    const leaseTable: CostTable = {
      schemaVersion: 1,
      operations: {
        'lease.acquire': { reads: { fixed: 2, perUnit: 0 }, readAuthorization: { fixed: 2, perUnit: 0 }, readAuthorizationDeduped: { fixed: 2, perUnit: 0 }, writes: 2, deletes: 0,
          rulesCommit: { commitAccessCalls: 6, commitDistinctDocuments: 3, source: 'fixture' } },
      },
      rules: {},
    };
    const usage = dailyUsage(leaseTable, [{ operation: 'lease.acquire', perDay: 4 }]);
    expect(usage.reads.conservative).toBe(4 * (2 + 2 + 6));
    expect(usage.reads.deduped).toBe(4 * (2 + 2 + 3));
    expect(usage.writes).toBe(8);
  });

  it('counts the Rules calls that authorize a read: none for the own operator document, 1 for the lease and the access events, 2 otherwise, once per request', () => {
    expect(readAuthorizationCalls([
      { form: 'tx-doc', key: 'commands/*' },        // currentHolder: operator + lease = 2
      { form: 'tx-doc', key: 'system/dataHead' },   // 2
      { form: 'tx-doc', key: 'operators/*' },       // signedGoogle only = 0
      { form: 'tx-doc', key: 'system/accessLease' }, // approvedOperator = 1
      { form: 'doc', key: 'days/*' },               // 2
      { form: 'listener-doc', key: 'system/accessLease' }, // 1
      { form: 'query', key: 'transactions' },       // one request, 2 however many documents it returns
      { form: 'query', key: 'accessEvents' },       // 1
    ])).toEqual({ documents: 2 + 2 + 0 + 1 + 2 + 1, queries: 2 + 1 });
  });
});

describe('P16d capacity model: storage', () => {
  // items/a1 name: (5 + 1) + (2 + 1) + 16 = 25
  const first = { path: 'items/a1', data: { title: 'ab', n: 1 } };
  const second = { path: 'items/a2', data: { title: 'xyz', n: 2, tags: ['p', 'q'] } };
  // a map and a reference-free sub-document: names include the parent for a nested collection
  const third = { path: 'items/a1/notes/n1', data: { body: 'é', meta: { ok: true, none: null } } };

  it('sizes a name, a string and a document', () => {
    expect(documentNameBytes('items/a1')).toBe(25);
    expect(documentNameBytes('items/a1/notes/n1')).toBe((5 + 1) + (2 + 1) + (5 + 1) + (2 + 1) + 16);
    // 25 + (title 6 + 'ab' 3) + (n 2 + 8) + 32 = 76
    expect(documentBytes(first.path, first.data)).toBe(76);
    // 25 + (title 6 + 'xyz' 4) + (n 2 + 8) + (tags 5 + (p 2 + q 2)) + 32 = 86
    expect(documentBytes(second.path, second.data)).toBe(86);
    // name 34; body 5 + 'é' (2 bytes + 1 = 3) = 8; meta: name 5 + map (ok 3 + 1, none 5 + 1, + 32 as a document) 42 = 47; + 32 = 34 + 8 + 47 + 32 = 121
    expect(documentBytes(third.path, third.data)).toBe(121);
  });

  it('sizes one collection-scope single-field index entry and one composite entry', () => {
    // title on items/a1: 25 + parent 16 (top level: the database root, counted conservatively) + 'title' 6 + 'ab' 3 + 32 = 82
    expect(indexEntryBytes({ path: first.path, fields: [{ name: 'title', value: 'ab' }], composite: false })).toBe(82);
    // composite (title, n): 25 + 16 + 3 + 8 + 32 = 84; field names are not part of a composite entry
    expect(indexEntryBytes({ path: first.path, fields: [{ name: 'title', value: 'ab' }, { name: 'n', value: 1 }], composite: true })).toBe(84);
    // a nested document names its parent document: items/a1 = 25
    expect(indexEntryBytes({ path: third.path, fields: [{ name: 'body', value: 'é' }], composite: false })).toBe(34 + 25 + 5 + 3 + 32);
  });

  const indexes: IndexConfig = {
    indexes: [{ collectionGroup: 'items', queryScope: 'COLLECTION', fields: [{ fieldPath: 'title', order: 'ASCENDING' }, { fieldPath: 'n', order: 'ASCENDING' }] }],
    fieldOverrides: [{ collectionGroup: 'items', fieldPath: 'n', indexes: [] }],
  };

  it('adds documents, the automatic single-field entries (two per field, one per array element, none for a disabled field) and the composite entries', () => {
    const projection = projectStorage([first, second, third], indexes);
    expect(projection.documentBytes).toBe(76 + 86 + 121);
    // items/a1: title asc + desc = 2 × 82 = 164 (n is disabled); the composite (title, n) = 84; the two __name__ entries 2 × (25 + 16 + 32) = 146
    // items/a2: name 25; title 'xyz': entry 25+16+6+4+32 = 83, ×2 = 166; tags array: whole value asc + desc, 2 × (25+16+5+4+32 = 82) = 164, plus one entry per element p, q: 2 × (25+16+5+2+32 = 80) = 160;
    //           composite 25+16+4+8+32 = 85; __name__ 146
    // items/a1/notes/n1: no override and no composite for 'notes'; every leaf field gets two entries:
    //   body 'é': 2 × (34+25+5+3+32 = 99) = 198; meta.ok ('meta.ok' = 8): 2 × (34+25+8+1+32 = 100) = 200; meta.none ('meta.none' = 10): 2 × (34+25+10+1+32 = 102) = 204; __name__ 2 × (34+25+32 = 91) = 182
    const first1 = 164 + 84 + 146;
    const second1 = 166 + 164 + 160 + 85 + 146;
    const third1 = 198 + 200 + 204 + 182;
    expect(projection.indexBytes).toBe(first1 + second1 + third1);
    expect(projection.totalBytes).toBe(76 + 86 + 121 + first1 + second1 + third1);
    expect(projection.byCollection.items).toEqual({ documents: 2, documentBytes: 76 + 86, indexBytes: first1 + second1 });
  });

  it('extrapolates the per-day bytes over days, with the average and the P95 of the sampled documents', () => {
    const projection = projectStorage([first, second, third], indexes);
    expect(projection.average('items', 100)).toBe(Math.round(((76 + first1() + 86 + second1()) / 2) * 100));
    function first1() { return 164 + 84 + 146; }
    function second1() { return 166 + 164 + 160 + 85 + 146; }
    // two samples: P95 is the larger one (nearest rank)
    expect(projection.p95('items', 100)).toBe((86 + second1()) * 100);
  });
});
