---
required_reads:
  - docs/superpowers/specs/2026-05-14-pc-pos-order-flow-spec.md
  - docs/superpowers/specs/2026-05-14-order-ledger-cash-close-spec.md
  - docs/superpowers/specs/2026-05-14-student-account-management-spec.md
  - docs/superpowers/specs/2026-05-14-menu-vendor-management-spec.md
  - docs/superpowers/specs/2026-05-14-ipad-face-auth-handoff-spec.md
  - docs/superpowers/specs/2026-05-14-google-sheets-sync-offline-spec.md
  - docs/superpowers/specs/2026-05-07-ipad-pos-system-design.md
  - docs/DEPLOYMENT-GUIDE.md
  - docs/security.md
  - docs/superpowers/VERIFICATION-CHECKLIST.md
  - frontend/src/domain/posFlow.ts
  - frontend/src/domain/ledger.ts
  - frontend/src/domain/student.ts
  - frontend/src/domain/menu.ts
  - frontend/src/domain/ipadHandoff.ts
  - frontend/src/domain/cashClose.ts
  - frontend/src/firebase/firebaseApp.ts
---

# Plan: easyorder docs/ 整理 + living-spec backfill

**Date**: 2026-06-04
**Complexity**: complex+（純 docs，但涉及 60+ 檔案搬遷 + 7 份 spec 內容刷新）
**PR target**: dev
**Closes**: t-20260604074447984861-7

## Task Breakdown

拆為兩個 sequential PR：

| # | PR | 內容 | 相依 |
|---|-----|------|------|
| PR1 | docs/ mechanical cleanup | 老 plan 歸檔、散檔歸位 | 無 |
| PR2 | living-spec backfill | 7 份 spec 刷新 + 改名 + 廢棄標記 | PR1 merge 後 |

> PR2 依賴 PR1 的結構變更（spec 檔名變更後，需確認 archive 內舊引用不影響 living baseline）。

---

## PR1: docs/ mechanical cleanup

### 1.1 建立 archive 目錄

新增 `docs/superpowers/plans/archive/`，用於歸檔已完成/已廢棄的 plan。

### 1.2 Plan 歸檔（git mv 保留 history）

**歸檔條件**：符合任一下列條件 → `archive/`
- 檔名含 `(DONE)` 標記
- 檔名含 `(OBSOLETE)` 標記
- 日期前綴在 2026-06-01 之前（已完成的舊 plan）

**保留**（不歸檔）：
- `ROADMAP.md` — 開發 roadmap，持續參考
- 2026-06-01 及之後的 dated plan（4 份）：`2026-06-01-security-fix-batch.md`, `2026-06-02-god-node-transaction-view.md`, `2026-06-03-domain-shared-types.md`, `2026-06-03-posState-slice-interfaces.md`, `2026-06-03-storage-wire-types.md`
- 無日期前綴的 plan（8 份）：`app-split-plan.md`, `code-splitting-plan.md`, `hooks-test-plan.md`, `perf-monitoring-plan.md`, `store-actions-test-plan.md`, `store-bypass-fix-plan.md`, `usePosFlow-split-plan.md`, `2026-05-31-security-fixes-phase1-4.md`（5/31 歸入保留，仍有參考價值）

**歸檔動作**：
```bash
git mv docs/superpowers/plans/<old-name>.md docs/superpowers/plans/archive/<old-name>.md
```

**實際歸檔清單**（51 份，由 impl 執行前確認）：

所有檔名含 `(DONE)` 的 plan（~15 份）：
- `2026-05-10-frontend-audit-remediation(DONE).md`
- `2026-05-14-phase-1-0-foundation-hardening(DONE).md`
- `2026-05-14-phase-1-1-pc-pos-formalization(DONE).md`
- `2026-05-14-phase-1-2-reporting-and-settlement(DONE).md`
- `2026-05-15-accessibility-plan(DONE).md`
- `2026-05-15-design-system-component-library(DONE).md`
- `2026-05-15-edge-case-ui-plan(DONE).md`
- `2026-05-15-error-handling-recovery-strategy(DONE).md`
- `2026-05-15-frontend-hardening-plan(DONE).md`
- `2026-05-15-frontend-performance-optimization(DONE).md`
- `2026-05-15-phase-a-b-c-execution-plan(DONE).md`
- `2026-05-15-pwa-offline-first-strategy(DONE).md`

所有檔名含 `(OBSOLETE)` 的 plan：
- `2026-05-14-phase-1-3-google-sheets-sync-offline(OBSOLETE).md`
- `2026-05-15-apps-script-sheets-sync-migration(OBSOLETE).md`
- `2026-05-15-deployment-hosting-strategy(OBSOLETE).md`

所有日期在 2026-06-01 前的 dated plan（不含 DONE/OBSOLETE，~30 份）：
- `2026-05-14-phase-2-ipad-face-handoff.md`
- `2026-05-15-counter-cash-exception-normalization.md`
- `2026-05-15-cross-platform-android-support.md`
- `2026-05-15-data-migration-strategy.md`
- `2026-05-15-edge-case-scenario-analysis.md`
- `2026-05-15-free-backend-architecture-exploration.md`
- `2026-05-15-frontend-improvement-roadmap.md`
- `2026-05-15-frontend-security-considerations.md`
- `2026-05-15-spec-conformance-audit.md`
- `2026-05-15-user-decision-checklist.md`
- `2026-05-15-user-operation-sop-ux-analysis.md`
- `2026-05-16-firebase-sync-architecture.md`
- `2026-05-17-batch1-cashflow-redesign.md`
- `2026-05-17-batch1-hotfix-r2.md`
- `2026-05-17-batch1-hotfix.md`
- `2026-05-17-batch2-ui-fixes.md`
- `2026-05-17-batch3-seed-data.md`
- `2026-05-18-batch4-accounting-fixes.md`
- `2026-05-18-batch4-verification-checklist.md`
- `2026-05-18-batch5-ux-improvements.md`
- `2026-05-18-batch5-verification-checklist.md`
- `2026-05-20-batch6-accounting-ux-fixes.md`
- `2026-05-20-batch6-verification-checklist.md`
- `2026-05-21-batch5-6-verification-checklist.md`
- `2026-05-21-batch5-6-verification-fixes.md`
- `2026-05-21-code-quality-refactoring-plan.md`
- `2026-05-25-order-display-simplification-payment-offset.md`
- `2026-05-27-disable-hover-selection.md`
- `2026-05-27-recent-strip-simplification-v2.md`
- `2026-05-30-component-unit-tests-wave2.md`
- `2026-05-30-split-posStore-monolith.md`

### 1.3 散檔歸位

| 檔案 | 目前位置 | 目標位置 | 理由 |
|------|---------|---------|------|
| `DEPLOYMENT-GUIDE.md` | `docs/` root | `docs/ops/` | deployment 屬於 ops |
| `security.md` | `docs/` root | `docs/ops/` | security 屬於 ops |
| `VERIFICATION-CHECKLIST.md` | `docs/superpowers/` | `docs/superpowers/verification/` | 與其他 verification 檔案同類 |

### 1.4 驗證

- [ ] `git mv` 後無殘留檔案在原位置
- [ ] `docs/superpowers/plans/` 僅保留 ~13 份（ROADMAP + 8 non-dated + ~4 recent June plans）
- [ ] `docs/superpowers/plans/archive/` 有 51 份舊 plan
- [ ] 三個散檔已歸位
- [ ] `git status` 確認無意外變更

### Affected callers

無 code 變更，僅文件搬遷。舊 plan 內的交叉引用（指向其他舊 plan 或舊 spec 名稱）會隨歸檔自然失效，但不影響任何程式碼。

---

## PR2: living-spec backfill

### 2.1 現況分析

7 份 spec 全卡在 2026-05-14（ipad-pos-system-design 在 05-07），與實際 codebase 有落差：

| 舊 spec | 對應 code | 現況判斷 |
|---------|----------|---------|
| `2026-05-07-ipad-pos-system-design.md` | 無單一對應 | 架構總覽，描述 Phase 1.1（done）、Phase 1.2（Google Sheets，已廢棄）、Phase 2（planned）。Google Sheets 已改 Firebase |
| `2026-05-14-google-sheets-sync-offline-spec.md` | 不存在 | Google Sheets 同步已被 Firebase Firestore 取代（`firebase/` + `domain/ledgerSyncBoundary.ts`）|
| `2026-05-14-ipad-face-auth-handoff-spec.md` | `domain/ipadHandoff.ts` | iPad handoff 邏輯已定義但 Phase 2 未實作，spec 描述的是 planned behavior |
| `2026-05-14-menu-vendor-management-spec.md` | `domain/menu.ts` | 已實作，需比對 spec 與實際 code |
| `2026-05-14-order-ledger-cash-close-spec.md` | `domain/ledger.ts`, `ledgerAudit.ts`, `ledgerExport.ts`, `ledgerReport.ts`, `cashClose.ts`, `cashSession.ts` | 大量實作，spec 需刷新 |
| `2026-05-14-pc-pos-order-flow-spec.md` | `domain/posFlow.ts`, `posSearch.ts`, `posTransaction.ts` | 核心功能已實作，spec 需刷新 |
| `2026-05-14-student-account-management-spec.md` | `domain/student.ts`, `firebase/studentRepository.ts` | 已實作（含 Firebase 整合），spec 需刷新 |

### 2.2 各 spec 處理方式

#### 2.2.1 `2026-05-07-ipad-pos-system-design.md` → **歸檔**

這是架構總覽（非 capability spec），內容已過時（Google Sheets → Firebase），且各子系統已有獨立 spec。直接 `git mv` 到 `docs/superpowers/plans/archive/`。

#### 2.2.2 `2026-05-14-google-sheets-sync-offline-spec.md` → **標 [DEPRECATED] 後歸檔**

Google Sheets 同步已被 Firebase Firestore 完全取代。在檔首加入 `[DEPRECATED]` 說明取代方案，然後移到 `docs/superpowers/specs/archive/`（新建）。

新建 `docs/superpowers/specs/archive/` 目錄存放廢棄 spec。

#### 2.2.3 `2026-05-14-ipad-face-auth-handoff-spec.md` → **刷新為 `ipad-face-auth-handoff-spec.md`**

**刷新步驟**：
1. 閱讀 `frontend/src/domain/ipadHandoff.ts` — 了解已定義的 interface 與 handoff flow
2. 閱讀 `frontend/src/domain/posSearch.ts` — PC 端如何接收 handoff 事件
3. 更新 spec：
   - 保留「Phase 2 planned」的整體架構描述
   - 更新已實作的 handoff data types（對齊 `ipadHandoff.ts`）
   - 明確標註哪些 section 是「planned / not yet implemented」
   - 移除對 Google Sheets 的引用

#### 2.2.4 `2026-05-14-menu-vendor-management-spec.md` → **刷新為 `menu-vendor-management-spec.md`**

**刷新步驟**：
1. 閱讀 `frontend/src/domain/menu.ts` — 了解 menu/vendor 資料結構
2. 閱讀 `frontend/src/store/posActions/menuActions.ts` — 了解 menu 操作
3. 閱讀相關 component（menu setup UI） — 了解實際互動流程
4. 更新 spec：
   - 使用者故事對齊實際 UI flow
   - 驗收標準反映實際實作（Firebase sync 而非 Google Sheets）
   - 移除未實作的 catalog 功能標記為「future」

#### 2.2.5 `2026-05-14-order-ledger-cash-close-spec.md` → **刷新為 `order-ledger-cash-close-spec.md`**

**刷新步驟**：
1. 閱讀 `frontend/src/domain/ledger.ts`, `ledgerAudit.ts`, `ledgerExport.ts`, `ledgerReport.ts` — 了解 ledger 資料結構與邏輯
2. 閱讀 `frontend/src/domain/cashClose.ts`, `cashSession.ts` — 了解結帳流程
3. 閱讀 `frontend/src/firebase/ledgerRepository.ts`, `settlementRepository.ts` — 了解 Firebase 同步
4. 閱讀 ReportScreen component — 了解報表 UI
5. 更新 spec：
   - 更新為 Firebase-backed ledger（取代 Google Sheets）
   - 反映實際的 cash close flow（open/close session, expected vs counted）
   - 更新 CSV export 的實際欄位（對齊 `ledgerExport.ts`）

#### 2.2.6 `2026-05-14-pc-pos-order-flow-spec.md` → **刷新為 `pc-pos-order-flow-spec.md`**

**刷新步驟**：
1. 閱讀 `frontend/src/domain/posFlow.ts`, `posSearch.ts`, `posTransaction.ts` — 了解核心 POS flow
2. 閱讀 `frontend/src/store/posActions/transactionActions.ts` — 了解操作邏輯
3. 閱讀相關 hooks (`usePosFlow.ts`, `useKeyboardShortcuts.ts`) — 了解 UX
4. 更新 spec：
   - 更新搜尋模式（目前為 text search，QR/barcode 標為 future）
   - 更新交易類型與狀態機（對齊 `posTransaction.ts`）
   - 更新鍵盤快速鍵（對齊實際 shortcut 設定）
   - 反映 Firebase sync 狀態顯示

#### 2.2.7 `2026-05-14-student-account-management-spec.md` → **刷新為 `student-account-management-spec.md`**

**刷新步驟**：
1. 閱讀 `frontend/src/domain/student.ts` — 了解 student 資料結構
2. 閱讀 `frontend/src/firebase/studentRepository.ts` — 了解 Firebase CRUD
3. 閱讀 student import/management UI components
4. 更新 spec：
   - 更新為 Firebase-backed student repository
   - 反映實際的 import flow（CSV/roster import）
   - 更新 face enrollment 關聯（對齊 `ipadHandoff.ts`）

### 2.3 命名規則

- capability-keyed、不帶日期：`<capability>-spec.md`
- 已廢棄 spec 放入 `docs/superpowers/specs/archive/`，檔首加 `[DEPRECATED]` 區塊說明取代方案
- 已歸檔的 `ipad-pos-system-design.md` 放在 `docs/superpowers/plans/archive/`（它是架構設計文件，非 capability spec）

### 2.4 PR2 最終結構

```
docs/superpowers/specs/
├── ipad-face-auth-handoff-spec.md       (planned capability)
├── menu-vendor-management-spec.md       (living)
├── order-ledger-cash-close-spec.md      (living)
├── pc-pos-order-flow-spec.md            (living)
├── student-account-management-spec.md   (living)
└── archive/
    └── 2026-05-14-google-sheets-sync-offline-spec.md  [DEPRECATED]
```

### 2.5 驗證

- [ ] 5 份 living spec 已刷新並改名（無日期前綴）
- [ ] 每份 spec 的「驗收標準」與實際 code 行為一致
- [ ] 已廢棄的 Google Sheets spec 已歸檔並標 [DEPRECATED]
- [ ] 舊架構設計已歸檔到 plans/archive/
- [ ] spec 內無對 Google Sheets 的過時引用（改為 Firebase）
- [ ] `docs/superpowers/specs/` 目錄乾淨，無殘留 dated 檔案

### Affected callers

無 code 變更。舊 spec 檔名變更後：
- archive 內舊 plan 對舊 spec 檔名的引用會失效（可接受，歸檔文件不需修正）
- Dispatch book、IMPL.md、REVIEWER.md 對 spec 路徑無引用（已確認 PROJECT.md §7.1 使用 `<capability>-spec.md` 佔位符）

---

## Test Impact

純 docs 變更，無 code 異動。不需跑 test suite。

## Implementation Notes

- 所有檔案搬遷使用 `git mv`（保留 git history）
- PR1 和 PR2 各自獨立 commit + PR
- PR2 必須在 PR1 merge 後開始（spec 刷新時舊檔案已不在原位）
- spec 刷新時參考 `graphify-out/graph.json` 確認 module 間依賴關係（LEAD.md §3 graphify Query）
- commit message 帶 `Closes t-20260604074447984861-7`（PR2 的 merge commit）

## Complexity: complex+

純 docs 無 code 風險，但因檔案數量多（60+）+ spec 內容需逐份比對 code，判定為 complex+。
