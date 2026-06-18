---
status: approved
date: 2026-05-15
complexity: complex+
---

# Edge Case UI 補強計畫

## Goal

實作 edge case analysis 中的 MEDIUM/LOW UI 改善項目，補強結帳歷史、稽核軌跡、今日狀態總覽、午夜邊界處理。

## Context

- Base SHA: `45fe663`
- 現有 230 tests
- Store 已有 `auditEvents` (LedgerAuditEvent[]) 和 `dailySettlements` (DailySettlement[])
- systemDate 目前是 mount-time snapshot (`useMemo`)

## Approach

5 個功能拆成 3 個 PR：

| PR | 功能 | Edge Case IDs | Priority |
|----|------|---------------|----------|
| PR5 | Settlement History UI + Audit Trail UI | M-E2, M-E3 | MEDIUM |
| PR6 | Today Status Dashboard | M-E4 | MEDIUM |
| PR7 | Midnight Boundary + 跨日提醒 | M-E1, L-E1, L-E3 | MEDIUM/LOW |

---

## PR5 — Settlement History + Audit Trail UI

### Scope
- `frontend/src/components/screens.tsx` — 新增 HistoryScreen tab
- `frontend/src/components/report/SettlementHistoryTable.tsx` (new)
- `frontend/src/components/report/AuditTrailTable.tsx` (new)
- `frontend/src/App.tsx` — 加入新 tab 路由

### Tasks
1. **SettlementHistoryTable**: 從 store `dailySettlements` 讀取，表格顯示：日期、狀態（已關/已開）、訂餐數、系統現金、實際點算、差異、關帳人、關帳時間。支援點擊行展開 settlement 明細。
2. **AuditTrailTable**: 從 store `auditEvents` 讀取，表格顯示：時間、操作類型（更正/作廢/reopen）、操作人、對象 transactionId、before/after 摘要。
3. 兩個 table 共用同一個 HistoryScreen，用 tab 切換（結帳歷史 / 稽核軌跡）。
4. App.tsx 加入 F5 快捷鍵切換到 history tab。
5. t1~t4 全 PASS。

### Success criteria
- 主任可綜覽所有日期的關帳狀態
- 稽核軌跡顯示更正/作廢/reopen 操作歷史
- 既有 230+ tests 不迴歸

---

## PR6 — Today Status Dashboard

### Scope
- `frontend/src/components/TodayDashboard.tsx` (new)
- `frontend/src/App.tsx` — 加入 dashboard 入口

### Tasks
1. 建立 TodayDashboard component，顯示：
   - 今日交易筆數、訂餐數、收現總計
   - 關帳狀態（已關/未關）
   - 待同步筆數（queued count）
   - 今日更正/作廢筆數
   - 最近 5 筆交易
2. 在 TopBar 或 POS idle 狀態顯示 dashboard 入口（小 icon/badge）
3. Dashboard 以卡片式 layout 呈現，一目了然
4. t1~t4 全 PASS

### Success criteria
- 替代人員可快速了解今日營運狀況
- Dashboard 顯示關鍵指標（交易數、關帳狀態、待同步）
- 既有 230+ tests 不迴歸

---

## PR7 — Midnight Boundary + 跨日提醒

### Scope
- `frontend/src/App.tsx` — systemDate 改用動態更新
- `frontend/src/components/pos-components.tsx` — 午夜提醒 banner

### Tasks
1. systemDate 改用 `useState` + `setInterval`（每 60s 更新），或 watch `document.visibilitychange` 在頁面恢復時更新
2. 當 `viewDate !== systemDate` 且 tab === 'pos' 時，顯示提醒 banner：「目前檢視日期與今日不同，請確認是否切換至今日」
3. 23:55-23:59 顯示跨日提醒：「即將跨日，請確認日期設定」
4. 日期選擇器加入「上個月」preset 按鈕（L-E3）
5. t1~t4 全 PASS

### Success criteria
- systemDate 隨實際日期自動更新
- 跨夜操作有明確提醒
- 既有 230+ tests 不迴歸

---

## Verification Matrix

| PR | t1 (tsc) | t2 (lint) | t3 (vitest) | t4 (build) | Reviewer |
|----|----------|-----------|-------------|------------|----------|
| PR5 | ✅ | ✅ | ✅ | ✅ | VERIFIED |
| PR6 | ✅ | ✅ | ✅ | ✅ | VERIFIED |
| PR7 | ✅ | ✅ | ✅ | ✅ | VERIFIED |

## Execution Order

PR5 → PR6 → PR7
Each PR: impl → reviewer → merge gate → cleanup → next
