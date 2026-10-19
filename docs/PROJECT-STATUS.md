# Project Status — Talented EasyOrder

> **2026-10-19 P12 merge／最終收據準備 checkpoint：** P12a PR #521（final source `c161f9196d7836e310c45cdfe3312cefed611842`、merge `c9988b35912f761bb79c08476ac9636c0fcc49aa`）與收據 #522（merge `e12afbf506801de56715f970a5c29393846a48d5`）、P12b PR #523（final source `f63cf1180394d1a4ffe3f0770efc4687a6d4752b`、merge `759a37cc9d2c503365b07c4f4662f328efd3aa75`）與收據 #524（merge `3d49c8f267d1a15b5b036d899d38fa7bdcd5ab93`）、P12c PR #525（runtime source `c6c9fe2ba4f44a08368793843d2d3da192b0e02c`、final source `07750a9d45bfb3b4442054482fe9b289f6fb4f38`、merge `5742e66e218070167498e5daa7d9c8da7e1f91fc`）均已合併。#525 final review [5569465904](https://github.com/cheerc/talented-easyorder/pull/525#pullrequestreview-5569465904) 與 test/docs delta review [5569731354](https://github.com/cheerc/talented-easyorder/pull/525#pullrequestreview-5569731354) 均 PASS；exact final source CI [39232200728](https://github.com/cheerc/talented-easyorder/actions/runs/39232200728) build-and-test／e2e 成功。merge SHA main CI [39234769046](https://github.com/cheerc/talented-easyorder/actions/runs/39234769046) 派工時為 IN_PROGRESS；Coordinator 於 2026-10-19T10:17:59Z 以 provider 確認 COMPLETED／SUCCESS（attempt 1，build-and-test 與 e2e 均成功）並明確解除發布 gate。P12a／b／c 程式合併與工程驗證完成；最終 docs-only receipt 的獨立 review、receipt CI 與 merge 尚待完成，P12 整體流程不提前宣告完成；沒有 production deployment、正式索引／quota／latency 驗證或本人營運驗收，不進 P13。完整 lineage 與分項證據見 [P12 最終收據 evidence](ops/free-production-evidence.md#p12-final-merge-and-receipt-preparation-2026-10-19) 與 [dispatch brief](superpowers/plans/2026-10-19-p12-final-receipt-dispatch.md)。

> **歷史 checkpoint（2026-10-19 P12c fourth-round L07 test-only delta，merge 前）：** PR #525 維持 branch `codex/p12c-report-ui`、pinned base `3d49c8f267d1a15b5b036d899d38fa7bdcd5ab93`；只修 E2E 等待競態與更新證據，不改 runtime。直接 locator assertion 等待精確 H=before+1；test-only route 控制 fresh-read 延遲超過 5.5 秒仍能完成，餘額 +25 與後日 settlement 不變斷言保留。P12c browser 2/2、lint 與 root TSC 證據見 [P12c L07 CI readiness evidence](ops/free-production-evidence.md#p12c-pr-525-l07-ci-readiness-checkpoint-2026-10-19)。待此 new head 的獨立 delta review 與 exact-head provider CI；前一 head CI 不適用本 delta。PR 未合併；P12 未完成，沒有 production deployment、正式索引驗證或本人營運驗收。

> **2026-10-19 P12b merge／收據狀態：** P12b 匯出／列印發起稽核已由 PR [#523](https://github.com/cheerc/talented-easyorder/pull/523) squash merge `759a37cc9d2c503365b07c4f4662f328efd3aa75`；runtime source `1d2e3f4da70ec744b4250cf281ab5fd53ee518de`、final source `f63cf1180394d1a4ffe3f0770efc4687a6d4752b`。獨立 COMMENT review [5566424126](https://github.com/cheerc/talented-easyorder/pull/523#pullrequestreview-5566424126) PASS，final-head CI [39191296570](https://github.com/cheerc/talented-easyorder/actions/runs/39191296570) build-and-test／e2e 均成功。Main CI [39194450495](https://github.com/cheerc/talented-easyorder/actions/runs/39194450495) 派工時為 IN_PROGRESS；之後 Coordinator 確認該 run 對 merge SHA `759a37cc9d2c503365b07c4f4662f328efd3aa75` COMPLETED／SUCCESS，build-and-test／e2e 均成功，`watch --exit-status` exit 0，發布 gate 已解除。docs-only receipt PR 已建立，待獨立審查與合併。P12a PR #521 與 docs-only 收據 #522 均已合併；review／CI 明細見[P12a receipt evidence](ops/free-production-evidence.md#p12a-pr-521-merge-and-receipt-checkpoint-2026-10-19)。當時 P12c 尚未開始，P12 整體未完成；未部署、未驗正式 indexes、quota／latency 或本人營運驗收。詳細 P12b 證據見[執行 evidence](ops/free-production-evidence.md#p12b-pr-523-merge-and-receipt-checkpoint-2026-10-19)。

> **2026-10-19 P12a merge checkpoint（P12b 派工前狀態）：** P12a 資料層 PR [#521](https://github.com/cheerc/talented-easyorder/pull/521) 已合併為 `c9988b35912f761bb79c08476ac9636c0fcc49aa`；docs-only 收據 PR [#522](https://github.com/cheerc/talented-easyorder/pull/522) 已發布、等待獨立複審。source head `c161f9196d7836e310c45cdfe3312cefed611842` 的獨立複審 [5564603618](https://github.com/cheerc/talented-easyorder/pull/521#pullrequestreview-5564603618) 為 PASS；原 REWORK [5564521278](https://github.com/cheerc/talented-easyorder/pull/521#pullrequestreview-5564521278) 對應前一 head `a81fc31e7fe8fbbc1f6fc830f18ff8f17e7d377f`。source CI [39158763724](https://github.com/cheerc/talented-easyorder/actions/runs/39158763724) 兩個 jobs 成功。main CI [39159574321](https://github.com/cheerc/talented-easyorder/actions/runs/39159574321) 已由 Coordinator 從 provider 確認 COMPLETED／SUCCESS，main 仍為 merge SHA `c9988b35912f761bb79c08476ac9636c0fcc49aa`；派工時為 pending，本輪依 Coordinator 回報，沒有自行輪詢。P12a 只完成資料層，沒有 F2/F5 UI 或匯出／列印使用流程；P12 整體未完成。P12b 當時已授權、待 coordinator 具體派工；當時 P12c 尚未開始。未部署、未驗正式索引或本人營運驗收。測試與 review 各自證據見[執行證據](ops/free-production-evidence.md#p12a-pr-521-merge-and-receipt-checkpoint-2026-10-19)。

> **2026-10-18 P11c4b 收據狀態：** P11c4b 已由 PR [#519](https://github.com/cheerc/talented-easyorder/pull/519) 合併；base `fa214036e18d5e600cdb729a4e3b2732c51ec458`、source head `340726ff4b14343e4542eaa3bd936ede50fbfa0e`、merge SHA `855679804a12cd1bce5dce72fe2da20127e2c85d`。舊 head `3fab34e29a04ea8449fd406b7f8f54abb839a4c2` 的 REWORK review [5563425902](https://github.com/cheerc/talented-easyorder/pull/519#pullrequestreview-5563425902) 與新 head delta PASS review [5563479986](https://github.com/cheerc/talented-easyorder/pull/519#pullrequestreview-5563479986) 分開；新 review 是 COMMENT review，正文結論無剩餘必修。source CI [39137275659](https://github.com/cheerc/talented-easyorder/actions/runs/39137275659) 兩個 jobs 成功；merge SHA main CI [39138091279](https://github.com/cheerc/talented-easyorder/actions/runs/39138091279) 已 COMPLETED／SUCCESS，build-and-test 與 e2e 均成功；未重跑。P11c 已完成；P12 已授權，P12a cloud 報表資料層已完成，PR 與 provider CI 狀態見上方 checkpoint；P12b／當時 P12c 尚未開始。尚未部署、未開放正式帳務操作、未做正式環境索引驗證或本人營運驗收。收據證據見 [P11c4b merge checkpoint](ops/free-production-evidence.md#p11c4b-merge-and-receipt-checkpoint-2026-10-18)；文件派工 brief 見 [P11c4b receipt dispatch](superpowers/plans/2026-10-18-p11c4b-receipt-dispatch.md)。

> **2026-10-16 整合與進度更新：**
> - **前端 Prototype 定稿線**：U1（PR #481）、U2a（PR #483）、U2c（PR #482）先前已合併至 main。U3（PR #484）、U4（PR #485）、U2b（PR #486）與雲端 P06b（PR #487）經各自獨立 review PASS 後，已由整合 PR [#488](https://github.com/cheerc/talented-easyorder/pull/488)（source head `58191718e2388bfbf954314128f5357370e65123`，由使用者授權 `--admin` squash merge SHA `6ae1909639f56aa6d36524406e700554891f6328`）合入 main。審查收據見 [前端整合審查收據](ops/integration-review-3bfa4d6.md) 及 [P06b＋前端整合審查收據](ops/integration-p06b-review-5819171.md)。提供使用者可操作之 [Prototype U1–U4 本人操作驗收步驟清單](superpowers/verification/2026-10-16-prototype-u1-u4-verification-checklist.md)。
> - **重要邊界聲明**：**Prototype 前端功能完成 ≠ 雲端正式後端全完成 ≠ CheerC 本人營運驗收**。自動化測試與代碼審查 PASS 僅為技術交付基準，不代簽營運驗收。
> - **正式後端進度**：[零費用正式後端 spec](superpowers/specs/2026-10-13-free-production-backend-spec.md)與[19 階段計畫](superpowers/plans/2026-10-13-free-production-backend-plan.md)為權威依據。P00–P09 與 P06b 已合併至 main（P07 merge `436b119`，P06b merge `6ae1909`，P08 雲端訂餐 #491 merge `889c75c`）。P09（依 CheerC 2026-10-16 指示）已完成：P09a 繳費與櫃台收支（#493，`c444621`），P09b 退款（#494，`5b6f9a4`）。P14 每日增量備份平行實作並合併（#496，`4b4425c`；收據 #498）。P10a 交易更正／作廢／取消／5 秒撤回已合併（#497，`1d61a47`）；P10b 期初更正（`CorrectOpening`）已合併（#501，`a92d139`）。P10 已完成。P11 正式關帳與重開已完成（CheerC 2026-10-17 指示）：P11a 後端（#503，`91b5909`），P11b 日結頁（#505，`5a030ca`）。CheerC 2026-10-17 另指示加上過去日子的補開帳再關帳（`BackfillOpeningCash`，#507，`2792ba2`）。P11c 帳務斷層與異常處理（CheerC 2026-10-17 指示，分批）：P11c1 帳務異常頁（#509）、P11c2a／P11c2b 回填斷層日（#511、#513）、P11c3 回填日關帳對齊（#515）、P11c4a 關帳後補記後端（`RecordPostCloseEntry`、有效關帳現金、P14 備份，PR [#517](https://github.com/cheerc/talented-easyorder/pull/517)，merge `4c5bb55`）已合併；P11c4b 補記 UI 已由 PR [#519](https://github.com/cheerc/talented-easyorder/pull/519) 合併，P11c 已完成；P12 已授權；P12a merge／receipt 與 P12b 授權派工的現況見本文最上方 checkpoint。P11c4a／c4b 尚未部署或開放正式帳務操作。

> **已合併基線：** P00 #471、P01 #472、P02 #473、P03 #474、P04 #475、P05 #476、P06 #478、P07 #480、P08 #491、P09a #493、P09b #494、P14 #496（收據 #498）、P10a #497、P10b #501、P11a #503、P11b #505、P11 補開帳 #507、P11c1 #509、P11c2a #511、P11c2b #513、P11c3 #515、P11c4a #517（merge `4c5bb556f0e03c2a25444e193d448de289882194`）、P11c4b #519（merge `855679804a12cd1bce5dce72fe2da20127e2c85d`）、U1 #481、U2c #482、U2a #483、整合 PR #488（含 U3/U4/U2b/P06b）；merge SHA 與驗收限制見[現況與證據](ops/free-production-evidence.md)及各 phase receipts。逐 PR 接手流程見[開發交接入口](DEVELOPMENT-HANDOFF.md)。

> **Last inspected:** 2026-10-19，P12a/b/c code 與 #522/#524 receipts 已合併；#525 source review／CI 通過。Coordinator 已核實 merge main CI #39234769046 attempt 1 的 build-and-test／e2e 均 SUCCESS 並解除 gate；最終 docs-only receipt 的 review／CI／merge 尚待完成。沒有 production deployment 或本人營運驗收。
> 本次只整理 P12 merge lineage、review／source CI／main CI 分層與收據狀態；檢查 Markdown／連結／錨點，未跑 app tests、runtime 或 production 操作。

## 1. 當前方向

PC 晚餐櫃台前端 prototype：鍵盤為主、滑鼠為輔，保留 operator 約七成滿意的 F1。每天一餐（晚餐）；餐費90找零後記90，多留10元則記100。支援1920×1080 PC及MacBook Pro 13吋，按可用視窗重排，不整頁縮小。

前端本人驗收仍依下方清單；正式後端另依 P00–P18 計畫推進，目前 P00–P11c 與 P14 等既有階段已合併；P12a code #521／receipt #522、P12b code #523／receipt #524、P12c code #525 已合併。P12c final source review 與 exact-head CI 成功；Coordinator 已核實 merge SHA 的 main CI #39234769046 attempt 1 build-and-test／e2e 均 SUCCESS 並解除發布 gate。最終文件收據的獨立 review／receipt CI／merge 尚待完成；P12 整體流程暫不標為完成；未部署 production、未驗正式 indexes／quota／latency 或本人營運驗收。iPad、真實人臉裝置整合與 Android 另案。

交接入口：[FRONTEND-PROTOTYPE-HANDOFF](FRONTEND-PROTOTYPE-HANDOFF.md)；後端起手：[BACKEND-HANDOFF](BACKEND-HANDOFF.md)（前端完成盤點、雲端現況、待決策事項、Android 銜接）。現行排程：[ROADMAP](superpowers/plans/ROADMAP.md)／[詳細計畫](superpowers/plans/2026-09-29-frontend-prototype-refocus.md)。原 Google Sheets roadmap 已封存，不再作排程來源。

## 2. 現況與驗收 gate

operator 已表示 F2–F5 尚未充分操作驗證。已 merge、open issue=0、測試通過都不等於 UI 被接受。2026-09-29 建立本文件PR之前，GitHub open PR／issue 查詢為空；新發現記於下列 audit，尚未自動開 issues。

[操作 audit](superpowers/reviews/2026-09-29-frontend-workflow-audit.md) 記錄已重現與靜態風險；[本人驗收清單](superpowers/verification/2026-09-29-operator-prototype-checklist.md) 是唯一詳細操作清單，不在此重複維護。

| 優先項目 | 證據／狀態 | 下一步 |
|---|---|---|
| F01 不可見搜尋候選可被Enter選取 | UI重現；已修待驗（M1 第一批：候選全列可捲、高亮捲入可視、以編號記住選取、exact ID 優先、別名／停用規則一致、無結果提示、輸入法選字 Enter 不選人） | M1 |
| F02 取消特殊餐後價格帶到下一人 | UI重現；已修待驗（M1 第二批：特殊餐價格與品項綁在草稿上，換人／取消／櫃台收支／切日一律清除） | M1 |
| F03 更正收款後F1／最近帳戶／F2餘額不同 | UI重現；已修待驗（M2 第一批：所有改帳入口改為從期初逐筆重算該帳戶的每筆結餘與目前餘額；最近帳戶顯示目前餘額；F2 淨變動含第一筆；當天交易不再截斷 200 筆） | M2，帳務 gate |
| F04 部分刪除／undo無稽核與鎖帳檢查 | 靜態確認；已修待驗（M2 第二批：更正、刪除、取消訂餐、撤回共用同一檢查，已關帳的日期一律擋下，理由必填；原單整筆與理由、操作員寫進稽核，和交易同一次保存；F2 刪除改為先確認；移除沒有稽核的 `updateTransaction`）；M2 第三批：關帳日的新增交易（訂餐、繳費、櫃台收支）也在 store 層擋下，不只靠畫面鎖 | M2 |
| F05/F06 空白建檔缺口／本機假同步回饋 | 畫面＋程式確認；F06 已修待驗（M0 第一批）；F05 空白起點與手動建帳戶／期初已修待驗（M0 第二批），匯出還原與只清交易已修待驗（M0 第三批），練習營業日與別名／停用已修待驗（M0 第四批），日期 key 菜單已修待驗（M0 第五批） | M0 |
| F07–F12 提示、筆數、追溯文案、時間、焦點、歷史入口 | F07、F11 M1 已修待驗；F08 M2 第四批、F09／F10 M2 第五批已修待驗；F12 M3 第五批已修待驗 | M1–M3 |
| R01–R06 邊界風險 | 定向測試待做，不能稱已重現 | 按plan分批驗 |

本人回饋可直接用清單 ID，team 再整理 issue／修復PR並回填。狀態採「發現／待重現／已修待驗／本人通過」，不得因 issue 關閉直接填通過。

## 3. 分批進度

| 批次 | Code／team驗證 | 本人驗收 |
|---|---|---|
| M0 隔離本機、空白建檔、期初、快照 | 第一批（`dev:prototype` 入口、Firebase 隔離、移除本機假同步）、第二批（空白／範例起點、手動建帳戶與期初）、第三批（匯出還原快照、只清交易）、第四批（練習營業日、別名編輯、停用／恢復帳戶、快照還原補強）、第五批（日期 key 菜單 `menusByDate`，未設定的日子沿用較早日期）已實作；M0 計畫項目程式面皆已實作，待操作者依 S01–S06 驗收 | 未驗 |
| M1 F1鍵盤／草稿／回饋／尺寸 | 計畫 1–7 項都已實作：第一批（F01 搜尋候選、K01 輸入法 Enter）、第二批（F02 草稿重設）、第三批（K08 重複訂餐預設不加訂、長按／連按不穿過、成功畫面凍結、存檔失敗可重送）、第四批（回搜尋自動 focus、A 鍵與 Tab 提示、看得到的送出／取消鍵、Enter 在按鈕上按哪顆就是哪顆、組合鍵不觸發快捷鍵、小視窗主欄可捲與側欄重排）；K07 收款欄負數修正（負號不再被吃掉變成正數，訂餐與繳費都擋下送出） | 2026-10-12 第一輪：K01–K06、K08、K09 通過，K07 未過已修待重測；Windows 輸入法、Shift+Tab、實機 MacBook 13 吋略過 |
| M2 餘額一致／更正作廢／稽核 | 第一批（F03 統一重算餘額、最近帳戶目前餘額、200 筆截斷）、第二批（F04 改帳共用檢查：關帳日擋下、理由必填、原單與理由寫進稽核；取消訂餐先顯示對帳戶與現金的影響）已實作；第三批（關帳日新增交易在 store 層擋下）、第四批（F08 報表口徑：F2 卡片改為份數／餐費／收現／支出／淨現金／筆數並在副標寫公式，筆數含未付款訂餐，移除「新增欠款」；今日營運概覽用同一套口徑，修掉不存在的欄位）、第五批（F09 稽核表顯示帳戶編號與姓名、中文欄名的前後值與理由，可依帳戶或營業日查詢；F10 各畫面時間統一台北時間，營業日另列）已實作；L05 修正（F1 送出後成功畫面上就顯示「撤回這筆」倒數 5 秒，撤回寫入稽核理由「送出後立即撤回」；以前倒數要等成功畫面關掉才開始，撤回鍵從未出現） | 2026-10-13：L01、L02、L04 通過；L03、L05（撤回，#458 修正後）、L06 於 M3 驗收時補測通過；M2 本人驗收完成 |
| M3 F2–F5每日閉環 | 第一批（關帳算對：開帳金額只認當天確認的設定，不再預設 4000 或自動沿用前一天，前一天的關帳點算只當 F3 預填建議；沒設開帳金額不能關帳；有差額必填原因；關帳面板固定用當天全部交易，不受 F2 本週／本月範圍影響；已接受待同步的列不再擋關帳；store 層也擋重複關帳；結帳歷史差額顯示正負號；F3 菜單名稱空白或單價不合法不再顯示「已儲存」；F1 關帳當天的鎖定提示改說今天已關帳）已實作；第二批（重開後再關帳：新紀錄的版次接在最高版次之後，重開列有自己的編號；最後一版依時間判斷，舊資料版次重複也能取對；隔天預填用最新的點算；重開的日子優先預填那次關帳的開帳金額；F3 預填跟著建議值更新；結帳歷史同一天最新版排最上面，舊資料同編號的列各自展開）已實作；第三批（F4 供應商：刪除改為先停用、已停用的才可永久刪除並先確認、顯示用過的菜單天數；電話與備註可清空；錯誤顯示在畫面上不跳視窗；F3 下拉只列使用中供應商並以編號存，這天的供應商已停用或刪除時提醒改選；今日營運概覽取最後一版結帳，最後一版是重開時顯示重開的人與時間）已實作；第四批（F2 日末點現金：明細在前，關帳表單收在「日末點現金」裡，橫條常駐顯示這一天的開帳、淨現金、應有；已關帳時改顯示最後一版的應有／實點／差異／原因與「重新開啟日期」；重開後提醒上次關帳實點與差異；匯出／列印移到搜尋列；日結一律算全日，不受搜尋與區間影響）已實作；第五批（F12 F5 新增「交易查詢」：依帳戶編號／姓名／別名（含停用帳戶、「櫃台」）與營業日區間查交易，已刪除原單從稽核找回並標示，每筆可展開更正紀錄，分開寫現在餘額、這筆之後、區間結束時餘額；稽核列「看原單」／「看當天」帶到交易查詢並標出那一筆；稽核查詢只打數字時比對帳戶編號開頭，不再比對交易編號，改名後用新名字或別名也查得到；D06 F1 在沿用較早日期菜單的日子提醒到 F3 確認）已實作；M3 後續（份數拆成今日便當＋其他餐點：頂部、F1、F2、今日概覽、CSV 同一口徑，另列其他餐點清單，訂購其他餐點的品項記在交易上，改備註或當天改價不影響分類；其他餐點價格欄清空不再跳回今日價格，空著不能送出；櫃台收支成功畫面只顯示這一筆，不再顯示重複金額、「#」與櫃台累計）已實作 | 2026-10-13：D01–D06 全部通過（Chrome 實機，`8f64027`）；M3 本人驗收完成 |
| M4 自建資料多日模擬 | 不需新程式；驗收步驟 P01–P06 | 2026-10-13：P01–P06 全部通過（本人 12 帳戶、3 家供應商、3 個晚餐日，`0ae43ea`）；兩個「只是不順」的摩擦點（成功畫面連按 Enter、櫃台收支方向鍵提示字小）列待排 |
| 人臉連線（M4 之後，本機模擬） | 第一批（刷臉事件自動入帳／取消規則、重送只入帳一次、平板讀到的今日訂餐狀態、註冊異動回報、平板狀態、快照、F3 模擬刷臉平板；規格見 [faceorder-handoff-spec](superpowers/specs/faceorder-handoff-spec.md)）已合併；第二批（F1「刷臉訂餐」動態、頂部平板在線／離線、F3 帳戶清單人臉欄唯讀、F1 個人當日狀況「刷臉」小標示；時間一律存 UTC、資料不完整或格式不對不寫入）已合併；第三批（#466：註冊回報與平板狀態檢查平板編號；F3 帳戶清單窄視窗時人臉欄與按鈕換行；[後端計畫](superpowers/plans/2026-10-13-faceorder-backend-plan.md)只寫計畫、未授權開工）已合併 | 2026-10-13：FA01–FA10 全部通過（AI 代為操作，`bbedd2f`；FA08 窄視窗於 #466 修正後由 reviewer 重測通過）；本機模擬驗收完成。真平板、後端未做 |

歷史 Phase1.0／1.1／1.2 已交付、Sheets phase obsolete、Phase2未啟動的背景保留於[原status快照](superpowers/reviews/2026-09-14-project-status-baseline.md)，不以歷史DONE代替上述新一輪驗收。

## 4. 程式架構與本輪驗證限制

現有 frontend 為 Vite／React／TypeScript／Zustand，IndexedDB（含localStorage fallback）與Firebase程式並存。未設定完整Firebase配置時App已有local-only分支，但尚不具備這輪要求的明確環境隔離、空白建檔、完整快照工具。

本輪實際操作：使用者5173唯讀流程，另origin的5174副本（禁用Firebase）做範例訂餐／繳費／更正／草稿取消。已目視1920×1080 content viewport；Mac實際視窗、125%、Windows IME、全面關帳／退款／故障等仍待按清單驗證。

本PR只改Markdown，做文件連結、數字案例、diff格式檢查。**沒有重跑code test suite**。2026-09-14的991 passed／8 skipped等健康度數字仍在原快照，僅為歷史基線，不冒充本輪測試結果。

既有BackupScreen未掛路由且為placeholder、版本號不一致、舊TODO等技術背景見原快照。本輪只處理會阻礙prototype驗證的部分，不開全面技術債清理。

## 5. 維護方式

每批team交付或本人回饋時，更新檢視日期、實際commit、修復PR、清單ID及驗收結果；保持「code已寫／team已驗／本人通過」分離。新的產品決策先更新workflow spec，再改對應plan與清單。此輪文件PR由project team review、rework、merge，作者不代為merge。
