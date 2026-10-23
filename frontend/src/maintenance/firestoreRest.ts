/** RED stub: the REST layer is written in the GREEN commit. Every function fails so the tests fail on behaviour. */

export class RestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.name = 'RestError'; this.status = status; }
}
export class AlreadyExistsError extends RestError {
  constructor(message: string) { super(message, 409); this.name = 'AlreadyExistsError'; }
}
export class TargetError extends Error {
  constructor(message: string) { super(message); this.name = 'TargetError'; }
}

export interface RestEnv { FIRESTORE_EMULATOR_HOST?: string; EASYORDER_ACCESS_TOKEN?: string }
export interface RestTarget { baseUrl: string; project: string; emulator: boolean; authorization: string }
export type RestValue = Record<string, unknown>;
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean; status: number; text(): Promise<string>;
}>;
export type RestWrite =
  | { kind: 'create'; path: string; data: Record<string, unknown> }
  | { kind: 'update'; path: string; data: Record<string, unknown>; fields: string[] };
export interface FirestoreRest {
  readonly target: RestTarget;
  commit(writes: RestWrite[]): Promise<void>;
  batchGet(paths: string[]): Promise<Map<string, Record<string, unknown> | null>>;
  collectionHasDocuments(collection: string): Promise<boolean>;
  groupHasDocuments(collectionId: string): Promise<boolean>;
}

const notYet = (): never => { throw new Error('P15b 尚未實作'); };
export const resolveTarget = (_project: string, _env: RestEnv): RestTarget => notYet();
export const encodeValue = (_value: unknown): RestValue => notYet();
export const encodeFields = (_data: Record<string, unknown>): { fields?: Record<string, RestValue> } => notYet();
export const decodeFields = (_fields: Record<string, RestValue>): Record<string, unknown> => notYet();
export const createFirestoreRest = (_target: RestTarget, _fetchImpl: FetchLike): FirestoreRest => notYet();
