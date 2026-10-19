# P12c PR #525 第二輪 rework dispatch

Owner：coordinator。已派工。Base `3d49c8f267d1a15b5b036d899d38fa7bdcd5ab93`，待修 head `157c3db52b5267453b701ded58f0808a065d53db`，同 branch `codex/p12c-report-ui`／PR [#525](https://github.com/cheerc/talented-easyorder/pull/525)。獨立 review [5568788073](https://github.com/cheerc/talented-easyorder/pull/525#pullrequestreview-5568788073) REWORK，coordinator 已核對實際 CSS、clone test 與兩條 recovery source，採納 R1/R4/R5。原 review5568149846 仍保留：R2/R3/P3 本輪已解除，原回歸不可刪或弱化。

本次 human→coordinator→impl→獨立review workflow authority 沿前輪明確定界，外部不存在的 map 不另構成批准 gate。Impl 不寫 plan、不擅自改政策，不 rebase／merge／部署／P13。

## R1：產品本身的 print surface 與 PDF 測試一致

問題：現有 descendant hiding selector 把真正巢狀 print article 設 display:none。E2E 將 clone 移到 body 下後才做 PDF，改變 CSS ancestry，所以9／5頁證據只屬 clone，不等於產品列印。

Coordinator 定案：產品使用 React `createPortal` 將 receipt-confirmed frozen print article 渲染到 `document.body` 的直接子節點；仍是同頁、同 React owner/lifecycle，不開新 window、不寫裸 DOM clone。print CSS 只按 body 直屬 siblings 隱藏一般 app 並顯示該 portal，移除逐層 `*:has` flatten/hide 規則。保留 normal flow、多頁表頭／page breaks與全 rows，不用 fixed／scroll viewport 裁切。Screen media 隱藏 portal；登出、失權、owner改變／unmount 與正常結束均正確移除。

產品列印生命週期：confirmed receipt → render/commit真portal → 註冊同owner的 afterprint cleanup → window.print一次。用實際 afterprint 結束清理 frozen surface；不能在呼叫一返回就無條件清掉，導致未觀察到真DOM。取消列印也算已發起並清 surface。late afterprint handler仍守owner token，不修改新owner state。若發起同步throw亦清理，不重複呼叫。

E2E 的 window.print stub 只可記 invocation／當時 portal身分與 rows，不可 cloneNode／append／reparent、覆寫產品 CSS、另造 print-only test DOM。stub 不派 afterprint，讓產品維持它自己的真portal；測試於此時用 page.emulateMedia(print)+page.pdf產實際PDF，驗204 selected IDs／首末／順序／range／scope／H、多頁與沒有另帳戶；original與merged都驗。PDF完成再派真 afterprint event 驗產品 cleanup。保留 Poppler provision及artifacts。至少一個 test 在window.printcallback內、任何PDF前直接讀產品portal computed display/visibility與parentElement===body，防止與實際發起時DOM不同。原始真App failing probe轉持久RED，不能只用簡化staticfixture取代。舊head/舊CSScounterfactual要在未改DOM的測試失敗；不得再用clone掩蓋。

## R4：F5 最小 descriptor 確認後可安全繼續

同owner remount可能只有最小 pending command identity，沒有 selected account/range。確認真receipt後，刪該descriptor／recovery gate，清frozen/draft，不得 setLoading(true)卻沒有後續request。若已具有效selected/range可安排完整刷新；若沒有，保留／取得有效bootstrap學生名單，顯示未選帳戶的idle狀態（loading=false），搜尋／日期／導航恢復，使用者可明確選帳戶再查。無current bootstrap資料才啟動實際bootstrap，loading必與真的request綁定。不得自動重送舊mutation或猜新revision。

RED→GREEN：同owner unmount/remount、最小descriptor、無initialStudentId且無selected account，readCommand回原receipt，確認nav resolved／loading完成／search與日期enabled，之後能選帳戶並成功完整查帳。另測有selected/range的刷新、latefail與失權仍failclosed。原命令ID不變、無第二次commit。保留對無receipt/讀取失敗的明確未確認狀態，不因缺payload偷偷新ID重送。

## R5：F2 最小 descriptor 只確認舊稽核，不重建舊輸出

Coordinator 產品定案：同mount且仍持有完整 frozen model 的原 unknown recovery，繼續沿原ID／intent輸出一次。只剩最小descriptor（unmount/失權已丟棄敏感資料）的路徑，無論目前H能否巧合相同，都只用原ID查收據；不以新snapshot重建舊CSV／print、不要求live reader回到過去H，也不改H重送舊命令。

若收到相符原receipt：視為原稽核已確認，清descriptor／action recovery gate、解除nav／操作鎖、保留去重狀態；顯示「原稽核已確認；原快照未保留，本次未發起輸出。請重新查詢後另行確認輸出。」清理敏感surface，允許真實重新查詢。新資料完成後，由使用者另一次明確操作建立新的intent／新ID／新H，這不是重試原命令；不得自動下載／列印、不得把新H資料標成原H。

若查詢失敗或尚無receipt，保留原ID／明確未確認狀態；不盲目重送失去model的舊payload、不偷偷換ID或聲稱輸出成功。可再次查詢原ID；本輪必修針對已確認receipt的永久鎖，不增加P13持久恢復能力。

RED→GREEN：原H11 intent提交後receipt使head到12，同owner remount最小descriptor，live snapshotH12；readCommand確定舊receipt後0download/0print、清gate/navresolved、range/queryenabled且可重讀H12。再明確新輸出取得新ID／H12，確認receipt後一次輸出；驗原command沒有再commit或被改payload。原完整frozen unknown recovery、StrictMode／連按、owner變動、late-success/reject/finally不汙染新owner仍過。

## 驗證與交付

先將 reviewer 的真App R1、R4/R5失敗 probes轉持久RED，再最小修復GREEN；保持前輪R2/R3/overlap回歸。完成affected component/domain/App、serial reader24/backup24/actions27、full single-worker unit、lint/build/rootTSC、exact pinned-base app完整normalized零新增；完整 legacy→P12c→prototype 與原/合併真正portal PDF。必要的缺工具／runnererror與產品assertions分別記錄，無原因重複全套不做。未改Rules／command契約不重做所有舊anchors。

E2E evidence改明示前輪clone PDF不能證產品R1修復；保留舊REWORK與各headCI歷史，impl/reviewer/provider結果分列，App208 inherited非cleanpass。更新docs-check／當前handoff/status/evidence，納入本brief；新head尚待複審/CI/merge，P12未完成。中文commit/push同PR後主動交fullhead/base/URL/PDF/text/JSON/trace/log，再停寫；coordinator派獨立重驗R1/R4/R5並對delta審查，通過前不merge。
