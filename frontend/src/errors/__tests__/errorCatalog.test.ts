import { describe, expect, it } from 'vitest';
import { getCommandDiagnosticNextStep, getSystemDiagnosticNextStep, getUserErrorMessage } from '../errorCatalog';

// #684: 處理建議會顯示給操作員，不使用工程用語；命令編號統一稱「命令編號」。
const ENGINEERING_TERMS = /commandId|command ID|receipt|收據|schema|Rules|dataHead|Firestore|Gregorian|fingerprint|semantic|UUID|日結版號/i;
const COMMAND_CODES = ['ACCESS_BUSY', 'LEASE_LOST', 'UNAUTHORIZED', 'OFFLINE', 'UNKNOWN_RESULT', 'REVISION_CONFLICT', 'DAY_CLOSED', 'INVALID_INPUT', 'QUOTA_EXCEEDED', 'MAINTENANCE', 'UNSUPPORTED_SCHEMA', 'LOCAL_STORAGE_UNAVAILABLE', 'FUTURE_COMMAND_CODE'];
const SYSTEM_CODES = ['RENDER_CRASH', 'LOCAL_STORAGE_ERROR', 'SYNC_ERROR', 'FIREBASE_ERROR', 'AUTH_ERROR', 'SETTLEMENT_ERROR', 'FUTURE_SYSTEM_CODE'];

describe('error catalog', () => {
  it('maps local commit failures to actionable operator copy', () => {
    expect(getUserErrorMessage('LOCAL_COMMIT_FAILED')).toEqual({
      severity: 'blocking',
      title: '尚未完成本機記帳',
      body: '這筆交易還沒有寫入本機帳務，請重試一次；若仍失敗，改用備援流程並通知管理者。',
      recoveryAction: 'retry-or-cancel',
    });
  });

  it('maps post-commit sync failures without telling the operator to re-enter the transaction', () => {
    expect(getUserErrorMessage('SYNC_FAILED_AFTER_COMMIT').recoveryAction).toBe('repair-sync');
  });

  it('maps store corruption to repair-store action', () => {
    expect(getUserErrorMessage('STORE_CORRUPTED').recoveryAction).toBe('repair-store');
  });

  it('maps crash draft found to retry-or-cancel', () => {
    expect(getUserErrorMessage('CRASH_DRAFT_FOUND').recoveryAction).toBe('retry-or-cancel');
  });

  it('maps unknown error to export-log', () => {
    expect(getUserErrorMessage('UNKNOWN_RUNTIME_ERROR').recoveryAction).toBe('export-log');
  });

  it('does not claim an unknown command result failed and directs the operator to the original ID', () => {
    const nextStep = getCommandDiagnosticNextStep('UNKNOWN_RESULT');
    expect(nextStep).toContain('不要重新收款');
    expect(nextStep).toContain('原命令編號');
    expect(nextStep).not.toMatch(/已失敗|確定未入帳/);
  });

  it('says a command was not sent when its recovery ID could not be saved', () => {
    const nextStep = getCommandDiagnosticNextStep('LOCAL_STORAGE_UNAVAILABLE');
    expect(nextStep).toContain('尚未送出');
    expect(nextStep).toContain('紙本流程');
    expect(nextStep).not.toContain('不要重新收款');
  });

  it('uses the same conservative guidance for a command code unknown to this client', () => {
    const nextStep = getCommandDiagnosticNextStep('FUTURE_COMMAND_CODE');
    expect(nextStep).toContain('不要重新收款或建立新命令');
    expect(nextStep).toContain('原命令編號');
  });

  it.each(COMMAND_CODES)('command next step for %s uses no engineering term', code => {
    expect(getCommandDiagnosticNextStep(code)).not.toMatch(ENGINEERING_TERMS);
  });

  it.each(SYSTEM_CODES)('system next step for %s uses no engineering term', code => {
    expect(getSystemDiagnosticNextStep(code)).not.toMatch(ENGINEERING_TERMS);
  });

  it.each([...COMMAND_CODES, ...SYSTEM_CODES])('next step for %s has no stray space between Chinese characters and no bare ID', code => {
    const text = SYSTEM_CODES.includes(code) ? getSystemDiagnosticNextStep(code) : getCommandDiagnosticNextStep(code);
    expect(text).not.toMatch(/[一-鿿] [一-鿿]/);
    expect(text).not.toMatch(/\bID\b/);
  });

  it('keeps the original command number and never suggests a resend for the retained-ID codes', () => {
    for (const code of ['LEASE_LOST', 'UNAUTHORIZED', 'OFFLINE', 'UNKNOWN_RESULT', 'QUOTA_EXCEEDED', 'MAINTENANCE', 'UNSUPPORTED_SCHEMA']) {
      expect(getCommandDiagnosticNextStep(code), code).toContain('原命令編號');
    }
    expect(getCommandDiagnosticNextStep('UNSUPPORTED_SCHEMA')).toContain('停止操作並聯絡維護者');
  });
});
