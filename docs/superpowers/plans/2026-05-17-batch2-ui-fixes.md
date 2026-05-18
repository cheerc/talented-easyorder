---
status: approved
date: 2026-05-17
complexity: simple
batch: 2
review: gemini-7d0621 REJECTED draft → corrections applied
---

# Batch 2 — UI 修復與介面優化

## Background

Batch 1 金流重設計完成後，使用者回報的 UI/UX 問題。這些不涉及核心邏輯，主要是介面文字、佈局、和功能入口調整。

## Issues

### B2-1: 月份導覽缺少「下一個月」按鈕（Medium）

**現狀**：TopBar 只有一個 ◀ 按鈕（上個月），無法切到下個月。

**程式碼位置**：`pos-components.tsx:69-79`（TopBar starts at line 41）
```tsx
<button className="db-trigger" title="上個月" ...>◀</button>
```
目前無 ▶ 按鈕。

**改動**：
- `pos-components.tsx` TopBar：在日期 input 右邊加一顆 ▶ 按鈕（下個月）
- 邏輯：`d.setMonth(d.getMonth() + 1); d.setDate(1);`
- 與 ◀ 按鈕樣式一致（`className="db-trigger"`, `width: 22px, height: 22px, fontSize: 10px`）

### B2-2: 繳費金額 0 對齊問題（Medium）

**現狀**：付款金額 input 未輸入時顯示 placeholder "0"，位置太靠左且未與 `$` `元` 垂直置中。

**程式碼位置**：
- `pos-components.tsx:352-364`（pay-input-container）
- `index.css:522-527`（`.pay-input-main` 42px font, right-aligned）

**期望**：placeholder "0" 應與 `$` 和 `元` 垂直對齊，字體樣式一致。

**Gemini review 補充**：`.pay-input-container` 已有 `align-items: center`（index.css:522）。問題來自 `.pay-input-main` 的 `flex: 1` + `text-align: right`（index.css:525），導致 placeholder "0" 靠右而非視覺居中。

**改動**：
- `index.css`：`.pay-input-main::placeholder` 加 `text-align: center; color: var(--ink-3);`，讓未輸入時 "0" 居中顯示
- 或改為：移除 placeholder "0"，改用 overlay text 確保與 `$` `元` 基線對齊
- `.pay-input-prefix`（$, 28px）和 `.pay-input-suffix`（元, 18px）字體大小差距大，調整為視覺一致（如 prefix 24px, suffix 24px）
- 確認 `$` prefix、input 數字、`元` suffix 三者基線對齊（`align-items: baseline` 可能比 center 更好）

### B2-3: 結帳明細簡化（Medium）

**現狀**：CustomerCard 的「結帳明細」區塊顯示三項：當日便當金額、帳戶餘額、**交易後預估餘額**。

**程式碼位置**：`pos-components.tsx:281`（pay-title）, `:292-298`（after-preview block）
```tsx
<div className="pay-title">結帳明細</div>
// ... 便當金額 / 帳戶餘額 ...
<div className="after-preview">  <!-- lines 292-298 -->
  <span className="after-label">交易後預估餘額</span>
  ...
</div>
```
注意：`afterBalance` 仍被 RecentStrip (line 598) 和 posStore 使用，只移除 UI 顯示不影響計算。

**期望**：只顯示「帳戶餘額」和「今天便當費」，移除「交易後預估餘額」。

**改動**：
- `pos-components.tsx:294-300`：移除整個 `<div className="after-preview">` 區塊
- `index.css`：清除 `.after-preview`, `.after-label`, `.after-val` 相關樣式（dead code）
- 確認 order mode 和 payment mode 都只顯示相關的 1-2 行資訊

### B2-4: 「改本筆價格」改名為「訂購其他餐點」（Low）

**現狀**：按鈕文字為「改本筆價格」。

**程式碼位置**：`pos-components.tsx:306`（button text）, `:315`（aria-label）
```tsx
改本筆價格  <!-- line 306 -->
```

**期望**：改為「訂購其他餐點」，因為功能是讓學生訂不同金額的便當。

**改動**：
- `pos-components.tsx:306`：button text `改本筆價格` → `訂購其他餐點`
- `pos-components.tsx:315`：aria-label 也一併更新（改為 `訂購價格` 或 `其他餐點價格`）
- 相關 test（`pcPosFlow.integration.test.tsx:110`）如有 text match 也一併更新
- `App.tsx:303` 的 note `單筆改價：...` → `訂購其他餐點：...`（交易備註）

### B2-5: 開帳金額移到設定介面（High）

**現狀**：開帳金額 input 直接出現在 CashClosePanel（結帳/關帳區塊），使用者可隨時修改。

**程式碼位置**：
- `report/CashClosePanel.tsx:52-63`（開帳金額 input）
- `screens.tsx:166`（`onOpeningCashChange` callback）
- `domain/cashSession.ts:78-84`（validateOpeningCash）
- `store/posStore.ts:102`（openCashSession action）

**期望**：
- 開帳金額改為在「設定」頁面才能修改
- 結帳/關帳欄位只顯示當前櫃台金額（read-only）

**改動**：
- `report/CashClosePanel.tsx`：移除開帳金額 input，改為 read-only 顯示：`開帳金額 $${fmt(openingCash)}`
- **需新增設定 section**：現有 Admin screen（`screens.tsx`）只有「今日設定」(TodayMenu/Vendor) 和「學員管理」，無 settings section
  - 在 Admin 加一個 sub-tab「系統設定」或在現有「今日設定」下方加入「每日開帳金額」input
  - 用現有 `openCashSession` action
- 結帳確認 dialog（`CashClosePanel.tsx:128`）維持顯示開帳金額（read-only）

### B2-6: 金額編輯入口（H6 延伸 — Low）

**現狀**：`editTransaction` 已存在於 store，入口在報表 detail row 的「編輯」按鈕。但使用者在 POS 主畫面找不到編輯金額的地方。

**期望**：在 POS 的 RecentStrip（最近交易列表）加 tap-to-edit 入口。

**改動**：
- `pos-components.tsx` RecentStrip：每筆交易 item 加 onClick handler
- onClick 打開 inline 編輯 UI 或跳轉到該筆交易的編輯畫面
- 只對 today's transactions 開放編輯（歷史紀錄 locked）
- 已關帳的日期不可編輯

## Success Criteria

- 所有現有 tests pass + 新增/更新的 tests
- `./workflow.sh t6` 全綠
- 手動驗證：
  - 月份可前後切換
  - 繳費 input 的 0/金額與 $ 元 垂直置中對齊
  - 結帳明細不再顯示「交易後預估餘額」
  - 按鈕文字為「訂購其他餐點」
  - 開帳金額只在設定介面可改，關帳欄只讀顯示
  - RecentStrip 點擊可編輯

## Required Tests

- **TopBar month navigation**: render → click ▶ → assert viewDate 進一個月; click ◀ → 退一個月
- **Pay input alignment**: render payment mode → snapshot test or assert container has align-items: center
- **CustomerCard no estimated balance**: render order mode → assert 「交易後預估餘額」不存在
- **Price override label**: render → assert button text = 「訂購其他餐點」
- **CashClosePanel read-only opening**: render → assert 開帳金額 input 不存在, read-only span 存在
- **RecentStrip tap-to-edit**: render with today tx → click → assert edit mode triggered
