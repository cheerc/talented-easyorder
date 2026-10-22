# P13b2 未決命令復原契約

狀態：設計由 PR #530 合併於 `e56c8c32ee1d74c3f63838e15909200adbbe4dfa`，獨立讀取通道契約由 PR #532 合併於 `c5df292c4b5109275baf25fbd1ad75dc5d6b684f`。P13b2a 已交付共用 journal、write-ahead、receipt/context 確認與 startup recovery boundary。P13b2b1 Orders 已由 PR #533 合併；P13b2b2a Students 同頁復原已在 `49f224597dd9267334ff4c6e64bed4d4777f7e1a` 基線完成本機實作，涵蓋六種 typed Student intent、唯讀語意確認、10 秒提示、UID/db/epoch 首個 render scope gate，以及回執確認與完整 server list readiness 分離。該學生候選的 exact-head source CI／獨立 r1 review 以 live provider 為準；本地 evidence 不代表 CI 或審查。其他正式頁面的 10 秒／same-mount retry 矩陣仍未完成；不得將此批說成整體 P13b2 完成。適用正式模式，補充[正式後端規格 §8](2026-10-13-free-production-backend-spec.md#8-連線快取錯誤與查詢)。只使用既有 typed command、server receipt 與租約；不增加離線補送、業務集合或 Rules 權限。

## 1. 目標與現況

重整、分頁崩潰、斷線或換操作員後，保留可核對的原命令編號，不丟失已入帳結果，也不因暫時查不到 receipt 重新收款。P13b1 已完成安全診斷，診斷不是復原日誌；本文件不擴張它的持久欄位。

目前 `CloudOrdersPage` 有單一 localStorage pending slot，寫入失敗被忽略，且只涵蓋該頁。其他 typed adapters 共用 `cloudCommandRepository`。現有頁面記憶體中的完整 frozen intent 與 P12 匯出／列印復原邊界仍有效；本契約新增跨重整的最小識別，不保存完整操作內容。

## 2. 最小日誌與隔離

每筆持久資料只允許 `{ commandId, datasetId, uid }`，三者必須是有效識別；commandId 為 UUID，datasetId 沿 server head 契約，uid 為當次提交 Google 操作員 UID。不得保存 kind、金額、學生／交易資料、payload、revisions、reason、姓名、email、receipt、CSV、列印 model 或密碼。這是 §8 明確允許的識別例外，不稱完全無識別資料。

以 Firebase project／app 與 journal 版本分開命名空間，每個 command 使用獨立 key，不能用單一 read-modify-write 陣列覆蓋其他分頁的新記錄。key 的識別部分與 value 必須一致；同 ID、相同識別可重用，不同識別不能覆蓋。原命令 ID 在送出前固定，復原不產生另一個替代 ID。

條件式 journal 清理須先在 Web Lock 外完成 receipt 與 server owner／dataset／lease 驗證。取得 namespace exclusive lock 後，critical section 只執行同步本機 owner／mount／generation／online predicate、精確比對識別及同步移除；predicate 僅接受同步 literal `true`，thenable 或其他值一律拒絕。若本機有效性在等待 lock 時已被觀察為失效，就保留識別。這個本機 predicate 只保護本機 mutation，不取代 Firestore Rules 或 server lease 驗證；清理取消或失敗也不會改寫已確認的業務結果。

只存 canonical safe JSON；讀取也嚴格驗證原文、schema 與 key/value 連動。錯誤／無法讀取的 journal 不能當成「沒有未決命令」；不把不安全原文輸出到 UI、診斷或匯出。資料隔離為本 app/project 的已知 namespace，不能掃除 Auth、prototype 或其他應用資料。

未決識別不因 TTL、登出、失權或容量輪替被自動丟棄。容量採硬上限與可見錯誤，達上限時禁止建立新的未追蹤命令，而不是淘汰最舊資料。復原查詢須有界分頁；任何截斷、解析失敗或 storage enumeration 失敗都不能當成完整清單。實作時的容量與頁大小須在測試／維護文件具體記錄。

## 3. 提交的 write-ahead 邊界

所有正式 typed command 在真正開始提交前，先取得 Rules 授權的 server head／目前 UID，將最小識別可靠寫入並讀回核對。不得在 SDK transaction callback 中寫本機日誌，避免 callback 重試產生不一致副作用。原 input normalize／指紋與 command-ID 語義保持一致，日誌採最終 canonical ID。

transaction 仍重讀 head、operator 與 lease，檢查 datasetId 與日誌對應的 preflight head 相同，並維持既有 epoch／revisions／maintenance 契約。其他命令增加 head seq 並不自動令合法操作失敗；dataset 改變則停止，不把舊 journal 重新綁到新 dataset。非同步步驟前後確認發起者仍相同，不能借用換帳號後的 Auth 身分送舊 intent。

property getter、get/set/remove、讀回不符或容量不足，都使新命令在提交前停止，回傳新增的固定錯誤碼 `LOCAL_STORAGE_UNAVAILABLE`，中文說明「尚未送出，無法安全保存確認編號」，提供重試本機儲存檢查或紙本流程。這是新的 domain 錯誤碼；實作需同步所有固定錯誤碼 consumers、診斷 allowlist 及中文指引，不偽裝成已入帳未知、網路離線或同步成功。

取得匹配的已確認 receipt 後才可移除該日誌；若移除失敗，業務成功仍是成功，畫面另提示追蹤記錄未清，之後重查同 ID 即可，不能重送業務。不能因日誌清理失敗把 committed 結果改成失敗。

提交前 validation／preflight 就拒絕而尚未寫日誌時，不建立未決項。已寫入日誌的執行若沒有匹配 receipt，採保守保留，即使當前回傳拒絕；這種識別保留不是宣稱命令已入帳，也不改變既有錯誤碼。不得根據單次 null 或查詢失敗自行刪除、宣告確定未入帳。

## 4. 10 秒、同頁重試與遲到結果

真正發起後立即防連按；10 秒仍無確定結果，顯示「結果確認中，勿重新收款」與原 command ID。10 秒是狀態提示，不能當成 abort 已完成、未入帳證明或產生新命令的理由。SDK retries 保持有限，不新增無限自動重送。

原掛載仍持有完整 frozen intent 時，只有明確人工操作才能用原 ID／原 intent 重試；重新送前先查 receipt。尚有原提交 promise in flight 時不另開同 ID 並行提交；可查詢結果，但 null 不能讓舊 promise 被當成已停止。late success／failure 只更新相符的 mount、UID、dataset、epoch 與 generation，不能在舊頁面或失權後下載、列印或顯示個資。

quota、maintenance、schema 或權限錯誤皆提供中文下一步，停止自動業務重試。失權清除完整記憶體 intent 與畫面，保留最小 journal；重新取得使用權後走 receipt 確認，不以新 epoch 默默重送舊 payload。

### 4.1 未決提交期間的獨立 server 查證通道

完整 Firestore SDK 的 transaction commit 等待回應時，同 client 的 server read 可能排在其共用佇列後面。P13b2b 同頁查證採官方 `firebase/firestore/lite` 的獨立唯讀 adapter，沿用**同一個 FirebaseApp** 的目前 Auth／App Check providers；不用第二個登入、手工取得／持久化 token、Admin／服務帳號、手寫 REST client 或放寬 Rules。這是既有 receipt 查證的讀取通道，不是新的業務 writer、離線補送或另一份資料權威。[官方 Lite](https://firebase.google.com/docs/firestore/solutions/firestore-lite) 的 [`getDoc`](https://firebase.google.com/docs/reference/js/firestore_lite#getdoc) 直接讀 server，離線／權限／服務錯誤必須保留失敗語義，不回退快取或當作不存在。

adapter 必須由已驗證初始化流程以明確 app／project／database／endpoint 配對原 full SDK db，讀取前完成設定；同 app 不代表可猜測原 db 的 database ID 或 Emulator host。不讀 SDK 私有欄位，不以未知 instance 預設連正式端點；無法證明配對時 fail closed。Emulator 使用同一個明確 demo endpoint，正式模式保留原 Auth／App Check 與服務端 Rules 邊界，不使用測試 mock token。adapter 本身只暴露本次復原需要的 head、lease、當前 operator 與指定 command receipt 讀取，不暴露新的業務寫入介面。

兩個 SDK 的 Timestamp constructor 不同。唯讀 adapter 將實際官方 Lite Timestamp 的 seconds／nanoseconds 轉為 full SDK Timestamp 後，再交給原本嚴格 decoder／receipt builder；包含 receipt 巢狀 before／after 值，保留精度與既有 schema 驗證。只允許已識別的官方 Timestamp 類別轉換，不能接受任意 `{seconds,nanoseconds}`、`toDate()` duck type、字串日期、JSON roundtrip，或放寬共用 domain decoder 的 `instanceof`。遇到無法安全表示的值以 schema 錯誤停止，不以移除未知欄位取得假成功；轉換後的 payload／receipt 仍只留在記憶體。

獨立讀取不改變 §5 的讀前／讀後 Auth、holder、epoch、dataset fencing、receipt 身分／schema 檢查，以及 caller 的 mount／generation／online 檢查。失權或配對變更立即使舊結果失效；不得因同 app 共用 Auth 而省略 await 後驗證。只有完整查證成功返回的不存在才是 null；permission、quota、unavailable、schema 等錯誤不能授權重送或刪除 journal。已確認 receipt 的精確日誌清理仍遵守鎖外網路查證、鎖內同步本機 predicate，清理失敗不改變已入帳結果。

receipt 已確認與業務頁 ready 是不同狀態。原提交回應仍未返回時，可顯示「伺服器已確認入帳，正在重新載入資料」及原 command ID；full SDK 的業務 heads 仍可能等待。必須持續遮罩／鎖住依賴新資料的業務控制與導覽，直到 fresh server heads 完成或顯示載入錯誤；不能假裝已同步、使用舊 heads 或再送同筆。原提交 promise 的存活狀態須獨立保留，直到真正 settle，不能因 receipt 查證成功就假裝網路已結束。遲到的原成功／失敗不能重做成功副作用、輸出、解除新 owner 的 gate 或覆蓋已確認結果。

必要證據：真 production App＋合成 Auth／Firestore Emulator，在 server 已提交、原 commit response 仍被扣住的條件下，透過實際 adapter 查到且解碼原 receipt；一個業務 effect、零並行重送，先顯示已確認但未 ready，再釋放原回應並完成 fresh heads。另有同 Auth 失去租約的 permission-denied、合法 holder 缺 receipt、服務失敗、Timestamp 正反控制、await 中換 UID／epoch／dataset 與配對失敗的 fail-closed 證明。App Check 未配置的 Emulator 結果不等於正式 App Check token 行為已驗。測試 Admin REST 只能作獨立 server witness，不能當產品 adapter 的查詢路徑。

## 5. 重啟與接手的結果確認

合法 holder 的 cloud shell 在啟動／恢復連線時，先完整讀取本 app journal、核對 server dataset，查詢當前 dataset 的待核對 ID，再重讀業務 heads 後開放新的操作。查詢或完整性失敗維持可見 gate；不是恢復 cache 或空資料開放寫入。舊 dataset 的識別保留並標示需要維護核對，不能查新 dataset 的同名 ID 後誤清。

同 dataset 可包含前一位 UID 的識別；目前合法 holder 可用原 ID 查詢既有 receipt，沿現有 `readCommand` 權限，不使用原 UID 模擬登入／送出。未獲使用權者不能藉 journal UI 讀取業務或 receipt。顯示及下載的 receipt／敏感內容仍限記憶體，不寫回 journal。

確認 receipt 時檢查 ID、schema／指紋與 server dataset context，並在讀前／讀後確認 holder、epoch、dataset 未變。成功確認表示「該命令已入帳」，不表示收到現金、印表機已印或備份已驗證。只清除精確相符的那筆識別，不清整個 namespace／其他分頁記錄。

receipt 查詢成功返回 null 僅表示「伺服器目前未查到」，查詢失敗則表示「目前無法確認」。兩者不能混為明確拒絕／未入帳；都不自動補送、不恢復舊 payload、不清 journal。重啟後沒有原 intent，不提供用猜測內容重建命令的按鈕。

對成功查詢但仍為 null 的項目，提供再次查詢與「保留編號，移交人工核對並繼續其他作業」。後者須明確確認「本筆結果尚未確定，不得重新收款或重登」，只解除本次畫面的核對 gate，保留 journal 與持續可見的待核對清單；不標記已解決／未入帳，不存另一份財務草稿。後續重新載入仍再次查詢；換 owner／dataset 或新增其他分頁項目時，重新核對相關清單，不能沿用舊 owner 的解除狀態。

這個選擇允許其他獨立業務繼續，不授權系統判斷另一筆交易是否等於原筆。人工以紙本編號與查帳核對原筆，必要補登依 P13d；不聲稱最小日誌可自動比對實際收現。需要長期保留且永遠查不到的識別，留待維護流程處理，不在本批提供一鍵「確認未入帳並刪除」。

P12 匯出／列印與 P14 備份的 minimal recovery 只確認原稽核 receipt，不重建舊報表 H、重新下載／列印、改 backup checkpoint 或宣稱檔案已保存／驗證。必須重新查詢資料並明確發起新的輸出意圖；原稽核 receipt 仍保留為歷史。

## 6. 相容與分批交付

既有 `easyorder-cloud-pending-order` 只在驗證其三欄最小識別後遷入本 app 的 journal；讀回確認成功才移除舊 slot。malformed／不同 dataset 或無法遷入不可被當成空白成功。新寫入不再使用單 slot；其他 prototype/local 帳務不得遷入。不得把它的舊「確認未入帳並清除提醒」行為當成本契約的 null 解決方式。

採分批實作：先共用 journal 與 repository write-ahead／錯誤碼／receipt context，再 shell 復原 gate 與各正式頁面的 10 秒／同 ID／owner 行為；每批有自己的明確驗收範圍。直到所有正式 command adapters 及頁面涵蓋前，不宣稱整體 P13b2 完成。中間批次也必須提供已啟用 journal 的可見確認／錯誤入口，不能只寫入無法處理的 pending 資料。

## 7. 必要驗收

- 真 Emulator commit 已送達、回應丟失，重整後查到原 ID／seq，財務 effect 一次；原 promise 遲到不重複觸發 UI 成功或輸出。
- 真 tab crash 前已保存三欄 journal；storage denied／quota／讀回錯誤時未呼叫業務 transaction；成功後清理失敗不改 committed 結果。
- 兩分頁／兩命令不互相覆蓋或刪除；canonical raw 無額外資料；登出保留識別、清除敏感記憶體，prototype/Auth 資料不變。
- B 取得新 epoch 後 A 的 late callbacks 不授權；B 可確認原 ID但不重送原 intent；舊 dataset 不會被新 dataset receipt 誤消除。
- server null、讀失敗、舊提交仍 in flight 三種情況分別呈現，均不可假稱未入帳／換 ID；人工繼續其他作業後 journal 與未決警示保留。
- 10 秒慢回覆／quota／permission／maintenance／缺 config／offline 狀態不顯示已同步；跨 reload 的 journal 與診斷各守其 allowlist。
- Export／Print／Backup 稽核 receipt recovery 不下載、列印或推進備份已驗 checkpoint；新輸出必須重新讀取並建立新意圖。

本文件僅定義契約；尚無新增 runtime、Emulator、browser 或 production 驗收結果。
