# 2026-10-15 操作回饋排程計畫（10 項）

日期：2026-10-15（2026-10-16 更新進度）。
狀態：**前端 prototype 定稿線（U1、U2a、U2c 先前已合入 main；U3、U4、U2b 與 P06b 現由整合 PR #488 合入 main，source 5819171，squash merge 6ae1909）；前端 Prototype 功能完成 ≠ 雲端正式後端全完成 ≠ CheerC 本人營運驗收；雲端線 P06b 已由 #488 合入 main，P08 已由 #491 合入 main（`889c75c`），P09/P09b/P10+ 尚未交付**。
來源：CheerC 2026-10-15 操作時發現的 10 個問題。
程式現況以 main `6ae1909`（整合 PR #488，含 P00–P07、P06b 與 U1–U4）為準。

這份文件回答兩件事：

- 每一項要在哪一個階段改。
- 哪些現在不先定案，之後會更麻煩。

正式後端的權威文件仍是[正式後端規格](../specs/2026-10-13-free-production-backend-spec.md)和[P00–P18 計畫](2026-10-13-free-production-backend-plan.md)。本文件新增或修改的範圍，各 phase 開工時要併進它們的 PR 範圍與驗收。

## 0. 結論

| # | 問題 | 性質 | 前端定稿（prototype） | 雲端實作 | 最晚決策期限 |
|---|---|---|---|---|---|
| 10 | 顯示設定重新整理後恢復 | 錯誤 | **U1，立即** | P08 沿用同一份偏好 | 不需決策 |
| 4 | 右上角改成「今日餐點／其他餐點」；「便當」全改「餐點」 | 介面用語 | U2a（右上角）、U2b（全系統用語） | P08 起所有雲端畫面 | P08 開工前 |
| 2 | 最近帳戶顯示其他餐點 | 介面 | U2a | P08 | P08 開工前 |
| 5 | E 改名「付款明細」 | 介面 | U2a | P08（訂餐列）、P09a（繳費列） | P08 開工前 |
| 6 | 移除「檢視歷史」 | 介面 | U2a | P08 不做這個按鈕 | P08 開工前 |
| 9 | 查單一學生全部紀錄 | 介面入口 | U2a（E 加「查看全部紀錄」） | P12（帳戶完整紀錄） | P12 開工前 |
| 3 | 開帳金額確認時提醒比對前一天 | 介面 | U2c | P11（雲端要有關帳資料才能比對） | P11 開工前 |
| 7 | 學生編號可改、列出缺號 | **資料結構** | U3 | **新增 P06b，排在 P07 之後、P08 之前** | **P07 合併前** |
| 1 | 從帳戶退錢給學生 | **資料結構＋帳務** | U4 | **新增 P09b，排在 P09a 之後** | P09 開工前 |
| 8 | 操作紀錄是否完整 | 稽核 | 不改（prototype 只是練習） | P12（F5 列出所有異動）、P13（登入／交接紀錄） | P12 開工前 |

最急的是 **#7**。雲端現在用「編號」當學生資料的鍵。P08 開始寫入第一筆雲端交易之後，交易、稽核、報表、備份都會引用這個鍵，到時候再改就要連交易一起搬。所以 P07 合併後要先做 P06b，再做 P08。

## 1. 排程原則

1. **雲端畫面是重寫的，不是沿用 prototype。** P06 的學生頁、P07 的日期與供應商頁都放在 `components/cloud/`，沒有引用任何 F1–F5 元件（P07 分支的 `App.tsx` 也只切換這兩個雲端頁）。所以只改 prototype，雲端不會自動跟著變。
2. **介面先在 prototype 定稿。** 做法是先讓 CheerC 在練習模式驗收，雲端 phase 再照定稿做，避免雲端畫面做好後再回頭改。定稿後的行為寫進 [prototype workflow spec](../specs/frontend-prototype-workflow-spec.md)：正式後端 spec §1 指定它的 §5–§6 是已驗收帳務行為來源，U1／U2b 新增的外觀偏好與用語對照則新增 §8 記錄。
3. **改資料結構的項目要排在第一個依賴它的 phase 前面。** #7 要在 P08 前，#1 要在 P11（關帳算式）與 P14（備份格式）前。
4. **P07 範圍不變**，照原計畫完成、合併。
5. **兩條線並行，互不碰檔案：**

| 線 | 誰做 | 可以改 | 不可以改 |
|---|---|---|---|
| 前端定稿線 U1–U4 | Claude implementer | `components/`（`cloud/` 除外）、`hooks/`、`store/`、`domain/` 中 prototype 用的檔案、`e2e/` 的 prototype 案例、prototype workflow spec | `components/cloud/`、`firebase/`、`domain/cloud*`、`firestore.rules`、正式後端 spec／plan／evidence |
| 正式後端線 P07–P18 | 後端 agent | 照正式後端計畫 | prototype 的 F1–F5 行為（要改先回到 U 線定稿） |

兩條線都會碰 `App.tsx`，但區塊不同：U 線改 `AppContent`，後端線改 `CloudAppContent`。合併時注意即可。

## 2. 修訂後順序

```text
後端線：P00–P07（已 main）→ P06b（已 main #488）→ P08 訂餐（已 main #491）
        → P09a 繳費與櫃台收支（原 P09）→ P09b 退款（新）→ P10 更正取消
        → P11 關帳重開 → P12 查帳報表 → P13 故障收尾 → P14 之後不變

前端線：U1（已 main）→ U2a（已 main）→ U2c（已 main）→ U2b/U3/U4（已 main #488）

交會點現況：前端 U1–U4 與雲端 P06b 均已正式合入 main；P08 已由 #491 合入 main；U4 定稿為後續 P09b 提供依據
```

## 3. 逐項說明

### #10 顯示設定改完沒有保存（錯誤）

**現況：**

- 「顯示設定」的三個選項（主題、字體大小、停用滑鼠 hover 選取）只存在 `hooks/useTweaks.ts` 的 `useState`，從來沒有寫進任何儲存，所以重新整理就回到預設。
- `App.tsx:143` 和 `AdminScreen.tsx:37` 各自呼叫一次 `useTweaks()`，是兩份互不相通的狀態。因此還有兩個問題：
  - 在 F3 改 hover 設定，F1 的搜尋框收不到（`PosColumn.tsx:185` 用的是 App 那一份）。
  - 切到別的分頁再回到 F3，F3 卸載後重建，畫面回到預設，`<body>` 也被重設成暖色、大字。
- 這是 2026-06-18 #404（`22b8e45`）拆元件時造成的。測試（`screens.test.tsx:67-68`）把這個 hook mock 掉了，所以沒抓到。
- 雲端模式目前沒有顯示設定。

**決定：**

- 改成單一來源（一個小 store），存在這台電腦的 `localStorage`，使用固定 key（如 `easyorder-ui-tweaks`，**不**分 prototype／cloud 命名空間），讓練習模式與雲端模式共用同一份外觀偏好。
- 只存外觀偏好，不含個資，登出或重置練習資料時都不清除。
- 不放進 POS 的 `partialize`（`posPersistence.ts:86-105`），因為雲端模式不保存 POS 資料，放進去照樣會丟。

**排程：** U1，立即。P08 做雲端 F1 時沿用同一個 store。

**驗收：**

- 改主題、字級、hover 設定 → 換到別的分頁再回來 → 重新整理，三項都還在。
- hover 設定真的會影響 F1 的搜尋框。
- 補上 store 和 F3 的單元測試，不再 mock 掉這個 hook。

### #4 右上角改成「今日餐點／其他餐點」，「便當」全面改成「餐點」

**現況：**

- 右上角是 `TopBar.tsx:139-140`，畫面是「3 / 今日便當 ＋其他 1」，拿不到菜單名稱（`todayMenu` 沒有傳進 `TopBar`）。
- 非測試程式共 30 個檔案（63 行，其中畫面字串約 27 處，其餘為註解與範例品名）含「便當」；測試檔另有 45 個檔案（177 行），e2e 有 2 個檔案（3 行，其中 2 處斷言）會受影響：`order-flow.spec.ts:22-23`、`settlement-flow.spec.ts:12`。
- CSV 欄名是英文（`bento_count` 等），沒有「便當」二字。
- 雲端頁面目前 0 處；`cloudCommandSchema.ts` 有 3 處開發用錯誤訊息（第 279、286、650 行）。

**決定：**

右上角固定兩行，其他餐點是 0 也顯示，版面才不會跳動：

```text
今日餐點（排骨便當）  3
其他餐點              1
```

- 沒設菜單時顯示「今日餐點（未設定）」。
- 菜單名稱太長時截斷，滑鼠停留顯示全名。
- 菜單名稱本身含「便當」二字（例如「排骨便當」）是使用者輸入的資料，不改。

用語對照：

| 現在 | 改成 |
|---|---|
| 今日便當、本日便當 | 今日餐點 |
| 訂便當（Q） | 訂餐 |
| 已經訂過 N 次便當、今日已訂過 N 次便當 | 今天已訂 N 份餐點 |
| 今日便當設定 | 今日餐點設定 |
| 便當名稱、便當單價 | 餐點名稱、餐點單價 |
| 其他餐點（N 份，不算在今日便當份數） | 其他餐點（N 份，不算在今日餐點份數） |
| 付便當錢（支出快選理由） | 付餐費給廠商 |
| 便當櫃台（左上角名稱、快照檔錯誤訊息） | 待確認，建議「訂餐櫃台」（§5 Q5） |
| 正式後端 spec 的「標準便當」 | 今日餐點 |

- 程式內部識別字不改（`bentoCount`、`mealKind: 'bento'`、CSV 的 `bento_count`）。文件註明程式裡的 bento 就是「今日餐點」（當天菜單那一種），避免改名牽動雲端 schema、Rules 和備份格式。
- faceorder 平板的文案在另一個 repo，不在這次範圍。

**排程：**

- U2a 只改右上角。
- U2b 改全系統用語，同步更新 prototype workflow spec（新增 §8 記錄外觀偏好與用語對照）、測試和 e2e。
- 後端線在 P08 開工時更新正式後端 spec §3.1 內含「便當」的條文並於 §5 補註內部識別字 `bento` 對映「今日餐點」，同時改掉 `cloudCommandSchema.ts` 的 3 處錯誤訊息；P08 之後的雲端畫面一律用新用語。

### #2 最近帳戶怎麼顯示其他餐點

**現況：**

- `RecentStrip.tsx:38` 把當天這個帳戶的所有 `type === 'order'` 都算成「N個便當」，其他餐點也算進去（未呼叫 `domain/ledger.ts:203` 的 `isOtherMealOrder`）。
- 只有繳費的帳戶會顯示「0個便當」。

**決定：** 份數的算法和右上角相同（從 `domain/ledger.ts` 匯入 `isOtherMealOrder`），依當天內容顯示：

| 當天內容 | 顯示 |
|---|---|
| 只有今日餐點 | 今日餐點 1 |
| 只有其他餐點 | 其他餐點 1 |
| 兩種都有 | 今日餐點 1・其他餐點 1 |
| 沒有訂餐，只有繳費（U4 之後含退款） | 僅繳費（或「僅退款」「繳費・退款」） |

窄視窗加大字時，如果一行放不下，改用短版「今日 1・其他 1」。驗收時看 1000px 寬、大字的實際效果（比照 FA08）。

**排程：** U2a；P08 照定稿做。

### #5 E「訂餐狀況」改成「付款明細」

**現況：**

- E 的面板是 `TransactionStatusView.tsx`，沒有標題。
- 每一列是時間、「訂／繳／支」標記、刷臉標記、收入（`+paidAmount`）、支出（`-mealPrice` 或 `-amount`），以及編輯、刪除按鈕。
- 不顯示菜單名稱、其他餐點名稱、備註或交易後餘額，也没有底部合計。

**決定：** E 鍵不變，按鈕和面板改名「付款明細」。

- 標題：「{姓名} 今日付款明細」。
- 每列：時間、項目、餐費、收款、刷臉標記、編輯／刪除。項目是「今日餐點：排骨便當」「其他餐點：{品名}」「繳費」，U4 之後加「退款」。
- 底部合計：今日餐費 $X、今日收款 $Y、帳戶餘額 $Z。
- 加一個「查看全部紀錄」按鈕，見 #9。

**排程：** U2a；P08 做雲端 F1 時照定稿做出 E 的版面（P08 先不含「查看全部紀錄」按鈕，待 P12 開放），P09a 補上繳費列。

### #6 移除 F1「檢視歷史」

**現況：** 按鈕在 `CustomerCard.tsx:139-144`，打開 `WeeklyHistoryView`，一次只能看一週（週一到週日），也沒有交易後餘額。

**決定：** 移除按鈕和 `WeeklyHistoryView`。當天看 E「付款明細」；全部紀錄用 E 的「查看全部紀錄」，跳到 F5（見 #9）。

**排程：** U2a；P08 的雲端 F1 不做這個按鈕。

### #9 怎麼看單一學生的全部交易

**現在就能用的方法：**

- F5「歷史」→「交易查詢」→「查詢帳戶」輸入編號或姓名 → 把「起始營業日」改到最早一天。這裡有每筆的「這筆之後」餘額、作廢的原單，也有「現在餘額」。
- 預設日期只有當天（`TransactionLookup.tsx:14,32-33` 只有單一 `defaultDate` prop，起訖皆預設為該日），這是目前難用的地方。

**決定：**

- E「付款明細」加「查看全部紀錄」，F3 帳戶列加「交易紀錄」。
- 擴充 `HistoryScreen.tsx` 的 `LookupTarget` 與 `TransactionLookupProps`，支援傳入起訖日期區間（`startDate`／`endDate`）與精確帳戶鎖定（`exactAccountId`），避免改編號或編號為子字串（例如查 `013` 時 `findLookupAccountIds` 的 `includes` 規則誤傷舊號或 `0130`）時混入其他帳戶。
- 兩個入口都跳到 F5「交易查詢」，鎖定這個帳戶，日期從這個帳戶最早的一天（`openingBalance.asOfDate` 與最早交易日取較早者）到今天。

**排程：**

- U2a 做 `TransactionLookup` 區間參數擴充與 E 的入口，U3 做 F3 的入口。
- 雲端在 P12 做帳戶完整紀錄：分頁讀完整歷史才算交易後餘額，沒讀完要標示「未載完」（正式後端 spec §7.3、§8）。P08 的雲端 E 先不顯示「查看全部紀錄」按鈕，等 P12 開放。

### #3 開帳金額的確認提醒

**現況：**

- prototype 會預填「前一天關帳點算」的金額（`domain/cashClose.ts:187` 的 `suggestOpeningCash`）。確認框只寫「確定要將今日開帳金額設為 $X 嗎？」，不比對前一天。
- prototype 的 F3 沒有 20,000 元上限：`domain/cashSession.ts:79` 的 `validateOpeningCash` 有寫 20,000 上限檢查，但 `AdminScreen.tsx:125,141` 只呼叫 `isNonNegativeInt(n)`，沒有呼叫 `validateOpeningCash`。
- P07 的雲端頁不預填，一定要自己輸入，送出前也沒有確認框。雲端在 P11 之前沒有關帳資料，無從比對前一天。

**決定：** 確認框依三種情況顯示。寫「前一天」而不寫「昨日」，因為上一個營業日不一定是昨天（例如週末）。

| 情況 | 確認框內容 |
|---|---|
| 和前一天關帳點算不同 | 「確定要將今日開帳金額設為 $2,710 嗎？」＋醒目警示「與前一天（10/14）關帳點算的 $2,730 不同，差 −$20。」 |
| 和前一天關帳點算相同 | 「開帳金額與前一天（10/14）關帳點算相同（$2,730）。請確實清點抽屜現金後再按確認。」要先勾「我已實際清點」，確認鈕才能按（§5 Q6） |
| 沒有前一天關帳資料 | 「確定要將今日開帳金額設為 $X 嗎？請確實清點抽屜現金後再按確認。」 |

- 修改已設定的開帳金額時，保留現有的「修改開帳金額會影響今日所有帳務計算」，再加上和前一天比對的那一行。
- 重開過的日子，比對對象改成「這一天上次關帳用的開帳金額」，沿用現有的 `same_day` 邏輯（`cashClose.ts:188-189`）。
- prototype 的 `AdminScreen.tsx` 改用 `domain/cashSession.ts` 的 `validateOpeningCash`，補上 0–20,000 元上限，和雲端一致。

**排程：**

- U2c 在 Q6 確認後實作（prototype）。
- 雲端 P07 不用改。它不預填，不會有「直接按確認、沿用錯的數字」的問題。
- P11 有關帳版次之後，雲端加上預填前一天點算和這三種確認框。

### #7 學生編號可以改，並列出缺號（資料結構）

**現況：**

- prototype 的編號建立後不能改；`practiceDataActions.ts:45-50` 的 `updateLocalStudent` 只能改姓名和別名。
- 雲端用使用者輸入的編號當文件 ID（`students/{studentId}`）。交易、command、Rules 都引用這個 ID：
  - `firestore.rules` 的 `students` update 只允許修改 `displayName`、`aliases`、`status`、`currentBalance` 等欄位，禁止改 `studentId`（且 Firestore 文件 ID 本身不可改名）。
  - 交易只能新增，不能改帳戶歸屬。
  - 正式後端 spec §6.3 因 Rules 無法遍歷任意 query，禁止一個命令改多筆交易／全帳戶歷史。

  所以在現在的設計下，**改編號等於搬整個帳戶的歷史，做不到。**
- 清單沒有按數值排序：
  - prototype 照建立順序。
  - 雲端照文件 ID 字串排序，「10」會排在「2」前面。
- 編號沒有嚴格格式限制（正式後端 spec §5 目前寫「編號 1–64 字、不得含 `/` 或為 `__cashier__`；不轉數字」）。雲端建檔不會去掉頭尾空白，「001 」會變成另一個帳戶（新發現的錯誤）。

**決定（雲端，P06b）：** 把「內部鍵」和「畫面上的編號」分開。

1. `students/{studentId}` 的 `studentId` 改成系統產生的穩定內部鍵（UUID，沿用 `validCommandId` 的 UUID 格式，建立後永不改變），畫面上不顯示。
2. 新增欄位 `studentCode`，就是畫面上的「編號」，可以修改。正式後端 spec §5 的「編號 1–64 字、不轉數字」改寫為區分內部鍵 `studentId`（UUID）與畫面編號 `studentCode`（正規化數字字串，見第 6 點）。
3. 交易、command、稽核、備份都繼續以 `studentId` 引用內部鍵，所以改編號不影響歷史和餘額。畫面、搜尋、CSV、列印一律顯示**目前的編號**；交易不另存編號快照，改號紀錄留在 command 的 `before.student.studentCode`／`after.student.studentCode` 裡（不擴充 `commandEnvelope` 的 16 個頂層欄位）。雲端名冊（上限 500 人）已全量載入記憶體，F5 查帳與搜尋直接由記憶體中的 `studentCode -> studentId` 對映查出 `studentId`，再按既有 `(studentId, businessDate, createdAt, transactionId)` 索引分頁讀交易，不需額外查 `studentCodes` 集合。
4. 編號不可重複，由 Rules 保證：
   - 新增唯一索引集合 `studentCodes/{studentCode}`，文件內容為 `{studentId, lastCommandId, updatedAt}`。
   - `CreateStudent` 同時建立 `students/{studentId}` 與 `studentCodes/{studentCode}`。
   - 新命令 `ChangeStudentCode`（payload 為 `{studentCode, reason}`，理由必填 1–500 字，且允許對 `active` 與 `inactive` 停用帳戶執行；兩個帳戶互換號碼需透過一個暫時空號分兩次改號，UI 確認框提示）：建立新索引 `studentCodes/{newCode}`、刪除舊索引 `studentCodes/{oldCode}`、更新 `students/{studentId}.studentCode`，一次原子提交（§5 Q3、Q4 已定案）。
   - **安全規則例外授權：** 正式後端 spec §6.3 原本禁止 client delete 任何文件；P06b 須在 spec §6.3 明文增列「唯一例外：`studentCodes/{oldCode}` 索引文件可由 `ChangeStudentCode` 命令原子刪除（透過 `getAfter(commands/{commandId})` 驗證 `before.student.studentCode == oldCode` 且 `after.student.studentCode == newCode`），財務、學生主檔、command 與結帳文件仍一律禁止刪除」。
5. Rules 存取次數與預算（依 `docs/ops/p05-rules-budget.md` 不折抵快取的算式）：
   - `CreateStudent`（4 個 writes：`command`、`dataHead`、`student`、`studentCode`）：中央 `command` create 讀 operator(1) + lease(1) + head before/after(2) + student exists/after(2) + codeIndex exists/after(2) = **8 次**（≤10）；3 個投影 leaf 各讀 command exists/after(2) = **6 次**；加 SDK `VerifyMutation` 的 lease dependency **1 次**，整筆 atomic request 共 **15/20 次**。
   - `ChangeStudentCode`（5 個 writes：`command`、`dataHead`、`student`、`studentCodes/{new}` create、`studentCodes/{old}` delete）：中央 `command` create 讀 operator(1) + lease(1) + head before/after(2) + student before/after(2) + newCode exists/after(2) + oldCode get/existsAfter(2) = **10 次**（剛好觸頂 10/10）；4 個投影 leaf 各 2 次 = **8 次**；加 `VerifyMutation` **1 次**，整筆共 **19/20 次**（若把舊索引指向該 `studentId` 的檢查下放到 `studentCodes/{old}` delete leaf，中央可降為 **8/10**）。
   - P06b 必須在 Emulator 實證無 1000-expression 上限問題，並在 `docs/ops/p05-rules-budget.md` 新增 P06b appendix（不改動已凍結的 P05 22-kind 歷史表）。
6. 建檔、改號、F1 搜尋與掃碼（`posSearch.ts:64` 的 `resolveScannedStudent`）都先套同一套唯一正規化（§5 Q2 已定案，對齊 spec §3.1「編號與前導零」）：
   - **唯一正規形式**：去頭尾空白 → 全形數字轉半形 → 轉成正整數 → 補零到至少 3 位（`5`、`05`、`0005`、`５` 都正規化為唯一的 `005`；`1000` 維持 `1000`），避免 `005` 與 `0005` 變成兩份不同索引文件。
   - **範圍**：`001`–`999999`（不接受 `000`，缺號列從 `001` 算起；上限 6 位數）。
   - **Rules 與 Repository 一致**：Repository 送出前執行正規化，`firestore.rules` 的 `validStudentCode()` 使用只接受唯一正規形式的 regex `^(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,5})$`，兩邊共用同一組測試案例。
7. 清單依編號的數值排序，從第一號（`001`）列到「目前有人使用的最大號（含停用帳戶）」為止，中間的空號顯示「尚無人使用」：
   - 只空一號：「013 尚無人使用」。
   - 連續空號合併成一列：「013–020 尚無人使用（8 個號碼）」。
   - 點空號列，會帶著這個號碼開啟「新增帳戶」。
   - 搜尋時不顯示空號列。
8. 停用的帳戶仍然占用自己的號碼（§5 Q3 已定案）：缺號列把停用帳戶的號碼算成「已使用」，該列顯示姓名＋「已停用」，不顯示「尚無人使用」；要讓出號碼時，可對停用帳戶執行改號。
9. 正式環境還沒有資料，P06 與 P07 分支上的 Emulator 測試 fixture（如 `cloudCommands.spec.ts`、`cloudStudentRepository.spec.ts`）在 P06b 一併更新為新契約，不需要搬正式資料。

**對平板（faceorder）的影響：** 正式後端 spec §12 目前寫「保留 `studentId`（字串，前導零）供 faceorder `orderCode` 一對一對應帳戶」。P06b 必須**改寫** spec §12 這句：內部鍵 `studentId`（UUID）作為名冊註冊與訂餐事件的穩定鍵，畫面編號 `studentCode`（前導零字串）只用來顯示和讓工作人員輸入查詢；平板如果用 `studentCode` 當鍵，改號後註冊資料就對不上。

**prototype（U3）：**

- 做排序、缺號列、空號列新增、F3「交易紀錄」入口（#9）。
- 做改編號的畫面：編號欄可編輯、重複時顯示「編號 012 已經有人使用（王小明）」、確認框說明「歷史交易會跟著帳戶，畫面顯示新編號」。
- prototype 的資料結構不拆內部鍵：改號時直接改寫練習資料裡這個帳戶的交易、稽核事件（`LedgerAuditEvent.studentId` 與 `before`/`after` 內的 `studentId`）和刷臉紀錄的編號，讓 F5 查帳與稽核在改號後仍能完整連貫。這只是練習用的作法，和雲端拆內部鍵不同；文件裡寫明。

**排程：**

- 決策（§5 Q2–Q4）**要在 P07 合併前回覆**，這是關鍵路徑。
- P06b 排在 P07 之後、P08 之前。
- U3 可以和後端線並行；最好在 P06b 做畫面前驗收，當作雲端學生頁的參考。

### #1 從帳戶退錢給學生（資料結構＋帳務）

**現況：**

- 「收款金額不能是負數。退錢請用取消訂餐或更正交易。」只在畫面上擋（`domain/posTransaction.ts:32`），store 不檢查。
- 現有的退錢方式都綁著某一筆訂單：取消訂餐時退還收款、更正收款金額、刪除繳費。
- **沒有「把帳戶裡的餘額退成現金」的功能。** 正式後端 spec §7.2 把「跨日退既有存款」列為以後再做，不在 P00–P18 裡。
- 雲端的 22 種 command（`cloudCommands.ts:81-129` 的 `ALL_COMMAND_KINDS`）沒有這一種：`CancelRefund` 綁原訂單，`CreateCashMovement` 是櫃台收支、不連學生。日統計也沒有退款欄位。

**決定：** 新增交易類型「退款」（`type: 'refund'`）。

- **帳務效果：** 帳戶餘額 −X、櫃台現金 −X；不算餐費，也不算份數。
- **規則**（§5 Q1，建議全部採用）：
  - 金額是正整數，不能超過目前餘額，避免退到欠款。
  - 理由必填，例如「結清離班」「溢繳退還」。
  - 只能記在台北今天、還沒關帳的營業日。補登舊日期走 P13 的 F2 補登。
  - 停用的帳戶也可以退。常見流程是先結清再停用。
- **F1 入口：** W（繳費）面板加「退款」按鈕，打開退款框：顯示目前餘額，金額預設為全部正餘額，要填理由。確認框寫「確定從 {姓名} 的帳戶退還 $X 現金嗎？退款後餘額 $Y」。
- **原本的錯誤訊息改成：**「收款金額不能是負數。要退錢給學生請用「退款」。」
- **F2：** 新增「退款」一行，**不和收現互相抵銷**。淨現金＝收現＋櫃台收入－櫃台支出－退款；應有現金跟著這個算式。
- **E 付款明細與最近帳戶：** 顯示退款列。
- **CSV：** 欄位名稱不變，`type` 欄的值多一個 `refund`。
- **更正、作廢、5 秒撤回**和繳費相同（雲端 P10）。
- **欄位與結構表示（prototype 與雲端統一）：**
  - 交易 `type` 為 `'refund'`，退款金額以**正整數**記在 `amount`（或 `paidAmount` 固定為 0、`mealPrice` 為 0，不在 `paidAmount` 塞負數，避免破壞既有 `paidAmount >= 0` 與 Rules 的非負整數不變量）。
  - 學生餘額公式：有效 `order`／`payment` 為 `+ paidAmount - mealPrice`，有效 `refund` 為 `- amount`。
  - 日統計 `day.totals` 新增非負整數欄位 `accountRefunds`；`contribution(tx)` 對有效 `refund` 回傳 `accountRefunds: amount`、`retainedReceipts: 0`。

**雲端（P09b）：**

- 新命令 `CreateRefund`，一次寫入交易、學生、日三份業務文件（連同 `command`、`dataHead` 共 5 份，call budget 與 `CreatePayment` 同為 10/write、19/20 total）。
- `ALL_COMMAND_KINDS` 擴充（連同 P06b 的 `ChangeStudentCode`），並在 `docs/ops/p05-rules-budget.md` 新增 P09b appendix。
- **日統計 `day.totals` 結構一次到位：** 在 `firestore.rules` 的 `validTotals`、`validNewDay`、`validDayAdvance`（以及 P07 新增的 `validDayNonMenu`）同步加入 `accountRefunds`。P09b 必須在 P11（`CloseDay`／`ReopenDay`）、P12、P14 之前完成，且更新所有已啟用 kind 的日統計 fixtures，避免線上或測試出現舊版 7 欄與新版 8 欄不一致。
- **正式後端 spec §7.1 與 §7.2 同步改寫：**
  - §7.1 的 `day.totals` 補上 `accountRefunds`；算式改為 `totalIncome = retainedReceipts + cashierIncome`、`totalExpense = cashierExpense + accountRefunds`（或獨立列出 `accountRefunds` 並定義 `netCash = retainedReceipts + cashierIncome - cashierExpense - accountRefunds`），`expectedCash = openingCash + netCash`。
  - `command.cashEffect` 對 `CreateRefund` 定義為 `{before: 0, after: -amount, delta: -amount, reasonKind: 'refund', refundAmount: amount}`，並證明 `expectedCash` 只透過 `day.totals.accountRefunds` 扣一次，不會再重複減 `cashEffect.refundAmount`。
  - §7.2 的「跨日退既有存款延後」改寫為支援當日帳戶餘額退款（`CreateRefund`）。

**為什麼排在 P09b：** 它和 P09a 同屬現金進出。日統計多一個欄位，要在 P11（關帳算式）、P12（報表）和 P14（備份格式）開始使用日統計之前完成，否則這三個 phase 都要重做。

**排程：** 決策（§5 Q1）在 P09 開工前；U4 做 prototype 並驗收；P09b 照定稿做雲端。

### #8 操作紀錄夠不夠完整

**結論：** prototype 的「稽核軌跡」不完整。雲端的設計已經做到「每一筆寫入都有紀錄」，還差登入／交接紀錄和畫面上的完整查詢。

| 動作 | prototype 現在 | 雲端設計（已在 spec，P05 起每筆寫入都存） | 補強與排程 |
|---|---|---|---|
| 新增訂餐、繳費、櫃台收支、退款 | **沒有紀錄** | 每筆是一個 command：操作人 UID 與 email、伺服器時間、送出的值、寫入前後的值 | P12：F5 稽核要列出這些 |
| 修改、刪除、取消、撤回交易 | 有（理由、前後值） | 有，更正與取消理由必填 | P10 |
| 名單（含改編號）、菜單、供應商、開帳金額 | 沒有 | 有（P06、P06b、P07 的 command） | P12：F5 列出 |
| 關帳、重開 | 只在結帳歷史 | 有，每一版都保留 | P11 |
| 匯出 CSV、列印、備份 | 沒有（類型有定義但沒有寫入） | 記錄「發起」 | P12、P14 |
| 登入、取得使用權、交接、逾時被接手 | 不適用 | **沒有**：租約只保留目前狀態，不留歷史 | **P13 新增**，見下方 |
| 被拒絕或失敗的送出 | 本機錯誤紀錄，但沒有地方能看或匯出 | 沒有 | **P13 新增**，見下方 |

「我記得輸入 100，實際上是 80」：在雲端，那筆繳費的 command 會記下送出的金額 80、操作人的 email 和伺服器時間，而且不能修改或刪除。P12 之後可以在 F5 依帳戶、日期、操作人查到。

**建議記錄到這個程度：**

1. **每一筆寫入資料庫的動作**都記：誰、何時（伺服器時間）、改了什麼（前後值）、理由、對應的營業日與帳戶。這已經是 spec 的設計，P12 要讓 F5 看得到全部類型。
   - 篩選條件：帳戶、日期區間、操作人、動作類型。
   - 操作人顯示 email，不顯示 UID。
2. **登入與使用權交接**（P13）：新增只能 create、不能修改或刪除的 `accessEvents/{eventId}`。
   - 觸發點與寫入時機：在 `activeAccountLease.ts` 的 `acquireLease`（取得使用權，若舊 `holderUid` 非空且已逾時則標記為接手逾時租約）與 `releaseLease`（主動釋放）的同一個 `runTransaction` 內一併建立一筆 `accessEvents` 文件；原持有者被接手時不另由原分頁背景寫入（因為原分頁已無 lease 寫入權，且新持有者 acquire 時已記錄前一手 `previousHolderUid` 與新 `epoch`），既完整留存交接鏈，也不增加背景輪詢讀取。
   - 每 60 秒的 `renewLease` 續約不記。一天大約十幾筆寫入，額度影響可忽略。
   - 這需要在正式後端 spec §4.2 與 §5 補上 `accessEvents` 的結構與 Rules（隨 lease acquire／release 原子寫入，actor 為本人 UID，時間為 `request.time`）。
3. **被拒絕或失敗的送出**（P13）只記在這台電腦：commandId、動作類型、錯誤碼、時間，不記金額和姓名。
   - F3 可以匯出給維護者。目前 `errors/errorCatalog.ts:25,49` 已經寫著「請先匯出錯誤紀錄」，但只有 `readErrorLog`/`clearErrorLog` 而沒有匯出下載功能，順便補上。
   - 不上傳雲端：被拒的寫入本來就寫不進去，另外上傳會多開權限、多耗額度。
4. **不記：** 每次按鍵、輸入過程、查詢、畫面切換。量大、含個資，也無助於核對。防止輸入錯誤靠的是送出前的確認框顯示金額，這已經有了。

prototype 的稽核軌跡維持現狀（它只是練習資料），不再補強。

## 4. 前端定稿線（U 批次）與目前交付狀態

每批一個小 PR：implementer 實作，reviewer 只 review、不合併，coordinator 檢查 review 和 CI 後合併。每批都要更新 prototype workflow spec 的對應段落（U1 與 U2b 新增 §8），並在 `npm run dev:prototype` 上給 CheerC 一份驗收步驟。**（注意：以下狀態為自動化測試與 ac 代碼審查結果，不代簽 CheerC 本人之業務驗收）**。

| 批次 | 內容 | 前置 | 主要檔案 | 目前交付狀態（截至 2026-10-16） |
|---|---|---|---|---|
| U1 | #10 顯示設定：單一 store、localStorage 保存（不分模式共用）、hover 設定真的生效、測試 | 無，可立即開始 | `hooks/useTweaks.ts`、`App.tsx`（AppContent）、`AdminScreen.tsx`、新 store、`screens.test.tsx` | **已合入 main**（PR #481，source `d197545`，main squash `423f008`） |
| U2a | #4 右上角兩行、#2 最近帳戶、#5 E 付款明細、#6 移除檢視歷史、#9 E「查看全部紀錄」跳 F5（含 `TransactionLookup` 起訖區間與精確帳戶鎖定） | 無 | `TopBar.tsx`、`RecentStrip.tsx`、`TransactionStatusView.tsx`、`CustomerCard.tsx`、`ActionBar.tsx`、`HistoryScreen.tsx`、`TransactionLookup.tsx`、`transactionLookup.ts` | **已合入 main**（PR #483，merge `15de317`） |
| U2b | #4 全系統「便當」→「餐點」、e2e 斷言、測試字串、PWA manifest 品牌更新 | U2a 合併；Q5 品牌名 | 約 30 個非測試檔、45 個測試檔、2 個 e2e、`public/manifest.json` | **已合入 main**（PR #486 source `4827cc6`，由整合 PR #488 合入 main） |
| U2c | #3 開帳確認框三種情況、0–20,000 元上限（改用 `validateOpeningCash`） | Q6 | `AdminScreen.tsx`、`cashSession.ts`、`cashClose.ts` | **已合入 main**（PR #482，merge `bc8fdf12d2046272333b8b35c1c2a272d99323d6`） |
| U3 | #7 編號排序、缺號列、改編號（練習資料連同交易／稽核／刷臉紀錄改寫）、F3「交易紀錄」入口 | Q2–Q4 | `AdminScreen.tsx`、`practiceDataActions.ts`、`domain/student.ts` | **已合入 main**（PR #484 source `efaa9ce`，由整合 PR #488 合入 main） |
| U4 | #1 退款：交易類型 `refund`、餘額與現金算式、F1 W 退款框、F2 退款一行、E、CSV、稽核顯示 | Q1 | `domain/ledger.ts`、`ledgerReport.ts`、`ledgerExport.ts`、`cashClose.ts`、`domain/types.ts`、`posTransaction.ts`、F1／F2 元件 | **已合入 main**（PR #485 source `b38563c`，由整合 PR #488 合入 main） |

### 跨批次本地整合與收尾（整合 PR #488）

- **整合 PR #488**：整合前端 U3、U4、U2b 與雲端 P06b，source head `58191718e2388bfbf954314128f5357370e65123`，經 CI 綠燈與獨立 review PASS，由使用者授權 `--admin` squash merge 至 main `6ae1909639f56aa6d36524406e700554891f6328`。原 PR #484–#487 均已關閉並附上 #488 承接 pointer，分支完整保留。
- **審查收據**：
  - 前端整合收據：見 [本地前端整合審查收據](../../ops/integration-review-3bfa4d6.md)（HEAD `3bfa4d6`，ac review PASS）。
  - P06b 整合收據：見 [P06b＋前端整合審查收據](../../ops/integration-p06b-review-5819171.md)（HEAD `5819171`，ac review PASS）。
- **驗收步驟指引**：提供使用者可照做的 [Prototype U1–U4 本人操作驗收步驟清單](../verification/2026-10-16-prototype-u1-u4-verification-checklist.md)，供在本機練習環境逐步驗收。
- **邊界與進度明確聲明**：
  1. **Prototype 前端功能完成 ≠ 雲端正式後端全完成 ≠ CheerC 本人營運驗收**。自動化測試與 ac 代碼審查通過不代替使用者之實際營運簽收。
  2. **雲端線現況**：P00–P07 與 P06b 已在 main。目前 P08（雲端訂餐命令）正由後端 agent 於獨立 worktree（`feat/p08-cloud-orders`）進行開發；P09（P09a 繳費）、P09b（退款）、P10+ 等尚未交付。

**注意：**

- U4 會擴充共用的 `TransactionType`（`domain/types.ts:2` 加入 `'refund'`）。要確認雲端投影與 schema（`cloudLedgerProjection.ts`、`cloudCommandSchema.ts`）對新增的 `'refund'` 有明確分支或維持既有 enabled kinds 限制，app TSC 的既有錯誤基線不能增加。
- U2b 不改 `components/cloud/`、`firebase/`、`domain/cloud*`。那些由 P08 處理。

## 5. 需要 CheerC 確認的事（附建議）

| # | 問題 | 建議／定案狀態 | 影響 |
|---|---|---|---|
| Q1 | 退款規則：① 不能超過目前餘額 ② 理由必填 ③ 只記今天 ④ 停用帳戶可退 | 四項都「是」（依建議定案） | U4、P09b |
| Q2 | 編號格式：只能是數字嗎？要不要自動補零到 3 位（輸入 5 存成 005）？ | **已定案（PR #479）**：只能是數字，範圍 `001`–`999999`，轉整數後補零到至少 3 位（`005` 與 `0005` 唯一正規化為 `005`），Rules regex `^(00[1-9]\|0[1-9][0-9]\|[1-9][0-9]{2,5})$` | **P06b（關鍵路徑）**、U3 |
| Q3 | 停用的帳戶還占著號碼嗎？ | **已定案（PR #479）**：占著；缺號列算已使用（顯示姓名＋已停用）；`ChangeStudentCode` 允許對停用帳戶改號以讓出號碼 | **P06b**、U3 |
| Q4 | 改編號要填理由嗎？ | **已定案（PR #479）**：要，1–500 字必填（`command.reason == payload.reason`）；互換號碼需經暫時空號分兩次改號 | **P06b**、U3 |
| Q5 | 左上角「便當櫃台」改成什麼？ | 「訂餐櫃台」（依建議定案） | U2b |
| Q6 | 開帳金額和前一天相同時，要勾「我已實際清點」才能按確認嗎？ | 要，只在相同時要勾（依建議定案） | U2c、P11 |
| Q7 | 最近帳戶、E 付款明細的版面（§3 #2、#5） | 照本文；U2a 驗收時再調 | U2a、P08 |
| Q8 | 要加「登入／交接紀錄」嗎？ | 要（P13，依建議定案） | P13、spec §4.2／§5 |

Q2–Q4 已於 PR #479 確認定案，Q1、Q5–Q8 均依表列建議執行。

## 6. 對正式後端計畫的修改（各 phase 開工時併入）

| Phase | 新增範圍 | 新增驗收 |
|---|---|---|
| P06b（新） | 內部鍵 `studentId`（UUID）與可改的 `studentCode`（唯一正規形式 `001`–`999999`，Rules `^(00[1-9]\|0[1-9][0-9]\|[1-9][0-9]{2,5})$`）；`studentCodes/{code}` 唯一索引；`CreateStudent` 改為同時建索引；新命令 `ChangeStudentCode`（payload `{studentCode, reason}` 理由 1–500 字、允許停用帳戶改號、含 spec §6.3 唯一允許刪除舊索引文件的規則例外）；Repository、Rules 與 F1 掃碼／搜尋共用編號正規化；雲端學生頁依數值排序、缺號列（停用帳戶算已使用）、改號；P06／P07 Emulator 測試資料改新契約；`p05-rules-budget.md` 補 P06b 附錄；spec §5 學生欄位、§6.1 command 表、§6.3 刪除例外、§12 改寫 Android 名冊鍵與顯示編號分工 | 重複編號（含 `5`、`05`、`0005`、`001 ` 正規化後相同）被 Rules 拒絕；`000` 與非數字被拒；停用帳戶可改號讓出號碼；改號後歷史與餘額不變、舊號立即可給別人用；兩個帳戶同時搶同一號只有一個成功；Rules 存取次數（CreateStudent 15/20、ChangeStudentCode ≤19/20、per-write ≤10）與 expression 上限有 Emulator 證據 |
| P08 | 照 U2a、U2b 定稿做雲端 F1：右上角兩行、最近帳戶、E 付款明細（暫不含「查看全部紀錄」按鈕，待 P12 開放）、沒有檢視歷史；共用顯示偏好 store；更新 spec §3.1 用語並於 §5 補註 `bento` 識別字對映；修改 `cloudCommandSchema.ts` 3 處「便當」訊息 | 雲端 F1 的用語和版面與 prototype 定稿一致；畫面上沒有「便當」二字（菜單名稱除外） |
| P09a | 原 P09 不變；E 付款明細補繳費列 | — |
| P09b（新） | `CreateRefund`、交易類型 `refund`、日統計 `accountRefunds`、所有已啟用 kind 與 `validTotals`／`validNewDay`／`validDayAdvance`／`validDayNonMenu` 的日統計格式同步更新、F1 退款框、`p05-rules-budget.md` 補 P09b 附錄、spec §7.1（含 `netCash`／`expectedCash` 算式）與 §7.2 改寫 | 退款超過餘額、0 元、負數、小數、缺理由、非今天、已關帳都被拒；帳戶與現金各 −X；F2 退款一行不和收現抵銷；應有現金不重複扣 |
| P10 | 退款可以更正、作廢、5 秒撤回 | 撤回退款後餘額與現金回復（P10a 實作中：Emulator P10.7、P10.12 與畫面測試；契約 `2026-10-16-cloud-transaction-mutations-contract.md`） |
| P11 | 雲端開帳預填前一天關帳點算，加三種確認框；F2 關帳算式含退款 | 相同時沒勾不能確認；不同時顯示差額 |
| P12 | 帳戶完整紀錄（E 與 F3 入口，支援起訖日期與精確帳戶鎖定）；F5 稽核列出所有 command 類型，可依帳戶、日期、操作人、類型篩選；操作人顯示 email；同步補齊 `firestore.indexes.json` 正式索引 | 新增繳費能在 F5 查到送出金額、操作人、伺服器時間 |
| P13 | `accessEvents`（隨 lease acquire／release 原子記錄取得、釋放、逾時被接手）；本機錯誤紀錄匯出；spec §4.2／§5 補 Rules | 交接一次產生對應紀錄；續約不產生紀錄；匯出檔不含金額和姓名 |

## 7. 這次不做

- 不改 P07 的範圍。
- prototype 的資料結構不拆內部鍵（U3 用改寫練習資料的方式模擬）。
- prototype 的稽核軌跡不補強。
- 不改程式內部的 `bento` 識別字和 CSV 英文欄名（僅在 U4 為 `type` 欄的值集合新增 `refund`）。
- 不改 faceorder repo。平板的鍵與用語留給未來 Android spec，見 #7 的平板段落。
