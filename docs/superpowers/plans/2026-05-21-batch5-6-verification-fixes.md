# Batch 5 & 6 Verification Fixes Plan (修復規劃)

本規劃文件針對 Batch 5 與 Batch 6 手動驗證中發現的所有 UI/UX、快捷鍵、數值輸入限制與帳本排版問題進行深度分析，並提供具體的程式碼修復方案。

---

## 1. 鍵盤快捷鍵與輸入聚焦優化 (Keyboard & Focus)

### 1.1 搜尋框自動聚焦與 Escape/Enter 離開焦點
*   **問題分析**：
    1.  [App.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/App.tsx) 中 `SearchBox` 的 `focusKey` 被硬編碼為 `0`，導致組件載入時，[pos-components.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/pos-components.tsx) 中的 `useEffect` 總是會將焦點放在搜尋框，無法實現「預設不聚焦」。
    2.  無焦點時按下數字鍵僅會填入單個數字，並未觸發焦點轉移，使使用者無法連續輸入學號（如輸入 `11` 或 `012`），且在未聚焦狀態下按 `Enter` 無法提交。
    3.  使用者期望在搜尋框聚焦且有輸入內容時，按下 `Escape` 能同時清除輸入框數字並取消聚焦 (blur)。
*   **解決方案**：
    1.  在 `App.tsx` 中定義一個 `searchFocusKey` 狀態（初始值為 `0`），並傳給 `SearchBox`。
    2.  在 `SearchBox` 中，修改 `useEffect` 邏輯，僅在 `focusKey > 0` 且未禁用的情況下才觸發 `focus()` 動作，避免首次載入時自動聚焦：
        ```tsx
        useEffect(() => {
          if (focusKey > 0 && !disabled) {
            ref.current?.focus();
          }
        }, [focusKey, disabled]);
        ```
    3.  在 `App.tsx` 的全域 `onGlobalKey` 鍵盤監聽器中，當按下數字鍵（`0-9`）且符合自動聚焦條件時，不僅設定搜尋字串，同時將 `searchFocusKey` 遞增，從而觸發 `SearchBox` 內部聚焦：
        ```tsx
        if (/^[0-9]$/.test(e.key) && tab === 'pos' && !picked && !expenseProps) {
          setSearchText(e.key);
          setSearchFocusKey(prev => prev + 1);
          e.preventDefault();
        }
        ```
    4.  在 `SearchBox` 的 `onKeyDown` 處理中，若按下 `Escape`，觸發 `e.currentTarget.blur()` 取消聚焦，並呼叫 `onEsc()` 清除數字。

### 1.2 「新增 收入/支出 (A)」按鈕樣式與 DRY 統一
*   **問題分析**：
    *   [pos-components.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/pos-components.tsx) 中 `IdleHero` 的按鈕文字被寫成了重複的 `新增 收入/支出 (A) (A)`，且其樣式與 `ActionBar` 的 `Q`、`W`、`E` 按鈕風格不統一。
*   **解決方案**：
    *   移除重複的 `(A)`。
    *   將按鈕重構為使用與 `ActionBar` 相同的 `.mode` CSS 類別，並渲染 `<span className="mode-key">A</span>` 和 `<span className="mode-lbl">新增 收入/支出</span>`。
    *   使用 `style={{ flex: 'none', width: 'auto' }}` 防止按鈕被拉伸，保持置中。

### 1.4 收支流程 Escape 返回上一層與 ConfirmDialog 攔截
*   **問題分析**：
    *   目前在收支流程（`ExpensePanel`）的任何步驟中按下 `Escape` 都會直接返回 Idle 首頁。對於多步驟的收支流程，使用者期望按 `Escape` 能返回上一層（例如：原因選擇返回類型選擇，備註輸入返回原因選擇）。
*   **解決方案**：
    *   在 [posFlow.ts](file:///Users/cheerc/talented-easyorder/frontend/src/domain/posFlow.ts) 的 `reducePosFlow` 中，調整各收支狀態下 `cancel` 事件的狀態轉移：
        *   `expense_direction` (選擇類型) 收到 `cancel`：返回 `{ kind: 'expense_input', amountText: String(state.amount) }`。
        *   `expense_reason` (選擇原因) 收到 `cancel`：返回 `{ kind: 'expense_direction', amount: state.amount }`。
        *   `expense_other_note` (輸入備註) 收到 `cancel`：
            *   若 `state.direction === 'income'` (收入無原因選擇步驟)，返回 `expense_direction` 狀態。
            *   若 `state.direction === 'expense'`，返回 `expense_reason` 狀態。
    *   在 `ExpensePanel` 中，加入 `useEffect` 監聽 `kind` 變化，當步驟切換時，重置 `selIdx` 狀態為 `0`，防止因按鍵索引殘留導致越界或錯誤高亮。

---

## 2. 數值輸入框限制 (Numeric Input Constraints)

### 2.1 數值輸入框 DRY 重構、滾輪數值滾動阻擋與快捷鍵 E 相容性
*   **問題分析**：
    1.  系統中有 6 個地方使用了數值輸入框，程式碼存在重複攔截 `-`、`+`、`e`、`E`、`.` 的邏輯，不符合 DRY 原則。
    2.  數值輸入框聚焦時，使用滑鼠滾輪會觸發瀏覽器原生數值遞增/遞減，容易造成金額被無意修改的意外，需要禁用此滾輪行為。
    3.  當焦點在數值輸入框時，打字輸入 `e`（科學記號）會被 `onKeyDown` 攔截並執行 `e.preventDefault()`。這會將 event 的 `defaultPrevented` 設為 `true`。當事件冒泡到全域的 [useKeyboardShortcuts.ts](file:///Users/cheerc/talented-easyorder/frontend/src/hooks/useKeyboardShortcuts.ts) 時，因為 `if (e.defaultPrevented) return;` 守護條件，導致快捷鍵 `E`（取消訂餐）無法被觸發。
*   **解決方案**：
    1.  **新建 DRY 數值組件**：在 [components/ui](file:///Users/cheerc/talented-easyorder/frontend/src/components/ui) 下新建 `NumericInput.tsx`，使用 `React.forwardRef` 封裝：
        *   在 `onKeyDown` 攔截 `['-', '+', 'e', 'E', '.']`。
        *   在 `onChange` 使用正則表達式 `/^\d*$/` 過濾任何非數字輸入（防止貼上繞過）。
        *   在 `onWheel` 中執行 `e.currentTarget.blur()` 以立即取消聚焦，防止滑鼠滾輪修改數值。
    2.  **替換全域輸入框**：
        *   [NumberField.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/ui/NumberField.tsx) 內部改為使用 `NumericInput`。
        *   替換以下 raw inputs：
            *   `CustomerCard` 的 `payAmount` 和 `priceOverride`。
            *   `ExpensePanel` 的 `amountText`。
            *   `screens.tsx` 的 `price` (單價) 和 `openingCashDraft` (開帳金額)。
            *   `CashClosePanel.tsx` 的 `countedCash` (點算現金)。
    3.  **修復快捷鍵 E 阻擋問題**：
        *   在 `useKeyboardShortcuts.ts` 中，若按鍵是系統的主快捷鍵（`q`, `w`, `e`, `a`, `escape`, `enter`），則繞過 `e.defaultPrevented` 的阻擋：
            ```tsx
            const key = e.key.toLowerCase();
            const isPrimaryShortcut = ['q', 'w', 'e', 'a', 'escape', 'enter'].includes(key);
            if (e.defaultPrevented && !isPrimaryShortcut) return;
            ```

---

## 3. UI 與版面排版調整 (UI & Layout)

### 3.1 價格修改區域排版優化與便當統計過濾
*   **問題分析**：
    1.  點擊「訂購其他餐點」展開的自訂價格與品項欄位缺乏外層 CSS 容器規劃，在 `padding: 36px` 且無布局引導下會產生擁擠感。
    2.  `todayCount` 統計數字目前統計了所有 `type === 'order'` 的交易。若學生訂購了價格修改後的非預設便當，其單價與品項與今日預設便當不同，會導致預設便當的統計數量錯誤。
*   **解決方案**：
    1.  **版面美化**：在 [index.css](file:///Users/cheerc/talented-easyorder/frontend/src/index.css) 中為 `.price-override` 與 `.price-override-fields` 新增樣式：
        *   `.price-override` 頂部加入虛線分隔與間距。
        *   `.price-override-fields` 設定為 `display: flex; gap: 12px;` 橫向排列，包覆在淺色背景的虛線邊框卡片容器中，為操作提供舒適的視覺呼吸感。
    2.  **便當統計過濾**：修改 `App.tsx` 中的 `todayCount` 計算邏輯，僅統計與今日預設便當品項及價格一致的訂單，將非預設訂單排除在首頁基本統計之外（未來再安排多品項分類的 Feature 規劃）：
        ```tsx
        const todayCount = tx.filter(t => t.type === 'order' && t.menuNameSnapshot === todayMenu.itemName && t.mealPrice === todayMenu.price).length;
        ```

### 3.2 側邊欄 RecentStrip 容量調整
*   **問題分析**：
    *   移除右側側邊欄的「本日便當」卡片後釋出了大量垂直空間，最近交易紀錄仍限制在 5 筆顯得空曠。
*   **解決方案**：
    *   在 `pos-components.tsx` 的 `RecentStrip` 中，將 `recent.slice(0, 5)` 修改為 `recent.slice(0, 12)`。
    *   將標題文字 `最近 5 筆` 修改為 `最近 12 筆`。

### 3.4 RecentStrip 中櫃台收支重複標籤消除與完美的備註對齊
*   **問題分析**：
    1.  當 RecentStrip 顯示 `type === 'expense'` 時，左側徽章（`recent-type`）已顯示「收」或「支」背景色區塊，但在右側金額文字區又重複印出了「收」或「支」，顯得重複冗餘。
    2.  備註（Note）文字寬度不一，且與右側金額未作分欄對齊，導致排版凌亂。
*   **解決方案**：
    1.  **消除重複標籤**：移除 `recent-amt` 內容中重複的 `收` 與 `支` 字符，僅保留左側帶有背景顏色的 `recent-type` 徽章。
    2.  **分欄對齊**：將 `recent-amt` 中的文字內容拆分為 Flex 左右分欄結構：
        ```tsx
        <span className="recent-amt-lbl">備註(全型空白補滿4字)</span>
        <span className="recent-amt-val">金額(如 +500 或 −600)</span>
        ```
    3.  **CSS 樣式調整**：
        *   在 `index.css` 中將 `.recent-row` 的第 5 欄寬度從 `auto` 改為固定 `140px`。
        *   將 `.recent-amt` 設為 `display: flex; justify-content: space-between; gap: 4px;`。
        *   新增 `.recent-amt-lbl { text-align: left; flex: 1; color: var(--ink-3); font-size: 11px; }` 與 `.recent-amt-val { text-align: right; }`。這能保證不論備註長短，備註的起始起點皆能完美垂直對齊。

---

## 4. 結帳關帳與今日帳表優化 (Settlement & Ledger Table)

### 4.1 關帳按鈕優化與缺失屬性修復
*   **問題分析**：
    1.  [CashClosePanel.tsx](file:///Users/cheerc/talented-easyorder/frontend/src/components/report/CashClosePanel.tsx) 在解構 Props 時，漏了解構 `businessDate` 屬性，導致該變數在組件內為 `undefined`。當關帳對話框嘗試渲染該日期時會發生渲染錯誤，引發「報表區塊發生錯誤」的 React 崩潰。
    2.  關帳按鈕的 disabled 狀態及滑鼠樣式在 CSS 中已設定，但需要確保其在未輸入備註時為 disabled。
*   **解決方案**：
    1.  在 `CashClosePanel.tsx` 的參數解構中，補上 `businessDate`。
    2.  確保 `canClose` 邏輯包含 `note.trim().length > 0`。當不滿足條件時，按鈕維持 disabled 並套用半透明與 `cursor: not-allowed`。

### 4.2 今日帳本表格列對齊調整 (移除 react-window 後的修復)
*   **問題分析**：
    *   `LedgerGroupedTable` 的表頭與學員群組列使用了 7 欄配置（`gridTemplateColumns: '80px 60px 100px 1fr 1fr 1fr auto'`），但交易細節列（`rpt-detail-row`）在 JSX 中卻只有 6 個子元素，缺失了對應「姓名」的第 3 欄，導致整行欄位向左偏移，價格出現在姓名列，操作按鈕出現在金額列，整個表格排版錯亂。
    *   細節列帶有 CSS 的 `padding-left: 48px`，與表頭和群組列的 `padding: 12px 18px` (左邊距 18px) 不一致，造成欄位起點無法對齊。
*   **解決方案**：
    1.  **補齊細節列欄位**：在 `LedgerGroupedTable.tsx` 的細節列 JSX 中，於第 3 個位置插入一個空白的 `<div className="dim"></div>` 佔位符。
    2.  **加入餘額顯示**：在第 6 個位置渲染該交易發生後的餘額 `t.afterBalance`（對齊表頭的「目前餘額」）。
    3.  **整合備註與操作**：在第 7 個位置（狀態/操作）使用 Flex 橫向排版容器，將「交易備註 (`t.note`)」與「編輯/刪除按鈕」包裝在一起：
        ```tsx
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', width: '100%' }}>
          <span className="dim italic" style={{ fontSize: '12px' }}>{t.note}</span>
          <div className="rpt-row-actions" style={{ marginLeft: 'auto' }}>
            {/* 編輯 / 刪除按鈕 */}
          </div>
        </div>
        ```
    4.  **對齊內距與樹狀指標修復**：
        *   將細節列的 inline style 補上 `padding: '0 18px'`，使其與表頭的邊距完美一致，確保各欄位對齊。
        *   在 `index.css` 中，將 `.rpt-detail-row::before`（`└` 樹狀符號）的 `left` 從 `24px` 調整為 `6px`，使其留在安全間距中，不再遮擋或重疊時間文字。
        *   為非學生關聯的「櫃台收支列」新增 `.counter-row` 類別，並在 CSS 中設定 `.counter-row::before { display: none; }` 隱藏樹狀符號。

### 4.3 每日開帳金額修改警示彈窗優化
*   **問題分析**：
    *   使用者要求「首次設定開帳金額時，也要跳出 ConfirmDialog 提示」，但提示內容與後續修改不同。
*   **解決方案**：
    *   修改 `screens.tsx` 中的 `handleSaveOpeningCash` 邏輯。只要金額與目前不同，不論是否是首次設定 (`!hasCashSession`)，皆設定 `showOpeningCashConfirm` 為 `true` 展開對話框。
    *   在 ConfirmDialog 屬性中，根據 `hasCashSession` 動態設定內容：
        *   **首次設定** (`!hasCashSession`)：
            *   標題：`"設定開帳金額"`
            *   訊息：`"確定要將今日開帳金額設為 $[金額] 嗎？"`
            *   確認按鈕文字：`"確認設定"`
            *   Variant: `"primary"`
        *   **後續修改** (`hasCashSession`):
            *   標題：`"修改開帳金額"`
            *   訊息：`"修改開帳金額會影響今日所有帳務計算，確定要繼續嗎？"`
            *   確認按鈕文字：`"確認修改"`
            *   Variant: `"danger"`
