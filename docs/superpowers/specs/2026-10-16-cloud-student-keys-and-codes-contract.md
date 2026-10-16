# P06b 介面與資料契約：學生穩定內部鍵與可改編號

Base: `origin/main`（SHA `15de317765520c51e368783afcabc0d5be7273ef`，包含 P06、P07、U1 #481、U2c #482、U2a #483）。本契約為 P06b 雲端後端、Repository、畫面元件與 Firestore Security Rules 實作之正式依據。

---

## 1. 背景與設計原則

正式後端規格（`docs/superpowers/specs/2026-10-13-free-production-backend-spec.md`）原先以使用者輸入的「編號」作為 `students/{studentId}` 的文件鍵。由於交易、稽核、command 均引用此鍵，一旦開始寫入交易，更換編號將牽動大量歷史文件重寫（而 Firestore 安全規則無法跨任意查詢批量更新）。

為因應實務上學生編號可能異動、調換或空號回收之需求（見 `docs/superpowers/plans/2026-10-15-operator-feedback-plan.md` §3 #7），P06b 將「**內部穩定鍵**」與「**畫面顯示編號**」明確分離：
1. **內部鍵 `studentId`**：系統自動產生的 UUID（v4 格式），自建立起永不改變。所有交易、command、稽核紀錄均以 `studentId` 關聯學生，改編號完全不變更歷史交易與餘額。
2. **畫面編號 `studentCode`**：使用者可見與輸入的編號，為唯一正規化的數字字串（`001`–`999999`）。由獨立唯一索引集合 `studentCodes/{studentCode}` 保證全系統不重複。
3. **不可變與唯一性**：改編號走專屬命令 `ChangeStudentCode`，一次原子交易內更新學生主檔 `studentCode`、建立新編號索引並刪除舊編號索引。

---

## 2. 資料結構與集合定義

### 2.1 學生主檔 `/students/{studentId}`

- 文件路徑：`/students/{studentId}`
- 文件 ID `studentId`：標準 UUID 字串，符合正規表示式 `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`。
- 文件內容：
```ts
export interface CloudStudentDoc {
  studentId: string;                     // 內部穩定 UUID，與文件 ID 相同
  studentCode: string;                   // 畫面編號，唯一正規形式（如 "001", "099", "1000"）
  displayName: string;                   // 姓名，1–100 字元
  aliases: string[];                     // 別名清單，最多 10 個，各 1–100 字元
  status: 'active' | 'inactive';         // 帳戶狀態
  openingBalance: {                      // 期初餘額快照
    amount: number;                      // 整數，-1,000,000,000 .. 1,000,000,000
    asOfDate: string;                    // 台北日期 YYYY-MM-DD
    note: string;                        // 期初說明，最多 500 字元
    createdAt: Timestamp;                // 伺服器時間
  };
  currentBalance: number;                // 目前餘額整數
  createdAt: Timestamp;                  // 帳戶建立伺服器時間
  revision: number;                      // 版次整數，從 1 起遞增
  lastCommandId: string;                 // 最後異動之 commandId（UUID）
  updatedAt: Timestamp;                  // 最後更新伺服器時間
}
```

### 2.2 編號唯一索引 `/studentCodes/{studentCode}`

- 文件路徑：`/studentCodes/{studentCode}`
- 文件 ID `studentCode`：正規化後之編號字串（`001`–`999999`）。
- 責任：保證編號不可重複；Firestore 文件 ID 的天然唯一性即為互斥鎖。
- 文件內容：
```ts
export interface CloudStudentCodeIndexDoc {
  studentId: string;                     // 對映之學生內部鍵（UUID）
  lastCommandId: string;                 // 建立／異動本索引之 commandId（UUID）
  updatedAt: Timestamp;                  // 伺服器建立／異動時間
}
```

---

## 3. 編號唯一正規化與驗證（Normalizer）

建檔、改號、F1 搜尋與掃碼一律使用同一套嚴格正規化邏輯：
1. **去頭尾空白**：去除字串前後 Whitespace。
2. **全形轉半形**：全形數字 `０`–`９`（U+FF10–U+FF19）轉為半形 ASCII `0`–`9`。
3. **整數範圍驗證**：必須為純整數字串，值介於 `1` 至 `999,999` 之間（禁止 `0`、`00`、`000`、負數、小數或非數字字元）。
4. **補零規則**：
   - 小於 1000（1 至 999）：補零至至少 3 位數（例：`5`、`05`、`0005`、`５` 均唯一正規化為 `"005"`；`99` 正規化為 `"099"`）。
   - 1000 以上（1000 至 999999）：轉為純數字字串，不補前導零（例：`1000` 為 `"1000"`，`001000` 為 `"1000"`）。
5. **Rules 驗證 Regex**：
   `^(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,5})$`
   完全與上述唯一正規形式等價，不接受任何非正規形式輸入。

---

## 4. Commands 定義與 Payload 規範

P06b 新增一個 enabled command kind：`ChangeStudentCode`。啟用 kinds 總數由 10 種增至 11 種（其餘 12 種保持 deny）。

### 4.1 CreateStudent
- `kind`: `'CreateStudent'`
- `targets`: `{ studentId: string }`
- `expectedRevisions`: `{ student: 0 }`
- `payload`:
  ```ts
  {
    studentCode: string;                 // 唯一正規形式 '001'..'999999'
    displayName: string;
    aliases: string[];
    openingBalance: {
      amount: number;
      asOfDate: string;
      note: string;
    };
  }
  ```
- 寫入集合（4 份）：
  1. `commands/{commandId}`（create）
  2. `system/dataHead`（update: seq + 1, lastCommandId, updatedAt）
  3. `students/{studentId}`（create: 包含 studentCode，revision=1）
  4. `studentCodes/{studentCode}`（create: `{studentId, lastCommandId, updatedAt}`）

### 4.2 ChangeStudentCode（新增）
- `kind`: `'ChangeStudentCode'`
- `targets`: `{ studentId: string }`
- `expectedRevisions`: `{ student: number }`（>= 1）
- `payload`:
  ```ts
  {
    studentCode: string;                 // 目標新編號，唯一正規形式
    reason: string;                      // 改號理由，必填 1–500 字元
  }
  ```
- `reason`: 等於 `payload.reason`
- 狀態寬容性：允許對 `active` 或 `inactive` 停用狀態之學生帳戶執行改號（停用帳戶改號可用於讓出編號給新進學生）。
- 兩帳戶互換號碼：不可在單筆交易內互換。必須藉由一個臨時空號，分兩次改號完成。
- 寫入集合（5 份）：
  1. `commands/{commandId}`（create）
  2. `system/dataHead`（update: seq + 1, lastCommandId, updatedAt）
  3. `students/{studentId}`（update: studentCode 改為新號，revision + 1，其餘財務與個資欄位不變）
  4. `studentCodes/{newCode}`（create: 新索引文件）
  5. `studentCodes/{oldCode}`（delete: 舊索引文件刪除，**正式後端規格 §6.3 唯一允許的 client delete 例外**）

### 4.3 EditStudent 與 SetStudentStatus
- 兩者 targets 為 `{ studentId: string }`，僅更新姓名、別名或狀態，**不得**更動 `studentCode`。
- `studentCodes/{studentCode}` 保持原狀不變。

---

## 5. Security Rules 閉合證明、刪除授權與 Access Budget

### 5.1 舊索引刪除授權：如何取得本次 commandId

在 Firestore Security Rules 中，文件刪除（`allow delete`）發生時：
- `request.resource` 為 `null`，無法直接取得客戶端隨請求傳送的欄位。
- `resource.data` 僅有被刪除文件的現有內容 `{ studentId, lastCommandId, updatedAt }`，其中的 `lastCommandId` 為**過去建立該索引的舊命令**，而非當前發起刪除的新命令。

**閉合授權設計：**
1. 刪除規則定位主檔：
   從舊索引的 `resource.data.studentId` 讀取同筆交易中學生主檔的最新狀態：
   `let studentAfter = getAfter(/databases/$(database)/documents/students/$(resource.data.studentId)).data;`
2. 提取當前交易之 `commandId`：
   `let currentCommandId = studentAfter.lastCommandId;`
3. 取得當前 command receipt：
   `let command = getAfter(/databases/$(database)/documents/commands/$(currentCommandId)).data;`
4. 驗證強型別約束：
   - `!exists(/databases/$(database)/documents/commands/$(currentCommandId))`：該命令必須是同筆交易新建，不可為歷史重放。
   - `command.commandId == currentCommandId`
   - `command.committedAt == request.time`
   - `command.kind == 'ChangeStudentCode'`
   - `command.targets.studentId == resource.data.studentId`
   - `command.before.student.studentCode == code`（被刪除的索引號碼必須恰等於命令中學生變更前的編號）
   - `command.after.student.studentCode != code`（學生的新編號確實已改變）
   - `command.after.student.studentCode == command.payload.studentCode`
   - `studentAfter.studentCode == command.payload.studentCode`

此設計保證：
- 任何獨立的 `delete` 請求若無同筆原子交易的 `ChangeStudentCode` command 與 student 配合，皆被拒絕。
- 舊索引不可能被偽造 commandId 刪除，亦無法刪除非此學生所持有的編號索引。

### 5.2 Access Call Budget 盤點（依照 p05-rules-budget 無快取計算法）

Rules 規則存取限制為：**單一 write evaluation ≤ 10 次存取；單一原子 request ≤ 20 次存取**。

#### A. `CreateStudent`
1. `commands/{commandId}` create:
   - `get operators/{uid}` × 1 (`approvedOperator`)
   - `get system/accessLease` × 1
   - `get system/dataHead` × 1
   - `getAfter system/dataHead` × 1
   - `exists students/{studentId}` × 1
   - `getAfter students/{studentId}` × 1
   - `exists studentCodes/{code}` × 1
   - `getAfter studentCodes/{code}` × 1
   小計：**8 次**（≤ 10）。
2. `system/dataHead` update leaf：`getAfter command` (1) + `exists command` (1) = **2 次**。
3. `students/{studentId}` create leaf：`getAfter command` (1) + `exists command` (1) = **2 次**。
4. `studentCodes/{code}` create leaf：`getAfter command` (1) + `exists command` (1) = **2 次**。
5. 寫入 Rules 總計：8 + 2 + 2 + 2 = **14 次**。
6. SDK Commit `VerifyMutation`（針對 lease 之 `approvedOperator`）：**+1 次**。
7. **整筆 commit 總存取：14 + 1 = 15 / 20 次**。

#### B. `ChangeStudentCode`
1. `commands/{commandId}` create:
   - `get operators/{uid}` × 1
   - `get system/accessLease` × 1
   - `get system/dataHead` × 1
   - `getAfter system/dataHead` × 1
   - `get students/{studentId}` × 1
   - `getAfter students/{studentId}` × 1
   - `exists studentCodes/{newCode}` × 1
   - `getAfter studentCodes/{newCode}` × 1
   - `existsAfter studentCodes/{oldCode}` × 1（確認舊索引確實被刪除）
   小計：**9 次**（≤ 10）。
2. `system/dataHead` update leaf：`getAfter command` (1) + `exists command` (1) = **2 次**。
3. `students/{studentId}` update leaf：`getAfter command` (1) + `exists command` (1) = **2 次**。
4. `studentCodes/{newCode}` create leaf：`getAfter command` (1) + `exists command` (1) = **2 次**。
5. `studentCodes/{oldCode}` delete leaf：
   - `getAfter students/{studentId}` × 1
   - `getAfter commands/{commandId}` × 1
   - `exists commands/{commandId}` × 1
   小計：**3 次**（≤ 10）。
6. 寫入 Rules 總計：9 + 2 + 2 + 2 + 3 = **18 次**。
7. SDK Commit `VerifyMutation`（針對 lease）：**+1 次**。
8. **整筆 commit 總存取：18 + 1 = 19 / 20 次**。

單一 write 最大 9（≤10），整筆原子 request 最大 19（≤20），完全合規且具備安全裕度。

---

## 6. 前端與 Repository 契約

### 6.1 `CloudStudentRepository` 介面擴充

```ts
export interface CloudStudentRecord {
  studentId: string;                     // UUID
  studentCode: string;                   // '001'..'999999'
  displayName: string;
  aliases: string[];
  status: 'active' | 'inactive';
  openingBalance: {
    amount: number;
    asOfDate: string;
    note: string;
    createdAt: string;
  };
  currentBalance: number;
  createdAt: string;
  revision: number;
  lastCommandId: string;
  updatedAt: string;
}

export interface CreateCloudStudentInput {
  commandId: string;
  leaseEpoch: number;
  studentId: string;                     // 呼叫端產生之 UUID
  studentCode: string;                   // 欲建立之編號
  displayName: string;
  aliases: string[];
  openingBalance: { amount: number; asOfDate: string; note: string };
}

export interface ChangeCloudStudentCodeInput {
  commandId: string;
  leaseEpoch: number;
  studentId: string;
  expectedRevision: number;
  studentCode: string;                   // 目標新編號
  reason: string;                        // 改號理由
}
```

### 6.2 `CloudStudentsPage` 介面規範

1. **數值排序**：
   名冊依 `parseInt(student.studentCode, 10)` 數值由小到大排序。
2. **缺號列（Gap Rows）**：
   - 範圍：從 `001` 起算，至目前名冊中出現的最大編號（含 `inactive` 停用帳戶）為止。
   - 單一缺號：顯示 `"013 尚無人使用"`。
   - 連續缺號：合併顯示 `"013–020 尚無人使用（8 個號碼）"`。
   - 點擊缺號列：開啟新增帳戶對話框，自動帶入該缺號區間的第一個號碼。
   - 搜尋狀態：若搜尋框有輸入文字，缺號列一律隱藏不顯示。
3. **停用帳戶**：
   - 停用帳戶佔用其編號（不視為缺號），標記「已停用」。
   - 提供改號按鈕，可將停用帳戶改為其他空號以讓出號碼。
4. **改號對話框**：
   - 輸入目標新編號（即時提示正規化後結果）與改號理由（1–500 字元）。
   - 若編號已被佔用，即時顯示衝突提示。
   - 送出 `ChangeStudentCode` 命令，成功後重載名冊。
