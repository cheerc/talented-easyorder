import type { LedgerSyncStatus } from './types';

export type LedgerAuditEventType =
  | 'transaction_edited'
  | 'transaction_deleted'
  | 'transaction_hard_deleted'
  | 'business_date_closed'
  | 'business_date_reopened'
  | 'csv_exported'
  | 'report_printed'
  | 'student_code_changed';

export interface LedgerAuditEvent {
  auditEventId: string;
  eventType: LedgerAuditEventType;
  entityType: 'transaction' | 'settlement' | 'business_date' | 'export' | 'student';
  entityId: string;
  businessDate: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string;
  operatorId: string;
  createdAt: string;
  studentId?: string;
}

export type LedgerMutationDecision =
  | { action: 'direct_edit'; reasonRequired: boolean }
  | { action: 'hard_delete'; reasonRequired: true }
  | { action: 'blocked'; message: string };

export interface AuditEventInput {
  auditEventId: string;
  eventType: LedgerAuditEventType;
  entityType: 'transaction' | 'settlement' | 'business_date' | 'export';
  entityId: string;
  businessDate: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string;
  operatorId: string;
  createdAt: string;
}

type BusinessDateStatus = 'open' | 'closed' | 'reopened';

export function decideLedgerEditPolicy(
  tx: { syncStatus: LedgerSyncStatus },
  dateStatus: BusinessDateStatus,
): LedgerMutationDecision {
  if (dateStatus === 'closed') {
    return { action: 'blocked', message: '此日期已關閉，請先 reopen 後再做更正' };
  }
  return { action: 'direct_edit', reasonRequired: true };
}

export function decideLedgerDeletePolicy(
  tx: { syncStatus: LedgerSyncStatus },
  dateStatus: BusinessDateStatus,
): LedgerMutationDecision {
  if (dateStatus === 'closed') {
    return { action: 'blocked', message: '此日期已關閉，需先 reopen 後才能刪除' };
  }
  return { action: 'hard_delete', reasonRequired: true };
}

export function createLedgerAuditEvent(input: AuditEventInput): LedgerAuditEvent {
  return {
    auditEventId: input.auditEventId,
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId,
    businessDate: input.businessDate,
    before: input.before,
    after: input.after,
    reason: input.reason,
    operatorId: input.operatorId,
    createdAt: input.createdAt,
  };
}


/** M2：更正、刪除、取消訂餐共用的檢查結果。ok=false 時 message 直接顯示給櫃台人員。 */
export type LedgerMutationResult = { ok: true } | { ok: false; message: string };

/** 新增交易的結果：成功時帶回新交易的編號，F1 送出後的撤回用它找到這一筆。 */
export type LedgerCommitResult = { ok: true; transactionId: string } | { ok: false; message: string };

/** 改帳時一定要帶的資訊：理由必填；操作員沒給時記為系統。 */
export interface LedgerMutationOptions {
  reason: string;
  operatorId?: string;
}

export const LEDGER_CLOSED_DATE_MESSAGE = '這一天已經關帳，請先到今日帳（F2）重開，再更正或刪除。';
export const LEDGER_REASON_REQUIRED_MESSAGE = '請填寫理由。';

/**
 * M2：所有改帳入口（更正、刪除、取消訂餐、撤回）共用的檢查。
 * 已關帳的營業日一律擋下；理由去掉空白後不能是空的。
 */
export function checkLedgerMutation(
  dateStatus: BusinessDateStatus | undefined,
  reason: string,
): LedgerMutationResult {
  if (dateStatus === 'closed') return { ok: false, message: LEDGER_CLOSED_DATE_MESSAGE };
  if (!reason.trim()) return { ok: false, message: LEDGER_REASON_REQUIRED_MESSAGE };
  return { ok: true };
}

export const LEDGER_CLOSED_DATE_NEW_MESSAGE = '這一天已經關帳，不能新增交易；請先到今日帳（F2）重開。';

/** 規格 §6：關帳日的所有新增入口都在 store 擋寫，不只靠畫面鎖住。 */
export function checkNewLedgerEntry(dateStatus: BusinessDateStatus | undefined): LedgerMutationResult {
  return dateStatus === 'closed' ? { ok: false, message: LEDGER_CLOSED_DATE_NEW_MESSAGE } : { ok: true };
}
