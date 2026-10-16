# P14 平行實作計畫：每日增量備份與完整性檢查

日期：2026-10-16。Coordinator 制定；以 `e01ebdff5e784522b15a6f16278ef303a9c63110` 為起點。此文件是 P14 實作與審查清單，不宣稱功能已完成。

## 為何可與 P10 平行

P14 讀取已存在的 immutable `commands/{commandId}` 與 `system/dataHead`。P10 的更正命令會增加新的 command kind，但不應改變這兩個介面的基本契約。P11／P12 的 UI 與查帳也不是匯出 command prefix 的前置條件。備份的重播器須由 command 的固定 `targets`、`before`、`after` 驗證及套用，並明確支援或拒絕每一個 kind；不能只列目前已開的 kind 然後漏掉將來的更正與結帳。合併前須以最新 main 重跑測試並檢查 P10 對 command schema／Rules／F3 的改動。若 P10 改變不可覆寫序列契約，先調整 P14 再合併。

P11 的 settlement 版次需能由 CloseDay／ReopenDay command 的 before/after 重播。若目前尚無這兩個實際命令，使用匿名合成 fixture 驗證形狀與拒絕未支援形狀；不可宣稱 P11 已完成。P15 的正式 restore CLI、真實 Spark 專案與本人營運驗收均不屬 P14 完成聲明。

## 交付範圍

1. `cloudBackupRepository.ts`：只用 server 讀取 head 與按 `seq` 升序分頁的 commands；開始固定 H，完整取得 `(S,H]`，驗證每個 seq 唯一且連續、commandId 與文件 ID 相同、`head.lastCommandId` 與 H 尾筆一致（H=0 時另處理）、schema/dataset 與上份 manifest 相容。新 command 在匯出中提交時不得超過 H。任何不完整、超額、權限失效或讀取錯誤均 fail closed；不產生「已備份」狀態。新增必要的單欄索引或 query 設定。
2. `cloudBackup.ts`：明確版本化 manifest 與匿名可測的 command record 格式；對初次 `S=0` 與增量鏈驗證前包 SHA-256、datasetId/schema、範圍、筆數、重複 ID、before/after revisions、固定 targets、交易/學生/day/settlement 投影與 totals。保留 voided 原單及所有 audit。錯 kind／錯 schema／無法重播時拒絕，不能跳過。用 Web Crypto AES-GCM、PBKDF2-SHA256 ≥600,000 iterations、每包新 salt 與 96-bit IV；密碼／key 不落 storage、repo 或 log；錯密碼與毀損清楚拒絕。產出的加密檔可重新讀取並驗證。處理大包時有明確界線／錯誤，不把截斷包標成功。
3. `RecordBackup`：在 `cloudCommandSchema.ts`、唯一正式 command writer、`firestore.rules` 加入固定型別與驗證。此 command 只記 verifiedLocal 的 H、範圍與 SHA-256，不改帳務投影；Rules 驗 actor/lease/head 序號、`sourceSeq`、payload 範圍/雜湊與零額外寫入，測試 20-call/每 write 10-call 與 expression 上限。未知回覆時同 commandId 查 receipt／重試，不可重複登記。RecordBackup 本身出現在下一包。
4. F3 正式備份區（可拆獨立元件以避開 P10 的期初表單）：顯示 H 與上次已驗證 S；操作者提供上份可讀 manifest／備份包來決定 S，不能只信雲端 export 紀錄。狀態為 generated → downloadRequested → verifiedLocal；產生、點下載、瀏覽器聲稱完成都不可推進 S。要求重新選取已存的加密檔，以 File API 驗 SHA-256 與 manifest 後才提交 RecordBackup、顯示已驗證。取消或不一致可安全重試。文字清楚告知每日手動下載、第二副本需人工確認，不能在正式 F3 提供覆寫／還原按鈕；prototype 行為保留。失去 lease／登出立即清掉備份包與敏感草稿，舊 async 回覆不可回填。
5. 更新 `docs/ops/firebase-backup-runbook.md`、P14 receipt／rules budget／需要的 spec 或 plan 小幅對齊。說明 90 天增量、每月 checkpoint/archive 的人工操作責任；若 checkpoint 合併或 P15 restore 尚未實作，明列未驗，不用文字暗示已可執行。

## RED/GREEN 與驗收

- 先寫行為 RED，再做實作：同時新增 command 固定 H；缺號、重號、錯 dataset/schema、錯前包 hash、錯 target/revision、錯密碼/加密檔損毀；首次與第二次增量；取消下載/未重新選檔/選錯檔不產生 RecordBackup；新命令在下一次包中；P10 更正與 P11 settlement 的合成重播；Rules 拒絕偽造、非 holder、舊 epoch、額外投影與重放。
- 真 Firestore Emulator `cloudBackup.spec.ts` 不可 skip。使用匿名 fixture；驗完整範圍、head 競賽與 RecordBackup 原子收據。跑相關舊 Rules suites、full Vitest、lint、build、Cloud e2e。`tsc -p tsconfig.app.json --noEmit` 與 base 的 normalized diagnostics 逐筆比較，新／修改模組無新增錯誤。測試指令與數量記入 receipt，不以總數代替因果證據。
- 三分鐘 demo：匿名帳戶兩筆以上 command → 匯出 `0..H` → 下載 → 未重選時仍未驗證 → 重選成功才 RecordBackup → 再新增一筆，使用上一包 manifest 匯出增量 → 用錯密碼／被改動的包拒絕。

## PR 與合併 gate

Implementer 只在 `codex/p14-incremental-backup` 工作，提交並開 PR，附完整 SHA、變更檔、spec 案例、測試與 demo、限制。Reviewer 只 review，不合併。Coordinator 查 reviewer 意見、required CI、與最新 main 差異、P10 衝突及 receipt，再決定合併。不得自動標示 P15／正式部署／本人驗收完成。
