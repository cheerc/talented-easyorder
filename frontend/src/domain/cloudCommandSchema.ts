import { Timestamp } from 'firebase/firestore';
import { ALL_COMMAND_KINDS, type BusinessCommandKind, type CommandActor, type CommandCashEffect } from './cloudCommands';

export type RevisionExpectation = number;

export interface CommandTargetsByKind {
  CreateStudent: { studentId: string };
  EditStudent: { studentId: string };
  SetStudentStatus: { studentId: string };
  CorrectOpening: { studentId: string; dayId: string };
  SaveVendor: { vendorId: string };
  RemoveVendor: { vendorId: string };
  EnsureDay: { dayId: string };
  SetDayMenu: { dayId: string };
  SetOpeningCash: { dayId: string };
  CreateOrder: { transactionId: string; studentId: string; dayId: string };
  CreatePayment: { transactionId: string; studentId: string; dayId: string };
  CreateCashMovement: { transactionId: string; dayId: string };
  CorrectTransaction: { transactionId: string; studentId: string; dayId: string };
  VoidTransaction: { transactionId: string; studentId: string; dayId: string };
  CancelKeepDeposit: { transactionId: string; studentId: string; dayId: string };
  CancelRefund: { transactionId: string; studentId: string; dayId: string };
  Undo: { transactionId: string; studentId?: string | null; dayId: string };
  CloseDay: { dayId: string; settlementRevision: number };
  ReopenDay: { dayId: string; settlementRevision: number };
  RecordExport: Record<string, never>;
  RecordPrint: Record<string, never>;
  RecordBackup: Record<string, never>;
}

export interface CommandPayloadByKind {
  CreateStudent: { displayName: string; aliases: string[]; openingBalance: { amount: number; asOfDate: string; note: string } };
  EditStudent: { displayName?: string; aliases?: string[]; note?: string };
  SetStudentStatus: { status: 'active' | 'inactive'; reason?: string };
  CorrectOpening: { amount: number; note: string; reason: string };
  SaveVendor: { vendorId: string; name: string; phone: string; note: string; status: 'active' | 'inactive' };
  RemoveVendor: { reason: string };
  EnsureDay: { businessDate: string };
  SetDayMenu: { itemName: string; price: number; vendorId: string; vendorNameSnapshot: string; inheritedFromDate: string | null };
  SetOpeningCash: { openingCash: number };
  CreateOrder: { mealPrice: number; paidAmount: number; mealKind: 'bento' | 'other'; menuRevision: number | null; otherItemName: string | null; note: string };
  CreatePayment: { paidAmount: number; note: string };
  CreateCashMovement: { mealPrice: number; paidAmount: number; note: string; reason: string };
  CorrectTransaction: { mealPrice: number; paidAmount: number; note: string; reason: string };
  VoidTransaction: { reason: string };
  CancelKeepDeposit: { reason: string };
  CancelRefund: { reason: string };
  Undo: { targetCommandId: string; reason: string };
  CloseDay: { countedCash: number; note: string; expectedCash: number };
  ReopenDay: { reason: string };
  RecordExport: { exportType: string; dateRange: { start: string; end: string } | null; sourceSeq: number };
  RecordPrint: { printType: string; businessDate: string; sourceSeq: number };
  RecordBackup: { backupType: string; sourceSeq: number; fromSeq: number; toSeq: number; sha256: string };
}

export interface ExpectedRevisionsByKind {
  CreateStudent: { student: 0 };
  EditStudent: { student: RevisionExpectation };
  SetStudentStatus: { student: RevisionExpectation };
  CorrectOpening: { student: RevisionExpectation; day: RevisionExpectation };
  SaveVendor: { vendor: RevisionExpectation };
  RemoveVendor: { vendor: RevisionExpectation };
  EnsureDay: { day: 0 };
  SetDayMenu: { day: RevisionExpectation };
  SetOpeningCash: { day: RevisionExpectation };
  CreateOrder: { transaction: 0; student: RevisionExpectation; day: RevisionExpectation };
  CreatePayment: { transaction: 0; student: RevisionExpectation; day: RevisionExpectation };
  CreateCashMovement: { transaction: 0; day: RevisionExpectation };
  CorrectTransaction: { transaction: RevisionExpectation; student: RevisionExpectation; day: RevisionExpectation };
  VoidTransaction: { transaction: RevisionExpectation; student: RevisionExpectation; day: RevisionExpectation };
  CancelKeepDeposit: { transaction: RevisionExpectation; student: RevisionExpectation; day: RevisionExpectation };
  CancelRefund: { transaction: RevisionExpectation; student: RevisionExpectation; day: RevisionExpectation };
  Undo: { transaction: RevisionExpectation; student?: RevisionExpectation; day: RevisionExpectation };
  CloseDay: { day: RevisionExpectation; settlement: RevisionExpectation };
  ReopenDay: { day: RevisionExpectation; settlement: RevisionExpectation };
  RecordExport: Record<string, never>;
  RecordPrint: Record<string, never>;
  RecordBackup: Record<string, never>;
}

export type FullCloudCommandInput = {
  [K in BusinessCommandKind]: {
    commandId: string;
    kind: K;
    leaseEpoch: number;
    targets: CommandTargetsByKind[K];
    expectedRevisions: ExpectedRevisionsByKind[K];
    payload: CommandPayloadByKind[K];
  }
}[BusinessCommandKind];

export type EnabledCommandKind = 'EnsureDay' | 'CreateOrder' | 'CreatePayment';
export type EnabledCloudCommandInput = Extract<FullCloudCommandInput, { kind: EnabledCommandKind }>;

export type StoredCloudCommandDoc = {
  [K in BusinessCommandKind]: {
    commandId: string;
    kind: K;
    seq: number;
    leaseEpoch: number;
    actor: CommandActor;
    committedAt: Timestamp;
    businessDate: string | null;
    studentId: string | null;
    targets: CommandTargetsByKind[K];
    expectedRevisions: ExpectedRevisionsByKind[K];
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    reason: string | null;
    cashEffect: CommandCashEffect;
    payload: CommandPayloadByKind[K];
    inputFingerprint: string;
  }
}[BusinessCommandKind];

export type StoredEnabledCommandDoc = Extract<StoredCloudCommandDoc, { kind: EnabledCommandKind }>;

export type CanonicalEnabledInput =
  | (Extract<EnabledCloudCommandInput, { kind: 'EnsureDay' }>)
  | {
      commandId: string;
      kind: 'CreateOrder';
      leaseEpoch: number;
      targets: CommandTargetsByKind['CreateOrder'];
      expectedRevisions: ExpectedRevisionsByKind['CreateOrder'];
      payload: CommandPayloadByKind['CreateOrder'];
    }
  | {
      commandId: string;
      kind: 'CreatePayment';
      leaseEpoch: number;
      targets: CommandTargetsByKind['CreatePayment'];
      expectedRevisions: ExpectedRevisionsByKind['CreatePayment'];
      payload: CommandPayloadByKind['CreatePayment'];
    };

export class InvalidCloudCommandInput extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCloudCommandInput';
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  const keys = Object.keys(value);
  if (keys.some(key => key === '__proto__' || key === 'constructor' || key === 'prototype')) {
    throw new InvalidCloudCommandInput('命令含不允許的物件欄位');
  }
  const allowed = new Set([...required, ...optional]);
  if (required.some(key => !Object.hasOwn(value, key)) || keys.some(key => !allowed.has(key))) {
    throw new InvalidCloudCommandInput('命令欄位與固定 schema 不符');
  }
}

function stringValue(value: unknown, label: string, max = 128): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || value.includes('/')) {
    throw new InvalidCloudCommandInput(`${label} 不合法`);
  }
}

function dateValue(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new InvalidCloudCommandInput(`${label} 必須是 YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new InvalidCloudCommandInput(`${label} 不是有效日期`);
  }
}

function safeInteger(value: unknown, label: string, max = 1_000_000_000): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Object.is(value, -0) || value < 0 || value > max) {
    throw new InvalidCloudCommandInput(`${label} 必須是範圍內的非負整數`);
  }
}

function validateRevisionMap(value: unknown, keys: string[], createKeys: string[] = []): Record<string, number> {
  if (!isPlainRecord(value)) throw new InvalidCloudCommandInput('expectedRevisions 必須是固定物件');
  exactKeys(value, keys);
  for (const key of keys) safeInteger(value[key], `expectedRevisions.${key}`);
  for (const key of createKeys) {
    if (value[key] !== 0) throw new InvalidCloudCommandInput(`expectedRevisions.${key} 必須為 0`);
  }
  return value as Record<string, number>;
}

function normalizePayload(kind: EnabledCommandKind, value: unknown): CommandPayloadByKind[EnabledCommandKind] {
  if (!isPlainRecord(value)) throw new InvalidCloudCommandInput('payload 必須是固定物件');
  if (kind === 'EnsureDay') {
    exactKeys(value, ['businessDate']);
    dateValue(value.businessDate, 'businessDate');
    return { businessDate: value.businessDate };
  }
  if (kind === 'CreatePayment') {
    exactKeys(value, ['paidAmount'], ['note']);
    safeInteger(value.paidAmount, 'paidAmount', 1_000_000);
    if (value.paidAmount <= 0) throw new InvalidCloudCommandInput('繳費金額必須大於零');
    const note = value.note ?? '';
    if (typeof note !== 'string' || note.length > 500) throw new InvalidCloudCommandInput('note 不合法');
    return { paidAmount: value.paidAmount, note };
  }

  exactKeys(value, ['mealPrice', 'paidAmount', 'mealKind'], ['menuRevision', 'otherItemName', 'note']);
  safeInteger(value.mealPrice, 'mealPrice', 1_000_000);
  safeInteger(value.paidAmount, 'paidAmount', 1_000_000);
  if (value.mealKind !== 'bento' && value.mealKind !== 'other') {
    throw new InvalidCloudCommandInput('mealKind 必須是 bento 或 other');
  }
  const menuRevision = value.menuRevision ?? null;
  if (value.mealKind === 'bento') {
    safeInteger(menuRevision, 'menuRevision');
    if (menuRevision < 1) throw new InvalidCloudCommandInput('menuRevision 必須大於零');
  } else if (menuRevision !== null) {
    throw new InvalidCloudCommandInput('其他餐點不接受便當菜單版次');
  }
  const otherItemName: string | null = value.otherItemName === undefined ? null : value.otherItemName as string | null;
  if (otherItemName !== null && (typeof otherItemName !== 'string' || otherItemName.length > 100)) {
    throw new InvalidCloudCommandInput('otherItemName 不合法');
  }
  if (value.mealKind === 'other' && !otherItemName?.trim()) throw new InvalidCloudCommandInput('其他餐點必須提供品名');
  if (value.mealKind === 'bento' && otherItemName !== null) throw new InvalidCloudCommandInput('便當不能帶 otherItemName');
  const note = value.note ?? '';
  if (typeof note !== 'string' || note.length > 500) throw new InvalidCloudCommandInput('note 不合法');
  return {
    mealPrice: value.mealPrice,
    paidAmount: value.paidAmount,
    mealKind: value.mealKind,
    menuRevision,
    otherItemName,
    note,
  };
}

export function normalizeEnabledCommandInput(input: unknown): CanonicalEnabledInput {
  if (!isPlainRecord(input)) throw new InvalidCloudCommandInput('命令必須是固定物件');
  exactKeys(input, ['commandId', 'kind', 'leaseEpoch', 'targets', 'expectedRevisions', 'payload']);
  if (typeof input.kind !== 'string' || !['EnsureDay', 'CreateOrder', 'CreatePayment'].includes(input.kind)) {
    throw new InvalidCloudCommandInput('此命令種類尚未啟用');
  }
  const kind = input.kind as EnabledCommandKind;
  if (typeof input.commandId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.commandId)) {
    throw new InvalidCloudCommandInput('commandId 必須是 UUID');
  }
  safeInteger(input.leaseEpoch, 'leaseEpoch');
  if (kind === 'EnsureDay') {
    if (!isPlainRecord(input.targets)) throw new InvalidCloudCommandInput('targets 必須是固定物件');
    exactKeys(input.targets, ['dayId']);
    dateValue(input.targets.dayId, 'targets.dayId');
    const expectedRevisions = validateRevisionMap(input.expectedRevisions, ['day'], ['day']);
    const payload = normalizePayload(kind, input.payload) as CommandPayloadByKind['EnsureDay'];
    if (input.targets.dayId !== payload.businessDate) throw new InvalidCloudCommandInput('dayId 必須等於 businessDate');
    return {
      commandId: input.commandId,
      kind,
      leaseEpoch: input.leaseEpoch,
      targets: { dayId: input.targets.dayId },
      expectedRevisions: expectedRevisions as ExpectedRevisionsByKind['EnsureDay'],
      payload,
    };
  }

  if (!isPlainRecord(input.targets)) throw new InvalidCloudCommandInput('targets 必須是固定物件');
  exactKeys(input.targets, ['transactionId', 'studentId', 'dayId']);
  stringValue(input.targets.transactionId, 'transactionId', 64);
  stringValue(input.targets.studentId, 'studentId', 64);
  if (input.targets.studentId === '__cashier__') throw new InvalidCloudCommandInput('studentId 不合法');
  dateValue(input.targets.dayId, 'targets.dayId');
  const expectedRevisions = validateRevisionMap(input.expectedRevisions, ['transaction', 'student', 'day'], ['transaction']);
  const payload = normalizePayload(kind, input.payload);
  return {
    commandId: input.commandId,
    kind,
    leaseEpoch: input.leaseEpoch,
    targets: {
      transactionId: input.targets.transactionId,
      studentId: input.targets.studentId,
      dayId: input.targets.dayId,
    },
    expectedRevisions: expectedRevisions as ExpectedRevisionsByKind[typeof kind],
    payload,
  } as CanonicalEnabledInput;
}

function canonicalValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  if (isPlainRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalJson(value: unknown): string {
  return canonicalValue(value);
}

export async function fingerprintCommandInput(input: CanonicalEnabledInput): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
  const bytes = new TextEncoder().encode(canonicalJson(input));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function sameCommandSemantics(left: CanonicalEnabledInput, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(normalizeEnabledCommandInput(right));
  } catch {
    return false;
  }
}

export function decodeEnabledCommandDoc(raw: unknown): StoredEnabledCommandDoc {
  if (!isPlainRecord(raw)) throw new InvalidCloudCommandInput('command receipt 不是物件');
  exactKeys(raw, [
    'commandId', 'kind', 'seq', 'leaseEpoch', 'actor', 'committedAt', 'businessDate', 'studentId',
    'targets', 'expectedRevisions', 'before', 'after', 'reason', 'cashEffect', 'payload', 'inputFingerprint',
  ]);
  if (typeof raw.kind !== 'string' || !ALL_COMMAND_KINDS.includes(raw.kind as BusinessCommandKind)) {
    throw new InvalidCloudCommandInput('command receipt kind 不支援');
  }
  if (!['EnsureDay', 'CreateOrder', 'CreatePayment'].includes(raw.kind)) {
    throw new InvalidCloudCommandInput('此 command kind 尚未啟用');
  }
  safeInteger(raw.seq, 'receipt.seq');
  if (raw.seq < 1) throw new InvalidCloudCommandInput('receipt.seq 必須大於零');
  safeInteger(raw.leaseEpoch, 'receipt.leaseEpoch');
  stringValue(raw.commandId, 'receipt.commandId', 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw.commandId)) {
    throw new InvalidCloudCommandInput('receipt.commandId 必須是 UUID');
  }
  if (!(raw.committedAt instanceof Timestamp)) throw new InvalidCloudCommandInput('receipt.committedAt 必須是 Firestore Timestamp');
  if (raw.businessDate !== null) dateValue(raw.businessDate, 'receipt.businessDate');
  if (raw.studentId !== null && typeof raw.studentId !== 'string') throw new InvalidCloudCommandInput('receipt.studentId 不合法');
  if (raw.reason !== null && typeof raw.reason !== 'string') throw new InvalidCloudCommandInput('receipt.reason 不合法');
  if (typeof raw.inputFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(raw.inputFingerprint)) {
    throw new InvalidCloudCommandInput('receipt.inputFingerprint 不合法');
  }
  if (!isPlainRecord(raw.actor)) throw new InvalidCloudCommandInput('receipt.actor 不合法');
  exactKeys(raw.actor, ['uid', 'email']);
  stringValue(raw.actor.uid, 'receipt.actor.uid');
  if (typeof raw.actor.email !== 'string' || raw.actor.email.length < 3 || raw.actor.email.length > 254) {
    throw new InvalidCloudCommandInput('receipt.actor.email 不合法');
  }
  if (raw.before !== null && !isPlainRecord(raw.before)) throw new InvalidCloudCommandInput('receipt.before 不合法');
  if (raw.after !== null && !isPlainRecord(raw.after)) throw new InvalidCloudCommandInput('receipt.after 不合法');
  if (!isPlainRecord(raw.cashEffect)) throw new InvalidCloudCommandInput('receipt.cashEffect 不合法');
  exactKeys(raw.cashEffect, ['before', 'after', 'delta', 'reasonKind', 'refundAmount']);
  for (const key of ['before', 'after', 'delta', 'refundAmount']) {
    if (typeof raw.cashEffect[key] !== 'number' || !Number.isSafeInteger(raw.cashEffect[key])) {
      throw new InvalidCloudCommandInput(`receipt.cashEffect.${key} 不合法`);
    }
  }
  if (!['collection', 'payout', 'refund', 'correction', 'reversal', 'none'].includes(String(raw.cashEffect.reasonKind))) {
    throw new InvalidCloudCommandInput('receipt.cashEffect.reasonKind 不合法');
  }

  const normalized = normalizeEnabledCommandInput({
    commandId: raw.commandId,
    kind: raw.kind,
    leaseEpoch: raw.leaseEpoch,
    targets: raw.targets,
    expectedRevisions: raw.expectedRevisions,
    payload: raw.payload,
  });
  if (normalized.kind === 'EnsureDay') {
    if (raw.businessDate !== normalized.payload.businessDate || raw.studentId !== null) {
      throw new InvalidCloudCommandInput('EnsureDay receipt 共用欄位不一致');
    }
  } else if (raw.businessDate !== normalized.targets.dayId || raw.studentId !== normalized.targets.studentId) {
    throw new InvalidCloudCommandInput('交易 receipt 共用欄位不一致');
  }
  return raw as unknown as StoredEnabledCommandDoc;
}
