# Batch 5 & 6 Verification Fixes Plan

本規劃文件旨在解決 Batch 5 與 Batch 6 手動驗證中發現的所有 UX、鍵盤快捷鍵、數值輸入限制、以及帳本版面排版問題。

---

## 1. 鍵盤快捷鍵與輸入聚焦優化 (Keyboard & Focus)

### 1.1 焦點在「編號或姓名」輸入框時按 Enter 可取消焦點，非聚焦時按數字鍵自動輸入並聚焦
- **現狀**：輸入框聚焦時，除非輸入學員編號並按 Enter 選擇學員，否則無法輕易藉由鍵盤取消聚焦，導致無法觸發 `A` 鍵（新增收支）等全局快捷鍵。
- **改進方案**：
  1. 在 `SearchBox` 的 `onKeyDown` 中，若輸入框內容為空，按下 `Enter` 則執行 `e.target.blur()` 取消聚焦。
  2. 首頁 (Idle Screen) 載入或回到首頁時，預設**不聚焦**在搜尋輸入框中，讓全局快捷鍵（如 `A`）在載入後能立即使用。
  3. 當焦點不在任何輸入框時，若使用者按下數字鍵（`0-9`），自動聚焦到搜尋輸入框中，並將該數字填入。

### 1.2 「新增 收入/支出 (A)」按鈕增加快捷鍵提示
- **改進方案**：在首頁的「新增 收入/支出」按鈕文字旁加上 `(A)` 提示，修改為 `新增 收入/支出 (A)`。

### 1.3 收支輸入金額按 Enter 後跳轉類型選擇（解決 bubbling 導致跳過問題）
- **現狀**：在「新增 收入/支出」介面輸入金額按 Enter 時，由於 event bubbling 到 `window` 觸發了剛註冊的 `expense_direction` 鍵盤監聽器，導致直接選擇了預設的第一個選項（支出），而沒有停留讓使用者選擇。
- **改進方案**：在 `ExpensePanel` 的金額輸入框 `onKeyDown` 事件中，針對 `Enter` 鍵使用 `e.nativeEvent.stopImmediatePropagation()`，防止 React SyntheticEvent 的 stopPropagation 無法阻止 window.addEventListener 的原生事件。React SyntheticEvent 的 `stopPropagation()` 僅在 React 事件系統內生效，無法阻止透過 `window.addEventListener('keydown', ...)` 註冊的 `expense_direction` 原生監聽器。

### 1.4 收支流程與對話框中的 Escape 與 Enter 鍵處理
- **現狀**：`Modal.tsx` 僅處理 Escape 與 Tab focus trap，沒有 Enter 鍵確認機制。ConfirmDialog 依賴 Modal，因此目前無 Enter 確認。全局 `useKeyboardShortcuts` 的 Enter 監聽在 expense flow 期間雖被 disable（`isExpenseFlow` guard），但在 dialog 開啟時無 guard，可能觸發背景確認。
- **改進方案**：
  1. 確保 `ExpensePanel` 在任何步驟（包括 `expense_direction` 和 `expense_reason` 選擇狀態），按下 `Escape` 都會取消並返回首頁。
  2. 在 `Modal.tsx` 的 keyboard handler 中增加 `Enter` 鍵 capture：當 Modal open 時按 Enter → `e.preventDefault()` + `e.nativeEvent.stopImmediatePropagation()`，並觸發 ConfirmDialog 的 `onConfirm` prop。需將 ConfirmDialog 的 onConfirm callback 透過 ref 或 Modal prop 傳入，或直接在 ConfirmDialog 的 useEffect 中註冊 Enter 監聽（使用 `stopImmediatePropagation()` 阻止冒泡到 window 的全局快捷鍵監聽器）。
  3. ConfirmDialog 開啟時，攔截全局的 `Escape` 和 `Enter` 快捷鍵，只讓對話框處理（Esc 為返回，Enter 為確認），不得觸發下層的任何全局快捷鍵（如切換模式或背景確認）。

---

## 2. 數值輸入框限制 (Numeric Input Constraints)

### 2.1 限制所有數字輸入框僅接受正整數，不接受 `0`、負號或小數點
- **現狀**：部分繳費、改價或收支輸入框可以輸入負數、小數或 `e`/`E`（科學記號），或者在輸入 `0` 時仍可送出交易。
- **改進方案**：
  - 針對以下輸入框：
    1. 學生卡片中的「本次繳費/繳費金額」輸入框 (`payAmount`)
    2. 學生卡片中的「改價金額」輸入框 (`priceOverride`)
    3. 新增收支的「金額」輸入框 (`amountText`)
    4. 設定頁面中的「便當單價」輸入框 (`price`)
    5. 設定頁面中的「每日開帳金額」輸入框 (`openingCashDraft`)
    6. 報表頁面中的「點算抽屜現金」輸入框 (`countedCash`)
  - **套用過濾規則**：
    - 在 `onKeyDown` 攔截並阻擋 `-`, `+`, `e`, `E` 以及 `.` 的輸入。
    - 在 `onChange` 使用 regex `/^\d*$/`（僅允許純數字，阻擋任何非數字字元貼上）進行過濾，若輸入為空則允許清空，若通過 regex 則更新 state。此舉可防止使用者透過貼上繞過 onKeyDown 限制。
    - 注意 `type="number"` 輸入框的 ArrowUp/ArrowDown 原生行為可能遞減數值至 0 或負數：onChange 過濾時一併處理，若值 ≤ 0 則不更新（或清空）。
    - 點選確認/提交時，若值小於或等於 0 或為空，則拒絕送出。

---

## 3. UI 與版面排版調整 (UI & Layout Refinements)

### 3.1 移除「⚠ 將產生欠款」並提供舒適寬敞的 UI 視覺空間
- **現狀**：學生卡片中的「訂購其他餐點」和改價區域排版過於擁擠。
- **改進方案**：
  1. 移除學生卡片左下角的 `{after < 0 && <div className="chip chip-warn">⚠ 將產生欠款</div>}` 提示。
  2. 調整 `.customer` 卡片內距，將 `padding` 從 `24px` 放大至 `36px`。
  3. 增加 `.action-grid` 的欄位間距 `gap` 從 `48px` 到 `64px`，並微調 `.bill-summary` 的 `gap` 到 `18px`，打造呼吸感更佳的精緻介面。

### 3.2 移除 RecentStrip 上方的「本日便當」區塊
- **現狀**：右側側邊欄的「本日便當」卡片與首頁 Idle Screen 資訊重複，且佔用空間。
- **改進方案**：直接在 `App.tsx` 中將 `<div className="card side-menu">...本日便當...</div>` 區塊移除，讓 `RecentStrip` 自動向上填滿空間。

### 3.3 移除「新增 收入/支出」與「繳費 (payment)」下方的預設金額按鈕
- **現狀**：目前「新增 收入/支出」下方有 `[100, 200, 500, 1000]` 快速按鈕，「繳費」下方也有快速金額按鈕。
- **改進方案**：
  1. 移除 `ExpensePanel` (新增收支) 底下的 `.pay-quick-grid` 金額按鈕。
  2. 移除 `CustomerCard` 繳費模式底下的 `.pay-quick-grid` 金額按鈕。

### 3.4 格式化 RecentStrip 中櫃台收支的備註顯示位置與寬度
- **現狀**：櫃台收支的備註目前緊跟在名稱後方，版面略顯不一。
- **改進方案**：
  - 當 RecentStrip 渲染 `type === 'expense'` 時：
    1. 將備註 (note) 截取前 4 字，並以全型空白補足 4 字元寬度（全型空白 Unicode: `　`）。
    2. 將此備註渲染在 `recent-amt` 欄位的金額**前方**（即同一個 `recent-amt` span 的前半部），與金額共同構成完整字串，例如：`收 贊助金　 +500`、`支 支付便當 -600`。
    3. 具體格式：`{收/支} {備註前4字並以　補滿4格} {+/-}{金額}`，例如「收 贊助金　 +500」。
    4. 若無備註（note 為空），則不顯示空白，直接顯示 `{收/支} {+/-}{金額}`。

---

## 4. 結帳關帳與今日帳表優化 (Settlement & Ledger Table)

### 4.1 關帳按鈕改為預設可見但 disabled 狀態
- **現狀**：當關帳備註未填寫時，「確認關帳」按鈕會直接隱藏，導致使用者在 UI 上找不到關帳按鈕。
- **改進方案**：按鈕始終渲染在畫面上，但若備註為空或條件不滿足時，按鈕設為 `disabled` 且 `opacity` 降為 `0.5`，滑鼠游標設為 `not-allowed`。

### 4.2 移除今日帳本的虛擬化，改為標準分頁表格，支援瀏覽器原生滾動
- **現狀**：`LedgerGroupedTable` 使用 `react-window` 虛擬化，限制了容器高度，且在資料量大或展開時容易造成隱藏和滾動條衝突。`react-window` 僅在 `LedgerGroupedTable.tsx` 中使用（經 grep 確認，無其他元件引用），可一併從 `package.json` 移除 `react-window` 和 `@types/react-window` dependency。
- **改進方案**：
  1. 移除 `react-window` 的 `List` 元件，以及 `containerHeight` 的動態計算邏輯（`useEffect` 中 `window.innerHeight - rect.top - 24` 的 resize listener）。
  2. 加入標準的分頁機制：預設每頁 `20` 筆學員群組分頁（可切換 `10`, `20`, `50` 筆）。分頁以**學員群組（group）**為計數單位，展開的 detail rows 算在該 group 當前頁內，不跨頁。
  3. 在表格下方新增分頁列，包含「上一頁」、「下一頁」按鈕、當前頁碼/總頁數指示、以及每頁筆數下拉選單。
  4. 讓表格元件在 DOM 中隨資料行數自然展開，超出畫面時透過瀏覽器原生滾動條滾動，改善操作體驗。
  5. 從 `package.json` 移除 `react-window` 和 `@types/react-window` 兩項 dependency。

### 4.3 每日開帳金額修改警示 dialog 優化
- **現狀**：首次設定與修改時皆會跳警示，或金額相同時也會儲存。
- **改進方案**：
  1. 檢查若修改的金額與目前開帳金額相同，點擊儲存時直接 `return`（no-op），不呼叫任何 store action（`onOpeningCashChange` / `onUpdateOpeningCash` 均不呼叫），不顯示任何提示。
  2. 若修改的金額與目前金額不同：
     - 若為**今日首次設定**（無 cashSession）：直接儲存（呼叫 `onOpeningCashChange`），不跳 ConfirmDialog。
     - 若**已存在 cashSession**（非首次設定且金額不同）：跳出 ConfirmDialog 提示「修改開帳金額會影響今日所有帳務計算，確定要繼續嗎？」。

---

## 5. 驗證計劃 (Verification Plan)

### 5.1 自動化測試
- 執行專案原有測試套件，確保無 regression：
  ```bash
  npm run test
  npm run build
  npm run lint
  ```

### 5.2 手動驗證流程
1. **輸入與快捷鍵驗證**：
   - 點擊 A 鍵進入收支，輸入數字按 Enter，確認會跳出「選擇類型（支出/收入）」而不是直接變成支出。
   - 於金額輸入框輸入 `-`、`+`、`.` 或 `e`，確認無法輸入。
   - idle 首頁載入時搜尋框不聚焦，按數字鍵能自動聚焦並輸入。
2. **UI 排版驗證**：
   - 搜尋學生，確認卡片 `padding` 與間距變寬，無「將產生欠款」字樣。
   - 右側 RecentStrip 無「本日便當」大卡片。
   - 櫃台收支交易顯示為 `收 贊助金　　 +300` / `支 支付便當 -100`。
3. **報表與分頁驗證**：
   - 進入「今日帳」，點擊「確認關帳」在未打備註時顯示為灰底 disabled，打字後變為可點擊。
   - Ledger 帳本有分頁元件，能切換 10/20/50 筆，並正常切頁。
