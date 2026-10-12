# 前端 prototype 分批修正計畫

日期：2026-09-29；基準 `884a996`；目前狀態：**計畫待 review，實作均未完成**。產品契約以 [workflow spec](../specs/frontend-prototype-workflow-spec.md) 為準，需求背景見 [交接入口](../../FRONTEND-PROTOTYPE-HANDOFF.md)。

## 執行原則

每天一餐、晚餐。收款輸入淨入帳額：餐費 90，找零後記 90；保留 10 元則記 100。不建餐次切換、鈔票面額／找零計算。沿用已熟悉的 F1 主結構，不做整站改版。

每批一個可測切片，必要時再拆小 PR；每個 PR 都要有可操作 demo，不交付「底層都好了、UI 下次再接」。本計畫不是授權後端開發。若既有 Firebase 路徑與練習模型衝突，新增薄的 local 邊界並停在前端，不順便遷移正式資料。

依賴：M0 → M1 → M2 → M3 → M4。M1 的已重現錯誤可先出小修復，但必須有 M0 的固定資料才能本人簽收；M2 不得被非必要的視覺工作延後。團隊自行估時，不以不明確的人天承諾排期。

## M0：讓本人能從空白開始練習

**交付畫面**：明確標示本機練習的 F3「練習資料」，可從空白／範例開始、手動建名單、設期初、匯出與還原；不用 DevTools、不用編輯 TypeScript。

實作工作：

1. 增加 `dev:prototype` 啟動入口與 local mode 判定，在初始化前擋住 Firebase provider、AuthGate、subscriptions、sync。獨立 port／storage key，不只改狀態文案。提示只說本機保存，移除 timer 假同步。
2. 定義版本化本機 dataset：accounts、openingBalances、vendors、menusByDate、transactions、audit revisions、settlements、cashSessions、simulationDate。期初有自己的 ID／日期／來源，不能假扮收款。由同一 domain balance 函式接受期初＋有效交易；不要只加欄位卻未接取消／重算。
3. 手動新增／修改姓名別名／停用／恢復帳戶；開帳前可輸入正負期初。重複 ID 報錯，前導 0 保留，停用者歷史可查。UI 文案可沿用「學員管理」，但不得強制學生專屬欄位。
4. 匯出完整快照、驗證後原子還原；空白／範例／只清交易分開，顯示範圍及數量。保留名單模式清交易後重算回期初，清 audit／結算／草稿，供應商行為明確；取消完全不動。
5. 模擬日期與檢視日期分離；日期 key 菜單。空白提示下一步，先保存完整資料集再允許訂餐。
6. 既有格式提供可讀 migration 或先匯出、另建練習資料集。不要讀壞就自動套種子；不改一般模式的舊庫。

程式落點：`frontend/src/App.tsx`、`providers/FirebaseProvider.tsx`、`store/posPersistence.ts`、`store/posTypes.ts`、`store/posActions/menuActions.ts`、`storage/indexedDBStorage.ts`／validator／migration、`mocks/initialData.ts`、`components/screens/AdminScreen.tsx`、`domain/student.ts`、`domain/ledger.ts`。`BackupScreen.tsx` 不能直接當已完成備份；其假進度／SQLite／Sheets 文案須移除或保持不掛載，實作實際功能再開入口。

**驗證**：S01–S06；無 Firebase env 與有 env 兩種啟動皆零雲端行為；快照 round trip 比較所有實體和穩定 ID；無效匯入／寫入失敗原資料完整；期初 200 訂 90 →110，重整／重算不歸零。M0 必須先有可保存的期初模型，M2 再完成全部更正路徑。

**本人 demo**：空白 → 建 3 帳戶 → 晚餐90、現金1000 → 匯出 → 載入範例 → 還原原快照。對應 F05/F06/R04。通過後才請本人建立真實資料。

## M1：把 F1 做成不用猜的鍵盤流程

**交付畫面**：保留身份／餘額、Q/W/E、最近帳戶；新增清楚的提交／取消、成功結果、可見高亮及當前有效快捷鍵。

實作工作：

1. F01：搜尋結果使用共同 selector；exact ID、alias、active 過濾一致。候選清單可捲且 active 始終可見；無結果提示；選取由 stable ID 決定，不用 stale index。
2. F02：把 priceOverride、label 與整張交易草稿綁定，所有取消／換人／成功／切日共用 reset；特殊餐子流程取消還原預設。不要只補一處 Esc handler。
3. 定義 keyboard scope：modal → 當前控制項 → 本頁快捷鍵 → 全域導航；合併或協調現有兩個 hook，避免雙 Enter。處理 composition、repeat、修飾鍵、原生 button/select 行為。
4. F1／完成／取消後搜尋自動 focus；文字姓名可直接輸入。A 只在非文字輸入處生效，搜尋時以 Tab 到「新增櫃台收支」；提示不能誤導。暫不增加新字母鍵。
5. 確認登記／收款與取消都有按鈕、快捷提示和合理 Tab 次序；已訂預設 W 保留，但明示已有幾份。重複訂餐確認預設取消，不可長按 Enter 連續穿過。
6. 成功畫面 freeze 此筆結果，不在後面再算下一次扣款；Enter 回搜尋。儲存中防重送，失敗保持草稿與可讀狀態。
7. 響應式適配1920×950、1440×727、1280×680與本人MacBook Pro 13吋實際視窗。以grid/flex重排／收合側欄，禁止整頁縮放；驗100%／125%與大字、modal可達。小視窗可垂直捲，不能裁切主動作。PWA提示不遮內容；保留現有theme。

程式落點：`components/pos/SearchBox.tsx`、`CustomerCard.tsx`、`ActionBar.tsx`、`RecentStrip.tsx`、`PosColumn.tsx`、`hooks/useKeyboardShortcuts.ts`、`useAppNavigationShortcuts.ts`、`useFocusSync.ts`、`useConfirmHandler.ts`、`usePosFlow.ts`、`domain/posFlow.ts`、`components/ui/NumericInput.tsx`、`styles/pos.css`。

**驗證**：K01–K09；重現 F01/F02 先成 regression；real browser keyboard flow＋真實 Windows IME，普通數字／numpad Enter；PC與MacBook13吋、大字／125% 版面；沒有多一筆、不殘留上一人草稿。不做 screenshot 像素全相等這種脆弱測試。

**本人 demo**：十人連續訂餐，穿插找姓名、找零後記90、收100留10、W只繳費、特殊餐取消、同帳戶加訂。本人說出哪一步需要思考或拿滑鼠，下一輪只修那些阻力。

## M2：先讓更正後的帳一致且可追溯

**交付畫面**：F1 E／最近帳戶與 F2 更正同一行為；更正理由、前後數字、作廢状态可見；F5 讀得懂每次修正。

實作工作：

1. F03/R04：期初＋有效交易統一重算，更新全部 afterBalance／currentBalance；recent、report、history 及 export 使用正確 selector。不要用 stale afterBalance 當目前餘額；不要把期初歸零。
2. 盤點所有 mutation 入口：process／commit、updateTransaction、editTransaction、deleteTransaction、deleteOrderWithRefundCheck、undo、F1／F2 modal。共用 validated command（日期鎖、理由、穩定 ID、revision）與一次保存；沒有可繞過的舊路徑。
3. 正常 UI 的硬刪改作廢或完整 revision＋audit。原資料始終可查；持久化失敗整個 command 失敗，不出現交易改了、audit 沒寫。撤回也保留理由和原單。
4. 區分資料更正、取消餐費、實際退款；取消留存收款 vs 退還本筆收款先顯示對帳戶／現金的影響。團隊 review 本機表示方式：projection + immutable audit 即可，不建複雜新帳務引擎。
5. F08：份數／餐費／收現／支出／筆數／欠款各自命名與公式。未付訂餐算筆數；不保留誤導「新增欠款」卡片，除非明确顯示它的口徑。全日總計不得取顯示切片。
6. F09/F10：表單中文、理由必填；歷程以帳戶／日期／交易為入口，展開原值與新值，操作員本機標籤、Asia/Taipei 時間一致。

程式落點：`domain/ledger.ts`、`ledgerReport.ts`、`ledgerAudit.ts`、`transactionViews.ts`、`ledgerExport.ts`；`store/posActions/editActions.ts`／orderActions／paymentActions／transactionActions、`store/derived/`、`hooks/useUndoCountdown.ts`／`useCancelDialog.ts`、`EditTransactionModal.tsx`、`report/AuditTrailTable.tsx`、report rows、`PosColumn.tsx`、`App.tsx`（200 筆限制）。

**驗證**：L01–L06；同帳戶多筆及同 timestamp 的中間交易更正／作廢；期初正負；已關帳 store guards；原狀態快照及 audit 一致保存；201 筆不截總計；CSV／重整一致。fixture oracle 用手算，不以同一程式函式算 expected。

**本人 demo**：0→訂90→繳100→把100改120，所有畫面30；理由可查。獨立 fixture 比較取消留款和實退；兩種都能回到原單。未通過不能以「卡片顯示正確」就關閉 bug。

## M3：完成一天晚餐與查帳閉環

**交付畫面**：F3 設定晚餐與現金 → F1 登記／櫃台實付 → F2 日末點現金 → F5 回查與重開。

實作工作：

1. F3 每日日菜單驗證、有效供應商、保存回饋；改設定不改舊單快照。F4 最小維護與停用；不要先做圖片 catalog。
2. F2 把今天明細置前，關帳由「日末點現金」展開；保持姓名搜尋及原始明細。畫面可精簡，資料與匯出不能省略。
3. 用實際現金口徑完成收支／差額；不得把學生餐費總額再算成櫃台付出。期初本人確認，0差額可關、有差額必填理由；搜尋／週月篩選不能縮小關帳基礎。
4. 鎖帳擋所有入口；重開保留歷史版本，更正再關新版本。練習模式不要被 queued sync 擋住；不更改正式 Firebase 策略。
5. F5 補帳戶／日期交易查詢入口，重用 F2/個人歷史能力；更正紀錄能導航原單。清楚區分現在餘額、交易後餘額與區間截止餘額。

程式落點：`screens/AdminScreen.tsx`／`VendorsScreen.tsx`／`ReportScreen.tsx`／`HistoryScreen.tsx`、`report/CashClosePanel.tsx`／`ReopenDialog.tsx`／`SettlementHistoryTable.tsx`、`domain/cashClose.ts`／`cashSession.ts`／`menu.ts`、`store/posActions/sessionActions.ts`、`hooks/useSystemDate.ts`、`domain/businessDate.ts`。

**驗證**：D01–D06；同一練習日以固定 golden scenario 核數，跨日不污染菜單／現金；關帳重開 revision；歷史唯讀。完整 print/CSV 抽樣欄位、筆數與金額一致。

**本人 demo**：開帳1000、完成驗收五筆、付供應商270、應有1330；點1320差−10並寫原因；重開、記漏收10、應有1340、重新點1340，保留兩版結算。差額本身不自動造一筆交易。

## M4：本人資料與連續使用驗證

由本人在本機從空白建立 10–20 個熟悉帳戶（含欠款、餘額、同名／共用帳戶、教職員）、實際供應商及確認過的期初。不要把原 Excel 整份自動轉成交易，也不要上傳到 repo。

模擬至少 3 個晚餐日：第一天一般訂餐／繳費，第二天更正／取消／查舊單，第三天對帳／還原／重跑。每次先匯出快照，依 [操作清單](../verification/2026-09-29-operator-prototype-checklist.md) 記錄畫面、按鍵、預期／實際及金額，不用寫技術原因。

團隊先處理「選錯人、錯金額、找不到紀錄、焦點走失」再處理間距／字色。每輪最多選 3–5 個明確摩擦點；不得以回饋為由重新擴 scope。本人確認「F1 能連續操作，改錯能追，日末能核，清空可重來」後，本輪 prototype 才完成；是否正式營運／後端／iPad 另議。

## PR、測試與交付契約

- 本次文件 PR：檢查相對連結、規格矛盾、fixture 手算、`git diff --check`、公開內容無真人來源。沒有 code 變更，不宣稱 lint／build／Vitest 已重跑。
- 後續實作 PR：Node 24、乾淨依賴下執行 `npx tsc --noEmit`、`npm run lint`、相關 regression tests、全 `npx vitest run`、`npm run build`；依 repo CI 維持既有 emulator checks，這不是邀請擴後端。新增 local E2E 不依賴 Firebase。
- 前端 persistence／money／keyboard 測試須驗 observable 結果與失敗路徑；UI 文案／間距不需要為 coverage 湊單測。
- 每批 PR 說明：解決的 F/R ID、對應 S/K/L/D 測試、準備資料／啟動指令、實際結果、未驗項、資料格式遷移／回復方法、三分鐘操作路徑。不要留「自行開 DevTools 清庫」給本人。
- 簽收三欄獨立：code merged、team verified、operator accepted；本文件不預勾。operator 失敗回饋可先記清單 ID，不必先會開 issue；team 整理成 issue 再回填。
- 本文件的 M0–M4 不改寫歷史 Phase DONE；代表新一輪產品驗收。每批更新 PROJECT-STATUS 指向實際 PR 和驗收紀錄。
