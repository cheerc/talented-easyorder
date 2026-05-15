---
status: approved
date: 2026-05-15
complexity: complex+
---

# Frontend Hardening Plan — 4 PRs

## Goal

修復 edge case analysis 和 spec audit 發現的 HIGH/MEDIUM 缺口，強化前端的可靠性、可存取性與效能。

## Context

- Base SHA: `4a8b528462db2b178e61115a0e30a4cdadc40361`
- 現有 224 tests，TypeScript strict mode
- `ledgerExport.ts` 已有 CSV column/row/serialize 邏輯，但 `ExportActions` 的 `onExportCsv` 是 no-op (`() => {}`)
- 無 ErrorBoundary，無 react-window/virtuoso，無 accessibility 屬性
- `pos-components.tsx` (477 lines)、`screens.tsx` (500 lines)、`App.tsx` (456 lines) 均無 React.memo

## Approach

4 個獨立 PR，每個基於 `origin/main` (`4a8b528`)，依優先度執行：
1. PR1 (HIGH) — CSV Export 實作
2. PR2 (MEDIUM) — React Error Boundary
3. PR3 (MEDIUM) — Accessibility 改善
4. PR4 (LOW) — Performance 最佳化（時間允許）

---

## PR1 — CSV Export 實作

### Scope
- `frontend/src/components/report/ExportActions.tsx` — 改為接收實際 export handler
- `frontend/src/components/screens.tsx` — 連接 store 資料到 ExportActions
- `frontend/src/domain/ledgerExport.ts` — 加入 `triggerCsvDownload()` helper
- `frontend/src/domain/__tests__/ledgerExport.test.ts` — 新增 download trigger 測試

### Tasks
1. 在 `ledgerExport.ts` 加入 `triggerCsvDownload(filename, csvString)` — 使用 Blob + URL.createObjectURL + BOM
2. 在 `screens.tsx` 的 ReportScreen 中：從 store 讀取 transactions + settlements，在 `onExportCsv` 中呼叫 `buildTransactionCsvRows` / `buildSettlementCsvRows` / `serializeCsv` / `triggerCsvDownload`
3. 檔名格式：`easyorder-report-{date}.csv`，含 UTF-8 BOM
4. 新增測試：`triggerCsvDownload` 的 Blob 內容驗證
5. 驗證 t1~t4 全 PASS

### Success criteria
- 點擊「匯出 CSV」按鈕觸發瀏覽器下載
- CSV 含 UTF-8 BOM，中文欄位正確
- 檔名格式 `easyorder-report-{viewDate}.csv`
- 既有 224+ tests 不迴歸

---

## PR2 — React Error Boundary

### Scope
- `frontend/src/components/ErrorBoundary.tsx` — 新建
- `frontend/src/App.tsx` — 在最外層包 ErrorBoundary
- `frontend/src/components/screens.tsx` — ReportScreen / AdminScreen / VendorsScreen 各自包 ErrorBoundary
- `frontend/src/components/pos-components.tsx` — POS 關鍵區塊包 ErrorBoundary

### Tasks
1. 建立 `ErrorBoundary` class component（React 19 仍支援 class-based error boundaries）
   - `fallback` prop 自訂錯誤 UI
   - `onError` prop 供 logging
   - `retry` 按鈕 → reset state
2. App 最外層包 `<ErrorBoundary fallback={<AppCrashPage />} onError={(e) => console.error('[ErrorBoundary]', e)}>`
3. ReportScreen / AdminScreen / VendorsScreen 各包 `<ErrorBoundary fallback={<SectionError name="報表" />}>`
4. POS 主區塊（col-main）包 `<ErrorBoundary>`
5. 新增 `ErrorBoundary` 單元測試（throw error → fallback renders → retry resets）
6. 驗證 t1~t4 全 PASS

### Success criteria
- 子元件 crash 不影響整個 App
- fallback UI 顯示錯誤訊息 + 重試按鈕
- console.error 記錄錯誤
- 既有 224+ tests 不迴歸

---

## PR3 — Accessibility 改善

### Scope
- `frontend/src/components/pos-components.tsx` — 按鈕加 aria-label、focus ring
- `frontend/src/components/screens.tsx` — 表單元素加 label
- `frontend/src/App.tsx` — 交易成功提示加 aria-live
- `frontend/src/index.css` — focus-visible 樣式

### Tasks
1. 所有按鈕元素確保 touch target ≥ 44x44px（CSS min-width/min-height）
2. 表單輸入框加 `aria-label` 或 `<label>`
3. 加入 `:focus-visible` 樣式（outline ring）
4. 交易成功 ConfirmBanner 加 `aria-live="polite"`
5. 搜尋結果清單加 `role="listbox"` + `role="option"`
6. 鍵盤導航區塊加 `role` 屬性
7. 驗證 t1~t4 全 PASS

### Success criteria
- 所有互動元素有 accessible name
- focus ring 在鍵盤導航時可見
- 交易成功有 screen reader 提示
- 既有 224+ tests 不迴歸

---

## PR4 — Performance 最佳化

### Scope
- `frontend/src/components/pos-components.tsx` — React.memo 包裝
- `frontend/src/components/screens.tsx` — React.memo 包裝
- `frontend/src/components/report/LedgerGroupedTable.tsx` — 大量交易虛擬化
- `frontend/src/store/posStore.ts` — Zustand selector 最佳化

### Tasks
1. `CustomerCard`、`ActionBar`、`SearchBox`、`ConfirmBanner` 加 `React.memo`
2. `ReportScreen`、`AdminScreen`、`VendorsScreen` 加 `React.memo`
3. `LedgerGroupedTable` 交易列表使用 `react-window` FixedSizeList（或手寫虛擬化）
4. 安裝 `react-window`（如需要）
5. Zustand selector 改用 atomic selector 避免不必要 re-render
6. 驗證 t1~t4 全 PASS

### Success criteria
- 200+ 筆交易列表滾動流暢
- React DevTools Profiler 確認 re-render 減少
- 既有 224+ tests 不迴歸

---

## Verification Matrix

| PR | t1 (tsc) | t2 (lint) | t3 (vitest) | t4 (build) | Reviewer |
|----|----------|-----------|-------------|------------|----------|
| PR1 | ✅ | ✅ | ✅ | ✅ | VERIFIED |
| PR2 | ✅ | ✅ | ✅ | ✅ | VERIFIED |
| PR3 | ✅ | ✅ | ✅ | ✅ | VERIFIED |
| PR4 | ✅ | ✅ | ✅ | ✅ | VERIFIED |

## Execution Order

PR1 → PR2 → PR3 → (PR4 if time permits)
Each PR: impl → reviewer → merge gate → cleanup → next
