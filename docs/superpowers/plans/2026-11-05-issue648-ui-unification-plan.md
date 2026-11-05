# Issue #648 UI 統一風格：執行計畫（Execution Plan）

- Base：`origin/main` `fe3d42c`（2026-11-05）。每個 Phase 開工時重新以最新 `origin/main` 為 base，並核對本計畫引用的行號（行號會漂移，以 symbol／字串為準）。
- 母 issue：#648。子 issue：#649（備份移到 F3）、#650（說明改「?」）、#651（改日期自動載入）、#652（版面、字級、表格）。
- 來源：Operator 2026-11-05 於 eo.talented.com.tw（main 部署）實際操作回報，以及同日 Planner 對 source 的盤點。issue 內有逐項 source 證據，本計畫不重複。
- 設計參照（假資料，僅供視覺方向；以本計畫與 P1 指引文件為準）：
  - [`assets/2026-11-05-issue648/style-guide-mockup.html`](assets/2026-11-05-issue648/style-guide-mockup.html)：字級、顏色、元件、版面原則；F2 今日、F3 菜單與開帳、F4 供應商套用樣子；淺色／暖色／深色切換。
  - [`assets/2026-11-05-issue648/f1-counter-mockup.html`](assets/2026-11-05-issue648/f1-counter-mockup.html)：F1 櫃台三種狀態（未選學生、已選學生、尚未開帳）。
  - 用瀏覽器直接開檔即可；Operator 已確認方向（2026-11-05「OK」）。

## 1. 目標、範圍與排除

### 目標
1. 建立一套可被後續開發遵循的前端 UI 規範（字級、間距、圓角、字型、共用元件、版面原則），寫成文件並以測試守門。
2. 以該規範逐頁改造雲端 F1–F5，修正 #649–#652 列出的問題。
3. 三主題（淺色 `:root`、`[data-theme="dark"]`、`[data-theme="warm"]`，見 `frontend/src/styles/tokens.css`）在 1440×900 與 1920×1080 下都正確。

### Operator 決策（2026-11-05，不需再確認）
- 設計基準：MacBook Air 13 吋預設縮放 1440×900 CSS px；正式櫃台 24 吋 1920×1080 PC「等比放大」。
- 字型：系統字型（Mac：PingFang TC；Windows：Microsoft JhengHei），不載網路字型。
- 備份：移出 F2 今日，放 F3「今日設定」子選單最後一格「資料備份」；頻率改「不固定，約每月一次」；本階段不改備份功能；未來展望寫進文件。
- 說明：功能說明一律改「?」提示（滑鼠移上、Tab 聚焦、點擊皆可開，Esc 關）；現有 5 處 `<details>` 說明區塊也統一改成「?」（選項 A）。警示保持可見。
- 日期：只有 F2 今日與 F3 菜單與開帳改「改日期即載入」；F2 本週／本月與 F5 的區間查詢保留查詢按鈕。
- F2 今日改單欄：「未關帳營業日」左欄拿掉；無未關帳日只顯示一行狀態；有時顯示可點日期的警示。
- F1：1440 寬維持雙欄；今日份數移到標題列；營業日未建立／無菜單時，點餐區整塊換成可點的大按鈕卡片（F3 同效）。

### 排除（每個 Phase 都適用）
- 不改 command kind、command 內容、repository、Firestore Rules、帳務計算、租約、復原（recovery）與重送識別契約、P14 備份格式與 replay。
- 不碰 prototype（`npm run dev:prototype` 的頁面、`AdminScreen`、`ReportScreen`、`HistoryScreen`、`report/` 下的 `.rpt-*` 元件）。
- 不部署；不推進後端 phase。
- 不提交截圖或個資（repo `CLAUDE.md`）。截圖只在本機或 PR 外部檢視，PR body 記錄量測數字。

## 2. 全域 Rulings（Planner 自行裁定）

- Ruling R1：字級與間距 token 定義一次於 `tokens.css` 的 `:root`，與主題無關；顏色 token 才分主題。理由：三主題共用尺寸，避免三份重複。
- Ruling R2：等比放大用 root 字級 `clamp(14px, calc(100vw / 90), 21.333px)`（1440→16px、1920→21.33px），所有新寫尺寸用 rem。只在雲端模式生效：以 `document.documentElement` 上的屬性（例如 `data-app-mode="cloud"`，由雲端啟動路徑設定）限定選擇器，prototype 不受影響。理由：rem 只能相對於 `html`，無法用 class 局部限定；prototype 不在範圍。P1 必須確認設定點並以測試證明 prototype 的 `html` 不帶該屬性。
- Ruling R3：字級共 7 級（rem，基準 16px）：`--t-xs .8125`（按鍵）、`--t-sm .9375`（標籤）、`--t-md 1.0625`（內文 17px）、`--t-lg 1.25`（區塊標題）、`--t-xl 1.625`（重點）、`--t-2xl 2.25`（頁面標題）、`--t-num 2.5`（大數字）。間距 `--s1..--s7`＝.25/.5/.75/1/1.5/2/3rem。圓角沿用 `--r`、`--r-lg`（改為 rem 等值）。數值取自設計參照，P1 可微調但須寫進指引文件。
- Ruling R4：字型 token `--font-sans: "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", system-ui, sans-serif`、`--font-mono: ui-monospace, "SF Mono", Consolas, monospace`；雲端範圍使用。不新增 `@font-face`、不改 CSP。
- Ruling R5：共用元件放 `frontend/src/components/ui/`，沿用既有 `Button`、`StatusBadge`、`EmptyState`、`Kbd`、`Card`；新增 `HelpTip`、`Callout`、`ActionCard`、`StatTile`。不新增第三方 tooltip 套件；圖示用已依賴的 `lucide-react`（P1 先核對實際 export 名稱）。
- Ruling R6：備份搬家（#649）獨立成一個 Phase，且同一 PR 內「F2 移除＋F3 新增」，不留中間狀態。理由：中間狀態會讓 Operator 找不到備份。
- Ruling R7：警示與說明依「語意」分類，不依現有 class。分類規則寫進指引文件：涉及金額、不可逆、資料遺失、重複收款風險、阻擋操作的原因 → `Callout`（常駐）；功能用途與操作方式 → `HelpTip`。一句混合時拆開。
- Ruling R8：`LedgerUnclosedBanner` 的提示改由新的 `Callout` 呈現（P4 用於 F2 今日、P6 用於 F3 菜單與開帳），行為（顯示條件、資料來源）不變。
- Ruling R9：驗收的對比度以 Chromium 實測為準（`ux-ui-audit` skill 的 `probe-core.js` 對比量測），不在單元測試裡解析 oklch。單元測試只檢查 token 是否三主題齊全。

## 3. Phase／PR 拆分

| Phase | PR 內容 | 對應 issue | 前置 |
|---|---|---|---|
| P1 | 規範文件、token、等比放大、字型、共用元件、表格 CSS 修正、CSS 守門測試 | #648、#650（元件）、#652（表頭） | 無 |
| P2 | F1 櫃台點餐改版 | #652、#650（F1 部分） | P1 |
| P3 | 備份移到 F3「資料備份」＋ spec／runbook 頻率與未來展望 | #649 | P1 |
| P4 | F2 今日：單欄、改日期即載入、說明改「?」、套規範 | #651、#650、#652 | P1、P3 |
| P5 | F2 本週／本月（報表頁） | #650、#652 | P1 |
| P6 | F3 菜單與開帳＋F4 供應商（同一元件 `CloudDayVendorsPage`）：改日期即載入、說明、表格 | #651、#650、#652 | P1 |
| P7 | F3 學生、本機診斷、資料備份頁文字與樣式 | #650、#652、#649（文字） | P1、P3 |
| P8 | F5 查帳、帳務檢查、待核對命令區 | #650、#652 | P1 |

一次只合一個 PR。P2、P5–P8 彼此無依賴，順序可由 Coordinator 調整；P4 必須在 P3 之後（P3 先移走備份，P4 才改 F2 版面，避免衝突）。

## 4. 各 Phase 細節

共通驗證命令（工作目錄 `frontend/`，每個 Phase 都跑，結果寫進 PR body）：

```bash
npx vitest run <本 Phase 相關測試檔>
npm run lint
npx tsc -p tsconfig.app.json --noEmit --pretty false   # 錯誤數須與 base 相同，PR 記錄兩邊數字
npm run build
```

UI 證據（每個 Phase）：`npm run dev` 搭配 `demo-easyorder` Emulator 與合成資料，三主題 × 1440×900、1920×1080 各看一次；用 `ux-ui-audit` 的 `probe-core.js`（對比、tap target、accessible name）與 `probe-focus.js`（真實 Tab 後量焦點環）量測改動頁面，PR body 記錄數字。截圖不提交。

### P1 規範與基礎

**交付**
- 新文件 `docs/FRONTEND-UI-STYLE.md`：設計基準與等比放大、字型、字級與間距 token 表、三主題顏色角色（強調色只給「下一步」；警示色只給金額／不可逆）、元件清單與用法、HelpTip vs Callout 分類規則（R7）、版面原則（每頁同骨架：頁面標題＋右側摘要、子分頁底線、日期列在最上；兩欄上緣對齊；面板內不再包框；只在有內容時才出現的區塊不常駐；金額靠右等寬；不出現工程用語如 seq、H、epoch、tombstone、RecordBackup；按鈕寫出會發生的事）。附上本計畫兩份設計參照的連結。
- `frontend/CLAUDE.md` 加一行指向該文件（改 `frontend/` UI 前必讀）；`docs/FRONTEND-PROTOTYPE-HANDOFF.md` 視 docs-check 判斷是否加入口。
- `frontend/src/styles/tokens.css`：新增 R3 尺寸 token、R4 字型 token（`:root` 一次）；不改既有顏色值。若新增顏色 token（例如 `--on-accent`），三主題都要定義。
- 等比放大（R2）：在雲端啟動路徑對 `html` 設屬性，CSS 以該屬性套 `font-size: clamp(...)` 與 `--font-sans`。
- 共用元件（`frontend/src/components/ui/`，各附 css）：
  - `HelpTip`：圓形「?」按鈕；hover、focus、click 開啟，Esc 與點外面關閉；開啟時不遮住觸發點；`aria-describedby`／`role="tooltip"` 讓輔助技術讀得到；內容可含換行。
  - `Callout`：`variant: 'warn' | 'ok' | 'info'`，圖示＋文字，可放子元素（例如日期 chip）。
  - `ActionCard`：整張是一個 `<button>`，含圖示、標題、說明、動作膠囊與 `Kbd`；accessible name 為完整句子。
  - `StatTile`：標籤＋大數字（等寬），可標 warn。
- 表格：`frontend/src/styles/data-table.css` 的 `th` 加 `vertical-align: middle`，尺寸改用 token；刪除五頁 CSS 中 `th, td { vertical-align: top }` 對 `th` 的作用（`CloudDayVendorsPage.css`、`CloudDayClosePage.css`、`CloudStudentsPage.css`、`CloudReportPage.css`、`CloudAccountHistoryPage.css`）以及被 `.dt` 覆蓋的死宣告。不改各表 TSX（金額欄 `.dt-num` 留給各頁 Phase）。

**TDD**
- RED commit（先提交失敗測試）：
  - `src/components/ui/__tests__/HelpTip.test.tsx`：滑鼠移上顯示、Tab 聚焦顯示、點擊切換、Esc 關閉並保留焦點、`aria-describedby` 指到 tooltip 內容。
  - `ActionCard`、`Callout`、`StatTile` 的 render／accessible name 測試。
  - 擴充 `src/components/cloud/__tests__/cloudPagesCss.test.ts`：(a) `tokens.css` 定義 R3／R4 全部 token；(b) 三主題區塊都定義相同的顏色 token 集合；(c) 雲端頁 CSS 不得對 `th` 宣告 `vertical-align: top`；(d) 新元件 CSS 不得硬寫 px 字級（`font-size: \d+px`）。既有頁面 CSS 的硬寫字級先不禁止（後續 Phase 逐頁加入檢查清單）；把 `CloudOrdersPage.css` 加入 `PAGE_CSS`（先確認它目前是否通過 hex 契約；不通過則在本 Phase 一併修，或記錄為 P2 項）。
  - 等比放大：測試雲端啟動會在 `html` 設定屬性、prototype 不設（找最接近的既有 App／appMode 測試延伸）。
- GREEN commit：實作上述。

**驗收**
- 上列測試 GREEN，既有 `npx vitest run` 全綠。
- 9 張雲端 `.dt` 表的表頭在 Emulator 畫面中垂直置中（三主題）。
- 文件 docs-check 判斷寫進 PR。

**風險**
- root 字級改變會放大所有既有 rem 尺寸：先 `grep -rn "rem" frontend/src/components/cloud frontend/src/styles` 盤點，確認雲端頁在 1440 下沒有意外變形；有則在 PR 記錄並修正。
- `body[data-scale="large"]`（`index.css`）是 prototype tweak；雲端不使用，不刪。

### P2 F1 櫃台點餐

**交付**（`CloudOrdersPage.tsx`／`.css`，依 `f1-counter-mockup.html`）
- 標題列：`櫃台點餐`（`--t-2xl`）＋營業日；右側兩個今日份數 `StatTile`（今日餐點・菜名、其他餐點），取代現在的統計卡。
- ≥1024px（Ruling：以實測 1440 與 1920 為準，斷點可調）維持雙欄：左＝搜尋、結帳模式、結帳明細；右＝今日現金、最近帳戶，不收合。窄於斷點才沿用現有收合行為。
- 營業日未建立（目前 `data-testid="ordering-blocked"`）與無菜單（`orders-menu-unavailable` 兩處）改用 `ActionCard`，放在左欄搜尋區位置，搜尋列在此狀態隱藏；按卡片或 F3 都到「菜單與開帳」。文字：標題「今日尚未開帳」／「今日尚未設定菜單」，說明含日期與「設定後就能開始點餐」。回填日沿用同元件，標題帶日期。
- 金額欄（今日付款明細表）沿用右對齊；字級改 token；`cloud-orders__table` 改用 `.dt` 或對齊 `.dt` 規格。
- F1 的 3 段說明（`cloud-orders__hint` 鍵盤提示、櫃台收支說明、繳費說明）改 `HelpTip`；10 段警示保持可見（改 `Callout` 或維持現位但套 token）。

**TDD**
- RED：`CloudOrdersPage.test.tsx` 新增：營業日未建立時 render 一個 accessible name 含「尚未開帳」且含 F3 的 button，點擊呼叫 `onOpenSettings`；此狀態下搜尋框不在畫面上；有菜單時兩個 StatTile 顯示份數。
- GREEN：實作。保留既有 `data-testid`（或同步更新所有引用它的 unit／E2E）。

**驗證**
- 加跑 `npx playwright test --config playwright.keyboard.config.ts`（`cloud-keyboard.spec.ts`、`cloud-shell.spec.ts`，在 `demo-easyorder` Emulator 內，用 `npm run test:e2e` 同樣的 `firebase emulators:exec` 包裝）以及預設 config 中的 `order-flow`、`deposit-flow`、`expense-flow`（依 `playwright.config.ts` `testMatch` 核對實際範圍）。
- 1440×900：搜尋到結帳不需捲動；1920×1080：版面比例與 1440 相同。

**風險**：F 鍵與 Q/W/E/R/A 鍵盤流程（#566、#598）不得退化；側欄不收合後，焦點順序需重測。

### P3 備份移到 F3「資料備份」

**交付**
- `App.tsx`：`CloudSection` 新增 `'backup'`，`CLOUD_SECTION_LABELS` 加「資料備份」；F3 子選單（`aria-label="今日設定"` 的 nav）最後加「資料備份」；`AppShell` active 對應 `admin`；新 section render `BackupScreen`。
- `CloudDayClosePage.tsx`：移除 `<section aria-label="關帳後備份">`、`backupBlock` prop、`backupRecovering*`、`ownBackupSeqs` 等只為嵌入備份存在的程式；不得影響日結本身的復原與導覽鎖。
- 備份頁必須保留的行為（從日結頁搬過來）：
  1. 備份命令未確認時鎖住導覽（目前經日結頁的 `onNavigationStateChange` 合併回報，見 `CloudDayClosePage.tsx` 約 :806-812）。備份頁要自己回報同一個導覽狀態。
  2. 不與其他雲端命令同時送出：原本以日結頁 `hasRecovery` 鎖備份（`locked`）。搬家後改以 App 已有的 `hasUnresolvedPendingCommands` 與導覽鎖保證；P3 須在 PR 說明新的保證來源並有測試。
  3. 記錄備份後不誤報「其他裝置已更新資料」（#596 的 `useOwnReceiptSeqs`）：備份頁若顯示 `DataUpdatedNotice` 須沿用；回到 F2 時不得因自己的備份而跳提示。
- 文字（只改備份頁標題區，其他文字在 P7）：外層標題「資料備份」，拿掉重複的「每日加密備份」，副標不寫「每日」。
- 文件：
  - `docs/superpowers/specs/2026-10-13-free-production-backend-spec.md` 備份段：頻率改「不固定，約每月一次；不每日提醒」；「首頁顯示最近已匯出 H」若未實作，標明現況或刪除（照實寫）。
  - `docs/superpowers/specs/2026-10-17-cloud-day-close-contract.md`：P11b「關帳區下方掛上 P14 備份區塊」補註已移至 F3（#649）。
  - `docs/ops/firebase-backup-runbook.md`：入口改 F3 › 資料備份；新增「未來展望」：每月自動觸發備份到某雲端（櫃台流動率高、下載到本機有風險、難以反覆訓練）；註明 Firebase 受管備份／排程匯出／PITR 需 Blaze，本案為 Spark 且不啟用 billing，若要做需另找不需付費的方式並由使用者決策。
  - handoff 依 repo 規則更新。

**TDD**
- RED：`App` 層或新頁測試：F3 子選單有「資料備份」並 render 備份頁；F2 今日不再有「關帳後備份」region。把 `CloudDayClosePage.backupLock.test.tsx`、`CloudDayClosePage.backupNotice.test.tsx` 的行為改寫到新宿主（導覽鎖、#596 不誤報），先 RED。
- GREEN：實作。
- 更新 `e2e/cloud-production.spec.ts`（目前斷言 `region '關帳後備份'` 含「每日加密備份」）與 `CloudDayClosePage.test.tsx` 的備份區塊斷言。

**驗證**：加跑 `npm run test:cloud-backup`（Emulator，格式不變的證明）與 `cloud-production.spec.ts` 所屬 E2E config。

### P4 F2 今日

**交付**（`CloudDayClosePage.tsx`／`.css`，依 style-guide-mockup「F2 今日」）
- 單欄：拿掉「未關帳營業日」左欄 section；日期列下方：無未關帳日顯示一行 `✓ 過去沒有未關帳的日子`；有時顯示 `Callout warn`，列出日期 chip（日期＋有效交易數），點 chip 切換到該日。超過可顯示數量時，顯示前幾天並提供「到帳務檢查看全部」（沿用 `onOpenAnomalies`）。原本左欄的「沒有營業日」說明（`data-testid="cloud-no-business-days"`）改 `HelpTip` 或併入 Callout。
- `LedgerUnclosedBanner` 在本頁不再另外顯示（R8），避免同一件事兩處提示。
- 改日期即載入（#651）：日期 `input` 的變更在「值為完整合法日期且 ≥ goLiveDate」時觸發既有 `submitDateSelection` 的同一套驗證與 `loadSnapshot`；鍵盤輸入在 Enter 或 blur 時才確認（避免中途值觸發讀取）；移除「載入日期」按鈕。有未送出草稿（關帳、補開帳、補記、重開表單有輸入）時先用既有 `ConfirmDialog` 問「捨棄草稿？」。連續切換只採用最後一次（確認 `loadSnapshot` 的過期回應處理，缺則補）。
- 日期列不再顯示「資料序號」等工程資訊（如需保留給除錯，移入 `HelpTip`）。
- 摘要改三張 `StatTile`（應有現金、實點現金、差額；差額不為 0 時 warn）。
- 說明 7 段改 `HelpTip`（含 `details.cloud-day-close__intro`）；10 段警示改 `Callout` 常駐（關帳不可逆、重開、補開帳、補記上限、多視窗、待核對、未來日期、缺開帳）。
- 標題統一 token 字級，兩欄問題隨單欄消失；框中框移除。

**TDD**
- RED（`CloudDayClosePage.test.tsx`）：改日期（`fireEvent.change` 完整日期＋確認）即呼叫讀取，不需按鈕；不完整或早於 goLiveDate 不讀取並顯示原錯誤訊息；有草稿時跳確認；無未關帳日不 render 列表 section、render 一行狀態；有未關帳日 render 可點 chip，點擊載入該日。
- GREEN：實作。同步更新 `e2e/cloud-production.spec.ts`、`e2e/p13b2-pending-journal.spec.ts` 中按「載入日期」的步驟。

**驗證**：`CloudDayClosePage*.test.tsx`、相關 E2E config；1440 下關帳流程一屏內可完成主要操作。

### P5 F2 本週／本月

**交付**（`CloudReportPage.tsx`／`.css`）
- 8 段說明改 `HelpTip`（`:934`、`:949`、`:976`、`:1018`、`:1028`、`:1055`、`:1076` 一帶）；「資料詳情」`<details>` 是資料不是說明，不改。
- 三張表（日摘要、交易明細、使用權交接）金額／份數欄加 `.dt-num`；外框統一（`.dt-wrap` 或同規格）。
- 「查詢完整報表」按鈕保留（#651 範圍外），樣式套規範。
- 畫面文字去除工程用語（如「來源序號 H=」），需要保留的資訊放進 `HelpTip`。
- `SettlementHistoryTable.tsx` 屬 prototype，不改。

**TDD**：RED：`CloudReportPage.test.tsx` 斷言金額欄 cell 帶 `dt-num`、說明以 HelpTip 呈現（可用 role／accessible name 查）；GREEN：實作。加跑 `playwright.p12c.config.ts`（`cloud-report-history.spec.ts`）與 `npm run test:cloud-report-actions`（若改到動作區）。

### P6 F3 菜單與開帳＋F4 供應商

**交付**（`CloudDayVendorsPage.tsx`／`.css`、`CloudDayVendorForms.tsx`／`.css`）
- 改日期即載入（#651），規則同 P4；移除「載入日期」按鈕。
- 版面依 style-guide-mockup「F3 菜單與開帳」：日期列（同 P4 樣式）、今日菜單與開帳現金兩個面板並排。
- 說明 6＋2 段改 `HelpTip`（含 `details.cloud-day-vendors__intro`）；`cloud-day-vendors__warning` 6 段與 `CloudDayVendorForms.tsx` 開帳金額警示（現為 `__help` class）改 `Callout`；`:1352` 混合句拆開。
- F4 供應商表：依 mockup「F4 供應商」，表頭已於 P1 置中；工程用語「tombstone」改白話放入 `HelpTip`（停用可恢復；移除不能恢復、編號不再使用；不會改到已存菜單與交易）。
- `LedgerUnclosedBanner` 改用 `Callout`（R8）。

**TDD**：RED：`CloudDayVendorsPage.test.tsx` 改日期即載入、草稿確認、不完整日期不讀取；`CloudDayVendorForms.test.tsx` 警示以 Callout 呈現。GREEN：實作。同步 `e2e/cloud-day-vendors.spec.ts` 中「載入日期」步驟。

### P7 F3 學生、本機診斷、資料備份頁

**交付**
- `CloudStudentsPage.tsx`：4 段說明改 `HelpTip`（含 `details.cloud-students__intro-details`）；3 段警示 `Callout`（`:1746` 混合句拆開）；學生表結餘欄已 `.dt-num`，其他尺寸套 token。
- `CloudDiagnosticsPage.tsx`：說明 1 段改 `HelpTip`。
- `BackupScreen.tsx`（雲端模式顯示部分）：去除 `head H=`、`狀態：generated／downloadRequested`、`RecordBackup`、`seq` 等用語，改白話（例如「備份範圍：第 X 筆到第 Y 筆」「狀態：已產生，等待驗證」）；`:431` 說明與「第二份副本」安全步驟拆開，安全步驟 `Callout` 常駐；`:469` 警示保持可見。用 `ux-writing` skill 改寫。prototype 模式顯示不改（如共用同一字串，以雲端模式為準並在 PR 說明）。

**TDD**：RED：`CloudStudentsPage.test.tsx`、`CloudDiagnosticsPage.test.tsx`、備份頁測試斷言新文字與 HelpTip；GREEN：實作。加跑 `npm run test:cloud-backup`、`playwright.p13b1.config.ts`（診斷）。

### P8 F5 查帳、帳務檢查、待核對命令區

**交付**
- `CloudAccountHistoryPage.tsx`：說明改 `HelpTip`（`:853` 中「不是交易當時餘額」保留一句短的常駐）；`details.cloud-account-history__intro` 改 HelpTip；`:930`、`:949` 警示 `Callout`；兩張表金額欄 `.dt-num`；「查詢完整歷史」保留按鈕。
- `CloudLedgerAnomaliesPage.tsx`：`:68-71` 長說明拆成 HelpTip＋常駐警示「補記不會修改原關帳實點」；`details.cloud-ledger-anomalies__intro` 改 HelpTip；其他說明改 HelpTip。
- `CloudPendingRecoveryBoundary.tsx`：`:539` 容量說明改 HelpTip，但「未決編號不會自動淘汰」常駐；`:560`、`:563` 雙重收款警示原樣常駐。
- 樣式套 token。

**TDD**：RED：三個元件的既有測試檔新增 HelpTip／Callout 斷言與金額欄 `dt-num`；GREEN：實作。加跑 `playwright.p12c.config.ts`、`playwright.p13b2.config.ts`。

## 5. 風險與防退化

- **安全文字被藏**：每個 Phase PR body 列出「收進 ? 的句子」與「保持可見的警示」兩張清單，reviewer 逐句核對 R7。
- **鍵盤流程**：F1–F5、Alt+1–5、Q/W/E/R/A、Esc 行為不得改變；P2、P4、P6 跑 keyboard E2E。HelpTip 不可攔截全域 F 鍵與 Esc 的既有語意（Esc 只在 tooltip 開啟時先關 tooltip）。
- **讀取量**：改日期即載入不得在輸入中途觸發讀取；測試覆蓋「不完整日期不讀取」。
- **復原與導覽鎖**：P3、P4 改到的頁面都持有導覽鎖或復原區；不得改變何時鎖、何時解鎖。
- **三主題**：新增顏色 token 必須三主題齊全（P1 測試守）；每 Phase 三主題實看。
- **E2E 依賴文字與 testid**：移除按鈕或改文字的 Phase，先 `grep -rn` 該文字於 `frontend/src` 與 `frontend/e2e`，一併更新。
- **行號漂移**：本計畫行號以 `fe3d42c` 為準，開工時以 symbol／字串重新定位。

## 6. 完成定義（#648）

- P1–P8 合併；#649–#652 依各自 Expected Outcome 關閉；#648 在 Operator 以三主題、1440 與 1920 實機驗收後關閉。
- 合併後未部署；部署與 Operator 驗收另行安排（firebase-test 依 repo `CLAUDE.md` 規則）。
