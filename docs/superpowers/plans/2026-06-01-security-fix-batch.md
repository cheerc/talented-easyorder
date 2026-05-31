---
required_reads:
  - frontend/vite.config.ts
  - frontend/src/store/posPersistence.ts
  - frontend/src/store/posStore.ts
  - frontend/src/storage/posStateValidator.ts
  - frontend/src/errors/errorLogger.ts
  - frontend/src/domain/ipadHandoff.ts
  - firestore.rules
  - frontend/package.json
---

# Plan: 6 Security Issues Fix — Wave 1 + Wave 2

## Test Impact

- `frontend/src/store/__tests__/posStore.test.ts` — #174 變更 persistence engine
- `frontend/src/store/__tests__/ledgerStore.test.ts` — 同上
- `frontend/src/store/__tests__/migration.test.ts` — 同上
- `frontend/src/storage/__tests__/migration.test.ts` — 同上
- `frontend/src/hooks/__tests__/useCrashDraftRecovery.test.ts` — 同上
- `frontend/src/__tests__/orderPayment.integration.test.tsx` — 同上
- `frontend/src/domain/__tests__/ipadHandoff.test.ts` — #178 JSON.parse fix（若存在）

---

## Wave 1: HIGH Priority

### #175 — Service Worker wildcard cache 攔截 Firebase Auth/Firestore 敏感回應

- **檔案**: `frontend/vite.config.ts`
- **變更語意**: 修改 runtimeCaching urlPattern，排除 Firebase Auth 和 Firestore endpoint
- **Affected callers**: 無（vite.config.ts 只被 Vite build process 引用）
- **Related tests**: 無直接測試
- **Fix**:
  1. 將 urlPattern 從 wildcard `/^https?:\/\/.*/i` 改為具體路徑 pattern，或加入 `urlPattern.options.ignoreURLParametersMatching` 搭配 exclusion
  2. Workbox `NetworkFirst` 搭配 `ExpirationPlugin` 時，用正則排除 `identitytoolkit.googleapis.com`、`firestore.googleapis.com`、`googleapis.com/identitytoolkit`
  3. 建議改用 negative lookahead 或拆成多條 runtimeCaching rule，Auth/Firestore 端點設為 `NetworkOnly`
- **Verification**: `npm run build` 成功，檢查產出的 sw.js 不含 Firebase endpoint cache rule

### #174 — localStorage 明文儲存學生 PII 與交易資料

- **檔案**: `frontend/src/store/posPersistence.ts`、`frontend/src/store/posStore.ts`
- **變更語意**: 新增 — 自訂 IndexedDB storage adapter 供 Zustand persist middleware 使用；修改 — posPersistenceConfig 改用新 storage engine
- **Affected callers**: `posStore.ts`（direct）、所有透過 `usePosStore` 使用 store 的 component/hook
- **Related tests**: `posStore.test.ts`、`ledgerStore.test.ts`、`migration.test.ts`、所有 integration test
- **Fix**:
  1. 建立 `frontend/src/storage/indexedDBStorage.ts`，實作 Zustand `PersistStorage` interface：
     - `getItem(name)`: 從 IndexedDB 讀取，回傳 `{ state, version } | null`
     - `setItem(name, value)`: 寫入 IndexedDB
     - `removeItem(name)`: 刪除
  2. 使用固定 database name `easyorder-pos` + object store `persist`
  3. 修改 `posPersistenceConfig` 加入 `storage: createIndexedDBStorage()` 選項
  4. 移除對 `localStorage` 的直接依賴（posPersistence 中不再使用 `localStorage.setItem/getItem`）
  5. migration.ts 和 posStateValidator.ts 繼續從 `localStorage` 讀舊資料做一次性遷移，完成後清除舊 key
- **Verification**: 
  - `npx vitest run` 全部通過
  - 手動驗證：開啟 app → 做幾筆交易 → 檢查 DevTools Application > IndexedDB > easyorder-pos 有資料
  - 確認 localStorage 中 `pos-storage` key 已被清除

---

## Wave 2: MEDIUM Priority

### #181 — Firestore Rules Bootstrap Deadlock

- **檔案**: `firestore.rules`
- **變更語意**: 修改 `adminOperator()` 函式，允許 operators collection 為空時建立第一個 operator
- **Affected callers**: N/A（Firestore security rules，無 code consumer）
- **Related tests**: 無（rules unit test 暫缺）
- **Fix**:
  1. 修改 `adminOperator()` 函式，改為：`activeOperator()` 已滿足 + operators collection 為空時允許 create
  2. 在 `match /operators/{uid}` 的 `allow create` 中加入 bootstrap 條件：
     ```
     allow create: if (adminOperator() || (!exists(/databases/$(database)/documents/operators) && talentedEmail()))
     ```
  3. 或以 resource count query 判斷 operators collection 是否為空
- **Verification**: `firebase-tools` emulator 測試（若環境有），或手動 review rules 邏輯

### #180 — PII 可能透過 errorLogger stack/context 欄位外洩

- **檔案**: `frontend/src/errors/errorLogger.ts`
- **變更語意**: 修改 — sanitize 邏輯擴展到包含 stack trace 和 context 欄位
- **Affected callers**: `posPersistence.ts`（呼叫 `appendErrorLog`）
- **Related tests**: 無直接測試
- **Fix**:
  1. 新增 `sanitizeStack(stack: string): string` 函式：移除 stack trace 中可能含 PII 的字串（學生姓名模式、數值）
  2. `sanitizeMessage` 改用更嚴謹的 regex（用 word boundary `\b` 搭配 Unicode aware flag）
  3. 將 `sanitizeContext` 的 allowlist 策略標註為「預設拒絕」— 不在 CONTEXT_ALLOW_LIST 中的 key 全部剔除（目前已實作）
  4. `appendErrorLog` 中對 `entry.stack` 也做 sanitize
- **Verification**: `npx tsc --noEmit` + `npm run lint` + `npx vitest run`

### #179 — Prototype Pollution 風險在 posStateValidator

- **檔案**: `frontend/src/storage/posStateValidator.ts`
- **變更語意**: 修改 — `hasStr`/`hasNum` 改用 `Object.hasOwn` 防 prototype pollution
- **Affected callers**: `posPersistence.ts`（透過 `validatePersistedState`）
- **Related tests**: `migration.test.ts`
- **Fix**:
  1. 將 `hasStr` 改為：`Object.hasOwn(v, key) && typeof (v as Record<string, unknown>)[key] === 'string'`
  2. 將 `hasNum` 改為：`Object.hasOwn(v, key) && typeof (v as Record<string, unknown>)[key] === 'number'`
  3. 確認 `Object.hasOwn` 在 TypeScript target (es2020+) 中有支援（Vite 8 支援）
- **Verification**: `npx vitest run` migration test 通過

### #178 — Unsafe JSON.parse 在 ipadHandoff

- **檔案**: `frontend/src/domain/ipadHandoff.ts`
- **變更語意**: 修改 — `readHandoffIntent` 在 cast 前加入 schema validation
- **Affected callers**: 使用 `readHandoffIntent` 的 component/hook（需 grep 確認）
- **Related tests**: `ipadHandoff.test.ts`（若存在）
- **Fix**:
  1. `readHandoffIntent` 中 JSON.parse 後，用型別 guard 驗證 result 結構：
     - `version` 為 number
     - `timestamp` 為 number
     - `action` 為 string
     - `studentId` 為 string
     - `sourceDevice` 為 string
  2. 新增 `isIpadHandoffMessage(obj: unknown): obj is IpadHandoffMessage` type guard
  3. 移除 `as IpadHandoffMessage` cast，改用 type guard 驗證通過後才回傳
- **Verification**: `npx vitest run` 相關 test + `npm run build`
