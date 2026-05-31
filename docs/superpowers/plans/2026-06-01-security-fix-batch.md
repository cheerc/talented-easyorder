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
- `frontend/src/errors/__tests__/errorLogger.test.ts` — #180 PII sanitize stack trace 測試
- `frontend/src/storage/__tests__/posStateValidator.test.ts` — #179 Prototype Pollution 防禦測試

---

## Wave 1: HIGH Priority

### #175 — Service Worker wildcard cache 攔截 Firebase Auth/Firestore 敏感回應

- **檔案**: `frontend/vite.config.ts`
- **變更語意**: 修改 runtimeCaching urlPattern，排除 Firebase Auth 和 Firestore endpoint
- **Affected callers**: 無（vite.config.ts 只被 Vite build process 引用）
- **Related tests**: 無直接測試
- **Fix**:
  1. 將 urlPattern 從 wildcard `/^https?:\/\/.*/i` 改為更嚴格的 pattern，排除 Firebase Auth 和 Firestore 端點
  2. 新增一條 `NetworkOnly` rule 專門處理 `identitytoolkit.googleapis.com` 和 `firestore.googleapis.com`，確保敏感資料不進入 Cache Storage
  3. 或使用 Workbox `urlPattern` 搭配負向排除（negative lookahead regex），排除 `/identitytoolkit|firestore/i`
- **Verification**: `npm run build` 成功，檢查產出的 sw.js 不含 Firebase endpoint cache rule

### #174 — localStorage 明文儲存學生 PII 與交易資料

- **檔案**: `frontend/src/store/posPersistence.ts`、`frontend/src/store/posStore.ts`
- **變更語意**: 新增 — 自訂 storage adapter（IndexedDB 優先，含 jsdom/隱私瀏覽 fallback）
- **Affected callers**: `posStore.ts`（direct）、所有透過 `usePosStore` 使用 store 的 component/hook
- **Related tests**: `posStore.test.ts`、`ledgerStore.test.ts`、`migration.test.ts`、所有 integration test
- **Fix**:
  1. 建立 `frontend/src/storage/indexedDBStorage.ts`，實作 Zustand `PersistStorage` interface：
     - `getItem(name)`: 從 IndexedDB 讀取，回傳 `{ state, version } | null`
     - `setItem(name, value)`: 寫入 IndexedDB
     - `removeItem(name)`: 刪除
     - **環境檢測 fallback**（重要）：初始化時用 try-catch 檢測 `window.indexedDB` 是否可用。若 `indexedDB` 不可用（jsdom 測試環境、隱私瀏覽模式），自動降級使用 `localStorage` 作為後備 storage。檢查方式同 `checkStorageHealth()` 風格。
  2. 使用固定 database name `easyorder-pos` + object store `persist`
  3. 修改 `posPersistenceConfig` 加入 `storage: createStorageAdapter()` 選項
  4. migration.ts 和 posStateValidator.ts 繼續從 `localStorage` 讀舊資料做一次性遷移，完成後清除舊 key
- **Verification**: 
  - `npx vitest run` 全部通過（jsdom 環境下自動降級 localStorage）
  - 手動驗證：開啟 app → 做幾筆交易 → DevTools Application > IndexedDB > easyorder-pos 有資料
  - 確認 localStorage 中 `pos-storage` key 已被清除

---

## Wave 2: MEDIUM Priority

### #181 — Firestore Rules Bootstrap Deadlock

- **檔案**: `firestore.rules`
- **變更語意**: 修改 `adminOperator()` 函式，使用 bootstrap lock 文件解決空資料庫初始化問題
- **Affected callers**: N/A（Firestore security rules，無 code consumer）
- **Related tests**: 無（rules unit test 暫缺）
- **Fix**:
  1. Firestore Security Rules 的 `exists()` 只能檢查 document，不能檢查 collection。`exists(/databases/$(database)/documents/operators)` 會編譯錯誤。
  2. 改用 **bootstrap lock 文件**方案：
     - 檢查 `!exists(/databases/$(database)/documents/operators/bootstrap)` — 若此 lock 文件不存在，表示為初始空資料庫狀態
     - 在 `match /operators/{uid}` 的 `allow create` 中加入 bootstrap 條件：
       ```
       allow create: if adminOperator()
         || (!exists(/databases/$(database)/documents/operators/bootstrap) && talentedEmail() && uid == request.auth.uid);
       ```
     - 同時需要 `allow create` for `/operators/bootstrap`：第一個 admin 建立時一併建立 bootstrap lock 文件
  3. 前端建立第一個 operator 時，需以 batch write 同時建立 operator 文件和 `/operators/bootstrap` lock
  4. 或者在 Firebase Console 手動建立 bootstrap 文件後再由前端管理
- **Verification**: 手動 review rules 邏輯正確性；Firebase emulator 測試（若環境有）

### #180 — PII 可能透過 errorLogger stack/context 欄位外洩

- **檔案**: `frontend/src/errors/errorLogger.ts`
- **變更語意**: 修改 — sanitize 邏輯擴展到 stack trace
- **Affected callers**: `posPersistence.ts`（呼叫 `appendErrorLog`）
- **Related tests**: `frontend/src/errors/__tests__/errorLogger.test.ts`
- **Fix**:
  1. 在 `appendErrorLog` 中對 `entry.stack` 做 sanitize（目前 stack 未經任何處理）
  2. `sanitizeMessage` 的 regex 加入 word boundary `\b` 以減少繞過風險（正則已基本可用，改進穩固性即可）
  3. 新增 `sanitizeStack(stack: string): string` 函式：將 stack trace 中出現的學生姓名模式、數值做 redaction
- **Verification**: `npx vitest run` errorLogger.test.ts — 新增 test case：模擬含 PII 的 stack trace，驗證 sanitize 後不洩漏

### #179 — Prototype Pollution 風險在 posStateValidator

- **檔案**: `frontend/src/storage/posStateValidator.ts`
- **變更語意**: 修改 — `hasStr`/`hasNum` 改用 `Object.hasOwn` 防 prototype pollution
- **Affected callers**: `posPersistence.ts`（透過 `validatePersistedState`）
- **Related tests**: `frontend/src/storage/__tests__/posStateValidator.test.ts`
- **Fix**:
  1. 將 `hasStr` 改為：`Object.hasOwn(v, key) && typeof (v as Record<string, unknown>)[key] === 'string'`
  2. 將 `hasNum` 改為：`Object.hasOwn(v, key) && typeof (v as Record<string, unknown>)[key] === 'number'`
  3. `Object.hasOwn` 在 TypeScript target es2020+ 有原生支援
- **Verification**: `npx vitest run` posStateValidator.test.ts — 新增 test case：注入 `Object.prototype.studentId = 'polluted'`，驗證 validator 不誤判 prototype 屬性為合法資料

### #178 — Unsafe JSON.parse 在 ipadHandoff

- **檔案**: `frontend/src/domain/ipadHandoff.ts`
- **變更語意**: 修改 — `readHandoffIntent` 在 cast 前加入 schema validation
- **Affected callers**: `useIpadHandoff` hook（`frontend/src/hooks/useIpadHandoff.ts`）
- **Related tests**: `frontend/src/domain/__tests__/ipadHandoff.test.ts`
- **Fix**:
  1. 新增 `isIpadHandoffMessage(obj: unknown): obj is IpadHandoffMessage` type guard：
     - `version` 為 number
     - `timestamp` 為 number
     - `action` 為 string
     - `studentId` 為 string
     - `sourceDevice` 為 string
  2. `readHandoffIntent` 中 `JSON.parse` 後用 type guard 驗證，通過才回傳
  3. 移除 `as IpadHandoffMessage` cast
- **Verification**: `npx vitest run` ipadHandoff.test.ts + `npm run build`
