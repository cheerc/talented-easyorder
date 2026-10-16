# P08 介面與資料契約：F1 一般／其他餐點雲端入帳

Base: `origin/main`（SHA `6ae1909639f56aa6d36524406e700554891f6328`，包含 P06b #487、U1 #481、U2a #483、U2b #486、U2c #482、U3 #484、U4 #485 之整合 PR #488）。本契約為 P08 雲端訂餐後端、Repository、畫面元件與 Firestore Security Rules 實作之正式依據。

---

## 1. 背景與設計原則

正式後端規格（`docs/superpowers/specs/2026-10-13-free-production-backend-spec.md` §3.1、§5、§6.1、§6.3、§7）與操作回饋排程（`docs/superpowers/plans/2026-10-15-operator-feedback-plan.md` §6 P08）規定了雲端 F1 訂餐的核心範圍與介面定稿：

1. **獨立雲端 F1（Isolated Cloud F1）**：雲端畫面不掛載 `legacyAppContent`、本機 POS hooks（`usePosFlow` 等）或本機狀態庫（Zustand 帳務 store），不引入練習資料 fallback。所有名冊、菜單、交易與日統計一律由伺服器權威讀取與寫入確認。
2. **穩定內部鍵與顯示編號對映**：依 P06b 契約，交易文件 `transactions/{transactionId}` 的 `studentId` 與 `CreateOrder` command 之 target 一律採用 UUID 穩定鍵；畫面上供操作員輸入、掃碼與搜尋的則是正規化編號 `studentCode`（`001`–`999999`），由記憶體名冊或唯一索引對映至內部 UUID。更換編號不影響歷史交易與交易歸屬。
3. **原子提交與三方一致**：訂餐透過唯一原子寫入器 `commitCommand('CreateOrder')`，一筆交易內同時原子更新 `dataHead`（seq + 1）、`day`（totals 與 revision + 1）、`student`（餘額與 revision + 1）、`transaction`（新建交易紀錄）及 `command`（冪等收據），保證五方一致。
4. **一般今日餐點與其他餐點分流**：
   - **今日餐點（`mealKind: 'bento'`）**：自動帶入當日菜單快照（品名、單價、供應商資訊與菜單版次 `menuRevision`）。若當日未設定菜單，阻擋訂購今日餐點。
   - **其他餐點（`mealKind: 'other'`）**：支援明確輸入的自訂品名（1–100 字元）與餐點金額（非負整數），`menuRevision` 為 `null`。當日未設定菜單時，仍允許訂購其他餐點。
5. **價格與版次競賽保護**：若訂購時菜單版次（`menuRevision`）或學生主檔版次（`expectedRevisions.student`）已在伺服器變動，交易因 `REVISION_CONFLICT` 中止，提示操作員重新確認最新價格或餘額，禁止以過期數值靜默覆蓋。
6. **帳務原則**：
   - 停用帳戶（`status === 'inactive'`）禁止新增餐點（Client 與 Rules 雙重嚴格阻擋）。
   - 零收款（`paidAmount: 0`）合法，餐費扣抵帳戶餘額產生欠款（負餘額）合法。
   - 重複加訂（當日已訂過餐點）必須有明確二次確認對話框，防止誤觸。
   - 防連按（提交中鎖定按鈕）、失去使用權（lease lost/expired）立即遮罩並清空敏感資料。
7. **定稿介面與偏好沿用**：
   - 沿用 U1 顯示偏好 store（`easyorder-ui-tweaks`）：`CloudAppContent` 呼叫 `useTweaks`，雲端頁套用同一份主題與字級（body `data-theme`／`data-scale`）。雲端模式沒有設定入口，要改偏好需在本機模式設定；雲端訂餐頁沒有 hover 選取行為，所以 hover 設定在雲端無作用。
   - 沿用 U2a/U2b 定稿：右上角固定兩行＋品名；最近帳戶（RecentStrip）顯示分類；E「付款明細」顯示當日明細與底部合計（暫不提供「查看全部紀錄」入口，留待 P12 開放）。
   - 移除舊「檢視歷史」（WeeklyHistoryView）。
   - 5 秒撤回（undo）維持關閉（留待 P10 開啟）；不開放 W 繳費與 A 櫃台收支（留待 P09a）。

---

## 2. 資料結構與集合定義

### 2.1 交易文件 `/transactions/{transactionId}`

- 文件路徑：`/transactions/{transactionId}`
- 文件 ID `transactionId`：標準 UUID 字串。
- 文件內容（`CloudTransactionDoc`）：
```ts
export interface CloudTransactionDoc {
  transactionId: string;                 // 交易 UUID，與文件 ID 相同
  studentId: string;                     // 學生內部穩定 UUID（P06b）
  businessDate: string;                  // 台北營業日 YYYY-MM-DD
  type: 'order';                         // P08 僅開放 'order'
  mealKind: 'bento' | 'other' | null;    // 今日餐點 'bento' 或 其他餐點 'other'
  mealPrice: number;                     // 餐點單價，整數 0 .. 1,000,000
  paidAmount: number;                    // 當筆實收，整數 0 .. 1,000,000
  amount: number;                        // 學生餘額淨變動 = paidAmount - mealPrice
  studentNameSnapshot: string;           // 建立時學生姓名快照（1–100 字元）
  menuNameSnapshot: string;              // 今日餐點時為菜單品名，其他餐點時為空字串 ''
  menuPriceSnapshot: number;             // 今日餐點時為菜單單價，其他餐點時為 0
  vendorIdSnapshot: string;              // 今日餐點時為供應商 ID，其他餐點時為空字串 ''
  vendorNameSnapshot: string;            // 今日餐點時為供應商名稱，其他餐點時為空字串 ''
  otherItemName: string | null;          // 其他餐點時為品名（1–100 字元），今日餐點時為 null
  status: 'active';                      // 建立時固定為 'active'
  revision: 1;                           // 新建交易版次固定為 1
  createdAt: Timestamp;                  // 伺服器時間 request.time
  createdSeq: number;                    // 與 command.seq 同步之全域序號
  operatorUid: string;                   // 建立操作員 UID（等於 request.auth.uid）
  operatorEmail: string;                 // 建立操作員 Email
  sourceDevice: 'pc';                    // 建立來源固定為 'pc'
  note: string;                          // 備註，0–500 字元
  lastCommandId: string;                 // 建立本交易之 commandId（UUID）
  updatedAt: Timestamp;                  // 伺服器時間 request.time
}
```

### 2.2 營業日文件 `/days/{YYYY-MM-DD}` 之 totals 累加

- 文件路徑：`/days/{YYYY-MM-DD}`
- `totals` 欄位（`CloudDayTotalsDoc`）累加規則：
  ```ts
  activeTransactionCount: before.activeTransactionCount + 1,
  bentoCount: before.bentoCount + (mealKind === 'bento' ? 1 : 0),
  otherMealCount: before.otherMealCount + (mealKind === 'other' ? 1 : 0),
  mealTotal: before.mealTotal + mealPrice,
  retainedReceipts: before.retainedReceipts + paidAmount,
  cashierIncome: before.cashierIncome,   // 不變
  cashierExpense: before.cashierExpense, // 不變
  ```
- 限制：`revision + 1`、`lastCommandId = commandId`、`updatedAt = request.time`，其餘 `status`, `menu`, `openingCash` 等維持不變。

### 2.3 學生文件 `/students/{studentId}` 餘額異動

- 文件路徑：`/students/{studentId}`
- 異動規則：
  ```ts
  currentBalance: before.currentBalance + paidAmount - mealPrice,
  revision: before.revision + 1,
  lastCommandId: commandId,
  updatedAt: request.time,
  ```
- 限制：`diff(before).affectedKeys().hasOnly(['currentBalance', 'revision', 'lastCommandId', 'updatedAt'])`。
- 餘額邊界：`-1,000,000,000 .. 1,000,000,000`。

---

## 3. Command 規範：`CreateOrder`

- `kind`: `'CreateOrder'`
- `targets`:
  ```ts
  {
    transactionId: string;               // 新建交易 UUID
    studentId: string;                   // 目標學生 UUID
    dayId: string;                       // 當日營業日 YYYY-MM-DD
  }
  ```
- `expectedRevisions`:
  ```ts
  {
    transaction: 0;                      // 代表新建
    student: number;                     // 預期學生當前 revision (>= 1)
    day: number;                         // 預期營業日當前 revision (>= 1)
  }
  ```
- `payload`:
  ```ts
  {
    mealKind: 'bento' | 'other';
    mealPrice: number;                   // 0 .. 1,000,000
    paidAmount: number;                  // 0 .. 1,000,000
    menuRevision: number | null;         // bento 時為整數，other 時為 null
    otherItemName: string | null;        // bento 時為 null，other 時為 1–100 字元字串
    note: string;                        // 0–500 字元字串
  }
  ```
- `cashEffect`:
  ```ts
  {
    before: 0,
    after: paidAmount,
    delta: paidAmount,
    reasonKind: paidAmount > 0 ? 'collection' : 'none',
    refundAmount: 0
  }
  ```
  `paidAmount = 0` 時 `reasonKind` 為 `'none'`（與 `cloudCommandRepository.ts` 及 Rules 一致）。
- 冪等：`commandId` 與 `transactionId` 在畫面備妥訂單時各產生一次（`crypto.randomUUID()`）並凍結；重送、重試都沿用同一組。同一 `commandId` 搭配不同 `transactionId` 或不同內容時，`commitCommand` 讀到既有收據後以 `INVALID_INPUT` 拒絕，不會再寫一筆。
- 寫入集合（共 5 份文件，一次原子寫入）：
  1. `commands/{commandId}`（create: 冪等收據）
  2. `system/dataHead`（update: seq + 1, lastCommandId, updatedAt）
  3. `days/{dayId}`（update: totals 累加, revision + 1, lastCommandId, updatedAt）
  4. `students/{studentId}`（update: currentBalance 扣減餐費加收現, revision + 1, lastCommandId, updatedAt）
  5. `transactions/{transactionId}`（create: 交易快照文件）

---

## 4. Security Rules 驗證與 Access Budget

### 4.1 Rules 存取次數盤點（依 p05-rules-budget 無快取靜態估算法）

`CreateOrder` 共寫入 5 份文件，各 Evaluation 之存取次數如下：

1. **`commands/{commandId}` create**（中央驗證 `validCreateTransaction`）：
   - `get operators/{uid}` × 1 (`approvedOperator`)
   - `get system/accessLease` × 1 (`commandHolder`)
   - `get system/dataHead` × 1
   - `getAfter system/dataHead` × 1
   - `get days/{dayId}` × 1
   - `getAfter days/{dayId}` × 1
   - `get students/{studentId}` × 1
   - `getAfter students/{studentId}` × 1
   - `exists transactions/{transactionId}` × 1
   - `getAfter transactions/{transactionId}` × 1
   **中央小計：10 / 10 次（剛好觸頂）**。
2. **`system/dataHead` update leaf**：
   `getAfter commands/{commandId}` (1) + `exists commands/{commandId}` (1) = **2 次**。
3. **`days/{dayId}` update leaf**：
   `getAfter commands/{commandId}` (1) + `exists commands/{commandId}` (1) = **2 次**。
4. **`students/{studentId}` update leaf**：
   `getAfter commands/{commandId}` (1) + `exists commands/{commandId}` (1) = **2 次**。
5. **`transactions/{transactionId}` create leaf**：
   `getAfter commands/{commandId}` (1) + `exists commands/{commandId}` (1) = **2 次**。
6. 寫入 Rules 總計：10 + 2 + 2 + 2 + 2 = **18 次**。
7. SDK Commit `VerifyMutation`（針對 lease 之 `approvedOperator` 依賴）：**+1 次**。
8. **整筆 commit 總存取：18 + 1 = 19 / 20 次**（裕度為 1 次）。

### 4.2 1,000-Expression Ceiling 防護
在合法最大 payload（姓名 100 字、品名 100 字、備註 500 字、最大金額）進行正向路徑測試，驗證每份文件評估不觸發 Firestore 1,000-expression ceiling。

### 4.3 讀取契約（`loadSnapshot`）

- `transactions` 讀取規則：`allow get, list: if currentHolder();`，`update, delete` 一律拒絕。只有目前租約持有者能讀；他人、未登入、租約過期都拒絕（Emulator spec P08.R1）。寫入側 Rules 與 `days` 規則未改，§4.1 的存取次數與 day 規則的 expression 裕度不受影響。
- 查詢：`where('businessDate', '==', today)`、`orderBy('createdAt')`、`orderBy(documentId())`，分頁每頁最多 200 筆，單日上限 2,000 筆，超過即以 `INCOMPLETE_SNAPSHOT` 失敗。需要的複合索引已加在 `firestore.indexes.json`（`businessDate ASC, createdAt ASC, __name__ ASC`）。
- 營業日：`today` 取自伺服器租約 `updatedAt` 的台北日期，不用瀏覽器時鐘；與 Rules `validCurrentTaipeiDate` 同一來源。
- 讀取順序：`dataHead` → 租約日期 → `days/{today}` → 名冊 → 交易分頁 → 讀完再檢查租約日期與 `dataHead.seq`。前後任一不同即 `STALE_SNAPSHOT`，畫面重讀，不拼湊兩個時間點的資料。
- 嚴格解碼：每筆交易依 Rules `validTransactionDoc` 的欄位與型別解碼，只接受 `order`／`payment`；欄位不符即 `UNSUPPORTED_SCHEMA`。交易指向不存在的學生即 `INCOMPLETE_SNAPSHOT`。
- 對帳：交易加總必須等於 `day.totals`（份數、餐費、收款），不符即 `RECONCILIATION_FAILED`，畫面不顯示任何數字。右上角計數直接取 `day.totals`。

---

## 5. 前端 F1 元件與使用者互動契約

### 5.1 右上角餐點計數（TopBar，依 U2a 定稿）
固定兩行顯示，其他餐點為 0 亦顯示避免跳動：
- 第一行：「今日餐點（{當日菜單名稱}）  {今日餐點份數}」
  - 當日未設定菜單時顯示：「今日餐點（未設定）  {今日餐點份數}」
  - 菜單名稱過長時文字截斷，hover 顯示全名。
- 第二行：「其他餐點  {其他餐點份數}」

### 5.2 學生搜尋、掃碼與選取
- 搜尋輸入框支援：
  1. `studentCode` 數字輸入或掃碼槍刷入（自動套用 `normalizeStudentCode` 進行唯一正規化比對）。
  2. 中文姓名、英文姓名比對。
  3. 別名（aliases）比對。
- 下拉或鍵盤選取學生：
  - 顯示姓名、目前編號（`studentCode`）、目前餘額。
  - 停用帳戶：若選中停用帳戶，畫面顯示醒目「已停用」標籤，訂餐按鈕禁用，並提示「此帳戶已停用，禁止新增餐點」。

### 5.3 訂餐操作與重複加訂確認
- **今日餐點（Q）**：
  - 預設模式，自動帶入當日菜單品名與單價。
  - 當日無菜單時禁用，提示「今日尚未設定菜單，無法訂購今日餐點」。
- **其他餐點**：
  - 點擊「其他餐點」切換，提供「餐點品名」（必填 1–100 字元）與「餐點單價」（非負整數）。
  - 當日無菜單時仍允許訂購其他餐點。
- **實收金額（paidAmount）**：
  - 預設為空或 0，支援輸入實收現金。
  - 即時計算預估結餘 ＝ 目前餘額 ＋ 實收金額 − 餐點單價。
- **重複加訂確認**：
  - 若該學生在今日已訂過今日餐點（或已有訂餐紀錄），點擊「確認登記」時彈出確認對話框：
    「{學生姓名} 今天已訂 {N} 份餐點，確定要再加訂 1 份嗎？」
  - 操作者點擊「確認加訂」或按 Enter 後才正式送出命令。

### 5.4 最近帳戶（RecentStrip，依 U2a 定稿）
- 列出今日有交易之帳戶，依最近異動時間排序。
- 摘要分類標示：
  - 只有今日餐點：顯示「今日餐點 N」
  - 只有其他餐點：顯示「其他餐點 M」
  - 兩者皆有：顯示「今日餐點 N・其他餐點 M」
- 點擊帳戶列可快速選中該學生進行後續操作或查閱。

### 5.5 E 付款明細（TransactionStatusView，依 U2a 定稿）
- 按 E 鍵或點擊「付款明細」按鈕開啟對話框。
- 標題：「{姓名} 今日付款明細」。
- 明細清單：列出當日各筆交易時間、項目（「今日餐點：{交易上的 menuNameSnapshot}」、「其他餐點：{otherItemName}」）、餐費、收款。品名一律取自交易快照，缺值時不補任何預設品名。
- 底部合計：今日餐費 $X、今日收款 $Y、帳戶餘額 $Z。
- **邊界限制**：依 U2a 定稿與排程規範，雲端 E 付款明細**暫不提供「查看全部紀錄」按鈕**，待 P12 開放。

### 5.6 提交防護與連線異常處理
- 送單中按鈕禁用，防止連按送出多張重複單。
- 收到伺服器收據（Receipt confirmed）後才提示成功訊息（如「已確認 001 王小明 訂餐完成」），清空輸入並回到搜尋焦點。
- 網路逾時或 UNKNOWN_RESULT 時，使用相同 `commandId` 透過 `readCommand` 進行伺服器端確認，不可更換 ID 重複送單：
  - 畫面顯示「結果確認中，勿重新收款」，鎖住輸入；「再查一次」以同一組 `commandId`／`transactionId` 重送同一個 command，伺服器以冪等收據回應，不會多寫一筆。
  - 送出前把 `{uid, datasetId, commandId}` 存到 localStorage（`easyorder-cloud-pending-order`，依 spec §8 只存這三項，不存姓名、金額）。重新整理或重新取得使用權後，用 `readCommand` 查詢：已入帳就提示並清除；查不到就保留提醒，由操作員按「確認未入帳並清除提醒」後才清除。
- 明確失敗（`REVISION_CONFLICT`、`INVALID_INPUT` 等）：清除待確認紀錄，重讀快照並保留輸入，請操作員依最新價格與餘額重新確認。
- 租約失效、`UNAUTHORIZED`、`ACCESS_BUSY` 或操作員失權時，立即呈現遮罩並清空所有在記憶體中的資料與輸入，回報導覽為 revoked。
- 5 秒撤回（undo）維持關閉（留待 P10 開啟）；不開放 W 繳費與 A 櫃台收支（留待 P09a）。
