# P12a R1／R2 rework dispatch

Owner：coordinator。已派工；branch `codex/p12a-cloud-reports`；起點 PR #521 head `a81fc31e7fe8fbbc1f6fc830f18ff8f17e7d377f`，base `dfdb982201e7fdd8dd9ba38a82f9d566b72598cf`。原 head CI [39143055966](https://github.com/cheerc/talented-easyorder/actions/runs/39143055966) 綠，但獨立 [review 5564521278](https://github.com/cheerc/talented-easyorder/pull/521#pullrequestreview-5564521278) 為 REWORK，不能合併。

Coordinator 已核對 source：`readAccountHistory` 確實直接從 loadRange 進帳戶前綴；closed／0 確實使 close=null，而 `close?.effectiveCash === null` 不會抓到 undefined。採納兩項 finding；既有使用者已授權 review／rework loop，本 brief 不增加 P12 範圍。Impl 不寫 plan、不改 Rules／命令／UI，不進 P12b。

## R1：所有可用歷史都須驗證範圍日投影

`readAccountHistory` 在相同 context/H/epoch 內，重用 `readTransactionsForRange` 對每個所選日期的**完整全日交易**與 day projection 對帳，再執行／保留完整帳戶前綴及 currentBalance 驗證。不能以單帳戶子集核對全日 totals。某學生該日零交易，不代表全日零交易；但完整全日查詢到 EOF 後，確實沒有 day、交易或回填標記的日期是合法無營業資料日，須沿用原 brief 的不存在日期語意。只有有交易／標記卻缺必要投影、totals 不符、分頁／版本／租約錯誤才拒絕整份，不回 complete／假餘額；不得要求週／月內每個空白日都先建立 day 文件。

真 holder SDK RED：保留兩學生與交易、currentBalance 不變，分別刪除 visible day、將該日 totals 清零；兩例 `readAccountHistory` 都須拒絕，`readReport` 拒絕作正確路徑對照。正常單帳戶（day totals 包含另一學生）仍成功，證明沒有錯拿子集對帳。Admin 只做合成故障注入，不宣稱合法命令能製造此狀態。

## R2：明確驗證日狀態與日結歷史

在 report 共用 `loadRange` 驗證：未曾關帳的 open 日版號為0；closed／reopened 必須有正的 lastSettlementRevision 且完整 close 結果存在、狀態與最新版一致。closed 還須有可驗證 effectiveCash，0 是合法現金；null／undefined／missing close 均不可通過。重用既有完整版次驗證，不能靠 null-coalescing 假造日結。

真 holder SDK RED：closed／0、reopened／0 皆拒絕（至少 summary 與一條 history/report 入口），closed 正常版次、open／0、effectiveCash=0 正常控制仍成功。原有版本連續性／current-vs-old entries 行為不得改變。這是資料完整性防線，不收緊既有業務 Rules。

## 範圍與交付

只改 cloudReadRepository、對應 tests、本 brief、必要 evidence／handoff／status 與 PR body。既有 query／projection／CSV 及新 metadata 防線不重新設計。先測出原 head 的 RED，再修到 GREEN，並保留舊行為對照／實際命令與 counts。

修改後跑新報表 Emulator suite＋CI 同形 JSON gate、相關 reader／projection unit、日結／學生／備份序列回歸、lint/build/Vitest、app TSC 完整正規化零新增；適用 E2E。原 head review/CI 和新 head 證據分開。中文 commit、push 更新同一 PR，讀回最終 provider head 與 CI URL，attach 後停寫交新 head 獨立複審，不輪詢 CI、不合併。
