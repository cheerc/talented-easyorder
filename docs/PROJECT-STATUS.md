# Project Status — Talented EasyOrder

> **2026-10-15 正式後端進度：** [零費用正式後端 spec](superpowers/specs/2026-10-13-free-production-backend-spec.md)與[19 階段計畫](superpowers/plans/2026-10-13-free-production-backend-plan.md)為權威規格與順序。P00–P05 已合併。P05 #476 base `837a1e871468db217463e9799480beeb6d7b0ab0`、source head `0fe7ac738c8495def1c9fdc19580745ff4b4e33f`、實際 merge SHA `41cd08715c435bc5d72ee38985fccd40e0ee4dd1`；[獨立 review 通過](https://github.com/cheerc/talented-easyorder/pull/476#pullrequestreview-5521098252)，required CI run [38596486712](https://github.com/cheerc/talented-easyorder/actions/runs/38596486712) 兩個 jobs 均成功，使用 pinned Chromium 148.0.7778.96／Playwright v1223。P05 production Rules Emulator 79/79；A01/P01/P05/P04 lease sequential regression 144/144、0 skipped；Cloud E2E 12/12、隔離 prototype 7/7，19/19。完整 Vitest 1,297 passed、144 skipped（五個 Emulator-only suites，另由 Emulator 回歸實跑 144/144），full lint/build 通過。app TypeScript exit 2，290 項 inherited diagnostics；完整 542 行 normalized output 與 base 相同，無新增診斷。P06 production Rules Emulator 局部 gates：未篩選 command/list 108/108、P05 post-commit recovery 2/2、A01 10/10、P01 36/36、P04 lease 19/19。filtered `-t P06` 的 57 not-selected 沒有執行，另以未篩選 suite 97/97 補足；尚未完成整體 P06 acceptance。新後端未部署或開放正式帳務操作。Android 另案；下方既有前端追蹤與本人驗收紀錄維持原狀。

> **已合併基線：** P00 #471、P01 #472、P02 #473、P03 #474、P04 #475、P05 #476；各 PR 實際 merge SHA 與歷史限制見[現況與證據](ops/free-production-evidence.md)。P06 學生名單與期初手動建檔位於 `codex/backend-p06-students`，唯一 PR base 為 `b53423aa71ed4cfac2428f290c648e5a999a0cae`。production Rules command/list 108/108、P05 failure 2/2、A01 10/10、P01 36/36、P04 lease 19/19 的局部 Emulator gates 已通過；D01/auth-loss/second-browser UI E2E、prototype regression、full local gates、required CI 與獨立 review 尚待完成，故 P06 phase 尚未驗收。500 人可完整讀取、501 人 fail closed；不宣稱此 phase 支援完整大於 500 人名單。P07–P18 尚未開始／未驗。新後端尚未部署或開放正式帳務操作。此更新不更改下方歷史前端本人驗收紀錄。逐 PR 接手流程見[開發交接入口](DEVELOPMENT-HANDOFF.md)。

> **Last inspected:** 2026-09-29，程式基準 `884a996`。
> 本輪只更新 spec／計畫／驗收文件；沒有改應用程式、沒有完成本人驗收。

## 1. 當前方向

PC 晚餐櫃台前端 prototype：鍵盤為主、滑鼠為輔，保留 operator 約七成滿意的 F1。每天一餐（晚餐）；餐費90找零後記90，多留10元則記100。支援1920×1080 PC及MacBook Pro 13吋，按可用視窗重排，不整頁縮小。

前端本人驗收仍依下方清單；正式後端另依 P00–P18 計畫推進，目前 P06 學生名單與期初手動建檔正在實作，驗收尚未完成。iPad、真實人臉裝置整合與 Android 另案。

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
