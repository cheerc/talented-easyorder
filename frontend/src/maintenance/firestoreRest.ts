/**
 * Firestore REST v1 access for the maintenance CLI (Ruling R2). The target is decided by the environment, never by a
 * flag alone: with `FIRESTORE_EMULATOR_HOST` the CLI talks to the Emulator as `owner` and only for `demo-` projects;
 * without it the CLI talks to Google with a short-lived access token from `EASYORDER_ACCESS_TOKEN` and never for a
 * `demo-` project. The token is never written to a file, a log or a report.
 */

export class RestError extends Error {
  /** HTTP status, or 0 when the request never got an answer. */
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.name = 'RestError'; this.status = status; }
}

/** A precondition of a write (`exists=false`) did not hold: the document is already there. */
export class AlreadyExistsError extends RestError {
  constructor(message: string) { super(message, 409); this.name = 'AlreadyExistsError'; }
}

export interface RestEnv { FIRESTORE_EMULATOR_HOST?: string; EASYORDER_ACCESS_TOKEN?: string }

export interface RestTarget {
  baseUrl: string;
  project: string;
  emulator: boolean;
  /** Only ever placed in the request header. */
  authorization: string;
}

export class TargetError extends Error {
  constructor(message: string) { super(message); this.name = 'TargetError'; }
}

const PROJECT_ID = /^[a-z][a-z0-9-]{5,29}$|^demo-[a-z0-9-]{1,40}$/;

export function resolveTarget(project: string, env: RestEnv): RestTarget {
  if (!PROJECT_ID.test(project)) throw new TargetError(`--project ${project} 不是有效的專案 ID`);
  const host = env.FIRESTORE_EMULATOR_HOST;
  if (host) {
    if (!project.startsWith('demo-')) {
      throw new TargetError('偵測到 FIRESTORE_EMULATOR_HOST：Emulator 目標的 --project 必須以 demo- 開頭；拒絕寫入任何其他專案');
    }
    if (!/^[A-Za-z0-9.\-[\]:]+$/.test(host)) throw new TargetError('FIRESTORE_EMULATOR_HOST 格式不正確');
    return { baseUrl: `http://${host}`, project, emulator: true, authorization: 'Bearer owner' };
  }
  if (project.startsWith('demo-')) {
    throw new TargetError('--project 以 demo- 開頭但沒有 FIRESTORE_EMULATOR_HOST；demo- 專案只能在 Emulator 使用');
  }
  const token = env.EASYORDER_ACCESS_TOKEN;
  if (!token) throw new TargetError('非 Emulator 目標需要環境變數 EASYORDER_ACCESS_TOKEN（例如暫時設為 gcloud auth print-access-token 的輸出）');
  return { baseUrl: 'https://firestore.googleapis.com', project, emulator: false, authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------------------------------------------
// Values. Documents travel as plain JSON with `{ _type: 'timestamp', seconds, nanoseconds }` markers (the P14 form).

export type RestValue =
  | { nullValue: null } | { booleanValue: boolean } | { integerValue: string } | { stringValue: string }
  | { timestampValue: string } | { arrayValue: { values?: RestValue[] } } | { mapValue: { fields?: Record<string, RestValue> } };

export interface TimestampMarker { _type: 'timestamp'; seconds: number; nanoseconds: number }

function isTimestampMarker(value: unknown): value is TimestampMarker {
  const marker = value as Record<string, unknown> | null;
  return !!marker && typeof marker === 'object' && marker._type === 'timestamp'
    && Object.keys(marker).length === 3 && 'seconds' in marker && 'nanoseconds' in marker;
}

function formatTimestamp(marker: TimestampMarker): string {
  const { seconds, nanoseconds } = marker;
  if (!Number.isSafeInteger(seconds) || !Number.isSafeInteger(nanoseconds) || nanoseconds < 0 || nanoseconds > 999_999_999) {
    throw new RestError('時間戳記的 seconds 或 nanoseconds 不是有效整數', 0);
  }
  // Firestore keeps microseconds; anything finer would be changed by the round trip, so it is refused.
  if (nanoseconds % 1000 !== 0) throw new RestError('時間戳記精度超過微秒，無法無損還原', 0);
  const base = new Date(seconds * 1000).toISOString().slice(0, 19);
  return `${base}.${String(nanoseconds).padStart(9, '0')}Z`;
}

function parseTimestamp(text: string): TimestampMarker {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(text);
  if (!match) throw new RestError('無法解析目標回傳的時間戳記', 0);
  return {
    _type: 'timestamp', seconds: Math.floor(Date.parse(`${match[1]}Z`) / 1000),
    nanoseconds: Number((match[2] ?? '').padEnd(9, '0') || 0),
  };
}

export function encodeValue(value: unknown): RestValue {
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RestError('文件含有非整數或超出安全範圍的數字；還原只接受安全整數', 0);
    return { integerValue: String(value) };
  }
  if (Array.isArray(value)) return { arrayValue: value.length === 0 ? {} : { values: value.map(encodeValue) } };
  if (isTimestampMarker(value)) return { timestampValue: formatTimestamp(value) };
  if (typeof value === 'object' && value !== undefined) return { mapValue: encodeFields(value as Record<string, unknown>) };
  throw new RestError('文件含有無法編碼的值', 0);
}

export function encodeFields(data: Record<string, unknown>): { fields?: Record<string, RestValue> } {
  const entries = Object.entries(data);
  if (entries.length === 0) return {};
  return { fields: Object.fromEntries(entries.map(([key, value]) => [key, encodeValue(value)])) };
}

export function decodeValue(value: RestValue): unknown {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) {
    const number = Number(value.integerValue);
    if (!Number.isSafeInteger(number)) throw new RestError('目標文件含有超出安全範圍的整數', 0);
    return number;
  }
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return parseTimestamp(value.timestampValue);
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields ?? {});
  throw new RestError('目標文件含有不支援的值型別（例如浮點數或參照）', 0);
}

export function decodeFields(fields: Record<string, RestValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}

// ---------------------------------------------------------------------------------------------------------------

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean; status: number; text(): Promise<string>;
}>;

export type RestWrite =
  | { kind: 'create'; path: string; data: Record<string, unknown> }
  /** Updates only the listed fields of an existing document; `updateTime` makes it conditional on the document not having changed since it was read. */
  | { kind: 'update'; path: string; data: Record<string, unknown>; fields: string[]; updateTime?: string };

export interface RestDocument { path: string; data: Record<string, unknown> }

export interface FirestoreRest {
  readonly target: RestTarget;
  commit(writes: RestWrite[]): Promise<void>;
  batchGet(paths: string[]): Promise<Map<string, Record<string, unknown> | null>>;
  /** True when at least one document exists in the collection (a collection path such as `commands`). */
  collectionHasDocuments(collection: string): Promise<boolean>;
  /** True when at least one document exists in any collection with this ID, at any depth. */
  groupHasDocuments(collectionId: string): Promise<boolean>;
  /** Every document of a collection path such as `students` or `days/2026-10-01/settlements`, across pages. */
  listDocuments(collection: string): Promise<RestDocument[]>;
  /** Every document of every collection with this ID, at any depth (a collection group), across pages. */
  listGroupDocuments(collectionId: string): Promise<RestDocument[]>;
  /** Only the document IDs of a collection, across pages. */
  listDocumentIds(collection: string): Promise<string[]>;
  /** One document with its update time (for a conditional write), or null when it does not exist. */
  getWithUpdateTime(path: string): Promise<{ data: Record<string, unknown>; updateTime: string } | null>;
}

interface ListAnswer { documents?: Array<{ name: string; fields?: Record<string, RestValue> }>; nextPageToken?: string }

export function createFirestoreRest(target: RestTarget, fetchImpl: FetchLike): FirestoreRest {
  const root = `projects/${target.project}/databases/(default)/documents`;
  const api = `${target.baseUrl}/v1/${root}`;

  async function call(method: string, url: string, body?: unknown): Promise<unknown> {
    let response;
    try {
      response = await fetchImpl(url, {
        method, headers: { Authorization: target.authorization, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new RestError(`連不上目標 ${target.emulator ? 'Emulator' : 'Firestore'}（${target.baseUrl}）`, 0);
    }
    const text = await response.text();
    if (!response.ok) {
      let status = '';
      try { status = String((JSON.parse(text) as { error?: { status?: string } }).error?.status ?? ''); } catch { /* not JSON */ }
      if (status === 'ALREADY_EXISTS' || (response.status === 409 && status !== 'ABORTED')) throw new AlreadyExistsError('目標已經有這份文件（exists=false 前置條件不成立）');
      throw new RestError(`目標回應 HTTP ${response.status}${status ? ` ${status}` : ''}`, response.status);
    }
    try { return text ? JSON.parse(text) : {}; } catch { throw new RestError('目標回傳的內容不是有效的 JSON', response.status); }
  }

  return {
    target,
    async commit(writes) {
      if (writes.length === 0) return;
      await call('POST', `${api}:commit`, {
        writes: writes.map(write => write.kind === 'create'
          ? { update: { name: `${root}/${write.path}`, ...encodeFields(write.data) }, currentDocument: { exists: false } }
          : {
            update: { name: `${root}/${write.path}`, ...encodeFields(write.data) },
            updateMask: { fieldPaths: write.fields },
            currentDocument: write.updateTime === undefined ? { exists: true } : { updateTime: write.updateTime },
          }),
      });
    },
    async batchGet(paths) {
      const result = new Map<string, Record<string, unknown> | null>();
      if (paths.length === 0) return result;
      const answer = await call('POST', `${api}:batchGet`, { documents: paths.map(path => `${root}/${path}`) });
      for (const entry of answer as Array<{ found?: { name: string; fields?: Record<string, RestValue> }; missing?: string }>) {
        if (entry.found) result.set(entry.found.name.slice(root.length + 1), decodeFields(entry.found.fields ?? {}));
        else if (entry.missing) result.set(entry.missing.slice(root.length + 1), null);
      }
      for (const path of paths) if (!result.has(path)) throw new RestError('目標的 batchGet 回應缺少文件', 200);
      return result;
    },
    async collectionHasDocuments(collection) {
      const answer = await call('GET', `${api}/${collection}?pageSize=1`) as { documents?: unknown[] };
      return (answer.documents?.length ?? 0) > 0;
    },
    async listDocuments(collection) {
      const found: RestDocument[] = [];
      let pageToken = '';
      do {
        const answer = await call('GET', `${api}/${collection}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`) as ListAnswer;
        for (const item of answer.documents ?? []) found.push({ path: item.name.slice(root.length + 1), data: decodeFields(item.fields ?? {}) });
        pageToken = answer.nextPageToken ?? '';
      } while (pageToken);
      return found;
    },
    async listGroupDocuments() {
      throw new RestError('尚未提供', 0);
    },
    async listDocumentIds(collection) {
      const ids: string[] = [];
      let pageToken = '';
      do {
        const answer = await call('GET', `${api}/${collection}?pageSize=300&mask.fieldPaths=__name__${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`) as ListAnswer;
        for (const item of answer.documents ?? []) ids.push(item.name.slice(root.length + 1 + collection.length + 1));
        pageToken = answer.nextPageToken ?? '';
      } while (pageToken);
      return ids;
    },
    async getWithUpdateTime(path) {
      const answer = await call('POST', `${api}:batchGet`, { documents: [`${root}/${path}`] }) as Array<{
        found?: { fields?: Record<string, RestValue>; updateTime?: string }; missing?: string;
      }>;
      const entry = answer[0];
      if (entry?.found) {
        if (!entry.found.updateTime) throw new RestError('目標沒有回傳文件的 updateTime', 200);
        return { data: decodeFields(entry.found.fields ?? {}), updateTime: entry.found.updateTime };
      }
      if (entry?.missing) return null;
      throw new RestError('目標的 batchGet 回應缺少文件', 200);
    },
    async groupHasDocuments(collectionId) {
      const answer = await call('POST', `${api}:runQuery`, {
        structuredQuery: { from: [{ collectionId, allDescendants: true }], limit: 1 },
      }) as Array<{ document?: unknown }>;
      return answer.some(entry => entry.document !== undefined);
    },
  };
}
