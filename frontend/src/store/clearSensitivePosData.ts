import { isCloudMode } from '../appMode';
import { clearErrorLog } from '../errors/errorLogger';

// 舊版雲端本機資料的 key（含「pos」「crash-draft」字樣）。保持原名，
// 才能清掉裝置上既有的資料；不要改名，否則會留下孤兒資料。
const LEGACY_CLOUD_CRASH_DRAFT_DB = 'easyorder-crash-draft-cloud';
const LEGACY_CLOUD_POS_STORAGE_KEY = 'pos-storage-cloud';

/**
 * Ref: #286 — 登出或失去使用權時，清掉舊版雲端本機資料。
 * 共用 kiosk／iPad 上，避免學生姓名、餘額、交易在操作員登出後仍留在裝置上。
 * 只動雲端命名空間，不碰其他 key（顯示偏好、安全診斷等）。
 */
export async function clearSensitivePosData(): Promise<void> {
  if (!isCloudMode) return;

  const cleanupErrors: string[] = [];
  if (typeof indexedDB !== 'undefined') {
    try {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(LEGACY_CLOUD_CRASH_DRAFT_DB);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(new Error('雲端暫存資料庫清除失敗。'));
        request.onblocked = () => reject(new Error('雲端暫存資料庫仍被其他分頁使用。請關閉其他 EasyOrder 分頁後重新載入。'));
      });
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  try {
    localStorage.removeItem(LEGACY_CLOUD_POS_STORAGE_KEY);
    if (!clearErrorLog()) cleanupErrors.push('舊版本機錯誤紀錄清除失敗。');
  } catch (error) {
    cleanupErrors.push(error instanceof Error ? error.message : String(error));
  }

  if (cleanupErrors.length > 0) throw new Error(cleanupErrors.join(' '));
}
