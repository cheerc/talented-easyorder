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
  projects: [{ name: 'chromium' }],
  use: {
    baseURL: 'http://localhost:4173',
  },
  // CI: emulators 由 ci.yml step 管理；local: npm run test:e2e 包在 emulators:exec 內
  // 使用 vite preview（production build）而非 vite dev，確保捕捉 build-time 錯誤
  webServer: {
    command: 'VITE_FIREBASE_USE_EMULATOR=true VITE_FIRESTORE_EMULATOR_HOST=127.0.0.1 VITE_FIRESTORE_EMULATOR_PORT=8080 VITE_FIREBASE_AUTH_EMULATOR_URL=http://127.0.0.1:9099 npm run build && npx vite preview --port 4173 --strictPort',
    port: 4173,
    timeout: 120000,
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

新增 e2e 函數（對標 payroll workflow.sh t5，提供統一開發者體驗）：

> **編號決策**：workflow.sh 現有 t1-t7 已全數佔用（t5 = Integration Tests / Firestore Rules）。為避免改動現有編號語意造成混淆，e2e 使用 `e2e` 作為 named option（非數字編號），與既有數字選項共存。CI job 命名使用 `e2e-tests`（對標 payroll）。

新增內容：
1. **Menu display**：在 Testing 區段新增 `e2e) E2E Tests (Playwright + Firebase Emulator)`
2. **函數**：`run_e2e_tests()` — wrapper around `npm run test:e2e`
3. **Case statement**：`e2e) run_e2e_tests ;;`（CLI mode）+ interactive menu case

```bash
run_e2e_tests() {
    echo -e "${CYAN}🎭 E2E Tests (Playwright + Firebase Emulator)...${NC}"

    # Kill any existing emulator on those ports
    lsof -t -i :8080 -i :9099 | xargs kill -9 2>/dev/null || true
    sleep 1

    (cd "$FRONTEND_DIR" && npm run test:e2e) > "$TEMP_LOG" 2>&1
    if [ $? -ne 0 ]; then
        handle_error "E2E Tests" || return 1
    fi
    echo -e "${GREEN}✅ E2E Tests Passed${NC}"
    tail -n 5 "$TEMP_LOG"
}
```

**Verify**: `./workflow.sh e2e` → 啟動 emulators + 執行 Playwright smoke test → passed

### Step 6: Update `ci.yml`

```yaml
name: Frontend CI

on:
  push:
    branches: [dev]
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

**Verify**: PR trigger → `e2e-tests` job 在 CI 上跑綠；push to dev → 兩個 job 都觸發

## CI Trigger 調整

將 `ci.yml` trigger 從無限制 `push`（所有 branch）改為 `push: branches: [dev]` + `pull_request` pre-merge 模式（對標 payroll）：

```yaml
on:
  push:
    branches: [dev]
  pull_request:
    branches: [dev]
    types: [opened, synchronize, reopened]
    paths-ignore:
      - '**/*.md'
      - 'docs/**'
  workflow_dispatch:
```

> **設計決策**：保留 `push: branches: [dev]` 確保 merge 後 dev 有持續驗證（避免 silent regression），限制僅 dev push 觸發節省 CI 分鐘數。PR trigger 在 dev-targeting PR open/sync 時觸發，`paths-ignore` 過濾純文件變更。`workflow_dispatch` 保留手動觸發能力。

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
