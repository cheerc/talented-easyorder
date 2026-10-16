import { describe, expect, it } from 'vitest';
import { normalizeEnabledCommandInput } from '../cloudCommandSchema';

const commandId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';

function createStudent(overrides: Record<string, unknown> = {}) {
  return {
    commandId,
    kind: 'CreateStudent',
    leaseEpoch: 1,
    targets: { studentId },
    expectedRevisions: { student: 0 },
    payload: {
      studentCode: '001',
      displayName: 'Synthetic Student',
      aliases: [],
      openingBalance: { amount: 0, asOfDate: '2026-10-15', note: '' },
      ...overrides,
    },
  };
}

function changeStudentCode(payload: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    commandId,
    kind: 'ChangeStudentCode',
    leaseEpoch: 1,
    targets: { studentId },
    expectedRevisions: { student: 1 },
    payload,
    ...overrides,
  };
}

function setStudentStatus(payload: Record<string, unknown>) {
  return {
    commandId,
    kind: 'SetStudentStatus',
    leaseEpoch: 1,
    targets: { studentId },
    expectedRevisions: { student: 1 },
    payload,
  };
}

describe('student command input contract', () => {
  it.each([-1_000_000_000, 0, 1_000_000_000])('accepts signed integer opening balance %s and preserves UUID and code', amount => {
    const normalized = normalizeEnabledCommandInput(createStudent({
      openingBalance: { amount, asOfDate: '2026-10-15', note: '' },
    }));
    expect(normalized).toMatchObject({
      kind: 'CreateStudent',
      targets: { studentId },
      payload: { studentCode: '001', openingBalance: { amount } },
    });
  });

  it.each([
    ['fractional amount', 1.5],
    ['negative zero', -0],
    ['amount above bound', 1_000_000_001],
    ['amount below bound', -1_000_000_001],
  ])('rejects %s', (_label, amount) => {
    expect(() => normalizeEnabledCommandInput(createStudent({
      openingBalance: { amount, asOfDate: '2026-10-15', note: '' },
    }))).toThrow();
  });

  it.each(['', '__cashier__', 'invalid/id', '001', 'x'.repeat(65)])('rejects non-UUID student ID %j', invalidStudentId => {
    const input = createStudent();
    input.targets = { studentId: invalidStudentId };
    expect(() => normalizeEnabledCommandInput(input)).toThrow();
  });

  it.each([
    ['5', '005'],
    ['05', '005'],
    ['0005', '005'],
    ['５', '005'],
    [' 099 ', '099'],
    ['1000', '1000'],
    ['001000', '1000'],
  ])('normalizes studentCode %j to canonical %j', (raw, expected) => {
    const normalized = normalizeEnabledCommandInput(createStudent({ studentCode: raw }));
    if (normalized.kind === 'CreateStudent') {
      expect(normalized.payload.studentCode).toBe(expected);
    }
  });

  it.each(['', '0', '00', '000', '-1', 'abc', '1000000'])('rejects invalid studentCode %j', invalidCode => {
    expect(() => normalizeEnabledCommandInput(createStudent({ studentCode: invalidCode }))).toThrow();
  });

  it('ChangeStudentCode normalizes new code and requires reason and revision >= 1', () => {
    const normalized = normalizeEnabledCommandInput(changeStudentCode({
      studentCode: ' 5 ',
      reason: '編號重新編定',
    }));
    expect(normalized).toMatchObject({
      kind: 'ChangeStudentCode',
      targets: { studentId },
      expectedRevisions: { student: 1 },
      payload: { studentCode: '005', reason: '編號重新編定' },
    });

    expect(() => normalizeEnabledCommandInput(changeStudentCode({ studentCode: '002' }))).toThrow();
    expect(() => normalizeEnabledCommandInput(changeStudentCode({ studentCode: '002', reason: '' }))).toThrow();
    expect(() => normalizeEnabledCommandInput(changeStudentCode({ studentCode: '002', reason: 'a'.repeat(501) }))).toThrow();
    expect(() => normalizeEnabledCommandInput(changeStudentCode({ studentCode: '002', reason: 'ok' }, { expectedRevisions: { student: 0 } }))).toThrow();
  });

  it('rejects empty aliases, too many aliases, oversized aliases, whitespace-only names, and unsupported edit fields', () => {
    expect(() => normalizeEnabledCommandInput(createStudent({ aliases: [''] }))).toThrow();
    expect(() => normalizeEnabledCommandInput(createStudent({ aliases: Array(11).fill('alias') }))).toThrow();
    expect(() => normalizeEnabledCommandInput(createStudent({ aliases: ['a'.repeat(101)] }))).toThrow();
    expect(() => normalizeEnabledCommandInput(createStudent({ displayName: '' }))).toThrow();
    expect(() => normalizeEnabledCommandInput({
      commandId,
      kind: 'EditStudent',
      leaseEpoch: 1,
      targets: { studentId: '001' },
      expectedRevisions: { student: 1 },
      payload: { note: 'not a student field' },
    })).toThrow();
  });

  it('keeps nonempty whitespace aliases consistent with Rules, receipt, and server-list schema', () => {
    const normalized = normalizeEnabledCommandInput(createStudent({ aliases: ['   '] }));
    expect(normalized.kind).toBe('CreateStudent');
    if (normalized.kind === 'CreateStudent') expect(normalized.payload.aliases).toEqual(['   ']);
  });

  it('requires a literal nonempty status reason before a command can reach Rules', () => {
    expect(normalizeEnabledCommandInput(setStudentStatus({ status: 'inactive', reason: '整理名單' }))).toMatchObject({
      kind: 'SetStudentStatus',
      payload: { status: 'inactive', reason: '整理名單' },
    });
    expect(() => normalizeEnabledCommandInput(setStudentStatus({ status: 'inactive' }))).toThrow();
    expect(() => normalizeEnabledCommandInput(setStudentStatus({ status: 'inactive', reason: '' }))).toThrow();
    expect(() => normalizeEnabledCommandInput(setStudentStatus({ status: 'inactive', reason: 'x'.repeat(501) }))).toThrow();
  });

  it.each([' ', '\t', '\u00a0', '\ufeff', 'name\ncontinued'])('accepts displayName with exact literal schema value %j', displayName => {
    const normalized = normalizeEnabledCommandInput(createStudent({ displayName }));
    if (normalized.kind === 'CreateStudent') expect(normalized.payload.displayName).toBe(displayName);
  });
});
