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

/** The scenario step of every kind, in the order `cloudRulesMatrix.spec.ts` runs them. All ten classes apply to all kinds: no cell is skipped. */
export const KIND_MATRIX: Partial<Record<BusinessCommandKind, KindMatrixEntry>> = {
  CreateStudent: { step: 'S01 CreateStudent', notApplicable: {} },
  ChangeStudentCode: { step: 'S02 ChangeStudentCode', notApplicable: {} },
  EditStudent: { step: 'S03 EditStudent', notApplicable: {} },
  SetStudentStatus: { step: 'S04 SetStudentStatus', notApplicable: {} },
  SaveVendor: { step: 'S05 SaveVendor', notApplicable: {} },
  RemoveVendor: { step: 'S06 RemoveVendor', notApplicable: {} },
  EnsureDay: { step: 'S07 EnsureDay', notApplicable: {} },
  BackfillOpeningCash: { step: 'S08 BackfillOpeningCash', notApplicable: {} },
  StartBackfill: { step: 'S09 StartBackfill', notApplicable: {} },
  CloseDay: { step: 'S10 CloseDay', notApplicable: {} },
  RecordPostCloseEntry: { step: 'S11 RecordPostCloseEntry', notApplicable: {} },
  SetDayMenu: { step: 'S12 SetDayMenu', notApplicable: {} },
  SetOpeningCash: { step: 'S13 SetOpeningCash', notApplicable: {} },
  CorrectOpening: { step: 'S14 CorrectOpening', notApplicable: {} },
  CreateOrder: { step: 'S15 CreateOrder', notApplicable: {} },
  CorrectTransaction: { step: 'S16 CorrectTransaction', notApplicable: {} },
  CancelKeepDeposit: { step: 'S17 CancelKeepDeposit', notApplicable: {} },
  CancelRefund: { step: 'S18 CancelRefund', notApplicable: {} },
  CreatePayment: { step: 'S19 CreatePayment', notApplicable: {} },
  Undo: { step: 'S20 Undo', notApplicable: {} },
  CreateCashMovement: { step: 'S21 CreateCashMovement', notApplicable: {} },
  CreateRefund: { step: 'S22 CreateRefund', notApplicable: {} },
  VoidTransaction: { step: 'S23 VoidTransaction', notApplicable: {} },
  ReopenDay: { step: 'S24 ReopenDay', notApplicable: {} },
  RecordExport: { step: 'S25 RecordExport', notApplicable: {} },
  RecordPrint: { step: 'S26 RecordPrint', notApplicable: {} },
  RecordBackup: { step: 'S27 RecordBackup', notApplicable: {} },
};

export type Readers = 'holder' | 'approved' | 'self' | 'none';

export interface CollectionMatrixEntry {
  /** The `match` pattern exactly as written in `firestore.rules`, below `/databases/{database}/documents`. */
  match: string;
  /**
   * A document of this match that exists when the collection matrix runs. The spec resolves the placeholders
   * `{operator}`, `{event}`, `{today}`, `{gap}`, `{alpha}`, `{vendor}`, `{code}`, `{command}`, `{transaction}`, `{entry}`, `{settlement}` from the scenario.
   */
  doc: string;
  /** The collection that is listed to probe `list`. */
  listPath: string;
  /** Whether the Rules let `readers` list that collection (a list under limit 5 is probed under every identity). */
  listable: boolean;
  /** Who may read: the lease holder only, any approved operator, the signed-in user for their own document, or nobody. */
  readers: Readers;
  /** Writes that the lease holder must be refused when they come without a command (a bare create re-sends the document that exists). */
  bareWrites: Array<'create' | 'update' | 'delete'>;
}

const ALL_BARE: Array<'create' | 'update' | 'delete'> = ['create', 'update', 'delete'];

export const COLLECTION_MATRIX: CollectionMatrixEntry[] = [
  { match: '/operators/{uid}', doc: 'operators/{operator}', listPath: 'operators', listable: false, readers: 'self', bareWrites: ALL_BARE },
  // The holder renews the lease with a bare update on purpose, so only create and delete are refused here.
  { match: '/system/accessLease', doc: 'system/accessLease', listPath: 'system', listable: false, readers: 'approved', bareWrites: ['create', 'delete'] },
  { match: '/accessEvents/{eventId}', doc: 'accessEvents/{event}', listPath: 'accessEvents', listable: true, readers: 'approved', bareWrites: ALL_BARE },
  { match: '/system/dataHead', doc: 'system/dataHead', listPath: 'system', listable: false, readers: 'holder', bareWrites: ALL_BARE },
  { match: '/commands/{commandId}', doc: 'commands/{command}', listPath: 'commands', listable: true, readers: 'holder', bareWrites: ALL_BARE },
  { match: '/days/{dayId}', doc: 'days/{today}', listPath: 'days', listable: true, readers: 'holder', bareWrites: ALL_BARE },
  { match: '/days/{dayId}/settlements/{revision}', doc: 'days/{gap}/settlements/{settlement}', listPath: 'days/{gap}/settlements', listable: true, readers: 'holder', bareWrites: ALL_BARE },
  { match: '/backfillDays/{dayId}', doc: 'backfillDays/{gap}', listPath: 'backfillDays', listable: true, readers: 'holder', bareWrites: ALL_BARE },
  { match: '/postCloseEntries/{entryId}', doc: 'postCloseEntries/{entry}', listPath: 'postCloseEntries', listable: true, readers: 'holder', bareWrites: ALL_BARE },
  { match: '/students/{studentId}', doc: 'students/{alpha}', listPath: 'students', listable: true, readers: 'holder', bareWrites: ALL_BARE },
  { match: '/studentCodes/{code}', doc: 'studentCodes/{code}', listPath: 'studentCodes', listable: true, readers: 'holder', bareWrites: ALL_BARE },
  { match: '/transactions/{transactionId}', doc: 'transactions/{transaction}', listPath: 'transactions', listable: true, readers: 'holder', bareWrites: ALL_BARE },
  { match: '/vendors/{vendorId}', doc: 'vendors/{vendor}', listPath: 'vendors', listable: true, readers: 'holder', bareWrites: ALL_BARE },
  // The old cash-adjustment style collections and everything the Rules do not name are closed to everyone.
  { match: '/daily_settlements/{document=**}', doc: 'daily_settlements/legacy', listPath: 'daily_settlements', listable: false, readers: 'none', bareWrites: ALL_BARE },
  { match: '/{document=**}', doc: 'p16b-unnamed/doc', listPath: 'p16b-unnamed', listable: false, readers: 'none', bareWrites: ALL_BARE },
];
