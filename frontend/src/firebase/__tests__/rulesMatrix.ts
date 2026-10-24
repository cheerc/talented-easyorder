import type { BusinessCommandKind } from '../../domain/cloudCommands';

/**
 * P16b Rules matrix definition (plan R4–R6). `cloudRulesMatrix.spec.ts` runs it against the real `firestore.rules` in the
 * Emulator; `rulesMatrixCoverage.test.ts` keeps it complete: every command kind, every mutation class, every `match`
 * block of the Rules. Adding a kind or a collection without extending this file turns that unit test red.
 */

/** The mutation classes every command kind is run through. Each one changes one thing in an otherwise accepted batch. */
export const MUTATIONS = [
  { id: 'M1', title: '未登入' },
  { id: 'M2', title: '已登入但不在 operators 白名單' },
  { id: 'M3', title: '白名單但 active: false' },
  { id: 'M4', title: '核准 operator 但不是租約持有者' },
  { id: 'M5', title: '持有者但 leaseEpoch 已過期' },
  { id: 'M6', title: '偽造 actor（uid／email 不等於登入身分）' },
  { id: 'M7', title: '少寫一個投影（每個非 command 寫入各刪一次）' },
  { id: 'M8', title: '只寫投影不寫 command（或只寫 command 不寫投影）' },
  { id: 'M9', title: '夾帶額外寫入（另一個文件，帶同一 lastCommandId）' },
  { id: 'M10', title: '重放（接受後再送同一批次）' },
] as const;

export type MutationId = typeof MUTATIONS[number]['id'];

export interface KindMatrixEntry {
  /** The scenario step in `cloudRulesMatrix.spec.ts` that runs this kind through the matrix. */
  step: string;
  /** A mutation class that cannot apply to this kind, with the reason. Empty when all ten apply. */
  notApplicable: Partial<Record<MutationId, string>>;
}

export const KIND_MATRIX: Partial<Record<BusinessCommandKind, KindMatrixEntry>> = {};

export type Readers = 'holder' | 'approved' | 'self' | 'none';

export interface CollectionMatrixEntry {
  /** The `match` pattern exactly as written in `firestore.rules`, below `/databases/{database}/documents`. */
  match: string;
  /** A document of this collection that exists when the collection matrix runs. */
  doc: string;
  /** The collection to list; null when the Rules never allow a list. */
  collection: string | null;
  /** Who may read: the lease holder only, any approved operator, the signed-in user for their own document, or nobody. */
  readers: Readers;
  /** Writes that the lease holder must be refused when they come without a command. */
  bareWrites: Array<'create' | 'update' | 'delete'>;
}

export const COLLECTION_MATRIX: CollectionMatrixEntry[] = [];
