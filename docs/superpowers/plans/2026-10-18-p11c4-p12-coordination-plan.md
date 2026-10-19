# P11c4 收尾至 P12 執行計畫

2026-10-18，owner：coordinator。狀態：已授權執行，尚未完成。

## 實際進度（2026-10-18）

- P11c4b PR [#519](https://github.com/cheerc/talented-easyorder/pull/519) 已合併：base `fa214036e18d5e600cdb729a4e3b2732c51ec458`、source head `340726ff4b14343e4542eaa3bd936ede50fbfa0e`、merge SHA `855679804a12cd1bce5dce72fe2da20127e2c85d`。舊 head REWORK review [5563425902](https://github.com/cheerc/talented-easyorder/pull/519#pullrequestreview-5563425902) 與新 head COMMENT delta PASS review [5563479986](https://github.com/cheerc/talented-easyorder/pull/519#pullrequestreview-5563479986) 分開；source CI [39137275659](https://github.com/cheerc/talented-easyorder/actions/runs/39137275659) 兩個 jobs 成功。
- P11c4b receipt 的 main CI [39138091279](https://github.com/cheerc/talented-easyorder/actions/runs/39138091279) 已 COMPLETED／SUCCESS（build-and-test、e2e 均成功）；沒有重跑。P11c 已完成；P12 已授權；P12a 資料層 PR #521 已合併，main CI 綠燈，docs-only 收據 PR [#522](https://github.com/cheerc/talented-easyorder/pull/522) 已發布並等待獨立 review。當時 P12b 已授權、仍待 coordinator 具體派工；P12c 尚未開始。

## 實際進度（2026-10-19）

- P12a cloud 查帳資料層 PR [#521](https://github.com/cheerc/talented-easyorder/pull/521) 已 squash merge：pinned base `dfdb982201e7fdd8dd9ba38a82f9d566b72598cf`、source head `c161f9196d7836e310c45cdfe3312cefed611842`、merge SHA `c9988b35912f761bb79c08476ac9636c0fcc49aa`。舊 head `a81fc31e7fe8fbbc1f6fc830f18ff8f17e7d377f` 的 REWORK review [5564521278](https://github.com/cheerc/talented-easyorder/pull/521#pullrequestreview-5564521278) 與 c161f91 的 PASS COMMENT review [5564603618](https://github.com/cheerc/talented-easyorder/pull/521#pullrequestreview-5564603618) 分開記錄；source CI [39158763724](https://github.com/cheerc/talented-easyorder/actions/runs/39158763724) build-and-test／e2e 均成功。
- P12a 僅完成資料層，尚未完成 F2/F5 UI、匯出／列印使用流程或 R01/L07 UI E2E；P12 整體未完成。P12a docs-only 收據 PR [#522](https://github.com/cheerc/talented-easyorder/pull/522) 以 merge `c9988b35912f761bb79c08476ac9636c0fcc49aa` 為 pinned base。Main CI [39159574321](https://github.com/cheerc/talented-easyorder/actions/runs/39159574321) 派工時由 coordinator 回報 pending，之後由 coordinator 從 provider 核對為 COMPLETED／SUCCESS，main 仍為同一 SHA；本輪依此回報發布，不自行輪詢。收據 PR 等待獨立 review。
- 此段寫作時 P12b 已授權、仍待 coordinator 依已合併介面具體派工；之後已派工並進入實作驗收。P12c 尚未開始。

## 實際進度（2026-10-19 P12b）

- P12b 匯出／列印發起稽核已依 dispatch brief 在 pinned base `e12afbf506801de56715f970a5c29393846a48d5`、branch `codex/p12b-report-actions` 完成實作與本地驗證，runtime source commit `1d2e3f4`。`RecordExport`／`RecordPrint` 僅推進 head 並新增 command，不寫業務 projection；PR [#523](https://github.com/cheerc/talented-easyorder/pull/523) 已發布、尚未合併，獨立審查與 provider CI 待確認。P12a 收據 PR [#522](https://github.com/cheerc/talented-easyorder/pull/522) 已合併至同一 pinned base，review [5564691313](https://github.com/cheerc/talented-easyorder/pull/522#pullrequestreview-5564691313) PASS、source CI [39160851654](https://github.com/cheerc/talented-easyorder/actions/runs/39160851654) 與 main CI [39161053527](https://github.com/cheerc/talented-easyorder/actions/runs/39161053527) 均成功。
- `cloudReportActions.spec.ts`、Rules 13-pair gate、backup、受影響 Emulator 序列、全 Vitest、lint/build/typecheck、app TSC baseline comparison 與 E2E 證據見 [P12b evidence](../../ops/free-production-evidence.md#p12b-report-actions-2026-10-19) 及 [Rules budget](../../ops/p05-rules-budget.md)。P12c 尚未開始，P12 整體未完成。

## 授權與角色

CheerC 本輪指示：coordinator 負責推進至 P12 完成，撰寫 plan 與 dispatch brief；implementer 依 brief 實作與驗證，不自行寫 plan。每個實作 PR 發布後交獨立 reviewer 審查，有必修就 rework，直到目前 head 的審查及 CI 通過，再由 coordinator 合併。合併後依專案慣例另開 docs-only 收據 PR，也需 review／CI。到 P12 完成為止，不開始 P13。

正式環境 credentials、部署、資料與 smoke test 仍由 CheerC 操作。Agent 只使用 `demo-easyorder` Emulator 與合成資料，不碰其他產品、billing／Blaze 或 Android。

## 依據與已核對現況

- [正式後端規格](../specs/2026-10-13-free-production-backend-spec.md) §3、§6、§7.3、§8、R01／L07。
- [正式後端計畫](2026-10-13-free-production-backend-plan.md) P11c、P12。
- [關帳契約](../specs/2026-10-17-cloud-day-close-contract.md) §11–§15。
- [交接](../../DEVELOPMENT-HANDOFF.md)、[Rules 預算](../../ops/p05-rules-budget.md)、[證據](../../ops/free-production-evidence.md)。
- 起始 GitHub main 為 `e8244925721411120f9e654e0c584f2bd32c3baa`；#517 head 為 `5f3159b7dd0cfeb9cc97bb4397924add7228fa81`。既有審查有一項必修：全空白補記原因可寫入，卻被備份拒絕。
- `App.tsx` 的 cloud sections 目前有訂餐、學生、日期與供應商、日結、帳務異常，尚無 cloud F2 報表與 F5 查帳。既有 `ReportScreen` 使用 prototype store，不能直接掛到 cloud。
- `cloudReadRepository.ts` 尚不存在，是 P12 預定新檔。`cloudOrderRepository` 已有嚴格交易 decoder、當日分頁與 day totals 對帳，可重用純 decoder，不能重用只准今天／回填日的讀取限制來冒充歷史查詢。
- `RecordExport`／`RecordPrint` 已有型別草稿，但尚未列入 enabled command、Rules、writer 與完整 backup replay；不能只做 UI 稽核文字。
- 舊 `sortLedgerChronologically` 以穩定陣列順序處理同毫秒交易；cloud 必須按規格補上 transactionId tie-breaker，不把 prototype 舊排序當成 cloud 契約。

## 批次與依賴

| 批次 | 交付與驗收界線 | 前置 |
|---|---|---|
| R0 | #517 reason rework：writer／Rules／receipt／backup 一致，Unicode 空白抽測，budget 不超停止門檻 | 現有 PR |
| R0-receipt | #517 merge、review／CI 證據與剩餘畫面工作 | R0 merge |
| P11c4b | 日結補記表單／歷史、異常差額入口、未知結果重試與 Q2 E2E | R0-receipt merge |
| P11c4b-receipt | 文件收據，P11c 完成且 P12 已授權 | P11c4b merge |
| P12a | 完整歷史讀取、cloud 餘額／彙總／輸出資料模型與索引；PR #521 已合併，僅資料層 | P11c4b-receipt merge |
| P12a-receipt | PR #522 docs-only 收據已合併；review 5564691313 PASS，source CI 39160851654、main CI 39161053527 成功 | P12a merge |
| P12b | `RecordExport`／`RecordPrint` 正式稽核命令、Rules／writer／backup 相容，無業務投影；runtime source 1d2e3f4 實作與本地驗證完成，PR #523 開啟，獨立審查與 provider CI 待確認 | P12a-receipt merge |
| P12b-receipt | 命令層證據與待接 UI | P12b merge |
| P12c | cloud F2／F5、原始／合併輸出與列印、變更稽核／日結版次、R01／L07 E2E | P12b-receipt merge |
| P12c-receipt | P12 完成收據與總驗收，停止於 P13 前 | P12c merge |

每批只有一個寫入者。從已合併 receipt 的最新 main 開 `codex/` 分支；不得把上一批 branch 直接混進下一批。Coordinator 修改本計畫及 dispatch；impl 只更新實際成果與證據文件，不更改任務設計。若 acceptance 與程式事實衝突，提供最小證據交 coordinator 決策。

## P11c4b 設計

沿用 `CloudDayClosePage` 的 recovery、scope generation、navigation lock 與既有 command repository。新增 post-close prepared command，不另開裸寫入器。

- closed 日顯示補記列表與有效關帳現金；歷史補記依當前 `lastSettlementRevision` 區分「計入」及「已因重開而不再計入」，重開後仍能看歷史，但不可新增補記。
- 表單收入／支出、1–20,000 整數、原因 trim 後必填；送出前固定 command ID、payload 與 day／settlement expected revisions。pending／unknown 保留同 ID，查 receipt 或重試，不換 ID。
- 異常 gapDayCount 為 0 時提供「在 YYYY-MM-DD 補記差額」，target 是 previousClosedDayId；direction 由 `openingCash - previousEffectiveCash` 的符號決定，amount 是絕對值；不自填原因。
- 帶入只是草稿。送出前重讀該日與下一開帳日／異常快照，若差額、日結版次或狀態改變，就更新預覽要求操作者重新確認。這只能減少 stale draft，不能保證跨分頁 exactly-once：兩分頁同時重讀後用不同 command IDs，或與人工補記交錯，仍可能各自成功。沿用原契約，不新增 deterministic ID 或 backend 鎖；UI 與 PR 如實揭露這項限制。
- >20,000 差額不可硬送或自動拆單，顯示限制並讓操作者人工核對。失權清資料與草稿，pending ID 依既有 recovery 契約保留。
- 不新增 command、Rules 或營業日欄位；不收緊 P11c3 舊備份放寬條款。

## P12a 資料設計與跨批介面

新增 server-only `cloudReadRepository.ts` 及純 cloud report projection；保留 prototype store、舊寫入器隔離。正式 UI 只接受完整快照，不接受 `LedgerTransaction.afterBalance = 0` 之類 placeholder。

### 讀取

- 公開能力為日期區間摘要、完整區間明細、單一帳戶歷史、日／帳戶稽核。回傳至少帶 `datasetId`、`sourceSeq`、完整性狀態及查詢範圍；錯誤統一 fail closed。具體 exported 型別由本批實作，review 後成為後續批次介面。
- 歷史 query 預設每頁 100（正式 spec §8）；marker／補記等沿用現有每頁 200。使用 server SDK reads、cursor、固定排序，讀完 EOF 才 complete。沒有全庫即時監聽，也不改 legacy subscription 為正式資料來源。
- 每一頁前後及整個組合讀取前後核對 head identity／seq；維護、失權、cache／pending writes、不支援 schema、頁間變動、容量上限都回明確錯誤，不能回部分資料假裝完整。
- F2 摘要最多 31 個日 heads；跨週／月用台北曆日，週一至週日、曆月，custom 超過 31 天明確拒絕，不能靜默截短。
- 完整明細按 businessDate、createdAt、transactionId 升冪。指定帳戶按 studentId 等值條件加同排序；交易 decoder 重用現有嚴格契約，保留 voided 原列於稽核，不納入有效金額／份數。
- 欲顯示逐筆餘額，從 student.openingBalance 起讀完整帳戶歷史，排序後 active 列累加，退款扣 amount，voided 不貢獻，cashier 無學生餘額。讀到全帳戶末端後與 student.currentBalance 對帳；失敗則不可輸出可用餘額。不能只由區間第一頁或 currentBalance 反推。
- 本輪不必新增跨操作持久 cache；如新增記憶體 cache，key 必含 dataset、student revision、查詢範圍與 sourceSeq，失權／更新即失效。
- 讀 closed 日也要帶 backfill marker、完整補記與日結版本；有效現金重用 `postCloseNet`／既有函式。補記不偽裝成學生交易，舊版補記可查但不計入現金。
- 稽核 commands 用 `(businessDate, seq)` 或 `(studentId, seq)` 篩選分頁；不掃全 commands 做 UI。日結版本從該日 subcollection 完整取得，保留原操作者、理由與時間。

### projection 與輸出

- 純 projection 產生畫面、CSV、print 共用模型。保留既有交易 CSV 欄位順序，cloud 專用 metadata 以附加欄位或明確獨立 CSV 輸出：backfilled、status、sourceSeq；補記獨立 rows 包含方向、金額、原因、actor/time、settlementRevision、是否計入；日結輸出附 effective closing cash，不覆寫原 countedCash。
- 原始／合併兩種模式共用同一已驗證快照；合併不得丟失原始 ID 關聯、回填標記、退款／作廢或補記分類。區間合併至少保留日別界線，不能把多日誤稱同日。
- F2 搜尋可依現名、編號、aliases、交易時姓名定位帳戶；修改姓名不改交易快照。搜尋不改全日關帳數字。F5 標明「依目前更正後資料重算」與 sourceSeq，當時日結版次另列。
- CSV 注入防護涵蓋 `= + - @` 與前導空白、tab、CR／LF 等繞過，保留合法數字／文字，正確 quote 雙引號／逗號／換行。不得靠 HTML escape 代替 CSV safety。
- 索引依實際 query 新增 spec 要求的 transaction／commands composite indexes，必要 snapshot／before／after 大欄位設免索引。Emulator 不證明正式索引已部署，公開文件只記需一起部署。

## P12b 稽核設計

基於既有 `RecordBackup` 形狀新增兩個純稽核 command：只寫 head 與不可變 command，不變學生、交易、營業日或日結。

- `targets`／`expectedRevisions` 空 map、zero cashEffect、`reason = null`、actor 與 committedAt 由 server／Auth 注入，before／after 僅 head。兩種 payload 均帶 `scope: {studentId: UUID | null}`（null 表示整段區間，UUID 表示單一帳戶），command 頂層 studentId 與它一致；不保存自由搜尋字串。巢狀加入 command dispatch 最後 operand，不新增頂層 OR。
- `RecordExport.payload = {exportType, dateRange: {start,end}, scope, sourceSeq}`；exportType 封閉集合表達 transactions-original／transactions-merged／settlements／post-close-entries／audit。dateRange 合法、順序正確且最多31天。不能將完整報表塞進命令。
- `RecordPrint.payload = {printType, businessDate, dateRange: {start,end}, scope, sourceSeq}`：printType 封閉集合 ledger-original／ledger-merged，businessDate 是範圍的 anchor、必須在 dateRange 內；dateRange 合法且最多31天，以支援日／週／月完整列印。這是 coordinator 對尚未啟用型別草稿的定稿，P12b 必須同步正式 spec、domain types、schema、Rules、backup；不能漏記真正列印範圍。
- sourceSeq 是產生輸出的已驗證快照序號，整數且不大於實際 head.seq；不強迫等於當前 seq，因另一筆純稽核不會改報表內容，但 UI 仍標明來源序號。record 只證明「發起」，不證明下載成功或實體印出。
- 正常 action 流程：完整 snapshot → 固定內容與 commandId → 提交稽核 → 確認 receipt → 發起下載／列印。unknown 查同 ID，不再建立稽核或重新發起 action；錯誤／失權不發起。
- replay 接受新 kinds、驗證 head-only 投影與 payload、序號及零現金；舊備份照常通過，真命令匯出／解密／replay round-trip。

## P12c UI 驗收

cloud 新增「報表（F2）」與「查帳（F5）」入口，與日結／異常保留分離。鍵盤捷徑僅在無輸入焦點且無 pending/revoked lock 時導航，沿用 authorization 與 generation cleanup。

- F2 今天／本週／本月／custom 摘要、完整明細、原始／合併切換、現名／別名／編號搜尋、CSV；日結區跳既有日結頁，不受搜尋縮小。搜尋是帳戶定位，必須選定一個帳戶或清除回全區間；畫面明細／CSV／print 使用相同 scope，未選定的多候選搜尋不改輸出範圍，按鈕明列目前範圍。日摘要保留全日口徑且與帳戶結果清楚區別。
- F5 帳戶查詢、完整多頁有效歷史與 voided 原列、command 的 before／after／原因／actor/time；指定日可看全部日結版本、回填與新舊補記。F5 的 CSV／print 同樣限定已選帳戶與日期範圍並記錄 scope。
- 歷史更正正式入口：F5 交易列在營業日仍 open 且 lastSettlementRevision==0 時，提供既有更正／作廢命令的確認表單，理由必填，使用 tx/student/day 的 server revisions 與同 ID recovery。不得接 prototype store。closed 或曾關帳後 reopened 的歷史學生交易在此入口皆唯讀，現金差額跳日結補記；不新增重開修學生帳入口。
- R6/R7 是較新決策，優先於舊 L07「重開歷史日更正」範例：本輪驗收改用未曾關帳的歷史日更正，觀察後日已關帳日的餘額重算及原現金日結不變。P12a 同步正式 spec 的 L07 與 §7.3 註記這個取捨，避免把禁止的操作稱為 UI 完成；既有獨立重開流程與 backend 不在此批改權限。
- 所有 async 訊息綁 scope／query generation，切換帳號、租約、範圍或帳戶後舊結果不得覆蓋新畫面。loading／error 禁止匯出列印，不顯示假 0。
- 匯出／列印共用當前固定模型與 sourceSeq；發起後明說「已發起」，瀏覽器取消與無回覆不回寫「成功印出」。列印含選取日期區間的完整明細及原始/合併模式，不能只印虛擬清單可見頁。
- R01：三個合成營業日含 >200 同日交易、>100 帳戶歷史、改名 aliases、作廢原單、回填、補記與重開後舊補記；畫面／CSV／列印模型金額、份數、筆數一致，command 稽核存在。
- L07：同毫秒不同 ID、從 F5 正式入口更正未曾關帳的歷史日交易，使後日餘額更新，後日既有 cash settlement 文件完全不變；closed／曾關帳歷史學生交易不可從此 UI 修改；完整前綴失敗時不顯示餘額或允許輸出。

## 驗證與完成 gate

每批寫有意義的 RED，然後 GREEN；docs-only 用內容／連結與 diff 檢查，不寫人工 RED。實作批 lint、build、全套 Vitest、受影響 Emulator suites（序列，必需案例不可 skip）、`test:cloud-backup`（新增命令／備份路徑時）、適用 E2E；app tsc 診斷與 pinned base 比較，不能只跑 bare tsc。記錄 exact commands、exit、counts、skips、logs 及未執行項。

Rules 改動每次重測現有預算錨點與新增最大 payload 路徑。任一既有錨點減超過3或低於+5即停；CreateStudent 已+3，不可下降。deny 必須排除 expression cap 誤拒；新增 command 需 raw SDK allow/deny、孤立寫入與偽造投影測試。禁止放寬 Rules、skip 測試或單純加 retries 掩蓋錯誤。

發布後 reviewer 只對 provider 現 head 作 COMMENT review、不 approve／push／merge。任何新 commit 都使相關舊 review／CI 失效，取得新 exact-head 結果再合併。Coordinator 核對完整 diff、文件 docs-check、測試 logs、review 與 required CI；squash merge 後確認 main CI，再做 receipt。P12 最終交付分清楚 code/CI 完成、未部署、production 未驗證。

## 派工 brief

原樣納入版本歷史的 brief 索引：[P11c4a 收據](2026-10-18-p11c4a-receipt-dispatch.md)、[P11c4b](2026-10-18-p11c4b-dispatch.md)、[P11c4b 收據](2026-10-18-p11c4b-receipt-dispatch.md)、[P12a](2026-10-18-p12a-dispatch.md)、[P12a 收據](2026-10-18-p12a-receipt-dispatch.md)、[P12b](2026-10-18-p12b-dispatch.md)、[P12c](2026-10-18-p12c-dispatch.md)。各批派工狀態以對應 brief 為準。

每批的具體 brief 由 coordinator 在派工前寫入同目錄 `2026-10-18-<batch>-dispatch.md`，包含 pinned base、allowed paths、明確 deliverables／RED 與 gate；引用本計畫，不把設計責任交 impl。下一批開始前依已合併的實際 exported interface 更新 brief，不能根據猜測派工。
