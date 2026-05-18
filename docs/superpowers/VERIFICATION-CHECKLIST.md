# Talented EasyOrder — Verification Checklist

> Generated: 2026-05-18
> origin/main: `a0ba4e8` (after PR #41 merge)
> Total PRs: #35 ~ #41 (7 PRs, all merged)

## How to test

```bash
cd frontend && npm run dev
```

Open browser → localhost:5173 (or configured port). All tests below are manual UI verification.

---

## Phase 1: Batch 1 Hotfix R2 (PR #39)

### R2-1: todayCount is integer
- [ok] Idle 首頁顯示「今日 N 份」，N 為整數（不含儲值/記帳等非 order 交易）
- [ok] 新增一筆訂餐 → 份數 +1；新增一筆儲值 → 份數不變

### R2-2: Idle screen income/expense button
- [ok] Idle 首頁有「新增 收入/支出」按鈕
- [ok] 按下按鈕 → 進入收入/支出輸入 flow
- [ok] 鍵盤 E 鍵在 idle 狀態無反應

### R2-3: Income/expense flow correct
- [ok] **支出流程**：輸入金額 → 選「支出」→ 選原因 → 確認 → ledger 顯示 `−$金額`
- [failed] **收入流程**：輸入金額 → 選「收入」→ 選原因 → 確認 → ledger 顯示 `+$金額`
收入原因不能跟支出原因一樣，選收入的話，應該直接跳出輸入原因的視窗
且我就算輸入收入500，右邊最近5筆的資料內容中，還是顯示支出，並沒有分別出現收入或支出，全部都是支出。今日帳的收支紀錄也是錯的。
- [failed] 報表頁「櫃台 收入/支出」區塊正確分列收入（綠）與支出（紅）
目前報表頁指的是「今日帳」嗎？今日帳目前完全看不到今天的現金流記錄。
- [failed] `netCash` 金額正確包含收入（非僅支出）
- 另外發現，我輸入了一筆收支後，「新增 收入/支出」按鈕就再也無法使用，除非重新整理網頁。

### R2-4: ActionBar Q/W/E layout + cancel confirmation
- [ok] 選擇學生後，底部顯示 Q（訂餐）/ W（繳費）/ E（取消訂餐）三按鈕，等寬
- [ok] 按 E → 出現 ConfirmDialog 確認畫面
- [need fix] 確認畫面：按「確認取消」→ 訂單刪除
訂單刪除後，應該離開學生訂餐介面，回到首頁
- [ok] 鍵盤 E 鍵在 student_selected 狀態觸發取消 flow

---

## Phase 2: Batch 2 UI Fixes (PR #40)

### B2-1: TopBar month navigation
- [ ] TopBar 日期左右各有 ◀ ▶ 箭頭
- [ ] 按 ▶ → viewDate 切到下個月 1 號
- [ ] 按 ◀ → viewDate 切到上個月 1 號
此功能有，但我覺得切換日，不要切換月比較實用，改成切換上一天、下一天。

### B2-2: Pay input alignment
- [ ] 繳費模式下，金額 input 的 placeholder（0）垂直置中
- [ ] `$` 與 `元` 標籤與 input 文字垂直對齊
完全沒達到我要的效果，把那個 0 拿掉好了，反正預設就是空白的

### B2-3: No estimated balance
- [ok] 訂餐模式 → 結帳明細 **不再** 顯示「交易後預估餘額」

### B2-4: Button text
- [ok] 改價按鈕文字為「訂購其他餐點」（非「改本筆價格」）
但是點下去後，排版應該是：
品相 <輸入框>
價格 <輸入框>
<取消> (而非取消改價)

### B2-5: Opening cash in settings
- [ok] 設定頁（AdminScreen）有「每日開帳金額」輸入區
- [ok] 可輸入數字 → 按「儲存開帳金額」→ 值被儲存
- [ok] 關帳面板（CashClosePanel）的開帳金額為 **唯讀顯示**
但是儲存一次，就不能儲存第二次了。且修改開帳金額應該要跳出警示，會影響到從頭到尾的計算金額。
我的想法是，每日關帳後，帳務面都要有記錄今日開帳金額是多少，關帳金額是多少。
隔天的開帳金額就是昨天的關帳金額，這樣才能維持整個系統的連貫性。

### B2-6: RecentStrip tap-to-edit
- [ ] 今日交易列表（RecentStrip）中的交易可點擊
- [ ] 點擊後進入編輯模式
我在npm run dev 的狀態，看不到交易列表，所以無法測試

---

## Phase 3: Batch 3 Seed Data (PR #41)

### S1: Student balances zeroed
- [ok] 啟動 App → 20 個學生帳戶全部顯示餘額 = 0
目前reset資料的確是這樣沒錯。
環境沒有跟後端串在一起，單純用npm run dev測試而已

### S2: No initial transactions
- [ok] 啟動 App → 今日交易列表為空
- [ok] 報表頁無預設交易紀錄
目前reset資料的確是這樣沒錯。
環境沒有跟後端串在一起，單純用npm run dev測試而已

---

## Earlier phases (reference only)

These were verified during implementation and are included for completeness.

| Phase | PR | Key features |
|-------|-----|-------------|
| Plan A (Counter Cash) | #35 | POS counter cash session, open/close cash |
| Plan B (Firebase Sync) | #36 | Firebase sync architecture, offline-first |
| Batch 1 (Cashflow Redesign) | #37 | Simplified transaction model, expense mode |
| Batch 1 Hotfix R1 | #38 | Expense UX, idle rendering, R shortcut, RecentStrip, LedgerGroupedTable |

---

## Known issues

- `businessDate` in `INITIAL_TODAY_MENU` is static (`2026-05-07`). This doesn't affect functionality (system uses posStore's viewDate), but the menu name may show as "past date" in UI.

## Test suite status

- 363 tests pass
- 8 skipped (Firestore security rules — require emulator)
