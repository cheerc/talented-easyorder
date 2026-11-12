# Issue #709 移除 PC POS prototype Execution Plan

> 本檔只在 plan branch `claude/issue709-prototype-removal-plan`，不併入 `main`。
> 依據：Issue #709 本文、擁有者決定 [6819784703](https://github.com/cheerc/talented-easyorder/issues/709#issuecomment-6819784703)（選 B：移除，移除前打 tag，靠 git 歷史保存）、擁有者授權 [6819835014](https://github.com/cheerc/talented-easyorder/issues/709#issuecomment-6819835014)（dual reviewer 通過後照計畫移除，不再請擁有者確認）。
> 盤點基準：`main` @ `3a8cb89ffd645d0f189bc200ce10b4c1d41cf40c`。

## 1. 目標、範圍與排除

**目標**：主線只剩雲端正式版。移除 prototype 入口（`npm run dev:prototype`、`App.tsx` 的 `AppContent`）、只服務 prototype 的程式／測試／e2e／CI shard；文件改為只開發雲端正式版，環境只分 `firebase-test`、`firebase-production`，本機開發與測試用 `demo-easyorder` Emulator。

**不變（每個 Phase 的共同驗收）**：
- 雲端畫面、command／repository、Rules、lease、備份、診斷行為不變；cloud 缺 Firebase 設定仍 fail closed（顯示「Firebase 設定錯誤」）。
- 雲端登出／失去使用權時清掉的本機資料集合不變（IndexedDB `easyorder-crash-draft-cloud`、localStorage `pos-storage-cloud`、舊 `easyorder-error-log`），錯誤訊息與錯誤合併方式不變。
- 既有 storage key 字面值一律不改名（`easyorder-diagnostics-cloud`、`easyorder-diagnostics-nonprototype`、`easyorder-error-log` 等），避免孤兒資料。
- `data-app-mode="cloud"` 屬性與 `cloud-scale.css` 的限定方式不變（只是永遠設定）。

**不在範圍**：Firebase 專案設定、正式 secret、deploy workflow 權限、`firestore.rules`、command kind／schema；`components/ui/*`（見 Ruling R3）；舊 plan／receipt／ops evidence／retro 等歷史文件內容；裝置上殘留的 `*-prototype` 瀏覽器資料（prototype 跑在 `localhost:5174`，與正式 Hosting 不同 origin，正式版讀不到也不用清）。

## 2. 盤點結論（prototype 專用 vs 共用）

方法：以 TypeScript `preProcessFile` 走 import 圖（腳本見附錄 A），比較「完整 app（`src/main.tsx`）」與「刪掉 `AppContent` 後的雲端 app」及 maintenance CLI（`src/maintenance/cli.ts`、`nodeIo.ts`）的可達模組。並在暫存 worktree 實際刪除後跑 lint、build、Vitest 佐證（§2.4）。

### 2.1 入口

- `frontend/src/App.tsx`：`AppContent`（約 62–377 行）只在 `AppModeContent` 的 `if (isPrototypeMode) return <AppContent />`（632 行）使用 → prototype 專用。`CloudSections`、`CloudBrowserKeyGuard`、`CloudAppContent`、`InitializationProblemPage`、`AppModeContent`、`App`（`FirebaseProvider`）→ 雲端，保留。
- `frontend/src/main.tsx`：prototype 分頁標題（13–15 行）；`applyAppModeAttribute(..., isPrototypeMode)`。
- `frontend/package.json:11` `dev:prototype`；`test:e2e` 串接 `--config playwright.prototype.config.ts`。

### 2.2 雲端仍依賴、必須保留（含名字像 POS 的）

`components/AppShell.tsx`、`components/ErrorBoundary.tsx`、`components/navigationKeys.ts`、`components/screens/BackupScreen.tsx`（`CloudBackupPage` 掛載）、`components/ui/*`、`components/cloud/*`、`auth/*`、`providers/*`、`firebase/*`、`errors/*`、`hooks/useCloudLedger.ts`、`hooks/useFirebase.ts`、`hooks/useTweaks.ts`、`store/uiTweaksStore.ts`、`store/clearSensitivePosData.ts`（P1 改寫）、`storage/retireLegacyRuntimeCache.ts`、`utils/dateTime.ts`、`types/validation.ts`；domain：`cashClose`、`cashSession`、`cloud*`（8 檔）、`ledger`、`ledgerAnomalies`、`ledgerExport`、`ledgerReport`、`menu`、`operatorDisplay`、`postCloseEntries`、`student`、`types`。樣式：`tokens.css`、`cloud-scale.css`、`data-table.css` 全留；其餘見 P4。

### 2.3 雲端→prototype 程式的唯一橋接

`providers/FirebaseProvider.tsx:22` 與 `firebase/authService.ts:6` import `store/clearSensitivePosData.ts`，它再 import `posStore`、`posPersistence`、`mocks/initialData`。所以雲端 bundle 目前帶著整個 POS store。雲端模式下 posStore 用記憶體儲存、`partialize` 回傳 `{}`，雲端 UI 不讀不寫它；實際落到磁碟的清除只有 `posPersistence.clearSensitiveData()`（`store/posPersistence.ts:37-66`）。切斷這座橋（P1）後，下列 24 檔也離開雲端圖：`domain/{faceOrder,ledgerAudit,operatorId,posFlow,posTransaction,practiceSnapshot}`、`mocks/initialData`、`storage/{indexedDBStorage,migration,posStateValidator,wireTypes}`、`store/{currentBusinessDate,posPersistence,posStore,posTypes}`、`store/posActions/*`（9 檔）。

另外，雲端路徑上仍有 prototype 分支：`firebase/firebaseApp.ts:16,57`（prototype 視為未設定 Firebase）、`errors/errorLogger.ts:21-36,188-409`（prototype 用自由文字 logger）、`appMode.ts`（`validateAppModeConfig` 放行 prototype）。

### 2.4 刪除後的佐證（暫存 worktree，base `3a8cb89`）

刪掉附錄 B 的 111 個原始碼檔、附錄 C 的測試、`styles/dashboard.css`，並把 `clearSensitivePosData.ts` 換成不 import store 的版本後：
- `npm run lint`：通過（無輸出）。`npm run build`：成功。
- `npx tsc -p tsconfig.app.json --noEmit`：app baseline 錯誤 207 → 40（剩下的都在保留檔，與刪除無關；此命令非 CI gate，只作參考）。
- `npx vitest run`：118 檔通過、26 檔 skip（Emulator-only），只有 5 檔要處理：`pcPosFlow.integration`、`pcPosSafety.integration`（prototype App 測試，刪）、`uiTextContract.test.ts:148-151`（讀已刪的 `pos/TopBar.tsx`，刪該 case）、`userVisibleCopy.test.ts:47` 與 `firebase/__tests__/clientWriteSurface.test.ts:53`（「至少 100 個 production 原始檔」的非空檢查，刪後剩 99 → 調門檻，見 P3）。
- 唯一誤判：`cloudRulesProof.spec.ts` 的 `?raw` import，與本案無關。

### 2.5 E2E 與 CI

- prototype 專用：`frontend/playwright.prototype.config.ts`、`e2e/prototype-fixtures.ts`、`e2e/{order-flow,deposit-flow,expense-flow,settlement-flow,prototype-layout}.spec.ts`（全部 import `prototype-fixtures`，在 `npm run dev:prototype` 上跑）。
- 雲端 e2e 全留：`auth`、`cloud-*`、`p13a-*`、`p13b*`、`scenarios`、`smoke`、`ui-closeout` 與 `fixtures.ts`、`helpers/*`、`global-setup.ts`。`playwright.config.ts:14-19` 的 `testIgnore` 只列上述 4 個 flow spec，檔案刪掉後一併刪掉這段。
- CI：`.github/workflows/ci.yml:562` 的 matrix `playwright.prototype.config.ts`；`scripts/__tests__/e2e-ci.test.mjs:15-18` 的 required 清單（會比對 `package.json` 的 `test:e2e` 與 workflow matrix）。`scripts/e2e-ci-gate.mjs` 只看 shards 整體結果，不必改。
- Branch protection（`gh api .../branches/main/protection/required_status_checks`）只要求 `build-and-test`；`e2e` 彙總不是 required，但專案慣例要綠。
- `scripts/easyorder-release.mjs:21` 的說明文字提到 `npm run dev:prototype`。

## 3. Rulings

- **R1** 分 5 個 PR（P1–P5），外加 Operator 打 tag（P0）。— 讓有行為風險的部分（P1 登出清除、P2 入口與 fail-closed）各自小而好審；P3 純刪除、P4 純 CSS、P5 純文件。
- **R2** P1 保留 `store/clearSensitivePosData.ts` 的路徑與 `clearSensitivePosData()` 名稱，只改內容。— 呼叫端（FirebaseProvider、authService）與兩個測試的 `vi.mock` 路徑都不用動；減少 churn。名稱裡的「Pos」是歷史名，不另改。
- **R3** `components/ui/*` 全部保留，包括目前只有 prototype 在用的 `Field`、`NumberField`、`NumericInput`、`PageSkeleton`、`ReasonField`、`TextField`。— 擁有者把 `components/ui/*` 列為共用；是否刪掉未用的 UI 元件另開 issue 決定。
- **R4** `components/screens/BackupScreen.tsx` 留在原路徑，不搬到 `cloud/`。— 搬檔是重構，不在本案範圍。
- **R5** 不新增 Spec PR。backend spec 的 prototype 條款（§5 例外、P13b1 prototype logger、§9 prototype 保留訓練）在 P5 改成「已移除（#709）」說明。— 雲端契約本身沒改，只是刪掉 prototype 的例外。
- **R6** `FRONTEND-PROTOTYPE-HANDOFF.md` 不改名、不刪，頂端加「歷史文件」說明並指向 tag；入口文件改指向 `frontend/CLAUDE.md`、`FRONTEND-UI-STYLE.md`、`DEVELOPMENT-HANDOFF.md`。不新建前端 handoff。— 很多歷史文件連到它；改名會產生大量死連結；減法原則。
- **R7** 歷史文件（`docs/superpowers/plans/**`、`specs/` 中的舊 POS spec、`verification/**`、`reviews/**`、`docs/ops/**` evidence／receipt、`docs/retro/**`、`BACKEND-HANDOFF.md`、`CHANGELOG.md`、`DEVELOPMENT-HANDOFF.md` 舊段落）不改。只在 `frontend-prototype-workflow-spec.md` 與 `ROADMAP.md` 頂端加歷史說明。
- **R8** tag 名稱 `pc-pos-prototype-final`，優先用 annotated tag（帶說明），lightweight tag 也可接受（例如 §4 P0 的 `gh api` 備案）；由 Operator 建立（agents 只能 push `claude/*` branch）。— 見 §4 P0。
- **R11**（r2）`clearSensitivePosData` 的 `isCloudMode` guard 在 **P2** 刪除，不等到 P3。— P2 後 `MODE=prototype`＋完整 Firebase env 會跑雲端 app，但 `appMode.isCloudModeName`（`appMode.ts:32-38`）仍回 false，guard 會讓登出清除直接 return，而 `FirebaseProvider.tsx:95` 仍回報成功。P1 之後雲端路徑上 import `appMode` 的只有 `App.tsx`、`main.tsx`、`firebaseApp.ts`、`clearSensitivePosData.ts` 四處，P2 全部處理，所以 P2→P3 之間沒有其他依 prototype 判斷的雲端行為。
- **R9** `userVisibleCopy` 與 `clientWriteSurface` 的非空門檻改為刪除後實際檔數往下取整到 10 的倍數（預估 `> 90`）；保留它們原本「必須包含特定檔案」的斷言。— 門檻是防止掃描變空的保險，不是安全規則；刪檔讓數量變少是預期的。
- **R10** 不清理 errorLogger 對 `easyorder-error-log-prototype` 的保留行為（`safeDiagnostics.test.ts:19,34` 的 sentinel 測試保留）。— 原規則是「只清已知舊 key、不碰其他 key」，維持即可。

## 4. Phase / PR 分解

順序：P1 → P0（tag）→ P2 → P3 → P4 → P5。每個 Phase 都基於最新 `main`；一次合一個。跨計畫的合併順序見 §6。

### P0 — 建立 tag（Operator 動作）

- **誰**：Operator（agents 依 role 規則只能 push `claude/*` branch，不能 push tag）。如果 Operator 明確授權，Coordinator 也可以用 `gh api -X POST repos/cheerc/talented-easyorder/git/refs -f ref=refs/tags/pc-pos-prototype-final -f sha=<SHA>` 建 lightweight tag。
- **何時**：P1 合併後、P2 合併前。SHA 用當時 `main` 的 HEAD（P2 PR 的 base）。任何 P2 之前的 `main` commit 都有完整 prototype，所以時間點有彈性；但 **P2 合併前 tag 必須存在**。
- **命令**（Operator 本機）：
  ```bash
  git fetch origin main
  git tag -a pc-pos-prototype-final origin/main -m "PC POS prototype 最後版本（Issue #709）；之後主線只開發雲端正式版"
  git push origin pc-pos-prototype-final
  ```
- **驗收**（Coordinator 在給 P2 `[GATE2-PASSED]` 前檢查）：`gh api repos/cheerc/talented-easyorder/git/ref/tags/pc-pos-prototype-final` 有回應；`git fetch origin tag pc-pos-prototype-final && git cat-file -e pc-pos-prototype-final:frontend/playwright.prototype.config.ts` 成功。

### P1 — 雲端登出清除不再依賴 POS store（行為不變的重構）

- **範圍**
  - `frontend/src/store/clearSensitivePosData.ts`：改寫為只 import `../appMode`（`isCloudMode` guard 保留到 P2，見 R11）與 `../errors/errorLogger`（`clearErrorLog`）。內容等同目前 `posPersistence.clearSensitiveData()`（`store/posPersistence.ts:37-66`）：刪 IndexedDB `easyorder-crash-draft-cloud`（`onerror`／`onblocked` 原訊息）、`localStorage.removeItem('pos-storage-cloud')`、`clearErrorLog()` 失敗時加「舊版本機錯誤紀錄清除失敗。」，錯誤以空白串接後丟出。名稱用字面值，並註明是「舊版雲端本機資料 key，保持原名」。刪掉 `clearSensitivePosMemory`（沒有其他呼叫者：`grep -rn clearSensitivePosMemory src` 只在本檔）。
  - `frontend/src/store/posPersistence.ts`：刪 `clearSensitiveData()`（P1 後無呼叫者）及只供它用的 import（例如 `clearErrorLog`，以 lint 為準）。
  - 測試：`src/store/__tests__/clearSensitivePosData.test.ts` 改成直接驅動真的 `clearSensitivePosData()` 並檢查 storage 結果（不再 mock posStore／posPersistence）；把 `src/store/__tests__/clearSensitiveData.test.ts` 的 case 移過去後刪掉該檔；刪 `src/store/__tests__/posPersistence.test.ts:153-156`（只測已移走的 `clearSensitiveData`）。
  - 不動：`providers/FirebaseProvider.tsx`、`firebase/authService.ts` 及它們的測試 mock（路徑與名稱不變）。
- **測試（行為不變的證據；RED/GREEN 改為「先特性測試、後重構」兩個 commit）**
  - Commit 1（characterization，只加測試，在舊程式上必須**通過**）：對真的 `clearSensitivePosData()`，以 cloud 模式驗證。舊程式會載入 `posStore`／`posPersistence`，所以 `appMode` mock 要提供它們用到的 export：`getStorageMode: () => 'cloud'`、`isCloudMode: true`、`isPrototypeMode: false`、`namespacedStorageName`（照 `store/__tests__/clearSensitiveData.test.ts:4-9` 的寫法）：
    1. `pos-storage-cloud` 被移除，`pos-storage-prototype`、無關 key 保留；
    2. `indexedDB.deleteDatabase` 以 `easyorder-crash-draft-cloud` 呼叫，且沒有其他名稱；
    3. deleteDatabase `onblocked` → reject，訊息含「關閉其他 EasyOrder 分頁」；`onerror` → 「雲端暫存資料庫清除失敗。」；
    4. 舊 `easyorder-error-log` 被清掉；`clearErrorLog()` 回傳 false 時訊息含「舊版本機錯誤紀錄清除失敗。」；
    5. IndexedDB 失敗時 localStorage 仍被清（兩者都執行、錯誤合併）；
    6. `isCloudMode: false` 時完全不動 storage（P2 隨 guard 一起刪掉此 case，見 R11）；
    7. 顯示偏好 `easyorder-ui-tweaks`（雲端主題）與安全診斷 key 保留。
  - Commit 2（refactor）：改寫實作與 `posPersistence.ts`、刪 `clearSensitiveData.test.ts`；commit 1 的測試原封不動仍綠。
  - 依賴檢查：`codegraph callers clearSensitivePosData`、`codegraph callers clearSensitiveData`、`codegraph callers clearSensitivePosMemory`，PR 內列出直接呼叫者（預期：FirebaseProvider、authService；posPersistence 版僅 clearSensitivePosData）。
- **驗收**
  - 附錄 A 腳本：`node walk.cjs <frontend> src/main.tsx` 的輸出**不含** `store/posStore.ts`、`store/posPersistence.ts`、`mocks/initialData.ts`（證明雲端 bundle 不再帶 POS store）。
  - `cd frontend && npm run lint && npm run build && npx vitest run src/store src/providers src/firebase/__tests__/authService.test.ts`；完整 `npx vitest run` 在 CI。
  - App baseline 錯誤數不增加（`npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -c "error TS"`，base 207）。
  - CI：`build-and-test`、`e2e`（含 `p13a`、`p13b1` shards）全綠。
- **風險**：登出清除漏掉任一 key 時，**唯一**會失敗的是 commit 1 的 characterization 單元測試。`p13a-storage.spec.ts` 只檢查不該存在的資料不存在，不會先寫入 `pos-storage-cloud`／`easyorder-crash-draft-cloud` 再檢查清除，所以不能當成這件事的防護。審查要逐條對照 case 1–7 與 `posPersistence.ts:37-66`。

### P2 — 移除 prototype 入口、e2e 與 CI shard（行為變更：prototype 模式不再存在）

- **前置**：P1 已合併；P0 tag 在本 PR 合併前存在。
- **範圍（程式）**
  - `frontend/src/App.tsx`：刪 `AppContent` 與只給它用的 import（以 `noUnusedLocals` 錯誤為準；盤點時是 2–15、17–20、23–28、30、32、35、42–45 行，及 34 行的 `isPrototypeMode`）；`AppModeContent` 刪 `if (isPrototypeMode) return <AppContent />`。
  - `frontend/src/main.tsx`：刪 prototype 分頁標題（12–15 行）；`applyAppModeAttribute` 改為一律設 cloud。
  - `frontend/src/appMode.ts`：`validateAppModeConfig` 刪 prototype 放行分支；`applyAppModeAttribute(root)` 改為永遠 `setAttribute('data-app-mode','cloud')`。**其他 export（`isPrototypeMode`、`namespacedStorageName`、`getStorageMode`、`StorageMode` 等）留到 P3**，因為待刪的 dead 模組還在 import 它們。
  - `frontend/src/firebase/firebaseApp.ts`：刪 `isPrototypeModeName` import 與 57–59 行的 prototype 分支。
  - `frontend/src/store/clearSensitivePosData.ts`：刪 `isCloudMode` guard 與 `../appMode` import（R11）。只有 Firebase 已設定時 `FirebaseProvider`／`authService` 才會呼叫它。
  - `frontend/src/errors/errorLogger.ts`：刪 `isPrototypeMode` 與所有 prototype 分支（自由文字 logger、`LOG_KEY` 的 prototype 值、`readSafeDiagnostics`／`clearSafeDiagnostics`／`appendCommandDiagnostic`／`appendErrorLog`／`readErrorLog`／`clearErrorLog`／409 行的 prototype 判斷）。非 prototype 路徑的行為與 key 字面值不變。
- **範圍（e2e／CI／script）**
  - 刪 `frontend/playwright.prototype.config.ts`、`frontend/e2e/prototype-fixtures.ts`、`frontend/e2e/{order-flow,deposit-flow,expense-flow,settlement-flow,prototype-layout}.spec.ts`。
  - `frontend/playwright.config.ts`：刪 `testIgnore`（14–19 行，只列已刪檔案）。
  - `frontend/package.json`：刪 `dev:prototype`；`test:e2e` 刪 `&& npx playwright test --config playwright.prototype.config.ts`。
  - `.github/workflows/ci.yml:562`：刪 `- config: playwright.prototype.config.ts`。
  - `scripts/__tests__/e2e-ci.test.mjs:16`：required 清單刪 `playwright.prototype.config.ts`（其餘斷言不動）。134 行的註解是歷史觀察，保留。
  - `scripts/easyorder-release.mjs:21`：說明文字刪「練習用 frontend/npm run dev:prototype，」，保留「Emulator 明示 demo-easyorder」。
- **範圍（與命令一致的文件，必須同 PR）**
  - `frontend/CLAUDE.md`：刪 `npm run dev:prototype` 行；`test:e2e` 註解改「cloud E2E」；「九個 Playwright 設定」→「八個」；Mode 段落改寫：`appMode.ts` 判定 Firebase 設定與 fail closed，不再有 prototype／local 模式，不得新增本機業務資料模式或退回 local POS。
  - `README.md`：刪「本機練習模式」段（21–28 行）；改寫為：`npm run dev` 需要 `frontend/.env`（範本 `frontend/.env.example`），缺設定會 fail closed；自動化測試用 `demo-easyorder` Emulator，命令見 `frontend/CLAUDE.md`。只寫已核對存在的命令，不宣稱有手動 Emulator 登入流程。
  - `CLAUDE.md:18`（r2 從 P5 移來）：前端接手入口改為 `frontend/CLAUDE.md`＋`docs/FRONTEND-UI-STYLE.md`，不再指向 `FRONTEND-PROTOTYPE-HANDOFF.md`。`CLAUDE.md:7` 仍在 P5。
  - `docs/FRONTEND-UI-STYLE.md`（r2 從 P5 移來）：第 3 行刪「prototype 頁面（`npm run dev:prototype`、…）不套用」；第 13 行改為 `applyAppModeAttribute` 一律設 `data-app-mode="cloud"`（刪「prototype 不帶該屬性」）；第 67 行改為「`topbar.css` 的 px 字級保留不改，雲端以 `cloud-scale.css` 覆寫」。只改文字。第 14、15 行留到 P5（相關 CSS 到 P4 才刪）。若 #711 尚未合併，後合併者 rebase。
- **測試**
  - RED commit（只加測試，必須因預期原因失敗）：
    1. App 入口：`MODE=prototype`、無 Firebase 設定 → render `App` 後出現 `main[aria-label="Firebase 設定錯誤"]` 與 alert（目前會進 `AppContent` 顯示 POS → 失敗）。必須驅動真的 `App`／`appMode`（`vi.stubEnv` + `vi.resetModules` 後動態 import），不可 mock `validateAppModeConfig`。
    2. `firebaseApp.test.ts`：`getFirebaseConfigState({ ...fullEnv, MODE: 'prototype' })` → `configured: true`（目前回傳 not configured → 失敗）；取代 38–49 行的舊 case。
    3. errorLogger：`MODE=prototype` 下 `appendErrorLog` 寫入安全診斷（`SAFE_DIAGNOSTICS_STORAGE_KEY`），不寫 `easyorder-error-log-prototype`（目前寫自由文字 → 失敗）。
    4. 登出清除（R11）：`MODE=prototype`＋完整 Firebase env，用真的 `appMode`（`vi.stubEnv` + `vi.resetModules` 後動態 import，不 mock `appMode`）呼叫真的 `clearSensitivePosData()` → `pos-storage-cloud` 被移除、`indexedDB.deleteDatabase('easyorder-crash-draft-cloud')` 被呼叫（目前 guard 直接 return → 失敗）。
  - GREEN commit：上列程式、e2e、CI 變更；並刪除／改寫依附 prototype 入口的測試：
    - 刪（render prototype `App`）：`src/__tests__/helpers/renderApp.tsx`、`integrationApp.test.tsx`、`otherMeals.integration.test.tsx`、`pcPosFlow.integration.test.tsx`、`pcPosSafety.integration.test.tsx`、`refundRework.review.test.tsx`、`reportScreen.integration.test.tsx`、`undoAfterCommit.integration.test.tsx`。
    - 改：`appMode.test.ts`（`validateAppModeConfig('prototype', {})` 改為預期 fail closed；其餘 case 留到 P3）、`appModeAttribute.test.ts`（刪「prototype 不帶屬性」case，保留 cloud case）、`errorLogger.test.ts`（3 行 `vi.stubEnv('MODE','prototype')` 與測自由文字 logger 的 case 刪除或改為非 prototype 預期）、`store/__tests__/clearSensitivePosData.test.ts`（刪 P1 的 case 6，並移除只為 guard 而設的 `isCloudMode` mock）。
    - GREEN 後完整 `npx vitest run` 若有**不在上列**的失敗，停下來回報 Coordinator，不要自行擴大刪除。
  - 可另一個 commit 做文件（`frontend/CLAUDE.md`、`README.md`、`CLAUDE.md:18`、`docs/FRONTEND-UI-STYLE.md`）。
- **驗收**
  - `cd frontend && npm run lint && npm run build && npx vitest run`；`node --test ../scripts/__tests__/e2e-ci.test.mjs`（P2 後 required 為 8 個 Playwright config + hosting）。
  - 本機至少跑一個雲端 Emulator shard：`npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test --config playwright.p13a-no-config.config.ts"`（缺設定 fail closed）與 `playwright.keyboard.config.ts`（外殼與 F 鍵）。全部 shards 在 CI。
  - `rg -n "dev:prototype|playwright\.prototype" frontend scripts .github README.md CLAUDE.md docs/FRONTEND-UI-STYLE.md` 無結果；`CLAUDE.md` 不再連到 `FRONTEND-PROTOTYPE-HANDOFF.md`。
  - App baseline 錯誤數不增加。
- **REVIEW.md 對應**：#5（fail closed 仍成立，且 RED 測試證明 prototype mode 也 fail closed）、#9（刪 shard 是因受測程式已刪，不是削弱 gate：其餘 shards 與 `e2e-ci-gate.mjs` 不變，`e2e-ci.test.mjs` 仍要求每個存在的 config 都在 matrix）。PR 描述須逐一列出刪掉的測試與其對應的已刪程式。

### P3 — 刪除已無入口的 prototype 程式與測試（純刪除）

- **前置**：P2 已合併。
- **範圍**
  - 刪附錄 B 的 111 個原始碼檔（components／hooks／domain／store／storage／mocks）。
  - 刪附錄 C 的 95 個測試／測試 helper。
  - `frontend/src/appMode.ts`：刪 P3 後無人使用的 export：`PROTOTYPE_MODE`、`isPrototypeModeName`、`isPrototypeMode`、`isCloudModeName`、`isCloudMode`、`StorageMode`、`getStorageMode`、`namespacedStorageName`、`canResetData`、`canSeedData`。保留 `hasFirebaseConfig`、`validateAppModeConfig`、`APP_MODE_ATTRIBUTE`、`applyAppModeAttribute`。檔頭 prototype 註解一併改掉。
  - （r2）`clearSensitivePosData.ts` 的 guard 已在 P2 刪除（R11），P3 不再處理。
  - 測試調整：`appMode.test.ts` 刪已刪 export 的 case；`App.mode.test.tsx:28`、`App.ledger.test.tsx:19`、`App.backup.test.tsx:32` 的 mock 刪 `isPrototypeMode`；`App.mode.test.tsx:39` 刪 `vi.mock('../storage/crashDraft', …)`（模組已刪，dead mock）；`uiTextContract.test.ts:148-151` 刪 TopBar case；`userVisibleCopy.test.ts:47`、`firebase/__tests__/clientWriteSurface.test.ts:53` 依 R9 調門檻；`uiTweaksStore.test.ts:324` 若只是清 `pos-storage-prototype` 可刪該行。
- **測試**：RED/GREEN 不適用——純刪除沒有入口可達的程式，雲端行為不變。改以下列證據代替：
  - 附錄 A 腳本：刪除後，`src/` 下每個非測試檔若不在 `src/main.tsx`＋maintenance 可達集合內，只能是既有孤兒：`components/ui/{Field,NumberField,NumericInput,PageSkeleton,ReasonField,TextField,Tabs}`、`hooks/useConnectionStatus.ts`、`firebase/operatorAdmin.ts`、`maintenance/{capacityGate,capacityModel,loadFit}.ts`、`test/*`。PR 附上輸出。
  - 附錄 A 的 broken-import 腳本輸出為空：沒有剩下的檔案 import 已刪路徑，也沒有 `vi.mock(`／`vi.doMock(`／`vi.unmock(` 指向已刪路徑（`cloudRulesProof.spec.ts` 的 `?raw` 例外）。r2 盤點：P1／P3 後唯一的 dead mock 是 `App.mode.test.tsx:39`；`store/__tests__/clearSensitive*.test.ts` 的 mock 由 P1 處理。
  - `codegraph impact` 抽查：`usePosStore`、`AppContent` 相關符號在剩餘程式無呼叫者。
- **驗收**
  - `cd frontend && npm run lint && npm run build && npx vitest run`（盤點時：118 檔通過、26 檔 Emulator skip，P3 實際數字以 PR 為準）。
  - App baseline 錯誤數記錄 before／after（盤點時 207 → 40），只會減少。
  - CI `build-and-test`（含所有 Emulator proof 步驟）、`e2e` 全綠。
  - `rg -n "isPrototypeMode|PROTOTYPE_MODE|namespacedStorageName|usePosStore" frontend/src` 無結果。
- **風險**：檔案很多但都是刪除。審查重點：附錄 B 沒有誤刪 §2.2 的保留檔；附錄 A 輸出可重現。

### P4 — 刪除只服務 prototype 的 CSS（純刪除）

- **前置**：P3 已合併；建議 #711（改 `index.css`、`cloudPagesCss.test.ts`）與 #704／#705（可能改 `topbar.css`、`cloud-scale.css`）先合併，P4 再基於最新 `main`。
- **範圍**
  - 刪 `frontend/src/styles/dashboard.css` 與 `index.css` 的 `@import './styles/dashboard.css';`（盤點：21 個 class 全部只出現在已刪程式）。
  - `styles/pos.css`（1364 行，196 個 class，被保留程式引用的約 15 個且多為一般字詞）、`report.css`、`admin.css`、`topbar.css`、`restore.css`、`index.css`：刪「選擇器要求的 class 在保留的 `.ts/.tsx` 中沒有出現」的規則。
  - 判定方法（PR 附上）：對每條規則，選擇器中至少一個 class 在保留程式中找不到（含 template literal 組出的 class，先 `rg 'className=\{`'` 檢查動態 class，例如 `cloud-day-close__status--${...}`），該規則就不可能命中雲端 DOM，可刪。拿不準就留。附錄 A 的 `css.cjs` 可做初篩，但字詞型 class（`card`、`warn`、`search`、`mode`、`bar`、`ok`、`r`）一定要人工確認。
  - `cloudPagesCss.test.ts:240,279` 的「topbar.css px 保留給 prototype」：P4 不改 px 規則本身；測試註解可在 P4 改成不提 prototype（文件第 67 行已在 P2 改）。
- **測試**：RED/GREEN 不適用（純刪除不會命中的規則）。證據：判定表＋`cloudPagesCss.test.ts` 綠＋全部雲端 Playwright shards 綠（含 `ui-closeout`、`cloud-shell`、`cloud-keyboard`、`p13b1-diagnostics` 的畫面斷言）。
- **驗收**：`npm run lint && npm run build && npx vitest run src/components/cloud/__tests__/cloudPagesCss.test.ts`；CI 全綠。
- **風險**：誤刪會讓雲端版面走樣，而單元測試抓不到。所以保守刪；P4 可以只做 `dashboard.css`＋明確的整段 prototype 區塊，其餘留待日後，不影響本 issue 驗收。

### P5 — 文件改為只開發雲端正式版（docs-only）

- **前置**：P2、P3、P4 已合併（文件描述的現況要與程式一致）。`FRONTEND-UI-STYLE.md` 與 #711 衝突，建議 #711 先合併。
- **範圍**
  - `CLAUDE.md:7`：改為「本 repo 只開發雲端正式版；PC POS prototype 已移除（tag `pc-pos-prototype-final`），歷史在 git」。保留「功能完成、部署、營運驗收是不同 gate」。加一句環境分界：部署 target 只有 `firebase-test`、`firebase-production`（不同 Firebase 專案／資料庫），本機與 CI 測試只用 `demo-easyorder` Emulator。（`CLAUDE.md:18` 已在 P2 改。）
  - `README.md`：標題去掉「(PC Counter Prototype)」；第 3、5 行改寫（不再以 prototype／操作清單為入口）；Documentation 段的 Handoffs 與「Frontend prototype spec」改為歷史說明或移除；加入 firebase-test／firebase-production 分界（一兩句，細節連到 `docs/ops/DEPLOYMENT-GUIDE.md`）。
  - `REVIEW.md:23`（#5）：改為「cloud 缺 Firebase 設定時沒有 fail closed，或新增／恢復本機業務資料模式、local POS、離線帳務」。`REVIEW.md:55`：改為「Firebase 設定判定與缺設定 fail closed、登出清除訂閱與本機資料」。
  - `docs/PROJECT-STATUS.md`：62–118 行的 prototype 定稿線、M0–M4 表、本人驗收清單段落，壓成一段「歷史：prototype 已於 #709 移除，見 tag 與 `FRONTEND-PROTOTYPE-HANDOFF.md`」；第 73 行的產品描述改成雲端正式版；不複製測試數字。
  - `docs/FRONTEND-PROTOTYPE-HANDOFF.md`：頂端加歷史說明（已移除、tag 名稱、現行前端入口連結），內文不改（R6）。
  - `docs/FRONTEND-UI-STYLE.md`（第 3、13、67 行已在 P2 改）：第 14 行刪「這個 prototype tweak」與「（`--fs` 仍給 prototype）」，改寫成 `body[data-fs]` 的現況（依 P4 後 CSS 是否還在）；第 15 行改成 `--r` 為 px 的現況（不提 prototype）。只改文字，不改規範內容。
  - `docs/ops/security.md:6`（living 入口文件）：刪「不以 prototype 的自由文字 sanitize logger 推定 Cloud 無個資」這個子句（P2 後已無該 logger），保留 strict allowlist 與錯誤訊息規則。
  - `docs/ops/DEPLOYMENT-GUIDE.md:184,186`：**不改**。「失敗不能改回舊 prototype／payroll」「不以載 prototype 快照修帳」在移除後仍是正確的禁止事項（R7）。
  - `docs/superpowers/specs/2026-10-13-free-production-backend-spec.md`：110 行刪「prototype 保留原 persist…」與「或明確只供 prototype」；216 行刪「只有明確 `prototype` 模式保留練習 logger 與 `-prototype` namespace」，「prototype 與無關 sentinel 保留」改「其他 key 保留」；235 行改「prototype 已移除（#709）；舊練習快照不可 restore 到正式庫」；323 行 U9 同步。每處只刪 prototype 例外，雲端規則字句不動（R5）。
  - `docs/superpowers/specs/2026-10-21-cloud-command-recovery-contract.md:91`：「prototype/Auth 資料不變」改「Auth 資料不變」。
  - `docs/superpowers/specs/frontend-prototype-workflow-spec.md`、`docs/superpowers/plans/ROADMAP.md`：頂端加歷史說明（R7）。
  - `docs/DEVELOPMENT-HANDOFF.md`：依其慣例在頂端加一段 #709 接手點（PR 編號、merge SHA、prototype 已移除、tag 名），不改舊段落。
  - 其他：`rg -n -i "prototype|dev:prototype|FRONTEND-PROTOTYPE-HANDOFF|練習模式" --glob '*.md' --glob '!docs/superpowers/plans/**' --glob '!docs/superpowers/verification/**' --glob '!docs/superpowers/reviews/**' --glob '!docs/retro/**' --glob '!docs/ops/free-production-evidence.md' --glob '!docs/ops/*review*' --glob '!docs/ops/*receipt*' --glob '!docs/ops/p0*' --glob '!docs/ops/baselines/**' --glob '!CHANGELOG.md'`：`docs/ops/` 只排除 evidence／review／receipt／baseline 等歷史檔，living 檔（`security.md`、`DEPLOYMENT-GUIDE.md`、runbook）要看。每個剩下的命中逐一處理，或在 PR 依 R7 說明為何保留（例如 `DEPLOYMENT-GUIDE.md:184,186`、`BACKEND-HANDOFF.md`、舊 POS spec、`DEVELOPMENT-HANDOFF.md` 舊段落、與 `Object.prototype` 等無關的字詞）。
- **測試**：RED/GREEN 不適用（docs-only）。依 repo docs-check 做 arch／adr／area 判斷並寫在 PR；核對新增／修改的相對連結與路徑存在、文件中的命令與 `frontend/package.json`、CI 一致。不宣稱跑過 app tests。CI 會走 docs-only 分類（`build-and-test`、`e2e` 以 docs-only 方式通過）。
- **驗收**：上述 `rg` 只剩歷史文件；連結檢查通過；`CLAUDE.md` 不含進度數字。

## 5. 驗證總表

| Phase | RED/GREEN | 刪除的測試 | 必綠 CI |
|---|---|---|---|
| P1 | 特性測試先（舊碼綠）→ 重構 | `store/__tests__/clearSensitiveData.test.ts`（case 移到 `clearSensitivePosData.test.ts`） | build-and-test、e2e（全部 shards） |
| P2 | RED（4 個入口測試）→ GREEN | §4 P2 列的 8 檔＋5 個 prototype e2e spec＋`prototype-fixtures.ts`；改寫 5 檔 | build-and-test、e2e（hosting＋8 個 config） |
| P3 | N/A：純刪除 dead code，附可達性證據 | 附錄 C 95 檔；改寫 8 檔（含 `App.mode.test.tsx:39` dead mock） | build-and-test、e2e |
| P4 | N/A：純刪除不會命中的 CSS，附判定表 | 無 | build-and-test、e2e |
| P5 | N/A：docs-only | 無 | docs-only 分類 |

保留的測試：所有 `components/cloud/**`、`components/ui/**`、`firebase/**`（含 Emulator `*.spec.ts`）、`maintenance/**`、`auth/**`、`providers/**`、`errors/**`、雲端 domain（附錄 B 以外的 `domain/__tests__/*`，含 `fixtures.ts`）、`App.mode`／`App.ledger`／`App.backup`、`appMode`、`appModeAttribute`、`financialGuard`、`nanGuard`、`pwaBranding`、`uiTextContract`、`userVisibleCopy`、`clientWriteSurface`、`storage/__tests__/`（P3 後只剩與 `retireLegacyRuntimeCache` 相關者，如有）、`hooks/__tests__/`（P3 後無）、全部雲端 e2e。

## 6. 與其他進行中工作的衝突

**跨計畫合併順序（Coordinator ruling，r2）**：PR #713（#704／#705）先合併 → #709 P1 → P0 tag（Operator）→ #709 P2 → #709 P3 → #710-P1 → #710-P2 → #709 P4 → #709 P5。#707-P1 與本計畫並行進行，已被要求不改附錄 C 的檔案。

| 對象 | 狀態（r2，main @ `79764b3`） | 觸及檔案 | 與本計畫衝突 | 處理 |
|---|---|---|---|---|
| PR #713 `claude/nav-chrome-fixes-704-705`（#704、#705） | open | `App.tsx`、`__tests__/App.mode.test.tsx`、`components/AppShell.tsx`、`components/__tests__/AppShell.focus.test.tsx`、`styles/topbar.css`、`e2e/cloud-shell.spec.ts` | P1 無；P2（`App.tsx` import 區／`AppContent`、`App.mode` 相關）；P3（`App.mode.test.tsx:28,39`）；P4（`topbar.css`） | #713 先合併，P1 起都基於含 #713 的 main；行號以當時檔案為準 |
| PR #711 `claude/cloud-select-baseline`（#706） | open | `index.css`、`styles/cloud-select.css`、`cloudPagesCss.test.ts`、多個雲端頁 CSS、`components/ui/DateField.css`、`FRONTEND-UI-STYLE.md` | P2（`FRONTEND-UI-STYLE.md` 第 3、13、67 行）；P4（`index.css`、`cloudPagesCss.test.ts`）；P5（UI style 文件） | 後合併者 rebase；P4 開工前 #711 應已合併 |
| PR #712（#708） | **已合併**（`79764b3`） | `ActionCard.*`、`CloudOrdersPage.*`、`FRONTEND-UI-STYLE.md` | 已在 main，無待解衝突 | P2／P5 基於含 #712 的 main 即可 |
| #707（加星期） | #707-P1 進行中 | `DateField`、雲端頁等 | P2 刪 prototype `TopBar` 日期，#707 不必處理 prototype；不得改附錄 C 的檔案 | 與 P1–P3 並行；若同時改到 `App.tsx`，後合併者 rebase |
| #710（重新載入按鈕）P1、P2 | 依上方順序排在 #709 P3 之後 | 雲端頁、可能 `App.tsx`（`CloudSections`） | 與 P3 純刪除無交集；排在 P3 之後即可避開 `App.tsx` 交錯 | 依上方順序 |

## 7. 風險與防護

- **誤刪雲端依賴**：附錄 B 由 import 圖算出，並在暫存 worktree 實際刪除後 lint／build／Vitest 通過（§2.4）。P3 PR 要重跑附錄 A 腳本並附輸出。
- **登出清除退化（安全）**：P1 先寫特性測試在舊碼上通過，再換實作；這組單元測試是唯一會抓到漏清 key 的防護（`p13a-storage` e2e 不會先寫入再檢查清除）。P2 的 RED case 4 防止 P2→P3 之間 `MODE=prototype` 下登出清除被 guard 跳過（R11）。
- **fail closed 退化**：P2 的 RED 測試證明連 `MODE=prototype` 都 fail closed；`p13a-no-config` shard 保留。
- **CI gate 被當成削弱**：P2 只刪掉受測程式已不存在的 shard；`e2e-ci.test.mjs` 仍強制「package.json 的每個 config 都在 matrix」。
- **storage key 改名造成孤兒資料**：所有 key 字面值不改（§1）。
- **CSS 誤刪**：P4 保守、可縮小範圍；不影響 issue 驗收。
- **tag 遺漏**：P2 合併前 Coordinator 檢查 tag（§4 P0）。即使漏了，`<P2 squash SHA>^` 仍可補打，內容相同。

## 附錄 A — 盤點腳本

放在 scratchpad 執行，不要 commit。

`walk.cjs`（從入口走 import 圖，列出可達檔案）：

```js
// node walk.cjs <frontendDir> <root...>
const ts = require(process.argv[2] + '/node_modules/typescript');
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const exts = ['', '.ts', '.tsx', '.js', '/index.ts', '/index.tsx'];
const resolve = (from, spec) => {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), spec);
  for (const e of exts) { const p = base + e; if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; }
  return null;
};
const seen = new Set(); const stack = process.argv.slice(3).map(r => path.resolve(dir, r));
while (stack.length) {
  const f = stack.pop(); if (seen.has(f)) continue; seen.add(f);
  if (!/\.(tsx?|js)$/.test(f)) continue;
  for (const i of ts.preProcessFile(fs.readFileSync(f, 'utf8'), true, true).importedFiles) {
    const r = resolve(f, i.fileName); if (r) stack.push(r);
  }
}
for (const f of [...seen].sort()) console.log(path.relative(dir, f));
```

用法：`node walk.cjs $PWD src/main.tsx`（雲端）、`node walk.cjs $PWD src/maintenance/cli.ts src/maintenance/nodeIo.ts`（maintenance）。

Broken-import 檢查：對 `src`、`e2e` 每個 `.ts/.tsx` 用同一個 `preProcessFile`，列出相對 import 解析不到的檔案（忽略 `.css/.svg/.png` 與 `?raw`）；另外以 regex `vi\.(mock|doMock|unmock)\(\s*['"](\.[^'"]+)['"]` 抽出 mock 路徑，同樣檢查能否解析。P3 後兩者都應為空。

CSS 初篩：從各 stylesheet 抽出 `.class` 名稱，比對保留的 `.ts/.tsx` 原文是否以獨立字詞出現；只當初篩，判定以 §4 P4 方法為準。

## 附錄 B — P3 刪除的原始碼（111 檔，皆在 `frontend/src/`）

- `components/`：AppRouter.tsx, CancelOrderDialog.tsx, EditTransactionModal.tsx, MainLayout.tsx, PosColumn.tsx, PosColumn.types.ts, PwaInstallBanner.tsx, TodayDashboard.tsx, pos-components.tsx, screens.tsx
- `components/admin/`：OpeningCashConfirmDialog.tsx, openingCashConfirmUtils.ts
- `components/pos/`：ActionBar.tsx, ConfirmBanner.tsx, CustomerCard.tsx, DeleteConfirmDialog.tsx, DuplicateWarningBanner.tsx, ExpensePanel.tsx, FaceActivityStrip.tsx, IdleHero.tsx, MidnightBanner.tsx, RecentStrip.tsx, RefundDialog.tsx, SearchBox.tsx, TopBar.tsx, TransactionStatusView.tsx, utils.ts
- `components/report/`：AuditTrailTable.tsx, CashClosePanel.tsx, DayEndBar.tsx, DetailRow.tsx, ExpenseOnlyRow.tsx, ExportActions.tsx, GroupRow.tsx, IncomeRow.tsx, LedgerGroupedTable.tsx, OtherMealsList.tsx, ReopenDialog.tsx, ReportDateRangeControls.tsx, ReportSummaryStats.tsx, SettlementHistoryTable.tsx, SummaryRow.tsx, TransactionLookup.tsx, ledgerGroupUtils.ts
- `components/screens/`：AdminScreen.tsx, FaceTabletSimulator.tsx, HistoryScreen.tsx, PracticeDataPanel.tsx, ReportScreen.tsx, VendorsScreen.tsx（**保留** BackupScreen.tsx）
- `domain/`：auditView.ts, businessDate.ts, constants.ts, faceOrder.ts, index.ts, ipadHandoff.ts, ledgerAudit.ts, ledgerSyncBoundary.ts, operatorId.ts, posFlow.ts, posSearch.ts, posTransaction.ts, practiceSnapshot.ts, transactionLookup.ts, transactionUtils.ts, transactionViews.ts
- `hooks/`：useAppNavigationShortcuts.ts, useCancelDialog.ts, useCommitLifecycle.ts, useConfirmHandler.ts, useCrashDraftRecovery.ts, useExpenseFlow.ts, useExpenseProps.ts, useFlashData.ts, useFocusSync.ts, useIpadHandoff.ts, useKeyboardShortcuts.ts, useOnlineStatus.ts, usePinnedStudent.ts, usePosColumnProps.ts, usePosFlow.ts, useScannerInput.ts, useServiceWorkerCleanup.ts, useSystemDate.ts, useTransactionCommit.ts, useUndoCountdown.ts
- `mocks/`：initialData.ts
- `storage/`：crashDraft.ts, indexedDBStorage.ts, migration.ts, posStateValidator.ts, storageHealth.ts, wireTypes.ts（**保留** retireLegacyRuntimeCache.ts）
- `store/`：currentBusinessDate.ts, posPersistence.ts, posStore.ts, posTypes.ts, selectors.ts（**保留** clearSensitivePosData.ts、uiTweaksStore.ts）
- `store/derived/`：useCashClose.ts, useLedger.ts, useLedgerExport.ts, useLedgerReport.ts
- `store/posActions/`：editActions.ts, expenseActions.ts, faceActions.ts, menuActions.ts, orderActions.ts, paymentActions.ts, practiceDataActions.ts, sessionActions.ts, transactionActions.ts

`domain/{index,constants,transactionUtils,ledgerSyncBoundary}.ts` 與 `components/screens.tsx` 目前已無 production import（只剩 barrel／測試），且 barrel 會 re-export 被刪模組，所以一起刪。

## 附錄 C — P3 刪除的測試（95 檔，皆在 `frontend/src/`）

- `__tests__/`：crossFeatureIntegration.test.tsx, dayEndCashClose.integration.test.tsx, historyLookup.integration.test.tsx, operatorId.test.ts, orderPayment.integration.test.tsx, posStateValidator.test.ts, refundAdminEntry.review.test.tsx, refundRework2.review.test.tsx, storeActions.test.ts
- `__tests__/helpers/`：storeSetup.ts
- `components/__tests__/`：AdminScreen.openingCash.test.tsx, AdminScreen.practice.test.tsx, AdminScreen.studentCode.test.tsx, CancelOrderDialog.test.tsx, EditTransactionModal.test.tsx, FaceTabletSimulator.test.tsx, MainLayout.test.tsx, PwaInstallBanner.test.tsx, TodayDashboard.test.tsx, VendorsScreen.test.tsx, faceCounterViews.test.tsx, pos-components.test.tsx, screens.test.tsx
- `components/admin/__tests__/`：OpeningCashConfirmDialog.test.tsx
- `components/pos/__tests__/`：CustomerCard.test.tsx, DeleteConfirmDialog.test.tsx, RefundDialog.test.tsx, SearchBox.test.tsx, TransactionStatusView.test.tsx
- `components/report/__tests__/`：AuditTrailTable.test.tsx, CashClosePanel.test.tsx, ExportActions.test.tsx, LedgerGroupedTable.test.tsx, ReopenDialog.test.tsx, ReportDateRangeControls.test.tsx, ReportSummaryStats.test.tsx, SettlementHistoryTable.test.tsx, SummaryRow.test.tsx
- `domain/__tests__/`：auditView.test.ts, businessDate.test.ts, ipadHandoff.test.ts, ipadHandoffPii.test.ts, ledgerAudit.test.ts, ledgerSyncBoundary.test.ts, menusByDate.test.ts, otherMeals.test.ts, posFlow.test.ts, posSearch.test.ts, posTransaction.test.ts, practiceAccount.test.ts, practiceSnapshot.test.ts, refund.test.ts, transactionLookup.test.ts, transactionUtils.test.ts, transactionViews.test.ts
- `hooks/__tests__/`：useAppNavigationShortcuts.test.ts, useCancelDialog.test.ts, useCommitLifecycle.test.ts, useConfirmHandler.test.ts, useCrashDraftRecovery.test.ts, useExpenseFlow.test.ts, useExpenseProps.test.ts, useFlashData.test.ts, useFocusSync.test.ts, useIpadHandoff.test.ts, useKeyboardShortcuts.test.ts, useOnlineStatus.test.ts, usePinnedStudent.test.ts, usePosColumnProps.test.ts, usePosFlow.test.ts, useScannerInput.test.ts, useServiceWorkerCleanup.test.ts, useSystemDate.prototype.test.ts, useSystemDate.test.ts, useTransactionCommit.test.ts, useUndoCountdown.test.ts
- `storage/__tests__/`：crashDraft.test.ts, crashDraftTtl.test.ts, indexedDBStorage.test.ts, migration.test.ts, posStateValidator.test.ts, storageHealth.test.ts
- `store/__tests__/`：editActions.test.ts, faceActions.test.ts, ledgerStore.test.ts, menuActions.test.ts, orderActions.test.ts, paymentActions.test.ts, posPersistence.test.ts, posStore.test.ts, practiceDataActions.test.ts, selectors.test.ts, sessionActions.test.ts, transactionActions.test.ts
- `store/derived/__tests__/`：derivedHooks.test.ts

（P1 已處理 `store/__tests__/clearSensitiveData.test.ts`；P2 已處理 `__tests__/helpers/renderApp.tsx` 及 7 個 render prototype App 的測試。）
