// M0：本機練習模式（`npm run dev:prototype`，Vite mode = 'prototype'）。
// 此模式不初始化 Firebase，並以獨立 port 與儲存命名空間隔離一般模式資料。
// 見 docs/superpowers/specs/frontend-prototype-workflow-spec.md §3 S-ENV。
// P02：正式後端雲端模式判定與儲存隔離。
// 見 docs/superpowers/specs/2026-10-13-free-production-backend-spec.md §5, §8。

export const PROTOTYPE_MODE = 'prototype';

export function isPrototypeModeName(mode: string | undefined): boolean {
  return mode === PROTOTYPE_MODE;
}

export const isPrototypeMode = isPrototypeModeName(import.meta.env.MODE);

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
 * 判斷是否為 Cloud mode：
 * 非 prototype 模式且具備完整 Firebase config 即為 cloud 模式。
 */
export function isCloudModeName(
  mode: string | undefined = import.meta.env.MODE,
  env: Record<string, string | undefined> = import.meta.env,
): boolean {
  return !isPrototypeModeName(mode) && hasFirebaseConfig(env);
}

export const isCloudMode = isCloudModeName(import.meta.env.MODE, import.meta.env);

/** TopBar 與系統顯示／運作使用的資料保存模式。 */
export type StorageMode = 'cloud' | 'local-only' | 'prototype';

/**
 * 取得當前執行的 StorageMode：
 * - prototype 模式回傳 'prototype'
 * - 正式模式且配置齊全回傳 'cloud'
 * - 未設定 Firebase 的本機環境回傳 'local-only'
 */
export function getStorageMode(
  mode: string | undefined = import.meta.env.MODE,
  env: Record<string, string | undefined> = import.meta.env,
): StorageMode {
  if (isPrototypeModeName(mode)) return 'prototype';
  if (hasFirebaseConfig(env)) return 'cloud';
  return 'local-only';
}

/**
 * 規格 §5, §8 驗收條件：
 * 正式模式（非 prototype）缺 Firebase config 時必須視為設定錯誤，
 * 不得無聲降級為 local-only 進行正式營運。
 */
export function validateAppModeConfig(
  mode: string | undefined = import.meta.env.MODE,
  env: Record<string, string | undefined> = import.meta.env,
): { ok: true } | { ok: false; error: string } {
  if (isPrototypeModeName(mode)) {
    return { ok: true };
  }
  if (!hasFirebaseConfig(env)) {
    return {
      ok: false,
      error: '正式模式缺少必要 Firebase 設定，不可無聲降級為 local-only 儲存',
    };
  }
  return { ok: true };
}

/**
 * 儲存命名空間隔離：
 * prototype 模式加後綴 `-prototype`；cloud 模式加後綴 `-cloud`；local-only 維持原名。
 * 兼容傳入 boolean（true 代表 prototype）。
 */
export function namespacedStorageName(
  name: string,
  modeOrPrototype: StorageMode | boolean = isPrototypeMode,
): string {
  if (typeof modeOrPrototype === 'boolean') {
    return modeOrPrototype ? `${name}-prototype` : name;
  }
  if (modeOrPrototype === 'prototype') {
    return `${name}-prototype`;
  }
  if (modeOrPrototype === 'cloud') {
    return `${name}-cloud`;
  }
  return name;
}

/**
 * 規格 §5, §8：Cloud mode 禁止 seed / reset / 範例資料入口。
 * 只有 prototype 模式或非 cloud 的本地開發環境才可存取。
 */
export function canResetData(mode: StorageMode = getStorageMode()): boolean {
  return mode !== 'cloud';
}

export function canSeedData(mode: StorageMode = getStorageMode()): boolean {
  return mode !== 'cloud';
}
