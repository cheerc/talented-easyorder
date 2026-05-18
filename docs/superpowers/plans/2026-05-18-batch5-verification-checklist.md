# Batch 5 — UX 微調：驗證清單

> Generated: 2026-05-18
> PR: #44 (feat/batch5-ux-improvements)
> HEAD: 2820dd3e226e07528e5ec008d58167b858d37455

## How to test

```bash
cd frontend && npm run dev
```

Open browser → localhost:5173. 所有測試步驟均在本地 dev 環境手動操作。

---

## F5-1: Q/W/E 快捷鍵在收支介面應無效

### 驗證步驟
1. 在 idle 首頁點擊「新增 收入/支出」
2. 輸入金額 200 → 按 Enter
3. 選「支出」→ 選「付便當錢」
4. **測試 Q 鍵**：此時處於 expense_reason 狀態，按 Q → 應無反應（不可切到訂便當模式）
5. **測試 W 鍵**：按 W → 應無反應（不可切到繳費模式）
6. **測試 E 鍵**：按 E → 應無反應（不可開啟取消訂單對話框）
7. 按 Escape 回到 idle
8. 回到 idle 狀態後，Q/W/E 鍵應正常運作

### 預期行為
- 收支流程中（expense_input / expense_direction / expense_reason / expense_other_note），Q/W/E 三鍵完全不觸發模式切換
- Enter 鍵仍正常送出（handleConfirm 仍觸發）

### 邊界條件
- 收支流程中，輸入框 focus 時 Q/W 無法切換模式（原有行為）
- idle 狀態下 Q/W/E 正常運作

---

## F5-2: 移除訂餐「本次繳費」預設金額按鈕

### 驗證步驟
1. 搜尋學生「王小美」（帳戶餘額 0）
2. 按 Enter 進入訂餐模式（mode = order）
3. 觀察右側「本次繳費」區塊
4. 確認區塊內**沒有**快速金額按鈕（90, 100, 200, 500, 1000）
5. 切換到「繳費」模式（按 W 或點擊按鈕）
6. 觀察繳費模式（mode = payment）區塊

### 預期行為
- order mode：無快速金額按鈕
- payment mode：**仍有**快速金額按鈕（100, 500, 1000, 2000, 3000）

### 邊界條件
- 欠款學生（帳戶餘額為負）進入 order mode → 無快速按鈕
- 繳費模式確認後，order mode 的按鈕依然不存在

---

## F5-3: 取消訂單後應回到首頁

### 驗證步驟
1. 搜尋學生「王小美」→ 訂便當（mode = order）
2. 按 E 鍵或點擊「取消」按鈕
3. 觀察 ConfirmDialog 出現
4. 點擊「確認取消」
5. 觀察畫面

### 預期行為
- 點擊「確認取消」後，ConfirmDialog 關閉
- 畫面自動回到 idle 首頁（不再停留在學生 CustomerCard）
- 若再次搜尋學生，狀態正常運作

### 邊界條件
- 取消後馬上可以正常訂下一個學生的便當
- 取消後的 RecentStrip 狀態正常

---

## F5-4: TopBar ◀▶ 改為切日（非切月）

### 驗證步驟
1. 確認 TopBar 日期顯示（使用 input[type=date]）
2. 點擊 ◀ 按鈕
3. 觀察日期是否切換到前一天（而非上月 1 日）
4. 點擊 ▶ 按鈕
5. 觀察日期是否切換到後一天
6. 再次點擊 ◀ 按鈕，回到原本日期
7. hover 觀察按鈕 title

### 預期行為
- ◀ 按鈕 title 為「前一天」→ 點擊後日期 -1 天
- ▶ 按鈕 title 為「後一天」→ 點擊後日期 +1 天
- 不再切換月份，始终增減 1 天

### 邊界條件
- 月底最後一天 → ◀ 正確切到前一天
- 月初第一天 → ▶ 正確切到後一天
- ◀▶ 都不改變月份，只改變天

---

## F5-5: 訂餐繳費 placeholder 移除

### 驗證步驟
1. 進入學生訂餐模式（mode = order）
2. 觀察「本次繳費」的 input 欄位

### 預期行為
- input 無 placeholder（或 placeholder 為空）
- 不顯示「0」

### 邊界條件
- 繳費模式（mode = payment）仍顯示「輸入金額」placeholder

---

## F5-6: 「訂購其他餐點」展開後排版修正

### 驗證步驟
1. 進入學生訂餐模式
2. 點擊「訂購其他餐點」按鈕
3. 觀察展開的欄位順序

### 預期行為
- 第一個 input 為「品項」（text input，placeholder: 例如：雞腿便當）
- 第二個 input 為「價格」（number input）
- 按鈕文字：「取消」（非「取消改價」）

### 邊界條件
- 展開後修改品項名稱和價格正常運作
- 取消按鈕點擊後欄位正常關閉

---

## F5-7: 修改開帳金額需跳出警示

### 驗證步驟
1. 切換到「設定」tab（F3）
2. 在「每日開帳金額」輸入 4000 → 點擊「儲存開帳金額」
3. （此時已有 cashSession）
4. 修改金額為 5000 → 點擊「儲存開帳金額」
5. 觀察是否出現 ConfirmDialog

### 預期行為
- 首次設定（尚無 cashSession）→ 直接儲存，不彈 dialog
- 修改已存在的開帳金額 → 彈出 ConfirmDialog，標題「修改開帳金額」，內容「修改開帳金額會影響今日所有帳務計算，確定要繼續嗎？」
- 點「確認修改」→ 執行儲存
- 點「返回」→ 取消，不儲存

### 邊界條件
- 輸入相同金額 → 不彈 dialog
- 輸入不同金額但尚未儲存 → 不彈 dialog
- 關帳日期（dateStatus === 'closed'）→ 輸入框 disabled，無 dialog

---

## 整合測試（全部 F5-1 ~ F5-7）

### 完整流程
1. 啟動 App → idle 首頁
2. **F5-3** 測試：搜尋學生「王小美」→ 訂便當 → 按 E → 確認取消 → 回到 idle
3. **F5-5** 確認：訂餐模式的 input 無 placeholder "0"
4. **F5-6** 確認：點「訂購其他餐點」→ 展開欄位為 品項→價格→取消
5. **F5-2** 確認：order mode 無快速按鈕；切到 payment mode 有按鈕
6. **F5-4** 確認：TopBar ◀▶ 切換日（試 -1、+1）
7. 回到 idle → **F5-1**：點「新增 收入/支出」→ 輸入 200 → 選「支出」→ 選「付便當錢」
8. 按 Q/W/E 測試 → 全部無反應
9. 按 Escape 回到 idle
10. **F5-7**：切到設定 → 儲存開帳 4000 → 修改為 5000 → 確認彈出警示
11. 全部測試完成

---

## Test suite status

- t1: `npx tsc --noEmit` — PASS
- t2: `npm run lint` — PASS
- t3: `npx vitest run` — 363 tests pass, 8 skipped
- t4: `npm run build` — PASS