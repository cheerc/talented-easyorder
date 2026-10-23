# P13c／P13d 執行計畫：使用權交接紀錄、紙本補登與舊雲端路徑清理

日期：2026-10-23。基準：`origin/main` `b879dd257efcb2353b108a4785d37f6940d37221`（#539 合併後，P13b2 正式頁面已全部涵蓋）。角色：planner（只寫計畫，不寫產品碼）。

## 0. 依據

- 後端計畫 `### P13`（[`2026-10-13-free-production-backend-plan.md`](2026-10-13-free-production-backend-plan.md)）：Scope 含「F2 紙本補登入口、舊 cloud write 路徑清理」；Acceptance「歷史補登要理由與紙本號，未重開不得補；cloud 看不到 reset／restoreDataset／seed／模擬平板」。
- 操作回饋計畫 [`2026-10-15-operator-feedback-plan.md`](2026-10-15-operator-feedback-plan.md) §3 第 2 點與 §6 P13 列：`accessEvents` 隨 lease acquire／release 原子寫入，續約不記；Q8 已定案要做。
- 正式後端規格 [`2026-10-13-free-production-backend-spec.md`](../specs/2026-10-13-free-production-backend-spec.md) §4.2（租約狀態機）、§5（儲存模型表）、§7 line 190（F2 歷史補登標記理由）、§8 line 206（斷線改紙本流水號，恢復後補登並寫紙本號）。
- 復原契約 [`2026-10-21-cloud-command-recovery-contract.md`](../specs/2026-10-21-cloud-command-recovery-contract.md) §5（未確定命令以紙本編號人工核對，必要補登依 P13d）。
- P11c 決定（專案記憶）：已關帳日只能補記一般收支（`RecordPostCloseEntry`），學生訂餐／繳費不可動；回填（`StartBackfill`）只限 `lastSettlementRevision == 0` 的過去日。
- 剩餘工作盤點 `/mnt/project-files/notes/P13後剩餘工作.md`。
- Coordinator 交辦的兩項 fold-in（放進第一個 PR，見 §4 P13c1）。

## 1. 現況（已對照 `b879dd2`）

### 1.1 P13c 的現況

- `system/accessLease` 只存目前狀態（`holderUid`、`epoch`、`updatedAt`），沒有歷史（spec §4.2、`firestore.rules` `match /system/accessLease`，約 line 2174）。
- 三個轉換都在 `frontend/src/firebase/activeAccountLease.ts` 各自一個 `runTransaction`：`acquireLease`（約 `:199`，`epoch+1`、holder＝本人）、`renewLease`（約 `:241`，epoch 不變）、`releaseLease`（約 `:289`，holder＝null、`epoch+1`）。acquire 的 transaction 內已讀到舊 `holderUid`，可直接知道是「空租約取得」還是「接手逾時租約」。
- 本機錯誤紀錄匯出**已由 P13b1 完成**（spec line 208、`CloudDiagnosticsPage`）。操作回饋計畫 P13 列的第二項不必再做；P13c 只剩 `accessEvents`。
- Rules 測試：`frontend/src/firebase/__tests__/activeAccountLease.spec.ts`（`EASYORDER_REQUIRE_ACTIVE_ACCOUNT_LEASE_PROOF`）、`firestoreRules.spec.ts`、`cloudRulesProof.spec.ts`；單元 `activeAccountLease.unit.test.ts`。

### 1.2 P13d 的現況

- 過去日寫入的唯一入口是 P11c2 回填模式：`StartBackfill` 建 `backfillDays/{dayId}`（含 day 層級理由），`validTransactionDay`（`firestore.rules` 約 line 96–100）放行「今天，或 `lastSettlementRevision == 0` 且有標記」的日子；適用 `CreateOrder`／`CreatePayment`／`CreateCashMovement`（Refund／Undo／CancelRefund 排除）。
- **每筆**補登沒有紙本號欄位：`CreateOrder`／`CreatePayment` 只有選填 `note`；`CreateCashMovement` 的 `reason` 寫進交易 `note`（Rules 約 line 1028）。spec 要求「歷史補登要理由與紙本號」目前只滿足 day 層級理由。
- 已關帳日：重開後 `lastSettlementRevision > 0`，`StartBackfill` 被拒，所以學生訂餐／繳費不能補（符合 P11c 決定）；一般收支走 `RecordPostCloseEntry`。這就是「未重開不得補」在現行模型下的意義：只有「從未關帳、明確開啟回填」的過去日可以補，P13d 不改這條邊界。
- 雲端 shell 只渲染 `CloudSections`（`App.tsx` `CloudAppContent` → `CloudPendingRecoveryBoundary` → `CloudSections`）；`AppRouter`／`AdminScreen`／`PracticeDataPanel`（reset、restoreDataset、seed、模擬日、模擬平板）只在 prototype 的 `AppContent` 出現。也就是說「cloud 看不到 reset／seed／模擬平板」在畫面層已大致成立，但：
  - 舊的雲端模組仍在 bundle 中：`firebase/studentRepository.ts`（`addStudent`／`disableStudent` 只 throw「業務功能暫未開放」，仍被 `store/posActions/firebaseActions.ts` → `store/posStore.ts:31` 接進 store）、`firebase/settlementRepository.ts`（`writeOfflineCloseAttempt`）、`firebase/ledgerRepository.ts`、`firebase/realtimeSubscriptions.ts`、`firebase/syncStatus.ts`（被 `domain/index.ts` re-export）。實作前要逐一以 grep 確認是否還有 production import。
  - 沒有任何測試鎖住「cloud 模式畫面不存在 reset／restoreDataset／seed／模擬平板入口」。

### 1.3 Fold-in 的現況

- (a) `docs/ops/free-production-evidence.md` 的 `### P13b2b3c account history correction same-page recovery 2026-10-23` 小節寫「the correction controls and the navigation state (`recovering`) stay locked until the fresh heads load or a load error shows」；coordinator 審查確認程式在載入錯誤後仍維持 `recovering`，要等手動重新讀取成功才解鎖（`CloudAccountHistoryPage.tsx` 的 `notify(operation, ...)`，約 `:443` 起）。只改文件措辭，實作者先讀程式確認後再改。
- (b) Emulator 迴圈測試超過 Vitest 預設 5 秒：`frontend/src/firebase/__tests__/cloudReadRepository.spec.ts:679` 起的 `keeps short null-date queries bounded ...`（101 次依序 `recordExport`，main 上約 5.5 秒）、`frontend/src/firebase/__tests__/cloudCashMovement.spec.ts:398` 的 `P09.5`（main CI run 39884104247 逾時）。`vitest.config.ts` 沒有全域 `testTimeout`；repo 慣例是在該 `it` 第三個參數給明確逾時（例如 `cloudReadRepository.spec.ts:297` 的 `30_000`、`cloudBackup.spec.ts:82` 的 `60_000`）。

## 2. 範圍與排除

**範圍內**：P13c1、P13c2、P13d1、P13d2、P13d3（§4），以及 §1.3 的兩項 fold-in。

**排除**

- 不新增 command kind（`accessEvents` 不是業務 command，不進 `commands`／`dataHead.seq` 鏈）。
- 不放寬任何既有 Rules；不改回填邊界（已關帳日仍不能補學生交易）；不加 ReopenDay 權限分級（P11c 決定「之後再做」）。
- 不做 P15 復原 CLI；只把 P15 需要知道的約束寫進 spec（見 R3）。
- 不部署、不碰正式金鑰／App Check。

## 3. Rulings 與待決事項

- **R1 事件文件 ID＝新 epoch**：`accessEvents/{eventId}` 的 `eventId == string(新 lease epoch)`。acquire 與 release 都讓 epoch 加一，所以每個 epoch 恰好一筆事件、ID 單調不重複；renew 不改 epoch，Rules 自然不需要也不允許事件。
- **R2 原子性由 Rules 雙向綁定**：
  - lease update：凡 `request.resource.data.epoch != resource.data.epoch`（acquire、release），必須 `existsAfter(/accessEvents/$(string(request.resource.data.epoch)))`；renew 分支不變。
  - accessEvents create：`get(lease)` 為寫入前、`getAfter(lease)` 為寫入後；要求 `after.epoch == before.epoch + 1`、`eventId == string(after.epoch)`、`holderUid == after.holderUid`、`previousHolderUid == before.holderUid`、`actorUid == request.auth.uid`、`actorEmail == request.auth.token.email`、`at == request.time`、`kind` 由前後狀態決定：`after.holderUid == null` → `release`；`before.holderUid == null` → `acquire`；其餘 → `takeover`（含同一 UID 在自己逾時後重新取得）。欄位以 `exactMap` 鎖死。
  - `update`、`delete` 一律拒絕；`get`／`list` 只給 `approvedOperator()`（與 lease 的 get 相同層級；事件不含帳務或學生資料）。
  - 原持有者被接手時不另寫（原分頁已無權限；新持有者的 `takeover` 事件已含 `previousHolderUid`）。
- **R3 epoch 不可倒退**：spec §4.2 說維護復原「只建立空租約」，原本是 `epoch=0`。若在同一個專案重建空租約而 `accessEvents` 還在，下一次 acquire 會撞到既有 `accessEvents/1`，Rules 拒絕，就沒有人能取得使用權（fail closed，不會資料錯）。P13c1 在 spec §4.2／§9 寫明：維護流程建立空租約時，`epoch` 必須 ≥ 既有 `accessEvents` 的最大 ID；P15 的 runbook 照這條實作。P13c1 不改維護工具。
- **R4 不進備份鏈**：`accessEvents` 不是 command，不進 P14 manifest；P14 export/replay 不必擴充。spec §9 註明它屬「營運稽核史」，P15 是否另外匯出由 P15 決定。P13c1 仍要跑 `npm run test:cloud-backup` 作迴歸（lease Rules 改了，備份測試會 acquire）。
- **R5 顯示位置**：P13c2 在雲端報表頁（F2）的稽核區新增唯讀「使用權交接」表，依所選日期區間的 `at` 範圍查詢、分頁有界、顯示 email 不顯示 UID（操作回饋計畫 §3 第 1 點）。不做 CSV 匯出，不建 `RecordExport`。如果 coordinator 認為不必顯示，P13c2 可整批取消，不影響 P13c1 的驗收。
- **R6 舊雲端模組**：P13d3 刪除沒有 production import 的舊雲端模組，並把 `firebaseActions` 從 store 拔掉（prototype 的 store 不需要這兩個 throw stub；若有 prototype 呼叫點，改由 prototype 本機 action 處理或移除按鈕，實作者以 grep 決定並在 PR 列出）。另加 E2E 守門測試。這是結構清理加守門測試：守門測試可能一開始就是綠的，PR 要如實寫「guard，非 RED」；刪除本身靠既有測試維持綠。
- **Q1 已定案（CheerC 2026-10-23 選 A）**：每筆補登的紙本號採新增選填欄位 `paperRef`；量測若觸發下列門檻，自動改用備案 B 並在 PR 記錄數字。
  - **建議 A：新增選填 payload 欄位 `paperRef`**，套用在 `CreateOrder`、`CreatePayment`、`CreateCashMovement`，寫入交易文件同名欄位；格式 1–20 字元，限英數與 `-`（例如 `A-0123`）。Rules：回填路徑（過去日）必填，今天選填（同日斷線恢復也可以填）。報表、CSV、F5 稽核都能直接顯示。代價：三個 kind 的 exactMap 各多一個分支，Rules expression 增加，回填 `CreateOrder` 交易 create 目前是最薄錨點（+16，P11c3 量測），必須量測；P14 備份 decoder 的 optional 欄位清單要擴充並跑 `test:cloud-backup`。
  - 備案 B：不加欄位，Rules 在回填路徑要求 `note`（現金收支是 `reason`）以固定前綴開頭，例如 `紙本A-0123：`。expression 較少，但顯示要靠解析文字。
  - Planner 的建議是 A；若量測後最薄錨點會低於 +5，或下降超過 3，自動改用 B（沿用 P11c2 當時的同一條門檻），並在 PR 記錄量測數字。

## 4. 批次（1 批＝1 PR，依序）

每批：從最新 `main` 開 `claude/*` 分支，開 PR 前 rebase 到最新 main；每次 push 更新 `docs/DEVELOPMENT-HANDOFF.md`（完整 SHA、驗證、下一步）與 `docs/ops/free-production-evidence.md` 對應小節；改 Rules 的批次前後都量測並寫進 PR 與 `docs/ops/p05-rules-budget.md` 新附錄（工具：`/mnt/project-files/tools/rules-probe/`，lease 與 accessEvents 是新 `allow`，需新增 anchor）。

### P13c1：`accessEvents` Rules、寫入器與規格（含兩項 fold-in）

**檔案**

- `firestore.rules`：`match /system/accessLease` 的 update 加 R2 的 `existsAfter` 條件；新增 `match /accessEvents/{eventId}`。
- `frontend/src/firebase/activeAccountLease.ts`：`acquireLease`、`releaseLease` 在同一個 `runTransaction` 內 `tx.set(doc(db, 'accessEvents', String(newEpoch)), {...})`，欄位依 R2，`at: serverTimestamp()`；`renewLease` 不變。`kind` 由 transaction 內讀到的舊 `holderUid` 決定。`confirmCommittedLease`／release 回讀照舊。新增 `accessEventPath` 到 `firestorePaths.ts`、型別到 `firestoreSchema.ts`。
- `docs/superpowers/specs/2026-10-13-free-production-backend-spec.md`：§4.2 補事件狀態機與 R3；§5 儲存表加 `accessEvents/{epoch}`；§9 補 R4。
- `docs/ops/p05-rules-budget.md`：新增 P13c1 附錄（lease update、accessEvents create 兩個新 anchor 的 +N，main 與分支同案例）。
- Fold-in (a)：`docs/ops/free-production-evidence.md` P13b2b3c 小節改成與程式一致（讀完 `CloudAccountHistoryPage.tsx` 後，寫成「重新讀取完整資料成功前一直鎖住；顯示載入錯誤時仍維持 `recovering`，需手動重新讀取成功才解鎖」或程式實際行為）。
- Fold-in (b)：`cloudReadRepository.spec.ts:679` 的 `it(...)` 與 `cloudCashMovement.spec.ts:398` 的 `it('P09.5 ...')` 加第三個參數明確逾時（建議 `60_000`，與 repo 既有 Emulator 長測試一致）；不 skip、不減少迴圈次數。實作時順手在這兩個 spec 搜尋其他同樣型態的長迴圈，若本機量到接近 5 秒也一併加上，PR 列出清單。

**TDD**

RED（只放測試）：

1. `activeAccountLease.spec.ts`（Emulator，真 Rules）：
   - 空租約 acquire → 恰好一筆 `accessEvents/1`，`kind: 'acquire'`、`previousHolderUid: null`、`holderUid: A`、`actorEmail` 為 A。
   - A 逾時後 B acquire → `accessEvents/{n}` 為 `takeover`、`previousHolderUid: A`。
   - A release → `release`、`holderUid: null`。
   - renew 十次 → 事件數不變。
   - Rules 拒絕：lease 變 epoch 卻沒寫事件；事件單獨寫（沒有 lease 轉換）；`eventId` 不等於新 epoch；`kind` 與前後狀態不符；偽造 `actorUid`／`actorEmail`／`at`；事件 update／delete；未核准者 get／list；renew 時夾帶事件。
   - 舊 epoch 的事件已存在時 acquire 被拒（R3 的 fail-closed 行為，證明不會覆蓋歷史）。
2. `activeAccountLease.unit.test.ts`：acquire／release 的 transaction 在同一個 tx 內 set 事件；renew 不 set。
3. Fold-in (b) 不需要 RED（只是補逾時）；PR 附本機兩個測試的實際耗時。

GREEN：Rules＋寫入器。

**驗證命令（frontend/）**

```bash
npx vitest run src/firebase/__tests__/activeAccountLease.unit.test.ts
EASYORDER_REQUIRE_ACTIVE_ACCOUNT_LEASE_PROOF=true npx firebase emulators:exec --project demo-easyorder --config ../firebase.json --only firestore \
  "EASYORDER_REQUIRE_ACTIVE_ACCOUNT_LEASE_PROOF=true npx vitest run src/firebase/__tests__/activeAccountLease.spec.ts --maxWorkers=1"
# firestoreRules.spec.ts、cloudRulesProof.spec.ts、cloudReadRepository.spec.ts、cloudCashMovement.spec.ts：依各檔 describe 的 EASYORDER_REQUIRE_* 旗標同樣在 emulators:exec 下 --maxWorkers=1 執行
npm run test:cloud-backup
npm run test:cloud-reports
npx vitest run
npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test"   # cloud-production 會 acquire／release
npm run lint && npm run build && npx tsc -b   # app TSC 與 base 比對（目前 208 inherited），不得新增
```

**驗收**：交接一次產生恰好一筆對應紀錄，續約不產生；lease 轉換與事件不可分開成立；Rules 量測入 PR；兩個逾時測試在 CI 不再以預設 5 秒失敗。

### P13c2：報表頁唯讀「使用權交接」表（可依 R5 取消）

**檔案**：`frontend/src/firebase/cloudReadRepository.ts`（新增有界查詢 `readAccessEvents({ range, leaseEpoch })`，`at` 依台北日期換算的半開區間，`orderBy('at')`，分頁上限與既有報表讀取一致；讀前讀後檢查 lease，與其他 read 相同的 fail-closed 規則）、`CloudReportPage.tsx`（稽核區下方的表：時間、種類中文、操作人 email、前一位 email 或「無」）、對應測試。若需要複合索引，更新 `firestore.indexes.json`（單欄位範圍查詢預期不需要；實作時以 Emulator 與 `firebase.json` 設定確認並寫入 PR）。

**TDD**：RED 為 `cloudReadRepository.spec.ts` 的 Emulator 案例（區間內外的事件、分頁截斷時 fail closed、失去 lease 時拒絕）與頁面單元測試（表格只在報表與稽核快照一致後顯示、email 而非 UID）；GREEN 實作。

**驗證**：`npm run test:cloud-reports`、`npx vitest run src/components/cloud/CloudReportPage.test.tsx`、全量 `npx vitest run`、P12c E2E config、lint／build／tsc。

### P13d1：每筆補登紙本號（後端；Q1 已定案 A）

以下以 A 描述；若量測觸發門檻改採 B，只把「新欄位」換成「`note`／`reason` 前綴」，測試案例相同。

**檔案**：`frontend/src/domain/cloudCommandSchema.ts`（三個 kind 的 payload 加選填 `paperRef`，正規化與格式檢查）、`frontend/src/firebase/cloudCommandRepository.ts`（交易文件寫入 `paperRef`）、`firestore.rules`（`validTransactionPayload`／`validCashMovementPayload` 與交易文件 exactMap；回填路徑必填）、`frontend/src/firebase/cloudBackup.ts`（`payloadFieldsByKind` 三個 kind 的 optional 加 `paperRef`；replay 驗證回填交易帶 `paperRef`；舊備份沒有欄位照常通過）、`docs/ops/p05-rules-budget.md` 附錄、spec §6.1 command 表與 §7 line 190 附近。

**TDD**：RED：Emulator Rules 測試（回填日缺 `paperRef` 被拒、格式錯誤被拒、今天可不填、今天填了也接受、`paperRef` 寫入交易文件且不可再改）、`cloudBackup.spec.ts`（新欄位可 export/replay，舊格式備份照常）、schema 單元測試。GREEN 實作。

**驗證**：相關 Emulator spec（`cloudOrderRepository.spec.ts`、`cloudCashMovement.spec.ts`、`firestoreRules.spec.ts`）依序 `--maxWorkers=1`、`npm run test:cloud-backup`、全量 `npx vitest run`、lint／build／tsc；Rules 前後量測，特別是回填 `CreateOrder` 交易 create（目前 +16）。

### P13d2：紙本補登 UI（依 P13d1）

**檔案**：`frontend/src/components/cloud/CloudOrdersPage.tsx` 的回填模式（訂餐、繳費、櫃台收支表單加「紙本號」欄位，回填日必填、今天選填；確認框顯示紙本號；送出沿用 P13b2b1 的同頁復原流程）、報表與 F5 稽核顯示 `paperRef`（`CloudReportPage.tsx`、`CloudAccountHistoryPage.tsx`、`domain/cloudLedgerExport.ts` 的 CSV 欄位加在最後一欄以免破壞既有欄位順序）、對應單元測試、E2E（回填日沒填紙本號無法送出；填了之後報表、CSV、F5 都看得到；今天不填也能送）。

**驗證**：相關頁面單元測試、全量 Vitest、`playwright.p13b2.config.ts` 與 `playwright.p12c.config.ts`、lint／build／tsc。另附一份給 CheerC 的本機驗收步驟（`npm run dev` 連 Emulator 的操作順序），放在 PR body。

### P13d3：舊雲端寫入路徑清理與 cloud 畫面守門（不依賴 Q1，可與 P13c2 對調順序）

**檔案**：刪除 §1.2 列出、經 grep 確認沒有 production import 的舊模組與其測試；`store/posStore.ts` 移除 `createFirebaseActions()`；`domain/index.ts` 移除對 `syncStatus` 的 re-export（若仍有使用者則保留並說明）；E2E 在 `cloud-production.spec.ts` 加守門：登入取得使用權後逐一走訪每個雲端分頁，斷言沒有「重置系統數據」「載入範例資料」「還原練習資料」「模擬日期」「模擬平板」等入口文字或按鈕（文字清單以 `PracticeDataPanel.tsx`、`AdminScreen.tsx` 的實際字串為準）；`docs/FRONTEND-PROTOTYPE-HANDOFF.md` 或對應文件若提到被刪模組就同步更新。

**TDD**：結構清理，不要求人工 RED；守門 E2E 如實標示 guard。既有測試必須全綠；`npx tsc -b` 不得新增 diagnostics（刪檔可能讓 inherited 數字減少，PR 記錄前後數字）。

**驗證**：全量 `npx vitest run`、`npm run test:e2e`（或至少 cloud 預設 config 與 prototype config）、lint／build／tsc。

## 5. 風險與回歸防護

- **租約是登入入口**：P13c1 的 Rules 錯一點就沒人能取得使用權。RED 必須涵蓋空租約、逾時接手、釋放三條成功路徑；CI 的 cloud E2E（每次都 acquire）是最後防線。部署時 Rules 與前端必須同時上：舊前端不寫事件，新 Rules 會拒絕它的 acquire；新前端搭舊 Rules，事件 create 會被預設拒絕。handoff 的部署段落要寫清楚。
- **Rules 上限**：lease 與 accessEvents 是獨立的 `match`，不和 commands 共享評估；仍需量測並寫附錄。P13d1 動到 commands 路徑，是本計畫裡風險最高的 Rules 變更，照 Q1 的自動備案門檻處理。
- **epoch 倒退**：R3 寫進 spec；P15 實作時要遵守。
- **備份相容**：P13d1 的新選填欄位要讓舊備份照常通過，replay 只對新資料要求欄位。
- **刪除舊模組**：只刪 grep 確認沒有 production import 的檔案；prototype 模式的功能不得受影響（prototype E2E 必須照跑）。

## 6. 每批 PR 必附

- base／head 完整 SHA，RED 與 GREEN 各自的 SHA。
- 實際執行的命令與結果（passed／skipped／failed 數）；沒跑的項目標「未執行」並寫原因。
- 有改 Rules 的批次：前後量測數字；沒改 Rules 的批次明寫「未改 Rules／indexes」。
- 有新 payload 欄位的批次：`test:cloud-backup` 結果；沒有的批次寫明「沒有新 command kind 或 payload 欄位」。
- 沒有 production App Check、部署或營運驗收。
