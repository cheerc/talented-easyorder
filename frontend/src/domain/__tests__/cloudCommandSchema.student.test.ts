import { describe, expect, it } from 'vitest';
import { normalizeEnabledCommandInput } from '../cloudCommandSchema';

const commandId = '11111111-1111-4111-8111-111111111111';

function createStudent(overrides: Record<string, unknown> = {}) {
  return {
    commandId,
    kind: 'CreateStudent',
    leaseEpoch: 1,
    targets: { studentId: '001' },
    expectedRevisions: { student: 0 },
    payload: {
      displayName: 'Synthetic Student',
      aliases: [],
      openingBalance: { amount: 0, asOfDate: '2026-10-15', note: '' },
      ...overrides,
    },
  };
}

function setStudentStatus(payload: Record<string, unknown>) {
  return {
    commandId,
    kind: 'SetStudentStatus',
    leaseEpoch: 1,
    targets: { studentId: '001' },
    expectedRevisions: { student: 1 },
    payload,
  };
}

describe('student command input contract', () => {
  it.each([-1_000_000_000, 0, 1_000_000_000])('accepts signed integer opening balance %s and preserves string IDs', amount => {
    const normalized = normalizeEnabledCommandInput(createStudent({
      openingBalance: { amount, asOfDate: '2026-10-15', note: '' },
    }));
    expect(normalized).toMatchObject({
      kind: 'CreateStudent',
      targets: { studentId: '001' },
      payload: { openingBalance: { amount } },
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

  it.each(['', '__cashier__', 'invalid/id', 'x'.repeat(65)])('rejects invalid student ID %j', studentId => {
    const input = createStudent();
    input.targets = { studentId };
    expect(() => normalizeEnabledCommandInput(input)).toThrow();
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
