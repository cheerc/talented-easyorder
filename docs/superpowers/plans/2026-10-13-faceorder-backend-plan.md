# 刷臉訂餐後端計畫（只寫計畫，尚未授權開工）

日期：2026-10-13。前提：[faceorder-handoff-spec](../specs/faceorder-handoff-spec.md) 的規則已在練習模式實作並驗收（#463、#464 與第三批小修）。對應 talented-faceorder `docs/PLAN.md` §3（Phase 2）。

這份文件只回答「真的接上平板時，資料放哪裡、誰能讀寫、事件怎麼變成交易」。**不是開工授權**；第 7 節的決定做完、第 1 節的前提完成後，才另開實作計畫。

## 1. 前提：正式帳務要先上雲

練習模式（Zustand＋IndexedDB）已經有 M0–M3 的完整帳務：期初、日期 key 菜單、更正／刪除的稽核、關帳版次、重開。正式的 Firebase 路徑（`frontend/src/firebase/`、`firestore.rules`）停在更早的版本：只有 `operators`、`students`、`transactions`、`daily_settlements`，**沒有稽核、沒有日期 key 菜單、沒有 Cloud Functions**。

刷臉的取消會改帳並寫稽核，入帳要讀當天菜單與關帳狀態，所以：

> **B0（前提，非刷臉範圍）**：把 M0–M3 的帳務模型搬到 Firestore（交易、稽核、菜單、關帳版次、餘額重算），另寫計畫。B0 完成前不接真平板。

## 2. 資料結構

時間欄位一律 UTC：Firestore 端用 `Timestamp`（伺服器寫入用 `serverTimestamp()`），進到前端 store 時轉成 `…Z` 的 ISO 字串，和現在的 `normalizeFaceTime` 一致。

| 路徑 | 誰寫 | 內容 |
|---|---|---|
| `faceOrderEvents/{eventId}` | 平板建立；櫃台 PC 回寫結果 | 平板：`deviceId`、`action`（`order`／`cancel`）、`studentId`、選填 `memberName`、`businessDate`、`recognizedAt`、`createdAt`（伺服器時間）、`status: 'pending'`。<br>PC 回寫：`status`（`accepted`／`rejected`）、`reason`、`notice`、`transactionId`、`studentName`、`additional`、`handledAt`、`handledBy`（處理的 PC 操作人）。 |
| `faceRoster/{studentId}` | 櫃台 PC（帳戶有異動時同步） | 只有 `studentId`、`displayName`、`status`。平板註冊時用訂餐編號查名字。 |
| `dailyOrderStatus/{businessDate}/students/{studentId}` | 櫃台 PC（每次訂餐、取消、更正後重算該帳戶） | `orderCount`、`updatedAt`。平板依此決定顯示「正確，訂餐。」或「加訂一份／取消訂餐」。 |
| `faceDevices/{deviceId}` | 平板（自己的那一份） | `lastSeenAt`（伺服器時間，平板每分鐘更新一次）、`appVersion`、`modelVersion`。**在線／離線由 PC 依 `lastSeenAt` 判斷**（例如 3 分鐘內算在線），不再存布林值。 |
| `faceEnrollmentReports/{autoId}` | 平板 | `deviceId`、`studentId`、`status`、`faceCount`、`reportedAt`。PC 收到後更新 `students` 的 `faceEnrollmentStatus`、`faceCount`，處理過的標記 `appliedAt`。 |

為什麼要 `faceRoster` 和 `dailyOrderStatus` 兩個投影：Firestore 規則只能整份文件允許或拒絕讀取，不能只開放某幾個欄位。`students` 文件裡有餘額，平板不能讀，所以另開只放名字與狀態的投影（spec §3 的隱私邊界）。

## 3. 平板的身分與權限

每台平板一個 Firebase Auth 帳號（例如 `faceorder-01@talented.com.tw`），`operators/{uid}` 設 `role: 'kiosk'`、`deviceId: 'faceorder-01'`。

規則要改的地方：

- 現在的 `activeOperator()` 讓任何啟用中的操作人讀寫 `students`、`transactions`。新增 `staffOperator()`＝`activeOperator() && role != 'kiosk'`，**既有的帳務規則全部改用 `staffOperator()`**，平板因此讀不到餘額、交易、報表。
- 平板（`kioskOperator()`）只能：
  - 讀 `faceRoster`、`dailyOrderStatus`；
  - 建立 `faceOrderEvents/{eventId}`：`deviceId` 必須等於自己 operator 文件的 `deviceId`，`status == 'pending'`，欄位只能是上表平板那幾個；**不能更新或刪除**；
  - 讀自己建立的 `faceOrderEvents`（看處理結果）；
  - 寫自己的 `faceDevices/{deviceId}`；
  - 建立 `faceEnrollmentReports`（`deviceId` 同上）。
- 櫃台 PC（`staffOperator()`）可以更新 `faceOrderEvents` 的結果欄位，但只限 `status` 從 `pending` 變成 `accepted`／`rejected`（只能改一次）。

以上全部用 Firestore emulator 規則測試鎖住（現有 CI 已有 emulator job）。

## 4. 事件怎麼變成交易

產品決定是「自動入帳、不經櫃台確認」（spec §1）。有兩種做法：

| | A. 櫃台 PC 自動處理（建議先用） | B. Cloud Function |
|---|---|---|
| 怎麼做 | 開著的櫃台 PC 訂閱 `pending` 事件，直接呼叫現有的 `handleFaceEvent` 規則，交易、稽核、事件結果在同一個 Firestore transaction 寫入 | Function 監聽事件建立，在伺服器端寫交易 |
| 好處 | 規則只有一份（就是練習模式驗收過的那份）；不需要付費方案；交易仍然只由櫃台 PC 寫入 | 櫃台 PC 沒開也能入帳 |
| 代價 | 櫃台 PC 沒開時事件會停在 `pending` | 入帳、取消、餘額重算、關帳鎖要在 Node 端再寫一份並保持一致；需要 Blaze 方案；「交易只由操作人寫入」的規則要開例外 |

晚餐時段櫃台一定開著，所以建議先用 A，B 等真的有無人值守需求再說。

A 的細節：

1. **多台 PC 同時開著**：處理前用 Firestore transaction 讀事件，確定還是 `pending` 才寫入；兩台搶同一筆時只有一台成功，另一台放棄。
2. **重送**：`eventId` 就是文件 ID，平板重送會因為文件已存在而失敗；平板此時改讀那份文件的結果（等同練習模式的「回傳第一次的結果」）。
3. **逾時**：平板送出後等 10 秒（可調）沒有結果，就顯示「還沒有收到後台回覆，請到櫃台確認。」。為了避免使用者到櫃台再訂一次、之後那筆 `pending` 又被處理成重複訂餐，PC 處理時**超過 2 分鐘的 `pending` 事件一律退回**「逾時，請到櫃台。」（以伺服器的 `createdAt` 判斷，不信任平板時鐘）。
4. **營業日**：PC 只接受 `businessDate` 等於自己當下營業日（台北時間）的事件，其他退回「日期不對，請到櫃台。」。

## 5. 驗證要變嚴格的地方（#464 review 留下的）

練習模式只檢查格式；接上真平板時補：

- `businessDate`：必須是真的存在的日期（`2026-99-99` 不行），而且等於 PC 的當天營業日（見 4.4）。
- `recognizedAt`、`reportedAt`：只接受帶時區的 ISO 字串（`Z` 或 `+08:00`），不帶時區、或像 `'1'` 這種會被 `new Date()` 寬鬆解析的字串一律退回；`handledAt` 一律用 PC 時間，不用平板時間。
- `deviceId`：必須是 `faceorder-` 開頭，且等於登入帳號的 `deviceId`（規則層已擋，前端再檢查一次）。
- `memberName`：去頭尾空白，限 20 字。

## 6. 本機資料的上限與快照檢查（#463 review 留下的）

- 練習模式的 `faceEvents` 目前沒有上限。正式版事件存在 Firestore，前端只訂閱**當天**的事件；練習模式則只保留最近 14 個營業日（或最多 500 筆），超過的在存檔時丟掉。
- 快照還原時檢查 `faceEvents`、`faceDevices` 的形狀（必要欄位、型別、`status` 值、時間格式），不合格的整份快照拒絕還原，和其他實體一樣。

## 7. 需要 CheerC 決定的事

1. 第 4 節選 A（櫃台 PC 處理）或 B（Cloud Function）。建議 A。
2. 逾時秒數（建議平板 10 秒、PC 2 分鐘）與平板顯示的文字。
3. 「在線」的判斷時間（建議 3 分鐘內有回報）。
4. B0（正式帳務上雲）的排程：它是刷臉後端的前提，但範圍遠大於刷臉，要先排。
5. 註冊照片上雲（faceorder Phase 3）仍未決定；屬生物特徵資料，需要書面同意與保存期限。這份計畫不含照片同步。

## 8. 分批（決定後再展開成實作計畫）

| 批次 | 內容 | 驗收 |
|---|---|---|
| B0 | 正式帳務上雲（另寫計畫） | M0–M3 驗收步驟在雲端版重跑 |
| B1 | 規則：`staffOperator`／`kioskOperator`、五個集合；平板帳號建立流程 | emulator 規則測試：平板讀不到 `students`／`transactions`，只能建立自己的 `pending` 事件 |
| B2 | 櫃台 PC：投影維護（`faceRoster`、`dailyOrderStatus`）、處理 `pending` 事件、逾時退回、註冊回報套用、平板在線判斷 | 用 emulator 模擬兩台 PC 搶同一筆、重送、逾時、關帳日 |
| B3 | faceorder Phase 2（在 faceorder repo，由它自己的計畫執行） | 真平板在 emulator／測試專案上訂、加訂、取消 |
| B4 | 試營運 | 一個晚餐日真平板＋櫃台並行，日末對帳 |
