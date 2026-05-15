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
