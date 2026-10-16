import { Timestamp } from 'firebase/firestore';
import { ALL_COMMAND_KINDS, type BusinessCommandKind, type CommandActor, type CommandCashEffect } from './cloudCommands';
import { normalizeStudentCodeOrThrow, STUDENT_CODE_REGEX } from './student';

export type RevisionExpectation = number;

export interface CommandTargetsByKind {
  CreateStudent: { studentId: string };
  ChangeStudentCode: { studentId: string };
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
  CreateRefund: { transactionId: string; studentId: string; dayId: string };
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
  CreateStudent: { studentCode: string; displayName: string; aliases: string[]; openingBalance: { amount: number; asOfDate: string; note: string } };
  ChangeStudentCode: { studentCode: string; reason: string };
  EditStudent: { displayName?: string; aliases?: string[] };
  SetStudentStatus: { status: 'active' | 'inactive'; reason: string };
  CorrectOpening: { amount: number; note: string; reason: string };
  SaveVendor: { vendorId: string; name: string; phone: string; note: string; status: 'active' | 'inactive' };
  RemoveVendor: { reason: string };
  EnsureDay: { businessDate: string };
  SetDayMenu: { selectionDate: string; itemName: string; price: number; vendorId: string; vendorNameSnapshot: string; inheritedFromDate: string | null };
  SetOpeningCash: { openingCash: number };
  CreateOrder: { mealPrice: number; paidAmount: number; mealKind: 'bento' | 'other'; menuRevision: number | null; otherItemName: string | null; note: string };
  CreatePayment: { paidAmount: number; note: string };
  CreateCashMovement: { mealPrice: number; paidAmount: number; reason: string };
  CreateRefund: { amount: number; reason: string };
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
  ChangeStudentCode: { student: RevisionExpectation };
  EditStudent: { student: RevisionExpectation };
  SetStudentStatus: { student: RevisionExpectation };
  CorrectOpening: { student: RevisionExpectation; day: RevisionExpectation };
  SaveVendor: { vendor: RevisionExpectation };
  RemoveVendor: { vendor: RevisionExpectation };
  EnsureDay: { day: 0 };
  SetDayMenu: { day: RevisionExpectation; headSeq: RevisionExpectation };
  SetOpeningCash: { day: RevisionExpectation };
  CreateOrder: { transaction: 0; student: RevisionExpectation; day: RevisionExpectation };
  CreatePayment: { transaction: 0; student: RevisionExpectation; day: RevisionExpectation };
  CreateCashMovement: { transaction: 0; day: RevisionExpectation };
  CreateRefund: { transaction: 0; student: RevisionExpectation; day: RevisionExpectation };
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

export type EnabledCommandKind =
  | 'EnsureDay'
  | 'CreateOrder'
  | 'CreatePayment'
  | 'CreateStudent'
  | 'ChangeStudentCode'
  | 'EditStudent'
  | 'SetStudentStatus'
  | 'SaveVendor'
  | 'RemoveVendor'
  | 'SetDayMenu'
  | 'SetOpeningCash'
  | 'CreateCashMovement'
  | 'CreateRefund'
  | 'RecordBackup';
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
  | (Extract<EnabledCloudCommandInput, { kind: EnabledCommandKind }>);

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

function signedInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Object.is(value, -0)
    || value < -1_000_000_000 || value > 1_000_000_000) {
    throw new InvalidCloudCommandInput(`${label} 必須是 -1,000,000,000 至 1,000,000,000 的整數`);
  }
}

function studentIdValue(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new InvalidCloudCommandInput(`${label} 必須是 UUID`);
  }
}

function studentCodeValue(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new InvalidCloudCommandInput(`${label} 必須是字串`);
  }
  try {
    return normalizeStudentCodeOrThrow(value);
  } catch {
    throw new InvalidCloudCommandInput(`${label} 必須是有效學生編號（001–999999）`);
  }
}

function vendorIdValue(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64 || value.includes('/')) {
    throw new InvalidCloudCommandInput(`${label} 不合法`);
  }
}

function aliasesValue(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length > 10
    || !value.every(alias => typeof alias === 'string' && alias.length > 0 && alias.length <= 100)) {
    throw new InvalidCloudCommandInput(`${label} 最多 10 個，每個不得超過 100 字`);
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
  if (kind === 'SaveVendor') {
    exactKeys(value, ['vendorId', 'name', 'phone', 'note', 'status']);
    vendorIdValue(value.vendorId, 'vendorId');
    if (typeof value.name !== 'string' || value.name.length < 1 || value.name.length > 100
      || typeof value.phone !== 'string' || value.phone.length > 100
      || typeof value.note !== 'string' || value.note.length > 500
      || (value.status !== 'active' && value.status !== 'inactive')) {
      throw new InvalidCloudCommandInput('供應商欄位不合法');
    }
    return {
      vendorId: value.vendorId, name: value.name, phone: value.phone,
      note: value.note, status: value.status,
    } as CommandPayloadByKind['SaveVendor'];
  }
  if (kind === 'RemoveVendor') {
    exactKeys(value, ['reason']);
    if (typeof value.reason !== 'string' || value.reason.length < 1 || value.reason.length > 500) {
      throw new InvalidCloudCommandInput('reason 必須為 1 至 500 字');
    }
    return { reason: value.reason } as CommandPayloadByKind['RemoveVendor'];
  }
  if (kind === 'SetDayMenu') {
    exactKeys(value, ['selectionDate', 'itemName', 'price', 'vendorId', 'vendorNameSnapshot', 'inheritedFromDate']);
    dateValue(value.selectionDate, 'selectionDate');
    if (typeof value.itemName !== 'string' || value.itemName.length < 1 || value.itemName.length > 100
      || typeof value.vendorNameSnapshot !== 'string' || value.vendorNameSnapshot.length < 1 || value.vendorNameSnapshot.length > 100) {
      throw new InvalidCloudCommandInput('菜單品名或供應商快照不合法');
    }
    safeInteger(value.price, 'price', 1_000_000);
    if (value.price < 1) throw new InvalidCloudCommandInput('price 必須大於零');
    vendorIdValue(value.vendorId, 'vendorId');
    if (value.inheritedFromDate !== null) dateValue(value.inheritedFromDate, 'inheritedFromDate');
    return {
      selectionDate: value.selectionDate, itemName: value.itemName, price: value.price,
      vendorId: value.vendorId, vendorNameSnapshot: value.vendorNameSnapshot,
      inheritedFromDate: value.inheritedFromDate,
    } as CommandPayloadByKind['SetDayMenu'];
  }
  if (kind === 'SetOpeningCash') {
    exactKeys(value, ['openingCash']);
    safeInteger(value.openingCash, 'openingCash', 20_000);
    return { openingCash: value.openingCash };
  }
  if (kind === 'CreateStudent') {
    exactKeys(value, ['studentCode', 'displayName', 'aliases', 'openingBalance']);
    const studentCode = studentCodeValue(value.studentCode, 'studentCode');
    if (typeof value.displayName !== 'string' || value.displayName.length < 1 || value.displayName.length > 100) {
      throw new InvalidCloudCommandInput('displayName 必須是 1 至 100 字');
    }
    aliasesValue(value.aliases, 'aliases');
    if (!isPlainRecord(value.openingBalance)) throw new InvalidCloudCommandInput('openingBalance 必須是固定物件');
    exactKeys(value.openingBalance, ['amount', 'asOfDate', 'note']);
    signedInteger(value.openingBalance.amount, 'openingBalance.amount');
    dateValue(value.openingBalance.asOfDate, 'openingBalance.asOfDate');
    if (typeof value.openingBalance.note !== 'string' || value.openingBalance.note.length > 500) {
      throw new InvalidCloudCommandInput('openingBalance.note 不合法');
    }
    return {
      studentCode,
      displayName: value.displayName,
      aliases: [...value.aliases],
      openingBalance: {
        amount: value.openingBalance.amount,
        asOfDate: value.openingBalance.asOfDate,
        note: value.openingBalance.note,
      },
    } as CommandPayloadByKind['CreateStudent'];
  }
  if (kind === 'ChangeStudentCode') {
    exactKeys(value, ['studentCode', 'reason']);
    const studentCode = studentCodeValue(value.studentCode, 'studentCode');
    const reason = value.reason;
    if (typeof reason !== 'string' || reason.length < 1 || reason.length > 500) {
      throw new InvalidCloudCommandInput('reason 必須為 1 至 500 字');
    }
    return { studentCode, reason } as CommandPayloadByKind['ChangeStudentCode'];
  }
  if (kind === 'EditStudent') {
    exactKeys(value, [], ['displayName', 'aliases']);
    if (!Object.hasOwn(value, 'displayName') && !Object.hasOwn(value, 'aliases')) {
      throw new InvalidCloudCommandInput('EditStudent 至少須修改姓名或別名');
    }
    if (Object.hasOwn(value, 'displayName')
      && (typeof value.displayName !== 'string' || value.displayName.length < 1 || value.displayName.length > 100)) {
      throw new InvalidCloudCommandInput('displayName 必須是 1 至 100 字');
    }
    if (Object.hasOwn(value, 'aliases')) aliasesValue(value.aliases, 'aliases');
    return {
      ...(Object.hasOwn(value, 'displayName') ? { displayName: value.displayName as string } : {}),
      ...(Object.hasOwn(value, 'aliases') ? { aliases: [...value.aliases as string[]] } : {}),
    } as CommandPayloadByKind['EditStudent'];
  }
  if (kind === 'SetStudentStatus') {
    exactKeys(value, ['status', 'reason']);
    if (value.status !== 'active' && value.status !== 'inactive') {
      throw new InvalidCloudCommandInput('status 必須是 active 或 inactive');
    }
    const reason = value.reason;
    if (typeof reason !== 'string' || reason.length < 1 || reason.length > 500) {
      throw new InvalidCloudCommandInput('reason 必須為 1 至 500 字');
    }
    return { status: value.status, reason } as CommandPayloadByKind['SetStudentStatus'];
  }
  if (kind === 'EnsureDay') {
    exactKeys(value, ['businessDate']);
    dateValue(value.businessDate, 'businessDate');
    return { businessDate: value.businessDate };
  }
  if (kind === 'CreateCashMovement') {
    exactKeys(value, ['mealPrice', 'paidAmount', 'reason']);
    safeInteger(value.mealPrice, 'mealPrice', 1_000_000);
    safeInteger(value.paidAmount, 'paidAmount', 1_000_000);
    if (!((value.mealPrice === 0 && value.paidAmount > 0) || (value.paidAmount === 0 && value.mealPrice > 0))) {
      throw new InvalidCloudCommandInput('櫃台收支必須是收入或支出其中一方大於零');
    }
    if (typeof value.reason !== 'string' || value.reason.length < 1 || value.reason.length > 500) {
      throw new InvalidCloudCommandInput('reason 必須為 1 至 500 字');
    }
    return { mealPrice: value.mealPrice, paidAmount: value.paidAmount, reason: value.reason };
  }
  if (kind === 'CreateRefund') {
    exactKeys(value, ['amount', 'reason']);
    safeInteger(value.amount, 'amount', 1_000_000);
    if (value.amount <= 0) throw new InvalidCloudCommandInput('退款金額必須大於零');
    if (typeof value.reason !== 'string' || value.reason.length < 1 || value.reason.length > 500) {
      throw new InvalidCloudCommandInput('reason 必須為 1 至 500 字');
    }
    return { amount: value.amount, reason: value.reason };
  }
  if (kind === 'CreatePayment') {
    exactKeys(value, ['paidAmount'], ['note']);
    safeInteger(value.paidAmount, 'paidAmount', 1_000_000);
    if (value.paidAmount <= 0) throw new InvalidCloudCommandInput('繳費金額必須大於零');
    const note = value.note ?? '';
    if (typeof note !== 'string' || note.length > 500) throw new InvalidCloudCommandInput('note 不合法');
    return { paidAmount: value.paidAmount, note };
  }
  if (kind === 'RecordBackup') {
    exactKeys(value, ['backupType', 'sourceSeq', 'fromSeq', 'toSeq', 'sha256']);
    if (value.backupType !== 'command-incremental') throw new InvalidCloudCommandInput('backupType 不支援');
    safeInteger(value.sourceSeq, 'sourceSeq');
    safeInteger(value.fromSeq, 'fromSeq');
    safeInteger(value.toSeq, 'toSeq');
    if (value.sourceSeq !== value.toSeq || value.fromSeq > value.toSeq
      || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) {
      throw new InvalidCloudCommandInput('備份範圍或 SHA-256 不合法');
    }
    return { backupType: value.backupType, sourceSeq: value.sourceSeq, fromSeq: value.fromSeq,
      toSeq: value.toSeq, sha256: value.sha256 };
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
    throw new InvalidCloudCommandInput('其他餐點不接受今日餐點菜單版次');
  }
  const otherItemName: string | null = value.otherItemName === undefined ? null : value.otherItemName as string | null;
  if (otherItemName !== null && (typeof otherItemName !== 'string' || otherItemName.length > 100)) {
    throw new InvalidCloudCommandInput('otherItemName 不合法');
  }
  if (value.mealKind === 'other' && !otherItemName?.trim()) throw new InvalidCloudCommandInput('其他餐點必須提供品名');
  if (value.mealKind === 'bento' && otherItemName !== null) throw new InvalidCloudCommandInput('今日餐點不能帶 otherItemName');
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
  if (typeof input.kind !== 'string' || ![
    'EnsureDay', 'CreateOrder', 'CreatePayment', 'CreateStudent', 'ChangeStudentCode', 'EditStudent', 'SetStudentStatus',
    'SaveVendor', 'RemoveVendor', 'SetDayMenu', 'SetOpeningCash', 'CreateCashMovement', 'CreateRefund', 'RecordBackup',
  ].includes(input.kind)) {
    throw new InvalidCloudCommandInput('此命令種類尚未啟用');
  }
  const kind = input.kind as EnabledCommandKind;
  if (typeof input.commandId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.commandId)) {
    throw new InvalidCloudCommandInput('commandId 必須是 UUID');
  }
  safeInteger(input.leaseEpoch, 'leaseEpoch');
  if (kind === 'RecordBackup') {
    if (!isPlainRecord(input.targets) || !isPlainRecord(input.expectedRevisions)) {
      throw new InvalidCloudCommandInput('targets 與 expectedRevisions 必須是固定物件');
    }
    exactKeys(input.targets, []);
    exactKeys(input.expectedRevisions, []);
    return { commandId: input.commandId, kind, leaseEpoch: input.leaseEpoch, targets: {}, expectedRevisions: {},
      payload: normalizePayload(kind, input.payload) as CommandPayloadByKind['RecordBackup'] } as CanonicalEnabledInput;
  }
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

  if (kind === 'SaveVendor' || kind === 'RemoveVendor') {
    if (!isPlainRecord(input.targets)) throw new InvalidCloudCommandInput('targets 必須是固定物件');
    exactKeys(input.targets, ['vendorId']);
    vendorIdValue(input.targets.vendorId, 'targets.vendorId');
    const isCreate = kind === 'SaveVendor' && isPlainRecord(input.expectedRevisions)
      && input.expectedRevisions.vendor === 0;
    const expectedRevisions = validateRevisionMap(input.expectedRevisions, ['vendor'], isCreate ? ['vendor'] : []);
    if (kind === 'RemoveVendor' && expectedRevisions.vendor < 1) {
      throw new InvalidCloudCommandInput('RemoveVendor 須指定既有供應商版本');
    }
    const payload = normalizePayload(kind, input.payload);
    if (kind === 'SaveVendor') {
      const vendorPayload = payload as CommandPayloadByKind['SaveVendor'];
      if (vendorPayload.vendorId !== input.targets.vendorId) throw new InvalidCloudCommandInput('vendorId 必須與 target 相同');
      if (isCreate && vendorPayload.status !== 'active') throw new InvalidCloudCommandInput('新供應商必須以 active 狀態建立');
    }
    return {
      commandId: input.commandId,
      kind,
      leaseEpoch: input.leaseEpoch,
      targets: { vendorId: input.targets.vendorId },
      expectedRevisions: expectedRevisions as ExpectedRevisionsByKind[typeof kind],
      payload,
    } as CanonicalEnabledInput;
  }

  if (kind === 'SetDayMenu') {
    if (!isPlainRecord(input.targets)) throw new InvalidCloudCommandInput('targets 必須是固定物件');
    exactKeys(input.targets, ['dayId']);
    dateValue(input.targets.dayId, 'targets.dayId');
    const expectedRevisions = validateRevisionMap(input.expectedRevisions, ['day', 'headSeq']);
    const payload = normalizePayload(kind, input.payload) as CommandPayloadByKind['SetDayMenu'];
    if (payload.inheritedFromDate !== null
      && (payload.inheritedFromDate >= input.targets.dayId || payload.inheritedFromDate > payload.selectionDate)) {
      throw new InvalidCloudCommandInput('繼承來源必須早於目標日且不晚於 selectionDate');
    }
    return {
      commandId: input.commandId,
      kind,
      leaseEpoch: input.leaseEpoch,
      targets: { dayId: input.targets.dayId },
      expectedRevisions: expectedRevisions as ExpectedRevisionsByKind['SetDayMenu'],
      payload,
    };
  }

  if (kind === 'SetOpeningCash') {
    if (!isPlainRecord(input.targets)) throw new InvalidCloudCommandInput('targets 必須是固定物件');
    exactKeys(input.targets, ['dayId']);
    dateValue(input.targets.dayId, 'targets.dayId');
    const expectedRevisions = validateRevisionMap(input.expectedRevisions, ['day']);
    const payload = normalizePayload(kind, input.payload) as CommandPayloadByKind['SetOpeningCash'];
    return {
      commandId: input.commandId,
      kind,
      leaseEpoch: input.leaseEpoch,
      targets: { dayId: input.targets.dayId },
      expectedRevisions: expectedRevisions as ExpectedRevisionsByKind['SetOpeningCash'],
      payload,
    };
  }

  if (kind === 'CreateStudent' || kind === 'ChangeStudentCode' || kind === 'EditStudent' || kind === 'SetStudentStatus') {
    if (!isPlainRecord(input.targets)) throw new InvalidCloudCommandInput('targets 必須是固定物件');
    exactKeys(input.targets, ['studentId']);
    studentIdValue(input.targets.studentId, 'targets.studentId');
    const isCreate = kind === 'CreateStudent';
    const expectedRevisions = validateRevisionMap(input.expectedRevisions, ['student'], isCreate ? ['student'] : []);
    if (!isCreate && expectedRevisions.student < 1) {
      throw new InvalidCloudCommandInput(`${kind} 須指定既有學生版本`);
    }
    const payload = normalizePayload(kind, input.payload);
    return {
      commandId: input.commandId,
      kind,
      leaseEpoch: input.leaseEpoch,
      targets: { studentId: input.targets.studentId },
      expectedRevisions: expectedRevisions as ExpectedRevisionsByKind[typeof kind],
      payload,
    } as CanonicalEnabledInput;
  }

  if (kind === 'CreateCashMovement') {
    if (!isPlainRecord(input.targets)) throw new InvalidCloudCommandInput('targets 必須是固定物件');
    exactKeys(input.targets, ['transactionId', 'dayId']);
    stringValue(input.targets.transactionId, 'transactionId', 64);
    dateValue(input.targets.dayId, 'targets.dayId');
    const expectedRevisions = validateRevisionMap(input.expectedRevisions, ['transaction', 'day'], ['transaction']);
    return {
      commandId: input.commandId,
      kind,
      leaseEpoch: input.leaseEpoch,
      targets: { transactionId: input.targets.transactionId, dayId: input.targets.dayId },
      expectedRevisions: expectedRevisions as ExpectedRevisionsByKind['CreateCashMovement'],
      payload: normalizePayload(kind, input.payload) as CommandPayloadByKind['CreateCashMovement'],
    };
  }

  if (!isPlainRecord(input.targets)) throw new InvalidCloudCommandInput('targets 必須是固定物件');
  exactKeys(input.targets, ['transactionId', 'studentId', 'dayId']);
  stringValue(input.targets.transactionId, 'transactionId', 64);
  studentIdValue(input.targets.studentId, 'studentId');
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

function receiptRecord(value: unknown, label: string, keys: string[]): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new InvalidCloudCommandInput(`${label} 必須是固定物件`);
  exactKeys(value, keys);
  return value;
}

function receiptTimestamp(value: unknown, label: string): asserts value is Timestamp {
  if (!(value instanceof Timestamp)) throw new InvalidCloudCommandInput(`${label} 必須是 Firestore Timestamp`);
}

function receiptInteger(
  value: unknown,
  label: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Object.is(value, -0)
    || value < minimum || value > maximum) {
    throw new InvalidCloudCommandInput(`${label} 必須是整數`);
  }
}

function validateReceiptHead(value: unknown, label: string): Record<string, unknown> {
  const head = receiptRecord(value, label, ['schemaVersion', 'datasetId', 'seq', 'lastCommandId', 'maintenance', 'goLiveDate', 'updatedAt']);
  if (head.schemaVersion !== 1 || typeof head.datasetId !== 'string' || !head.datasetId
    || (head.lastCommandId !== null && typeof head.lastCommandId !== 'string')
    || typeof head.maintenance !== 'boolean') {
    throw new InvalidCloudCommandInput(`${label} schema 不支援`);
  }
  receiptInteger(head.seq, `${label}.seq`);
  dateValue(head.goLiveDate, `${label}.goLiveDate`);
  receiptTimestamp(head.updatedAt, `${label}.updatedAt`);
  return head;
}

function validateReceiptStudent(value: unknown, label: string): Record<string, unknown> {
  const student = receiptRecord(value, label, [
    'studentId', 'studentCode', 'displayName', 'aliases', 'status', 'openingBalance', 'currentBalance', 'createdAt', 'revision', 'lastCommandId', 'updatedAt',
  ]);
  if (typeof student.studentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(student.studentId)
    || typeof student.studentCode !== 'string' || !STUDENT_CODE_REGEX.test(student.studentCode)
    || typeof student.displayName !== 'string' || student.displayName.length < 1 || student.displayName.length > 100
    || !Array.isArray(student.aliases) || student.aliases.length > 10
    || !student.aliases.every(alias => typeof alias === 'string' && alias.length > 0 && alias.length <= 100)
    || (student.status !== 'active' && student.status !== 'inactive')
    || typeof student.lastCommandId !== 'string') {
    throw new InvalidCloudCommandInput(`${label} schema 不支援`);
  }
  const opening = receiptRecord(student.openingBalance, `${label}.openingBalance`, ['amount', 'asOfDate', 'note', 'createdAt']);
  receiptInteger(opening.amount, `${label}.openingBalance.amount`, -1_000_000_000, 1_000_000_000);
  dateValue(opening.asOfDate, `${label}.openingBalance.asOfDate`);
  if (typeof opening.note !== 'string' || opening.note.length > 500) {
    throw new InvalidCloudCommandInput(`${label}.openingBalance.note 不合法`);
  }
  receiptTimestamp(opening.createdAt, `${label}.openingBalance.createdAt`);
  receiptInteger(student.currentBalance, `${label}.currentBalance`, -1_000_000_000);
  if (Math.abs(student.currentBalance) > 1_000_000_000) throw new InvalidCloudCommandInput(`${label}.currentBalance 超出範圍`);
  receiptInteger(student.revision, `${label}.revision`, 1);
  receiptTimestamp(student.createdAt, `${label}.createdAt`);
  receiptTimestamp(student.updatedAt, `${label}.updatedAt`);
  return student;
}

function validateReceiptDay(value: unknown, dayId: string, label: string): Record<string, unknown> {
  const day = receiptRecord(value, label, [
    'status', 'revision', 'menu', 'openingCash', 'openedBy', 'openedAt', 'totals', 'lastSettlementRevision', 'lastCommandId', 'updatedAt',
  ]);
  if (!['open', 'closed', 'reopened'].includes(String(day.status))
    || (day.openingCash !== null && (typeof day.openingCash !== 'number' || !Number.isSafeInteger(day.openingCash) || day.openingCash < 0 || day.openingCash > 20_000))
    || (day.openedBy !== null && (typeof day.openedBy !== 'string' || !day.openedBy))
    || (day.openedAt !== null && !(day.openedAt instanceof Timestamp))
    || ((day.openingCash === null) !== (day.openedBy === null))
    || ((day.openingCash === null) !== (day.openedAt === null))
    || typeof day.lastCommandId !== 'string') {
    throw new InvalidCloudCommandInput(`${label} schema 不支援`);
  }
  receiptInteger(day.revision, `${label}.revision`, 1);
  receiptInteger(day.lastSettlementRevision, `${label}.lastSettlementRevision`);
  receiptTimestamp(day.updatedAt, `${label}.updatedAt`);
  const totals = receiptRecord(day.totals, `${label}.totals`, [
    'activeTransactionCount', 'bentoCount', 'otherMealCount', 'mealTotal', 'retainedReceipts', 'cashierIncome', 'cashierExpense',
    'accountRefunds',
  ]);
  for (const [key, amount] of Object.entries(totals)) {
    receiptInteger(amount, `${label}.totals.${key}`, 0, 1_000_000_000);
  }
  if (day.menu !== null) {
    const menu = receiptRecord(day.menu, `${label}.menu`, [
      'businessDate', 'itemName', 'price', 'vendorId', 'vendorNameSnapshot', 'updatedAt', 'revision', 'inheritedFromDate',
    ]);
    if (menu.businessDate !== dayId || typeof menu.itemName !== 'string' || menu.itemName.length < 1 || menu.itemName.length > 100
      || typeof menu.vendorId !== 'string' || menu.vendorId.length < 1 || menu.vendorId.length > 64 || menu.vendorId.includes('/')
      || typeof menu.vendorNameSnapshot !== 'string' || menu.vendorNameSnapshot.length < 1 || menu.vendorNameSnapshot.length > 100
      || (menu.inheritedFromDate !== null && typeof menu.inheritedFromDate !== 'string')) {
      throw new InvalidCloudCommandInput(`${label}.menu schema 不支援`);
    }
    receiptInteger(menu.price, `${label}.menu.price`, 1, 1_000_000);
    receiptInteger(menu.revision, `${label}.menu.revision`, 1);
    dateValue(menu.businessDate, `${label}.menu.businessDate`);
    if (menu.inheritedFromDate !== null) dateValue(menu.inheritedFromDate, `${label}.menu.inheritedFromDate`);
    receiptTimestamp(menu.updatedAt, `${label}.menu.updatedAt`);
  }
  return day;
}

function validateReceiptVendor(value: unknown, vendorId: string, label: string): Record<string, unknown> {
  const vendor = receiptRecord(value, label, [
    'vendorId', 'name', 'phone', 'note', 'status', 'deleted', 'createdAt', 'revision', 'lastCommandId', 'updatedAt',
  ]);
  if (vendor.vendorId !== vendorId || typeof vendor.name !== 'string' || vendor.name.length < 1 || vendor.name.length > 100
    || typeof vendor.phone !== 'string' || vendor.phone.length > 100
    || typeof vendor.note !== 'string' || vendor.note.length > 500
    || (vendor.status !== 'active' && vendor.status !== 'inactive') || typeof vendor.deleted !== 'boolean'
    || typeof vendor.lastCommandId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(vendor.lastCommandId)) {
    throw new InvalidCloudCommandInput(`${label} schema 不支援`);
  }
  receiptInteger(vendor.revision, `${label}.revision`, 1);
  receiptTimestamp(vendor.createdAt, `${label}.createdAt`);
  receiptTimestamp(vendor.updatedAt, `${label}.updatedAt`);
  return vendor;
}

function validateReceiptTransaction(value: unknown, label: string): Record<string, unknown> {
  const transaction = receiptRecord(value, label, [
    'transactionId', 'studentId', 'businessDate', 'type', 'mealKind', 'mealPrice', 'paidAmount', 'amount',
    'studentNameSnapshot', 'menuNameSnapshot', 'menuPriceSnapshot', 'vendorIdSnapshot', 'vendorNameSnapshot',
    'otherItemName', 'status', 'revision', 'createdAt', 'createdSeq', 'operatorUid', 'operatorEmail',
    'sourceDevice', 'note', 'lastCommandId', 'updatedAt',
  ]);
  for (const key of ['transactionId', 'studentId', 'studentNameSnapshot', 'menuNameSnapshot', 'vendorIdSnapshot', 'vendorNameSnapshot', 'operatorUid', 'operatorEmail', 'sourceDevice', 'note', 'lastCommandId']) {
    if (typeof transaction[key] !== 'string') throw new InvalidCloudCommandInput(`${label}.${key} 不合法`);
  }
  dateValue(transaction.businessDate, `${label}.businessDate`);
  if ((transaction.type !== 'order' && transaction.type !== 'payment' && transaction.type !== 'expense' && transaction.type !== 'refund')
    || (transaction.mealKind !== null && transaction.mealKind !== 'bento' && transaction.mealKind !== 'other')
    || transaction.status !== 'active'
    || (transaction.otherItemName !== null && typeof transaction.otherItemName !== 'string')) {
    throw new InvalidCloudCommandInput(`${label} schema 不支援`);
  }
  receiptInteger(transaction.mealPrice, `${label}.mealPrice`);
  receiptInteger(transaction.paidAmount, `${label}.paidAmount`);
  receiptInteger(transaction.menuPriceSnapshot, `${label}.menuPriceSnapshot`);
  receiptInteger(transaction.revision, `${label}.revision`, 1);
  receiptInteger(transaction.createdSeq, `${label}.createdSeq`, 1);
  if (typeof transaction.amount !== 'number' || !Number.isSafeInteger(transaction.amount)) {
    throw new InvalidCloudCommandInput(`${label}.amount 不合法`);
  }
  receiptTimestamp(transaction.createdAt, `${label}.createdAt`);
  receiptTimestamp(transaction.updatedAt, `${label}.updatedAt`);
  return transaction;
}

function timestampMatches(actual: unknown, expected: Timestamp): boolean {
  return actual instanceof Timestamp && actual.isEqual(expected);
}

function taipeiCalendarDate(timestamp: Timestamp): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(timestamp.toDate());
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function equalExcept(before: Record<string, unknown>, after: Record<string, unknown>, mutableKeys: string[]): boolean {
  const mutable = new Set(mutableKeys);
  return Object.keys(before).every(key => mutable.has(key) || canonicalJson(before[key]) === canonicalJson(after[key]));
}

/** Fixed sentinel `studentId` for counter cash rows (spec §5); never a real student UUID. */
export const CASHIER_STUDENT_ID = '__cashier__';
/** Fixed name snapshot on counter cash rows; same literal as the prototype's expense rows. */
export const CASHIER_NAME_SNAPSHOT = '櫃台';

/** Spec §7.1 cash effect: income 0→+paidAmount (collection), expense 0→−mealPrice (payout). */
export function cashMovementEffect(payload: { mealPrice: number; paidAmount: number }): CommandCashEffect {
  return payload.paidAmount > 0
    ? { before: 0, after: payload.paidAmount, delta: payload.paidAmount, reasonKind: 'collection', refundAmount: 0 }
    : { before: 0, after: -payload.mealPrice, delta: -payload.mealPrice, reasonKind: 'payout', refundAmount: 0 };
}

function validateCashMovementReceipt(
  receipt: Record<string, unknown>,
  normalized: Extract<CanonicalEnabledInput, { kind: 'CreateCashMovement' }>,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  headBefore: Record<string, unknown>,
  committedAt: Timestamp,
): void {
  const commandId = normalized.commandId;
  const dayId = normalized.targets.dayId;
  const payload = normalized.payload;
  if (receipt.businessDate !== dayId || receipt.studentId !== CASHIER_STUDENT_ID || before.transaction !== null
    || receipt.reason !== payload.reason) {
    throw new InvalidCloudCommandInput('櫃台收支 receipt common/before 欄位不一致');
  }
  const dayBefore = validateReceiptDay(before.day, dayId, 'receipt.before.day');
  const dayAfter = validateReceiptDay(after.day, dayId, 'receipt.after.day');
  const transactionAfter = validateReceiptTransaction(after.transaction, 'receipt.after.transaction');
  if (dayId < String(headBefore.goLiveDate) || dayId !== taipeiCalendarDate(committedAt) || dayBefore.status === 'closed') {
    throw new InvalidCloudCommandInput('櫃台收支 receipt 日期或營業日狀態不一致');
  }
  const totalsBefore = dayBefore.totals as Record<string, unknown>;
  const totalsAfter = dayAfter.totals as Record<string, unknown>;
  const expectedTotals: Record<string, number> = {
    activeTransactionCount: Number(totalsBefore.activeTransactionCount) + 1,
    bentoCount: Number(totalsBefore.bentoCount),
    otherMealCount: Number(totalsBefore.otherMealCount),
    mealTotal: Number(totalsBefore.mealTotal),
    retainedReceipts: Number(totalsBefore.retainedReceipts),
    cashierIncome: Number(totalsBefore.cashierIncome) + payload.paidAmount,
    cashierExpense: Number(totalsBefore.cashierExpense) + payload.mealPrice,
    accountRefunds: Number(totalsBefore.accountRefunds),
  };
  if (dayBefore.revision !== normalized.expectedRevisions.day || dayAfter.revision !== Number(dayBefore.revision) + 1
    || dayAfter.lastCommandId !== commandId || !timestampMatches(dayAfter.updatedAt, committedAt)
    || !equalExcept(dayBefore, dayAfter, ['revision', 'totals', 'lastCommandId', 'updatedAt'])
    || Object.entries(expectedTotals).some(([key, value]) => totalsAfter[key] !== value)) {
    throw new InvalidCloudCommandInput('櫃台收支 receipt day snapshots 不一致');
  }
  const actor = receipt.actor as Record<string, unknown>;
  const expectedTransaction: Record<string, unknown> = {
    transactionId: normalized.targets.transactionId,
    studentId: CASHIER_STUDENT_ID,
    businessDate: dayId,
    type: 'expense',
    mealKind: null,
    mealPrice: payload.mealPrice,
    paidAmount: payload.paidAmount,
    amount: payload.paidAmount - payload.mealPrice,
    studentNameSnapshot: CASHIER_NAME_SNAPSHOT,
    menuNameSnapshot: '',
    menuPriceSnapshot: 0,
    vendorIdSnapshot: '',
    vendorNameSnapshot: '',
    otherItemName: null,
    status: 'active',
    revision: 1,
    createdSeq: receipt.seq,
    operatorUid: actor.uid,
    operatorEmail: actor.email,
    sourceDevice: 'pc',
    note: payload.reason,
    lastCommandId: commandId,
  };
  const cash = receipt.cashEffect as Record<string, unknown>;
  const expectedCash = cashMovementEffect(payload);
  if (Object.entries(expectedTransaction).some(([key, value]) => transactionAfter[key] !== value)
    || !timestampMatches(transactionAfter.createdAt, committedAt)
    || !timestampMatches(transactionAfter.updatedAt, committedAt)
    || canonicalJson(cash) !== canonicalJson(expectedCash)) {
    throw new InvalidCloudCommandInput('櫃台收支 receipt transaction 或 cashEffect 不一致');
  }
}

/** Spec §7.1 refund cash effect: 0→−amount, reasonKind refund. Expected cash subtracts it once, via day.totals.accountRefunds. */
export function refundCashEffect(amount: number): CommandCashEffect {
  return { before: 0, after: -amount, delta: -amount, reasonKind: 'refund', refundAmount: amount };
}

function validateRefundReceipt(
  receipt: Record<string, unknown>,
  normalized: Extract<CanonicalEnabledInput, { kind: 'CreateRefund' }>,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  headBefore: Record<string, unknown>,
  committedAt: Timestamp,
): void {
  const commandId = normalized.commandId;
  const { dayId, studentId, transactionId } = normalized.targets;
  const payload = normalized.payload;
  if (receipt.businessDate !== dayId || receipt.studentId !== studentId || before.transaction !== null
    || receipt.reason !== payload.reason) {
    throw new InvalidCloudCommandInput('退款 receipt common/before 欄位不一致');
  }
  const studentBefore = validateReceiptStudent(before.student, 'receipt.before.student');
  const studentAfter = validateReceiptStudent(after.student, 'receipt.after.student');
  const dayBefore = validateReceiptDay(before.day, dayId, 'receipt.before.day');
  const dayAfter = validateReceiptDay(after.day, dayId, 'receipt.after.day');
  const transactionAfter = validateReceiptTransaction(after.transaction, 'receipt.after.transaction');
  if (dayId < String(headBefore.goLiveDate) || dayId !== taipeiCalendarDate(committedAt) || dayBefore.status === 'closed'
    || dayId < String((studentBefore.openingBalance as Record<string, unknown>).asOfDate)) {
    throw new InvalidCloudCommandInput('退款 receipt 日期或營業日狀態不一致');
  }
  if (studentBefore.studentId !== studentId || studentAfter.studentId !== studentId
    || studentBefore.revision !== normalized.expectedRevisions.student
    || studentAfter.revision !== Number(studentBefore.revision) + 1
    || payload.amount > Number(studentBefore.currentBalance)
    || studentAfter.currentBalance !== Number(studentBefore.currentBalance) - payload.amount
    || studentAfter.lastCommandId !== commandId || !timestampMatches(studentAfter.updatedAt, committedAt)
    || !equalExcept(studentBefore, studentAfter, ['currentBalance', 'revision', 'lastCommandId', 'updatedAt'])) {
    throw new InvalidCloudCommandInput('退款 receipt student snapshots 不一致');
  }
  const totalsBefore = dayBefore.totals as Record<string, unknown>;
  const totalsAfter = dayAfter.totals as Record<string, unknown>;
  const expectedTotals: Record<string, number> = {
    activeTransactionCount: Number(totalsBefore.activeTransactionCount) + 1,
    bentoCount: Number(totalsBefore.bentoCount),
    otherMealCount: Number(totalsBefore.otherMealCount),
    mealTotal: Number(totalsBefore.mealTotal),
    retainedReceipts: Number(totalsBefore.retainedReceipts),
    cashierIncome: Number(totalsBefore.cashierIncome),
    cashierExpense: Number(totalsBefore.cashierExpense),
    accountRefunds: Number(totalsBefore.accountRefunds) + payload.amount,
  };
  if (dayBefore.revision !== normalized.expectedRevisions.day || dayAfter.revision !== Number(dayBefore.revision) + 1
    || dayAfter.lastCommandId !== commandId || !timestampMatches(dayAfter.updatedAt, committedAt)
    || !equalExcept(dayBefore, dayAfter, ['revision', 'totals', 'lastCommandId', 'updatedAt'])
    || Object.entries(expectedTotals).some(([key, value]) => totalsAfter[key] !== value)) {
    throw new InvalidCloudCommandInput('退款 receipt day snapshots 不一致');
  }
  const actor = receipt.actor as Record<string, unknown>;
  const expectedTransaction: Record<string, unknown> = {
    transactionId,
    studentId,
    businessDate: dayId,
    type: 'refund',
    mealKind: null,
    mealPrice: 0,
    paidAmount: 0,
    amount: payload.amount,
    studentNameSnapshot: studentBefore.displayName,
    menuNameSnapshot: '',
    menuPriceSnapshot: 0,
    vendorIdSnapshot: '',
    vendorNameSnapshot: '',
    otherItemName: null,
    status: 'active',
    revision: 1,
    createdSeq: receipt.seq,
    operatorUid: actor.uid,
    operatorEmail: actor.email,
    sourceDevice: 'pc',
    note: payload.reason,
    lastCommandId: commandId,
  };
  if (Object.entries(expectedTransaction).some(([key, value]) => transactionAfter[key] !== value)
    || !timestampMatches(transactionAfter.createdAt, committedAt)
    || !timestampMatches(transactionAfter.updatedAt, committedAt)
    || canonicalJson(receipt.cashEffect) !== canonicalJson(refundCashEffect(payload.amount))) {
    throw new InvalidCloudCommandInput('退款 receipt transaction 或 cashEffect 不一致');
  }
}

function validateReceiptSnapshots(
  receipt: Record<string, unknown>,
  normalized: CanonicalEnabledInput,
): void {
  const committedAt = receipt.committedAt as Timestamp;
  const commandId = normalized.commandId;
  const backupKind = normalized.kind === 'RecordBackup';
  const studentKind = normalized.kind === 'CreateStudent' || normalized.kind === 'ChangeStudentCode' || normalized.kind === 'EditStudent' || normalized.kind === 'SetStudentStatus';
  const vendorKind = normalized.kind === 'SaveVendor' || normalized.kind === 'RemoveVendor';
  const dayCommandKind = normalized.kind === 'SetDayMenu' || normalized.kind === 'SetOpeningCash';
  const snapshotKeys = backupKind ? ['head'] : normalized.kind === 'EnsureDay' || dayCommandKind
    ? ['head', 'day']
    : vendorKind ? ['head', 'vendor'] : studentKind ? ['head', 'student']
      : normalized.kind === 'CreateCashMovement' ? ['head', 'day', 'transaction']
        : ['head', 'student', 'day', 'transaction'];
  const before = receiptRecord(receipt.before, 'receipt.before', snapshotKeys);
  const after = receiptRecord(receipt.after, 'receipt.after', snapshotKeys);
  const headBefore = validateReceiptHead(before.head, 'receipt.before.head');
  const headAfter = validateReceiptHead(after.head, 'receipt.after.head');
  if (Number(headBefore.seq) + 1 !== receipt.seq || headAfter.seq !== receipt.seq
    || headBefore.maintenance !== false || headAfter.maintenance !== false
    || headAfter.lastCommandId !== commandId || !timestampMatches(headAfter.updatedAt, committedAt)
    || !equalExcept(headBefore, headAfter, ['seq', 'lastCommandId', 'updatedAt'])) {
    throw new InvalidCloudCommandInput('receipt dataHead snapshots 不一致');
  }

  const cash = receipt.cashEffect as Record<string, unknown>;
  if (backupKind) {
    if (receipt.businessDate !== null || receipt.studentId !== null || before.head === null
      || after.head === null || cash.before !== 0 || cash.after !== 0 || cash.delta !== 0
      || cash.reasonKind !== 'none' || cash.refundAmount !== 0) {
      throw new InvalidCloudCommandInput('RecordBackup receipt snapshot 不一致');
    }
    return;
  }
  if (normalized.kind === 'EnsureDay') {
    if (before.day !== null || receipt.businessDate !== normalized.payload.businessDate || receipt.studentId !== null
      || normalized.targets.dayId < String(headBefore.goLiveDate)) {
      throw new InvalidCloudCommandInput('EnsureDay receipt before/common 欄位不一致');
    }
    const dayAfter = validateReceiptDay(after.day, normalized.targets.dayId, 'receipt.after.day');
    const totals = dayAfter.totals as Record<string, unknown>;
    if (dayAfter.status !== 'open' || dayAfter.revision !== 1 || dayAfter.menu !== null || dayAfter.openingCash !== null
      || dayAfter.openedBy !== null || dayAfter.openedAt !== null || dayAfter.lastSettlementRevision !== 0
      || dayAfter.lastCommandId !== commandId || !timestampMatches(dayAfter.updatedAt, committedAt)
      || Object.values(totals).some(value => value !== 0)
      || cash.before !== 0 || cash.after !== 0 || cash.delta !== 0 || cash.reasonKind !== 'none' || cash.refundAmount !== 0) {
      throw new InvalidCloudCommandInput('EnsureDay receipt after snapshot 不一致');
    }
    return;
  }

  if (studentKind) {
    const studentId = normalized.targets.studentId;
    const payload = normalized.payload;
    if (receipt.businessDate !== null || receipt.studentId !== studentId
      || cash.before !== 0 || cash.after !== 0 || cash.delta !== 0
      || cash.reasonKind !== 'none' || cash.refundAmount !== 0) {
      throw new InvalidCloudCommandInput('學生 receipt 共用欄位或 cashEffect 不一致');
    }

    const studentAfter = validateReceiptStudent(after.student, 'receipt.after.student');
    if (studentAfter.studentId !== studentId || studentAfter.lastCommandId !== commandId
      || studentAfter.revision !== (normalized.kind === 'CreateStudent' ? 1 : normalized.expectedRevisions.student + 1)
      || !timestampMatches(studentAfter.updatedAt, committedAt)) {
      throw new InvalidCloudCommandInput('學生 receipt after snapshot 不一致');
    }

    if (normalized.kind === 'CreateStudent') {
      const studentPayload = payload as CommandPayloadByKind['CreateStudent'];
      if (before.student !== null || receipt.reason !== null
        || studentAfter.status !== 'active' || studentAfter.currentBalance !== studentPayload.openingBalance.amount
        || studentAfter.studentCode !== studentPayload.studentCode
        || studentAfter.displayName !== studentPayload.displayName
        || canonicalJson(studentAfter.aliases) !== canonicalJson(studentPayload.aliases)
        || !timestampMatches(studentAfter.createdAt, committedAt)) {
        throw new InvalidCloudCommandInput('CreateStudent receipt 欄位不一致');
      }
      const opening = studentAfter.openingBalance as Record<string, unknown>;
      if (opening.amount !== studentPayload.openingBalance.amount
        || opening.asOfDate !== studentPayload.openingBalance.asOfDate
        || opening.note !== studentPayload.openingBalance.note
        || !timestampMatches(opening.createdAt, committedAt)) {
        throw new InvalidCloudCommandInput('CreateStudent opening snapshot 不一致');
      }
      const goLiveDate = String(headBefore.goLiveDate);
      const committedTaipeiDate = taipeiCalendarDate(committedAt);
      if (goLiveDate > committedTaipeiDate
        || (opening.asOfDate !== goLiveDate && opening.asOfDate !== committedTaipeiDate)) {
        throw new InvalidCloudCommandInput('CreateStudent opening 日期必須是系統 goLive 日期或提交當下的台北日期');
      }
      return;
    }

    const studentBefore = validateReceiptStudent(before.student, 'receipt.before.student');
    if (studentBefore.studentId !== studentId || studentBefore.revision !== normalized.expectedRevisions.student
      || studentAfter.revision !== studentBefore.revision + 1) {
      throw new InvalidCloudCommandInput('學生 receipt revision 不一致');
    }
    if (normalized.kind === 'ChangeStudentCode') {
      const codePayload = payload as CommandPayloadByKind['ChangeStudentCode'];
      if (studentAfter.studentCode !== codePayload.studentCode
        || studentAfter.studentCode === studentBefore.studentCode
        || !equalExcept(studentBefore, studentAfter, ['studentCode', 'revision', 'lastCommandId', 'updatedAt'])
        || receipt.reason !== codePayload.reason) {
        throw new InvalidCloudCommandInput('ChangeStudentCode receipt 欄位不一致');
      }
      return;
    }
    if (!equalExcept(studentBefore, studentAfter, ['displayName', 'aliases', 'status', 'revision', 'lastCommandId', 'updatedAt'])
      || studentAfter.studentCode !== studentBefore.studentCode) {
      throw new InvalidCloudCommandInput('學生 receipt revision 或欄位差異不一致');
    }
    if (normalized.kind === 'EditStudent') {
      const edit = payload as CommandPayloadByKind['EditStudent'];
      if (receipt.reason !== null
        || (edit.displayName !== undefined && studentAfter.displayName !== edit.displayName)
        || (edit.aliases !== undefined && canonicalJson(studentAfter.aliases) !== canonicalJson(edit.aliases))
        || (edit.displayName === undefined && studentAfter.displayName !== studentBefore.displayName)
        || (edit.aliases === undefined && canonicalJson(studentAfter.aliases) !== canonicalJson(studentBefore.aliases))
        || (studentAfter.displayName === studentBefore.displayName
          && canonicalJson(studentAfter.aliases) === canonicalJson(studentBefore.aliases))
        || studentAfter.status !== studentBefore.status) {
        throw new InvalidCloudCommandInput('EditStudent receipt 欄位不一致');
      }
    } else {
      const status = payload as CommandPayloadByKind['SetStudentStatus'];
      if (studentAfter.status !== status.status || studentAfter.displayName !== studentBefore.displayName
        || canonicalJson(studentAfter.aliases) !== canonicalJson(studentBefore.aliases)
        || studentAfter.status === studentBefore.status
        || receipt.reason !== (status.reason || null)) {
        throw new InvalidCloudCommandInput('SetStudentStatus receipt 欄位不一致');
      }
    }
    return;
  }

  if (vendorKind) {
    const vendorId = normalized.targets.vendorId;
    const payload = normalized.payload as CommandPayloadByKind['SaveVendor' | 'RemoveVendor'];
    const expectedReason = normalized.kind === 'RemoveVendor'
      ? (payload as CommandPayloadByKind['RemoveVendor']).reason : null;
    if (receipt.businessDate !== null || receipt.studentId !== null || receipt.reason !== expectedReason
      || cash.before !== 0 || cash.after !== 0 || cash.delta !== 0
      || cash.reasonKind !== 'none' || cash.refundAmount !== 0) {
      throw new InvalidCloudCommandInput('供應商 receipt 共用欄位或 cashEffect 不一致');
    }
    const vendorAfter = validateReceiptVendor(after.vendor, vendorId, 'receipt.after.vendor');
    if (vendorAfter.lastCommandId !== commandId || !timestampMatches(vendorAfter.updatedAt, committedAt)) {
      throw new InvalidCloudCommandInput('供應商 receipt after metadata 不一致');
    }
    if (normalized.kind === 'SaveVendor') {
      const save = payload as CommandPayloadByKind['SaveVendor'];
      if (save.vendorId !== vendorId || vendorAfter.name !== save.name || vendorAfter.phone !== save.phone
        || vendorAfter.note !== save.note || vendorAfter.status !== save.status || vendorAfter.deleted !== false) {
        throw new InvalidCloudCommandInput('SaveVendor receipt after 欄位不一致');
      }
      if (normalized.expectedRevisions.vendor === 0) {
        if (before.vendor !== null || vendorAfter.revision !== 1 || !timestampMatches(vendorAfter.createdAt, committedAt)) {
          throw new InvalidCloudCommandInput('SaveVendor create receipt 不一致');
        }
      } else {
        const vendorBefore = validateReceiptVendor(before.vendor, vendorId, 'receipt.before.vendor');
        if (vendorBefore.revision !== normalized.expectedRevisions.vendor || vendorBefore.deleted
          || vendorAfter.revision !== vendorBefore.revision + 1
          || !timestampMatches(vendorAfter.createdAt, vendorBefore.createdAt as Timestamp)
          || !equalExcept(vendorBefore, vendorAfter, ['name', 'phone', 'note', 'status', 'revision', 'lastCommandId', 'updatedAt'])) {
          throw new InvalidCloudCommandInput('SaveVendor update receipt revisions/snapshot 不一致');
        }
      }
    } else {
      const remove = payload as CommandPayloadByKind['RemoveVendor'];
      const vendorBefore = validateReceiptVendor(before.vendor, vendorId, 'receipt.before.vendor');
      if (vendorBefore.revision !== normalized.expectedRevisions.vendor || vendorBefore.deleted
        || vendorBefore.status !== 'inactive' || vendorAfter.revision !== vendorBefore.revision + 1
        || vendorAfter.deleted !== true || vendorAfter.status !== 'inactive'
        || vendorAfter.name !== vendorBefore.name || vendorAfter.phone !== vendorBefore.phone
        || vendorAfter.note !== vendorBefore.note || !timestampMatches(vendorAfter.createdAt, vendorBefore.createdAt as Timestamp)
        || remove.reason.length < 1) {
        throw new InvalidCloudCommandInput('RemoveVendor receipt snapshot 不一致');
      }
    }
    return;
  }

  if (dayCommandKind) {
    const dayId = normalized.targets.dayId;
    if (receipt.businessDate !== dayId || receipt.studentId !== null || receipt.reason !== null
      || cash.before !== 0 || cash.after !== 0 || cash.delta !== 0
      || cash.reasonKind !== 'none' || cash.refundAmount !== 0) {
      throw new InvalidCloudCommandInput('營業日命令 receipt 共用欄位或 cashEffect 不一致');
    }
    const dayBefore = validateReceiptDay(before.day, dayId, 'receipt.before.day');
    const dayAfter = validateReceiptDay(after.day, dayId, 'receipt.after.day');
    const committedTaipeiDate = taipeiCalendarDate(committedAt);
    if (dayBefore.revision !== normalized.expectedRevisions.day
      || dayAfter.revision !== Number(dayBefore.revision) + 1
      || dayAfter.lastCommandId !== commandId || !timestampMatches(dayAfter.updatedAt, committedAt)
      || dayBefore.status === 'closed' || dayAfter.status !== dayBefore.status) {
      throw new InvalidCloudCommandInput('營業日命令 receipt revision/status 不一致');
    }
    if (normalized.kind === 'SetDayMenu') {
      const payload = normalized.payload as CommandPayloadByKind['SetDayMenu'];
      const beforeMenu = dayBefore.menu as Record<string, unknown> | null;
      const afterMenu = dayAfter.menu as Record<string, unknown> | null;
      if (dayId < String(headBefore.goLiveDate)
        || normalized.expectedRevisions.headSeq !== headBefore.seq
        || payload.selectionDate !== committedTaipeiDate
        || !afterMenu || afterMenu.businessDate !== dayId || afterMenu.itemName !== payload.itemName
        || afterMenu.price !== payload.price || afterMenu.vendorId !== payload.vendorId
        || afterMenu.vendorNameSnapshot !== payload.vendorNameSnapshot
        || afterMenu.inheritedFromDate !== payload.inheritedFromDate
        || afterMenu.revision !== (beforeMenu === null ? 1 : Number(beforeMenu.revision) + 1)
        || !timestampMatches(afterMenu.updatedAt, committedAt)
        || !equalExcept(dayBefore, dayAfter, ['menu', 'revision', 'lastCommandId', 'updatedAt'])) {
        throw new InvalidCloudCommandInput('SetDayMenu receipt snapshot/date 不一致');
      }
    } else {
      const payload = normalized.payload as CommandPayloadByKind['SetOpeningCash'];
      if (dayId !== committedTaipeiDate || dayId < String(headBefore.goLiveDate)
        || dayAfter.openingCash !== payload.openingCash
        || !equalExcept(dayBefore, dayAfter, ['openingCash', 'openedBy', 'openedAt', 'revision', 'lastCommandId', 'updatedAt'])) {
        throw new InvalidCloudCommandInput('SetOpeningCash receipt date/snapshot 不一致');
      }
      const actorUid = (receipt.actor as Record<string, unknown>).uid;
      if (dayBefore.openingCash === null) {
        if (dayAfter.openedBy !== actorUid || !timestampMatches(dayAfter.openedAt, committedAt)) {
          throw new InvalidCloudCommandInput('首次 SetOpeningCash receipt actor/time 不一致');
        }
      } else if (dayAfter.openedBy !== dayBefore.openedBy
        || !(dayAfter.openedAt as Timestamp).isEqual(dayBefore.openedAt as Timestamp)) {
        throw new InvalidCloudCommandInput('SetOpeningCash receipt 不可更改首次開帳資訊');
      }
    }
    return;
  }

  if (normalized.kind === 'CreateCashMovement') {
    validateCashMovementReceipt(receipt, normalized, before, after, headBefore, committedAt);
    return;
  }

  if (normalized.kind === 'CreateRefund') {
    validateRefundReceipt(receipt, normalized, before, after, headBefore, committedAt);
    return;
  }

  if (normalized.kind !== 'CreateOrder' && normalized.kind !== 'CreatePayment') {
    throw new InvalidCloudCommandInput('command receipt kind 不支援');
  }

  if (receipt.businessDate !== normalized.targets.dayId || receipt.studentId !== normalized.targets.studentId || before.transaction !== null) {
    throw new InvalidCloudCommandInput('交易 receipt common/before 欄位不一致');
  }
  const studentBefore = validateReceiptStudent(before.student, 'receipt.before.student');
  const studentAfter = validateReceiptStudent(after.student, 'receipt.after.student');
  const dayBefore = validateReceiptDay(before.day, normalized.targets.dayId, 'receipt.before.day');
  const dayAfter = validateReceiptDay(after.day, normalized.targets.dayId, 'receipt.after.day');
  const transactionAfter = validateReceiptTransaction(after.transaction, 'receipt.after.transaction');
  const paidAmount = normalized.payload.paidAmount;
  const order = normalized.kind === 'CreateOrder';
  const orderPayload = order ? normalized.payload as CommandPayloadByKind['CreateOrder'] : null;
  const mealPrice = orderPayload?.mealPrice ?? 0;
  const mealKind = orderPayload?.mealKind ?? null;
  const menu = dayBefore.menu as Record<string, unknown> | null;
  if (orderPayload?.mealKind === 'bento' && menu === null) {
    throw new InvalidCloudCommandInput('CreateOrder receipt 缺少今日餐點菜單 snapshot');
  }
  const committedBusinessDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(committedAt.toDate());
  if (normalized.targets.dayId < String(headBefore.goLiveDate)
    || normalized.targets.dayId !== committedBusinessDate
    || dayBefore.status === 'closed'
    || (order && studentBefore.status !== 'active')
    || normalized.targets.dayId < String((studentBefore.openingBalance as Record<string, unknown>).asOfDate)
    || (orderPayload?.mealKind === 'bento'
      && (menu?.revision !== orderPayload.menuRevision || menu?.price !== orderPayload.mealPrice))) {
    throw new InvalidCloudCommandInput('交易 receipt 日期、營業日或菜單快照不一致');
  }
  const expectedStudentBalance = Number(studentBefore.currentBalance) + paidAmount - mealPrice;
  if (studentBefore.studentId !== normalized.targets.studentId || studentAfter.studentId !== normalized.targets.studentId
    || studentBefore.revision !== normalized.expectedRevisions.student
    || studentAfter.revision !== Number(studentBefore.revision) + 1
    || studentAfter.currentBalance !== expectedStudentBalance
    || studentAfter.lastCommandId !== commandId || !timestampMatches(studentAfter.updatedAt, committedAt)
    || !equalExcept(studentBefore, studentAfter, ['currentBalance', 'revision', 'lastCommandId', 'updatedAt'])) {
    throw new InvalidCloudCommandInput('receipt student snapshots 不一致');
  }
  const totalsBefore = dayBefore.totals as Record<string, unknown>;
  const totalsAfter = dayAfter.totals as Record<string, unknown>;
  const expectedTotals = {
    activeTransactionCount: Number(totalsBefore.activeTransactionCount) + 1,
    bentoCount: Number(totalsBefore.bentoCount) + (order && mealKind === 'bento' ? 1 : 0),
    otherMealCount: Number(totalsBefore.otherMealCount) + (order && mealKind === 'other' ? 1 : 0),
    mealTotal: Number(totalsBefore.mealTotal) + mealPrice,
    retainedReceipts: Number(totalsBefore.retainedReceipts) + paidAmount,
  };
  if (dayBefore.revision !== normalized.expectedRevisions.day || dayAfter.revision !== Number(dayBefore.revision) + 1
    || dayAfter.lastCommandId !== commandId || !timestampMatches(dayAfter.updatedAt, committedAt)
    || !equalExcept(dayBefore, dayAfter, ['revision', 'totals', 'lastCommandId', 'updatedAt'])
    || Object.entries(expectedTotals).some(([key, value]) => totalsAfter[key] !== value)
    || totalsAfter.cashierIncome !== totalsBefore.cashierIncome || totalsAfter.cashierExpense !== totalsBefore.cashierExpense
    || totalsAfter.accountRefunds !== totalsBefore.accountRefunds) {
    throw new InvalidCloudCommandInput('receipt day snapshots 不一致');
  }
  const payload = normalized.payload;
  const expectedTransaction = {
    transactionId: normalized.targets.transactionId,
    studentId: normalized.targets.studentId,
    businessDate: normalized.targets.dayId,
    type: order ? 'order' : 'payment',
    mealKind,
    mealPrice,
    paidAmount,
    amount: paidAmount - mealPrice,
    studentNameSnapshot: studentBefore.displayName,
    menuNameSnapshot: orderPayload?.mealKind === 'bento' ? menu?.itemName : '',
    menuPriceSnapshot: orderPayload?.mealKind === 'bento' ? menu?.price : 0,
    vendorIdSnapshot: orderPayload?.mealKind === 'bento' ? menu?.vendorId : '',
    vendorNameSnapshot: orderPayload?.mealKind === 'bento' ? menu?.vendorNameSnapshot : '',
    otherItemName: orderPayload?.otherItemName ?? null,
    status: 'active',
    revision: 1,
    createdSeq: receipt.seq,
    operatorUid: (receipt.actor as Record<string, unknown>).uid,
    operatorEmail: (receipt.actor as Record<string, unknown>).email,
    sourceDevice: 'pc',
    note: payload.note,
    lastCommandId: commandId,
  };
  if (Object.entries(expectedTransaction).some(([key, value]) => transactionAfter[key] !== value)
    || !timestampMatches(transactionAfter.createdAt, committedAt)
    || !timestampMatches(transactionAfter.updatedAt, committedAt)
    || cash.before !== 0 || cash.after !== paidAmount || cash.delta !== paidAmount
    || cash.reasonKind !== (paidAmount > 0 ? 'collection' : 'none') || cash.refundAmount !== 0) {
    throw new InvalidCloudCommandInput('transaction receipt snapshot 或 cashEffect 不一致');
  }
}

export function canonicalJson(value: unknown): string {
  return canonicalValue(value);
}

function commandSemanticInput(input: CanonicalEnabledInput) {
  return {
    commandId: input.commandId,
    kind: input.kind,
    targets: input.targets,
    expectedRevisions: input.expectedRevisions,
    payload: input.payload,
  };
}

export async function fingerprintCommandInput(input: CanonicalEnabledInput): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable');
  const bytes = new TextEncoder().encode(canonicalJson(commandSemanticInput(input)));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function sameCommandSemantics(left: CanonicalEnabledInput, right: unknown): boolean {
  try {
    const normalized = normalizeEnabledCommandInput(right);
    return canonicalJson(commandSemanticInput(left)) === canonicalJson(commandSemanticInput(normalized));
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
  if (![
    'EnsureDay', 'CreateOrder', 'CreatePayment', 'CreateStudent', 'ChangeStudentCode', 'EditStudent', 'SetStudentStatus',
    'SaveVendor', 'RemoveVendor', 'SetDayMenu', 'SetOpeningCash', 'CreateCashMovement', 'CreateRefund', 'RecordBackup',
  ].includes(raw.kind)) {
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
  if (raw.kind === 'SetStudentStatus' || raw.kind === 'RemoveVendor' || raw.kind === 'ChangeStudentCode'
    || raw.kind === 'CreateCashMovement' || raw.kind === 'CreateRefund') {
    if (typeof raw.reason !== 'string' || raw.reason.length < 1 || raw.reason.length > 500) {
      throw new InvalidCloudCommandInput('command receipt.reason 不合法');
    }
  } else if (raw.reason !== null) {
    throw new InvalidCloudCommandInput('command receipt.reason 不合法');
  }
  if (typeof raw.inputFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(raw.inputFingerprint)) {
    throw new InvalidCloudCommandInput('receipt.inputFingerprint 不合法');
  }
  if (!isPlainRecord(raw.actor)) throw new InvalidCloudCommandInput('receipt.actor 不合法');
  exactKeys(raw.actor, ['uid', 'email']);
  stringValue(raw.actor.uid, 'receipt.actor.uid');
  if (typeof raw.actor.email !== 'string' || raw.actor.email.length < 3 || raw.actor.email.length > 254) {
    throw new InvalidCloudCommandInput('receipt.actor.email 不合法');
  }
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
  if ((normalized.kind === 'RemoveVendor' || normalized.kind === 'ChangeStudentCode' || normalized.kind === 'CreateCashMovement'
    || normalized.kind === 'CreateRefund')
    && raw.reason !== (normalized.payload as { reason: string }).reason) {
    throw new InvalidCloudCommandInput(`${normalized.kind} receipt reason 必須與 payload.reason 相同`);
  }
  if (normalized.kind === 'EnsureDay') {
    if (raw.businessDate !== normalized.payload.businessDate || raw.studentId !== null) {
      throw new InvalidCloudCommandInput('EnsureDay receipt 共用欄位不一致');
    }
  } else if (normalized.kind === 'CreateStudent' || normalized.kind === 'ChangeStudentCode' || normalized.kind === 'EditStudent' || normalized.kind === 'SetStudentStatus') {
    if (raw.businessDate !== null || raw.studentId !== normalized.targets.studentId) {
      throw new InvalidCloudCommandInput('學生 receipt 共用欄位不一致');
    }
  } else if ((normalized.kind === 'CreateOrder' || normalized.kind === 'CreatePayment' || normalized.kind === 'CreateRefund')
    && (raw.businessDate !== normalized.targets.dayId || raw.studentId !== normalized.targets.studentId)) {
    throw new InvalidCloudCommandInput('交易 receipt 共用欄位不一致');
  } else if (normalized.kind === 'CreateCashMovement'
    && (raw.businessDate !== normalized.targets.dayId || raw.studentId !== CASHIER_STUDENT_ID)) {
    throw new InvalidCloudCommandInput('櫃台收支 receipt 共用欄位不一致');
  } else if (normalized.kind === 'RecordBackup' && (raw.businessDate !== null || raw.studentId !== null)) {
    throw new InvalidCloudCommandInput('RecordBackup receipt 共用欄位不一致');
  }
  validateReceiptSnapshots(raw, normalized);
  return raw as unknown as StoredEnabledCommandDoc;
}
