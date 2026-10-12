// M0：本機練習模式（`npm run dev:prototype`，Vite mode = 'prototype'）。
// 此模式不初始化 Firebase，並以獨立 port 與儲存命名空間隔離一般模式資料。
// 見 docs/superpowers/specs/frontend-prototype-workflow-spec.md §3 S-ENV。

export const PROTOTYPE_MODE = 'prototype';

export function isPrototypeModeName(mode: string | undefined): boolean {
  return mode === PROTOTYPE_MODE;
}

export const isPrototypeMode = isPrototypeModeName(import.meta.env.MODE);

/** 練習模式下為儲存鍵／資料庫名稱加上後綴，一般模式維持原名不變。 */
export function namespacedStorageName(name: string, prototype: boolean = isPrototypeMode): string {
  return prototype ? `${name}-prototype` : name;
}

/** TopBar 顯示用的資料保存位置。 */
export type StorageMode = 'cloud' | 'local-only' | 'prototype';
