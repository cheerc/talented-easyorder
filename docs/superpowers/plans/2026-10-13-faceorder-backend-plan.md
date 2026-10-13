# 刷臉訂餐後端計畫（只寫計畫，尚未授權開工）

日期：2026-10-13。前提：[faceorder-handoff-spec](../specs/faceorder-handoff-spec.md) 的規則已在練習模式實作（#463、#464、#466），並於 2026-10-13 通過本機模擬驗收 FA01–FA10。#465 review 後修訂（見第 4 節的櫃台接手協定）。對應 talented-faceorder `docs/PLAN.md` §3（Phase 2）。

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

- 現在的 `activeOperator()` 讓任何啟用中的操作人讀寫 `students`、`transactions`。新增 `staffOperator()`＝`activeOperator() && role in ['counter', 'admin']`（**正面列舉**，不是「排除 kiosk」），**既有的帳務規則全部改用 `staffOperator()`**（含 `daily_settlements` 的子集合），平板因此讀不到餘額、交易、報表。舊的 operator 文件沒有 `role` 時，B1 先補成 `counter`（遷移腳本＋規則測試），不靠預設值放行。
- 前端 `authService.ts` 的 `isValidOperatorDoc` 目前只接受 `counter`／`admin`；B1 要接受 `kiosk`，並讓 kiosk 帳號登入櫃台網頁時直接拒絕。
- 平板的 operator 文件綁一個 `deviceId`，同一個 `deviceId` 只能綁一個帳號（建立時檢查唯一）；平板不能改自己的 operator 文件。
- 平板（`kioskOperator()`）只能：
  - 讀 `faceRoster`、`dailyOrderStatus`；
  - 建立 `faceOrderEvents/{eventId}`：`deviceId` 必須等於自己 operator 文件的 `deviceId`，`status == 'pending'`，`createdAt` 必須是 `Timestamp` 且等於 `request.time`（伺服器時間，不能偽造），欄位只能是上表平板那幾個；**不能更新或刪除**；
  - 讀 `deviceId` 等於自己的 `faceOrderEvents`（看處理結果；`list` 查詢也必須帶這個條件）；
  - 寫自己的 `faceDevices/{deviceId}`；
  - 建立 `faceEnrollmentReports`（`deviceId` 同上）。
- 櫃台 PC（`staffOperator()`）可以更新 `faceOrderEvents`，但只限 `resource.data.status == 'pending'`、新的 `status` 是 `accepted`／`rejected`，而且 `affectedKeys()` 只能是結果欄位（`status`、`reason`、`notice`、`transactionId`、`studentName`、`additional`、`handledAt`、`handledBy`）；請求欄位（`deviceId`、`action`、`studentId`、`memberName`、`businessDate`、`recognizedAt`、`createdAt`）不可變。終態不能再更新，任何人都不能刪除。
- `faceEnrollmentReports`：平板只能建立；只有 staff 能寫 `appliedAt`（只能寫一次）；平板不能修改或刪除。報告內容沒有真實性檢查，和練習模式同樣信任平板，這是已知的假設。

以上全部用 Firestore emulator 規則測試鎖住（現有 CI 已有 emulator job）。

## 4. 事件怎麼變成交易

產品決定是「自動入帳、不經櫃台確認」（spec §1）。有兩種做法：

| | A′. 櫃台 PC 自動處理（建議先用） | B. Cloud Function |
|---|---|---|
| 怎麼做 | 開著的櫃台 PC 訂閱 `pending` 事件，直接呼叫現有的 `handleFaceEvent` 規則，交易、稽核、事件結果在同一個 Firestore transaction 寫入 | Function 監聽事件建立，在伺服器端寫交易 |
| 好處 | 規則只有一份（就是練習模式驗收過的那份）；不需要付費方案；交易仍然只由櫃台 PC 寫入 | 櫃台 PC 沒開也能入帳 |
| 代價 | 櫃台 PC 沒開時事件會停在 `pending` | 入帳、取消、餘額重算、關帳鎖要在 Node 端再寫一份並保持一致；需要 Blaze 方案；「交易只由操作人寫入」的規則要開例外 |

晚餐時段櫃台一定開著，所以建議先用 A′，B 等真的有無人值守需求再說。

**命名注意**：talented-faceorder `docs/PLAN.md` §3.5 的「方案 A」是「PC 操作人員確認後才建立交易」，已被 2026-10-13 的「自動入帳」決定取代；這裡的 A′ 是「櫃台 PC 自動處理、不經人工確認」。faceorder 端要同步更新 §3.3（逾時、只在線上送出，見下）與 §3.5，避免兩個 repo 用同一個名字指不同的協定。

**沿用規則的方式**：現在的 `handleFaceEvent`（`store/posActions/faceActions.ts`）直接讀 Zustand、產生 UUID、在回傳前就寫入交易／稽核／事件，不能原封不動放進會重試的 Firestore transaction callback。B2 要先把它拆成：

- 一個**無副作用**的規則函式：輸入「transaction 裡讀到的帳戶、菜單、關帳狀態、取消目標、事件」，輸出「要寫的交易／稽核／事件結果」；
- 練習模式和雲端各一個 adapter：練習模式直接套進 store；雲端在 transaction 裡寫入，commit 成功後才更新本機畫面。

兩邊共用同一份規則函式和測試。

**操作人欄位**：練習模式的交易與稽核 `operatorId` 是平板編號；現行規則要求 `operatorId == request.auth.uid`。雲端版改成 `operatorId`＝實際處理的櫃台 PC 帳號（`request.auth.uid`），另存 `deviceId`（平板編號），畫面上的「刷臉平板 01」改依 `deviceId` 顯示。這在 B0 重寫交易規則時一起定案。

A′ 的細節：

1. **多台 PC 同時開著**：處理前用 Firestore transaction 讀事件，確定還是 `pending` 才寫入；兩台搶同一筆時只有一台成功，另一台放棄。
2. **重送**：`eventId` 就是文件 ID，平板重送會因為文件已存在而失敗；平板此時改讀那份文件的結果（等同練習模式的「回傳第一次的結果」）。
3. **逾時與櫃台接手（#465 review 阻擋項目）**：只調逾時秒數不夠。反例：平板 10 秒逾時叫人到櫃台 → 櫃台另訂一份 C → PC 恢復後在 2 分鐘內處理原事件 E → 同一個意圖變成兩份；而產品允許同帳戶加訂，不能靠「已有訂單就拒絕」擋。所以要讓「自動處理 E」和「櫃台替這個人登記」**在同一份文件上競爭**：
   - 帳戶文件 `students/{studentId}` 加一個欄位 `lastCounterActivityAt`。櫃台登記**這個營業日的訂餐**（含加訂與取消訂餐；繳費、更正其他日期的帳、刷臉處理都不算）時，在同一個 transaction 裡把它設成 `request.time`，並記下 `lastCounterActivityDate`（營業日）。只有餐點意圖會推高它，避免繳費或更正昨天的帳誤擋無關的刷臉。
   - 自動處理 E 的 transaction 也讀這份帳戶文件（只讀，不寫任何欄位）：`lastCounterActivityDate` 等於 E 的營業日且 `lastCounterActivityAt` **大於或等於** E 的 `createdAt`，就把 E 退回「櫃台已經處理過這個帳戶，請到櫃台確認。」，不入帳。Firestore transaction 會讓兩條路徑在帳戶文件上序列化，誰先 commit 誰算數。
   - 櫃台畫面（F1）選到某人時，如果這個人有 `pending` 的刷臉事件，顯示「平板訂餐處理中」與兩個選項：「等它處理」或「改由櫃台處理」。「改由櫃台處理」的 transaction **必須先讀事件文件，確認 `status` 仍是 `pending`**；不是的話中止，改顯示既有結果（`accepted` 就顯示已入帳那一份，不另建）。確認仍是 `pending` 時，**在同一個 transaction 裡**完成三件事：把 E 改成 `rejected`（理由「已由櫃台接手」）、建立櫃台的交易、更新 `lastCounterActivityAt`。這樣畫面上的「處理中」即使已過期，也不會把已入帳的 E 蓋成退回；中途失敗也不會留下「E 已退回、櫃台單卻不存在」。
   - 「等它處理」＝畫面訂閱這個 `eventId`：`accepted` 時顯示結果並關閉提示；`rejected`（含逾時）時顯示理由，並直接打開這個人的訂餐畫面，讓櫃台接著登記，不會無聲消失。提示上顯示事件已等了多久。
   - 櫃台側的鏡像保護：櫃台替某人建立訂餐的 transaction 也讀這個人當天的 `dailyOrderStatus`；當天已經有刷臉入帳的份數時，先顯示「今天已經刷臉訂了 N 份」，再問是否加訂（加訂合法，不能硬擋）。
   - PC 處理時，**超過 2 分鐘的 `pending` 事件一律退回**「逾時，請到櫃台。」（以伺服器的 `createdAt` 判斷）。這是上面兩道保護之外的收尾，不是唯一的保護。
4. **平板只在線上送出，不補送**：平板用必須連線的寫入（例如 transaction 建立事件文件），**不使用 Firestore SDK 的離線寫入佇列**，以免恢復連線後把舊意圖用新的伺服器 `createdAt` 補送成新事件。送出後到顯示「請到櫃台」之前，只能用**同一個 `eventId`** 重試；一旦顯示「還沒有收到後台回覆，請到櫃台確認。」，這個事件就放棄，平板之後不再送它。寫入其實成功、只是回覆遺失的情況，E 會在 Firestore 留下 `pending`，由第 3 點的接手協定處理。
5. **營業日**：PC 只接受 `businessDate` 等於自己當下營業日（台北時間）的事件，其他退回「日期不對，請到櫃台。」。
6. **取消時錢留在帳戶**：沿用 spec §2 的規則（有收款的改成同金額繳費），B2 驗收要明列。
7. **實作約束**：transaction 重試用盡（`ABORTED`）不能當成成功，事件維持 `pending` 交給下一輪或接手協定；平板（重）送一律用 `create()`，不准 `set` 覆寫既有事件；同一個成員幾秒內重複送出，由平板端去重。

## 5. 驗證要變嚴格的地方（#464 review 留下的）

練習模式只檢查格式；接上真平板時補：

- `businessDate`：必須是真的存在的日期（`2026-99-99` 不行），而且等於 PC 的當天營業日（見 4.4）。
- `recognizedAt`、`reportedAt`：只接受帶時區的 ISO 字串（`Z` 或 `+08:00`），不帶時區、或像 `'1'` 這種會被 `new Date()` 寬鬆解析的字串一律退回；`handledAt` 一律用 PC 時間，不用平板時間。
- `deviceId`：必須是 `faceorder-` 開頭，且等於登入帳號的 `deviceId`（規則層已擋，前端再檢查一次）。
- `memberName`：去頭尾空白，限 20 字。

## 6. 本機資料的上限與快照檢查（#463 review 留下的）

- 練習模式的 `faceEvents` 目前沒有上限。正式版事件存在 Firestore，前端只訂閱**當天**的事件；練習模式則只保留最近 14 個營業日（或最多 500 筆），超過的在存檔時丟掉。
- 快照還原時檢查形狀，不合格的整份快照拒絕還原，和其他實體一樣：`faceEvents` 逐筆檢查必要欄位、型別、`status`／`action` 值、時間格式；`faceDevices` 逐台檢查 key 和 `deviceId` 一致、以 `faceorder-` 開頭、`lastSeenAt` 時間格式。

## 7. 需要 CheerC 決定的事

1. 第 4 節選 A′（櫃台 PC 自動處理）或 B（Cloud Function）。建議 A′。
2. 逾時秒數（建議平板 10 秒、PC 2 分鐘）、平板顯示的文字，以及櫃台「平板訂餐處理中」的兩個選項文字。
3. 「在線」的判斷時間（建議 3 分鐘內有回報）。
4. B0（正式帳務上雲）的排程：它是刷臉後端的前提，但範圍遠大於刷臉，要先排。
5. 註冊照片上雲（faceorder Phase 3）仍未決定；屬生物特徵資料，需要書面同意與保存期限。這份計畫不含照片同步。

## 8. 分批（決定後再展開成實作計畫）

| 批次 | 內容 | 驗收 |
|---|---|---|
| B0 | 正式帳務上雲（另寫計畫） | M0–M3 驗收步驟在雲端版重跑 |
| B1 | 規則：`staffOperator`／`kioskOperator`、五個集合；舊 operator 補 `role`；平板帳號建立流程（`deviceId` 唯一）；`isValidOperatorDoc` 接受 kiosk | emulator 規則測試：平板讀不到 `students`／`transactions`／`daily_settlements`；只能建立自己的 `pending` 事件且 `createdAt == request.time`；結果欄位只能從 `pending` 改一次、請求欄位不可變；`appliedAt` 只有 staff 能寫 |
| B2 | 拆出無副作用的刷臉規則函式與兩個 adapter；櫃台 PC：投影維護（`faceRoster`、`dailyOrderStatus`）、處理 `pending` 事件、`lastCounterActivityAt`、F1「平板訂餐處理中」與接手、逾時退回、註冊回報套用、平板在線判斷 | emulator：兩台 PC 搶同一筆、重送、逾時、關帳日；**平板逾時後 10–120 秒內櫃台另訂、PC 隨後恢復**（E 必須退回，只有一份）；櫃台按「改由櫃台處理」與自動處理同時發生（含畫面還顯示「處理中」但 E 已入帳）；「等它處理」後 E 被逾時退回；繳費或更正昨天的帳不會誤擋刷臉；取消時錢留在帳戶 |
| B3 | faceorder Phase 2（在 faceorder repo，由它自己的計畫執行；含只在線上送出、逾時後放棄事件） | 真平板在 emulator／測試專案上訂、加訂、取消；**斷網送出、恢復連線後不會補送** |
| B4 | 試營運 | 一個晚餐日真平板＋櫃台並行，日末對帳 |
