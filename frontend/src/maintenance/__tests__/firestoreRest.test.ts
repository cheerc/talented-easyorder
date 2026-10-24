import { describe, expect, it } from 'vitest';
import {
  AlreadyExistsError, RestError, TargetError, createFirestoreRest, decodeFields, encodeFields, encodeValue, resolveTarget,
  type FetchLike,
} from '../firestoreRest';

const stamp = (seconds: number, nanoseconds: number) => ({ _type: 'timestamp' as const, seconds, nanoseconds });

describe('P15b REST value encoding (B15)', () => {
  it('encodes integers of every size, sign and zero as integerValue strings', () => {
    for (const value of [0, 1, -1, 2_147_483_647, 2_147_483_648, -2_147_483_649, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) {
      expect(encodeValue(value)).toEqual({ integerValue: String(value) });
    }
  });

  it('encodes null, booleans, strings (including empty and non-ASCII), arrays and maps, nested', () => {
    expect(encodeValue(null)).toEqual({ nullValue: null });
    expect(encodeValue(true)).toEqual({ booleanValue: true });
    expect(encodeValue('')).toEqual({ stringValue: '' });
    expect(encodeValue('餐費')).toEqual({ stringValue: '餐費' });
    expect(encodeValue([])).toEqual({ arrayValue: {} });
    expect(encodeValue({})).toEqual({ mapValue: {} });
    expect(encodeValue([1, 'a', [null], {}])).toEqual({
      arrayValue: { values: [{ integerValue: '1' }, { stringValue: 'a' }, { arrayValue: { values: [{ nullValue: null }] } }, { mapValue: {} }] },
    });
    expect(encodeFields({ outer: { inner: { count: -3, tags: ['x'] } }, empty: {} })).toEqual({
      fields: {
        outer: { mapValue: { fields: { inner: { mapValue: { fields: { count: { integerValue: '-3' }, tags: { arrayValue: { values: [{ stringValue: 'x' }] } } } } } } } },
        empty: { mapValue: {} },
      },
    });
    expect(encodeFields({})).toEqual({});
  });

  it('encodes a timestamp marker as RFC 3339 with nine fractional digits and keeps microseconds', () => {
    expect(encodeValue(stamp(1_760_000_000, 123_456_000))).toEqual({ timestampValue: '2025-10-09T08:53:20.123456000Z' });
    expect(encodeValue(stamp(0, 0))).toEqual({ timestampValue: '1970-01-01T00:00:00.000000000Z' });
    expect(encodeValue(stamp(1_760_000_000, 5_000))).toEqual({ timestampValue: '2025-10-09T08:53:20.000005000Z' });
  });

  it('fails closed on a non-integer number, a non-safe integer, NaN, Infinity and sub-microsecond timestamps', () => {
    for (const value of [1.5, -0.25, 2 ** 53, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => encodeValue(value), String(value)).toThrow(RestError);
    }
    expect(() => encodeValue(stamp(1_760_000_000, 123_456_789))).toThrow(RestError);
    expect(() => encodeValue(stamp(1_760_000_000, 1_000_000_000))).toThrow(RestError);
    expect(() => encodeValue(undefined)).toThrow(RestError);
  });

  it('decodes what it encodes, for every supported type', () => {
    const data = {
      n: 0, big: 4_294_967_296, neg: -7, s: 'x', b: false, z: null, list: [1, [2], { k: 'v' }], map: { a: { b: [] } }, when: stamp(1_760_000_000, 120_000),
    };
    expect(decodeFields((encodeFields(data) as { fields: Parameters<typeof decodeFields>[0] }).fields)).toEqual(data);
  });

  it('refuses to decode a float or a reference from the target', () => {
    expect(() => decodeFields({ x: { doubleValue: 1.5 } } as never)).toThrow(RestError);
    expect(() => decodeFields({ x: { referenceValue: 'projects/p/databases/(default)/documents/a/b' } } as never)).toThrow(RestError);
  });
});

describe('P15b target resolution (R2)', () => {
  it('uses the Emulator as owner for demo- projects and nothing else when FIRESTORE_EMULATOR_HOST is set', () => {
    const target = resolveTarget('demo-easyorder-restore', { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
    expect(target).toMatchObject({ baseUrl: 'http://127.0.0.1:8080', emulator: true, authorization: 'Bearer owner' });
    expect(() => resolveTarget('easyorder-prod', { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', EASYORDER_ACCESS_TOKEN: 't' })).toThrow(TargetError);
  });

  it('uses Google with the access token for a real project, and refuses demo- projects and a missing token', () => {
    const target = resolveTarget('easyorder-restore-drill', { EASYORDER_ACCESS_TOKEN: 'secret-token' });
    expect(target).toMatchObject({ baseUrl: 'https://firestore.googleapis.com', emulator: false, authorization: 'Bearer secret-token' });
    expect(() => resolveTarget('demo-x-restore', { EASYORDER_ACCESS_TOKEN: 'secret-token' })).toThrow(TargetError);
    expect(() => resolveTarget('easyorder-restore-drill', {})).toThrow(TargetError);
  });

  it('rejects a malformed project ID and a malformed emulator host, and never puts the token in an error', () => {
    expect(() => resolveTarget('Bad Project', {})).toThrow(TargetError);
    expect(() => resolveTarget('demo-ok', { FIRESTORE_EMULATOR_HOST: 'evil.example/path?x' })).toThrow(TargetError);
    try { resolveTarget('demo-x-restore', { EASYORDER_ACCESS_TOKEN: 'secret-token' }); } catch (error) {
      expect(String(error)).not.toContain('secret-token');
    }
  });
});

describe('P15b REST client (fake fetch)', () => {
  const emulatorTarget = () => resolveTarget('demo-easyorder-restore', { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
  const recorder = (answer: (url: string) => ReturnType<typeof reply>) => {
    const calls: Array<{ url: string; method: string; body: unknown; authorization: string }> = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined, authorization: init.headers.Authorization! });
      return answer(url);
    };
    return { calls, fetchImpl };
  };

  it('commits creates with exists=false and updates with a field mask and exists=true, in one request', async () => {
    const { calls, fetchImpl } = recorder(() => reply(200, {}));
    await createFirestoreRest(emulatorTarget(), fetchImpl).commit([
      { kind: 'create', path: 'commands/c1', data: { seq: 1, at: stamp(1_760_000_000, 0) } },
      { kind: 'update', path: 'system/dataHead', data: { seq: 1 }, fields: ['seq'] },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://127.0.0.1:8080/v1/projects/demo-easyorder-restore/databases/(default)/documents:commit');
    expect(calls[0]!.authorization).toBe('Bearer owner');
    expect(calls[0]!.body).toEqual({ writes: [
      { update: { name: 'projects/demo-easyorder-restore/databases/(default)/documents/commands/c1', fields: { seq: { integerValue: '1' }, at: { timestampValue: '2025-10-09T08:53:20.000000000Z' } } }, currentDocument: { exists: false } },
      { update: { name: 'projects/demo-easyorder-restore/databases/(default)/documents/system/dataHead', fields: { seq: { integerValue: '1' } } }, updateMask: { fieldPaths: ['seq'] }, currentDocument: { exists: true } },
    ] });
  });

  it('sends nothing for an empty batch', async () => {
    const { calls, fetchImpl } = recorder(() => reply(200, {}));
    await createFirestoreRest(emulatorTarget(), fetchImpl).commit([]);
    expect(calls).toHaveLength(0);
  });

  it('maps 409 and ALREADY_EXISTS to AlreadyExistsError, other failures to RestError with the status, and a lost connection to status 0', async () => {
    const exists = recorder(() => reply(409, { error: { status: 'ALREADY_EXISTS', message: 'contains a name and a balance' } }));
    await expect(createFirestoreRest(emulatorTarget(), exists.fetchImpl).commit([{ kind: 'create', path: 'a/b', data: {} }])).rejects.toBeInstanceOf(AlreadyExistsError);
    const denied = recorder(() => reply(403, { error: { status: 'PERMISSION_DENIED', message: 'contains a name and a balance' } }));
    const failure = await createFirestoreRest(emulatorTarget(), denied.fetchImpl).commit([{ kind: 'create', path: 'a/b', data: {} }]).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RestError);
    expect((failure as RestError).status).toBe(403);
    expect((failure as RestError).message).not.toContain('balance');
    const lost = await createFirestoreRest(emulatorTarget(), async () => { throw new Error('ECONNREFUSED'); }).commit([{ kind: 'create', path: 'a/b', data: {} }]).catch((error: unknown) => error);
    expect((lost as RestError).status).toBe(0);
  });

  it('reads found and missing documents with batchGet and decodes them', async () => {
    const root = 'projects/demo-easyorder-restore/databases/(default)/documents';
    const { calls, fetchImpl } = recorder(() => reply(200, [
      { found: { name: `${root}/students/a`, fields: { n: { integerValue: '3' } } }, readTime: 't' },
      { missing: `${root}/students/b`, readTime: 't' },
    ]));
    const result = await createFirestoreRest(emulatorTarget(), fetchImpl).batchGet(['students/a', 'students/b']);
    expect(result.get('students/a')).toEqual({ n: 3 });
    expect(result.get('students/b')).toBeNull();
    expect(calls[0]!.body).toEqual({ documents: [`${root}/students/a`, `${root}/students/b`] });
  });

  it('asks whether a collection, and a collection group, has any document with one-row requests', async () => {
    const answers: Record<string, unknown> = {};
    const { calls, fetchImpl } = recorder(url => reply(200, answers[url.includes(':runQuery') ? 'group' : 'list']));
    const rest = createFirestoreRest(emulatorTarget(), fetchImpl);
    answers.list = {};
    expect(await rest.collectionHasDocuments('students')).toBe(false);
    answers.list = { documents: [{ name: 'x' }] };
    expect(await rest.collectionHasDocuments('students')).toBe(true);
    answers.group = [{ readTime: 't' }];
    expect(await rest.groupHasDocuments('settlements')).toBe(false);
    answers.group = [{ document: { name: 'x' }, readTime: 't' }];
    expect(await rest.groupHasDocuments('settlements')).toBe(true);
    expect(calls[0]!.url).toContain('/students?pageSize=1');
    expect(calls[2]!.body).toEqual({ structuredQuery: { from: [{ collectionId: 'settlements', allDescendants: true }], limit: 1 } });
  });

  const root = 'projects/demo-easyorder-restore/databases/(default)/documents';

  it('P15c: lists a whole collection across pages and decodes every document with its relative path', async () => {
    const pages = [
      { documents: [{ name: `${root}/students/a`, fields: { n: { integerValue: '1' } } }], nextPageToken: 'next-page' },
      { documents: [{ name: `${root}/students/b`, fields: {} }] },
    ];
    const { calls, fetchImpl } = recorder(() => reply(200, pages.shift()));
    const listed = await createFirestoreRest(emulatorTarget(), fetchImpl).listDocuments('students');
    expect(listed).toEqual([{ path: 'students/a', data: { n: 1 } }, { path: 'students/b', data: {} }]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toContain('/documents/students?pageSize=300');
    expect(calls[1]!.url).toContain('pageToken=next-page');
  });

  it('P15c: lists only the document IDs of a collection (a name-only mask) and returns an empty list for an empty collection', async () => {
    const answers: unknown[] = [{ documents: [{ name: `${root}/accessEvents/7` }, { name: `${root}/accessEvents/12` }] }, {}];
    const { calls, fetchImpl } = recorder(() => reply(200, answers.shift()));
    const rest = createFirestoreRest(emulatorTarget(), fetchImpl);
    expect(await rest.listDocumentIds('accessEvents')).toEqual(['7', '12']);
    expect(await rest.listDocumentIds('accessEvents')).toEqual([]);
    expect(calls[0]!.url).toContain('mask.fieldPaths=__name__');
  });

  it('P15c: reads one document with its update time, or null when it is missing', async () => {
    const answers: unknown[] = [
      [{ found: { name: `${root}/system/dataHead`, fields: { seq: { integerValue: '3' } }, updateTime: '2026-10-24T00:00:00.123456Z' } }],
      [{ missing: `${root}/system/dataHead` }],
    ];
    const { fetchImpl } = recorder(() => reply(200, answers.shift()));
    const rest = createFirestoreRest(emulatorTarget(), fetchImpl);
    expect(await rest.getWithUpdateTime('system/dataHead')).toEqual({ data: { seq: 3 }, updateTime: '2026-10-24T00:00:00.123456Z' });
    expect(await rest.getWithUpdateTime('system/dataHead')).toBeNull();
  });

  it('P15c: an update with an updateTime precondition sends currentDocument.updateTime instead of exists', async () => {
    const { calls, fetchImpl } = recorder(() => reply(200, {}));
    await createFirestoreRest(emulatorTarget(), fetchImpl).commit([
      { kind: 'update', path: 'system/dataHead', data: { maintenance: false }, fields: ['maintenance'], updateTime: '2026-10-24T00:00:00.123456Z' },
    ]);
    expect(calls[0]!.body).toEqual({ writes: [{
      update: { name: `${root}/system/dataHead`, fields: { maintenance: { booleanValue: false } } },
      updateMask: { fieldPaths: ['maintenance'] }, currentDocument: { updateTime: '2026-10-24T00:00:00.123456Z' },
    }] });
  });

  it('P15c: a failed updateTime precondition (HTTP 400/409/412) is an error, never a silent success', async () => {
    for (const status of [400, 409, 412]) {
      const { fetchImpl } = recorder(() => reply(status, { error: { status: status === 409 ? 'ABORTED' : 'FAILED_PRECONDITION' } }));
      await expect(createFirestoreRest(emulatorTarget(), fetchImpl).commit([
        { kind: 'update', path: 'system/dataHead', data: { maintenance: false }, fields: ['maintenance'], updateTime: 't' },
      ])).rejects.toBeInstanceOf(RestError);
    }
  });
});
