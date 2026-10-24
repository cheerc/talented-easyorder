/**
 * P16d capacity model: a pure function of a checked-in cost table (measured by `cloudCapacity.spec.ts`), a workload table and
 * sampled documents. It never talks to Firestore, which is why it lives in `maintenance/` (not part of the app bundle).
 *
 * Daily usage (plan R8, R10)
 * - Client reads are what the SDK bills: a document read (also when it does not exist) is 1, a query is max(1, documents),
 *   every `tx.get` of every attempt is 1. Writes are only the successful ones.
 * - Rules dependent reads: Firestore bills `get()`, `exists()` and `getAfter()` as reads, also when the request is refused
 *   (https://firebase.google.com/docs/firestore/security/rules-conditions, fetched 2026-10-24). The page says some access calls
 *   "may be cached" but not whether a repeated access to one document is billed once, so two figures are kept:
 *   `conservative` counts every access call as its own read (the no-cache graph of `docs/ops/p05-rules-budget.md`), `deduped`
 *   counts every distinct document once per request. The gate uses `conservative`.
 *
 * Storage (plan R12), from https://firebase.google.com/docs/firestore/storage-size (fetched 2026-10-24):
 * - string = UTF-8 bytes + 1; document name = every collection id and document id (string size each) + 16;
 *   integer, float, timestamp = 8; boolean, null = 1; array = sum of its values; map = sized like a document without its name
 *   (field names + values + 32, the page does not say whether the 32 applies to a map, so it is counted: the conservative reading);
 *   document = name + field names + field values + 32.
 * - collection-scope single-field entry = document name + parent document name + field name + value + 32;
 *   composite entry = document name + parent document name + the indexed values + 32.
 * Assumptions where the page is silent, all on the conservative side: a top-level document has a "parent document name" of 16
 * bytes (the database root); every field gets an ascending and a descending entry (an array: both for the whole value, plus
 * one entry per element); map leaves are indexed as dotted paths; every document also has ascending and descending `__name__`
 * entries of document name + parent + 32. `fieldOverrides` with no `indexes` remove a field and its sub-fields.
 */

export interface Linear {
  fixed: number;
  /** Added once per unit (documents, days, ...); the operation's `unit` says what a unit is. */
  perUnit: number;
}

export interface OperationCost {
  /** What `units` counts for a linear operation (omit for a fixed one). */
  unit?: string;
  /** Billed client reads: documents returned (a query at least 1), `tx.get`, `getDoc`, listener documents. */
  reads: Linear;
  /** Rules access calls that authorize those reads, every call counted (no cache). */
  readAuthorization: Linear;
  /** The same with every distinct document counted once per request. */
  readAuthorizationDeduped: Linear;
  /** Successful document writes and deletes. */
  writes: number;
  deletes: number;
  /** Rules access calls of this operation's commit (a lease change); command operations use `CostTable.rules[kind]` instead. */
  rulesCommit?: RulesKindCost;
  /** What the figures are made of (reads and writes by normalized document key), for the reader of the table; the model ignores it. */
  detail?: Record<string, unknown>;
}

export interface RulesKindCost {
  /** Rules access calls of the commit request, no cache (the p05 ledger, or the platform cap of 20 where p05 has no figure). */
  commitAccessCalls: number;
  /** Distinct documents those access calls touch. */
  commitDistinctDocuments: number;
  source: string;
}

export interface CostTable {
  schemaVersion: 1;
  operations: Record<string, OperationCost>;
  /** Per command kind, keyed by kind name (`CreateOrder`). */
  rules: Record<string, RulesKindCost>;
}

export interface WorkloadLine {
  /** `command.<Kind>` or `load.<name>` or any other key of `CostTable.operations`. */
  operation: string;
  perDay: number;
  /** Units of a linear operation (required when the operation has a `unit`). */
  units?: number;
}

export interface UsageLine {
  operation: string;
  perDay: number;
  reads: number;
  readsDeduped: number;
  writes: number;
  deletes: number;
}

export interface DailyUsage {
  reads: { conservative: number; deduped: number };
  writes: number;
  deletes: number;
  lines: UsageLine[];
}

const COMMAND_PREFIX = 'command.';

function linear(amount: Linear, units: number): number {
  return amount.fixed + amount.perUnit * units;
}

function perExecution(table: CostTable, line: WorkloadLine): { reads: number; readsDeduped: number; writes: number; deletes: number } {
  const cost = table.operations[line.operation];
  if (!cost) throw new Error(`capacity model: the cost table has no operation ${line.operation}`);
  if (cost.unit !== undefined && line.units === undefined) {
    throw new Error(`capacity model: ${line.operation} needs units (${cost.unit})`);
  }
  const units = line.units ?? 0;
  let reads = linear(cost.reads, units) + linear(cost.readAuthorization, units);
  let readsDeduped = linear(cost.reads, units) + linear(cost.readAuthorizationDeduped, units);
  let commit = cost.rulesCommit;
  if (!commit && line.operation.startsWith(COMMAND_PREFIX)) {
    const kind = line.operation.slice(COMMAND_PREFIX.length);
    commit = table.rules[kind];
    if (!commit) throw new Error(`capacity model: the cost table has no Rules cost for command kind ${kind}`);
  }
  if (commit) {
    reads += commit.commitAccessCalls;
    readsDeduped += commit.commitDistinctDocuments;
  }
  return { reads, readsDeduped, writes: cost.writes, deletes: cost.deletes };
}

/** Daily reads, writes and deletes of a workload: every line is (cost of one execution) × perDay. */
export function dailyUsage(table: CostTable, workload: WorkloadLine[]): DailyUsage {
  const lines: UsageLine[] = workload.map(line => {
    const one = perExecution(table, line);
    return {
      operation: line.operation,
      perDay: line.perDay,
      reads: one.reads * line.perDay,
      readsDeduped: one.readsDeduped * line.perDay,
      writes: one.writes * line.perDay,
      deletes: one.deletes * line.perDay,
    };
  });
  const sum = (pick: (line: UsageLine) => number) => lines.reduce((total, line) => total + pick(line), 0);
  return {
    reads: { conservative: sum(line => line.reads), deduped: sum(line => line.readsDeduped) },
    writes: sum(line => line.writes),
    deletes: sum(line => line.deletes),
    lines,
  };
}

/**
 * The worst-case workload of plan R10: every business command of the day is the command operation that costs the most
 * reads (client + Rules, conservative), the other lines (loads, leases, backups) stay as they are.
 * `businessOperations` names the command operations that make up the business day.
 */
export function worstCaseWorkload(table: CostTable, workload: WorkloadLine[], businessOperations: string[]): WorkloadLine[] {
  const isBusiness = (line: WorkloadLine) => businessOperations.includes(line.operation);
  const total = workload.filter(isBusiness).reduce((sum, line) => sum + line.perDay, 0);
  const worst = businessOperations
    .map(operation => ({ operation, reads: perExecution(table, { operation, perDay: 1 }).reads }))
    .reduce((best, candidate) => (candidate.reads > best.reads ? candidate : best));
  const first = workload.findIndex(isBusiness);
  const rest = workload.filter(line => !isBusiness(line));
  if (first < 0) return rest;
  return [...workload.slice(0, first).filter(line => !isBusiness(line)), { operation: worst.operation, perDay: total }, ...workload.slice(first).filter(line => !isBusiness(line))];
}

// ---- Rules read authorization ----------------------------------------------------------------------------------------------

export interface ReadEventLike {
  form: 'doc' | 'tx-doc' | 'query' | 'listener-doc';
  /** Normalized document key (`students/*`, `system/dataHead`) or, for a query, its collection. */
  key: string;
}

/**
 * Rules access calls that authorize one read request (a `get` or one query), no cache: `operators/{uid}` is readable by its own
 * user without any lookup (0), the lease document needs `approvedOperator` (1 `get` of the operator document), `accessEvents`
 * needs `approvedOperator` (1) and everything else needs `currentHolder` (the operator document and the lease: 2).
 * Each `tx.get`, `getDoc` and query is its own request; so is every counted listener snapshot (a conservative reading).
 */
export function readAuthorizationCost(key: string): number {
  if (key.startsWith('operators/')) return 0;
  if (key === 'system/accessLease') return 1;
  if (key === 'accessEvents' || key.startsWith('accessEvents/')) return 1;
  return 2;
}

/** The authorization calls of a list of reads, split into document reads (get, tx.get, listener) and queries. */
export function readAuthorizationCalls(events: ReadEventLike[]): { documents: number; queries: number } {
  let documents = 0;
  let queries = 0;
  for (const event of events) {
    const cost = readAuthorizationCost(event.key);
    if (event.form === 'query') queries += cost; else documents += cost;
  }
  return { documents, queries };
}

// ---- storage ---------------------------------------------------------------------------------------------------------

const encoder = new TextEncoder();

/** Firestore "string size": UTF-8 bytes + 1. */
export function stringBytes(text: string): number {
  return encoder.encode(text).length + 1;
}

/** Document name size: every collection id and document id (string size) + 16. */
export function documentNameBytes(path: string): number {
  return path.split('/').reduce((sum, segment) => sum + stringBytes(segment), 0) + 16;
}

function isTimestampLike(value: unknown): boolean {
  if (value instanceof Date) return true;
  if (typeof value !== 'object' || value === null) return false;
  if (typeof (value as { toMillis?: unknown }).toMillis === 'function') return true;
  const keys = Object.keys(value);
  return keys.length === 2 && keys.includes('seconds') && keys.includes('nanoseconds');
}

type Plain = Record<string, unknown>;

function isMap(value: unknown): value is Plain {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !isTimestampLike(value);
}

function mapBytes(value: Plain): number {
  return fieldsBytes(value) + 32;
}

function fieldsBytes(data: Plain): number {
  let sum = 0;
  for (const [name, value] of Object.entries(data)) {
    if (value === undefined) continue;
    sum += stringBytes(name) + valueBytes(value);
  }
  return sum;
}

export function valueBytes(value: unknown): number {
  if (value === null) return 1;
  if (typeof value === 'string') return stringBytes(value);
  if (typeof value === 'number' || typeof value === 'bigint') return 8;
  if (typeof value === 'boolean') return 1;
  if (isTimestampLike(value)) return 8;
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + valueBytes(item), 0);
  if (isMap(value)) return mapBytes(value);
  throw new Error(`capacity model: unsupported field value ${typeof value}`);
}

/** Document size: name + field names + field values + 32. */
export function documentBytes(path: string, data: Plain): number {
  return documentNameBytes(path) + fieldsBytes(data) + 32;
}

export interface IndexField { name: string; value: unknown }

/** One index entry. `composite` entries carry the values only; single-field entries carry the field name too. */
export function indexEntryBytes(entry: { path: string; fields: IndexField[]; composite: boolean }): number {
  const segments = entry.path.split('/');
  const parent = segments.length > 2 ? documentNameBytes(segments.slice(0, -2).join('/')) : 16;
  const values = entry.fields.reduce((sum, field) => sum + (entry.composite ? 0 : stringBytes(field.name)) + valueBytes(field.value), 0);
  return documentNameBytes(entry.path) + parent + values + 32;
}

export interface IndexConfig {
  indexes: Array<{
    collectionGroup: string;
    queryScope: string;
    fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }>;
  }>;
  fieldOverrides?: Array<{
    collectionGroup: string;
    fieldPath: string;
    indexes: Array<{ order?: string; arrayConfig?: string; queryScope?: string }>;
  }>;
}

export interface SampleDocument { path: string; data: Plain }

interface Leaf { name: string; value: unknown }

function leaves(data: Plain, prefix = ''): Leaf[] {
  const found: Leaf[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    const name = prefix ? `${prefix}.${key}` : key;
    if (isMap(value)) found.push(...leaves(value, name));
    else found.push({ name, value });
  }
  return found;
}

function lookup(data: Plain, fieldPath: string): { found: boolean; value?: unknown } {
  let current: unknown = data;
  for (const part of fieldPath.split('.')) {
    if (!isMap(current) || !(part in current) || current[part] === undefined) return { found: false };
    current = current[part];
  }
  return { found: true, value: current };
}

function collectionGroupOf(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 2]!;
}

export interface StorageProjection {
  documentBytes: number;
  indexBytes: number;
  totalBytes: number;
  byCollection: Record<string, { documents: number; documentBytes: number; indexBytes: number }>;
  /** Mean bytes per sampled document (document + its index entries) of a collection group × `count` documents. */
  average(collection: string, count: number): number;
  /** Nearest-rank 95th percentile of bytes per sampled document × `count`. */
  p95(collection: string, count: number): number;
}

function indexBytesOf(document: SampleDocument, config: IndexConfig): number {
  const group = collectionGroupOf(document.path);
  const overrides = (config.fieldOverrides ?? []).filter(override => override.collectionGroup === group);
  let total = 0;
  const entry = (fields: IndexField[], composite: boolean) => indexEntryBytes({ path: document.path, fields, composite });

  for (const leaf of leaves(document.data)) {
    const override = overrides.find(item => leaf.name === item.fieldPath || leaf.name.startsWith(`${item.fieldPath}.`));
    if (override) {
      // An override replaces the automatic indexes of the field with the ones it lists (none when the list is empty).
      for (const listed of override.indexes) {
        if (listed.arrayConfig === 'CONTAINS' && Array.isArray(leaf.value)) {
          for (const element of leaf.value) total += entry([{ name: leaf.name, value: element }], false);
        } else if (listed.order) {
          total += entry([leaf], false);
        }
      }
      continue;
    }
    total += 2 * entry([leaf], false);
    if (Array.isArray(leaf.value)) {
      for (const element of leaf.value) total += entry([{ name: leaf.name, value: element }], false);
    }
  }

  for (const composite of config.indexes) {
    if (composite.collectionGroup !== group) continue;
    const fields: IndexField[] = [];
    let complete = true;
    for (const field of composite.fields) {
      if (field.fieldPath === '__name__') continue;
      const found = lookup(document.data, field.fieldPath);
      if (!found.found) { complete = false; break; }
      fields.push({ name: field.fieldPath, value: found.value });
    }
    if (complete) total += entry(fields, true);
  }

  // The two `__name__` entries every document has (an assumption: the page does not list them).
  total += 2 * entry([], true);
  return total;
}

export function projectStorage(documents: SampleDocument[], config: IndexConfig): StorageProjection {
  const byCollection: StorageProjection['byCollection'] = {};
  const perDocument: Record<string, number[]> = {};
  let docTotal = 0;
  let indexTotal = 0;
  for (const document of documents) {
    const size = documentBytes(document.path, document.data);
    const index = indexBytesOf(document, config);
    const group = collectionGroupOf(document.path);
    const slot = byCollection[group] ?? (byCollection[group] = { documents: 0, documentBytes: 0, indexBytes: 0 });
    slot.documents += 1;
    slot.documentBytes += size;
    slot.indexBytes += index;
    (perDocument[group] ??= []).push(size + index);
    docTotal += size;
    indexTotal += index;
  }
  const samples = (collection: string): number[] => {
    const found = perDocument[collection];
    if (!found || found.length === 0) throw new Error(`capacity model: no sampled document in ${collection}`);
    return found;
  };
  return {
    documentBytes: docTotal,
    indexBytes: indexTotal,
    totalBytes: docTotal + indexTotal,
    byCollection,
    average(collection, count) {
      const found = samples(collection);
      return Math.round((found.reduce((sum, item) => sum + item, 0) / found.length) * count);
    },
    p95(collection, count) {
      const sorted = [...samples(collection)].sort((a, b) => a - b);
      const rank = Math.ceil(0.95 * sorted.length);
      return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]! * count;
    },
  };
}
