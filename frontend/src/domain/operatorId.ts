/**
 * Ref: #310 — Constant for system-level automated operations where no human
 * operator is available. All audit events should use a real operator UID
 * whenever possible; this constant is reserved for programmatic/automated actions.
 */
export const SYSTEM_OPERATOR_ID = '__system__';
