# P13b2b3 執行計畫：備份、報表／列印與查帳更正的同頁命令復原

日期：2026-10-23。基準：`origin/main` `90cd193`（#536 P13b2b2c 合併後）。角色：planner（只寫計畫，不寫產品碼）。

## 0. 依據

- 契約：[`2026-10-21-cloud-command-recovery-contract.md`](../specs/2026-10-21-cloud-command-recovery-contract.md) §3（write-ahead／清理）、§4（10 秒、同頁重試、遲到結果）、§4.1（Lite 獨立查證通道）、§5 末段（P12 匯出／列印與 P14 備份只確認原稽核 receipt）、§6（所有正式頁面涵蓋前不宣稱 P13b2 完成）、§7 末條。
- 後端計畫 P13（[`2026-10-13-free-production-backend-plan.md`](2026-10-13-free-production-backend-plan.md) `### P13`）、P14（備份不推進 S 的條件）。
- 接手點：`docs/DEVELOPMENT-HANDOFF.md`（頂端仍寫 P13b2b2c 待 review，且把 Report／Print 誤標為「P13c／d」）。
- 前例（最近一次通過 review 的同頁復原）：#536 `CloudDayClosePage.tsx`／`cloudDayCloseRepository.ts`，以及 E2E `e2e/p13b2-pending-journal.spec.ts` 的 `P13b2b2c DayClose ...` describe。
- #536 review 遺留 nit：命令正常完成後，畫面仍顯示「本機命令追蹤尚未清理；伺服器回執仍已確認。」（資料正確、訊息誤導）。

## 1. 目標、範圍與排除

**目標**：讓最後三個仍直接走 full SDK `commitCommand`／`readCommand`、沒有 10 秒提示與 Lite 查證的正式頁面，符合復原契約 §4／§4.1／§5；並修掉 #536 的誤導訊息。完成後才可依 §6 宣稱「所有正式 command 頁面已涵蓋」。

**範圍內**

| 批次 | 內容 |
|---|---|
| P13b2b3a | (1) #536 nit：journal 清理結果改為「後置條件」語義，修 DayClose 與 DayVendors 的誤導訊息。(2) 日結頁內嵌 `BackupScreen` 的 `RecordBackup` 同頁復原。 |
| P13b2b3b | `CloudReportPage` 的 `RecordExport`／`RecordPrint` 同頁復原對齊契約。 |
| P13b2b3c | `CloudAccountHistoryPage`（F5 歷史更正：`CorrectTransaction`／`VoidTransaction` 等）同頁復原對齊契約，並做全頁涵蓋稽核表。 |

**排除**

- 不新增 command kind、不改 Firestore Rules、不改 `firestore.indexes.json`、不改 `cloudBackup.ts` 的 manifest／replay 格式。若實作中發現必須改 Rules，停下以 `[BLOCKER]` 回報（附量測）。
- 不改 `CloudPendingRecoveryBoundary`（重啟／接手的 shell gate）行為；它已處理沒有原 intent 的識別。
- 不處理 `AdminScreen.tsx:351` 舊 POS 路徑裡的 `<BackupScreen />`（舊 cloud 寫入路徑清理屬 P13d）；但 `BackupScreen` 新增的 props 必須是 optional，讓該處照常編譯、行為不變。
- 不做 P13c `accessEvents`、P13d 紙本補登。
- 不部署、不碰正式金鑰／App Check。

## 2. 現況（已對照 `90cd193` 原始碼）

### 2.1 #536 nit 的根因

- `cloudCommandRepository.ts` 的 `commitCommand` 成功路徑在確認 receipt 後就自行清 journal（約 `:2153` `pendingJournal.removeIf(...).catch(() => false)`）。
- 頁面隨後在 `settleWithReceipt` 再呼叫 `repository.cleanupConfirmedIntent(...)`（`CloudDayClosePage.tsx:801`、`CloudDayVendorsPage.tsx:654`）。
- `cleanupConfirmedIntent`（`cloudCommandRepository.ts:978`）最後回傳 `pendingJournal.removeIf(...)`；而 `removeIf` 在記錄**已不存在**時回 `false`（`cloudPendingJournal.ts:283` `if (!existing) return false;`），與「owner predicate 失效而保留」同樣是 `false`。
- 頁面把 `false` 一律當成「尚未清理」（`CloudDayClosePage.tsx:813`、`CloudDayVendorsPage.tsx:666`），所以一般成功路徑必定出現誤導訊息。
- `CloudStudentsPage.tsx:722` 對結果 `void`，不顯示訊息，不受影響；Orders 頁走自己的 identity 清理路徑，不受影響（實作時以 grep 再確認一次）。

### 2.2 BackupScreen（`components/screens/BackupScreen.tsx`）

- 由 `CloudDayClosePage.tsx:2092` `{backupBlock ?? <BackupScreen />}` 內嵌；用 `useFirebaseOptional()` 取 `fb`／`access`／`lease`，不吃頁面的 `db`／`identityKey`／`leaseEpoch` props。
- `verifySelected` 在 `:88` 直接 `createCloudCommandRepository(fb.db)` 並 `commitCommand({ kind: 'RecordBackup', ... })`；command ID 存在 `receiptCommandIdRef`（`:90`），失敗後再選一次檔案就會以同 ID 自動重送，**送前沒有先查 receipt**。
- 沒有 Lite recovery reader、沒有 10 秒提示、沒有「唯讀查詢原命令」入口、沒有同 ID 的明確重試按鈕。
- `busy` 期間整個區塊停用，但日結頁的導覽鎖與日結命令按鈕不知道備份有未決命令；切頁會卸載 BackupScreen，結果只能等 shell gate。
- `[access.ok, lease.isHolder, lease.epoch]` 改變時（`:35`）清除全部記憶體狀態（符合 §4「失權清除完整 intent」），journal 保留（由 `commitCommand` write-ahead 寫入）。
- 測試：`components/screens/__tests__/BackupScreen.test.tsx` 只有 2 個 case（mock 掉 command repository）；E2E 沒有任何備份 UI 案例。

### 2.3 CloudReportPage（`components/cloud/CloudReportPage.tsx`）

P12c 已做了一部分同頁保護（`FrozenAction`、模組層 `actionRecoveryRegistry`、owner token、`performedActions` 防重複輸出），但與契約有差距：

- `actions = createCloudReportActionRepository(db)`（`:215`）沒有 recovery reader；查詢走 `actions.readCommand`（`:569`）＝ full SDK `getDocFromServer`，原 commit 回應被扣住時會排在其後（§4.1 的問題）。
- `recoverAction` 在 `operationRef.current` 為真時直接 return（`:564`），所以**原提交 in flight 時不能查詢**；也沒有 10 秒提示。
- 查無 receipt 時同一次點擊就自動以同 ID 重送（`:594` 之後呼叫 `recordAction`），沒有「查詢」與「重試」分開的明確人工步驟。
- 查詢確認 receipt 後只改畫面，**不清 journal**；該識別要等下次 shell recover 才清。
- `rebuildFrozenAction` 對 `RecoveryIdentity` 的重建分支（`:153` 起）在 `recoverAction` 中實際不會被呼叫（兩條 RecoveryIdentity 路徑都先 return），是與 §5「不重建舊報表 H」相衝的死碼。

### 2.4 CloudAccountHistoryPage（F5 歷史更正）

- `orders = createCloudOrderRepository(db)`（`:99`）沒有 recovery reader；`recoverCommand` 以 `orders.readCommand`（`:381`）查詢，查無就同一次點擊自動 `submitFrozenRef.current(candidate)` 重送（`:423`）；同樣在 in flight 時不能查詢、沒有 10 秒提示、確認後不清 journal。
- 這一頁不在 coordinator brief 與剩餘工作盤點內，但它送出正式帳務命令；依契約 §6，未涵蓋前不能宣稱 P13b2 完成，所以列為 P13b2b3c（見 Ruling R6）。

## 3. Rulings

- **R1 批次編號**：Report／Print 歸 P13b2b3b（契約 §5 的 P13b2 範圍），不是 handoff 頂端寫的「P13c／d」；P13c 仍是 `accessEvents`、P13d 仍是紙本補登。第一個實作 PR 更新 handoff 時順手更正。
- **R2 nit 修法＝後置條件**：`cleanupConfirmedIntent` 的 `true` 改定義為「receipt 已確認，且此精確識別目前不在 journal（本次移除或原本就已不存在）」；`false` 只代表「因 owner／mount／lease 不再有效而保留」。實作：`CloudPendingJournal` 新增 `removeIfPresent(record, isCurrent): Promise<'removed' | 'absent' | 'kept'>`（同一鎖內、同樣的同步 predicate 與精確比對），既有 `removeIf` 改為 `(await removeIfPresent(...)) === 'removed'` 的薄包裝，其他呼叫端語義不變。`cleanupConfirmedIntent` 用 `removeIfPresent`，`removed`／`absent` 回 `true`。不在頁面端用「如果是 commit 直接成功就跳過清理」繞過，因為 commit 路徑的清理失敗是被吞掉的，頁面無從得知 journal 是否仍有記錄。不同識別佔用同 key 時維持 throw（現行 `identityMatches` 失敗行為不變）。
- **R3 備份的 intent 與 datasetId**：同頁 frozen intent＝`RecordBackup` 命令輸入（commandId、leaseEpoch、payload）；`datasetId` 用本次 `exportRange` 讀到的 head（`manifest.datasetId`），`uid` 用送出當下的 `access.profile.uid`。新增窄 adapter（建議 `firebase/cloudBackupCommandRepository.ts`，或在 `cloudBackupRepository.ts` 內加一組函式；二擇一由實作者決定，PR 說明理由）暴露 `commitRecordBackupIntent`、`confirmPendingIntent`、`cleanupConfirmedIntent`、`getPendingRecoveryContext`，全部帶 `recoveryReader`。不加新 command kind。
- **R4 同頁確認後的輸出與狀態**：
  - 備份：同一掛載、同一 owner／lease／generation，且檔案重新選取驗證是在這個掛載內完成的，Lite 查證到原 `RecordBackup` receipt 後可顯示 `verifiedLocal`（「已登記 RecordBackup」）；因為驗證步驟已在送出前完成，receipt 只是補上確認。重啟後（沒有 frozen intent）完全交給 shell gate，BackupScreen 不得宣稱任何檔案已驗證，也不推進任何 checkpoint。
  - 報表／列印：同一掛載仍持有 `FrozenAction`（原內容、原 H）時，receipt 確認後可**發起一次**原內容的下載／列印（沿用 `performedActions` 防重），因為稽核 receipt 與實際輸出對應同一份 frozen 內容；`RecoveryIdentity`（重掛載後沒有內容）只確認、不輸出，提示重新查詢後另建新意圖。這是 §4 的同頁路徑，不是 §5 的 minimal recovery。**若 Gate 1 認為 §7 末條應解讀為同頁查證後也不得輸出，改為：查證成功一律只顯示「稽核已確認，本次未輸出，請重新查詢後另行發起」，其餘計畫不變。**
  - 遲到結果：查證先確認後，原提交遲到的成功不得再次輸出或重設狀態；遲到的失敗不得覆蓋已確認結果。
- **R5 固定文案**：10 秒提示沿用契約與其他頁面已用的「結果確認中，勿重新收款」＋原命令編號，不另造備份／報表專用版本，避免 consumers 分歧。
- **R6 F5 查帳更正列入 P13b2b3c**：屬契約 §6 的「所有正式頁面」；放在最後一批，不阻擋 a、b。若 coordinator 要另開編號，只改批次名稱，內容不變。
- **R7 單飛範圍**：日結頁同時只能有一個未決命令操作。BackupScreen 新增 optional props `onRecoveryChange?(active: boolean)` 與 `locked?: boolean`；`CloudDayClosePage` 在備份有未決／未確認命令時鎖住自己的命令按鈕並回報導覽 `recovering`，自己有 recovery 時傳 `locked` 給 BackupScreen。導覽狀態只由 `CloudDayClosePage` 對外回報一次（合併兩個來源），避免兩個 reporter 互相把鎖解掉。
- **R8 查詢與重試分開**：三頁一律「唯讀查詢原命令」與「以同一命令編號重試」兩個按鈕。重試只在：原 attempt 已 settle、最近一次 Lite 查詢**成功回 not-found**、仍為同 owner／dataset／epoch／generation、在線。查詢失敗、maintenance、different-dataset 都不解鎖重試。重試仍走 `commitCommand`（它在 transaction 內也會再查同 ID）。

## 4. 批次與工作

每批 1 PR，從最新 `main` 開 `claude/*` 分支；開 PR 前 rebase 到最新 main；每次 push 更新 `docs/DEVELOPMENT-HANDOFF.md`（完整 SHA、驗證結果、下一步）與 `docs/ops/free-production-evidence.md` 對應小節。

### P13b2b3a：journal 清理後置條件 + BackupScreen RecordBackup 同頁復原

**檔案**

- `frontend/src/firebase/cloudPendingJournal.ts`：介面加 `removeIfPresent`；`removeIf` 改薄包裝。
- `frontend/src/firebase/cloudCommandRepository.ts`：`cleanupConfirmedIntent` 改用 `removeIfPresent`（R2）。`commitCommand` 內部的兩處 `removeIf` 不必改。
- `frontend/src/components/cloud/CloudDayClosePage.tsx`、`CloudDayVendorsPage.tsx`：不必改邏輯（`false` 現在只代表真的保留）；如果實作者要調整文案，兩頁保持一致。
- 新 adapter（R3）＋ `frontend/src/components/screens/BackupScreen.tsx`：
  - `getCloudRecoveryReader(fb.db)` 建 reader，adapter 以 `useMemo` 綁 `fb.db`。
  - operation 物件（仿 DayClose 的 `DayCloseCommandOperation`）：intent、datasetId、uid、leaseEpoch、generation、attempt、attemptSettled、retryAuthorized、receipt、timerId、cleanupWarning。
  - 送出：在 `verifySelected` 驗證成功後建立 operation；同時只允許一個；送出後立即防連按；10 秒後顯示 R5 文案與原 command ID（只是提示）。
  - 「唯讀查詢原命令」：原 attempt 仍 in flight 時也可按；走 Lite `confirmPendingIntent`；`matched` → 進 receipt 階段並 `cleanupConfirmedIntent`；`not-found` 且原 attempt 已 settle → 開放 R8 重試；in flight 時 `not-found` 不得開放重試。
  - 已確認後：顯示 `verifiedLocal`；遲到的原結果忽略（R4）；清理 `false`／失敗時才顯示「本機命令追蹤尚未清理」類警告。
  - LEASE_LOST／UNAUTHORIZED／epoch 變更：清除記憶體 intent 與畫面（沿用 `:35` 的 reset），journal 保留。
  - 新 optional props `onRecoveryChange`、`locked`（R7）。
- `frontend/src/components/cloud/CloudDayClosePage.tsx`：接 R7 的單飛與導覽合併。
- `frontend/e2e/p13b2-pending-journal.spec.ts`：新增 `P13b2b3a` describe（見下）。

**TDD**

RED commit（只放測試，確認因預期行為失敗）：

1. 單元（真 journal、memory adapter）`cloudCommandRepository.recoveryReader.test.ts`：先 `journal.put(A)`、`removeIf(A)` 讓 A 不存在，再 `cleanupConfirmedIntent(A...)` 且 receipt 相符 → 期望 `true`（現況 `false`）。另一 case：predicate 回 false 且 A 存在 → 期望 `false` 且 A 仍在。
2. `cloudPendingJournal.spec.ts`（一般模式，非 Emulator）：`removeIfPresent` 三種結果；不同識別佔 key 時 throw。
3. E2E（真 production app＋Emulator）：正常 CloseDay（不扣回應）完成後，`本機命令追蹤尚未清理` 與 `本機命令追蹤清理未完成` 都不可見，且 `expectMinimalJournal(page, [])`。DayVendors 一般 SaveVendor 成功做同樣斷言。**這是 nit 的真入口 RED**。
4. `BackupScreen.test.tsx`（mock adapter）：
   - 10 秒未回 → 顯示「結果確認中，勿重新收款」與原 ID；不產生新 ID、不自動重送。
   - in flight 時按查詢：Lite `not-found` → 重試按鈕仍停用；原 promise 之後回 `UNKNOWN_RESULT` → 再查 `not-found` → 重試可用，重試使用同一 command ID 與同一 payload。
   - Lite `matched` 先到 → 顯示已登記；原 promise 遲到成功 → 不重設、不重複呼叫 cleanup；遲到失敗 → 不覆蓋。
   - 查詢 `different-dataset`／讀取失敗／maintenance → 不解鎖重試。
   - epoch 變更或 `LEASE_LOST` → 清畫面、不呼叫 cleanup、不重送。
   - 失敗後重新選檔不得在未查詢前直接以同 ID 重送（現況會）。
5. `CloudDayClosePage.test.tsx`：備份 `onRecoveryChange(true)` 時日結命令按鈕停用、導覽回報 `recovering`；日結有 recovery 時 BackupScreen 收到 `locked`。
6. E2E `P13b2b3a`：以 `createHeldCommit` 扣住 RecordBackup commit 回應 > 10 秒；畫面先顯示 R5 文案；按查詢經 Lite 確認原 receipt；Emulator 上該 command 只有 1 筆、`dataHead.seq` 只 +1；釋放原回應後不重複；journal 清空。備份檔用 Playwright download 事件取得後 `setInputFiles` 重新選取（只用合成資料與測試密碼，檔案只放 test output 暫存）。

GREEN commit：實作至上述全綠，且既有 DayClose／DayVendors／Students／Orders 測試不變綠轉紅。

**驗證命令（frontend/）**

```bash
npx vitest run src/firebase/__tests__/cloudCommandRepository.recoveryReader.test.ts src/firebase/__tests__/cloudPendingJournal.spec.ts \
  src/components/screens/__tests__/BackupScreen.test.tsx src/components/cloud/CloudDayClosePage.test.tsx src/components/cloud/CloudDayVendorsPage.test.tsx
npx vitest run                                   # 全量一般模式
npm run test:cloud-backup                         # 備份 Emulator 迴歸（沒有新 kind，但 BackupScreen 與 RecordBackup 路徑被動到）
npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test --config playwright.p13b2.config.ts"
npm run lint && npm run build
npx tsc -b   # 比對 base／candidate diagnostics（目前 208 inherited），不得新增
```

完整 emulator Vitest 若跑，依序 `--maxWorkers=1`。Chromium 若本機無 pinned 版本，照 handoff 慣例以 CI e2e job 為準並如實註明。

**驗收**：nit 不再出現於正常路徑；清理真的失敗時警告仍出現（既有 `清理未完成` 測試維持綠）；RecordBackup 在扣住回應時可經 Lite 確認、一個 effect、零並行重送；重試只在 R8 條件下；Rules 未變更（PR 註明「未改 Rules，無需量測」）。

### P13b2b3b：CloudReportPage RecordExport／RecordPrint 同頁復原

**檔案**

- `frontend/src/firebase/cloudReportActionRepository.ts`：options 加 `recoveryReader`；新增 `confirmPendingIntent`、`cleanupConfirmedIntent`、`getPendingRecoveryContext`（把 `RecordCloudExportInput`／`RecordCloudPrintInput` 轉成與 `recordExport`／`recordPrint` 相同的命令輸入後交給 command repository；抽一個共用的 `toCommandInput` 確保兩邊一致）。
- `frontend/src/components/cloud/CloudReportPage.tsx`：
  - `getCloudRecoveryReader(db)` 傳給 action repository。
  - frozen action 增加 datasetId（取自 `snapshot.report.datasetId`）、uid（送出當下 Auth uid）、attempt／settled／timer／retryAuthorized。
  - 10 秒提示（R5）；in flight 時允許查詢（移除 `:564` 對 in-flight 的整體擋）；查詢走 Lite `confirmPendingIntent`。
  - 查詢與重試分開（R8），刪除 `:594` 的自動重送。
  - receipt 確認後 `cleanupConfirmedIntent`；FrozenAction 依 R4 發起一次原內容輸出；RecoveryIdentity 只確認不輸出（維持現有文案）。
  - 刪除 `rebuildFrozenAction` 對 RecoveryIdentity 的重建分支（§5 不重建舊 H）。
  - 遲到結果規則同 R4。
- `frontend/src/components/cloud/CloudReportPage.test.tsx`：既有 `retries an unknown export with the same command and frozen input` 會因 R8 改變行為，需改寫為「查詢 not-found 後明確按重試」；改寫時在 PR 說明這是契約要求的行為變更，不是放寬測試。
- E2E：`p13b2-pending-journal.spec.ts` 新增 `P13b2b3b` describe（共用 p13b2 config 的 webServer）；或若 report fixture 只在 `cloud-report-history.spec.ts` 可得，則在該檔加案例並跑 `playwright.p12c.config.ts`，PR 註明選擇。

**TDD**

RED：

1. 頁面單元（mock action repository）：
   - 原 RecordExport in flight 時「唯讀查詢」可按並呼叫 `confirmPendingIntent`（現況被擋）；`not-found` 時不重送、重試停用。
   - 10 秒提示與原 ID。
   - `UNKNOWN_RESULT` 後查 `not-found` → 不自動重送（現況會）；按重試 → 同 ID、同 frozen input。
   - 查詢 `matched` → 呼叫 `cleanupConfirmedIntent` 一次；FrozenAction 輸出一次；遲到原成功不再輸出。
   - RecoveryIdentity `matched` → 不輸出、清 journal。
   - `different-dataset`／讀取錯誤／maintenance → 不解鎖重試。
2. E2E：扣住 RecordExport 回應 > 10 秒 → Lite 查證到 receipt → 下載事件恰好 1 次（或依 R4 備案為 0 次）→ Emulator 該 command 1 筆 → 釋放回應後不再下載 → journal 清空。另一案例：RecordPrint 同樣流程，`window.print` 以 page script stub 計數。

GREEN：實作至全綠；既有 P12c 單元與 `cloud-report-history.spec.ts` 不得退步。

**驗證命令**

```bash
npx vitest run src/components/cloud/CloudReportPage.test.tsx
# cloudReportActions.spec.ts 是 Emulator-gated，由下一行 npm script 執行
npx vitest run
npm run test:cloud-report-actions
npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test --config playwright.p13b2.config.ts && npx playwright test --config playwright.p12c.config.ts"
npm run lint && npm run build && npx tsc -b
```

**驗收**：契約 §4／§4.1 對報表頁成立；§7 末條「重掛載後只確認稽核、不輸出、新輸出須重新讀取建立新意圖」維持；Rules 未變更。

### P13b2b3c：CloudAccountHistoryPage 歷史更正同頁復原 + 全頁涵蓋稽核

**檔案**

- `frontend/src/firebase/cloudOrderRepository.ts`：若尚無 intent 版查證，新增 `confirmPendingIntent`／`cleanupConfirmedIntent`（mutation input 版，帶 `recoveryReader`）；不改既有 Orders 頁使用的 identity 版 API。
- `frontend/src/components/cloud/CloudAccountHistoryPage.tsx`：同 P13b2b3b 的模式：Lite reader、10 秒提示、in-flight 可查、查詢與重試分開、確認後清 journal 並重讀完整帳戶歷史（重讀完成前持續鎖住依賴新資料的控制，§4.1 末段）、遲到結果不覆蓋。
- 對應單元測試與 E2E（扣住 `CorrectTransaction` 回應的案例）。
- 文件：在 evidence 新增「P13b2 正式頁面涵蓋表」，逐一列出 cloud shell 每個送命令的頁面（Orders、Students、DayVendors、DayClose、Backup、Reports、AccountHistory）與其對應 PR／E2E 名稱；以 `grep -rn "commitCommand\|mutateTransaction\|recordExport\|recordPrint" frontend/src/components/cloud frontend/src/components/screens/BackupScreen.tsx` 的結果佐證沒有遺漏。只有這張表完整、且三批都已合併時，契約 §6 狀態與 handoff 才可改寫為「P13b2 正式頁面已全部涵蓋」；不得因此宣稱 P13 完成（P13c、P13d 仍在）。

**TDD**：RED 以頁面單元＋E2E 證明 in-flight 查詢、無自動重送、確認後清 journal；GREEN 實作。

**驗證命令**

```bash
npx vitest run src/components/cloud/CloudAccountHistoryPage.test.tsx
# cloudOrderRepository.spec.ts 是 Emulator-gated；依其 describe 的環境變數在 emulators:exec 下以 --maxWorkers=1 執行
npx vitest run
npx firebase emulators:exec --project demo-easyorder --only auth,firestore "npx playwright test --config playwright.p13b2.config.ts && npx playwright test --config playwright.p12c.config.ts"
npm run lint && npm run build && npx tsc -b
```

## 5. 風險與回歸防護

- **`removeIf` 語義**：只新增 `removeIfPresent`，`removeIf` 對外仍回 boolean 且值不變；`CloudPendingRecoveryBoundary` 與 `commitCommand` 不受影響。單元測試鎖住三態。
- **把 absent 當成功的安全性**：只在 receipt 已由鎖外 Lite 查證相符之後才會走到；absent 代表本機已不追蹤此 ID，不代表任何業務判斷，與契約 §3「取得匹配 receipt 後才可移除」一致。
- **備份 E2E 的檔案**：只用合成資料、測試密碼；下載檔只放 Playwright test output，不提交、不寫進 evidence。
- **導覽鎖競爭（R7）**：只讓 `CloudDayClosePage` 回報；測試要涵蓋「備份 recovering、日結 resolved」不得解鎖。
- **列印的使用者啟動**：查證後呼叫 `window.print()` 已是 P12c 既有行為；若瀏覽器阻擋，沿用既有「瀏覽器無法啟動列印」路徑。
- **行為變更的既有測試**：P13b2b3b 會改寫一個 P12c 單元測試（自動重送→明確重試）；PR 須逐條列出被改的斷言與契約依據。
- **Rules**：三批都不改 Rules；若 diff 出現 `firestore.rules`，reviewer 應直接退回。

## 6. 每批 PR 必附

- base／head 完整 SHA、RED 與 GREEN 各自的 SHA。
- 上列命令的實際結果（passed／skipped／failed 數）；未跑的項目標「未執行」與原因。
- 「未改 Rules／indexes、沒有新 command kind，所以不需 Rules 量測與 P14 export/replay 擴充」的明示句。
- 沒有 production App Check、部署或營運驗收。
