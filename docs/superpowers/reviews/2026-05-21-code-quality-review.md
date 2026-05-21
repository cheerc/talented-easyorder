# Code Review Report — talented-easyorder
日期：2026-05-21
審查者：gemini-680688

## Executive Summary
`talented-easyorder` 展現了極高的型別安全性（TypeScript strict mode 使用良好）與清晰的領域分層架構。然而，專案中存在顯著的邏輯重複（DRY 違反）與「巨型元件/Store」問題，特別是在帳務餘額計算與核心狀態管理上。效能方面，部分操作隨著交易量增長可能出現線性下降，需及早進行重構優化。

## 評分
| 維度 | 分數 (1-10) | 說明 |
|------|------------|------|
| 程式碼品質 | 7 | 型別定義精確，幾乎無 any 濫用。但 UX 使用 window.prompt 較為粗糙，且內聯樣式過多。 |
| DRY | 5 | 核心邏輯（餘額重算、交易屬性推導）在多處重複實作，增加維護成本與 Bug 風險。 |
| 架構 | 6 | 領域層分離良好，但 App.tsx 與部分組件職責過於集中，違反單一職責原則。 |

## 🔴 Critical Issues

### 1. 冗餘且低效的餘額重算邏輯
- **檔案路徑**：`frontend/src/store/posStore.ts` (L354-374)
- **問題描述**：`deleteOrderWithRefundCheck` 函數中，手動實作了一套 O(N log N) 的餘額重算邏輯，這套邏輯與 `frontend/src/domain/ledger.ts` 中的 `recalculateStudentBalances` 完全重複。
- **建議修法**：直接呼叫 `recalculateStudentBalances` 領域函數，並確保全域僅有一套帳務重算規則。

### 2. Infrastructure 邏輯滲透核心 Store
- **檔案路徑**：`frontend/src/store/posStore.ts` (L538-650)
- **問題描述**：高達 100 多行的 Migration 與資料標準化邏輯直接內嵌在 Store 定義中，導致 Store 檔案過於臃腫且難以閱讀。
- **建議修法**：將 `migrate` 與相關的映射邏輯（Mapping）抽離至 `src/storage/migration.ts`，Store 僅負責呼叫。

## 🟡 Major Issues

### 1. God Component — App.tsx
- **檔案路徑**：`frontend/src/App.tsx`
- **問題描述**：該檔案超過 500 行，同時負責路由切換、鍵盤快捷鍵、同步狀態監控、焦點管理與多個業務邏輯的狀態派生。
- **建議修法**：將導覽（TopBar + Tab Content）抽離為 `MainLayout`，將鍵盤與焦點管理抽離為更細緻的 `useAppShortcuts` 或 `useAppFocus` hook。

### 2. 重複的交易屬性推導
- **檔案路徑**：`frontend/src/hooks/usePosFlow.ts`
- **問題描述**：在 `saveCrashDraft` (L116-140) 與 `commitTransaction` (L152-172) 中，關於 `mealPrice`、`paidAmount` 與 `note` 的產生邏輯幾乎完全一致。
- **建議修法**：將這套推導規則封裝在 `domain/posTransaction.ts` 的工廠函數中。

### 3. 使用 window.prompt 進行資料編輯
- **檔案路徑**：`frontend/src/components/screens.tsx` (L115-125)
- **問題描述**：`ReportScreen` 使用 `window.prompt` 編輯交易，缺乏型別驗證、取消處理不夠優雅，且無法保證 UX 一致性。
- **建議修法**：實作一個標準的 `EditTransactionModal` 組件，統一輸入驗證邏輯。

## 🟢 Minor Issues

### 1. 組件庫過於巨大且職責混雜
- **檔案路徑**：`frontend/src/components/pos-components.tsx`
- **問題描述**：該檔案 32K，包含了從 TopBar 到 SearchBox 等多個不相關組件，且夾雜大量內聯樣式。
- **建議修法**：將組件拆分為獨立檔案，並將內聯樣式移至 CSS Module 或 CSS 變數。

### 2. 殘留的 Tweaks 實驗性代碼
- **檔案路徑**：`frontend/src/components/tweaks-panel.tsx`
- **問題描述**：該檔案包含大量設計實驗性質的代碼，且使用 `postMessage` 與不同的狀態管理模式，與主專案風格脫節。
- **建議修法**：若非正式功能，建議移除或僅在開發環境啟用。

## Quick Wins

1. **統一帳務邏輯**：將 `posStore.ts` 中的手寫重算邏輯替換為 `ledger.ts` 的標準函數。（改動小，效益大，確保正確性）
2. **解耦 Migration**：將 `posStore.ts` 結尾的 Migration 塊移出。（立即提升代碼可讀性）
3. **優化 App.tsx 結構**：將 `flashData` 推導邏輯抽離至獨立的 selector 或 hook。（降低核心組件複雜度）

## 架構建議

1. **引入 Selector 模式**：目前 `App.tsx` 中有大量基於 Store 狀態的複雜派生（如 `flashData`, `tx` 過濾），建議引入 `useSelector` 模式或將邏輯下沉至領域層。
2. **強化元件原子化**：`pos-components.tsx`應依照原子設計原則拆分，避免單一組件檔案過大。
3. **建立標準表單處理規範**：取代現有的 `window.prompt`，為結帳與編輯操作建立統一的受控組件（Controlled Components）規範。
