import { describe, expect, it } from 'vitest';
import { getUserErrorMessage } from '../errorCatalog';

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
});
