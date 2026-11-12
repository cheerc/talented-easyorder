// 只有雲端正式版（#709 移除了本機練習 prototype 模式）。
// 缺 Firebase 設定一律 fail closed，不可無聲降級成本機儲存。
// 見 docs/superpowers/specs/2026-10-13-free-production-backend-spec.md §5, §8。

/** 檢查是否具備完整的 Firebase 環境變數設定。 */
export function hasFirebaseConfig(env: Record<string, string | undefined> = import.meta.env): boolean {
  return Boolean(
    env.VITE_FIREBASE_API_KEY &&
    env.VITE_FIREBASE_AUTH_DOMAIN &&
    env.VITE_FIREBASE_PROJECT_ID &&
    env.VITE_FIREBASE_APP_ID &&
    env.VITE_FIREBASE_MESSAGING_SENDER_ID &&
    env.VITE_FIREBASE_STORAGE_BUCKET
  );
}

/**
 * 規格 §5, §8 驗收條件：
 * 缺 Firebase config 時必須視為設定錯誤，不得無聲降級為本機儲存進行正式營運。
 * 與 Vite mode 無關（包含 MODE=prototype）。
 */
export function validateAppModeConfig(
  env: Record<string, string | undefined> = import.meta.env,
): { ok: true } | { ok: false; error: string } {
  if (!hasFirebaseConfig(env)) {
    return {
      ok: false,
      error: '正式模式缺少必要 Firebase 設定，不可無聲降級為 local-only 儲存',
    };
  }
  return { ok: true };
}

/** html 上標記雲端模式的屬性；cloud-scale.css 以它限定等比放大與字型（#648）。 */
export const APP_MODE_ATTRIBUTE = 'data-app-mode';

/** 在 html 設 data-app-mode="cloud"（#709 後只有雲端模式）。 */
export function applyAppModeAttribute(root: HTMLElement): void {
  root.setAttribute(APP_MODE_ATTRIBUTE, 'cloud');
}
