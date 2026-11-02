# Issue #587 執行計畫：監聽資料序號，自動反映其他裝置寫入

- Issue：#587。產品決策：CheerC 2026-11-02 cmsg_01NL2RLuU7UMaNjFmadMsJ3uHWwkyjStdt7Rr2TtgKJxhg（提出需求）、決策卡選「現在另開 issue」（cmsg_01NL2RLuU7UMaNjFmadMsJ3uMF8y6UjM3GqADzmGDS5yFJ）。
- 順序：#585 → #586（P1、P2）→ 本 issue。不改 Rules、不新增 command kind、不碰 P14 備份 → 單一 Reviewer；`test:cloud-backup` 與 Rules 量測 N/A（PR 註明理由）。
- 兩個 PR：P1（監聽＋櫃台頁自動更新），P2（其他雲端頁「資料已更新」提示）。

## 1. 目標與排除

- 目標：同帳號另一分頁／電腦送出命令後，閒置的櫃台頁數秒內顯示新資料，不清操作員正在輸入的內容；其他雲端頁出現提示並可一鍵重新載入。
- 排除：刷臉裝置交接事件佇列（faceorder 第二階段另案設計，屆時可沿用本監聽）；Rules；自動重新載入表單頁（會丟掉輸入）。

## 2. Rulings

- **R1 只監聽 `system/dataHead` 一份文件。** 每個命令都會更新它的 `seq`／`lastCommandId`（spec §5「正常 command 只更新 seq/lastCommandId/updatedAt」），成本每命令 1 讀；不監聽集合。
- **R2 監聽只在已確認持有（`lease.isKnown && lease.isHolder`）時存在**，失去持有立即 unsubscribe；監聽錯誤（Rules 拒絕）只把值設為 `null`，不另做遮罩（遮罩由租約流程負責）。
- **R3 櫃台頁閒置才自動更新**：閒置＝沒有進行中命令（`operationRef.current`）、沒有 recovery、`!loading`、沒有選學生（`selectedStudentId===null`）、`!cashOpen`、`!confirmDuplicateOpen`、`!paymentDetailsOpen`、`!refundConfirmOpen`、`edit===null`。不閒置時記住，回到閒置才更新。
- **R4 背景更新不先清空畫面**（不同於 `refreshAfterCommand` 先把 snapshot 設 null）：舊快照保留到新快照到手再替換。這段時間若操作員剛好送出，命令的 revision／head 檢查會拒絕並走既有重讀流程，不會重複入帳。
- **R5 只有恰好前進 1 個 seq 時用增量補讀**（沿用 P16f2 S4 `refreshSnapshot`，需要該命令的 `targets`，從 `commands/{lastCommandId}` 讀）；其他情況整頁 `loadSnapshot({ reuseBackfillDays: true })`。
- **R6 其他頁只提示不自動載入**，避免丟掉表單輸入。文案：「其他裝置已更新資料。」＋按鈕「重新載入」。

## 3. P1：監聽與櫃台頁

### 3.1 新檔 `frontend/src/firebase/dataHeadWatch.ts`

```ts
export interface DataHeadSignal { seq: number; lastCommandId: string | null; datasetId: string }
export function subscribeDataHead(db: Firestore, onUpdate: (head: DataHeadSignal | null) => void): () => void
```
- `onSnapshot(doc(db, dataHeadPath()), { includeMetadataChanges: true }, ...)`；`fromCache || hasPendingWrites` 略過（同 `activeAccountLease.ts:391`）。
- 只驗這三個欄位：`seq` 為非負安全整數、`lastCommandId` 為 `null` 或字串、`datasetId` 為非空字串；不符或文件不存在 → `onUpdate(null)`。錯誤 callback → `onUpdate(null)`。
- 單元測試 `frontend/src/firebase/__tests__/dataHeadWatch.test.ts`（mock `firebase/firestore`）：cache／pending 不送、合法送值、壞資料送 null。

### 3.2 `frontend/src/providers/FirebaseProvider.tsx`

- `FirebaseContextValue` 加 `dataHead: DataHeadSignal | null`。
- 新 effect：`if (!fb?.db || !currentUid || !lease.isKnown || !lease.isHolder) { setDataHead(null); return; }` 否則 `subscribeDataHead(fb.db, setDataHead)`，cleanup unsubscribe＋`setDataHead(null)`。deps `[fb?.db, currentUid, lease.isKnown, lease.isHolder, lease.epoch]`。
- 所有手寫 `FirebaseContextValue` 的測試替身（`grep -rn "acquireLease:" src --include=*.test.tsx` 與 `src/__tests__/helpers/renderApp.tsx`）補 `dataHead: null`；`renderApp.tsx` 的 Firebase 相關 mock 補 `subscribeDataHead`（若該 helper mock 整個 `firebase/firestore` 則不需）。

### 3.3 `frontend/src/firebase/cloudOrderRepository.ts`

在 `refreshSnapshot`（519 行）後新增並放進回傳物件（671 行附近）：
```ts
async function refreshFromHead(previous: CloudOrderSnapshot, head: { seq: number; lastCommandId: string | null; datasetId: string }): Promise<CloudOrderSnapshot | null>
```
- `head.datasetId !== previous.datasetId || head.seq !== previous.seq + 1 || head.lastCommandId === null` → `null`。
- `getDocFromServer(doc(db, commandPath(head.lastCommandId)))`；不存在、`seq !== head.seq`、`targets` 不是物件 → `null`。
- 回傳 `refreshSnapshot(previous, { seq: head.seq, targets })`（它自己會驗 targets 與 head、日期、對帳）。讀取錯誤 → `null`。

### 3.4 `frontend/src/components/cloud/CloudOrdersPage.tsx`

- 取 `const dataHead = useFirebaseOptional()?.dataHead ?? null;`。
- 新增 `refreshFromExternalHead` callback（放在 `refreshAfterCommand` 之後，約 715 行）：沿用 `isCurrent`／`loadRequestRef`／`generationRef` 的過期保護；**不**清 snapshot、不設 loading、不呼叫 `freshDraft()`；`repository.refreshFromHead(previous, dataHead)`，得到快照 → `snapshotRef.current = s` 並 `updateFor` 只換 `snapshot`；得到 `null` → `loadSnapshot({ reuseBackfillDays: true })`。
- 新 effect，deps：`dataHead?.seq`、§2 R3 的所有閒置欄位、`page.snapshot?.seq`：條件 `dataHead && page.snapshot && dataHead.seq > page.snapshot.seq && 閒置 && !revokedRef.current` → `void refreshFromExternalHead(dataHead)`。用 ref 記「進行中的 seq」避免同一 seq 重複觸發。
- 自己的命令：命令進行中 `operationRef.current` 非空，不觸發；`refreshAfterCommand` 完成後 `snapshot.seq` 已等於 head，不再觸發。

### 3.5 測試（RED 先，單獨 commit）

- Vitest `CloudOrdersPage.test.tsx`（沿用檔內 repository 替身與 Firebase context 包裝方式）：
  - E1 閒置、context `dataHead.seq` 由 n 變 n+1 → `refreshFromHead` 被呼叫；畫面沒有出現載入骨架；新交易出現。
  - E2 已選學生（輸入中）時 seq 前進 → 不呼叫；按 Esc 取消選擇後 → 呼叫一次。
  - E3 `refreshFromHead` 回 null → 呼叫 `loadSnapshot`。
  - E4 自己送出命令期間 seq 前進 → 只走 `refreshSnapshot`，`refreshFromHead` 未呼叫。
- Emulator Vitest `src/firebase/__tests__/cloudPageReduction.spec.ts`（已有 `refreshSnapshot` 案例，進 `test:cloud-capacity`）加 `refreshFromHead`：前進 1 → 等同 `refreshSnapshot` 結果；前進 2 → null；datasetId 不同 → null。
- E2E `frontend/e2e/cloud-production.spec.ts` 新增 `A13: an idle counter page shows an order placed from another same-UID page without reloading`：同 context 兩頁（同 A08 開法）、A 取得使用權並停在櫃台頁、B 以同帳號登入並下一筆訂餐、A 在 10 秒內顯示該筆（以學生名或交易列定位），且 A 期間未出現 `.auth-gate`／載入骨架。

### 3.6 指令

```bash
cd frontend
npx vitest run src/firebase/__tests__/dataHeadWatch.test.ts src/providers/__tests__/FirebaseProvider.test.tsx src/components/cloud/CloudOrdersPage.test.tsx
npx firebase emulators:exec --project demo-easyorder --config ../firebase.json --only firestore "EASYORDER_REQUIRE_CLOUD_CAPACITY=true npx vitest run src/firebase/__tests__/cloudPageReduction.spec.ts --maxWorkers=1"
npx firebase emulators:exec --project demo-easyorder --config ../firebase.json --only auth,firestore "npx playwright test --config playwright.config.ts -g 'A0[3-8]|A1[23]'"
npx eslint src e2e/cloud-production.spec.ts
```
另：`test:cloud-capacity` 的工作負載表（`maintenance/capacityGate.ts`）加一項 `dataHead 監聽`＝每命令 1 讀×開著的分頁數（假設 2）＋櫃台頁增量 8 讀×外部命令比例（假設 30%），重產生 `docs/ops/p16-capacity-gate.json`，平常日仍須 PASS；不通過就回報，不擴充機制。

## 4. P2：其他雲端頁提示

- 新元件 `frontend/src/components/cloud/DataUpdatedNotice.tsx`：props `{ pageSeq: number | null; onReload: () => void }`，讀 context `dataHead`；`dataHead && pageSeq !== null && dataHead.seq > pageSeq` 才顯示 `role="status"` 一行「其他裝置已更新資料。」＋次按鈕「重新載入」。不自動消失；重新載入後 seq 對齊即隱藏。
- 放在各頁標題下方：`CloudStudentsPage`（快照 `seq`）、`CloudDayVendorsPage`（`snapshot.seq`）、`CloudDayClosePage`（`snapshot.overview.seq`）、`CloudReportPage`（`snapshot.report.sourceSeq`）、`CloudAccountHistoryPage`（`snapshot.account.sourceSeq`）。`onReload` 用各頁既有的重新載入函式。實作時先確認自己送命令後各頁 seq 已更新（不會對自己的命令顯示提示）；若某頁命令後不更新 seq，該頁在命令期間不顯示。
- 測試：元件單元測試（顯示／隱藏／按鈕）；每頁一個「context seq 大於頁面 seq 時出現提示、按下呼叫重新載入」案例。

## 5. 風險

- 背景補讀時舊快照仍可操作：由命令 revision 檢查保護（R4），E2E 回歸 A03–A08。
- 讀取量：見 §3.6 容量重算；監聽只在持有者分頁存在。
- 多分頁同時開櫃台頁：各自補讀，成本隨分頁數線性，容量假設寫 2。
- 刷臉第二路徑接上後才是主要受益者；屆時交接事件若不寫 `dataHead`，需另加監聽（另案）。
