import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { ALL_COMMAND_KINDS } from '../cloudCommands';
import {
  decodeEnabledCommandDoc,
  fingerprintCommandInput,
  normalizeEnabledCommandInput,
  sameCommandSemantics,
} from '../cloudCommandSchema';

const commandId = '11111111-1111-4111-8111-111111111111';
const priorCommandId = '22222222-2222-4222-8222-222222222222';

function timestamp(iso: string) {
  return Timestamp.fromDate(new Date(iso));
}

function receiptHead(seq: number, lastCommandId: string, updatedAt: Timestamp) {
  return {
    schemaVersion: 1,
    datasetId: 'synthetic-day-vendor-fixture',
    seq,
    lastCommandId,
    maintenance: false,
    goLiveDate: '2024-01-01',
    updatedAt,
  };
}

function daySnapshot(options: {
  revision: number;
  lastCommandId: string;
  updatedAt: Timestamp;
  menu?: Record<string, unknown> | null;
  openingCash?: number | null;
  openedBy?: string | null;
  openedAt?: Timestamp | null;
}) {
  return {
    status: 'open',
    revision: options.revision,
    menu: options.menu ?? null,
    openingCash: options.openingCash ?? null,
    openedBy: options.openedBy ?? null,
    openedAt: options.openedAt ?? null,
    totals: {
      activeTransactionCount: 0,
      bentoCount: 0,
      otherMealCount: 0,
      mealTotal: 0,
      retainedReceipts: 0,
      cashierIncome: 0,
      cashierExpense: 0, accountRefunds: 0,
    },
    lastSettlementRevision: 0,
    lastCommandId: options.lastCommandId,
    updatedAt: options.updatedAt,
  };
}

function commonReceipt(options: {
  kind: string;
  committedAt: Timestamp;
  businessDate: string | null;
  studentId?: string | null;
  targets: Record<string, unknown>;
  expectedRevisions: Record<string, number>;
  payload: Record<string, unknown>;
  reason?: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}) {
  return {
    commandId,
    kind: options.kind,
    seq: 51,
    leaseEpoch: 1,
    actor: { uid: 'operator-001', email: 'operator@example.test' },
    committedAt: options.committedAt,
    businessDate: options.businessDate,
    studentId: options.studentId ?? null,
    targets: options.targets,
    expectedRevisions: options.expectedRevisions,
    before: options.before,
    after: options.after,
    reason: options.reason ?? null,
    cashEffect: { before: 0, after: 0, delta: 0, reasonKind: 'none', refundAmount: 0 },
    payload: options.payload,
    inputFingerprint: 'a'.repeat(64),
  };
}

const historicalCommit = timestamp('2025-01-02T15:59:00.000Z');
const historicalPreviousUpdate = timestamp('2025-01-01T15:00:00.000Z');

function dayReceipt(kind: 'SetDayMenu' | 'SetOpeningCash') {
  const dayId = kind === 'SetDayMenu' ? '2025-01-03' : '2025-01-02';
  const selectionDate = '2025-01-02';
  const menu = {
    businessDate: dayId,
    itemName: '白菜豆腐鍋',
    price: 80,
    vendorId: 'vendor-001',
    vendorNameSnapshot: 'Fresh Produce',
    updatedAt: historicalCommit,
    revision: 1,
    inheritedFromDate: null,
  };
  const beforeDay = daySnapshot({ revision: 2, lastCommandId: priorCommandId, updatedAt: historicalPreviousUpdate });
  const afterDay = kind === 'SetDayMenu'
    ? daySnapshot({ revision: 3, lastCommandId: commandId, updatedAt: historicalCommit, menu })
    : daySnapshot({
      revision: 3, lastCommandId: commandId, updatedAt: historicalCommit,
      openingCash: 0, openedBy: 'operator-001', openedAt: historicalCommit,
    });
  return commonReceipt({
    kind,
    committedAt: historicalCommit,
    businessDate: dayId,
    targets: { dayId },
    expectedRevisions: kind === 'SetDayMenu' ? { day: 2, headSeq: 50 } : { day: 2 },
    payload: kind === 'SetDayMenu'
      ? { selectionDate, itemName: '白菜豆腐鍋', price: 80, vendorId: 'vendor-001', vendorNameSnapshot: 'Fresh Produce', inheritedFromDate: null }
      : { openingCash: 0 },
    before: {
      head: receiptHead(50, priorCommandId, historicalPreviousUpdate),
      day: beforeDay,
    },
    after: {
      head: receiptHead(51, commandId, historicalCommit),
      day: afterDay,
    },
  });
}

function vendorReceipt(kind: 'SaveVendor' | 'RemoveVendor') {
  const createdAt = timestamp('2024-06-01T03:00:00.000Z');
  const payload = kind === 'SaveVendor'
    ? { vendorId: 'vendor-001', name: 'Fresh Produce', phone: '', note: '', status: 'active' }
    : { reason: '停止供貨' };
  const beforeVendor = kind === 'SaveVendor' ? null : {
    vendorId: 'vendor-001', name: 'Fresh Produce', phone: '02-1234', note: '冷藏配送', status: 'inactive',
    deleted: false, createdAt, revision: 4, lastCommandId: priorCommandId, updatedAt: historicalPreviousUpdate,
  };
  const afterVendor = kind === 'SaveVendor'
    ? {
      vendorId: 'vendor-001', name: 'Fresh Produce', phone: '', note: '', status: 'active', deleted: false,
      createdAt: historicalCommit, revision: 1, lastCommandId: commandId, updatedAt: historicalCommit,
    }
    : {
      vendorId: 'vendor-001', name: 'Fresh Produce', phone: '02-1234', note: '冷藏配送', status: 'inactive',
      deleted: true, createdAt, revision: 5, lastCommandId: commandId, updatedAt: historicalCommit,
    };
  return commonReceipt({
    kind,
    committedAt: historicalCommit,
    businessDate: null,
    targets: { vendorId: 'vendor-001' },
    expectedRevisions: { vendor: kind === 'SaveVendor' ? 0 : 4 },
    payload,
    reason: kind === 'RemoveVendor' ? '停止供貨' : null,
    before: {
      head: receiptHead(50, priorCommandId, historicalPreviousUpdate),
      vendor: beforeVendor,
    },
    after: {
      head: receiptHead(51, commandId, historicalCommit),
      vendor: afterVendor,
    },
  });
}

function saveVendor(overrides: Record<string, unknown> = {}) {
  const vendorId = typeof overrides.vendorId === 'string' ? overrides.vendorId : 'vendor-001';
  return {
    commandId,
    kind: 'SaveVendor',
    leaseEpoch: 1,
    targets: { vendorId },
    expectedRevisions: { vendor: 0 },
    payload: {
      vendorId, name: 'Fresh Produce', phone: '', note: '', status: 'active',
      ...overrides,
    },
  };
}

function removeVendor(overrides: {
  vendorId?: string;
  expectedRevision?: number;
  reason?: string;
  targetExtras?: Record<string, unknown>;
  revisionExtras?: Record<string, unknown>;
} = {}) {
  const { vendorId = 'vendor-001', expectedRevision = 4, reason = '停止供貨', targetExtras, revisionExtras } = overrides;
  return {
    commandId,
    kind: 'RemoveVendor',
    leaseEpoch: 1,
    targets: { vendorId, ...targetExtras },
    expectedRevisions: { vendor: expectedRevision, ...revisionExtras },
    payload: { reason },
  };
}

function setDayMenu(overrides: {
  dayId?: string;
  selectionDate?: string;
  expectedRevision?: number;
  expectedHeadSeq?: number;
  payload?: Record<string, unknown>;
  targetExtras?: Record<string, unknown>;
  revisionExtras?: Record<string, unknown>;
} = {}) {
  const {
    dayId = '2026-10-16', selectionDate = '2026-10-15', expectedRevision = 2,
    expectedHeadSeq = 38, payload, targetExtras, revisionExtras,
  } = overrides;
  return {
    commandId,
    kind: 'SetDayMenu',
    leaseEpoch: 1,
    targets: { dayId, ...targetExtras },
    expectedRevisions: { day: expectedRevision, headSeq: expectedHeadSeq, ...revisionExtras },
    payload: {
      selectionDate,
      itemName: '白菜豆腐鍋',
      price: 80,
      vendorId: 'vendor-001',
      vendorNameSnapshot: 'Fresh Produce',
      inheritedFromDate: null,
      ...payload,
    },
  };
}

function setOpeningCash(overrides: {
  dayId?: string;
  expectedRevision?: number;
  openingCash?: number;
  targetExtras?: Record<string, unknown>;
  revisionExtras?: Record<string, unknown>;
  payloadExtras?: Record<string, unknown>;
} = {}) {
  const {
    dayId = '2026-10-15', expectedRevision = 3, openingCash = 0,
    targetExtras, revisionExtras, payloadExtras,
  } = overrides;
  return {
    commandId,
    kind: 'SetOpeningCash',
    leaseEpoch: 1,
    targets: { dayId, ...targetExtras },
    expectedRevisions: { day: expectedRevision, ...revisionExtras },
    payload: { openingCash, ...payloadExtras },
  };
}

describe('day and vendor command input contract', () => {
  it('normalizes all four frozen command shapes without changing literal field values', () => {
    expect(normalizeEnabledCommandInput(saveVendor({ name: ' ', phone: '  ', note: '\t' }))).toMatchObject({
      kind: 'SaveVendor',
      targets: { vendorId: 'vendor-001' },
      expectedRevisions: { vendor: 0 },
      payload: { vendorId: 'vendor-001', name: ' ', phone: '  ', note: '\t', status: 'active' },
    });
    expect(normalizeEnabledCommandInput(removeVendor({ reason: ' ' }))).toMatchObject({
      kind: 'RemoveVendor',
      expectedRevisions: { vendor: 4 },
      payload: { reason: ' ' },
    });
    expect(normalizeEnabledCommandInput(setDayMenu())).toMatchObject({
      kind: 'SetDayMenu',
      targets: { dayId: '2026-10-16' },
      expectedRevisions: { day: 2, headSeq: 38 },
      payload: { selectionDate: '2026-10-15', inheritedFromDate: null, price: 80 },
    });
    expect(normalizeEnabledCommandInput(setOpeningCash({ openingCash: 20_000 }))).toMatchObject({
      kind: 'SetOpeningCash',
      expectedRevisions: { day: 3 },
      payload: { openingCash: 20_000 },
    });
  });

  it('keeps the seven prior kinds, these four, P09a CreateCashMovement and P09b CreateRefund enabled and rejects the remaining twelve', () => {
    const enabled = new Set([
      'EnsureDay', 'CreateOrder', 'CreatePayment', 'CreateStudent', 'ChangeStudentCode', 'EditStudent', 'SetStudentStatus',
      'SaveVendor', 'RemoveVendor', 'SetDayMenu', 'SetOpeningCash', 'CreateCashMovement', 'CreateRefund',
    ]);
    const disabled = ALL_COMMAND_KINDS.filter(kind => !enabled.has(kind));
    expect(ALL_COMMAND_KINDS).toHaveLength(25);
    expect(disabled).toHaveLength(12);
    for (const kind of disabled) {
      expect(() => normalizeEnabledCommandInput({
        commandId, kind, leaseEpoch: 1, targets: {}, expectedRevisions: {}, payload: {},
      }), `${kind} remains disabled`).toThrow();
    }
  });

  it('accepts vendor IDs up to 64 literal characters, including the student-reserved-looking value', () => {
    expect(normalizeEnabledCommandInput(saveVendor({ vendorId: '__cashier__' }))).toMatchObject({
      targets: { vendorId: '__cashier__' },
      payload: { vendorId: '__cashier__' },
    });
    expect(normalizeEnabledCommandInput(saveVendor({ vendorId: 'v'.repeat(64) }))).toMatchObject({
      targets: { vendorId: 'v'.repeat(64) },
    });
  });

  it.each(['', 'v'.repeat(65), 'vendor/001'])('rejects invalid vendor ID %j for vendor and menu inputs', vendorId => {
    expect(() => normalizeEnabledCommandInput(saveVendor({ vendorId }))).toThrow();
    expect(() => normalizeEnabledCommandInput({
      ...setDayMenu(), payload: { ...setDayMenu().payload, vendorId },
    })).toThrow();
  });

  it.each([
    ['empty name', ''],
    ['name longer than 100 characters', 'n'.repeat(101)],
  ])('rejects SaveVendor %s', (_label, name) => {
    expect(() => normalizeEnabledCommandInput(saveVendor({ name }))).toThrow();
  });

  it('enforces the literal phone and note bounds while permitting empty strings for clearing', () => {
    expect(normalizeEnabledCommandInput(saveVendor({ phone: '', note: '' }))).toMatchObject({
      payload: { phone: '', note: '' },
    });
    expect(() => normalizeEnabledCommandInput(saveVendor({ phone: 'p'.repeat(101) }))).toThrow();
    expect(() => normalizeEnabledCommandInput(saveVendor({ note: 'n'.repeat(501) }))).toThrow();
    expect(normalizeEnabledCommandInput(saveVendor({ phone: 'p'.repeat(100), note: 'n'.repeat(500) }))).toMatchObject({
      payload: { phone: 'p'.repeat(100), note: 'n'.repeat(500) },
    });
  });

  it('requires active status for vendor creation and positive exact revision for edits', () => {
    expect(() => normalizeEnabledCommandInput(saveVendor({ status: 'inactive' }))).toThrow();
    expect(normalizeEnabledCommandInput({
      ...saveVendor({ status: 'inactive' }), expectedRevisions: { vendor: 1 },
    })).toMatchObject({ expectedRevisions: { vendor: 1 }, payload: { status: 'inactive' } });
    expect(() => normalizeEnabledCommandInput({
      ...saveVendor(), expectedRevisions: { vendor: 1.5 },
    })).toThrow();
    expect(() => normalizeEnabledCommandInput({
      ...saveVendor(), expectedRevisions: { vendor: -1 },
    })).toThrow();
  });

  it('requires a literal removal reason and an existing vendor revision', () => {
    expect(() => normalizeEnabledCommandInput(removeVendor({ reason: '' }))).toThrow();
    expect(() => normalizeEnabledCommandInput(removeVendor({ reason: 'r'.repeat(501) }))).toThrow();
    expect(normalizeEnabledCommandInput(removeVendor({ reason: 'r'.repeat(500) }))).toMatchObject({
      payload: { reason: 'r'.repeat(500) },
    });
    expect(() => normalizeEnabledCommandInput(removeVendor({ expectedRevision: 0 }))).toThrow();
    expect(() => normalizeEnabledCommandInput(removeVendor({ expectedRevision: -1 }))).toThrow();
    expect(() => normalizeEnabledCommandInput(removeVendor({ expectedRevision: 1.5 }))).toThrow();
  });

  it('rejects target, revision, and payload keys outside each frozen shape', () => {
    expect(() => normalizeEnabledCommandInput({ ...saveVendor(), targets: { vendorId: 'vendor-001', dayId: '2026-10-15' } })).toThrow();
    expect(() => normalizeEnabledCommandInput({ ...saveVendor(), expectedRevisions: { vendor: 0, day: 0 } })).toThrow();
    expect(() => normalizeEnabledCommandInput(saveVendor({ unexpected: true }))).toThrow();
    expect(() => normalizeEnabledCommandInput(removeVendor({ targetExtras: { dayId: '2026-10-15' } }))).toThrow();
    expect(() => normalizeEnabledCommandInput(removeVendor({ revisionExtras: { headSeq: 38 } }))).toThrow();
    expect(() => normalizeEnabledCommandInput({ ...setDayMenu(), targets: { dayId: '2026-10-16', vendorId: 'vendor-001' } })).toThrow();
    expect(() => normalizeEnabledCommandInput(setDayMenu({ revisionExtras: { vendor: 2 } }))).toThrow();
    expect(() => normalizeEnabledCommandInput(setDayMenu({ payload: { extra: true } }))).toThrow();
    expect(() => normalizeEnabledCommandInput(setOpeningCash({ targetExtras: { vendorId: 'vendor-001' } }))).toThrow();
    expect(() => normalizeEnabledCommandInput(setOpeningCash({ revisionExtras: { headSeq: 38 } }))).toThrow();
    expect(() => normalizeEnabledCommandInput(setOpeningCash({ payloadExtras: { clear: true } }))).toThrow();
  });

  it('validates canonical calendar dates and inheritance source ordering', () => {
    expect(() => normalizeEnabledCommandInput(setDayMenu({ dayId: '2026-02-30' }))).toThrow();
    expect(() => normalizeEnabledCommandInput(setDayMenu({ selectionDate: '2026-02-30' }))).toThrow();
    expect(() => normalizeEnabledCommandInput(setDayMenu({ payload: { inheritedFromDate: '2026-02-30' } }))).toThrow();
    expect(() => normalizeEnabledCommandInput(setDayMenu({ payload: { inheritedFromDate: '2026-10-16' } }))).toThrow();
    expect(() => normalizeEnabledCommandInput(setDayMenu({
      selectionDate: '2026-10-15', payload: { inheritedFromDate: '2026-10-16' },
    }))).toThrow();
    expect(normalizeEnabledCommandInput(setDayMenu({
      payload: { inheritedFromDate: '2026-10-14' },
    }))).toMatchObject({ payload: { inheritedFromDate: '2026-10-14' } });
  });

  it.each([0, 1.5, 1_000_001, -0])('rejects menu price %s outside 1..1,000,000 safe integers', price => {
    expect(() => normalizeEnabledCommandInput(setDayMenu({ payload: { price } }))).toThrow();
  });

  it('accepts menu field bounds and rejects empty or oversized literal names', () => {
    expect(normalizeEnabledCommandInput(setDayMenu({ payload: {
      itemName: 'i'.repeat(100), vendorNameSnapshot: 'v'.repeat(100), price: 1_000_000,
    } }))).toMatchObject({ payload: { itemName: 'i'.repeat(100), vendorNameSnapshot: 'v'.repeat(100) } });
    expect(() => normalizeEnabledCommandInput(setDayMenu({ payload: { itemName: '' } }))).toThrow();
    expect(() => normalizeEnabledCommandInput(setDayMenu({ payload: { itemName: 'i'.repeat(101) } }))).toThrow();
    expect(() => normalizeEnabledCommandInput(setDayMenu({ payload: { vendorNameSnapshot: '' } }))).toThrow();
    expect(() => normalizeEnabledCommandInput(setDayMenu({ payload: { vendorNameSnapshot: 'v'.repeat(101) } }))).toThrow();
  });

  it('accepts explicit zero opening cash and rejects invalid, negative-zero, and over-limit values', () => {
    expect(normalizeEnabledCommandInput(setOpeningCash({ openingCash: 0 }))).toMatchObject({ payload: { openingCash: 0 } });
    expect(normalizeEnabledCommandInput(setOpeningCash({ openingCash: 20_000 }))).toMatchObject({ payload: { openingCash: 20_000 } });
    for (const openingCash of [-1, 20_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY, -0]) {
      expect(() => normalizeEnabledCommandInput(setOpeningCash({ openingCash }))).toThrow();
    }
  });

  it('includes SetDayMenu selectionDate and headSeq in canonical identity and replay semantics', async () => {
    const canonical = normalizeEnabledCommandInput(setDayMenu());
    const differentHead = normalizeEnabledCommandInput(setDayMenu({ expectedHeadSeq: 39 }));
    const differentSelectionDate = normalizeEnabledCommandInput(setDayMenu({ selectionDate: '2026-10-14' }));
    expect(sameCommandSemantics(canonical, setDayMenu())).toBe(true);
    expect(sameCommandSemantics(canonical, setDayMenu({ expectedHeadSeq: 39 }))).toBe(false);
    expect(sameCommandSemantics(canonical, setDayMenu({ selectionDate: '2026-10-14' }))).toBe(false);
    expect(await fingerprintCommandInput(canonical)).not.toBe(await fingerprintCommandInput(differentHead));
    expect(await fingerprintCommandInput(canonical)).not.toBe(await fingerprintCommandInput(differentSelectionDate));
    expect(sameCommandSemantics(canonical, setDayMenu({ dayId: '2026-10-17' }))).toBe(false);
    expect(sameCommandSemantics(canonical, setDayMenu({ payload: { price: 81 } }))).toBe(false);
    expect(sameCommandSemantics(canonical, saveVendor())).toBe(false);
  });

  it('decodes historical receipts for each new kind from committedAt Taipei date', () => {
    for (const receipt of [
      vendorReceipt('SaveVendor'),
      vendorReceipt('RemoveVendor'),
      dayReceipt('SetDayMenu'),
      dayReceipt('SetOpeningCash'),
    ]) {
      expect(decodeEnabledCommandDoc(receipt).kind).toBe(receipt.kind);
    }
  });

  it('rejects a historical SetDayMenu receipt whose frozen selectionDate differs from committedAt Taipei date', () => {
    const receipt = dayReceipt('SetDayMenu');
    const invalid = {
      ...receipt,
      payload: { ...receipt.payload, selectionDate: '2025-01-01' },
    };
    expect(() => decodeEnabledCommandDoc(invalid)).toThrow();
  });

  it('rejects a SetDayMenu receipt whose stored headSeq differs from before.head.seq even with a matching recomputed fingerprint', async () => {
    const receipt = dayReceipt('SetDayMenu');
    const storedInput = normalizeEnabledCommandInput({
      commandId: receipt.commandId,
      kind: receipt.kind,
      leaseEpoch: receipt.leaseEpoch,
      targets: receipt.targets,
      expectedRevisions: { ...receipt.expectedRevisions, headSeq: 49 },
      payload: receipt.payload,
    });
    const tamperedReceipt = {
      ...receipt,
      expectedRevisions: storedInput.expectedRevisions,
      inputFingerprint: await fingerprintCommandInput(storedInput),
    };

    expect(tamperedReceipt.expectedRevisions).toMatchObject({ day: 2, headSeq: 49 });
    expect((tamperedReceipt.before.head as Record<string, unknown>).seq).toBe(50);
    expect(() => decodeEnabledCommandDoc(tamperedReceipt)).toThrow();
  });

  it('requires RemoveVendor receipt envelope reason to exactly match its frozen payload reason', () => {
    const receipt = vendorReceipt('RemoveVendor');
    expect(receipt.reason).toBe(receipt.payload.reason);
    for (const reason of [null, '', '不同原因', 'r'.repeat(501)]) {
      expect(() => decodeEnabledCommandDoc({ ...receipt, reason })).toThrow();
    }
  });
});

describe('SetOpeningCash optional difference reason (contract §11)', () => {
  const reason = '前一天實點與開帳不同';

  it('normalizes a payload with or without a reason and keeps the two forms distinct', async () => {
    expect(normalizeEnabledCommandInput(setOpeningCash({ payloadExtras: { reason } }))).toMatchObject({
      kind: 'SetOpeningCash', payload: { openingCash: 0, reason },
    });
    expect(normalizeEnabledCommandInput(setOpeningCash())).toMatchObject({ payload: { openingCash: 0 } });
    expect('reason' in normalizeEnabledCommandInput(setOpeningCash()).payload).toBe(false);
    expect(sameCommandSemantics(normalizeEnabledCommandInput(setOpeningCash({ payloadExtras: { reason } })), setOpeningCash())).toBe(false);
    expect(await fingerprintCommandInput(normalizeEnabledCommandInput(setOpeningCash({ payloadExtras: { reason } }))))
      .not.toBe(await fingerprintCommandInput(normalizeEnabledCommandInput(setOpeningCash())));
  });

  it.each([
    ['empty', ''],
    ['501 characters', 'x'.repeat(501)],
    ['a number', 5],
    ['null', null],
  ])('rejects a reason that is %s, and any extra payload key', (_label, bad) => {
    expect(() => normalizeEnabledCommandInput(setOpeningCash({ payloadExtras: { reason: bad } }))).toThrow();
    expect(() => normalizeEnabledCommandInput(setOpeningCash({ payloadExtras: { reason, note: '' } }))).toThrow();
  });

  it('accepts exactly 500 characters', () => {
    expect(normalizeEnabledCommandInput(setOpeningCash({ payloadExtras: { reason: 'x'.repeat(500) } }))).toMatchObject({ kind: 'SetOpeningCash' });
  });

  it('decodes a receipt whose command reason mirrors the payload reason, and rejects mismatches', () => {
    const base = dayReceipt('SetOpeningCash');
    expect(decodeEnabledCommandDoc({ ...base, payload: { openingCash: 0, reason }, reason }).kind).toBe('SetOpeningCash');
    expect(() => decodeEnabledCommandDoc({ ...base, payload: { openingCash: 0, reason }, reason: null })).toThrow();
    expect(() => decodeEnabledCommandDoc({ ...base, payload: { openingCash: 0, reason }, reason: 'other' })).toThrow();
    expect(() => decodeEnabledCommandDoc({ ...base, reason })).toThrow();
    expect(() => decodeEnabledCommandDoc({ ...base, payload: { openingCash: 0, reason: '' }, reason: '' })).toThrow();
  });
});
