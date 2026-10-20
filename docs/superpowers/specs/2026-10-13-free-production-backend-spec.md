# EasyOrder 零費用正式後端規格

日期：2026-10-13。狀態：**目標規格已定義，尚未實作、部署或通過正式上線驗收**。

本文件是 PC 雲端正式版的設計權威；[實作階段計畫](../plans/2026-10-13-free-production-backend-plan.md)定義交付順序。本輪只交付文件，不建立雲端資源、不變更 payroll、不開通計費。

## 1. 授權、來源與完成定義

使用者已授權本 session 自行決定架構與實作範圍，無法決定的事項集中在本文最後。此授權取代 [PR #469](https://github.com/cheerc/talented-easyorder/pull/469) 中 R／U 項目需逐項再詢問的規劃限制；不代表任何功能已實作。

使用者要求：唯一公司內部使用；服務實際支出為零；學生建檔、訂餐整個流程、帳務統計全部可正式使用；沿用 Google 登入與既有 `*.talented.com.tw` 網域。**最新修正：可有多個獲准的 Google 帳號，所有帳號權限相同，同一時間只能有一個 Google 帳號使用系統，不做 RBAC。** Android 另寫 spec，本輪僅留接點。

證據基線：本機程式 `8cbf5f9df763b9dfe9efd3bc5bc1521149082fc5`；#469 已合併為 `4415bbd4eee74517e8912ad1bcbc826a844a66f0`，其新增 [BACKEND-HANDOFF固定版本](https://github.com/cheerc/talented-easyorder/blob/4415bbd4eee74517e8912ad1bcbc826a844a66f0/docs/BACKEND-HANDOFF.md) 從 GitHub 讀取，本機起點尚未包含該文件。#469 是現況盤點；[prototype workflow spec](frontend-prototype-workflow-spec.md) §5–§6 是已驗收帳務行為來源。舊 Firebase schema、ops 指引不能取代本文的新雲端契約。

完成意義：在正式網域用獲准帳號登入，建立真實名單與期初、設定晚餐與現金、訂餐／繳費／取消／更正、核現金、關帳、跨日查詢與統計；登出、換電腦、重啟後資料仍在；備份可驗證還原；無帳務寫入繞過規則；沒有付費雲端依賴。必須完成所有 P00–P18 與本人試營運，不以「已有 repository」或 CI 綠燈代替。

## 2. 選型定案與零費用邊界

採 **Firebase Hosting（傳統靜態 Hosting）＋ Firebase Authentication Google provider ＋ Cloud Firestore，獨立 Spark 專案**。不是 Firebase App Hosting。React／Vite／Zustand、Firebase Web SDK 與 emulator 測試沿用。

- 新建獨立 EasyOrder 專案，不連結 billing account，不啟用 Blaze，不使用試用金。不得把 payroll 現有按量計費專案降級、搬移、共用或部署 EasyOrder rules 到它。
- 不使用 Functions、Cloud Run、Cloud Storage、Extensions、付費備份、PITR、TTL delete、SMS、計費型監測或排程。備份存在公司現有設備；Google 登入不用手機簡訊。
- 前端部署 Firebase Hosting，預設網域 `easyorder.talented.com.tw`；若該子網域已占用，選未使用的 `order.talented.com.tw`，不碰 payroll 子網域。先提供 Firebase 預設 HTTPS 網域驗證，再切自訂網域。現有母網域續約與公司網路是既有成本，本案不新增購買；若要求連既有成本都歸零，另議。
- Firestore 首選 `asia-east1`（台灣）；建立前確認 console 提供該位置，一旦有正式資料不得自行換 region。開發與 CI 用 emulator；上線前 smoke test 在獨立 Spark 驗證專案或正式空庫完成，不混入營運資料。
- 不沿用 Vercel Hobby：官方限制 personal/non-commercial，依本案公司營運用途判定不適用。Cloudflare Pages 可以靜態託管，但本案不增加另一個供應商與跨站登入設定。
- 「免費」指選定方案不自動產生服務費，**不保證無限容量或永不中斷**。額度耗盡停止相應服務，不自動升級。只有有權管理 GCP billing 的人能破壞此成本邊界；日常操作者不給 cloud IAM 管理權。

2026-10-13 官方資料核對（上線前 P17 再核對，不依舊文宣推測）：

| 服務 | Spark 免費額度／界線 | 本案處理 |
|---|---|---|
| Firestore | 1 GiB 儲存、每日 50,000 reads／20,000 writes／20,000 deletes、每月 10 GiB outbound；免費額度限專案一個 database | 只用 `(default)`；index、規則讀取、重試與訂閱都納入估算 |
| Hosting | 10 GB 儲存、10 GB／月傳輸 | 舊 release 定期刪除但保留目前與前一版；無圖片上傳服務 |
| Google Auth | Spark 可用 Google/social sign-in，不需 payment information | 精確 UID 白名單；不升級 Identity Platform 或開額外計費功能 |
| 超額 | Spark 依產品日／月額度恢復週期停止服務，非付費續用 | Firestore 日額度約美國太平洋午夜重設，不能假設台北午夜；Hosting 依月額度 |

來源：[Firebase plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)、[Firestore pricing](https://firebase.google.com/docs/firestore/pricing)、[Firestore locations](https://firebase.google.com/docs/firestore/locations)、[Hosting quotas](https://firebase.google.com/docs/hosting/usage-quotas-pricing)、[custom domain](https://firebase.google.com/docs/hosting/custom-domain)、[Vercel fair use](https://vercel.com/docs/limits/fair-use-guidelines)、[Storage billing](https://firebase.google.com/docs/storage/faq-and-troubleshooting)、[managed export](https://firebase.google.com/docs/firestore/manage-data/export-import)。不把 payroll 使用 Functions、Drive 排程備份的作法當成本案免費保證。

## 3. 使用範圍與操作行為

### 3.1 必須交付

- F3 學生／共用帳戶：手動建檔、編號與前導零、姓名、別名、明確輸入期初（含零／負數）、期初日期與說明；修改姓名／別名、停用／恢復、可追溯的期初更正。停用帳戶仍可查帳及補繳／更正，禁止新增餐點。
- F4 供應商逐筆建立、編輯聯絡資料、停用／恢復、移除。停用才可移除；雲端保留稽核用 tombstone 與歷史快照，正常清單不再出現；不是清除歷史交易。
- F3 按日菜單與當日開帳。每天只有晚餐；未設定菜單可沿用最近較早日期，F1 提醒但不阻擋；尚無任何菜單時擋今日餐點，仍可繳費與明確輸入的其他餐點。
- F1 保留 Q/W/E、重複訂餐確認、每次一份、其他餐點、繳費、櫃台現金收入／支出、成功後 5 秒撤回；換人與取消不殘留金額。正式版必須等待雲端確認才顯示成功。
- F2 今日／本週／本月，份數分今日餐點與其他餐點，餐費、實際收現、支出、淨現金、筆數；依帳戶合併／原始明細；全日點現金、差異、關帳與重開。
- F5 按帳戶與日期查交易、作廢原單、前後值與理由、結帳所有版次。匯出 CSV 與列印維持 `domain/ledgerExport.ts` 的既有欄位／兩種模式。
- 每個業務異動、關帳／重開、應用內 CSV 匯出／列印發起、備份匯出皆有操作者 UID、email 快照、伺服器時間與結果。列印僅能記「發起」，不能聲稱印表機已印出；無法監控瀏覽器自有列印或截圖。

### 3.2 不納入本輪

Android SDK、平板登入、刷臉事件處理／自動入帳、人臉資料／照片上雲、設備心跳、背景 worker、多個 Google 身分同時營運、角色權限、線上付款、電子發票、完整會計總帳、多校區、多餐次、菜單圖片、自動匯入舊 Excel、離線自動補單。保留既有 prototype 訓練模式，正式版不顯示模擬刷臉、清交易或重設成範例。

## 4. 身分與全公司單一使用中帳號

### 4.1 白名單與初始化

Google sign-in 後要求 `email_verified=true`、provider 為 Google，且 `operators/{uid}` 的 `active=true`、email 精確相符。**只限制 email 網域不足以授權**；可核准特定 Gmail 或公司 Google 帳號，不推定每個公司網域帳號均有權。操作者文件無 `role` 或 permission matrix，核准者權限相同。

新帳號先經 Google Auth 建立 UID，未核准前只能看到「尚未取得使用權」，不能讀業務資料。專案維護者用 Firebase console 或本機受保護管理腳本加入／停用 UID；應用端不能自授權、改白名單或列出全部未核准者。維護者的部署／復原 IAM 職責不是產品 RBAC。至少準備兩個等權測試 UID 驗證互斥。

### 4.2 使用權租約

`system/accessLease`：`holderUid: string|null`、`epoch: integer`、`updatedAt: Timestamp`。不儲存 `expiresAt`；有效期限由 Rules 以 `updatedAt + duration.value(5, 'm')` 推導。Acquire、Renew、Release 都以 Firestore `serverTimestamp()` 寫入 `updatedAt`，Rules 驗證其解析值等於 `request.time`。空租約初始化的 `updatedAt` 不授予任何使用權；第一次 client 狀態轉換必須使用伺服器時間。

- `holderUid == null` 或 `updatedAt + duration.value(5, 'm') <= request.time` 才能取得；`epoch` 必須加一，UID 必須為本人。有效界線是嚴格大於：到達 `updatedAt + 5 分鐘` 時已逾期。
- 持有帳號每 60 秒續約；背景頁可能停 timer，逾期即失去權限。更新只能延長本人仍有效租約，不能修改 epoch。多頁協調只選一頁續約；即使協調失效，Rules 仍是權威。UI 只用 server-confirmed `updatedAt` 顯示估計期限；本機時鐘與 timer 不授予、延長或證明使用權。
- B 帳號登入 Firebase 成功不等於獲得系統使用權；A 仍使用時 B 只顯示「目前有人使用，請對方登出或等待逾時」，不載入名單與帳務，不自動搶占。重新檢查須限流（至少 15 秒）。
- A 登出先處理送出中的結果確認，再用目前 server snapshot 的 epoch 作 `expectedEpoch` 釋放租約（`holderUid=null`、`epoch+1`、`updatedAt=serverTimestamp()`），最後 Firebase signOut／清快取。client transaction 若目前文件 epoch 與 `expectedEpoch` 不同就中止；這是防舊畫面操作的 client 前置檢查，不是 Rules 可見的欄位。Rules 仍以文件原持有人及合法狀態轉移為權威。釋放失敗仍可本機登出，至多等租約到期，不宣稱已完成交接。
- 關閉視窗／斷電不依賴 unload 釋放；最長等待 5 分鐘。逾期後 B 取得新 epoch，A 舊頁面的寫入全部拒絕。
- 同一 UID 的兩個分頁／電腦可操作同一份帳，視為同一帳號；Firestore revision 防衝突。任一頁「登出」釋放全帳號使用權，其餘頁必須回登入遮罩並清資料。此處限制的是同時活躍的 Google 身分，沒有把多人共用一個帳號偽稱為可辨識每個真人。
- Auth token 不會因租約失效而立即撤銷；安全承諾是 **每次伺服器讀寫都檢查當下使用權**。無法收回使用者已看到／下載的資料。

租約 Rules 狀態機（不使用業務 command）：維護工具先建唯一文件，`holderUid=null`、`epoch=0`，client create/delete 一律拒絕。每次 client update 只允許 `holderUid`、`epoch`、`updatedAt`，`updatedAt == request.time`，且呼叫者須為有效白名單；client 寫 `serverTimestamp()`，不得送本機產生的絕對時間。Acquire 只准舊 `holderUid == null` 或 `resource.data.updatedAt + duration.value(5, 'm') <= request.time`，新 `holderUid=auth.uid`、`epoch=舊值+1`。Renew 只准舊 `holderUid == auth.uid` 且 `resource.data.updatedAt + duration.value(5, 'm') > request.time`，`holderUid`／`epoch` 不變。Release 只准舊 `holderUid == auth.uid`，新 `holderUid=null`、`epoch=舊值+1`。Acquire／Renew／Release 的 client transaction 都先讀 server lease 並比對 caller 傳入的 `expectedEpoch`；不一致即在寫入前中止。此為 client 的 stale-view guard，`expectedEpoch` 不存在 lease 文件，也不是 Rules 可觀察條件。Rules 只根據 `resource.data` 的舊 holder／epoch、要求的新 holder／epoch 與 `updatedAt == request.time` 驗證狀態轉移；B 取得後舊 holder 已是 B，A 的 release 因 old-holder 檢查失敗。以上每種轉換都把 `updatedAt` 設為 `request.time`；其他狀態變更全部拒絕。維護復原只建立空租約，不從備份恢復占用狀態。

Rules：讀 operator 僅可讀本人；有效白名單者可讀不含個資的 lease 占用狀態；每次業務讀取與業務寫入必須同時滿足 `operators/{uid}.active == true`、白名單 email／provider 吻合、`lease.holderUid == request.auth.uid`、`lease.updatedAt + duration.value(5, 'm') > request.time`；所有業務 command 還須 `leaseEpoch == lease.epoch`。寫入可透過新 command 的集中規則與每個投影的強制 counterpart 鏈證明上述條件，不能省略 auth 檢查。App 監聽 lease、停用／token 更新事件，失去使用權立即 unsubscribe、遮罩與清記憶體；被 Rules 拒絕時也做相同處理。UI 可用 server-confirmed `updatedAt` 計算顯示期限，但本機時鐘／倒數僅是提示；業務授權只由每次 Firestore Rules 對伺服器 `request.time` 的檢查決定。

## 5. 儲存模型與現有前端對映

使用單公司 namespace，不先建多租戶系統。以下是**新 schemaVersion=1**，不直接沿用舊 Firestore schema。每筆 mutable head 都有 `revision`、`lastCommandId`、`updatedAt`；由 command 驅動的欄位不允許任意 set。金額以整數 TWD 儲存，`abs <= 1,000,000,000`，累加亦檢查界線；單筆非負餐費／收款最多 1,000,000，付款必須大於零。姓名 1–100 字、別名最多 10 個且各 100 字、備註／理由 1–500 字（非必填備註可空）。依 P06b 決策，學生識別區分為內部穩定鍵 `studentId`（UUID，自建立起永不改變、不含 `/` 且非 `__cashier__`）與畫面編號 `studentCode`（唯一正規形式 `001`–`999999`，Rules regex `^(00[1-9]|0[1-9][0-9]|[1-9][0-9]{2,5})$`，由 `studentCodes/{code}` 唯一索引集合保證不重複；支援修改與缺號列出）。

Firestore 時間為伺服器 Timestamp，repository adapter 輸出 UTC ISO `…Z` 給既有 domain／備份。營業日獨立為台北 `YYYY-MM-DD`。不可使用瀏覽器時間決定稽核、租約或排序；本機時間僅可作 diagnostic。

| 文件路徑 | 核心內容／責任 | 前端對映 |
|---|---|---|
| `operators/{uid}` | uid、email、displayName、active；維護者管理 | 取代舊 counter/admin 驗證 |
| `system/accessLease` | §4 使用權 | AuthGate／登入交接 |
| `system/dataHead` | schemaVersion、datasetId、seq、lastCommandId、maintenance、goLiveDate | 全域 command 序號與復原隔離 |
| `students/{studentId}` | studentId（UUID）、studentCode（正規化編號）、displayName、aliases、status、openingBalance `{amount,asOfDate,note,createdAt}`、currentBalance、createdAt、revision | `StudentAccount`；face 欄預設 none/0、不接受裝置寫入 |
| `studentCodes/{studentCode}` | 唯一索引：studentId（UUID）、lastCommandId、updatedAt；保證 studentCode 不重複 | 唯一索引，CreateStudent 建立、ChangeStudentCode 原子換新刪舊 |
| `vendors/{vendorId}` | name、phone、note、status、deleted、createdAt、revision | `Vendor`；正常清單排除 deleted |
| `days/{YYYY-MM-DD}` | status、revision、menu 或 null、openingCash 或 null、開帳人／時間、totals、lastSettlementRevision | `menusByDate`、`DailyCashSession`、businessDateStatuses 的唯一雲端來源 |
| `transactions/{transactionId}` | 現行有效交易欄位＋`status:active\|voided`、revision、createdAt、createdSeq、operatorUid/email、source、cash metadata | `LedgerTransaction`；不保存 afterBalance／同步佇列狀態為權威 |
| `commands/{commandId}` | immutable：kind、seq、actor、leaseEpoch、committedAt、businessDate（nullable）、studentId（nullable）、固定型別 targets、before/after、reason、cashEffect、inputFingerprint | LedgerAuditEvent 投影＋新增／設定異動稽核＋冪等 receipt |
| `days/{date}/settlements/{revision}` | immutable：closed/reopened、當時 totals、opening/expected/counted/difference、note、actor、sourceSeq、時間、前版參照 | `DailySettlement`；重開亦新增一版 |

commands 的共用查詢欄位一律存在：studentId 在學生／期初／學生交易命令為該 ID，櫃台收支為 `__cashier__`，RecordExport／RecordPrint 等於 payload scope 的 studentId，其他為 null；businessDate 在交易／日期命令為目標營業日，CorrectOpening 為原 asOfDate，RecordExport 為 null，RecordPrint 為 payload 的日期 anchor，其他名單／供應商命令為 null。committedAt 永遠是實際提交時間，不能拿目標日期冒充操作發生時間。targets 是 kind 限定的具名欄位，例如 transactionId/studentId/dayId/settlementRevision，非任意字串路徑陣列。

`dataHead.maintenance`是控制面覆蓋旗標，只有維護者IAM可以切換，**不屬於業務重播狀態**；operator command必須保持它不變且只能在false時成立。正常command只更新seq/lastCommandId/updatedAt，其餘head metadata固定。備份重播核對業務seq/ID與投影，不要求還原維護旗標、Auth白名單或lease；復原時明確設定maintenance=true，完成對帳後由維護者設false。此安排沿用已讀head，不另增加Rules存取文件。

交易保留既有 `type=order|payment|expense`、`studentId`、`mealPrice`、`paidAmount`、`amount`、name/menu/vendor 快照、note、otherItemName。新建交易 `operatorId` 對映 UID；更正 actor 在 command，原始建立人不覆寫。`sourceDevice='pc'`；保留既有 `'ipad_handoff'` 相容字串供未來 adapter，不在本輪接受 Android 寫入。`depositAmount/unpaidAmount/afterBalance` 由有效資料推導。依 U2b／P08 定稿，程式內部識別字（如 `bentoCount`、`mealKind: 'bento'`、CSV 欄名 `bento_count` 等）維持不變，對應使用者可見之「今日餐點」（當日菜單那一項），避免改名牽動 Rules、schema 與備份格式；使用者可見介面則一律使用「今日餐點」。

`days.menu` 包含現有 TodayMenu 欄位與 `inheritedFromDate`（或 null）。EnsureDay 初始 totals=0、status=open、openingCash=null；若採沿用菜單，讀最新較早 menu 並經獨立設定 command 寫入當日快照。規則驗證來源文件、日期不晚於當天且內容吻合；查找「最新較早」由 repository query 完成。菜單異動不改已售餐點快照。選單設定與訂單之間 revision 變動時重新確認價格，不能默默採新價。

Cloud store 不持久化整包 Zustand 帳務。伺服器讀回資料才更新 UI；prototype 保留原 persist，命名空間與正式版分離。正式模式缺 Firebase config 必須顯示設定錯誤，不可無聲降級 local-only。舊 firebase repository、schema、裸 setter 及離線 batch 寫路徑須移除或明確只供 prototype，不能同時有兩套正式寫入器。

## 6. Command 與 Rules：可驗證的帳務邊界

### 6.1 固定型別 command

新介面（計畫中新建，不宣稱現有 symbol）：

```ts
commitCommand(input: BusinessCommand): Promise<CommandResult>
readCommand(commandId: string): Promise<CommandReceipt | null>
```

`BusinessCommand` 帶穩定 UUID commandId、kind、expectedRevision(s)、leaseEpoch、型別化 payload；actor 與時間從 Auth／serverTimestamp 注入。結果只有 committed（含 seq／receipt）或明確錯誤；網路逾時則 pending-unknown，不等於失敗。錯誤碼至少有 ACCESS_BUSY、LEASE_LOST、UNAUTHORIZED、OFFLINE、UNKNOWN_RESULT、REVISION_CONFLICT、DAY_CLOSED、INVALID_INPUT、QUOTA_EXCEEDED、MAINTENANCE、UNSUPPORTED_SCHEMA。

| kind | 固定受影響文件（另加 command＋dataHead） | 驗證重點 |
|---|---|---|
| CreateStudent／EditStudent／SetStudentStatus | student（CreateStudent 另建 studentCodes 索引） | studentId 為 UUID 穩定鍵；CreateStudent 同步建立 studentCodes 唯一索引；不可直接改 balance；停用不刪歷史；SetStudentStatus 理由必填 1–500 字（停用仍保留編號） |
| ChangeStudentCode | student＋studentCodes/{newCode}（create）＋studentCodes/{oldCode}（delete） | 理由必填 1–500 字（command.reason == payload.reason）；允許停用帳戶改號；原子刪舊建新索引；兩帳戶互換號碼須經暫時空號分兩次；舊索引刪除為 §6.3 唯一 client delete 例外 |
| CorrectOpening | student＋期初日 day | 原日期不改、理由必填、該日須可寫；餘額加期初差額；不增加收現 |
| SaveVendor／RemoveVendor | vendor | revision、防整陣列覆寫、移除須先停用 |
| EnsureDay／SetDayMenu／SetOpeningCash | day | 合法台北日期、未關帳；opening 明確確認且非負，沿用既有 20,000 上限 |
| CreateOrder／CreatePayment | transaction＋student＋day | 非負整數、payment>0、order 帳戶 active、三方 delta 一致 |
| CreateCashMovement | transaction＋day | expense、cashier sentinel、收入或支出恰一方向>0、理由 |
| CorrectTransaction／VoidTransaction／CancelKeepDeposit／CancelRefund／Undo | transaction＋student（expense 無）＋day | expectedRevision、理由、前後值、對應日未關帳；不改帳戶歸屬studentId／原營業日／建立時間 |
| CloseDay／ReopenDay | day＋新的 settlement | 舊版不改、版號+1、統計與當下 head 一致、理由／差額 |
| BackfillOpeningCash | day | 只限早於台北今天、不早於上線日、未關帳且尚無開帳現金的既有營業日；開帳 0–20,000、理由必填 1–500 字；不補登交易（[P11 契約 §10](2026-10-17-cloud-day-close-contract.md#10-補開帳backfillopeningcash)） |
| RecordExport／RecordPrint | 僅更新 dataHead 與 command | 不寫業務投影或報表資料；payload 保存有效 Gregorian 日期的完整 inclusive 範圍（最多31日）、帳戶 scope（UUID 或 null）與固定快照 sourceSeq；settlements／post-close-entries 僅允許 all scope。Print 另保存範圍內的 businessDate anchor。Rules 綁定實際 before／after head；sourceSeq 不得大於提交前 head.seq；同 ID 不同範圍、scope 或 H 拒絕 |
| RecordBackup | 僅更新 dataHead 與 command | 記錄已驗證的本機備份發起與來源區間，不嵌入整份備份 |

取消已 voided 的交易拒絕（同 command 重送則回原 receipt）。payment 更正仍須>0，改成零使用作廢；order 餐費可零、收款可零；expense 收入 `mealPrice=0,paidAmount>0`，支出相反。CancelKeepDeposit 在原 paidAmount>0 時將有效列改 payment、mealPrice=0；paidAmount=0 則 void，不能建立零元 payment。一般 CorrectTransaction 只准既有 mealPrice/paidAmount/note，不跨帳戶、不任意改 type；取消專用 kind 才准 order→payment。P10a 實作註記：CorrectTransaction 的 payload 固定為 `{ mealPrice, paidAmount, amount, note, reason }`。order／payment／expense 的 `amount` 是衍生值（`paidAmount − mealPrice`，payment 為 `paidAmount`），必須與前兩欄一致；退款列的 `mealPrice`、`paidAmount` 固定為 0，`amount` 才是要更正的欄位。Undo 的 targets 一律含 `studentId`（櫃台收支為 `__cashier__`），學生列的 `expectedRevisions` 另含 `student`。P14 備份的 replay validator 依同一形狀驗證。

### 6.2 原子提交、序號、冪等

每次 `runTransaction` 先讀 receipt、dataHead、全部 old heads，完成所有 reads 才開始 writes。已存在 commandId 且正規化輸入相同，回原結果；不同 inputFingerprint 拒絕。fingerprint 用於誤重用 ID 偵測，**不是安全憑證**；Rules 必須驗 payload 與前後狀態。

成功一筆 command：head.seq+1、head.lastCommandId=commandId；所有目標 revision+1、lastCommandId 相同；command.seq 等於新 head.seq。command 內有完整固定目標的 before/after（包括 server timestamp），不使用可任意指定路徑的批量 patch。新建交易的 createdAt 等於 request.time，createdSeq 等於 seq；更正保留兩者。IDs 永不重用。

全域 head 有意序列化此小型系統的業務寫入，避免 command 序號缺口並支援一致備份；高吞吐擴充另議。SDK 因讀取衝突自動重試時，仍須檢查原 expectedRevision；其他交易造成單純 head 更新可重試，使用者正在改的交易／學生／菜單版本變了則提示重新檢視，不以舊值覆蓋。

### 6.3 伺服器 Rules 必須證明的事

登入只保護入口，Rules 才是後端：除明列路徑外 deny all；禁止 normal client delete 任何財務／command／結帳文件（唯一例外：P06b 明文授權由 `ChangeStudentCode` 原子刪除 `studentCodes/{oldCode}` 索引文件，透過 `getAfter(commands/{commandId})` 驗證 `before.student.studentCode == oldCode` 且 `after.student.studentCode == newCode`），禁止跨欄位多塞值。command create 的規則集中檢查 Auth、allowlist、有效 lease、maintenance=false、schema、合法 kind 與所有固定 counterpart。每個投影文件自身規則須證明 **原 command 不存在且本次 getAfter(command) 存在**、path／before／after／revision 完全符合該 command；不能引用歷史 command 重放，也不能夾帶額外學生／交易變更。

最大一般帳務 commit 五份文件：command、dataHead、transaction、student、day。設計 call budget（不依賴規則快取）：command 規則讀 allowlist＋lease 共2，head／tx／student／day 各 before/after 共8，合計10；四個投影各查舊 command 不存在＋新 command 共2，合計8；整筆18，低於總20。新建目標用 exists-before 取代 get-before，不額外疊加；Rules helper 不得重複 get。菜單／帳戶驗證共用已讀 day/student，不能任意加第11個存取。正常交易 day 必須先由 EnsureDay 建立。

此為待實測設計，不是已證明可行。**P01 必須在 emulator 寫出最複雜 command 與完整對抗測試，證明每寫入≤10、每 transaction≤20、expression limits 與所有 counterpart 檢查成立**；計入 get/exists/getAfter 各呼叫，勿依 caching 省略上限證明。若超限先在相同 Spark 架構內減少投影／重分檢查，重新更新本文；不得刪驗證、改成只信任 JS 或偷偷啟用 Blaze。若仍不能成立，停在 P01 提交具體失敗證據，正式寫入不得開放。

需防：缺 audit、偽造 actor／server time、跳 seq、直接加餘額、負數／小數／溢位、換 studentId／date、改閉帳日、倒改舊 settlement、額外 batch 寫入、舊 receipt 重放、非 holder UID、過期／舊 epoch、批次同塞兩個 command。Rules 無法遍歷任意 query，故禁止一命令改多筆交易／全帳戶歷史。

來源：[Atomic transactions/getAfter](https://firebase.google.com/docs/firestore/manage-data/transactions)、[Rules conditions and access limits](https://firebase.google.com/docs/firestore/security/rules-conditions)、[Rules limits](https://firebase.google.com/docs/rules/rules-behavior)。維護者 Admin SDK／console 可繞過 Rules，規格不承諾防雲端管理員竄改或法定帳簿認證。

## 7. 金額、餘額、現金與關帳

### 7.1 唯一計算口徑

有效學生交易 `delta=paidAmount-mealPrice`；有效 refund（P09b 帳戶退款）`delta=-amount`；expense 不影響學生。帳戶目前餘額＝期初＋所有 active 學生交易 delta。允許欠款（負餘額），不自動擋單。改／void 舊交易時原子寫 `currentBalance += newEffectiveDelta-oldEffectiveDelta`；期初更正加期初差額。無直接「指定現在餘額」入口。

CorrectOpening是本輪新增的明確功能：鎖定原openingBalance.asOfDate，金額／說明可更正，createdAt與asOfDate不變；原期初日closed就先ReopenDay，day不存在則先EnsureDay。命令保存原／新opening物件、理由、伺服器committedAt，student balance加差額；day只增revision記錄異動，不改現金totals，之後重新關帳產生新版本。學生的交易營業日不得早於其asOfDate，因此期初永遠是該學生交易序列的起點。

day.totals 固定包含 activeTransactionCount、bentoCount、otherMealCount、mealTotal、retainedReceipts、cashierIncome、cashierExpense、accountRefunds（P09b 起 8 欄）。active order 計餐費與份數；order／payment 的 paidAmount 計 retainedReceipts；expense 分到 cashierIncome／cashierExpense；refund 的 amount 計 accountRefunds（不計份數、餐費或 retainedReceipts，只加 activeTransactionCount）。voided 全部貢獻零。每次用同一 contribution 函式計 before/after 差額，Rules 寫等價整數驗證。關帳與報表不得有另一套算式。

`totalIncome=retainedReceipts+cashierIncome`；`totalExpense=cashierExpense`；`netCash=retainedReceipts+cashierIncome-cashierExpense-accountRefunds`；`expectedCash=openingCash+netCash`；`difference=countedCash-expectedCash`。餐費不當現金支出；期初學生餘額不是今天收到的錢。退款後的 effective paidAmount 已減少，**不得再在 expectedCash 重複減一次 command.cashEffect.refundAmount**。command.cashEffect 固定為 `{before,after,delta,reasonKind,refundAmount}`：非expense有效列的cashContribution=paidAmount，expense=paidAmount-mealPrice，void／不存在=0；before/after取該列改動前後contribution，delta=after-before。reasonKind為collection（新收款／收入）、payout（櫃台支出）、refund（取消退現／有收款撤回）、correction（帳面修正）、reversal（櫃台收支撤回）、none（無現金影響）；refundAmount僅refund時為原paidAmount，其他為0，Rules依kind與前後值驗證，不任操作者填。P09b 的帳戶退款 `CreateRefund` 固定為 `{before:0, after:-amount, delta:-amount, reasonKind:'refund', refundAmount:amount}`；應有現金只透過 `day.totals.accountRefunds` 扣一次，**不得再另減 `cashEffect.refundAmount`**（cashEffect 只是稽核紀錄，不參與 expectedCash）。P10a 的五種修改由 Rules 與 `cloudTransactionMutation.ts` 用同一算式產生 cashEffect：更正有金額變動為 correction、否則 none；作廢原有現金為 correction、否則 none；取消留款為 none；取消退款或撤回有收款的訂餐／繳費為 refund；撤回櫃台收支**或帳戶退款列**為 reversal（見 [P10a 契約](2026-10-16-cloud-transaction-mutations-contract.md)）。

例：新單收100為0→100、delta+100；取消退100為100→0、delta−100/refundAmount100；留款100為100→100、delta0；收款誤記100更正80為100→80、delta−20/reasonKind=correction；櫃台支出80為0→−80。更正記的是帳面變動，不假稱真的另退20。F5可查原收款與退款命令；F2的「收現」是有效／退款沖回後口徑，副標說明「已扣除作廢退款；原始收退款見稽核」，**不是未沖回的gross cashflow報表**。

### 7.2 更正與退款

收款欄是實際留存金額；不加入找零計算。取消有收款訂單：留款轉繳費，餘額加回餐費、現金不變；退還原收款則 void 原單、餘額回復原單之前的貢獻，現金減原 paidAmount，不能退別筆存款。5 秒撤回是收到成功確認後的UI時窗；僅原建立UID、原revision=1、原單為台北今天且可寫時提供。亦走同樣 Rules 與稽核，固定理由「送出後立即撤回」；超過UI時窗仍可走一般取消／作廢，不把5秒UI當安全權限界線。沒有取消／退款以後刪 audit 的功能。Undo適用order、payment以及兩個方向的expense：payment收100撤回為cashEffect 100→0、delta−100、refundAmount100；櫃台收入50撤回為50→0、delta−50、reasonKind=reversal；櫃台支出80撤回為−80→0、delta+80、reasonKind=reversal。expense撤回refundAmount=0、不影響學生餘額；只沖回原記錄，不證明已發生一筆新的現金流，畫面須顯示現金影響供本人核對。

現金退款只在原單為台北今天且該日可寫時提供。歷史日期重開後更正表示「修正那一天的記錄」，必須確認不是今天新收／退的現金；不把今天退款偷偷回記舊日。P09b 起支援**當日帳戶餘額退款**（`CreateRefund`，交易 `type:'refund'`）：從學生目前餘額退還現金，金額為 1 到目前餘額的整數（不退成欠款）、理由必填、只記台北今天且 open／reopened 的營業日、停用帳戶也可退；學生餘額 −amount、`day.totals.accountRefunds += amount`。把退款回記到歷史日期仍走 P13 的 F2 補登；本輪仍完整保留當日訂餐退款。金額更正畫面顯示對學生餘額／原日現金的影響並要求理由。P10a 實作：`CancelRefund` 與 `Undo` 只限台北今天的列；更正、作廢、取消留款可用於 open 或重開的較早日期；退款列可更正或作廢，調高退款金額時帳戶餘額不得變負；更正不改變列的種類（繳費 >0、櫃台收支方向不變）；零收款的訂餐取消後作廢，不留 0 元繳費。

### 7.3 每筆交易後餘額與跨日更正

交易排序固定為 `(businessDate ASC, createdAt ASC, transactionId ASC)`；createdAt 使用伺服器 Timestamp 的 seconds／nanoseconds，完全同時才以 transactionId（Firestore 文件 ID）排序，不用 ISO 毫秒、client clock 或本機 locale。Cloud 不存 `afterBalance`；adapter 從期初與該帳戶**完整有效歷史**算到各筆。完整讀取可分頁，但未讀完時顯示「計算中／未載完」，不可對單頁假算或回傳錯的 0。餘額重算只累加 active 列；refund 扣 amount，voided 不影響餘額，cashier 列標為不適用。讀完帳戶前綴後必須與已驗證 student `currentBalance` 一致；缺頁、schema 錯誤、快照版本變更或不一致時不得交付可用報表。P12a 資料層與 P12c F2／F5 候選介面均沿用此完整快照規則。

更正過去日期可改變之後的重算餘額（包括已結帳日的交易後餘額）；不改之後日期的交易或現金日結。結帳保存的是當時 cash totals、sourceSeq 與實點，不保存「永遠不變的所有學員歷史餘額」。F5 標明「依目前更正後資料重算」及其sourceSeq，與「當時結帳版本」分開；後日 openingCash 是本人輸入，不因更正自動連鎖修改。

P12c 歷史學生交易更正入口只對早於 leaseToday、狀態為 `open` 且 `lastSettlementRevision == 0` 的日期提供；今日交易仍走當日流程，F5 今日列唯讀；已關帳或曾關帳後 `reopened` 的學生交易也在此 UI 入口唯讀。這是查帳 UI 的操作政策，不是本規格新增或收緊 Rules：後端既有 `reopened` 日期寫入權限維持原契約。L07 驗收使用一個未曾關帳的歷史日更正，確認後日已關帳交易餘額依完整前綴更新，而該日既有 settlement 文件與現金快照不變；不以「重開後可改學生交易」作為 UI 驗收。

F2／F5 的區間稽核對 `businessDate` 非 null 的命令按營業日歸屬；對 `businessDate == null` 的命令按 `committedAt` 換算 Asia/Taipei 記錄日歸屬。全帳戶 null-date 查詢必須由日期範圍轉成有界 `committedAt` 查詢並按 Timestamp 與 document ID 分頁；不得掃描整個 null-date partition。沒有 `committedAt` 的 null-date 文件不能由此有界索引查出，因此本保證只涵蓋查詢實際返回的 raw rows、固定 snapshot context 及相符範圍，不宣稱偵測全庫所有壞文件。

### 7.4 日期生命週期

日期合法性由 Rules 核對 YYYY-MM-DD、年／月／日與 Timestamp 起迄（Asia/Taipei UTC+8）；不得只驗 regex。goLiveDate 之前不能建立業務交易；未來日期可預排菜單，不可收款、訂餐或關帳。F1 用台北今天，不准 prototype 模擬日介入正式版；F2 可對已建立、明確選取／重開的歷史日修正與紙本補登，標記補登理由。

open → closed → reopened → closed。關帳需 openingCash 明確確認、countedCash 非負整數，差異非零必填原因。規則從 day totals 算 expected，不能接受 client 自填總額。關帳UI另要求本頁沒有unresolved command；此條件不是Rules可觀察的伺服器不變量，遺失回應須先查receipt。伺服器只依已提交head/day狀態判斷。結帳與 day 鎖同次 commit；新交易與關帳競賽只能得到「交易先入帳後再結」或「結帳先完成、交易拒絕」。關帳後該日的交易、菜單、開帳金額與期初更正均禁止，唯一合法日期變更是帶理由的 ReopenDay。

ReopenDay 新增版次，舊 closed 版不可改；再關帳再加一版。歷史新交易從 F2 專用補登入口進入（非 F1），需理由、原日開啟且日期≥goLiveDate；不得把今天實際現金混入昨日。

## 8. 連線、快取、錯誤與查詢

正式版採 online-only 寫入，全走 runTransaction。移除正式版 persistentLocalCache、offline writeBatch 與 queued settlement；使用記憶體快取，登出清除訂閱與 store。PWA 僅快取靜態 shell，業務回應不進 service worker cache。localStorage／IndexedDB 不保存正式帳務或完整個資草稿；可保存無個資的 pending commandId＋datasetId＋登入 UID 供結果確認。

P13a 實作補充：正式模式初始化時先清除目前 Firebase app／project 的已知 Firestore IndexedDB（default app 為 `firestore/[DEFAULT]/{projectId}/main`），成功前不啟動業務讀取。若另一個舊分頁仍開啟該 DB，初始化維持 fail closed，顯示關閉其他 EasyOrder 分頁後重新載入的指引；Auth SDK 登入狀態與 prototype namespace 不屬於清除範圍。登出或失權時只清 Cloud POS memory 與已知 Cloud crash-draft/localStorage namespace；若刪除受阻或失敗，先遮罩業務畫面並提示清除未完成，不把它記為成功。

送出前固定 commandId；送出中防連按。10 秒無確定結果顯示「結果確認中，勿重新收款」，以同 ID 查 receipt／重試；不可產生新 ID 盲送。斷線不接受新業務命令；記憶體草稿標示「尚未入帳」，離開頁面即可能消失。連線恢復先查未決命令，再重新載入 server heads。若租約已轉交，原使用者只留待下次合法取得使用權查詢；下一位操作者可用 commandId 查已入帳紀錄，不能假設失敗再收一次。

quota exceeded／permission denied／schema mismatch／maintenance 均阻止操作並給中文原因。無限自動重試禁止；單次 SDK retries 以有限次數（預設5）為界，額度錯誤停止，人工重試維持 ID。斷線期間改用紙本記唯一流水號、當下日期與收支，恢復後逐筆核對 receipt 再由 F2 補登並寫紙本號備註；沒有背景自動補送。

**P13b1 安全本機診斷補充：**正式 Cloud 與正式模式缺少 Firebase 設定時，都必須採嚴格 allowlist 格式，不得降級到舊自由文字 log；只有明確 `prototype` 模式保留練習 logger 與 `-prototype` namespace。安全紀錄使用獨立本機 namespace，版本化 envelope 僅允許命令失敗欄位（有效 UUID 或 null、已知命令 kind 或 null、固定 `CommandErrorCode`、本機合法 ISO 時間）及系統錯誤欄位（固定 source、固定 system code、本機時間）；不包含 actor、學生／交易資料、payload、reason、fingerprint、URL、message、context 或 stack。讀取與匯出都重新嚴格 decode，拒絕未知欄位及無效 enum/時間，最多保留 100 筆、24 小時。只清除已知舊非 prototype `easyorder-error-log`，不遷移內容、不掃除其他 origin key；prototype 與無關 sentinel 保留。若無法刪除舊 unsafe key，F3 診斷讀取 fail closed 並顯示固定儲存錯誤。Cloud logout/access-loss 清理保留安全診斷至 TTL，unsafe 舊 log 仍清除。只有目前合法 lease holder 可在 F3 診斷區查看、匯出固定 JSON 或明確清除；匯出標示本機時間與 local-only 儲存，不建立 `RecordExport`、不寫 Firestore、不改 `dataHead`。最終 command 失敗／拒絕每個呼叫只記一次，SDK callback retry 不重複；成功、query 與 navigation 不記。儲存失敗不改變命令結果。`UNKNOWN_RESULT` 或未知錯誤碼必須提示保留原 command ID 查 receipt，不得宣稱確定失敗或要求重新收款。此補充只涵蓋安全診斷與 F3 匯出，不包含 pending-command recovery、`accessEvents` 或紙本補登。

查詢策略：

- 學生名單依 ID 載入（驗證規模500名），server snapshot 後按 `studentCode` 數值升冪排序，並自 `001` 列出至當前最大號的缺號列（停用帳戶算已使用，搜尋時隱藏缺號列）；F5 查帳由記憶體 `studentCode -> studentId` 對映直接查詢，不另讀 `studentCodes` 集合；同 UID 頁面共享訂閱協調為優化，不是安全依賴。
- 只監聽 lease、目前日期 day、必要學生 heads 與當日交易；不監聽全歷史／全 commands。歷史 query cursor 分頁，預設每頁100。
- F2 週從台北週一開始，月為曆月；加總最多31個 day heads。原始明細與 CSV 分頁完整讀取，不能只匯出第一頁。
- F5 account history 按 studentId＋businessDate＋createdAt＋transactionId 分頁；計算 afterBalance 需讀取期初起至所需日期的前綴。快取繫於 student.revision，變動即失效。
- indexes 明列：transactions `(businessDate,createdAt,transactionId)`、`(studentId,businessDate,createdAt,transactionId)`；commands `(businessDate,seq)`、`(studentId,seq)` 供稽核，`(businessDate,committedAt,__name__)` 限定全帳戶 null-date 記錄日查詢，seq 單欄供備份。command 的 before/after、大字串與不查詢快照停用索引，避免索引膨脹；studentId/businessDate 作可為 null 的頂層查詢欄。
- 讀取多頁時以 dataHead.seq 前後相同驗證一致；變動則標示資料已更新並重新載入，備份改用 immutable prefix，不依活頁快照。長頁不持有 Firestore transaction。

## 9. 備份、復原與初次上線資料

### 9.1 從空白上線

預設正式空庫＋手動學生期初建檔，不自動匯入 prototype 交易。沿用公司現在核對過的結餘，期初日設 goLiveDate；之後新增學生的期初日為建檔日。實際期初／開帳金額必須由操作者輸入確認，不能填4000或範例。

prototype 保留訓練用途。首次切換可下載舊練習快照作本機參考；禁止將整包練習交易直接 restore 到正式庫。需要大量真資料匯入才另立映射／dry-run 需求，不是本輪上線必要依賴。

### 9.2 可重播備份

每筆業務異動都有 immutable command.seq，所有投影由 seq=1 開始重播可重建。初始化 dataset/schema/head 使用本機維護工具並輸出 bootstrap manifest（無財務初值）；名單、期初與設定必須走 command，不可手工 console 填業務文件破壞備份鏈。

每日最後關帳後，由當班持有帳號匯出增量：讀 head 的 H，下載上次已備份 S 之後至 H 的 commands；不可因取到空頁就假定完整，必須驗連續 S+1..H、唯一 ID、datasetId/schema、每筆前後 revision 與對映，重播並對照 H 狀態。即使匯出過程有新命令，≤H 的 immutable prefix 仍一致。備份狀態分generated（產生包）、downloadRequested（發起下載）、verifiedLocal（重新選取已存檔並比對成功）。普通瀏覽器不能可靠判斷下載是否完成：必須要求操作者重新選取剛存下的檔案，以File API重讀、比對加密檔SHA-256及manifest後，才寫RecordBackup記H、雜湊與區間並顯示「本機副本已驗證」；取消／失敗不得推進S。RecordBackup留到下次增量，不形成自我包含循環。下一次增量的S取自操作者提供的上一份可讀備份鏈manifest，不能只信雲端「曾匯出」記錄；鏈遺失則重新從0匯出或取已驗證完整archive，額度不足明確停下。第二副本另由人工確認，不假稱瀏覽器能驗異地媒體。

備份包：版本、datasetId、S/H、上一包 SHA-256、生成時間、records、筆數、重播 totals；含完整稽核與 voided 原單。SHA-256 只驗完整性，不是抵抗可重算雜湊的管理員攻擊。用 Web Crypto AES-GCM 加密下載，密碼經 PBKDF2-SHA256（隨機salt、至少600,000迭代，P15 實測效能）、隨機96-bit IV；不保存密碼／金鑰到repo、日誌或瀏覽器。錯密碼／毀損要拒絕，無密碼不可恢復。

一份放公司受控電腦，一份複製到現有加密離線媒體；CheerC 為備份責任人、當班操作者執行。每日提醒未備份，首頁顯示最近已匯出 H，但下載事件不等於異地副本已存在，runbook 需人工確認。每日增量保留90天；每月在本機合併成完整 checkpoint＋完整歷史 command archive，**確認兩份副本且可還原後**才刪被涵蓋的舊增量；歷史 archive 不自動刪除。checkpoint不能丟更正前紀錄。

免費備份不使用雲端排程；瀏覽器關閉不會自行備份。目標 RPO≤1營業日、RTO≤4小時（實測，不是服務SLA）；如需更低RPO，本人可收款高峰後多匯出一次。

### 9.3 復原

禁止在正常 F3 提供任意覆蓋正式資料。P15 提供本機 Node 維護 CLI，維護者用 ADC／短期憑證，先在 emulator 還原及重算驗證；prod script 預設 dry-run，需要顯式目標專案、datasetId 與人工輸入確認，不內嵌 service account key。

復原流程：保留現況備份 → 維護模式停止業務 → 空的隔離 Spark recovery project（或已核對清空的停機原專案）→ 驗包／解密／重播到指定H → 分批可續跑載入 → 比對所有帳戶餘額、每日 totals、結帳版次、command連續性及文件數 → 重新建立 operators與空租約 → 重新登入 smoke test → 切換前端配置／網域。Auth UID可因新專案不同，重新核准白名單；歷史actor UID/email快照保留來源，不改成新UID。

復原需估算寫入數與當日20,000寫額度，超出就分日還原或先在本機查帳／紙本營運；不得為達RTO偷偷升級Blaze。未能於演練容量達4小時，runbook 必須記實際 RTO，P18 不宣稱達到目標。正常使用者無復原 IAM 權，不因等權操作員而可繞过 Rules。

## 10. 容量、維運與正式安全

未提供真實量，採驗證包絡：500帳戶、20供應商、10獲准帳號、同時1個UID／最多2個活躍頁面；500筆業務command／日、尖峰1筆／秒持續60秒；兩年歷史（約250,000 commands）用生成匿名資料做讀取／儲存估算，不用真個資測試。這是設計測試值，不冒充目前人數或承諾無限免費。

P16 須計入 client document/index-entry reads、Rules dependent reads（拒絕也可能計費）、transaction重試、續約、listener reconnect、CSV與增量備份。以500筆×最多18 Rules calls 的保守上界，再加repository讀取、查詢／監聽與lease，目標日讀取<25,000、寫入<10,000，保留50%餘裕；實測若超出，先減監聽／輪詢／讀取，不裁掉稽核或安全驗證。單command（含before/after）上限64KiB；容量模型使用實際平均、P95及索引大小，不假設每筆固定1KB。

每日人工查看 Firebase Usage；70%配額／儲存提示、85%進入營運警戒（減少全量查詢／匯出，先備份）；Spark自身是零費用硬界線，UI估計不是帳單或保證。兩年外推如將達1GiB，必須在達85%前另立保留／封存spec；本輪禁止自動刪會計歷史換容量。新讀取可耗完額度，無卡代表不扣款，不代表能防所有資源耗盡。

Hosting 使用 HTTPS、SPA rewrites、CSP／安全header承接 `vercel.json` 的用途但改為正確EasyOrder網域，不直接複製 payroll 的 authDomain。靜態資產hash長快取，index與service worker可更新；不公開source map／私密備份。Firebase web config是公開識別資訊，真正權限靠rules；私鑰、ADC、真姓名／餘額／截圖不得進公開repo。錯誤日誌只記commandId、錯誤碼、版本與匿名technical context，不記完整payload。

部署順序：index準備→相容rules→前端→smoke；schemaVersion不合即停止寫入。保留上一版可相容前端作回退；不可回退到會忽略新規則／資料的版本，不用回滾資料取消已入帳交易。日常rules部署顯式指定EasyOrder project，移除與payroll合併rules的deploy路徑；驗證產物無payroll target。Google Auth設定authorized domain、custom authDomain及OAuth redirect，測試popup被擋的可用fallback。來源：[Google sign-in](https://firebase.google.com/docs/auth/web/google-signin)、[redirect best practices](https://firebase.google.com/docs/auth/web/redirect-best-practices)。所有正式 Firebase 專案、DNS、Auth、Hosting、Rules／indexes、正式環境變數與管理憑證均由使用者在其電腦設定和操作；Cloud agent 僅使用 Emulator／合成資料，提供範本、runbook 與可供本機執行的 release，不部署正式資源，也不接收正式 keys。Firebase Web config 是瀏覽器可見的專案識別設定，不是 Admin 私鑰；仍由使用者在本機配置。P17 的正式驗證只能記錄使用者回報的匿名結果，Cloud agent 不推定或宣稱已驗。

## 11. 固定驗收案例

所有金額都為匿名fixture。除了本表，P01／P05須直接SDK惡意寫入，不只用UI。

| ID | 情境 | 必須結果 |
|---|---|---|
| A01 | 未核准Google／同網域陌生Google／未登入直接讀写 | 無業務資料；rules拒絕 |
| A02 | A與B同時爭取租約；A有效時B嘗試寫 | 僅一UID取得；B拒絕；到期或釋放後B可用 |
| A03 | B取得新epoch，A舊頁送單；同UID雙頁改同單 | 舊epoch拒絕；同單一成功一revision conflict，不覆蓋 |
| A04 | 停用A白名單／更改本機時鐘／關閉分頁 | 停用後下一讀寫拒絕；時鐘不延長租約；5分內可交接 |
| L01 | 學生期初100，便當90收0，再繳200 | 餘額210；餐費90、收現200、便當1、交易2 |
| L02 | 更正便當為110，收款仍0 | 餘額190；所有畫面一致，原90與理由可查 |
| L03 | 另一學生期初0，餐90收100後取消留款 | 餘額100、payment1、餐費／份數0、收現100 |
| L04 | 重置匿名fixture，餐90收100後取消退款 | 餘額0、active筆數0、有效收現0；稽核保留收100及退100，不二扣現金 |
| L05 | 開帳1000，L01/L02那組收200，櫃台收入50、支出80 | 應有1170；點1160差−10，空理由不能關帳；填理由可關 |
| L06 | L05關帳與另一訂單同時送出，後續直接SDK更正 | 序列結果一致；closed日全部寫入拒絕；重開新版本才可更正 |
| L07 | 同毫秒但不同 nanoseconds／ID、未曾關帳歷史日更正、跨已結帳後日 | 完整 Timestamp 排序、完全同時才以 ID 決勝；open 且 `lastSettlementRevision == 0` 才有 UI 更正入口；後日餘額更新、既有 settlement 與現金快照不變；曾關帳後重開的學生交易在查帳 UI 唯讀，Rules 權限不因此變更 |
| L08 | 送出斷線／回應丟失／重送10次／刷新頁面 | 只一command、一筆交易與一次餘額影響；未確認不能聲稱失敗 |
| L09 | 不帶command改balance、漏day／student、造audit、batch夾帶額外row、重放舊cmd | 全部拒絕且沒有部分寫入 |
| L10 | 負數、小數、超界、零元payment、不同帳戶／日期改單 | rules拒絕；負學生餘額本身允許 |
| L11 | 分別撤回繳費100、櫃台收入50、支出80（各自獨立fixture） | 學生繳費回復前餘額；現金delta依序−100／−50／+80；expense不影響學生；原單與理由均保留 |
| D01 | 空白建檔、前導零、同名不同ID、停用／恢復、改期初 | 名稱不當主鍵；期初不計收現；更正需重開asOfDate，餘額加差額、day現金不變、新版重結、舊版不改 |
| D02 | 前日菜單沿用、改價、供應商移除 | 沿用提醒；舊單快照不變；移除不刪歷史 |
| R01 | 3個晚餐日＋F2週/月＋F5查詢＋CSV／列印 | 欄位／筆數／份數／金額一致，跨頁完整且有發起稽核 |
| R02 | 全量bootstrap＋兩次增量，加更正／void／重開後還原 | 任選H完整重播一致；缺seq／錯hash／錯密碼拒絕 |
| R03 | 登出換電腦、清瀏覽器storage、部署前端回退 | 雲端資料保留、重新登入可還原畫面；不載範例 |
| R04 | 強制quota／network failure／schema mismatch／lease失效 | 明確阻止、無假成功、無自動付費／離線補送 |
| R05 | 兩名等權操作者交接，各自操作、匯出和重開 | 每一筆追到正確UID；沒有admin/counter功能差別 |

最終本人演練至少連續3個晚餐營業日，完整跑學生→訂餐→繳費→取消→更正→點現金→關帳→隔天查帳及一個備份還原演練。既有K07、實體鍵盤長按、Windows IME／13吋視窗未完成的驗收不得因上雲自動變成通過；P18補驗實際使用設備。

## 12. Android 往後入口（非本輪交付）

保留內部穩定鍵 `studentId`（UUID）供 faceorder / 平板名冊註冊與訂餐事件作為穩定帳戶識別鍵；畫面編號 `studentCode`（前導零字串 `001`–`999999`）僅供現場人員視覺識別與輸入查詢，不作底層關聯鍵，避免改編號導致平板註冊脫節；帳戶可代表多人。未來 adapter 將 `eventId + deviceId + businessDate + studentId + action` 轉為同一套受規則保護的 BusinessCommand，eventId映射穩定commandId，成功只在取得receipt後回覆；不得直接改student balance或插交易繞command。

本輪不建立kiosk登入／白名單、faceRoster、dailyOrderStatus、heartbeat或consumer。預留的collection一律deny，不因欄位預留就開權限。將來需要獨立的最小名冊投影（編號／姓名／啟用／當日份數）、獨立裝置認證，不能讓Android讀完整student、transaction或command；價錢、餘額、歷史與生物特徵不從本輪通道流出。

誰消費事件（櫃台或server）、櫃台關閉時行為、跨裝置取消／接手、離線逾時與重送、租約和裝置權限如何共存、辨識模型授權均在未來Android spec決定。既有[刷臉後端計畫](../plans/2026-10-13-faceorder-backend-plan.md)的B1–B4不得併入本次P00–P18；目前faceorder是本機訊號，不宣稱已能連正式後端。

## 13. #469 決策結案對照

| 原議題 | 本次定案／位置 |
|---|---|
| R1、R2、U11 | §2：獨立Spark、Firebase Hosting、不共用payroll、不付費 |
| R3、R6 | §5–7：有效列＋immutable command，derived afterBalance；無queued／close_attempts |
| R4、U7 | §8、10：PC連線才寫、紙本故障流程、容量採明列假設 |
| R5、U8 | §4：多白名單、等權、單活躍UID；平板身分另spec |
| R7 | §5、12：舊iPad雲端入口不啟用，來源字串保留，歷史文件標適用範圍 |
| U4 | 本plan先完成PC上雲，P18才正式可用 |
| U9 | §9：空白＋手動期初、prototype訓練保留 |
| U10、U13 | §9：人工作增量備份／復原；§3：應用內匯出／列印發起有稽核 |
| U15 | §7：差額只有原因，不做呆帳／借支分類，不自動平帳 |
| U1–U3、U5–U6、U12、U14 | §12：Android另spec，不能拿未決裝置項目阻擋PC上線 |

D1–D9帳務／菜單業務意圖保留；雲端供應商「移除」改用保留稽核tombstone，避免斷歷史。D10–D17記錄為未來Android約束，本輪不實作。D18協作仍由coordinator收斂review後合併，reviewer不合併。

## 14. 留給本人或後續 session 的事項（集中於末尾）

**部署必要輸入，不需要重新設計：** 實際獲准Google email／UID名單、Firebase資源建立與DNS帳號的操作權限、最終未被占用的子網域、上線日、核對後學生期初與開帳現金、備份密碼及第二副本保管位置。正式環境變數、Admin／復原憑證與 Firebase 資源操作只在使用者自己的電腦進行；Cloud agent 不收取正式 keys、不部署正式資源。不得在公開PR填真實名單或憑證；使用者在P17–P18依runbook私下輸入並回報匿名驗證結果。

**必須取得工程證據的gate，不是假裝已完成：** P01直接Rules的18-call設計能否通過全部惡意路徑；P16真實大小／讀寫頻率可否落在Spark內；P15復原量能否達RTO。若失敗先交具體evidence與最小修訂方案，不讓實作team自行降低安全性或開計費。

**未來enhancement，不阻擋本輪PC：** 多Google身分同時使用、跨日存款現金退款的獨立業務語義、大量Excel／prototype交易匯入、無人自動異地備份、超出免費儲存的封存政策、Android全部整合與模型使用授權。先依本文當日退款、人工備份及單帳號使用規則上線。
