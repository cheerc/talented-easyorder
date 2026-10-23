// P12c R01/L07 acceptance through the production cloud pages and typed command repositories.
import { deleteApp, initializeApp } from 'firebase/app';
import { GoogleAuthProvider, connectAuthEmulator, signInWithCredential, signOut } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createCloudDayCloseRepository } from '../src/firebase/cloudDayCloseRepository';
import { createCloudDayVendorRepository } from '../src/firebase/cloudDayVendorRepository';
import { createCloudOrderRepository } from '../src/firebase/cloudOrderRepository';
import { createCloudPendingJournal, createMemoryCloudPendingJournalTestAdapter } from '../src/firebase/cloudPendingJournal';
import { createCloudStudentRepository } from '../src/firebase/cloudStudentRepository';
import { expect, test } from './fixtures';
import { createGoogleEmulatorUser, E2E_IDENTITIES } from './helpers/auth';
import { PROJECT, readAccessLease, removeDocument, seedAccessLease, upsertDocument } from './helpers/seed';

const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const STUDENT_ID = '8a120c32-4f9a-4d96-8a12-c12000000001';
const STUDENT_CODE = '901';
const SECOND_STUDENT_ID = '8a120c32-4f9a-4d96-8a12-c12000000003';
const SECOND_STUDENT_CODE = '903';
const SECOND_STUDENT_NAME = 'P12c第二帳戶';
const NANOS_STUDENT_ID = '8a120c32-4f9a-4d96-8a12-c12000000002';
const NANOS_STUDENT_CODE = '902';
const NANOS_STUDENT_NAME = 'P12c排序帳戶';
const ORIGINAL_NAME = 'P12c舊姓名';
const CURRENT_NAME = 'P12c新姓名';
const OLD_ALIAS = 'P12c舊別名';
const LEASE_VACANT = { holderUid: null, epoch: 0, updatedAt: new Date() };
const execFileAsync = promisify(execFile);

type AdminDocument = Record<string, unknown> & { id: string };
type AdminRawDocument = { name?: string; fields?: Record<string, unknown>; updateTime?: string };

function decodeAdminValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if ('stringValue' in raw) return raw.stringValue;
  if ('integerValue' in raw) return Number(raw.integerValue);
  if ('doubleValue' in raw) return raw.doubleValue;
  if ('booleanValue' in raw) return raw.booleanValue;
  if ('nullValue' in raw) return null;
  if ('timestampValue' in raw) return new Date(String(raw.timestampValue));
  if ('mapValue' in raw) {
    const fields = (raw.mapValue as { fields?: Record<string, unknown> } | undefined)?.fields ?? {};
    return decodeAdminFields(fields);
  }
  if ('arrayValue' in raw) {
    const values = (raw.arrayValue as { values?: unknown[] } | undefined)?.values ?? [];
    return values.map(decodeAdminValue);
  }
  return undefined;
}

function decodeAdminFields(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeAdminValue(value)]));
}

async function readRawAdminDocument(collection: string, id: string): Promise<AdminRawDocument | null> {
  const response = await fetch(`${FIRESTORE_EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents/${collection}/${encodeURIComponent(id)}`, {
    headers: { Authorization: 'Bearer owner' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Could not read raw Emulator ${collection}/${id}: ${await response.text()}`);
  return response.json() as Promise<AdminRawDocument>;
}

async function listAdminDocuments(collection: string): Promise<AdminDocument[]> {
  const documents: AdminDocument[] = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetch(`${FIRESTORE_EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents/${collection}?${params}`, {
      headers: { Authorization: 'Bearer owner' },
    });
    if (!response.ok) throw new Error(`Could not list Emulator ${collection}: ${await response.text()}`);
    const body = await response.json() as { documents?: AdminRawDocument[]; nextPageToken?: string };
    for (const document of body.documents ?? []) {
      const id = document.name?.split('/').at(-1);
      if (!id) throw new Error(`Emulator returned an invalid ${collection} document path`);
      documents.push({ id, ...decodeAdminFields(document.fields) });
    }
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
  return documents;
}

async function deleteAdminDocument(collection: string, id: string): Promise<void> {
  const response = await fetch(`${FIRESTORE_EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents/${collection}/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { Authorization: 'Bearer owner' },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Could not remove Emulator ${collection}/${id}: ${await response.text()}`);
  }
}

async function patchAdminTimestamp(collection: string, id: string, field: string, timestampValue: string): Promise<void> {
  const params = new URLSearchParams({ 'updateMask.fieldPaths': field });
  const response = await fetch(`${FIRESTORE_EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents/${collection}/${encodeURIComponent(id)}?${params}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: { [field]: { timestampValue } } }),
  });
  if (!response.ok) throw new Error(`Could not patch synthetic timestamp ${collection}/${id}.${field}: ${await response.text()}`);
}

async function restoreRawDocumentFields(collection: string, id: string, source: AdminRawDocument, fields: string[]): Promise<void> {
  const rawFields = source.fields ?? {};
  const restore: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field in rawFields)) throw new Error(`Original Emulator document ${collection}/${id} did not have ${field}`);
    restore[field] = rawFields[field];
  }
  const params = new URLSearchParams();
  for (const field of fields) params.append('updateMask.fieldPaths', field);
  const response = await fetch(`${FIRESTORE_EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents/${collection}/${encodeURIComponent(id)}?${params}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: restore }),
  });
  if (!response.ok) throw new Error(`Could not restore Emulator ${collection}/${id}: ${await response.text()}`);
}

function taipeiToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function shiftDate(day: string, offset: number): string {
  const value = new Date(`${day}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function ok<T extends { ok: boolean; receipt?: unknown; error?: { code: string; message: string } }>(result: T, operation: string): NonNullable<T['receipt']> {
  if (!result.ok || !result.receipt) throw new Error(`${operation} failed: ${result.error?.code ?? 'NO_RECEIPT'} ${result.error?.message ?? ''}`);
  return result.receipt;
}

async function deleteIfPresent(collection: string, id: string): Promise<void> {
  if (await readRawAdminDocument(collection, id)) await removeDocument(collection, id);
}

async function assertFixtureDayIsVacant(dayId: string): Promise<void> {
  const [day, settlements, backfill] = await Promise.all([
    readRawAdminDocument('days', dayId),
    listAdminDocuments(`days/${dayId}/settlements`),
    readRawAdminDocument('backfillDays', dayId),
  ]);
  if (day || settlements.length || backfill) throw new Error(`P12c Emulator fixture date ${dayId} is already in use`);
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(cell); cell = ''; }
    else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      if (row.some(value => value.length)) rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  row.push(cell.replace(/\r$/, ''));
  if (row.some(value => value.length)) rows.push(row);
  if (quoted) throw new Error('The exported CSV ended inside a quoted field');
  return rows;
}

function hasStudentTransactionsListenTarget(postData: string | null, studentId: string): boolean {
  if (!postData) return false;
  for (const [name, value] of new URLSearchParams(postData)) {
    if (!/^req\d+___data__$/.test(name)) continue;
    let rpc: { addTarget?: { query?: { structuredQuery?: { from?: Array<{ collectionId?: unknown }>; where?: unknown } } } };
    try {
      rpc = JSON.parse(value) as typeof rpc;
    } catch {
      continue;
    }
    const query = rpc.addTarget?.query?.structuredQuery;
    if (!query?.from?.some(source => source.collectionId === 'transactions')) continue;

    const hasStudentFilter = (where: unknown): boolean => {
      if (!where || typeof where !== 'object') return false;
      const filter = where as Record<string, unknown>;
      const fieldFilter = filter.fieldFilter;
      if (fieldFilter && typeof fieldFilter === 'object') {
        const condition = fieldFilter as Record<string, unknown>;
        const field = condition.field as Record<string, unknown> | undefined;
        const expected = condition.value as Record<string, unknown> | undefined;
        if (field?.fieldPath === 'studentId' && expected?.stringValue === studentId) return true;
      }
      const compositeFilter = filter.compositeFilter as { filters?: unknown[] } | undefined;
      return compositeFilter?.filters?.some(hasStudentFilter) ?? false;
    };

    if (hasStudentFilter(query.where)) return true;
  }
  return false;
}

function summarizeFirestoreListenBody(postData: string | null): Array<Record<string, unknown>> {
  if (!postData) return [];
  const summary: Array<Record<string, unknown>> = [];
  for (const [name, value] of new URLSearchParams(postData)) {
    if (!/^req\d+___data__$/.test(name)) continue;
    try {
      const rpc = JSON.parse(value) as Record<string, unknown>;
      const addTarget = rpc.addTarget as Record<string, unknown> | undefined;
      const removeTarget = rpc.removeTarget as Record<string, unknown> | undefined;
      if (addTarget) {
        const query = addTarget.query as Record<string, unknown> | undefined;
        const structuredQuery = query?.structuredQuery as Record<string, unknown> | undefined;
        const from = Array.isArray(structuredQuery?.from) ? structuredQuery.from : [];
        const collections = from.flatMap(source => {
          if (!source || typeof source !== 'object') return [];
          const collectionId = (source as Record<string, unknown>).collectionId;
          return typeof collectionId === 'string' ? [collectionId] : [];
        });
        const studentIds = new Set<string>();
        const visitFilter = (filter: unknown) => {
          if (!filter || typeof filter !== 'object') return;
          const record = filter as Record<string, unknown>;
          const fieldFilter = record.fieldFilter as Record<string, unknown> | undefined;
          const field = fieldFilter?.field as Record<string, unknown> | undefined;
          const valueObject = fieldFilter?.value as Record<string, unknown> | undefined;
          if (field?.fieldPath === 'studentId' && typeof valueObject?.stringValue === 'string') {
            studentIds.add(valueObject.stringValue);
          }
          const composite = record.compositeFilter as Record<string, unknown> | undefined;
          if (Array.isArray(composite?.filters)) composite.filters.forEach(visitFilter);
        };
        visitFilter(structuredQuery?.where);
        summary.push({
          operation: 'addTarget',
          targetId: addTarget.targetId,
          collections,
          studentIds: [...studentIds],
          documentTarget: addTarget.documents ?? null,
        });
      } else if (removeTarget) {
        summary.push({ operation: 'removeTarget', targetId: removeTarget.targetId });
      }
    } catch {
      summary.push({ operation: 'unparsed' });
    }
  }
  return summary;
}

function summarizeFirestoreListenUrl(url: string): Record<string, string | null> {
  const parsed = new URL(url);
  return {
    rid: parsed.searchParams.get('RID'),
    aid: parsed.searchParams.get('AID'),
    type: parsed.searchParams.get('TYPE'),
  };
}

function exportedTransactionIds(rows: string[][]): string[] {
  const header = rows[0] ?? [];
  const index = header.indexOf('source_transaction_ids');
  if (index < 0) throw new Error('The transaction CSV is missing source_transaction_ids');
  return rows.slice(1).flatMap(row => {
    const value = row[index];
    if (!value) throw new Error('A transaction CSV row is missing source transaction identity');
    const ids: unknown = JSON.parse(value);
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error('Invalid source_transaction_ids CSV value');
    return ids;
  });
}

test.describe('P12c cloud report and account history acceptance', () => {
  test.setTimeout(240_000);

  test.beforeEach(async () => {
    await seedAccessLease(LEASE_VACANT);
  });

  test('R01/L07: full F2 output and F5 open-history correction preserve the later cash settlement', async ({ authedPage: page }, testInfo) => {
    const runtimeDiagnostics: Array<Record<string, unknown>> = [];
    const diagnosticStartedAt = Date.now();
    let captureFirestoreNetwork = false;
    const recordDiagnostic = (event: string, detail: Record<string, unknown> = {}) => {
      if (runtimeDiagnostics.length >= 2_000) return;
      runtimeDiagnostics.push({ event, elapsedMs: Date.now() - diagnosticStartedAt, ...detail });
    };
    const isFirestoreListen = (url: string) => url.includes('/google.firestore.v1.Firestore/Listen/channel');
    page.on('request', request => {
      if (!captureFirestoreNetwork || !isFirestoreListen(request.url())) return;
      recordDiagnostic('listen-request', {
        method: request.method(),
        ...summarizeFirestoreListenUrl(request.url()),
        operations: summarizeFirestoreListenBody(request.postData()),
      });
    });
    page.on('response', response => {
      const request = response.request();
      if (!captureFirestoreNetwork || !isFirestoreListen(request.url())) return;
      recordDiagnostic('listen-response', {
        method: request.method(),
        ...summarizeFirestoreListenUrl(request.url()),
        status: response.status(),
        contentType: response.headers()['content-type'] ?? null,
      });
    });
    page.on('requestfinished', request => {
      if (!captureFirestoreNetwork || !isFirestoreListen(request.url())) return;
      recordDiagnostic('listen-request-finished', {
        method: request.method(), ...summarizeFirestoreListenUrl(request.url()),
      });
    });
    page.on('requestfailed', request => {
      if (!captureFirestoreNetwork || !isFirestoreListen(request.url())) return;
      recordDiagnostic('listen-request-failed', {
        method: request.method(),
        ...summarizeFirestoreListenUrl(request.url()),
        failure: request.failure()?.errorText ?? null,
      });
    });
    page.on('pageerror', error => {
      if (captureFirestoreNetwork) recordDiagnostic('page-error', { message: error.message });
    });
    const capturePageState = async (label: string) => {
      try {
        const state = await page.evaluate(() => {
          const account = document.querySelector('main[aria-label="雲端查帳"]');
          const pending = [...document.querySelectorAll('[role="region"]')]
            .find(region => region.getAttribute('aria-label') === '待核對命令');
          const ready = document.querySelector('[data-testid="account-history-ready"]');
          return {
            performanceNow: performance.now(),
            userAgent: navigator.userAgent,
            url: location.href,
            accountReadyText: ready?.textContent?.trim() ?? null,
            accountStatuses: account ? [...account.querySelectorAll('[role="status"]')]
              .map(element => element.textContent?.trim() ?? '') : [],
            pendingRecoveryText: pending?.textContent?.trim() ?? null,
            disabledAccountControls: account ? [...account.querySelectorAll('input, select, button')]
              .filter(element => element.hasAttribute('disabled'))
              .map(element => ({ tag: element.tagName, label: element.getAttribute('aria-label'), text: element.textContent?.trim() ?? '' })) : [],
          };
        });
        recordDiagnostic('page-state', { label, state });
      } catch (error) {
        recordDiagnostic('page-state-error', { label, message: error instanceof Error ? error.message : String(error) });
      }
    };
    const originalHeadRaw = await readRawAdminDocument('system', 'dataHead');
    const originalHead = originalHeadRaw ? decodeAdminFields(originalHeadRaw.fields) : null;
    if (!originalHeadRaw || !originalHead || typeof originalHead.seq !== 'number' || typeof originalHead.goLiveDate !== 'string') {
      throw new Error('The demo-easyorder Emulator dataHead is not initialized');
    }
    const originalEntries = new Set((await listAdminDocuments('postCloseEntries')).map(document => document.id));
    const transactionIds: string[] = [];
    const dayIds: string[] = [];
    const settlementRevisions = new Map<string, number[]>();
    let app: ReturnType<typeof initializeApp> | null = null;
    let signedIn = false;
    let fixtureReserved = false;

    try {
      const today = taipeiToday();
      const d1 = shiftDate(today, -2);
      const d2 = shiftDate(today, -1);
      const d3 = today;
      for (const dayId of [d1, d2, d3]) await assertFixtureDayIsVacant(dayId);
      if (await readRawAdminDocument('students', STUDENT_ID) || await readRawAdminDocument('studentCodes', STUDENT_CODE)
        || await readRawAdminDocument('students', SECOND_STUDENT_ID) || await readRawAdminDocument('studentCodes', SECOND_STUDENT_CODE)) {
        throw new Error('P12c R01/L07 fixture account ID or code is already in use');
      }
      fixtureReserved = true;
      dayIds.push(d1, d2, d3);
      settlementRevisions.set(d1, [1, 2, 3]);
      settlementRevisions.set(d3, [1]);
      await upsertDocument('system', 'dataHead', { goLiveDate: d1 });

      app = initializeApp({
        apiKey: 'dummy-api-key', authDomain: 'dummy-auth-domain', projectId: PROJECT,
        appId: 'dummy-app-id', messagingSenderId: '000000000000', storageBucket: 'dummy-bucket',
      }, `p12c-report-${randomUUID()}`);
      const { getAuth } = await import('firebase/auth');
      const auth = getAuth(app);
      connectAuthEmulator(auth, AUTH_EMULATOR, { disableWarnings: true });
      const googleIdentity = await createGoogleEmulatorUser(E2E_IDENTITIES.operatorA.email);
      await signInWithCredential(auth, GoogleAuthProvider.credential(googleIdentity.idToken));
      signedIn = true;
      const lease = await readAccessLease();
      if (lease.holderUid !== auth.currentUser?.uid) throw new Error('The command client and F2 browser do not share the active operator lease');
      const db = getFirestore(app);
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
      const options = {
        currentUser: () => auth.currentUser,
        pendingJournal: createCloudPendingJournal(db, createMemoryCloudPendingJournalTestAdapter()),
      };
      const students = createCloudStudentRepository(db, options);
      const days = createCloudDayVendorRepository(db, options);
      const closing = createCloudDayCloseRepository(db, options);
      const orders = createCloudOrderRepository(db, options);

      ok(await students.createStudent({
        commandId: randomUUID(), leaseEpoch: lease.epoch, studentId: STUDENT_ID, studentCode: STUDENT_CODE,
        displayName: ORIGINAL_NAME, aliases: [OLD_ALIAS],
        openingBalance: { amount: 1_000, asOfDate: d1, note: 'P12c synthetic opening' },
      }), 'CreateStudent');
      let currentStudent = (await students.list()).students.find(value => value.studentId === STUDENT_ID);
      if (!currentStudent) throw new Error('Created P12c synthetic account is missing from the repository list');

      const ensureAndOpen = async (dayId: string, openingCash: number, reason?: string) => {
        ok(await closing.ensureDay({ commandId: randomUUID(), leaseEpoch: lease.epoch, dayId }), `EnsureDay ${dayId}`);
        const state = await closing.read(dayId);
        ok(await days.setOpeningCash({
          commandId: randomUUID(), leaseEpoch: lease.epoch, dayId, expectedRevision: state.revision,
          openingCash, ...(reason ? { reason } : {}),
        }), `SetOpeningCash ${dayId}`);
        return closing.read(dayId);
      };
      const ensureBackfillAndOpen = async (dayId: string, openingCash: number) => {
        ok(await closing.ensureDay({ commandId: randomUUID(), leaseEpoch: lease.epoch, dayId }), `EnsureDay ${dayId}`);
        let state = await closing.read(dayId);
        ok(await closing.backfillOpening({
          commandId: randomUUID(), leaseEpoch: lease.epoch, dayId, expectedDayRevision: state.revision,
          openingCash, reason: `P12c synthetic opening ${dayId}`,
        }), `BackfillOpeningCash ${dayId}`);
        state = await closing.read(dayId);
        ok(await closing.startBackfill({ commandId: randomUUID(), leaseEpoch: lease.epoch, dayId,
          expectedDayRevision: state.revision, reason: `P12c synthetic backfill ${dayId}` }), `StartBackfill ${dayId}`);
        return closing.read(dayId);
      };
      const addOrder = async (
        dayId: string, dayRevision: number, studentRevision: number, mealPrice: number, paidAmount: number, note: string,
        studentId = STUDENT_ID,
      ) => {
        const transactionId = randomUUID();
        transactionIds.push(transactionId);
        ok(await orders.createOrder({
          commandId: randomUUID(), transactionId, leaseEpoch: lease.epoch, studentId, dayId,
          expectedStudentRevision: studentRevision, expectedDayRevision: dayRevision,
          mealKind: 'other', mealPrice, paidAmount, menuRevision: null, otherItemName: 'P12c合成餐', note,
        }), `CreateOrder ${dayId}`);
        return { transactionId, dayRevision: dayRevision + 1, studentRevision: studentRevision + 1 };
      };
      const addPayment = async (dayId: string, dayRevision: number, studentRevision: number, paidAmount: number, note: string) => {
        const transactionId = randomUUID();
        transactionIds.push(transactionId);
        ok(await orders.createPayment({
          commandId: randomUUID(), transactionId, leaseEpoch: lease.epoch, studentId: STUDENT_ID, dayId,
          expectedStudentRevision: studentRevision, expectedDayRevision: dayRevision, paidAmount, note,
        }), `CreatePayment ${dayId}`);
        return { transactionId, dayRevision: dayRevision + 1, studentRevision: studentRevision + 1 };
      };
      const closeExpected = async (dayId: string, align: boolean) => {
        const state = await closing.read(dayId);
        if (state.expectedCash === null) throw new Error(`Day ${dayId} has no expected cash to close`);
        ok(await closing.closeDay({
          commandId: randomUUID(), leaseEpoch: lease.epoch, dayId, expectedDayRevision: state.revision,
          expectedSettlementRevision: state.lastSettlementRevision, expectedCash: state.expectedCash,
          countedCash: state.expectedCash, note: `P12c synthetic close ${dayId}`,
          ...(align ? { alignWithDayId: null } : {}),
        }), `CloseDay ${dayId}`);
      };

      // D1 is closed, with an obsolete revision-1 adjustment and a current revision-3 adjustment.
      let d1State = await ensureBackfillAndOpen(d1, 1_000);
      const d1Revision = d1State.revision;
      const d1Order = await addOrder(d1, d1Revision, currentStudent.revision, 100, 50, 'closed backfill order');
      currentStudent = (await students.list()).students.find(value => value.studentId === STUDENT_ID);
      if (!currentStudent) throw new Error('P12c account missing before rename');
      ok(await students.editStudent({
        commandId: randomUUID(), leaseEpoch: lease.epoch, studentId: STUDENT_ID, expectedRevision: currentStudent.revision,
        displayName: CURRENT_NAME, aliases: [OLD_ALIAS, 'P12c新別名'],
      }), 'EditStudent');
      currentStudent = (await students.list()).students.find(value => value.studentId === STUDENT_ID);
      if (!currentStudent) throw new Error('Renamed P12c synthetic account disappeared');
      d1State = await closing.read(d1);
      await closeExpected(d1, true);
      d1State = await closing.read(d1);
      ok(await closing.recordPostCloseEntry({ commandId: randomUUID(), leaseEpoch: lease.epoch, dayId: d1,
        expectedDayRevision: d1State.revision, expectedSettlementRevision: d1State.lastSettlementRevision,
        direction: 'income', amount: 7, reason: 'P12c obsolete revision adjustment' }), 'RecordPostCloseEntry old');
      d1State = await closing.read(d1);
      ok(await closing.reopenDay({ commandId: randomUUID(), leaseEpoch: lease.epoch, dayId: d1,
        expectedDayRevision: d1State.revision, expectedSettlementRevision: d1State.lastSettlementRevision,
        reason: 'P12c synthetic settlement recalculation' }), 'ReopenDay D1');
      d1State = await closing.read(d1);
      await closeExpected(d1, true);
      d1State = await closing.read(d1);
      ok(await closing.recordPostCloseEntry({ commandId: randomUUID(), leaseEpoch: lease.epoch, dayId: d1,
        expectedDayRevision: d1State.revision, expectedSettlementRevision: d1State.lastSettlementRevision,
        direction: 'expense', amount: 3, reason: 'P12c current revision adjustment' }), 'RecordPostCloseEntry current');

      // D2 remains genuinely open and historical so F5 can correct its active account payment.
      currentStudent = (await students.list()).students.find(value => value.studentId === STUDENT_ID)!;
      const d2State = await ensureBackfillAndOpen(d2, (await closing.read(d1)).effectiveCash ?? 1_000);
      let d2Revision = d2State.revision;
      const d2Active = await addPayment(d2, d2Revision, currentStudent.revision, 80, 'P12c eligible historical payment');
      d2Revision = d2Active.dayRevision;
      currentStudent = (await students.list()).students.find(value => value.studentId === STUDENT_ID)!;
      const d2Voided = await addPayment(d2, d2Revision, currentStudent.revision, 30, 'P12c voided historical payment');
      d2Revision = d2Voided.dayRevision;
      const d2StateAfterTransactions = await closing.read(d2);
      currentStudent = (await students.list()).students.find(value => value.studentId === STUDENT_ID)!;
      ok(await orders.mutateTransaction({
        commandId: randomUUID(), leaseEpoch: lease.epoch, kind: 'VoidTransaction', transactionId: d2Voided.transactionId,
        studentId: STUDENT_ID, dayId: d2, expectedTransactionRevision: 1,
        expectedStudentRevision: currentStudent.revision, expectedDayRevision: d2StateAfterTransactions.revision,
        payload: { reason: 'P12c keep original voided row' },
      }), 'VoidTransaction D2');

      // D3 has 201 current-day meal orders and its own cash settlement.
      const latestClosedCash = (await closing.read(d1)).effectiveCash ?? 1_000;
      ok(await students.createStudent({
        commandId: randomUUID(), leaseEpoch: lease.epoch, studentId: SECOND_STUDENT_ID, studentCode: SECOND_STUDENT_CODE,
        displayName: SECOND_STUDENT_NAME, aliases: ['P12c第二別名'],
        openingBalance: { amount: 0, asOfDate: d1, note: 'P12c second synthetic account' },
      }), 'CreateStudent second account');
      const secondStudent = (await students.list()).students.find(value => value.studentId === SECOND_STUDENT_ID);
      if (!secondStudent) throw new Error('Created second P12c synthetic account is missing from the repository list');
      const d3State = await ensureAndOpen(d3, latestClosedCash, 'P12c current-day opening confirmation');
      let d3Revision = d3State.revision;
      currentStudent = (await students.list()).students.find(value => value.studentId === STUDENT_ID)!;
      for (let index = 0; index < 201; index += 1) {
        const created = await addOrder(d3, d3Revision, currentStudent.revision, 20, 0, `P12c high-volume row ${index + 1}`);
        d3Revision = created.dayRevision;
        currentStudent = { ...currentStudent, revision: created.studentRevision };
      }
      let secondStudentRevision = secondStudent.revision;
      for (let index = 0; index < 2; index += 1) {
        const created = await addOrder(d3, d3Revision, secondStudentRevision, 15, 0, `P12c second account row ${index + 1}`, SECOND_STUDENT_ID);
        d3Revision = created.dayRevision;
        secondStudentRevision = created.studentRevision;
      }
      await closeExpected(d3, false);

      const settlementCollection = `days/${d3}/settlements`;
      const originalSettlement = await readRawAdminDocument(settlementCollection, '1');
      if (!originalSettlement) throw new Error('The later-day D3 settlement was not persisted');
      const allAccountRowsExpected = 206;
      const selectedAccountRowsExpected = 204;

      // Authenticate a repository-backed command client as the active Google Emulator operator.
      expect(googleIdentity.localId).toBe(lease.holderUid);

      await page.getByRole('button', { name: '雲端報表' }).click();
      await expect(page.getByTestId('report-ready')).toBeVisible({ timeout: 30_000 });
      await page.getByLabel('日期範圍').selectOption('custom');
      await page.getByLabel('開始日期').fill(d1);
      await page.getByLabel('結束日期').fill(d3);
      await page.getByRole('button', { name: '查詢完整報表' }).click();
      await expect(page.getByTestId('report-ready')).toContainText(`${d1}–${d3}`, { timeout: 30_000 });
      await expect(page.locator('.cloud-report__pager')).toContainText(`全部 ${allAccountRowsExpected} 筆`);
      await expect(page.getByRole('row').filter({ hasText: 'P12c obsolete revision adjustment' })).toContainText('未計入有效現金');
      await expect(page.getByRole('row').filter({ hasText: 'P12c current revision adjustment' })).toContainText('計入有效現金');
      const daySummaryBeforeScope = await page.getByLabel('全日摘要合計').innerText();
      await expect(page.locator('.cloud-report__section').first().getByRole('row').filter({ hasText: d3 })).toContainText('203');

      await page.getByLabel('搜尋帳戶').fill('P12c第二別名');
      await page.getByRole('button', { name: `選取 ${SECOND_STUDENT_NAME}（${SECOND_STUDENT_CODE}）` }).click();
      await expect(page.getByTestId('report-ready')).toContainText(`帳戶 ${SECOND_STUDENT_ID}`, { timeout: 30_000 });
      await expect(page.locator('.cloud-report__pager')).toContainText('全部 2 筆');
      expect(await page.getByLabel('全日摘要合計').innerText()).toBe(daySummaryBeforeScope);
      await page.getByRole('button', { name: '清除帳戶範圍' }).click();
      await expect(page.getByTestId('report-ready')).toContainText('全部帳戶', { timeout: 30_000 });
      await expect(page.locator('.cloud-report__pager')).toContainText(`全部 ${allAccountRowsExpected} 筆`);

      await page.getByLabel('搜尋帳戶').fill(OLD_ALIAS);
      await page.getByRole('button', { name: `選取 ${CURRENT_NAME}（${STUDENT_CODE}）` }).click();
      await expect(page.getByTestId('report-ready')).toContainText(`帳戶 ${STUDENT_ID}`, { timeout: 30_000 });
      await expect(page.getByText(`目前明細範圍：${CURRENT_NAME}（${STUDENT_CODE}）`)).toBeVisible();
      expect(await page.getByLabel('全日摘要合計').innerText()).toBe(daySummaryBeforeScope);
      await expect(page.locator('.cloud-report__pager')).toContainText(`全部 ${selectedAccountRowsExpected} 筆`);
      const reportReady = await page.getByTestId('report-ready').innerText();
      const sourceSeq = Number(reportReady.match(/H=(\d+)/)?.[1]);
      expect(Number.isSafeInteger(sourceSeq)).toBe(true);

      const detailRows = page.locator('section[aria-labelledby="cloud-report-detail-heading"] tbody tr');
      const collectUiIds = async (): Promise<{ ids: string[]; rowCount: number }> => {
        const ids: string[] = [];
        let rowCount = 0;
        const pager = page.locator('.cloud-report__pager');
        while (true) {
          const cells = await detailRows.locator('td:first-child').allTextContents();
          rowCount += cells.length;
          ids.push(...cells.flatMap(value => value.split(' · ').map(id => id.trim()).filter(Boolean)));
          const next = pager.getByRole('button', { name: '下一頁' });
          if (await next.isDisabled()) break;
          const before = await pager.innerText();
          await next.click();
          await expect(pager).not.toHaveText(before);
        }
        return { ids, rowCount };
      };
      const outputManifest: Record<string, unknown> = {
        scenario: 'P12c R01 actual body portal original and merged print output for all-account and selected-account scopes',
        fixtureAccountCount: 2,
        allAccountRowsExpected,
        selectedScope: { studentId: STUDENT_ID, studentCode: STUDENT_CODE, displayName: CURRENT_NAME },
        range: { startDate: d1, endDate: d3 },
        sourceSeq,
        daySummaryBeforeScope,
        outputs: [],
      };
      const generatedOutputs: Array<Record<string, unknown>> = [];

      let currentScopeId: string | null = STUDENT_ID;
      const printScopes = [
        { name: 'all', studentId: null as string | null, expectedRows: allAccountRowsExpected },
        { name: 'selected', studentId: STUDENT_ID, expectedRows: selectedAccountRowsExpected },
      ];
      for (const printScope of printScopes) {
        if (currentScopeId !== printScope.studentId) {
          if (printScope.studentId === null) {
            await page.getByRole('button', { name: '清除帳戶範圍' }).click();
            await expect(page.getByTestId('report-ready')).toContainText('全部帳戶', { timeout: 30_000 });
          } else {
            await page.getByLabel('搜尋帳戶').fill(OLD_ALIAS);
            await page.getByRole('button', { name: `選取 ${CURRENT_NAME}（${STUDENT_CODE}）` }).click();
            await expect(page.getByTestId('report-ready')).toContainText(`帳戶 ${STUDENT_ID}`, { timeout: 30_000 });
          }
          currentScopeId = printScope.studentId;
        }
        for (const mode of ['original', 'merged'] as const) {
          await page.getByLabel('交易呈現方式').selectOption(mode);
          const { ids: uiIds, rowCount: uiRowCount } = await collectUiIds();
          expect(uiIds).toHaveLength(printScope.expectedRows);
          expect(new Set(uiIds).size).toBe(printScope.expectedRows);
          const reportBeforeExport = await page.getByTestId('report-ready').innerText();
          const exportSourceSeq = Number(reportBeforeExport.match(/H=(\d+)/)?.[1]);
          expect(Number.isSafeInteger(exportSourceSeq)).toBe(true);
          const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.getByRole('button', { name: mode === 'original' ? '匯出原始交易 CSV' : '匯出合併交易 CSV' }).click(),
          ]);
          const csvPath = testInfo.outputPath(`p12c-${printScope.name}-${mode}-transactions.csv`);
          await download.saveAs(csvPath);
          const csv = await readFile(csvPath, 'utf8');
          const csvRows = parseCsv(csv);
          expect(csvRows[0]).toContain('source_seq');
          const csvIds = exportedTransactionIds(csvRows);
          expect(csvIds).toHaveLength(printScope.expectedRows);
          expect(csvIds).toEqual(uiIds);
          const exportCommand = (await listAdminDocuments('commands')).find(command => {
            const payload = command.payload as Record<string, unknown>;
            const scope = payload.scope as Record<string, unknown>;
            return command.kind === 'RecordExport'
              && payload.exportType === `transactions-${mode}`
              && scope.studentId === printScope.studentId;
          });
          if (!exportCommand) throw new Error(`No committed ${printScope.name} ${mode} RecordExport command was found`);
          expect(exportCommand.payload).toMatchObject({
            exportType: `transactions-${mode}`, dateRange: { start: d1, end: d3 },
            scope: { studentId: printScope.studentId }, sourceSeq: exportSourceSeq,
          });

          const printType = mode === 'original' ? 'ledger-original' : 'ledger-merged';
          const reportBeforePrint = await page.getByTestId('report-ready').innerText();
          const printSourceSeq = Number(reportBeforePrint.match(/H=(\d+)/)?.[1]);
          expect(Number.isSafeInteger(printSourceSeq)).toBe(true);
          await page.emulateMedia({ media: 'print' });
          await page.evaluate(() => {
            const target = window as Window & {
              __p12cPrintCapture?: {
                count: number; rows: number; text: string; ids: string[];
                display: string; visibility: string; parentIsBody: boolean; sourceSeq: number | null;
              } | null;
            };
            target.__p12cPrintCapture = null;
            window.print = () => {
              const content = document.querySelector('[aria-label="本次固定列印內容"]') as HTMLElement | null;
              const ids = Array.from(content?.querySelectorAll('tbody tr') ?? [], row => row.querySelector('td')?.textContent ?? '')
                .flatMap(value => value.split(' · ').map(id => id.trim()).filter(Boolean));
              const style = content ? getComputedStyle(content) : null;
              target.__p12cPrintCapture = {
                count: 1,
                rows: content?.querySelectorAll('tbody tr').length ?? 0,
                text: content?.textContent ?? '',
                ids,
                display: style?.display ?? 'missing',
                visibility: style?.visibility ?? 'missing',
                parentIsBody: content?.parentElement === document.body,
                sourceSeq: Number(content?.textContent?.match(/H=(\d+)/)?.[1]) || null,
              };
            };
          });
          await page.getByRole('button', { name: '記錄後列印目前完整明細' }).click();
          await expect.poll(async () => page.evaluate(() => (window as Window & {
            __p12cPrintCapture?: { count: number } | null;
          }).__p12cPrintCapture?.count ?? 0), { timeout: 15_000 }).toBe(1);
          const printCapture = await page.evaluate(() => (window as Window & {
            __p12cPrintCapture?: {
              count: number; rows: number; text: string; ids: string[];
              display: string; visibility: string; parentIsBody: boolean; sourceSeq: number | null;
            } | null;
          }).__p12cPrintCapture ?? null);
          expect(printCapture?.count).toBe(1);
          expect(printCapture?.rows).toBe(uiRowCount);
          expect(printCapture?.text).toContain(`完整資料列數：${uiRowCount}`);
          expect(printCapture?.text).toContain(`H=${printSourceSeq}`);
          expect(printCapture?.sourceSeq).toBe(printSourceSeq);
          expect(printCapture?.text).toContain(`帳戶：${printScope.studentId ?? '全部帳戶'}`);
          expect(printCapture?.ids).toEqual(csvIds);
          expect(printCapture?.display).toBe('block');
          expect(printCapture?.visibility).toBe('visible');
          expect(printCapture?.parentIsBody).toBe(true);
          const productSurface = page.locator('body > article.cloud-report__print[aria-label="本次固定列印內容"]');
          await expect(productSurface).toBeVisible();
          await expect(productSurface.locator('tbody tr')).toHaveCount(uiRowCount);

          const pdfPath = testInfo.outputPath(`p12c-${printScope.name}-${mode}-ledger.pdf`);
          await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
          const { stdout: pdfInfo } = await execFileAsync('pdfinfo', [pdfPath], { encoding: 'utf8' });
          const pageCount = Number(pdfInfo.match(/^Pages:\s+(\d+)/m)?.[1]);
          expect(pageCount).toBeGreaterThan(1);
          const { stdout: pdfText } = await execFileAsync('pdftotext', ['-raw', pdfPath, '-'], { encoding: 'utf8' });
          const textPath = testInfo.outputPath(`p12c-${printScope.name}-${mode}-ledger.txt`);
          await writeFile(textPath, pdfText, 'utf8');
          const normalizedPdfText = pdfText
            .replace(/交易識別\s+營業日\s+帳戶\s+姓名快照\s+類型\s+金額\s+餘額\s+來源序號/g, '')
            .replace(/\s+/g, '');
          expect(normalizedPdfText).toContain(`範圍：${d1}–${d3}`);
          expect(normalizedPdfText).toContain(`帳戶：${printScope.studentId ?? '全部帳戶'}`);
          expect(normalizedPdfText).toContain(`H=${printSourceSeq}`);
          if (printScope.studentId === null) {
            expect(normalizedPdfText).toContain(SECOND_STUDENT_ID);
            expect(normalizedPdfText).toContain(SECOND_STUDENT_NAME);
          } else {
            expect(normalizedPdfText).not.toContain(SECOND_STUDENT_ID);
            expect(normalizedPdfText).not.toContain(SECOND_STUDENT_NAME);
          }
          const pdfPositions = csvIds.map(id => normalizedPdfText.indexOf(id));
          expect(pdfPositions.every(position => position >= 0)).toBe(true);
          expect(pdfPositions).toEqual([...pdfPositions].sort((left, right) => left - right));

          const committedPrint = (await listAdminDocuments('commands')).find(command => {
            const payload = command.payload as Record<string, unknown>;
            const scope = payload.scope as Record<string, unknown>;
            return command.kind === 'RecordPrint'
              && payload.printType === printType
              && scope.studentId === printScope.studentId;
          });
          if (!committedPrint) throw new Error(`No committed ${printScope.name} ${printType} command was found after browser print`);
          expect(committedPrint.payload).toMatchObject({
            printType, businessDate: d1, dateRange: { start: d1, end: d3 },
            scope: { studentId: printScope.studentId }, sourceSeq: printSourceSeq,
          });

          await page.evaluate(() => { window.dispatchEvent(new Event('afterprint')); });
          await expect(page.locator('[aria-label="本次固定列印內容"]')).toHaveCount(0);
          await page.emulateMedia({ media: 'screen' });
          const jsonPath = testInfo.outputPath(`p12c-${printScope.name}-${mode}-ledger-evidence.json`);
          const evidence = {
            mode, scope: { studentId: printScope.studentId }, uiRowCount, sourceTransactionCount: csvIds.length,
            range: { startDate: d1, endDate: d3 }, sourceSeq: printSourceSeq, exportSourceSeq,
            actualPortal: { directBodyChild: printCapture?.parentIsBody, display: printCapture?.display, visibility: printCapture?.visibility },
            csvPath, csvSha256: createHash('sha256').update(csv).digest('hex'),
            pdfPath, pdfSha256: createHash('sha256').update(await readFile(pdfPath)).digest('hex'),
            pdfPages: pageCount, pdfInfo, textPath,
            exportedTransactionIds: csvIds,
            firstTransactionId: csvIds[0], lastTransactionId: csvIds.at(-1),
            recordExportCommand: exportCommand, recordPrintCommand: committedPrint,
          };
          await writeFile(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
          for (const [name, path, contentType] of [
            [`${printScope.name}-${mode}-csv`, csvPath, 'text/csv'],
            [`${printScope.name}-${mode}-pdf`, pdfPath, 'application/pdf'],
            [`${printScope.name}-${mode}-text`, textPath, 'text/plain'],
            [`${printScope.name}-${mode}-evidence`, jsonPath, 'application/json'],
          ] as const) await testInfo.attach(`p12c-${name}`, { path, contentType });
          generatedOutputs.push(evidence);
        }
      }

      for (const scopeId of [null, STUDENT_ID]) {
        const outputIds = generatedOutputs
          .filter(output => (output.scope as { studentId: string | null }).studentId === scopeId)
          .map(output => output.exportedTransactionIds as string[]);
        expect(outputIds).toHaveLength(2);
        expect(outputIds[0]).toEqual(outputIds[1]);
      }
      outputManifest.outputs = generatedOutputs;
      const manifestPath = testInfo.outputPath('p12c-report-output-manifest.json');
      await writeFile(manifestPath, `${JSON.stringify(outputManifest, null, 2)}\n`, 'utf8');
      await testInfo.attach('p12c-report-output-manifest', { path: manifestPath, contentType: 'application/json' });

      // Ensure that records with the old name and aliases still resolve to this one stable account.
      await page.getByRole('button', { name: `開啟查帳：${CURRENT_NAME}` }).click();
      await expect(page.getByTestId('account-history-ready')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(`目前編號 ${STUDENT_CODE}`)).toBeVisible();
      const transactionSection = page.locator('section[aria-labelledby="account-transactions-heading"]');
      const transactionRows = transactionSection.locator('tbody tr');
      await expect.poll(() => transactionRows.count()).toBe(selectedAccountRowsExpected);
      const closedDayRow = transactionSection.getByRole('row').filter({ hasText: d1Order.transactionId });
      await expect(closedDayRow).toContainText('有效 · 回填');
      await expect(closedDayRow).toContainText(ORIGINAL_NAME);

      const accountBalanceCell = page.locator('.cloud-account-history__balance div').filter({ hasText: '目前帳戶餘額' }).locator('dd');
      const balanceBeforeText = await accountBalanceCell.innerText();
      const balanceBefore = Number(balanceBeforeText.replace(/[^\d-]/g, ''));
      const laterSettlementBefore = await readRawAdminDocument(settlementCollection, '1');
      expect(JSON.stringify(laterSettlementBefore)).toBe(JSON.stringify(originalSettlement));

      await expect(closedDayRow.getByRole('button', { name: '更正' })).toHaveCount(0);
      const currentDayRow = transactionSection.getByRole('row').filter({ hasText: d3 });
      await expect(currentDayRow.getByRole('button', { name: '更正' })).toHaveCount(0);
      const activeHistoricalRow = transactionSection.getByRole('row').filter({ hasText: d2Active.transactionId });
      const headBeforeCorrection = Number((await page.getByTestId('account-history-ready').innerText()).match(/H=(\d+)/)?.[1]);
      expect(Number.isSafeInteger(headBeforeCorrection)).toBe(true);
      const exactNextHead = headBeforeCorrection + 1;
      expect(Number.isSafeInteger(exactNextHead)).toBe(true);

      // Hold the post-receipt F5 transaction query at the Emulator route so this acceptance
      // crosses the historical 5-second poll boundary before the fresh server read is released.
      const listenRoute = '**/google.firestore.v1.Firestore/Listen/channel**';
      let releaseReadGate!: () => void;
      let notifyReadHeld!: () => void;
      let notifyReadRouteFinished!: () => void;
      const readGate = new Promise<void>(resolve => { releaseReadGate = resolve; });
      const readHeld = new Promise<void>(resolve => { notifyReadHeld = resolve; });
      const readRouteFinished = new Promise<void>(resolve => { notifyReadRouteFinished = resolve; });
      let readIsHeld = false;
      let gateIsReleased = false;
      let routeIsInstalled = false;
      await page.route(listenRoute, async route => {
        if (!readIsHeld && hasStudentTransactionsListenTarget(route.request().postData(), STUDENT_ID)) {
          readIsHeld = true;
          recordDiagnostic('listen-route-held', {
            ...summarizeFirestoreListenUrl(route.request().url()),
            operations: summarizeFirestoreListenBody(route.request().postData()),
          });
          const freshReadResponse = await route.fetch();
          recordDiagnostic('listen-route-fetch-complete', {
            status: freshReadResponse.status(),
            contentType: freshReadResponse.headers()['content-type'] ?? null,
          });
          notifyReadHeld();
          try {
            await readGate;
            recordDiagnostic('listen-route-fulfill-start');
            await route.fulfill({ response: freshReadResponse });
            recordDiagnostic('listen-route-fulfill-complete');
          } finally {
            recordDiagnostic('listen-route-handler-finished');
            notifyReadRouteFinished();
          }
          return;
        }
        await route.continue();
      });
      routeIsInstalled = true;
      const releaseFreshRead = async () => {
        if (!gateIsReleased) {
          gateIsReleased = true;
          releaseReadGate();
        }
        if (readIsHeld) await readRouteFinished;
      };

      try {
        captureFirestoreNetwork = true;
        await capturePageState('before-correction');
        await activeHistoricalRow.getByRole('button', { name: '更正' }).click();
        await page.getByLabel('更正收款金額').fill('105');
        await page.getByLabel('更正理由').fill('P12c L07 historical correction');
        await page.getByRole('button', { name: '確認送出' }).click();
        await expect(page.getByText(/更正收據已確認/)).toBeVisible({ timeout: 20_000 });
        await capturePageState('receipt-confirmed');
        await readHeld;
        await capturePageState('student-transaction-listen-held');
        const exactHeadReady = expect(page.getByTestId('account-history-ready'))
          .toContainText(new RegExp(`H=${exactNextHead}$`), { timeout: 30_000 });
        void exactHeadReady.catch(() => undefined);
        const holdStartedAt = await page.evaluate(() => performance.now());
        await page.waitForFunction(startedAt => performance.now() - startedAt > 5_500, holdStartedAt, { timeout: 10_000 });
        const holdDurationMs = await page.evaluate(startedAt => performance.now() - startedAt, holdStartedAt);
        expect(holdDurationMs).toBeGreaterThan(5_500);
        await releaseFreshRead();
        recordDiagnostic('fresh-read-route-released', { holdDurationMs });
        await capturePageState('after-route-release');
        try {
          await exactHeadReady;
          recordDiagnostic('exact-head-ready', { result: 'passed' });
        } catch (error) {
          recordDiagnostic('exact-head-ready', { result: 'failed', message: error instanceof Error ? error.message : String(error) });
          await capturePageState('exact-head-timeout');
          throw error;
        }
        const balanceAfterExpected = balanceBefore + 25;
        const expectedBalanceText = `$${new Intl.NumberFormat('zh-TW').format(balanceAfterExpected)}`;
        await expect(accountBalanceCell).toHaveText(expectedBalanceText, { timeout: 30_000 });
        const laterSettlementAfter = await readRawAdminDocument(settlementCollection, '1');
        expect(JSON.stringify(laterSettlementAfter)).toBe(JSON.stringify(laterSettlementBefore));
        await expect(activeHistoricalRow).toContainText('105');
      } finally {
        await releaseFreshRead();
        if (routeIsInstalled) {
          await page.unroute(listenRoute);
          routeIsInstalled = false;
        }
      }
    } finally {
      captureFirestoreNetwork = false;
      await capturePageState('before-fixture-cleanup');
      const diagnosticPath = testInfo.outputPath('p13b2a-p12c-l07-runtime-diagnostics.json');
      await writeFile(diagnosticPath, `${JSON.stringify({ head: process.env.GITHUB_SHA ?? null, events: runtimeDiagnostics }, null, 2)}\n`, 'utf8');
      await testInfo.attach('p13b2a-p12c-l07-runtime-diagnostics', { path: diagnosticPath, contentType: 'application/json' });
      if (fixtureReserved) {
        // Test-only Emulator cleanup; the application writes above all used typed command repositories.
        for (const command of await listAdminDocuments('commands')) {
          if (typeof command.seq === 'number' && command.seq > Number(originalHead.seq)) {
            await deleteAdminDocument('commands', command.id);
          }
        }
        for (const transactionId of transactionIds) await deleteAdminDocument('transactions', transactionId);
        for (const dayId of dayIds) {
          await deleteAdminDocument('backfillDays', dayId);
          await deleteAdminDocument('days', dayId);
          for (const revision of settlementRevisions.get(dayId) ?? []) {
            await deleteAdminDocument(`days/${dayId}/settlements`, String(revision));
          }
        }
        for (const entry of await listAdminDocuments('postCloseEntries')) {
          if (!originalEntries.has(entry.id)) await deleteAdminDocument('postCloseEntries', entry.id);
        }
        await deleteIfPresent('students', STUDENT_ID);
        await deleteIfPresent('studentCodes', STUDENT_CODE);
        await deleteIfPresent('students', SECOND_STUDENT_ID);
        await deleteIfPresent('studentCodes', SECOND_STUDENT_CODE);
        await restoreRawDocumentFields('system', 'dataHead', originalHeadRaw, ['seq', 'lastCommandId', 'goLiveDate', 'updatedAt']);
      }
      if (signedIn && app) await signOut((await import('firebase/auth')).getAuth(app));
      if (app) await deleteApp(app);
    }
  });

  test('P13b2b3c F5: a held CorrectTransaction is confirmed through Lite, reloads once and is never resent', async ({ authedPage: page }) => {
    const originalHeadRaw = await readRawAdminDocument('system', 'dataHead');
    const originalHead = originalHeadRaw ? decodeAdminFields(originalHeadRaw.fields) : null;
    if (!originalHeadRaw || !originalHead || typeof originalHead.seq !== 'number' || typeof originalHead.goLiveDate !== 'string') {
      throw new Error('The demo-easyorder Emulator dataHead is not initialized');
    }
    const originalEntries = new Set((await listAdminDocuments('postCloseEntries')).map(document => document.id));
    const today = taipeiToday();
    const d2 = shiftDate(today, -1);
    const transactionIds: string[] = [];
    const dayIds = [d2, today];
    let app: ReturnType<typeof initializeApp> | null = null;
    let signedIn = false;
    let fixtureReserved = false;
    const held = {
      matched: 0, returned: false, armed: false,
      intercepted: Promise.withResolvers<void>(), release: Promise.withResolvers<void>(), completed: Promise.withResolvers<void>(),
    };
    const holdRoute = '**/documents:commit*';
    const writesDataHead = (request: import('@playwright/test').Request) => {
      try {
        const body = request.postDataJSON() as { writes?: Array<{ update?: { name?: string } }> };
        return body.writes?.some(write => (write.update?.name ?? '').endsWith('/documents/system/dataHead')) ?? false;
      } catch { return false; }
    };
    const journalIds = () => page.evaluate(() => Object.keys(localStorage)
      .filter(key => key.startsWith('easyorder-cloud-command-journal:v1:demo-easyorder:'))
      .map(key => (JSON.parse(localStorage.getItem(key) ?? 'null') as { commandId?: string } | null)?.commandId ?? ''));

    try {
      for (const dayId of dayIds) await assertFixtureDayIsVacant(dayId);
      if (await readRawAdminDocument('students', STUDENT_ID) || await readRawAdminDocument('studentCodes', STUDENT_CODE)) {
        throw new Error('P13b2b3c F5 fixture account ID or code is already in use');
      }
      fixtureReserved = true;
      await upsertDocument('system', 'dataHead', { goLiveDate: d2 });

      app = initializeApp({
        apiKey: 'dummy-api-key', authDomain: 'dummy-auth-domain', projectId: PROJECT,
        appId: 'dummy-app-id', messagingSenderId: '000000000000', storageBucket: 'dummy-bucket',
      }, `p13b2b3c-f5-${randomUUID()}`);
      const { getAuth } = await import('firebase/auth');
      const auth = getAuth(app);
      connectAuthEmulator(auth, AUTH_EMULATOR, { disableWarnings: true });
      const googleIdentity = await createGoogleEmulatorUser(E2E_IDENTITIES.operatorA.email);
      await signInWithCredential(auth, GoogleAuthProvider.credential(googleIdentity.idToken));
      signedIn = true;
      const lease = await readAccessLease();
      if (lease.holderUid !== auth.currentUser?.uid) throw new Error('The command client and F5 browser do not share the active operator lease');
      const db = getFirestore(app);
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
      const options = {
        currentUser: () => auth.currentUser,
        pendingJournal: createCloudPendingJournal(db, createMemoryCloudPendingJournalTestAdapter()),
      };
      const students = createCloudStudentRepository(db, options);
      const days = createCloudDayVendorRepository(db, options);
      const closing = createCloudDayCloseRepository(db, options);
      const orders = createCloudOrderRepository(db, options);

      ok(await students.createStudent({
        commandId: randomUUID(), leaseEpoch: lease.epoch, studentId: STUDENT_ID, studentCode: STUDENT_CODE,
        displayName: CURRENT_NAME, aliases: [], openingBalance: { amount: 1_000, asOfDate: d2, note: 'P13b2b3c synthetic opening' },
      }), 'CreateStudent');
      ok(await closing.ensureDay({ commandId: randomUUID(), leaseEpoch: lease.epoch, dayId: d2 }), 'EnsureDay D2');
      let d2State = await closing.read(d2);
      ok(await closing.backfillOpening({
        commandId: randomUUID(), leaseEpoch: lease.epoch, dayId: d2, expectedDayRevision: d2State.revision,
        openingCash: 1_000, reason: 'P13b2b3c synthetic opening D2',
      }), 'BackfillOpeningCash D2');
      d2State = await closing.read(d2);
      ok(await closing.startBackfill({
        commandId: randomUUID(), leaseEpoch: lease.epoch, dayId: d2, expectedDayRevision: d2State.revision,
        reason: 'P13b2b3c synthetic backfill D2',
      }), 'StartBackfill D2');
      d2State = await closing.read(d2);
      ok(await closing.ensureDay({ commandId: randomUUID(), leaseEpoch: lease.epoch, dayId: today }), 'EnsureDay today');
      const todayState = await closing.read(today);
      ok(await days.setOpeningCash({
        commandId: randomUUID(), leaseEpoch: lease.epoch, dayId: today, expectedRevision: todayState.revision,
        openingCash: 1_000, reason: 'P13b2b3c current-day opening confirmation',
      }), 'SetOpeningCash today');
      const student = (await students.list()).students.find(value => value.studentId === STUDENT_ID);
      if (!student) throw new Error('Created P13b2b3c synthetic account is missing from the repository list');
      const transactionId = randomUUID();
      transactionIds.push(transactionId);
      ok(await orders.createPayment({
        commandId: randomUUID(), transactionId, leaseEpoch: lease.epoch, studentId: STUDENT_ID, dayId: d2,
        expectedStudentRevision: student.revision, expectedDayRevision: d2State.revision, paidAmount: 80,
        note: 'P13b2b3c eligible historical payment',
      }), 'CreatePayment D2');

      await page.route(holdRoute, async route => {
        if (!held.armed || route.request().method() !== 'POST' || !writesDataHead(route.request())) {
          await route.continue();
          return;
        }
        held.matched += 1;
        if (held.matched !== 1) {
          await route.continue();
          return;
        }
        const response = await route.fetch({ timeout: 30_000 });
        held.intercepted.resolve();
        await held.release.promise;
        await route.fulfill({ response });
        held.returned = true;
        held.completed.resolve();
      });

      await page.getByRole('button', { name: '雲端報表' }).click();
      await expect(page.getByTestId('report-ready')).toBeVisible({ timeout: 30_000 });
      await page.getByLabel('日期範圍').selectOption('custom');
      await page.getByLabel('開始日期').fill(d2);
      await page.getByLabel('結束日期').fill(today);
      await page.getByRole('button', { name: '查詢完整報表' }).click();
      await expect(page.getByTestId('report-ready')).toContainText(`${d2}–${today}`, { timeout: 30_000 });
      await page.getByLabel('搜尋帳戶').fill(STUDENT_CODE);
      await page.getByRole('button', { name: `選取 ${CURRENT_NAME}（${STUDENT_CODE}）` }).click();
      await page.getByRole('button', { name: `開啟查帳：${CURRENT_NAME}` }).click();
      await expect(page.getByTestId('account-history-ready')).toBeVisible({ timeout: 30_000 });
      const readyHead = async () => Number((await page.getByTestId('account-history-ready').innerText()).match(/H=(\d+)/)?.[1]);
      const headBefore = await readyHead();

      const row = page.locator('section[aria-labelledby="account-transactions-heading"]').getByRole('row').filter({ hasText: transactionId });
      await row.getByRole('button', { name: '更正' }).click();
      await page.getByLabel('更正收款金額').fill('105');
      await page.getByLabel('更正理由').fill('P13b2b3c held correction');
      held.armed = true;
      await page.getByRole('button', { name: '確認送出' }).click();
      await Promise.race([
        held.intercepted.promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('CorrectTransaction commit was never intercepted')), 30_000)),
      ]);
      await expect(page.getByText('結果確認中，勿重新收款')).toBeVisible({ timeout: 15_000 });
      const recovery = page.getByRole('region', { name: '歷史更正命令恢復' });
      const correctionId = (await recovery.textContent())?.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1];
      if (!correctionId) throw new Error('The pending correction command ID was not shown');
      expect(await journalIds()).toEqual([correctionId]);

      await page.getByRole('button', { name: '查詢原命令結果' }).click();
      await expect(page.getByTestId('account-history-ready')).toContainText(new RegExp(`H=${headBefore + 1}$`), { timeout: 30_000 });
      await expect(page.getByRole('region', { name: '歷史更正命令恢復' })).toHaveCount(0);
      await expect.poll(journalIds).toEqual([]);
      expect(held.returned).toBe(false);
      expect(held.matched).toBe(1);
      expect(await readyHead()).toBe(headBefore + 1);
      expect((await readRawAdminDocument('commands', correctionId))?.fields).toBeTruthy();

      held.release.resolve();
      await Promise.race([held.completed.promise, new Promise(resolve => setTimeout(resolve, 10_000))]);
      await page.waitForTimeout(500);
      expect(held.matched).toBe(1);
      expect(await readyHead()).toBe(headBefore + 1);
      expect(await journalIds()).toEqual([]);
      expect(decodeAdminFields((await readRawAdminDocument('system', 'dataHead'))?.fields).seq).toBe(headBefore + 1);
    } finally {
      held.release.resolve();
      await page.unroute(holdRoute).catch(() => undefined);
      if (fixtureReserved) {
        for (const command of await listAdminDocuments('commands')) {
          if (typeof command.seq === 'number' && command.seq > Number(originalHead.seq)) {
            await deleteAdminDocument('commands', command.id);
          }
        }
        for (const transactionId of transactionIds) await deleteAdminDocument('transactions', transactionId);
        for (const dayId of dayIds) {
          await deleteAdminDocument('backfillDays', dayId);
          await deleteAdminDocument('days', dayId);
        }
        for (const entry of await listAdminDocuments('postCloseEntries')) {
          if (!originalEntries.has(entry.id)) await deleteAdminDocument('postCloseEntries', entry.id);
        }
        await deleteIfPresent('students', STUDENT_ID);
        await deleteIfPresent('studentCodes', STUDENT_CODE);
        await restoreRawDocumentFields('system', 'dataHead', originalHeadRaw, ['seq', 'lastCommandId', 'goLiveDate', 'updatedAt']);
      }
      if (signedIn && app) await signOut((await import('firebase/auth')).getAuth(app));
      if (app) await deleteApp(app);
    }
  });

  test('L07 read-only tie fixture: F2/F5, CSV, and print preserve nanosecond transaction order and prefix balances', async ({ authedPage: page }, testInfo) => {
    const originalHeadRaw = await readRawAdminDocument('system', 'dataHead');
    const originalHead = originalHeadRaw ? decodeAdminFields(originalHeadRaw.fields) : null;
    if (!originalHeadRaw || !originalHead || typeof originalHead.seq !== 'number') {
      throw new Error('The demo-easyorder Emulator dataHead is not initialized');
    }
    const dayIds: string[] = [];
    const transactionIds: string[] = [];
    let app: ReturnType<typeof initializeApp> | null = null;
    let signedIn = false;
    let fixtureReserved = false;

    try {
      const today = taipeiToday();
      await assertFixtureDayIsVacant(today);
      if (await readRawAdminDocument('students', NANOS_STUDENT_ID) || await readRawAdminDocument('studentCodes', NANOS_STUDENT_CODE)) {
        throw new Error('P12c timestamp fixture account ID or code is already in use');
      }
      fixtureReserved = true;
      dayIds.push(today);
      app = initializeApp({
        apiKey: 'dummy-api-key', authDomain: 'dummy-auth-domain', projectId: PROJECT,
        appId: 'dummy-app-id', messagingSenderId: '000000000000', storageBucket: 'dummy-bucket',
      }, `p12c-nanos-${randomUUID()}`);
      const { getAuth } = await import('firebase/auth');
      const auth = getAuth(app);
      connectAuthEmulator(auth, AUTH_EMULATOR, { disableWarnings: true });
      const googleIdentity = await createGoogleEmulatorUser(E2E_IDENTITIES.operatorA.email);
      await signInWithCredential(auth, GoogleAuthProvider.credential(googleIdentity.idToken));
      signedIn = true;
      const lease = await readAccessLease();
      if (lease.holderUid !== auth.currentUser?.uid || lease.holderUid !== googleIdentity.localId) {
        throw new Error('The timestamp fixture client does not hold the active operator lease');
      }
      const db = getFirestore(app);
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
      const options = {
        currentUser: () => auth.currentUser,
        pendingJournal: createCloudPendingJournal(db, createMemoryCloudPendingJournalTestAdapter()),
      };
      const students = createCloudStudentRepository(db, options);
      const closing = createCloudDayCloseRepository(db, options);
      const days = createCloudDayVendorRepository(db, options);
      const orders = createCloudOrderRepository(db, options);

      ok(await students.createStudent({
        commandId: randomUUID(), leaseEpoch: lease.epoch, studentId: NANOS_STUDENT_ID,
        studentCode: NANOS_STUDENT_CODE, displayName: NANOS_STUDENT_NAME, aliases: ['P12c排序別名'],
        openingBalance: { amount: 100, asOfDate: today, note: 'P12c timestamp ordering fixture' },
      }), 'CreateStudent timestamp fixture');
      ok(await closing.ensureDay({ commandId: randomUUID(), leaseEpoch: lease.epoch, dayId: today }), 'EnsureDay timestamp fixture');
      const openingDay = await closing.read(today);
      ok(await days.setOpeningCash({
        commandId: randomUUID(), leaseEpoch: lease.epoch, dayId: today,
        expectedRevision: openingDay.revision, openingCash: 0,
      }), 'SetOpeningCash timestamp fixture');

      let currentStudent = (await students.list()).students.find(value => value.studentId === NANOS_STUDENT_ID);
      if (!currentStudent) throw new Error('Timestamp fixture account was not listed after creation');
      let day = await closing.read(today);
      const createOrder = async (mealPrice: number, note: string) => {
        const transactionId = randomUUID();
        transactionIds.push(transactionId);
        ok(await orders.createOrder({
          commandId: randomUUID(), transactionId, leaseEpoch: lease.epoch,
          studentId: NANOS_STUDENT_ID, dayId: today,
          expectedStudentRevision: currentStudent!.revision, expectedDayRevision: day.revision,
          mealKind: 'other', mealPrice, paidAmount: 0, menuRevision: null,
          otherItemName: '同毫秒測試餐', note,
        }), `CreateOrder timestamp fixture ${note}`);
        currentStudent = { ...currentStudent!, revision: currentStudent!.revision + 1 };
        day = { ...day, revision: day.revision + 1 };
        return { transactionId, mealPrice, note };
      };
      const orderA = await createOrder(10, 'P12c nanos row A');
      const orderB = await createOrder(20, 'P12c nanos row B');
      const earlierId = [orderA.transactionId, orderB.transactionId].sort().at(-1)!;
      const laterId = [orderA.transactionId, orderB.transactionId].sort()[0];
      const earlierOrder = orderA.transactionId === earlierId ? orderA : orderB;
      const laterOrder = orderA.transactionId === laterId ? orderA : orderB;
      const earlierTimestamp = `${today}T04:00:00.001001000Z`;
      const laterTimestamp = `${today}T04:00:00.001009000Z`;

      // Coordinator-approved read-only fixture seam: only synthetic transaction createdAt timestamps are
      // rewritten through Emulator Admin REST so the UI sees two valid Firestore nanosecond values in one ms.
      // This case is reader/UI/output evidence only; the separate R01/L07 case is the legal command mutation proof.
      await patchAdminTimestamp('transactions', earlierId, 'createdAt', earlierTimestamp);
      await patchAdminTimestamp('transactions', laterId, 'createdAt', laterTimestamp);
      const earlierRaw = await readRawAdminDocument('transactions', earlierId);
      const laterRaw = await readRawAdminDocument('transactions', laterId);
      const rawTimestamp = (document: AdminRawDocument | null) => String(document?.fields?.createdAt
        && (document.fields.createdAt as { timestampValue?: string }).timestampValue);
      expect(new Date(rawTimestamp(earlierRaw)).getMilliseconds()).toBe(1);
      expect(new Date(rawTimestamp(laterRaw)).getMilliseconds()).toBe(1);
      const nanos = (timestamp: string) => Number(timestamp.match(/\.(\d+)Z$/)?.[1]?.padEnd(9, '0'));
      expect(nanos(rawTimestamp(earlierRaw))).toBe(1_001_000);
      expect(nanos(rawTimestamp(laterRaw))).toBe(1_009_000);
      expect(earlierId.localeCompare(laterId)).toBeGreaterThan(0);

      await page.getByRole('button', { name: '雲端報表' }).click();
      await expect(page.getByTestId('report-ready')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('.cloud-report__pager')).toContainText('全部 2 筆');
      await page.getByLabel('搜尋帳戶').fill(NANOS_STUDENT_NAME);
      await page.getByRole('button', { name: `選取 ${NANOS_STUDENT_NAME}（${NANOS_STUDENT_CODE}）` }).click();
      await expect(page.getByTestId('report-ready')).toContainText(`帳戶 ${NANOS_STUDENT_ID}`, { timeout: 30_000 });
      const detailRows = page.locator('section[aria-labelledby="cloud-report-detail-heading"] tbody tr');
      const f2RowTexts = await detailRows.allInnerTexts();
      expect(f2RowTexts.findIndex(row => row.includes(earlierOrder.note)))
        .toBeLessThan(f2RowTexts.findIndex(row => row.includes(laterOrder.note)));

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: '匯出原始交易 CSV' }).click(),
      ]);
      const csvPath = testInfo.outputPath('p12c-nanosecond-order.csv');
      await download.saveAs(csvPath);
      const csvRows = (await readFile(csvPath, 'utf8')).trimEnd().split(/\r?\n/);
      expect(csvRows).toHaveLength(3);
      expect(csvRows.findIndex(row => row.includes(earlierId)))
        .toBeLessThan(csvRows.findIndex(row => row.includes(laterId)));

      await page.evaluate(() => {
        const target = window as Window & { __p12cNanosPrint?: string[] | null };
        target.__p12cNanosPrint = null;
        window.print = () => {
          const content = document.querySelector('[aria-label="本次固定列印內容"]');
          target.__p12cNanosPrint = Array.from(content?.querySelectorAll('tbody tr') ?? [], row => row.textContent ?? '');
        };
      });
      await page.getByRole('button', { name: '記錄後列印目前完整明細' }).click();
      await expect(page.getByText('已發起列印。')).toBeVisible({ timeout: 15_000 });
      const printedRows = await page.evaluate(() => (window as Window & { __p12cNanosPrint?: string[] | null }).__p12cNanosPrint ?? null);
      expect(printedRows).toHaveLength(2);
      expect(printedRows?.[0]).toContain(`$${100 - earlierOrder.mealPrice}`);
      expect(printedRows?.[1]).toContain('$70');
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));

      await page.getByRole('button', { name: `開啟查帳：${NANOS_STUDENT_NAME}` }).click();
      await expect(page.getByTestId('account-history-ready')).toBeVisible({ timeout: 30_000 });
      const transactionRows = page.locator('section[aria-labelledby="account-transactions-heading"] tbody tr');
      await expect.poll(() => transactionRows.count()).toBe(2);
      const f5RowTexts = await transactionRows.allInnerTexts();
      const earlierPosition = f5RowTexts.findIndex(row => row.includes(earlierId));
      const laterPosition = f5RowTexts.findIndex(row => row.includes(laterId));
      expect(earlierPosition).toBeGreaterThanOrEqual(0);
      expect(earlierPosition).toBeLessThan(laterPosition);
      expect(f5RowTexts[earlierPosition]).toContain(`$${100 - earlierOrder.mealPrice}`);
      expect(f5RowTexts[laterPosition]).toContain('$70');
      await expect(page.locator('.cloud-account-history__balance div').filter({ hasText: '目前帳戶餘額' }).locator('dd'))
        .toHaveText('$70');
      await expect(transactionRows.getByRole('button', { name: '更正' })).toHaveCount(0);
    } finally {
      if (fixtureReserved) {
        for (const command of await listAdminDocuments('commands')) {
          if (typeof command.seq === 'number' && command.seq > Number(originalHead.seq)) {
            await deleteAdminDocument('commands', command.id);
          }
        }
        for (const transactionId of transactionIds) await deleteAdminDocument('transactions', transactionId);
        for (const dayId of dayIds) await deleteAdminDocument('days', dayId);
        await deleteIfPresent('students', NANOS_STUDENT_ID);
        await deleteIfPresent('studentCodes', NANOS_STUDENT_CODE);
        await restoreRawDocumentFields('system', 'dataHead', originalHeadRaw, ['seq', 'lastCommandId', 'goLiveDate', 'updatedAt']);
      }
      if (signedIn && app) await signOut((await import('firebase/auth')).getAuth(app));
      if (app) await deleteApp(app);
    }
  });
});
