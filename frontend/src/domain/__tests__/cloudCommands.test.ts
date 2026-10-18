import { describe, expect, it } from 'vitest';
import {
  ALL_COMMAND_KINDS,
  buildCashEffect,
  CLOUD_SCHEMA_VERSION,
  COMMAND_ERROR_CODES,
  schemaVersion,
} from '../cloudCommands';

describe('cloudCommands: 型別常數與 cashEffect 驗證', () => {
  it('schemaVersion 常數為 1', () => {
    expect(CLOUD_SCHEMA_VERSION).toBe(1);
    expect(schemaVersion).toBe(1);
  });

  it('涵蓋 spec §6.1 規定的 27 種 command kinds（含 P09b CreateRefund、補開帳、開始回填、關帳後補記）', () => {
    expect(ALL_COMMAND_KINDS).toHaveLength(27);
    expect(ALL_COMMAND_KINDS).toContain('CreateStudent');
    expect(ALL_COMMAND_KINDS).toContain('ChangeStudentCode');
    expect(ALL_COMMAND_KINDS).toContain('EditStudent');
    expect(ALL_COMMAND_KINDS).toContain('SetStudentStatus');
    expect(ALL_COMMAND_KINDS).toContain('CorrectOpening');
    expect(ALL_COMMAND_KINDS).toContain('SaveVendor');
    expect(ALL_COMMAND_KINDS).toContain('RemoveVendor');
    expect(ALL_COMMAND_KINDS).toContain('EnsureDay');
    expect(ALL_COMMAND_KINDS).toContain('SetDayMenu');
    expect(ALL_COMMAND_KINDS).toContain('SetOpeningCash');
    expect(ALL_COMMAND_KINDS).toContain('CreateOrder');
    expect(ALL_COMMAND_KINDS).toContain('CreatePayment');
    expect(ALL_COMMAND_KINDS).toContain('CreateCashMovement');
    expect(ALL_COMMAND_KINDS).toContain('CreateRefund');
    expect(ALL_COMMAND_KINDS).toContain('CorrectTransaction');
    expect(ALL_COMMAND_KINDS).toContain('VoidTransaction');
    expect(ALL_COMMAND_KINDS).toContain('CancelKeepDeposit');
    expect(ALL_COMMAND_KINDS).toContain('CancelRefund');
    expect(ALL_COMMAND_KINDS).toContain('Undo');
    expect(ALL_COMMAND_KINDS).toContain('CloseDay');
    expect(ALL_COMMAND_KINDS).toContain('ReopenDay');
    expect(ALL_COMMAND_KINDS).toContain('BackfillOpeningCash');
    expect(ALL_COMMAND_KINDS).toContain('StartBackfill');
    expect(ALL_COMMAND_KINDS).toContain('RecordPostCloseEntry');
    expect(ALL_COMMAND_KINDS).toContain('RecordExport');
    expect(ALL_COMMAND_KINDS).toContain('RecordPrint');
    expect(ALL_COMMAND_KINDS).toContain('RecordBackup');
  });

  it('涵蓋 spec §6.1 規定的 11 種錯誤碼', () => {
    expect(COMMAND_ERROR_CODES).toEqual([
      'ACCESS_BUSY',
      'LEASE_LOST',
      'UNAUTHORIZED',
      'OFFLINE',
      'UNKNOWN_RESULT',
      'REVISION_CONFLICT',
      'DAY_CLOSED',
      'INVALID_INPUT',
      'QUOTA_EXCEEDED',
      'MAINTENANCE',
      'UNSUPPORTED_SCHEMA',
    ]);
  });

  it('buildCashEffect: 新單收款 (0 -> 100, delta +100, reasonKind: collection)', () => {
    const effect = buildCashEffect({
      beforeContribution: 0,
      afterContribution: 100,
      reasonKind: 'collection',
    });
    expect(effect).toEqual({
      before: 0,
      after: 100,
      delta: 100,
      reasonKind: 'collection',
      refundAmount: 0,
    });
  });

  it('buildCashEffect: 取消退款 (100 -> 0, delta -100, reasonKind: refund, refundAmount: 100)', () => {
    const effect = buildCashEffect({
      beforeContribution: 100,
      afterContribution: 0,
      reasonKind: 'refund',
    });
    expect(effect).toEqual({
      before: 100,
      after: 0,
      delta: -100,
      reasonKind: 'refund',
      refundAmount: 100,
    });
  });

  it('buildCashEffect: 留款轉繳費 (100 -> 100, delta 0, reasonKind: none)', () => {
    const effect = buildCashEffect({
      beforeContribution: 100,
      afterContribution: 100,
      reasonKind: 'none',
    });
    expect(effect).toEqual({
      before: 100,
      after: 100,
      delta: 0,
      reasonKind: 'none',
      refundAmount: 0,
    });
  });

  it('buildCashEffect: 收款誤記更正 (100 -> 80, delta -20, reasonKind: correction)', () => {
    const effect = buildCashEffect({
      beforeContribution: 100,
      afterContribution: 80,
      reasonKind: 'correction',
    });
    expect(effect).toEqual({
      before: 100,
      after: 80,
      delta: -20,
      reasonKind: 'correction',
      refundAmount: 0,
    });
  });

  it('buildCashEffect: 櫃台支出 (0 -> -80, delta -80, reasonKind: payout)', () => {
    const effect = buildCashEffect({
      beforeContribution: 0,
      afterContribution: -80,
      reasonKind: 'payout',
    });
    expect(effect).toEqual({
      before: 0,
      after: -80,
      delta: -80,
      reasonKind: 'payout',
      refundAmount: 0,
    });
  });
});
