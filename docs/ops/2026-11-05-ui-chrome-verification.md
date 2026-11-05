# #648／#650／#652 Chrome 操作驗收清單（待使用者執行）

這是操作清單，不是已通過的 receipt。工程驗證與使用者營運驗收分開記錄。

## 版本與安全前置

| 欄位 | 填寫內容 |
|---|---|
| 待驗收的 merged commit（完整 SHA） | 待 Coordinator 合併後填寫 |
| 實際部署 commit／版本證據 | 未部署；確認與上一列一致後才驗收 |
| URL／環境 | 待填；不得在舊站驗收尚未部署的版本 |
| Chrome 版本／作業系統 | 待填 |
| 操作者／日期 | 待填 |
| 資料來源 | demo-easyorder 合成資料，或使用者自行管理的授權資料；不提交個資或截圖 |

- Chrome 設 **100% zoom**。DevTools 裝置工具列設定 **CSS viewport**，不是螢幕面板解析度：1440×900、1920×1080。
- 依序切換淺色、深色、暖色。每組都做下表；填 `Pass`、`Fail` 或 `未測`，不要把空白／未測視為通過。
- 會寫帳的操作只在安全 demo 合成資料演練；正式資料的點餐、收款、關帳、補記等只能依真實業務與既有操作規範執行。
- **不可在真帳故意製造未知命令、斷線收款或帳差來驗 UI**。待核對與異常狀態由下方工程 fixture 演練。
- Issue 關閉順序：依 Operator 2026-11-05 在 Coordinator session 的最新指示，工程補漏、review／rework、CI 與 merge 後先關 #648／#650／#652，再由 Operator 驗收；後續問題另開 Issue。這取代舊 plan §6 的結案先後，不代表營運驗收已完成，也不授權部署。

## 每組操作清單

每格預設 `未測`。Fail 時在末段填紀錄編號；要比較兩尺寸，請使用相同合成情境。

| ID | Chrome 操作與預期結果 | 淺1440 | 淺1920 | 深1440 | 深1920 | 暖1440 | 暖1920 |
|---|---|---|---|---|---|---|---|
| G1 | 切換三主題；標題、內文、金額層級清楚，無看不清的文字或非預期橫向捲動。1920 字級約為 1440 的 4/3，不靠 Chrome zoom 放大。 | 未測 | 未測 | 未測 | 未測 | 未測 | 未測 |
| G2 | 每頁找「?」：hover 開、移開關；Tab 到按鈕有清楚焦點環並開說明；點擊固定開啟；Esc 關且焦點不丟失；氣泡不遮觸發點、不被裁切。 | 未測 | 未測 | 未測 | 未測 | 未測 | 未測 |
| G3 | 風險文字不藏在「?」：金額、不可逆、資料遺失、重複收款及阻擋原因仍常駐。功能用途／操作方式由「?」說明；資料詳情不是說明，仍能展開。 | 未測 | 未測 | 未測 | 未測 | 未測 | 未測 |
| F1a | F1 櫃台有菜單時維持左右雙欄；今日餐點與其他餐點份數在標題列，操作後與資料一致。 | 未測 | 未測 | 未測 | 未測 | 未測 | 未測 |
| F1b | demo 尚未開帳／無菜單：搜尋區換成整張可點卡片；顯示日期，點卡片或 F3 都到「菜單與開帳」。 | 未測 | 未測 | 未測 | 未測 | 未測 | 未測 |
| F1c | 在 demo 搜尋合成學生、選取與取消；F1–F5、Alt+1–5 與 Q/W/E/R/A 延續原流程；空白搜尋框兩次 Esc 可離開焦點，說明開啟時第一次 Esc 只關說明。 | 未測 | 未測 | 未測 | 未測 | 未測 | 未測 |
| F2a | F2「今日」只有單欄；無未關帳日時一行狀態；有時列可點日期 chips，點後載入該日，無空白左欄。 | 未測 | 未測 | 未測 | 未測 | 未測 | 未測 |
| F2b | 用日期選擇器改完整日期即載入；鍵盤輸入以 Enter／blur 確認；不完整／早於啟用日不誤讀。有未送出草稿時確認捨棄；取消保留草稿，確認才換日。 | 未測 | 未測 | 未測 | 未測 | 未測 | 未測 |
| F2c | 本週／本月仍需按查詢；日摘要、交易及交接表頭垂直置中，金額靠右等寬；資料詳情可展開，不出現來源序號 H。 | 未測 | 未測 | 未測 | 未測 | 未測 | 未測 |
| F3a | 菜單與開帳日期自動載入；今日菜單與開帳現金兩面板對齊；未送出草稿有捨棄確認。開帳金額警示常駐。 | 未測 | 未測 | 未測 | 未測 | 未測 | 未測 |
| F3b | 學生名單、資料來源與新增表單的說明在「?」；結餘金額右對齊；「自行核對、金額沒有預設值」等警示可見。本機診斷入口正常，自動刪除時限提示常駐。 | 未測 | 未測 | 未測 | 未測 | 未測 | 未測 |
| F3c | 「資料備份」在 F3 子選單最後，不在 F2；標題不重複、不寫每日；副標、labels、密碼、檔案選取與操作按鈕一起放大；兩個備份安全警示常駐。 | 未測 | 未測 | 未測 | 未測 | 未測 | 未測 |
| F3d | demo 輸入測試密碼 → 產生 → 下載 → 重新選取檔案驗證 → 登記成功；取消／錯檔不宣稱驗證成功。首次空資料與沒有新紀錄時文字正確；第二份副本依受控媒體規範處理。不得只看到下載就當完成。 | 未測 | 未測 | 未測 | 未測 | 未測 | 未測 |
| F4 | 供應商表頭置中、版面一致；停用／恢復與移除的用途說明在「?」，不可逆警示仍可見，不顯示 tombstone。安全 demo 才演練新增／停用／移除。 | 未測 | 未測 | 未測 | 未測 | 未測 | 未測 |
| F5 | 區間查詢按鈕保留；查詢合成學生歷史；目前結餘不是交易當時餘額的短警語常駐；金額右對齊、兩張表表頭置中；資料詳情可展開。 | 未測 | 未測 | 未測 | 未測 | 未測 | 未測 |
| R1 | 僅 demo fixture：帳務檢查有差額異常、可開「差額處理說明」；補記不改原實點警示常駐。異常徽章文字三主題皆清楚。不要為驗收真的送補記。 | 未測 | 未測 | 未測 | 未測 | 未測 | 未測 |
| R2 | 僅 demo fixture：待核對頁有原命令編號、未決編號不自動淘汰與不得重複收款警示；「?」只含容量說明；未確認前不開新操作，編號不因看說明而消失。 | 未測 | 未測 | 未測 | 未測 | 未測 | 未測 |

### 失敗紀錄與 sign-off

| 紀錄編號／ID | 版本、主題、viewport | 操作／預期／實際 | 新 Issue | 複驗結果 |
|---|---|---|---|---|
| 待填 | 待填 | 待填（不含個資） | 待填 | 未測 |

- 最終使用者驗收：**未執行**。
- 簽認人／日期：待填。
- 結論（通過／部分通過／不通過）與未測項目：待填。

## 工程真頁面驗證（不是上表的人工驗收）

### 版本與重跑

- 測試生產碼 revision：`6ba13bc332d01f51f80be1f15160e2a1aab28207`；後續只補文件時此證據仍適用，PR HEAD／CI 以 PR 為準。
- Base：`a0f21c2c9039fb784bf71889ba1d6d53f58b8de2`。只做 CSS 與驗證補漏，不引入下一 phase。
- 備份 RED `8095288f9a9185c24f8f9b746c1673f1284a47a2` → GREEN `ccc02d4407f96a973a86ac47aa565b67f4a5d129`；source CSS 契約原先 1 failed／85 passed，修正後 86 passed。
- 真頁面對比 RED `852a57c6dddb7c9007cfd30a7562c7849904bd7c` → GREEN `6ba13bc332d01f51f80be1f15160e2a1aab28207`。淺／暖徽章原為 4.006／4.072:1、固定 12px；只在異常頁覆寫為 `--ink` 與 `--t-sm`，保留警示底色、邊線及共用元件。
- `frontend/e2e/ui-closeout.spec.ts` 載入 production App；Auth Emulator 的 Google 合成身分與有效 lease；沿既有 e2e Admin REST 入口建立近期兩個相鄰合成營業日，再經真 repository 讀入帳差。待核對沿既有 journal identity fixture 建立無回執編號，production boundary 真正查 Emulator。沒有 mock 元件、沒有替換 Rules／repository，沒有靜態 HTML 冒充 App。
- 沿既有主題宿主同步設定 `html`／`body` 的 `data-theme`；不是在 fixture 注入字級。測試後移除自身營業日、還原 goLiveDate 並釋放 lease。
- 舊 `ux-ui-audit` probe 不在環境內；替代為上述最小 Playwright：Chromium computed styles、Canvas 將瀏覽器解析的 oklch 轉 sRGB、透明背景合成、相對亮度對比；真 Tab 後量外側 outline，並跑 hover／click／Esc。按鈕可見文字或 aria-label、尺寸、頁面橫向溢出與 tooltip 邊界另有斷言。這不是完整 WCAG 認證。

重跑（Node 24、Java 21、無其他程式占用 4173／8080／9099；工作目錄 `frontend/`）：

```bash
npm ci
npx playwright install chromium
npx firebase emulators:exec --project demo-easyorder --config ../firebase.json --only auth,firestore "npx playwright test --config playwright.config.ts e2e/ui-closeout.spec.ts"
npx vitest run src/components/cloud/__tests__/cloudPagesCss.test.ts src/components/cloud/CloudBackupPage.test.tsx src/components/cloud/CloudLedgerAnomaliesPage.test.tsx
npm run lint
npx tsc -p tsconfig.app.json --noEmit --pretty false
npm run build
```

### 實際結果

lockfile 專用依賴（`npm ci` 後）重跑：Playwright **12 passed**（每個主題／尺寸兩案例，涵蓋三頁）；相關 Vitest **3 files／114 passed、0 skipped**；lint、build 成功。App project TypeScript **exit 2，206 errors／458 輸出行**：對 base 的隔離暫存副本使用同一依賴逐字比對，診斷完全一致；不是 typecheck 全綠。

| 主題（兩尺寸皆同對比） | 備份警示文字 | 異常頁文字最低 | 待核對文字最低 | Tab 焦點環對背景 |
|---|---:|---:|---:|---:|
| 淺色 | 15.26:1 | 5.55:1 | 17.81:1 | 3.12:1 |
| 深色 | 13.67:1 | 6.84:1 | 16.01:1 | 7.55:1 |
| 暖色 | 13.83:1 | 5.63:1 | 16.62:1 | 3.65:1 |

- 備份副標、label、password／file input、native file-selector-button：1440 **15px** → 1920 **19.9997px**；主要操作鈕 **17px** → **22.6663px**。內文由 cloud body 的 `--t-md` 繼承，Callout／HelpTip 各依既有 token；未改共用 `pos.css` 或 prototype。
- HelpTip 實際 hit box：1440 **23.984375×23.984375**、1920 **31.984375×31.984375 CSS px**；1.5rem 排版有小數取整，測試明列 0.05px 容差，**不宣稱精確 ≥24px**。真 Tab 有 2px solid 環、上述對比；四個改動入口都有 accessible name，hover／Tab／click／Esc 全數通過。
- 目視檢視三頁各六組本機畫面（18 張合成資料截圖，不提交）：常駐警示、文字換行、頁面捲動與邊界未見裁切／重疊。自動檢查 tooltip 在視窗內且不遮觸發鈕，頁面無橫向溢出。
- CI：本檔不預填成功；以 PR 的 required checks 為準。新矩陣已加入既有 `playwright.config.ts`，由原 CI shard 執行，未削弱 gate。
- 本機未重跑完整 unit／完整 e2e；由 CI 執行。未重新執行完整備份產生／下載／重選流程的人工測試；現有備份行為 regression 與 CI Emulator proof 負責，不把 initial 備份頁量測當成全流程成功。
- 未部署、未做 production smoke、未執行 Operator 驗收；Downloads 最終版本由 Coordinator 在 merge 後填入實際 SHA 並交付。
