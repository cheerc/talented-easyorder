/**
 * Ref: #310 — Constant for system-level automated operations where no human
 * operator is available. All audit events should use a real operator UID
 * whenever possible; this constant is reserved for programmatic/automated actions.
 */
export const SYSTEM_OPERATOR_ID = '__system__';

/** M2 F09：畫面上的操作人。本機（練習或未登入）的操作顯示「本機櫃台」，不顯示內部代碼。 */
export function operatorLabel(operatorId: string | undefined | null): string {
  if (!operatorId || operatorId === SYSTEM_OPERATOR_ID) return '本機櫃台';
  return operatorId;
}
