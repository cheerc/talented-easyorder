import { describe, expect, it } from 'vitest';
import { ALL_COMMAND_KINDS } from '../cloudCommands';
import { normalizeEnabledCommandInput } from '../cloudCommandSchema';

const commandId = '11111111-1111-4111-8111-111111111111';
const studentId = '22222222-2222-4222-8222-222222222222';

function recordExport(payload: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    commandId, kind: 'RecordExport', leaseEpoch: 1, targets: {}, expectedRevisions: {}, payload,
    ...overrides,
  };
}

function recordPrint(payload: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return {
    commandId, kind: 'RecordPrint', leaseEpoch: 1, targets: {}, expectedRevisions: {}, payload,
    ...overrides,
  };
}

describe('P12b report action command schema', () => {
  it('enables RecordExport and RecordPrint in the existing command union', () => {
    expect(ALL_COMMAND_KINDS).toContain('RecordExport');
    expect(ALL_COMMAND_KINDS).toContain('RecordPrint');
    expect(normalizeEnabledCommandInput(recordExport({
      exportType: 'transactions-original', dateRange: { start: '2026-10-01', end: '2026-10-31' },
      scope: { studentId }, sourceSeq: 12,
    }))).toMatchObject({
      kind: 'RecordExport', targets: {}, expectedRevisions: {},
      payload: { exportType: 'transactions-original', dateRange: { start: '2026-10-01', end: '2026-10-31' }, scope: { studentId }, sourceSeq: 12 },
    });
    expect(normalizeEnabledCommandInput(recordPrint({
      printType: 'ledger-merged', businessDate: '2026-10-17',
      dateRange: { start: '2026-10-01', end: '2026-10-31' }, scope: { studentId }, sourceSeq: 12,
    }))).toMatchObject({
      kind: 'RecordPrint', targets: {}, expectedRevisions: {},
      payload: { printType: 'ledger-merged', businessDate: '2026-10-17', dateRange: { start: '2026-10-01', end: '2026-10-31' }, scope: { studentId }, sourceSeq: 12 },
    });
  });

  it('accepts Gregorian future tails and an inclusive 31-day cross-month range', () => {
    expect(() => normalizeEnabledCommandInput(recordExport({
      exportType: 'settlements', dateRange: { start: '2026-01-31', end: '2026-03-02' }, scope: { studentId: null }, sourceSeq: 0,
    }))).not.toThrow();
    expect(() => normalizeEnabledCommandInput(recordPrint({
      printType: 'ledger-original', businessDate: '2027-01-15',
      dateRange: { start: '2027-01-01', end: '2027-01-31' }, scope: { studentId: null }, sourceSeq: 0,
    }))).not.toThrow();
  });

  it.each([
    ['32 inclusive days', { dateRange: { start: '2026-01-31', end: '2026-03-03' } }],
    ['impossible calendar date', { dateRange: { start: '2026-02-30', end: '2026-03-02' } }],
    ['reversed range', { dateRange: { start: '2026-10-02', end: '2026-10-01' } }],
    ['extra range key', { dateRange: { start: '2026-10-01', end: '2026-10-02', kind: 'week' } }],
    ['unsupported export type', { exportType: 'pdf' }],
    ['unsafe source sequence', { sourceSeq: Number.MAX_SAFE_INTEGER + 1 }],
    ['negative source sequence', { sourceSeq: -1 }],
    ['non-UUID account scope', { scope: { studentId: '002' } }],
    ['settlement account scope', { exportType: 'settlements', scope: { studentId } }],
    ['post-close account scope', { exportType: 'post-close-entries', scope: { studentId } }],
    ['extra payload key', { unexpected: true }],
  ])('rejects %s', (_label, overrides) => {
    const payload = {
      exportType: 'transactions-original', dateRange: { start: '2026-10-01', end: '2026-10-02' },
      scope: { studentId: null }, sourceSeq: 1, ...overrides,
    };
    expect(() => normalizeEnabledCommandInput(recordExport(payload))).toThrow();
  });

  it.each([
    ['anchor outside the range', { businessDate: '2026-11-01' }],
    ['invalid calendar anchor', { businessDate: '2026-02-30' }],
    ['32 inclusive days', { dateRange: { start: '2026-01-31', end: '2026-03-03' } }],
    ['unsupported print type', { printType: 'pdf' }],
    ['non-UUID account scope', { scope: { studentId: '姓名' } }],
    ['extra print payload key', { filename: 'report.pdf' }],
  ])('rejects print with %s', (_label, overrides) => {
    const payload = {
      printType: 'ledger-original', businessDate: '2026-10-02',
      dateRange: { start: '2026-10-01', end: '2026-10-31' }, scope: { studentId: null }, sourceSeq: 1, ...overrides,
    };
    expect(() => normalizeEnabledCommandInput(recordPrint(payload))).toThrow();
  });
});
