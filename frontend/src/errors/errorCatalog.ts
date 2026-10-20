import type { CommandErrorCode } from '../domain/cloudCommands';

export type AppErrorCode =
  | 'RENDER_CRASH'
  | 'VALIDATION_FAILED'
  | 'LOCAL_COMMIT_FAILED'
  | 'SYNC_FAILED_AFTER_COMMIT'
  | 'STORE_CORRUPTED'
  | 'INDEXEDDB_UNAVAILABLE'
  | 'CRASH_DRAFT_FOUND'
  | 'UNKNOWN_RUNTIME_ERROR';

export type ErrorSeverity = 'info' | 'recoverable' | 'blocking' | 'critical';
export type RecoveryAction = 'retry-or-cancel' | 'repair-sync' | 'repair-store' | 'export-log' | 'reload-safe' | 'none';

export interface UserErrorMessage {
  severity: ErrorSeverity;
  title: string;
  body: string;
  recoveryAction: RecoveryAction;
}

const messages: Record<AppErrorCode, UserErrorMessage> = {
  RENDER_CRASH: {
    severity: 'critical',
    title: '畫面暫時無法顯示',
    body: '資料仍保留在本機。請先匯出錯誤紀錄，再重新整理畫面。',
    recoveryAction: 'reload-safe',
  },
  VALIDATION_FAILED: {
    severity: 'recoverable',
    title: '資料需要修正',
    body: '請依畫面提示修正欄位，再重新確認。',
    recoveryAction: 'none',
  },
  LOCAL_COMMIT_FAILED: {
    severity: 'blocking',
    title: '尚未完成本機記帳',
    body: '這筆交易還沒有寫入本機帳務，請重試一次；若仍失敗，改用備援流程並通知管理者。',
    recoveryAction: 'retry-or-cancel',
  },
  SYNC_FAILED_AFTER_COMMIT: {
    severity: 'recoverable',
    title: '已本機記帳，雲端尚未同步',
    body: '不要重新輸入這筆交易。請稍後從同步修復畫面重試或處理失敗原因。',
    recoveryAction: 'repair-sync',
  },
  STORE_CORRUPTED: {
    severity: 'critical',
    title: '偵測到本機資料異常',
    body: '系統已保留異常資料副本。請先修復或匯出，不要直接重置。',
    recoveryAction: 'repair-store',
  },
  INDEXEDDB_UNAVAILABLE: {
    severity: 'blocking',
    title: '本機資料庫無法開啟',
    body: '目前無法保證交易可保存。請切換備援流程，或依管理者指示重試。',
    recoveryAction: 'reload-safe',
  },
  CRASH_DRAFT_FOUND: {
    severity: 'recoverable',
    title: '偵測到未完成交易',
    body: '請確認是否恢復上一筆未送出的操作，或放棄後重新搜尋學生。',
    recoveryAction: 'retry-or-cancel',
  },
  UNKNOWN_RUNTIME_ERROR: {
    severity: 'critical',
    title: '系統發生未預期錯誤',
    body: '請保留錯誤代碼與時間，通知管理者處理。',
    recoveryAction: 'export-log',
  },
};

export function getUserErrorMessage(code: AppErrorCode): UserErrorMessage {
  return messages[code];
}

const commandDiagnosticNextSteps: Record<CommandErrorCode, string> = {
  ACCESS_BUSY: '目前有人持有使用權；請等待操作員交接後再確認，不要重送命令。',
  LEASE_LOST: '使用權可能已變更；先用原 command ID 查詢伺服器結果，重新確認使用權後再處理。',
  UNAUTHORIZED: '請聯絡維護者確認帳號權限；保留原 command ID 並先查詢結果。',
  OFFLINE: '網路恢復後用原 command ID 查詢；不要建立新的命令，也不會背景補送。',
  UNKNOWN_RESULT: '結果尚未確認；不要重新收款或建立新命令。請保留原 command ID，先查詢該 ID 的伺服器收據。',
  REVISION_CONFLICT: '伺服器資料已變更；重新載入後確認目前狀態。若結果不明，先用原 command ID 查詢。',
  DAY_CLOSED: '營業日已關閉；重新載入日期狀態，確認後再依流程處理。',
  INVALID_INPUT: '伺服器拒絕目前資料；重新載入並核對欄位與營業日狀態後再操作。',
  QUOTA_EXCEEDED: '暫停操作並聯絡維護者確認額度；保留原 command ID，不要改用新 ID 重送。',
  MAINTENANCE: '系統維護中；等待維護者解除後用原 command ID 確認結果。',
  UNSUPPORTED_SCHEMA: '資料版本不支援；停止操作並聯絡維護者，保留原 command ID。',
};

export function getCommandDiagnosticNextStep(code: unknown): string {
  if (typeof code === 'string' && Object.hasOwn(commandDiagnosticNextSteps, code)) {
    return commandDiagnosticNextSteps[code as CommandErrorCode];
  }
  return '結果尚未確認；不要重新收款或建立新命令。若有原 command ID，先用該 ID 查詢伺服器結果。';
}

export function getSystemDiagnosticNextStep(code: unknown): string {
  switch (code) {
    case 'RENDER_CRASH':
      return '重新載入後確認頁面；若剛送出命令，先用原 command ID 查詢結果。';
    case 'LOCAL_STORAGE_ERROR':
      return '本機診斷可能無法保存；不要因此重送業務命令，請先確認原 command ID 的伺服器結果。';
    case 'SYNC_ERROR':
    case 'FIREBASE_ERROR':
      return '確認連線與使用權；若涉及送出，先用原 command ID 查詢結果，不要建立新命令。';
    case 'AUTH_ERROR':
      return '重新確認登入與使用權；如有送出中的命令，先查原 command ID。';
    case 'SETTLEMENT_ERROR':
      return '重新載入日結狀態；如有送出中的命令，先查原 command ID，不要另建命令。';
    default:
      return '不要重新收款或建立新命令；若有原 command ID，先確認伺服器結果。';
  }
}
