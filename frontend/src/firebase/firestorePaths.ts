export const operatorPath = (uid: string) => `operators/${uid}`;
export const accessLeasePath = () => 'system/accessLease';
export const dataHeadPath = () => 'system/dataHead';
export const dayPath = (dayId: string) => `days/${dayId}`;
export const commandPath = (commandId: string) => `commands/${commandId}`;
export const studentPath = (studentId: string) => `students/${studentId}`;
export const vendorPath = (vendorId: string) => `vendors/${vendorId}`;
export const transactionPath = (transactionId: string) => `transactions/${transactionId}`;
export const settlementPath = (businessDate: string) => `daily_settlements/${businessDate}`;
export const closeAttemptPath = (businessDate: string, closeAttemptId: string) =>
  `daily_settlements/${businessDate}/close_attempts/${closeAttemptId}`;
export const cashAdjustmentPath = (businessDate: string, adjustmentId: string) =>
  `daily_settlements/${businessDate}/cash_adjustments/${adjustmentId}`;
