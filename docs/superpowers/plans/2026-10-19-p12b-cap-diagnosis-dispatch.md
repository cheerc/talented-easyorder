# P12b 負向 cap 診斷 dispatch

Owner：coordinator。僅授權下列診斷，暫不改 tracked runtime／tests／Rules，不 commit/push。起點 base `e12afbf506801de56715f970a5c29393846a48d5`，dirty candidate Rules SHA-256 `e6fd1f2dc41f7e8568e95a12186e98165fcee3a274b5fc16ccd09f9b4dcde526`。保留既有 dirty 檔與 coordinator briefs。

## 判斷與邊界

正向 P12b.1 成功；十個 raw negative deny 都有 cap diagnostics，因此單獨 assertFails 不能當 guard 因果證據。既有 p05-rules-budget 已記錄 baseline 31 個負向案例有 cap；目前尚無正向舊錨點下降／新 kind 餘裕低於門檻的量測，不能僅憑負向訊息斷言新功能必須縮 scope。禁止刪安全 checks、放寬政策或隱藏 diagnostics。

P12b.2 竄改 transaction projection 已被 replay 拒絕，只是錯誤字串與 test 預期不同，這是待修 deterministic assertion；不是 replay 接受偽造資料。先保留紀錄，本輪診斷不要改實作。

## Impl 執行順序（repo 外 probes／合成資料）

1. 保存 candidate Rules／目前 suite 與本次完整 log 到 repo 外獨立目錄，記 hash。外部 Vitest config／spec 可沿 reviewer 既有 repo 外 runner 模式；imports 指實際 candidate 模組。使用 `EASYORDER_TEST_RULES_PATH` 選 rules 副本，每次只啟一個 demo-easyorder Emulator。輸出 JSON，selected tests 非零、零skip，原始cap logs保留。
2. 在外部 spec 加**未污染 raw batch 正向控制**：同 seedBase、同 serverTimestamp/fingerprint/range，`rawReportBatch({})` 應成功且只增 head＋command。另建合法 RecordPrint raw 控制（不殘留 exportType，anchor/range/scope 對應）。不要只用有 CreateStudent 前置的 writer 成功替代這兩個 raw 控制。
3. 量兩個新 kind 的獨立最大 payload command/head 餘裕。Admin seed 初始合法 head/lease/operator，再單獨寫 report action；不要先經 CreateStudent，否則全命令 anchor 測到的會是它的 +3。先測 +0、+5、+16 端點；通過才用既有 bisection 量界，記 runtime cap 與 compile-time too-complex 的區別。舊 CreateStudent、P08.8 dayWrite、backfilled tx 三個緊錨點先與 base對照；現行完整13對錨點仍是正式發布 gate。
4. 對相同壞 raw payload 做**有成本控制的語意 mutant**。至少 scope binding、sourceSeq 上界、actor/time、actual before/after head binding 各一組；每組原 candidate 拒絕／atomic unchanged，唯一相關 guard 改為接受該壞值的 mutant 必須接受並能讀回實際偽造欄位。保留其餘查驗、head/lease/schema；不能用大幅刪 helper 讓整份超寬鬆 Rules 的成功來冒充單 guard 因果。
5. 優先使用同 AST 成本的變異：sourceSeq `<= headBefore.seq` 改 `>= headBefore.seq`（同 seedH=0，bad=1，good=0）；scope頂層等式右左改為相同已驗證 scope 欄位；actor literal 的 uid/email 來源換 command.actor 對應欄位（保留 map形狀/holder驗證）；committedAt 右側換 command.committedAt。actual map bind 可將 expected headBefore 改為 command.before.head／expected headAfter 改 command.after.head，保留 exactMap 與 actual head advance，這些 lookup不比原 var讀取便宜。若某個 mutant 降低 expression 成本，加非短路省略的等值 padding 並量 endpoint 控制；不能把省成本的結果直接歸因安全檢查。
6. 若原始 raw 正向也失敗，或新 kind／舊緊錨點觸發真正門檻，回報 exact case／hash／log／lo-hi；不自行改設計。若原始 raw 正向與健康餘裕成立、相同壞 payload 的等成本 mutant可接受，記為 guard 的反事實因果（不聲稱原始日誌零cap）。其餘重複 guard／跨 leaf 拒絕不能單因果時如實列未驗，交 coordinator決定下一步。

## 回報

只回 probe目錄、命令、hash、selected counts／skip、原始和mutant結果及餘裕端點。保持 repo source不變，停止等待 coordinator 的實作續工指令。正式驗收仍需全部原 brief tests／budget／CI／獨立review；本診斷不等於完工。

## Coordinator 續工決定（診斷後）

已核對原始 JSON、mutant generator、四格 spec 與 candidate Rules hash：raw Export／Print 與完整學生投影控制成立；base/candidate 三個緊錨點端點相同（+3/4、+11/12、+16/17）。新 Export/Print command 分別 +50/+51、+44/+45（上界為 runtime cap），head 皆 +95 通過／+96 compile too complex，後者不是 runtime 上限。六個單 predicate 的 original/mutant × good/bad 共24格皆有執行與斷言；bad 原版拒絕、mutant 接受且讀回偽造欄位，good 皆接受。沒有刪 production 安全檢查或縮 scope。原 deny cap diagnostics 保留，僅證 predicates 有反事實語意作用，不宣稱原路徑 cap-free；三緊錨點不是現行完整13對錨點驗收。

授權恢復原 P12b tracked implementation／tests／docs 與最終發布流程；無需修改目前 production Rules helper 來消除負向 cap 訊息。保留以下收尾：

1. 將 raw 正向兩kind與完整合法學生投影／EditStudent 控制納入持久 suite；stub 拒絕不再當投影隔離主要證據。
2. replay 竄改投影案例改驗公開 `BackupValidationError` 類型，保留成功 round-trip 對照；不要綁定會被更早 invariant 拒絕的「前序不符」文字，也不要接受一般 TypeError 冒充驗證拒絕。
3. 正式 round-trip 使用真命令建立實際 student、transaction、day、settlement、postCloseEntry 後，再提交 Export／Print、加密解密與 replay。精確比較 actions 前後五類業務投影不變，不只測學生與其他不存在的 dummy ID。可重用既有 backup/day-close fixture 模式，不新增業務政策。
4. 補齊原 brief：raw dates 31/32含跨月／合法未來尾段、scope all/account限制、future H、fake actor/time/actual maps、command-only/head-only/two commands、未知結果同ID回收／不同range/H/scope拒絕、manifest及replay分層拒絕。單元 normalizer 不代替 raw Rules 邊界。
5. 現行完整13對舊錨點仍須 base/candidate 實測；兩newkind standalone最大payload/control結果與成本控制單guard因果可作本輪來源。記 selected executed／filtered-out 不混為skip失敗或全套通過；補 CI filename／非零全passed／零skip gate。
6. 最後依原 brief 的 lint/build/Vitest、受影響Emulator／backup／E2E序列、app TSC 正規化零新增、docs-check。更新 source範圍、測試/預算/診斷界線；中文commit/push ONE PR，讀回finalhead/CI後停寫，交獨立review，不等CI、不merge、不進P12c。
