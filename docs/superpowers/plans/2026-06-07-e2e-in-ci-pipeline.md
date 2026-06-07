# E2E-in-CI Pipeline Bootstrap + Smoke Test

## 目標

為 easyorder 建立 e2e test 進 CI 的完整流程，並新增一個 smoke e2e test 證明 pipeline 可跑綠。

## 研究摘要

### 現況

- **無 Playwright、無 e2e test**
- **ci.yml**：`push` + `pull_request` trigger，單一 job `build-and-test`（tsc → lint → vitest → firestore rules via emulator）
- **Firebase emulators**：已配置 auth (9099) + firestore (8080) + UI (4000)，CI 已在用 `firebase emulators:exec --only firestore` 跑 firestore rules 測試
- **Stack**：純前端（Vite 8 + React 19 + TypeScript 6 + Zustand 5），使用 Firebase Auth (Google Sign-In) + Firestore，無 backend/Cloud Functions
- **Auth 機制**：`AuthGate` 元件攔截未登入使用者，僅支援 Google Sign-In；Firebase Auth emulator 支援 `createUserWithEmailAndPassword` 但 app 未暴露 email/password 登入路徑

### 對標 payroll #188 Phase 1 差異

| 項目 | payroll | easyorder |
|------|---------|-----------|
| Backend | Cloud Functions | 無（純前端） |
| Firebase emulators | auth, firestore, functions | auth, firestore（已配置） |
| CI gotchas | defineSecret hang, pkill self-SIGTERM, emulator env file, functions build | **僅需 Java + Firebase CLI**，無 functions 相關 gotchas |
| e2e 登入方式 | 自訂 email/password auth | Google Sign-In only（headless CI 無法做 OAuth redirect） |

### Smoke test 策略

由於 app 僅支援 Google Sign-In（OAuth redirect 在 headless CI 不可行），smoke test 驗證：
1. App 載入成功（無 crash、無空白頁）
2. Auth gate 正確渲染（title "Talented EasyOrder" + "使用 Google 登入" 按鈕）
3. Firebase 初始化無錯誤（無 fallback error page）

這證明完整 pipeline（emulators → vite → app → Firebase SDK → auth gate）正常運作。

## 範圍

1. 安裝 Playwright（`@playwright/test` + browser）
2. 建立 `playwright.config.ts`（webServer: vite preview + Firebase emulators）
3. 新增 `package.json` scripts（`test:e2e`）
4. 撰寫 **1 個** smoke e2e test（`e2e/smoke.spec.ts`）
5. `workflow.sh` 新增 e2e 函數（使用下一個可用編號，現有 t1-t7 已佔用）
6. `ci.yml` 新增 `e2e-tests` job（平行於 `build-and-test`），trigger 調整為 PR-based pre-merge

## Affected Files

| 檔案 | 動作 | 說明 |
|------|------|------|
| `frontend/package.json` | 修改 | 新增 `@playwright/test` devDep + `test:e2e` script |
| `frontend/playwright.config.ts` | **新增** | Playwright 設定（webServer + emulator env） |
| `frontend/e2e/smoke.spec.ts` | **新增** | Smoke e2e test |
| `.github/workflows/ci.yml` | 修改 | 新增 `e2e-tests` job、調整 trigger |
| `workflow.sh` | 修改 | 新增 e2e 函數 |

### 非改動檔案（僅參考）

- `frontend/src/auth/AuthGate.tsx` — smoke test 會斷言的 UI
- `frontend/src/firebase/firebaseApp.ts` — emulator 連線邏輯
- `firebase.json` — emulator 配置（已包含 auth + firestore）

## Implementation Steps

### Step 1: Install Playwright

```bash
cd frontend
npm install --save-dev @playwright/test
npx playwright install chromium --with-deps
```

**Verify**: `npx playwright --version` 輸出正確版本

### Step 2: Create `playwright.config.ts`

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:4173',
  },
  webServer: [
    {
      // Firebase emulators — start first
      command: 'npx firebase emulators:exec --only auth,firestore --project gen-lang-client-0613258198 "sleep infinity"',
      port: 9099,
      timeout: 60000,
      reuseExistingServer: !process.env.CI,
      env: {
        // No extra env needed for emulator process itself
      },
    },
    {
      // Vite preview (production build) — start after emulators ready
      command: 'npm run build && npx vite preview --port 4173',
      port: 4173,
      timeout: 60000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
```

> ⚠️ **重要**：上述 `webServer` 雙 server 寫法在 Playwright 中**不可行** — `webServer` 只支援單一 server config（object）或 array of objects（但 array 模式下所有 server 會**並行**啟動，無法保證 emulators 先就緒才啟動 vite）。

**修正方案**：使用 `globalSetup` 啟動 emulators，或使用單一 `firebase emulators:exec` wrapper：

```ts
// playwright.config.ts — 實際寫法
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
  },
  // CI: emulators 由 ci.yml step 管理；local: npm run test:e2e 包在 emulators:exec 內
  webServer: {
    command: 'VITE_FIREBASE_USE_EMULATOR=true VITE_FIRESTORE_EMULATOR_HOST=127.0.0.1 VITE_FIRESTORE_EMULATOR_PORT=8080 VITE_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099 npx vite --port 5173 --strictPort',
    port: 5173,
    timeout: 60000,
    reuseExistingServer: !process.env.CI,
  },
});
```

**Verify**: `npx playwright test --list` 列出測試（emulator 未啟動時會 pending/timeout，但 config parse 應成功）

### Step 3: Add npm scripts

```jsonc
// package.json scripts
"test:e2e": "firebase emulators:exec --only auth,firestore --project gen-lang-client-0613258198 npx playwright test",
"pretest:e2e": "npm run build"  // optional; or let webServer handle it
```

> ⚠️ **實際做法**：local 開發用 `npm run test:e2e`（`firebase emulators:exec` 管理 emulator 生命週期 + Playwright webServer 啟動 vite dev）。CI 則由 ci.yml step 分別管理（見 Step 6）。

**Verify**: `npm run test:e2e`（需先 `npx playwright install chromium`）

### Step 4: Write Smoke E2E Test

```ts
// e2e/smoke.spec.ts
import { test, expect } from '@playwright/test';

test.describe('EasyOrder Smoke', () => {
  test('app loads and shows auth gate', async ({ page }) => {
    await page.goto('/');
    
    // Verify auth gate rendered (not crash page, not blank)
    await expect(page.locator('h1')).toContainText('Talented EasyOrder');
    await expect(page.getByRole('button', { name: '使用 Google 登入' })).toBeVisible();
    
    // Verify no crash state
    await expect(page.getByLabel('載入中')).toHaveCount(0);
  });
});
```

**Verify**: `npm run test:e2e` → 1 passed

### Step 5: Update `workflow.sh`

新增 e2e 函數（現有 t1-t7 已佔用，使用下一個可用編號）：

> **編號決策**：workflow.sh t5 目前已用於 "Integration Tests (Firestore Rules)"。General 派工提及 "t5（或等效）" — 本文採用保留現有編號、新增獨立函數的方案，避免改動現有 t5 語意造成混淆。CI job 命名使用 `e2e-tests`（對標 payroll），workflow.sh 內以獨立選項提供。

**方案 A（最小改動）**：不新增 workflow.sh 選項，local e2e 直接 `cd frontend && npm run test:e2e`。workflow.sh 僅在 CI 被呼叫（ci.yml step），但 easyorder ci.yml build-and-test job 使用 inline 指令不經 workflow.sh。

**方案 B**：在 workflow.sh 新增 e2e 函數與選單項目。需改動 menu display + case statement。

**採用方案 A**：ci.yml e2e-tests job 使用 inline 指令（與現有 build-and-test job 風格一致）。workflow.sh 保留給 local dev 使用，e2e 測試透過 `npm run test:e2e` 執行。

### Step 6: Update `ci.yml`

```yaml
name: Frontend CI

on:
  pull_request:
    branches: [dev]
    types: [opened, synchronize, reopened]
    paths-ignore:
      - '**/*.md'
      - 'docs/**'
  workflow_dispatch:

concurrency:
  group: pre-merge-checks-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    # ... (保持現有內容不變)

  e2e-tests:
    name: e2e-tests
    runs-on: ubuntu-latest
    timeout-minutes: 20
    needs: []  # 平行於 build-and-test，互不阻塞
    env:
      VITE_FIREBASE_API_KEY: "dummy-api-key"
      VITE_FIREBASE_AUTH_DOMAIN: "dummy-auth-domain"
      VITE_FIREBASE_PROJECT_ID: "dummy-project-id"
      VITE_FIREBASE_APP_ID: "dummy-app-id"
      VITE_FIREBASE_MESSAGING_SENDER_ID: "000000000000"
      VITE_FIREBASE_STORAGE_BUCKET: "dummy-bucket"
      VITE_FIREBASE_USE_EMULATOR: "true"
      VITE_FIRESTORE_EMULATOR_HOST: "127.0.0.1"
      VITE_FIRESTORE_EMULATOR_PORT: "8080"
      VITE_FIREBASE_AUTH_EMULATOR_URL: "http://127.0.0.1:9099"
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: frontend/package-lock.json

      - name: Setup Java (for Firebase emulators)
        uses: actions/setup-java@v5
        with:
          distribution: temurin
          java-version: '21'

      - name: Install Dependencies
        run: npm ci
        working-directory: frontend

      - name: Install Playwright Browsers
        run: npx playwright install chromium --with-deps
        working-directory: frontend

      - name: Install Firebase CLI
        run: npm install --global firebase-tools

      - name: t5 E2E Tests
        run: npx firebase emulators:exec --only auth,firestore "npx playwright test"
        working-directory: frontend

      - name: Upload Playwright Report (on failure)
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: frontend/playwright-report/
          retention-days: 7

      - name: Upload Test Results (on failure)
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: test-results
          path: frontend/test-results/
          retention-days: 7
```

**關鍵設計決策**：
- `needs: []` — 平行於 `build-and-test`，不阻塞 unit test
- `VITE_FIREBASE_*` env vars 設為 dummy 值 — emulator 模式下不需要真實 API key（`firebaseApp.ts` 仍會檢查 required fields，所以必須提供 non-empty 值）
- `VITE_FIREBASE_USE_EMULATOR=true` — 觸發 `connectFirestoreEmulator` + `connectAuthEmulator`
- **不需 `GOOGLE_APPLICATION_CREDENTIALS`** — emulator 模式不需要
- **不需 secrets** — 所有 env vars 都是 dummy 值
- **不需 functions build** — easyorder 無 backend

**Verify**: PR trigger → `e2e-tests` job 在 CI 上跑綠

## CI Trigger 調整

將 `ci.yml` trigger 從 `push` + `pull_request` 改為 `pull_request` only（對標 payroll pre-merge 模式）：

```yaml
on:
  pull_request:
    branches: [dev]
    types: [opened, synchronize, reopened]
    paths-ignore:
      - '**/*.md'
      - 'docs/**'
  workflow_dispatch:
```

> **理由**：`push` trigger 對所有 branch 的 push 都觸發 CI（含 WIP commit），浪費 CI 分鐘數。改為 PR-based pre-merge 僅在 PR open/sync 時觸發。`workflow_dispatch` 保留手動觸發能力。

## Test Impact

- **無現有測試受影響**：所有改動為新增檔案，不改動 source code
- **新增**：`e2e/smoke.spec.ts`（1 個 test case）

## Risk Assessment

| 風險 | 等級 | 緩解 |
|------|------|------|
| Firebase emulator Java 依賴在 CI 未安裝 | 中 | ci.yml 已加 `setup-java@v5` |
| Playwright browser 安裝失敗 | 低 | 使用 `--with-deps` 安裝系統依賴 |
| `firebase emulators:exec` 在 CI timeout | 中 | `timeout-minutes: 20`，僅啟動 auth+firestore（不含 functions） |
| Vite env vars 在 CI 未正確傳遞 | 低 | Job-level `env:` 設定所有必要變數 |
| webServer port 衝突 | 低 | `--strictPort` 確保 port 佔用時明確報錯 |

## Success Criteria

- [ ] `npx playwright test` local 跑綠（1 smoke test passed）
- [ ] CI `e2e-tests` job 跑綠
- [ ] PR-based trigger 正確觸發兩個 job（`build-and-test` + `e2e-tests`）
- [ ] Pipeline 完整存在：Playwright config → npm scripts → ci.yml e2e job → smoke test

## References

- Payroll CI e2e-tests job: `/Users/cheerc/talented-payroll/.github/workflows/ci.yml`
- Payroll emulator gotchas: `/Users/cheerc/agend-customization/dispatch_books/talented-payroll/PROJECT.md §4.1`
- Easyorder firebase config: `frontend/src/firebase/firebaseApp.ts`
- Easyorder CI (current): `.github/workflows/ci.yml`
