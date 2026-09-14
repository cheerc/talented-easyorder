# Project Status — Talented EasyOrder

> **Last verified:** 2026-09-14 @ `e41544122bb9b8336bb34a463bf76f62f4025c7e`
> （`chore(node): migrate CI and toolchain declarations to Node 24 (#437)`）
>
> 本文件是專案現況快照，也是 operator 的 **frontend UI 驗收清單落點**。
> 與其他規劃文件的關係：`docs/superpowers/plans/ROADMAP.md` 的 Phase 1.3 與
> Tech Stack 章節已過時（仍寫 Google Sheets），以本文件 §5 為準；
> ROADMAP 本體不由本文件修改（需 operator 決定）。

## 1. 一句話現況

專案處於停擺後的對齊點：最後一次功能／修正 commit 是 2026-06-23
（`cce3c56`），之後只有 chore/CI 與今天的兩個依賴／toolchain PR；
open issue = 0、open PR = 0，所有已記錄的 UI 工作皆已 merge，
等 operator 本人驗收 frontend UI 後再往後開發。

## 2. 當前關鍵路徑

**Operator 的 frontend UI 驗收是唯一的 gate。**

- 在 frontend 通過 operator 本人驗證之前，不往後開發（不啟 Phase 2、不做新功能）。
- 發現任何 UI 問題 → 開 issue → 回填 §3 的驗收清單表格。
- 本文件每次更新時一併刷新頂部的 last-verified 日期與 commit SHA。

## 3. Frontend UI 驗收清單（本文件核心）

**重要事實：查無任何已記錄的未完成 UI 項目。**

- `gh issue list --state open` 回傳空（2026-09-14 實測）。
- `gh pr list --state open` 回傳空（2026-09-14 實測）。
- 最後一批 UI issue（#403、#406–#431 區間，抽查 #403/#406/#407/#412/
  #417/#419/#421/#423/#425/#428/#430）狀態皆為 CLOSED（#406 的 issue
  檢視回傳 MERGED，屬同一「已關閉」語義，見 §8 備註 1）。
- plans / specs / retro / TODO 全文搜尋無未完成 UI 待辦。

**不要憑空編造待辦項。** 下表是空的結構化表格，供 operator 邊測邊填：

| 畫面/元件 | 問題描述 | 期望行為 | 狀態 | 對應 issue |
|---|---|---|---|---|
| （例）PosColumn 結帳欄 | （填寫） | （填寫） | 待確認 | （開 issue 後回填編號） |
| | | | | |

填寫方式：發現問題請先開 issue，再把編號回填到「對應 issue」欄；
狀態建議使用「待確認 / 已開 issue / 已修復待驗 / 已關閉」四種。

## 4. Phase 進度表

| Phase | 狀態 | 證據 |
|---|---|---|
| 1.0 基礎架構補強 | DONE | `docs/superpowers/plans/archive/2026-05-14-phase-1-0-foundation-hardening(DONE).md` |
| 1.1 PC POS 正式化 | DONE | `docs/superpowers/plans/archive/2026-05-14-phase-1-1-pc-pos-formalization(DONE).md` |
| 1.2 報表與結算 | DONE | `docs/superpowers/plans/archive/2026-05-14-phase-1-2-reporting-and-settlement(DONE).md` |
| 1.3 Google Sheets 同步 | **OBSOLETE** | 檔名標記 `(OBSOLETE)`：`docs/superpowers/plans/archive/2026-05-14-phase-1-3-google-sheets-sync-offline(OBSOLETE).md`；改走 Firebase（`docs/superpowers/plans/archive/2026-05-16-firebase-sync-architecture.md`，CHANGELOG 0.2.0「deprecate Google Sheets sync」#261） |
| 2 iPad 人臉辨識 | 未開始 | `docs/superpowers/plans/archive/2026-05-14-phase-2-ipad-face-handoff.md` 無 DONE 標記 |

## 5. 實際架構與 stack（本文件為準）

- 持久化：IndexedDB（`frontend/src/storage/indexedDBStorage.ts`，
  內含 localStorage fallback，見該檔 L64–L76）+ Firestore
  （`frontend/src/firebase/` 下 `ledgerRepository.ts`、
  `studentRepository.ts`、`settlementRepository.ts`、
  `realtimeSubscriptions.ts`）。
- 實際 stack（`frontend/package.json` 聲明值）：
  Vite ^8.0.10、React ^19.2.5、TypeScript ~6.0.2、Zustand ^5.0.13、
  Vitest ^4.1.5、Firebase ^12.13.0、vite-plugin-pwa ^1.3.0。
- ⚠️ `docs/superpowers/plans/ROADMAP.md` 已過時：
  其 Tech Stack 仍寫 "Google Sheets/Apps Script or an equivalent adapter"
  （該檔 L9），Phase 1.3 整段仍是 Sheets（該檔 L29、L49、L120–L139）。
  以本文件為準；ROADMAP 本體是否改寫由 operator 決定，本次未修改。

## 6. 健康度基線（2026-09-14 於本 worktree 實跑，Node v24.21.0）

- `npx tsc --noEmit` → exit 0（無輸出）
- `npm run lint` → exit 0
- `npx vitest run` → 113 passed / 1 skipped 檔案；
  991 passed / 8 skipped 測試
- `npm run build` → 成功（實測 457ms）；PWA generateSW，
  precache 20 entries / 908.09 KiB
- 1 skipped 檔案 = `frontend/src/firebase/__tests__/firestoreRules.spec.ts`，
  設計上在無 Firestore emulator 時 `describe.skip`（CI 有 emulator 會跑）。
- CI（GitHub Actions）跑在 Node v24（PR #437 之後），
  build-and-test 與 e2e 皆 pass。

重跑指令（於 `frontend/` 目錄）：

```bash
npm ci && npx tsc --noEmit && npm run lint && npx vitest run && npm run build
```

## 7. 已知技術債（只記錄，不處理）

1. `frontend/src/components/screens/BackupScreen.tsx` 是純 UI placeholder：
   資料全 hardcode（12,847 筆 L69、2026/05/06 18:32 L46/L70、
   `setInterval` 假進度條 L19），文案描述 "Google Sheets"（L35/L57）
   與 "SQLite"（L33/L35）——兩者都不是實際架構；
   檔案 header 已自述為 placeholder（Ref: #329）。
   **該元件未被 `AppRouter.tsx` 掛上任何 tab**（router 只有
   pos / report / admin / vendors / history 五個 tab），使用者無法到達；
   僅 `frontend/src/components/__tests__/screens.test.tsx:105`
  （`describe('BackupScreen')`）引用。
2. `CHANGELOG.md` 最新條目為 `[0.3.0]` 2026-06-15，
   其後 #419–#431 一整批 UI 工作未記錄。
3. 版本號三方不一致：`frontend/package.json` = 0.0.2、
   CHANGELOG 最新 = 0.3.0、git tag = v0.0.1 / v0.0.2 / 0529。
   對齊基準需 operator 決定，本次不動。
4. 3 處 TODO 指向已關閉 issue（內容為未來工作佔位，非錯誤）：
   `frontend/src/store/posStore.ts:1` 與
   `frontend/src/store/posTypes.ts:1` 指向 #289（CLOSED）、
   `frontend/src/store/posPersistence.ts:9` 指向 #286（CLOSED）。
5. `docs/superpowers/plans/` 下的 plan checkbox 從未被當作進度追蹤機制，
   不可作為進度證據（註：brief 稱「皆為 0 勾選」不精確——archive 內
   2026-05-07-ipad-pos-system-design.md 與
   2026-05-10-frontend-audit-remediation(DONE).md 共含 4 個已勾選項，
   皆為歷史設計文件的內文勾選，非進度追蹤；見 §8 備註 5）。

## 8. 如何維護本文件

- **何時更新**：每次 operator 驗收回饋、Phase 狀態變化、架構變更、
  健康度基線漂移（依賴大版本升級、測試數明顯變化）時更新對應章節。
- **更新什麼**：只改事實變更的章節；§3 驗收清單有新 issue 時加行；
  issue 關閉時把狀態改為已關閉（保留行作為紀錄，不要刪除）。
- **last-verified 欄位要一起改**：頂部的日期與 commit SHA 每次更新本文
  件時必須同步刷新為當下值。
- 驗收相關的結構性變更（新增欄位、改變 gate 規則）需 operator 確認。

---

### 驗證備註（brief 誤差，已以實測值為準）

1. 月分佈 261/135/3/1/2 為 author-date 口徑；committer-date 口徑為
   278/118/3/1/2（差異僅一筆跨月 commit `dd3e201`：
   author-date 2026-05-31 / committer-date 2026-06-01）。文件採用
   brief 的 author-date 數字。
2. `posPersistence.ts` 實際路徑為 `frontend/src/store/posPersistence.ts`
   （brief 誤寫為 `src/storage/`），其 TODO 在 L9。
3. `screens.test.tsx` 實際路徑為
   `frontend/src/components/__tests__/screens.test.tsx`（brief 缺
   `frontend/` 前綴），`describe('BackupScreen')` 在 L105（brief 稱 L106）。
4. `ROADMAP.md` 實際路徑為 `docs/superpowers/plans/ROADMAP.md`
  （brief 未給路徑；repo root 無此檔）。
5. plans checkbox：brief 稱「皆為 0 勾選」不精確，實測已勾選共 4 項
   （見 §7 第 5 項），但結論不變——皆非進度追蹤用途。
6. build 耗時實測 457ms（brief 稱 477ms），屬機器差異，其餘基線數字
   （PWA 20 entries / 908.09 KiB、vitest 991/8）完全一致。
...[truncated 7373 chars]