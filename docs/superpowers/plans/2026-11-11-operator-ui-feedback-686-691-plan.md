# Operator UI 回饋 #686–#691 執行計畫

- 狀態：待 Coordinator Gate 1（尚未實作）
- Base：`origin/main` @ `9678540`
- 來源 issue 與擁有者決定（有拘束力）：#686（comment 6791269595）、#687（6791287154，含 Coordinator Ruling）、#688（6791269898）、#689（6791270160，含 Ruling）、#690（6791270410）、#691（6791033870）
- 適用指引：根目錄 `CLAUDE.md`、`frontend/CLAUDE.md`、`REVIEW.md`、`docs/FRONTEND-UI-STYLE.md`
- 本計畫只描述執行安排；行為契約以各 spec／contract 為準，並在同一個 PR 內一起更新。

## 1. 目標與範圍

| Issue | 交付結果 |
|---|---|
| #687 | 全站雲端帳戶餘額統一為 `−$N 欠款`（`formatAccountBalance` 為唯一來源）；F1 結帳明細移除「目前餘額」列（三種模式），「預計結餘」標籤不斷行 |
| #690 | 共用單日 `DateField`（外觀以 F2 日結為準）；F1 保留下拉選單、只統一外觀；F1／F2／F3 標籤統一為「營業日」；F1／F3 日期列加狀態區 |
| #688 | 日結頁橫幅與「沒有營業」清單排除目前查看的那一天（n−1）；日期列狀態與橫幅用同一套狀態文字；修訂 day-close contract §11.3 |
| #686 | F3 菜單表單加「複製上週菜單」：列出上一個自然週一～五的每日菜單（不去重、標日期、排除停用／移除供應商），選取後填入可編輯表單；移除「最近較早菜單」卡片、「改為直接設定」與每次載入的往前掃描 |
| #689 | 日結頁：當日數字置頂、單一「補登」入口併入關帳區、補登原因改小字；使用者可見的「回填」全面改為「補登」（用語閘門見 §4）；spec 加一行畫面用語↔程式名稱對照 |
| #691 | 確認後強制接手（Rules 狀態機變更，獨立高風險 PR）；被登出畫面顯示接手者；全站移除「使用權／租約／Epoch／伺服器使用權日期」等用語；移除報表「使用權交接」區；「釋放使用權並登出」→「登出」 |

**不做**：F5 報表／查帳的範圍日期控制項（#690 決定 4，留後續）；舊 PC POS prototype（`components/pos`、`components/screens`、`components/report`）；command kind、資料欄位、collection 改名（#689 Ruling）；CSV 與機器可讀輸出的數值格式（#687 Ruling）；登出前倒數警告（P9 Ruling）。#691 決定 5「不用閒置登出」已由擁有者修訂為「8 小時自動登出」，見 P9。

## 2. 分期與依賴

1 Phase = 1 PR。順序以減少共用檔案衝突為主：`CloudOrdersPage.tsx`、`CloudDayClosePage.tsx`、`CloudDayVendorsPage.tsx` 都由多個 phase 修改。

| Phase | Issue | 主要檔案 | 前置 | 可並行 |
|---|---|---|---|---|
| P1 帳戶餘額格式＋F1 結帳明細 | #687 | `accountBalance.ts`、`CloudAccountBalance.tsx`、`CloudOrdersPage.*`、`CloudStudentsPage.tsx`、`CloudAccountHistoryPage.tsx`、`CloudReportPage.tsx` | — | P7 |
| P2 共用 DateField | #690 | `ui/DateField.*`（新）、`CloudDayClosePage.*`、`CloudDayVendorsPage.*`、`CloudOrdersPage.*` | P1 | P7 |
| P3 日結橫幅 n−1 與狀態文字 | #688 | `CloudDayClosePage.*`、`domain/cloudDayState.ts`（新）、day-close contract | P2 | P4、P7 |
| P4 複製上週菜單 | #686 | `cloudDayVendorRepository.ts`、`CloudDayVendorsPage.*`、`CloudDayVendorForms.*`、day-vendors contract、backend spec | P2 | P3、P7 |
| P5 日結補登區版面 | #689 | `CloudDayClosePage.*` | P3 | P4、P7 |
| P6 「回填」→「補登」用語 | #689 | 雲端頁面、repository 錯誤訊息、contract／spec 用語對照 | P1、P4、P5，**加上擁有者確認 §4 用語表** | P7 |
| P7 確認後強制接手（Rules＋確認對話＋被登出提示） | #691 | `firestore.rules`、`activeAccountLease.ts`、`FirebaseProvider.tsx`、`AuthGate.tsx`、lease／Rules Emulator 測試、spec §4.2、`docs/ops/p05-rules-budget.md` | — | P1–P6 |
| P8 單一操作員白話化 | #691 | `AuthGate.tsx`、`App.tsx`、`errorCatalog.ts`、各頁與 repository 使用權文案、`CloudReportPage.tsx`、`cloudReadRepository.ts` | P6、P7 | — |
| P9 無人使用時自動進入＋8 小時自動登出 | #691 | `AuthGate.tsx`、`FirebaseProvider.tsx`、`activeAccountLease.ts`（若需要）、spec §4.2 | P8 | — |

依賴圖：`P1 → P2 → {P3 → P5, P4} → P6 → P8 → P9`；`P7` 自 base 起獨立進行，P8 需等 P7 merge。

Ruling：P1 放第一位。理由：它只改 `CloudOrdersPage` 的結帳明細與餘額字串，範圍最小；P2 改同檔的標題列，先後 merge 可避免兩邊同時改 `CloudOrdersPage.css`。
Ruling：P3 與 P4 只能在 P2 merge 後才開始。P3／P4 各自只改日結頁、菜單頁的不同區塊，可並行。
Ruling：用語改名（P6）放在所有版面 phase 之後，一次掃全站；之前的 phase 新增文字時暫用現行「回填」，讓 P6 有單一、可 grep 的範圍。
Ruling：P8 排在 P6 之後。P6 與 P8 都會大量改錯誤訊息與頁面文案，分開 merge 可縮小 diff，也避免互相 rebase。

## 3. 各 Phase 細節

所有命令的工作目錄皆為 `frontend/`。下列「預期」指應有結果，本計畫未執行。每個行為 PR 都採 RED → GREEN 兩個 commit：先 commit 只含失敗測試（從真正入口：頁面元件或 repository 驅動），再 commit 實作。

每個 phase 的共同檢查（CI `build-and-test` 等價）：

```bash
npx tsc --noEmit
npm run lint
npx vitest run <本 phase 列出的測試檔>
npx vitest run src/components/cloud/__tests__/cloudPagesCss.test.ts   # 動到雲端 CSS 時（字級 token 守門）
```

完整 `npx vitest run` 與各 Emulator／E2E 分組在 CI 執行；PR body 依 template 記錄 RED／GREEN SHA、命令與結果，以及 skipped／未執行項目。

### P1 帳戶餘額格式統一＋F1 結帳明細（#687）

**範圍**
- `frontend/src/components/cloud/accountBalance.ts`：`formatAccountBalance` 成為唯一格式來源。負值輸出 `−$N`，千分位 `$1,000`。另提供讓元件附上「欠款」字樣與 warn 樣式的方法（例如 `CloudAccountBalance` 加 `debtLabel` 呈現；具體 API 由實作者決定，需在 PR 說明）。依 Ruling，貨幣一律 `$`；`NT$` 參數若已無呼叫端則移除。
- `CloudAccountBalance.tsx`：負值呈現 `−$N 欠款`（「欠款」帶 warn class），取代 `StatusBadge`。
- 呼叫端改用共用 helper／元件（Coordinator 盤點）：
  - `CloudOrdersPage.tsx`：`:1990`、`:2173-2177`、`:2270-2275`（預計結餘）、`:1879`（撤銷提示「餘額回到」）、`:2684`（改單／作廢預覽 A → B）、`:2763`（繳費明細）。
  - `CloudStudentsPage.tsx`：`:350`、`:365`、`:427`、`:429`、`:1608`、`:1613`。
  - `CloudAccountHistoryPage.tsx`：`:849`、`:850`、`:874`。
  - `CloudReportPage.tsx`：`:1056`（報表）、`:1130`（列印餘額欄）。
- F1 結帳明細（`CloudOrdersPage.tsx:2244-2278`）：三種模式都刪除「目前餘額」列。`CloudOrdersPage.css:407-442`：`.cloud-orders__breakdown-row dt` 加 `white-space: nowrap; flex-shrink: 0`，必要時允許 `dd` 換行或縮字，標籤本身不折行。
- **不改**：非餘額的負數（現金差額、`signedMoney`、餐費、退款、支出、淨額、日結「多／少」）；`domain/cloudLedgerExport.ts:93`、`domain/ledgerExport.ts:71`、`data-*`、稽核 JSON。

**驗收**
- 學生餘額 −40、便當 90、實收 0 → 明細只有「今日餐點 −$90／本次實收 +$0／預計結餘 −$130 欠款」，畫面不出現「（欠款 $130）」與明細內的「目前餘額」。
- 繳費模式 → 明細只有「本次繳費／預計結餘」兩列。
- 預計結餘 ≥ 0 → `$N`，不顯示「欠款」。
- 學生頁、查帳頁、報表、列印、撤銷提示、改單預覽：餘額 −1234 → `−$1,234 欠款`；餘額 0 或正數不帶「欠款」。
- CSV 匯出的 balance 欄位值不變（既有 export 測試保持 GREEN）。

**測試**（需改寫釘住舊字串的測試）
- `src/components/cloud/CloudOrdersPage.test.tsx`：`:311-321`（明細目前餘額列 → 改為斷言不存在）、`:323-333`、`:493`、`:1153`；新增三模式列數與「−$N 欠款」案例。
- `src/components/cloud/CloudStudentsPage.test.tsx:193-205`、`CloudAccountHistoryPage.test.tsx:188-200`、`CloudReportPage.test.tsx:162-165`。
- `accountBalance` 單元測試（新增或沿用既有位置）。
- 斷行屬於視覺問題，jsdom 無法驗證：以 CSS 規則斷言（`cloudPagesCss.test.ts` 風格）或於 PR 附手動 1440／1920 檢查說明，標明未自動化。

```bash
npx vitest run src/components/cloud/CloudOrdersPage.test.tsx src/components/cloud/CloudStudentsPage.test.tsx src/components/cloud/CloudAccountHistoryPage.test.tsx src/components/cloud/CloudReportPage.test.tsx src/components/cloud/__tests__/cloudPagesCss.test.ts
npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test e2e/order-flow.spec.ts e2e/cloud-production.spec.ts"   # E2E 若以文字斷言餘額，需同步；以 grep '欠款\|−\$' e2e 確認範圍
```

**風險**：列印版面欄寬（`:1130`）多了「欠款」字樣可能換行，需手動列印預覽。E2E 以文字比對餘額時要同步更新。

### P2 共用單日 DateField（#690）

**範圍**
- 新增 `frontend/src/components/ui/DateField.tsx`＋`DateField.css`（`ui/` 目前沒有日期元件）：
  - 外觀取自 F2 `.cloud-day-close__datebar`（`CloudDayClosePage.css:164-190`：mono、`--t-lg`、`min-height: 3rem`），標籤固定為「營業日」。
  - 兩種輸入：`type="date"`（F2、F3）與 `select`（F1，選項由呼叫端提供），兩者外觀一致。
  - 共用確認邏輯：輸入中不載入，Enter 或 blur 才確認；Tab／Escape 不算輸入。行為來自 F2 `typingDateRef`／`confirmDate`（`CloudDayClosePage.tsx:500`、`:1218`、`:1706-1728`）與 F3 `onDateChange/onDateKeyDown/onDateBlur`（`CloudDayVendorsPage.tsx:949`、`:977-995`），兩份合為一份。
  - 右側 `status` slot（ReactNode），由頁面提供狀態徽章與「今天／過去日期／未來日期」。
- F2 `CloudDayClosePage.tsx:1702-1741`：改用 `DateField`，標籤「查看日期」→「營業日」，狀態內容不變（P3 再統一文字）。
- F3 `CloudDayVendorsPage.tsx:1385-1408`：改用 `DateField`，標籤「查看或設定日期」→「營業日」。日期列加狀態：把 `:1414` 的日狀態徽章移到 status slot，加「今天／過去／未來」。依 #690 決定 5 與 #691 決定 3，移除 `:1402-1405` 的「系統啟用日／伺服器使用權日期」與 `:1407` 的跨午夜 Callout；HelpTip `:1400` 改為不提伺服器／租約的白話說明（例：「改日期後會直接載入該日資料；有尚未送出的內容時會先詢問。」）。
- F1 `CloudOrdersPage.tsx:1760-1776`：只留一個「營業日」。可切換時是 `DateField` 的 select 變體（選項「今天（YYYY-MM-DD）」＋各回填中日子），不可切換時是同樣外觀的唯讀顯示。status slot 顯示「今天」或「回填中」（P6 改為「補登中」）。保留 `data-testid="orders-day-select"`。
- 移除不再使用的頁面 CSS（`.cloud-orders__day-switch`、`.cloud-day-close__input` 的日期列用法、`.cloud-day-vendors__date-form .cloud-day-vendors__input`）。

**驗收**
- F1／F2／F3 日期控制項的 DOM 結構與 class 相同（`DateField` 根 class），標籤都是「營業日」。
- F2／F3：逐字輸入時不載入；按 Enter 或離開欄位後只載入一次；輸入早於系統啟用日的日期時不載入（沿用現行規則）。
- F1：沒有回填中日子時，不出現下拉選單、只顯示一次日期；有回填中日子時，切換選單後載入該日。
- F3 畫面不再出現「伺服器使用權日期」「系統啟用日」與跨午夜 Callout。

**測試**
- 新增 `src/components/ui/__tests__/DateField.test.tsx`（輸入／Enter／blur／Tab／Escape、select 變體、status slot、label 關聯）。
- `CloudDayClosePage.test.tsx`、`CloudDayVendorsPage.test.tsx`、`CloudOrdersPage.test.tsx` 中以「查看日期」「查看或設定日期」「切換營業日」「伺服器使用權日期」查找的測試，全部改為「營業日」。
- E2E：`e2e/cloud-day-vendors.spec.ts`、`e2e/scenarios.spec.ts:194`、`e2e/cloud-keyboard.spec.ts` 中以日期標籤定位的地方（以 `grep -rn "查看日期\|查看或設定日期\|切換營業日" e2e` 列出）。

```bash
npx vitest run src/components/ui/__tests__/DateField.test.tsx src/components/cloud/CloudDayClosePage.test.tsx src/components/cloud/CloudDayVendorsPage.test.tsx src/components/cloud/CloudOrdersPage.test.tsx src/components/cloud/__tests__/cloudPagesCss.test.ts
npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test e2e/cloud-day-vendors.spec.ts e2e/scenarios.spec.ts"
npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test --config playwright.keyboard.config.ts"
```

**風險**：F1 標題列空間較小，大字 DateField 可能擠壓右側計數。實作時在 1440 與 1920（`styles/cloud-scale.css`）各手動檢查一次，必要時給 F1 用 compact 尺寸變體（仍共用元件）。Ruling：允許一個 `size` 參數，不另做第二個元件。

### P3 日結橫幅 n−1 與狀態文字一致（#688）

**範圍**
- 新增 `frontend/src/domain/cloudDayState.ts`（或放在既有 domain 模組；實作者擇一並說明）：單一函式依 `status`、`backfill`、`kind`、`dayId` 與今天的比較回傳狀態文字與 variant。取代 `CloudDayClosePage.tsx:285`（`statusLabel`）與 `:302-307`（`unclosedStatusLabel`），日期列與橫幅 chip 共用。文字暫用現行用語（「回填中」「回填中（已重開）」「已重開」「待確認開帳」「尚未關帳」「已關帳」「開啟中」），P6 再一次改名。
- `CloudDayClosePage.tsx:1614-1621`：`pastUnclosed` 與 `noBusiness` 皆排除 `snapshot.dayId`。剩 0 筆時，`pastUnclosed` 顯示既有的「過去沒有未關帳的日子」，`noBusiness` 區塊不顯示。
- 因為目前這一天已不在清單中，chip 上的 `disabled={... || item.dayId === snapshot.dayId}`（`:1765`）可移除；`busy` 停用保留。
- 日期列 status slot 改用共用狀態函式（日期列對回填日顯示「回填中」，與 chip 一致）。
- `docs/superpowers/specs/2026-10-17-cloud-day-close-contract.md` §11.3（`:129`）：日結頁橫幅改為「列出目前查看日以外的 `unclosed-past-day`；只剩目前查看日時不顯示，該日狀態改由日期列呈現」。F3 開帳區橫幅（`LedgerUnclosedBanner`）規則不變。

**驗收**
- 今天 2026-11-11，未關帳過去日只有 2026-11-05（回填中）→ 查看 11-11：橫幅列出 11-05；查看 11-05：沒有橫幅，顯示「過去沒有未關帳的日子」，日期列顯示「回填中 · 過去日期」。
- 未關帳過去日有 11-04 與 11-05 → 查看 11-05：橫幅寫「過去有 1 天」，只列 11-04。
- 「沒有營業的過去日期」有 11-03 → 查看 11-03：該區塊不顯示 11-03。
- 同一天在日期列與 chip 的狀態文字相同（回填、已重開、待確認開帳三種案例）。

**測試**：`CloudDayClosePage.test.tsx`（`:594-609` 附近擴充；新增上述 4 案例）；新 domain 函式單元測試。

```bash
npx vitest run src/components/cloud/CloudDayClosePage.test.tsx src/domain/__tests__/cloudDayState.test.ts
npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test e2e/cloud-production.spec.ts e2e/scenarios.spec.ts"
```

**風險**：E2E 若點擊目前查看日的 chip 或斷言其 disabled，需要調整（以 `grep -rn "cloud-unclosed-" e2e` 確認）。

### P4 複製上週菜單（#686）

**範圍**
- Repository `frontend/src/firebase/cloudDayVendorRepository.ts`：
  - 移除 `readLatestEarlierMenu`（`:513-570`）與 snapshot 欄位 `latestEarlierMenu`（`:108`、`:643`、`:657`），連帶移除不再使用的常數 `:41-43` 與 `CloudMenuSource`／`InheritanceBlock`（若無其他使用者）。每次載入不再往前掃描。
  - 新增按需讀取：讀取「目標日所在週的前一週」週一～週五（台北日期，以 `dayId` 字串計算，不用瀏覽器時鐘）。查詢 `days` 的 documentId 範圍 `[週一, 週五]`、`orderBy(documentId())`、`limit(5)`，使用 `getDocsFromServer`，符合 Rules `list` 需 `limit <= 500`。回傳有 `menu` 的日子：`{dayId, itemName, price, vendorId, vendorName}`，排除供應商不存在、`deleted` 或非 `active` 的菜單。
  - Ruling：這次讀取不做 head seq 圍欄。理由：清單只是填表建議，送出走 `SetDayMenu` 直接設定，價格、名稱與供應商由 Rules 與送出時的快照驗證；讀取錯誤時顯示可重試的錯誤，不影響頁面其他部分。
  - Ruling：只在按下按鈕時讀取，不在載入 snapshot 時預讀。理由：減少一般載入的讀取量（減法原則）。
- 頁面 `CloudDayVendorsPage.tsx`：
  - 刪除 `:1118-1141`（`beginMenuInheritance`、`switchMenuToDirect`）、`:1159-1172` 沿用送出分支、`:1300-1303`（`canInherit`）、`:1442-1455`（卡片、HelpTip、按鈕、鎖定提示）與 `inheritedFromDate` page state。`submitMenu` 一律送 `inheritedFromDate: null`。
  - 保留既有菜單摘要的「當時沿用來源」（`:1435`）：舊資料仍可能有值。
- 表單 `CloudDayVendorForms.tsx`（`CloudDayMenuForm`）：在標題列加「複製上週菜單」按鈕。不論當日是否已有菜單都顯示；停用條件與表單相同。點擊後開啟 `Modal`（`ui/Modal.tsx` 已處理 focus 移入、還原與 Esc），列出每一天：「11/03（一）· 雞腿便當 · $90 · 供應商A」。不去重。清單以按鈕或 radio 呈現、可用鍵盤操作。選取 → 填入名稱、價格（字串）、供應商 → 關閉 → focus 回到名稱欄。空清單顯示「上週沒有菜單」。讀取中與錯誤狀態要有文字。移除 `fieldsReadOnly` prop（不再需要）。
- HelpTip `:154`「僅可選擇使用中的供應商。」補一句：「可用『複製上週菜單』帶入上週一～五的菜單，帶入後仍可修改。」
- Rules：**不改**。`SetDayMenu` 繼承路徑保留，供舊回執、備份重播與既有資料使用；UI 不再使用。
- 文件：`docs/superpowers/specs/2026-10-15-cloud-day-vendors-contract.md`（`:44` snapshot 型別、`:75` latest-earlier 查找改為上週查詢描述）；後端 spec `2026-10-13-free-production-backend-spec.md` `:45`（F3「未設定菜單可沿用最近較早日期」）、`:107`（「查找最新較早由 repository query 完成」）、`:293` D02 改為「上週菜單複製；繼承路徑保留給舊資料」。

**驗收**
- 目標日 2026-11-12（週四）→ 讀 11-02～11-06。其中 11-02、11-04 有菜單，11-04 的供應商已停用 → 清單只列 11-02。
- 目標日 2026-11-09（週一）→ 讀 11-02～11-06。
- 同樣菜單出現在 11-02 與 11-03 → 列兩筆，各自標日期。
- 上週沒有菜單 → 顯示「上週沒有菜單」，不往前查。
- 選取後欄位可編輯；把價格改成 95 送出 → 命令 `inheritedFromDate: null`、價格 95、`vendorNameSnapshot` 為目前供應商名稱。
- 當日已有菜單 → 按鈕仍在，選取後覆蓋表單草稿（未送出前不改伺服器資料）。
- 載入頁面時不再讀取較早日期的 `days`（repository 讀取測試斷言查詢次數或範圍）。

**測試**
- `src/firebase/__tests__/cloudDayVendorRepository.read.test.ts`：移除 latest-earlier 案例，新增上週範圍與過濾案例。
- `src/firebase/__tests__/cloudDayVendorRepository.spec.ts`（Emulator，P07 proof）：新增「上週讀取在 Rules 下成功（limit 5、currentHolder）」；移除 `latestEarlierMenu` 斷言。Rules 中 `inheritedFromDate` 的 allow／deny 案例保留。
- `src/components/cloud/CloudDayVendorsPage.test.tsx`：`:250`「inherits only the immediate validated earlier menu…」改寫為複製上週流程；刪除「改為直接設定」相關案例。
- `src/components/cloud/CloudDayVendorForms.test.tsx`：按鈕、Modal、鍵盤選取、空清單、focus 回到表單。
- E2E `e2e/cloud-day-vendors.spec.ts`：若涵蓋沿用流程則改寫（以 `grep -n "較早\|沿用" e2e/cloud-day-vendors.spec.ts` 確認）。

```bash
npx vitest run src/firebase/__tests__/cloudDayVendorRepository.read.test.ts src/components/cloud/CloudDayVendorsPage.test.tsx src/components/cloud/CloudDayVendorForms.test.tsx
npx firebase emulators:exec --project demo-easyorder --only firestore "EASYORDER_REQUIRE_CLOUD_DAY_VENDORS=true npx vitest run src/firebase/__tests__/cloudDayVendorRepository.spec.ts --no-file-parallelism"
npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test e2e/cloud-day-vendors.spec.ts"
```

**風險**：日期運算要以字串 `YYYY-MM-DD` 推算週一，不可依瀏覽器時區（沿用 repository 既有的 `shiftDayId`）。容量測試（`cloudCapacity*`、`cloudPageReduction.spec.ts`）若量測 F3 載入讀取數，讀取數會下降，需要更新期望值（以 `grep -rn "latestEarlier\|readLatestEarlierMenu" src` 確認）。

### P5 日結補登區版面（#689 決定 3、4）

**範圍**（`CloudDayClosePage.tsx`）
- `DayFigures`（`:1946`）移到 `指定營業日日結` 區的最上方，在回填卡片之前。
- 刪除獨立的回填資訊卡（`:1824-1838`）：原因移到日結區標題下的一行小字狀態（例：「回填中 · 原因：…」，P6 改名），已重開日的提醒句併入同一行或關帳區說明。
- 單一「到訂餐頁補登 YYYY-MM-DD」入口併入「全日點現金與關帳」區（`:2004-2030`）：只要 `backfillClose`（`:1263`）且有 `onOpenOrders`，就在關帳區頂端顯示一次。對齊差額 ≠ 0 時（`:2020-2030`），提示文字保留但不再另放第二顆按鈕。保留 testid `backfill-align-orders`，另一個 testid 移除（或兩者合併，需說明）。
- `canClose` 為 false（例如缺開帳現金）但為回填日時，補登入口仍要可見：放在補開帳區或關帳區的替代位置，不能因版面調整而消失。實作時列出所有 `snapshot.backfill` 分支逐一驗證。

**驗收**
- 回填日、已開帳、對齊差額 3,960 → 畫面由上到下：數字卡、回填狀態小字（含原因）、關帳區（一顆補登按鈕＋差額提示）。全頁只有一顆「到訂餐頁補登」。
- 對齊差額 0 → 仍有一顆補登按鈕，沒有差額提示。
- 回填日已重開 → 重開提醒仍然可見。
- 已關帳的回填日 → 沒有補登按鈕（沿用 `day?.status !== 'closed'`）。

**測試**：`CloudDayClosePage.test.tsx`（`backfill-info`、`backfill-align-orders` 相關案例）；E2E `e2e/cloud-production.spec.ts:1666`（點 `backfill-info` 內按鈕）需改為新位置。

```bash
npx vitest run src/components/cloud/CloudDayClosePage.test.tsx
npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test e2e/cloud-production.spec.ts e2e/scenarios.spec.ts"
npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test --config playwright.p13b2.config.ts"   # p13b2-pending-journal.spec.ts:2154 斷言回填提示
```

### P6 使用者可見「回填」→「補登」（#689 決定 1、2）

**閘門**：開工前需擁有者確認 §4 用語表。不影響其他 phase。

**範圍**
- 使用者可見文字中，「回填」一律依 §4 改名，包括：
  - `CloudDayClosePage.tsx`（約 26 處，含 toast `:731`、`BACKFILL_STEP_LABEL` `:293`、錯誤訊息 `:1291`、`:1300`、`:1556`、表單 `:1863`、復原面板「回填進度／繼續回填／放棄回填」）
  - `CloudOrdersPage.tsx`（`:1772` 選單、`:1806-1816` 橫幅與「離開回填」、交易標籤 `:2469/:2499/:2737`、退款限制 `:2336/:2344/:2583`）。F1 橫幅原因依決定 3 改為小字。
  - `CloudLedgerAnomaliesPage.tsx:48`、`:83`、`:90`
  - `CloudReportPage.tsx:1058`（「回填」欄值；表頭 `:1043` 若有）
  - `CloudAccountHistoryPage.tsx:865`
  - `domain/cloudDayState.ts`（P3）
  - 會顯示在畫面的 repository 錯誤訊息：`cloudCommandRepository.ts:613/616/1301-1304/1400-1406`、`cloudOrderRepository.ts:471/474`、`cloudDayCloseRepository.ts:461`、`cloudReadRepository.ts:616`
- CSV：`domain/cloudLedgerExport.ts:16/105` 欄名是機器可讀的 `backfilled`，值是 `true/false`，沒有中文「回填」，**不改**（決定 1 的「CSV」在現況下沒有要改的內容，PR 中說明）。
- **不改**：識別字、testid（`backfill-*`）、command kind、collection、程式註解。
- 文件：後端 spec（建議 §4 或術語段）與 `2026-10-17-cloud-day-close-contract.md` 開頭各加一行：「畫面用語『補登』＝程式／資料中的 backfill（`StartBackfill`、`backfillDays`、`backfilled`）。」contract 中描述畫面文字的句子（`:202`、`:208` 等）同步改為新用語，描述資料／command 的句子保留英文名稱。UI 文案常數旁加一行註解指向該對照。

**驗收**
- `grep -rn "回填" frontend/src --include=*.tsx --include=*.ts` 排除 `__tests__`、`*.test.*`、`*.spec.*` 與註解後為 0 筆（PR 附指令與結果）。
- F1 選單選項為「補登中 YYYY-MM-DD」（依 §4 最終用語），橫幅標題不含原因，原因為小字。

**測試**：所有以「回填」文字斷言的單元與 E2E 測試同步改。以 `grep -rln "回填" frontend/src frontend/e2e` 列出。已知包含 `CloudDayClosePage.test.tsx`、`CloudOrdersPage.test.tsx`、`CloudLedgerAnomaliesPage.test.tsx`、`CloudReportPage.test.tsx`、`CloudAccountHistoryPage.test.tsx`、`e2e/cloud-production.spec.ts:1662/1679/1690/1784`、`e2e/p13b2-pending-journal.spec.ts:2154`、`e2e/scenarios.spec.ts:194`。

```bash
npx vitest run src/components/cloud src/domain src/firebase   # 錯誤訊息斷言以 grep -rln "回填" src 確認實際檔案
npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test e2e/cloud-production.spec.ts e2e/scenarios.spec.ts e2e/cloud-report-history.spec.ts"
npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test --config playwright.p13b2.config.ts"
npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test --config playwright.p12c.config.ts"
```

純文案替換屬於行為不變的字串調整。Ruling：仍需 RED → GREEN。理由：使用者可見文字是可觀察行為；RED commit 先把測試斷言改成新用語並確認失敗。

### P7 確認後強制接手：Rules＋接手流程（#691 決定 1、2，高風險）

**現況**（已對照 source）
- `firestore.rules:2213-2234` `system/accessLease` update 有三個分支：
  1. acquire／takeover（`:2220-2222`）：`holderUid == null || updatedAt + 5m <= request.time`；
  2. renew（`:2223-2226`）；
  3. release（`:2227-2229`）。
  另有 P13c1 綁定（`:2231-2233`）：每次 epoch 變動都要同時新建 `accessEvents/{新 epoch}`。
- `accessEventCreate`（`:43-56`）的 kind 推導是 `release | acquire | takeover`。事件內容有 `actorUid`、`actorEmail`、`previousHolderUid`、`at`，任何有效白名單者都能 `get`（`:2239-2244`）。
- 所有業務讀取都用 `currentHolder()`（holder UID ＋ 5 分鐘內）；所有命令都用 `commandHolder(command.leaseEpoch)`（另加 epoch 相等）。接手後 epoch +1，原持有者晚到的命令、讀取、續約、釋放都會被 Rules 拒絕。
- Client `acquireLease`（`activeAccountLease.ts:220-267`）不在 client 端判斷逾期，交給 Rules。所以 Rules 一旦放寬，現有的「重新檢查」按鈕（`AuthGate.tsx:198-210, 278`）會在未經確認的情況下直接接手。
- 被接手的分頁透過 `subscribeLease` 的即時 `onSnapshot`（`activeAccountLease.ts:382-414`、`FirebaseProvider.tsx:151-173, 268`）在數秒內得知 holder 改變，接著停止心跳並清除敏感資料；不必等 120 秒心跳。
- `operators/{uid}` 只能讀本人（`:2205-2206`），別人的顯示名稱讀不到；事件的 `actorEmail` 讀得到。

**Rulings**
- Ruling：沿用既有 `takeover` 分支，不新增 event kind。acquire 條件改為 `resource.data.holderUid != request.auth.uid || resource.data.updatedAt + duration.value(5, 'm') <= request.time`（`null != uid` 為真，所以 null 的情況已涵蓋）。同一 UID 仍須逾期才能重新取得，現有同 UID 多分頁行為（A04、續約路徑）不變。理由：改動最小。kind 列舉、`decodeAccessEvent`（`cloudReadRepository.ts:415-440`）、`firestoreSchema.ts:78`、備份／還原（不讀 kind）都不必改；報表交接區依 #691 決定 4 也會移除，不需要分辨「逾期接手」與「強制接手」。不採新 kind `kick`：client 要用本機時間預測 kind，在 5 分鐘邊界會被 Rules 拒絕，舊版 client 遇到未知 kind 也會讓報表整段 `UNSUPPORTED_SCHEMA`。
- Ruling：**不設送出中命令寬限期。** 理由：
  1. 命令是伺服器原子 commit 並綁定 epoch：接手前已 commit 的照常有效；接手後才到的被 Rules 拒絕，不會寫一半。
  2. 被接手分頁未確認的命令編號留在 pending journal（`cloudPendingJournal.ts`，以 uid 為鍵，不依 epoch）。同一使用者重新登入後，`confirmPendingBatch`（`cloudCommandRepository.ts:703-757`）會在新 epoch 下比對 actor uid 查證。
  3. 寬限期要在 Rules 增加時間窗狀態，違反減法原則。擁有者已接受對方直接斷線（#691 決定 1）。
  「先同步再斷線」在雲端模式下沒有可同步的本機資料，PR 說明中要寫明這點。
- Ruling：「是誰」以接手者 email 顯示（`accessEvents/{目前 epoch}.actorEmail`，有效白名單者本來就能讀），不新增 Rules 讀取權限。理由：顯示名稱放在只能讀本人的 `operators/{uid}`，要開放就得改 Rules 與 schema。spec §4.2 `:79` 寫「可讀不含個資的 lease 占用狀態」，需同步修訂為「占用者 email 可由有效白名單者讀取並顯示於接手提示」（事件 email 已可被讀，屬文件與現況對齊）。**請 Coordinator 確認擁有者接受顯示 email 而非姓名**；若不接受，需另開 Rules 讀取變更，不在本計畫。
- Ruling：確認對話與被接手提示放在本 PR，不延到 P8。理由：Rules 放寬與「重新檢查」會靜默接手的 client 必須同時上線，否則部署後到 P8 之間，按一下就會在未經確認下把人踢掉。

**範圍**
- `firestore.rules`：只改 `:2220` 一個條件，加註解說明 #691。`accessEventCreate`、`commandHolder`、`currentHolder` 不變。
- `frontend/src/auth/AuthGate.tsx`：
  - 有人使用中（`:254-285`）：讀取 `accessEvents/{lease.epoch}` 的 `actorEmail` 顯示「目前由 ○○ 使用中」，不再顯示 UID、Epoch、最後活動時間。
  - 主按鈕「登入並讓對方登出」先開確認對話（沿用 `ConfirmDialog`）：「○○ 正在使用。繼續登入會讓對方立即登出，對方尚未送出的操作不會保存。」，按鈕為「是，讓對方登出並繼續」與「取消」。確認後才呼叫 `attemptAcquire`。
  - 「重新檢查」改為只重新讀取狀態、不接手，或直接移除（實作者擇一並說明）。
  - 保留 15 秒節流（spec「不自動搶占」仍成立：接手需明確確認）。
- `frontend/src/providers/FirebaseProvider.tsx:151-173`：偵測到「自己原本是持有者，現在換成不同 UID」時，記錄 `kickedBy`（以 `getDocFromServer(accessEvents/{epoch})` 取得 `actorEmail`；讀取失敗時退回中性文字「其他人」），交給 `AuthGate` 顯示被登出提示：「○○ 已登入，您已被登出。」＋「我知道了」。「我知道了」之後回到有人使用中畫面（可再確認接手），不另做強制重新整理。
- `frontend/src/firebase/activeAccountLease.ts`：`classifyAcquireFailure`（`:158-182`）與相關錯誤字串依新流程調整；新增讀取接手者 email 的函式（或放在 provider，實作者擇一）。
- spec `docs/superpowers/specs/2026-10-13-free-production-backend-spec.md` §4.2（`:67`、`:69`、`:75`、`:77`、`:79`）：acquire 條件、「有效白名單者確認後可接手他人有效租約；被接手者的晚到命令由 epoch 拒絕」、占用者 email 可讀、無寬限期。
- `docs/ops/p05-rules-budget.md` P13c1 段（`:895-921`）：依附錄方法重新量測 lease update 的 compile 邊界，記錄結果。access call 數預期不變（lease update 3、event create 3）。

**驗收**（Emulator，`demo-easyorder`）
- A 持有有效租約；B（白名單）acquire → 成功，epoch +1，`accessEvents/{epoch}` 為 `takeover`、`actorEmail = B`、`previousHolderUid = A`。
- 接手後 A 以舊 epoch 送命令 → Rules 拒絕；A 讀取業務資料 → 拒絕；A 續約或釋放 → 拒絕。
- 非白名單或 `active == false` 的帳號嘗試接手 → 拒絕。
- A 持有中，同 UID 的另一分頁嘗試以 acquire 分支 epoch +1 → 仍拒絕（未逾期）。
- 未帶 `accessEvents` 新文件的接手 → 拒絕（P13c1 綁定仍有效）。
- UI：B 看到「目前由 a@… 使用中」，按主按鈕 → 出現確認 → 取消時 acquire 不被呼叫；確認後成功進入。A 的分頁在 listener 觸發後顯示「b@… 已登入，您已被登出」，畫面不出現 UID 或 Epoch。

**測試**
- `src/firebase/__tests__/activeAccountLease.spec.ts`：
  - A02.2（`:142-158`，原本斷言 B 得到 `busy`）改為斷言接手成功；
  - 新增上述 Rules 案例（舊 epoch 命令被拒可放在此檔，或放在 `cloudCommands.spec.ts` `:1547` 附近）；
  - E02、E03、E11 依新條件檢查。
- `src/firebase/__tests__/cloudRulesProof.spec.ts:1325-1369`、`firestoreRules.spec.ts:182-241`：有效租約下他人覆寫的 deny 案例改為 allow，並保留非白名單 deny。
- `src/firebase/__tests__/activeAccountLease.unit.test.ts:354`、`src/providers/__tests__/FirebaseProvider.test.tsx`（W5 `:608` 附近：新增 kicked 偵測）、`src/auth/__tests__/AuthGate.test.tsx`（`:147`、`:185`、`:353`：確認對話、取消不接手、不顯示 UID／Epoch、被登出提示）。
- E2E `e2e/cloud-production.spec.ts`：A03（`:141-178`，原本斷言重新檢查不會接手）改為確認後接手、取消不接手；A05（`:214-262`，斷言「目前由操作員 uid 使用中」）改為 email 文案；新增 A 分頁看到被登出提示。

```bash
EASYORDER_REQUIRE_ACTIVE_ACCOUNT_LEASE_PROOF=true npx firebase emulators:exec --project demo-easyorder --only firestore "npx vitest run src/firebase/__tests__/activeAccountLease.spec.ts"
EASYORDER_REQUIRE_CLOUD_RULES_PROOF=true npx firebase emulators:exec --project demo-easyorder --only firestore "npx vitest run src/firebase/__tests__/cloudRulesProof.spec.ts"
npx firebase emulators:exec --project demo-easyorder --only firestore "npx vitest run src/firebase/__tests__/firestoreRules.spec.ts"
EASYORDER_REQUIRE_CLOUD_COMMANDS=true npx firebase emulators:exec --project demo-easyorder --only firestore "npx vitest run src/firebase/__tests__/cloudCommands.spec.ts src/firebase/__tests__/cloudCommandRepository.failure.spec.ts src/firebase/__tests__/cloudPendingJournal.spec.ts --no-file-parallelism"
npm run test:cloud-rules-matrix
npx vitest run src/firebase/__tests__/activeAccountLease.unit.test.ts src/providers/__tests__/FirebaseProvider.test.tsx src/auth/__tests__/AuthGate.test.tsx
npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test e2e/cloud-production.spec.ts"
npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test --config playwright.p13b2.config.ts"   # 多分頁 journal
```

確切的 env 變數名稱與 CI 步驟以 `.github/workflows/ci.yml`（`:191`、`:193-200`、`:213-222`、`:517-524`）為準。實作時先對照，有出入以 workflow 為準並在 PR 註明。

**`REVIEW.md` 檢核**：🔴 #2（Rules 放寬）：本變更是有意放寬，僅限白名單者以 epoch +1 接手，需附 allow／deny 證明並寫明 spec 依據。🔴 #5（租約）：有效性仍由 Rules 判定，不以本機倒數授權。🔴 #10：測試要驅動 repository／Rules 真入口。PR 需完整 RED／GREEN 證據。建議 dual review（Reviewer＋Coordinator 指派第二位）。

**部署注意**：Rules 與 Hosting 前端必須一起部署（同一 release）；PR 說明要寫出「只部署 Rules、不部署前端」的風險。本計畫不包含任何部署動作。

**Rollback**：Rules 還原 `:2220` 條件即回到等待逾期模式；前端的確認對話在舊 Rules 下會得到 `busy`，需顯示「對方仍在使用，請稍後再試」，這是可接受的降級。

### P8 單一操作員白話化（#691 決定 3、4、6）

**範圍**
- `frontend/src/auth/AuthGate.tsx`：
  - 閒置或逾期畫面（`:286-299`）的「待取得使用權／租約目前看起來閒置…／取得系統使用權」改為「登入」流程用語（例：標題「開始使用」，按鈕「開始使用」）。
  - 確認中畫面（`:213-253`）的「正在確認系統使用權」改為「正在連線…」。
  - 白名單被拒標題（`:104-105`）改為「此帳號沒有使用權限，請聯絡管理員」之類，與占用狀態分開。
  - 錯誤字串 `:182`、`:187` 改白話。
- `App.tsx:508`、`AuthGate.tsx:315-323`：「釋放使用權並登出」→「登出」；移除 `[租約 Epoch: N]` 與 `data-lease-epoch` 以外的可見 epoch。
- 全站使用權文案（盤點見 #691 留言與 issue body）：`errors/errorCatalog.ts:79-80/108/110`、repositories、`FirebaseProvider.tsx:301/361/393-447`、`CloudOrdersPage.tsx:223/598/645`、`CloudDayClosePage.tsx`、`CloudStudentsPage.tsx`、`CloudPendingRecoveryBoundary.tsx:557/567`、`CloudDiagnosticsPage.tsx:32`、`CloudDayVendorsPage.tsx:215/748/779/1215/1333-1353/1446/1477-1480`、`CloudReportPage.tsx:944`、`components/screens/BackupScreen.tsx:55`（若屬雲端備份頁）。改為「發生什麼＋下一步」，不出現「使用權、租約、世代、Epoch、伺服器、持有人、UID」。
- 移除報表「使用權交接」區：
  - UI：`CloudReportPage.tsx:239-243`、`:446-464`、`:1083-1096`。
  - 讀取：`cloudReadRepository.ts:150`、`readAccessEvents` `:1218-1290`，以及只服務該 UI 的 `decodeAccessEvent` 呼叫。
  - 交接事件的**寫入**保留：Rules P13c1 強制寫入，P7 也用它取得接手者 email。
- 文件：前端 handoff／UI style 若有提及「使用權交接」區，同步修改（以 `grep -rn "使用權交接" docs` 確認）。

**驗收**
- 以下指令排除測試、註解與 `maintenance/`（維護 CLI 不屬於一般使用者畫面）後，結果為 0：
  ```bash
  grep -rn "使用權\|租約\|Epoch\|世代\|持有人" frontend/src --include=*.tsx --include=*.ts
  ```
  PR 附指令與結果，例外逐一列出並說明理由。
- 報表頁不再出現「使用權交接」區，也不再讀取 `accessEvents`。容量／讀取量測試（`cloudReadReduction.spec.ts`、`cloudPageReduction.spec.ts`、`npm run test:cloud-reports`）的期望值同步下降。
- 操作員選單只有「登出」。
- 錯誤訊息以「發生什麼＋下一步」呈現，例如「其他人已登入，這個頁面已停止操作。請重新登入。」

**測試**：
- `AuthGate.test.tsx`（`:259` 斷言 `[租約 Epoch: 3]`、「釋放使用權並登出」）
- `CloudReportPage.test.tsx`（access-events fixture `:85`）
- `src/firebase/__tests__/cloudReadRepository.spec.ts`（`npm run test:cloud-reports`）
- 各頁以「使用權」文字斷言的測試，以 `grep -rln "使用權\|租約" frontend/src frontend/e2e` 列出
- E2E：`cloud-production.spec.ts` A11（報表 acquire event）移除或改寫，以及 `cloud-report-history.spec.ts`（p12c config）

```bash
npx vitest run src/auth src/components/cloud src/errors src/providers
npm run test:cloud-reports
npm run test:cloud-capacity
npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test e2e/cloud-production.spec.ts e2e/cloud-shell.spec.ts e2e/auth.spec.ts"
npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test --config playwright.p12c.config.ts"
npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test --config playwright.p13b1.config.ts"   # 診斷頁「需要有效的操作租約」
```

**風險**：
- 錯誤訊息屬於安全提示（例如失去使用權後要清除資料），改文案時不得改變判斷與清除行為；只改字串，行為測試保持 GREEN。
- `errorCatalog` 的訊息可能被 #684 的白話測試釘住，需要一起更新。

### P9 無人使用時自動進入＋8 小時自動登出（#691 追加決定，2026-11-11）

擁有者追加決定（直接告知 Planner）：
- 沒有人使用時直接自動進入系統，不顯示「開始使用」按鈕。這取代 §5 原本的預設。
- 已登入的帳號需要自動登出（例：8 小時），以免永遠不登出，導致下一個人每次都要把人踢掉。這修訂了 #691 決定 5「不用閒置登出」。8 小時從何時起算，見 §5 待確認。

**現況**
- spec §4.2 `:69`：「A 仍使用時 B …不自動搶占」；`AuthGate.tsx:233` 註解與測試「P04: idle lease does not auto-acquire; acquisition requires an explicit click」（`AuthGate.test.tsx`）固定了「閒置也要手動點擊」。
- 關閉瀏覽器或斷電時，不靠 unload 釋放，最多 5 分鐘逾期（spec `:71`）。分頁一直開著時，心跳會無限續約（`activeAccountLease.ts:27`）。

**範圍**
- 自動進入：租約為 `null`，或伺服器確認已逾期時（`isKnown && isExpired` 或 `holderUid == null`），登入後自動呼叫一次 acquire，不顯示按鈕。結果為 `busy`（同時有人搶先）時，進入 P7 的「有人使用中」畫面。仍在使用中的租約**不會**自動接手（P7 的確認對話不變）。修訂 spec `:69`：「閒置或逾期時自動取得；有效持有中時需明確確認才接手」。
- 自動登出：持有分頁登入滿 8 小時後（起算點依 §5 決定），走正常登出流程：先確認送出中的結果，再釋放租約，最後 signOut。若此時 `navigationLocked`（送出中或錯誤待處理，`App.tsx:312`），延到解除後再執行，不中斷送出中的命令。登出後的登入畫面顯示一行「已超過 8 小時，系統已自動登出。」
- Ruling：8 小時計時只用來讓本機主動登出（只減少權限、不授予），不違反 `frontend/CLAUDE.md`「不用本機倒數授權」與 `REVIEW.md` 🔴 #5。Rules 不改；5 分鐘租約與心跳不變。
- Ruling：先不做登出前的倒數警告，只在登入畫面說明原因（減法原則）。擁有者若要提前提醒，再另外加。
- 時長以單一常數定義（例如 `AUTO_SIGN_OUT_MS = 8 * 60 * 60 * 1000`），不做設定畫面。
- 跨分頁：同 UID 多分頁時，以開始計時那一頁的時間為準。任一頁登出後，其他頁照既有規則回到登入遮罩（spec `:72`）。起算時間存在哪裡（記憶體或 sessionStorage），由實作者依「重新整理後是否重算」的決定選擇並說明。

**驗收**（以 fake timers 測量；Emulator 驗證 acquire 實際寫入）
- 無人持有時登入 → 不點任何按鈕即進入，事件 kind 為 `acquire`。
- 持有者租約已逾期時登入 → 自動進入，事件 kind 為 `takeover`。
- 有效持有中時登入 → 顯示「目前由 ○○ 使用中」與確認按鈕，不自動接手。
- 登入滿 8 小時、沒有送出中命令 → 租約釋放（epoch +1、`release` 事件），回到登入畫面並顯示原因。
- 滿 8 小時時正在送出命令 → 等送出完成並確認後才登出。

**測試**：
- `AuthGate.test.tsx`：改寫「idle lease does not auto-acquire」，新增上述案例。
- `FirebaseProvider.test.tsx`：計時、`navigationLocked` 延後。
- `activeAccountLease.spec.ts`：自動 acquire 的 Rules 路徑沿用既有 acquire 案例；確認 release 的事件案例仍為 GREEN。
- E2E `e2e/cloud-production.spec.ts` 中以「取得系統使用權」按鈕登入的 helper（`e2e/helpers`、`e2e/fixtures.ts`，以 `grep -rn "取得系統使用權\|開始使用" e2e` 列出）改為自動進入。

```bash
npx vitest run src/auth/__tests__/AuthGate.test.tsx src/providers/__tests__/FirebaseProvider.test.tsx
EASYORDER_REQUIRE_ACTIVE_ACCOUNT_LEASE_PROOF=true npx firebase emulators:exec --project demo-easyorder --only firestore "npx vitest run src/firebase/__tests__/activeAccountLease.spec.ts"
npm run test:e2e   # 登入 helper 影響所有分組，需跑全部 Playwright 設定
```

**風險**：
- 登入 helper 變更會影響全部 E2E 分組。
- 自動 acquire 必須在白名單驗證完成後才執行，不能在 `access.ok` 確定前觸發。
- 自動進入不得繞過 P7 的確認流程，有效持有中只能走確認對話。

## 4. 用語對照表（P6 閘門，需擁有者確認）

| 概念（程式名稱） | 現行畫面用語 | 提議畫面用語 | 備註 |
|---|---|---|---|
| 過去日標記為可補登（`StartBackfill`、`backfillDays`） | 標為回填／回填這一天 | 開始補登這一天 | 動作按鈕 |
| 有補登標記且未關帳的日子 | 回填中 | 補登中 | 狀態徽章、F1 選單 |
| 重開過的補登日 | 回填中（已重開） | 補登中（已重開） | |
| 補登標記日的交易（`backfilled`） | 回填（交易標籤、報表欄、帳戶歷史欄） | 補登 | 標籤／欄值 |
| 在補登檢視中新增交易 | 補登（訂餐、繳費、收支） | 補登（不變） | 動作說明 |
| 離開補登檢視 | 離開回填 | 回到今天 | F1 按鈕 |
| 補登未完成的復原面板 | 回填 X 還沒完成／繼續回填／放棄回填 | 開始補登 X 還沒完成／繼續／放棄 | |
| 補開帳（`BackfillOpeningCash`） | 補開帳 | 補開帳（不變） | 與「補登」並存；意思是補上那天的開帳現金 |
| 關帳後補記（`RecordPostCloseEntry`） | 關帳後補記 | 關帳後補記（不變） | 已關帳日的現金差額紀錄，與補登不同 |

撞詞風險：「補登交易」與「補登中（狀態）」共用「補登」，屬同一流程，可接受；「補開帳」「補記」字面不同，不改。若擁有者要區分「補登中」與交易標籤「補登」，備選為狀態「待補登」。

## 5. 待確認事項（不擋其他 phase）

| 項目 | 擋住 | 誰決定 | 預設 |
|---|---|---|---|
| §4 用語對照表 | P6 | 擁有者 | 依提議欄 |
| 被接手提示顯示 email（姓名需另改 Rules） | P7 文案 | 擁有者經 Coordinator | email |
| ~~P8 閒置／逾期畫面是否自動進入~~ | — | 擁有者已決定（2026-11-11）：自動進入，移入 P9 | — |
| P9 8 小時從何時起算：登入後固定 8 小時，或最後一次操作後 8 小時 | P9 | 擁有者 | 登入後固定 8 小時 |

已解決的調查：Rules 條件、kind、被接手方偵測方式（即時 listener）、送出中命令處理、備份／還原影響（無）、報表 decoder 影響（無，沿用 `takeover`）。依據見 P7「現況」。

## 6. 風險總表

- 多 phase 改同一檔：依 §2 順序 merge；後一個 phase 開工前 rebase 到最新 `main`。
- 文字斷言的 E2E：每個 phase 以 grep 列出受影響的 E2E 並在 PR 記錄實際執行的 shard；未執行的明確標示。
- 容量／讀取量測試（P4）：期望值下降時更新，並在 PR 說明下降原因。
- 高風險（P7）：獨立 PR、Emulator 證明、`REVIEW.md` 🔴 檢核、spec §4.2 同步。
