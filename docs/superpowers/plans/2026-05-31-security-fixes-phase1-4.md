# Security Issues 分階段修正計畫 — talented-easyorder

## Context

針對 2026-05-31 codebase review (security lens) 找出的 9 個 security issues，分 4 個 phase 逐一修正。全部由 eo-team-impl2 執行，eo-team-impl 不使用。

## Phase 分組

### Phase 1: AuthGate + 獨立安全修正（#173, #176, #177）
Branch: `fix/security-phase1-auth-csv-handoff`

| Issue | 檔案 | 說明 |
|-------|------|------|
| #173 CRITICAL | `frontend/src/App.tsx` | 整合 AuthGate 到 App.tsx |
| #176 HIGH | `frontend/src/domain/ipadHandoff.ts` | timestamp 過期檢查 |
| #177 HIGH | `frontend/src/domain/ledgerExport.ts` | CSV formula injection sanitize |

### Phase 2: localStorage + PII（#174, #180）
Branch: `fix/security-phase2-storage-pii`

| Issue | 檔案 | 說明 |
|-------|------|------|
| #174 HIGH | `frontend/src/store/posPersistence.ts`, `posStore.ts` | localStorage 遷移到 IndexedDB |
| #180 MEDIUM | `frontend/src/errors/errorLogger.ts` | sanitizeMessage 強化 |

### Phase 3: SW + Validator + Handoff（#175, #178, #179）
Branch: `fix/security-phase3-sw-validator-handoff`

| Issue | 檔案 | 說明 |
|-------|------|------|
| #175 HIGH | `frontend/vite.config.ts` | Service Worker cache 排除 Firebase |
| #178 MEDIUM | `frontend/src/domain/ipadHandoff.ts` | JSON.parse try-catch 完善 |
| #179 MEDIUM | `frontend/src/storage/posStateValidator.ts` | Object.hasOwn 取代 prototype access |

### Phase 4: Firestore Rules（#181）
Branch: `fix/security-phase4-firestore-bootstrap`

| Issue | 檔案 | 說明 |
|-------|------|------|
| #181 MEDIUM | `firestore.rules` | bootstrap deadlock 解除 |

## 每個 Phase 流程

1. Lead dispatch 給 eo-team-impl2（kind=task，含 branch + task_id）
2. Impl2 開 branch → 實作 → 測試 → 開 PR
3. Lead dispatch reviewer（eo-team-reviewer）review
4. VERIFIED + CI pass → Lead merge → 下個 phase

## Implementation 要點

### #173: AuthGate 整合
- `App.tsx` 頂部 import `ensureFirebaseInitialized` from `firebase/firebaseApp`
- import `AuthGate` from `auth/AuthGate`
- import `subscribeOperatorAccess` from `firebase/authService`
- import type `OperatorAccess` from `firebase/authService`
- 在 App() 內呼叫 `ensureFirebaseInitialized()` 取得 `{ auth, db }`
- 用 `useState<OperatorAccess>` 管理 access state
- `useEffect` 內呼叫 `subscribeOperatorAccess(auth, db, setAccess)`，return unsubscribe
- 在 `<ErrorBoundary>` 內用 `<AuthGate auth={auth} db={db} access={access}>` 包裹原有內容
- 若 access 初始為 signed_out，AuthGate 顯示登入畫面

### #176: Handoff timestamp 過期
- `validateIpadHandoffMessage` 加入 30s 過期檢查
- `Math.abs(Date.now() - msg.timestamp) > 30000` → reject

### #177: CSV Formula Injection
- `serializeCsv` 的 `escape` 函式，在值開頭為 `=`/`+`/`-`/`@` 時 prepend `'`

### #174: localStorage → IndexedDB
- Zustand `persist` middleware 支援 custom `storage` engine
- 用 `idb-keyval` 或簡單的 IndexedDB wrapper 取代 localStorage
- 保留 state migration 既有邏輯

### #180: errorLogger sanitize 強化
- 擴充 sanitizeMessage regex 涵蓋更多 PII pattern
- sanitize stack 欄位移除檔案路徑

### #175: SW cache 排除 Firebase
- vite.config.ts Workbox `urlPattern` 從 `/^https?:\/\/.*/i` 改為排除 identitytoolkit / firestore / securetoken 端點

### #178: ipadHandoff JSON.parse
- `readHandoffIntent` try-catch 完善，catch 內清除損壞 key 並 return null
- 對 parse 結果做 schema validation

### #179: prototype pollution
- `hasStr`/`hasNum` 改用 `Object.hasOwn(v, key)`

### #181: Firestore bootstrap
- `allow create` 增加例外：若 `!(exists(/databases/$(database)/documents/operators/$(uid)))` 且 `operators` collection 為空時允許建立

## Verification

- 每個 phase 完成後跑 `npm test -- --run`（如有測試）
- TypeScript 型別檢查 `npx tsc --noEmit`
- Phase 1: 手動確認 AuthGate 在未登入時阻擋、登入後顯示 content
