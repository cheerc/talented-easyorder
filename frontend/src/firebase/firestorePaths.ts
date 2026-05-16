export const operatorPath = (uid: string) => `operators/${uid}`;
export const studentPath = (studentId: string) => `students/${studentId}`;
export const transactionPath = (transactionId: string) => `transactions/${transactionId}`;
export const settlementPath = (businessDate: string) => `daily_settlements/${businessDate}`;
export const closeAttemptPath = (businessDate: string, closeAttemptId: string) =>
  `daily_settlements/${businessDate}/close_attempts/${closeAttemptId}`;
export const cashAdjustmentPath = (businessDate: string, adjustmentId: string) =>
  `daily_settlements/${businessDate}/cash_adjustments/${adjustmentId}`;
