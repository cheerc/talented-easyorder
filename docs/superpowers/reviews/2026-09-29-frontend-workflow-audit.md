# 前端工作流程檢視紀錄

日期：2026-09-29；code 基準 `884a996`。這是聚焦 F1 與查帳鏈的抽樣 review，不是完整功能驗收。

## 方法與範圍

- 讀取 PROJECT-STATUS、現行 4 份核心 living specs、ROADMAP、F1/F2/F3/F5 元件、鍵盤 hooks、交易／持久化／稽核程式。
- 透過 computer use 操作使用者 `http://localhost:5173/`：搜尋、選人、Q/W/E、Escape、F1–F5；未送出交易、未 reset、未修改使用者資料。
- 在同一 commit 的獨立 worktree 啟動 `http://127.0.0.1:5174/`，不複製 `.env`，並將 `VITE_FIREBASE_API_KEY`、`VITE_FIREBASE_PROJECT_ID` 覆寫為空。另 origin 的 IndexedDB 與 5173 隔離；無 Firebase 初始化。用 repository 範例帳戶測訂餐、收款、更正及跨帳戶草稿。
- 前段 viewport 實際為 1440×727；後段已用 DOM 確認 1920×1080 並目視 F1 特殊餐畫面。不能把它等同實體 PC 1920×1080 扣掉瀏覽器工具列的驗收；1920×約 950、Windows 縮放及 125% 縮放留待本人清單。
- 補測1280×680時自動核准檢查因使用額度未完成，該次操作未執行；此尺寸及125%仍是後續驗收要求。瀏覽器尺寸已恢復、獨立測試分頁與5174程序已關閉。
- 本輪未驗：真實 Windows IME／實體數字鍵盤、儲存故障、跨午夜、201+ 交易、取消退款、完整關帳／重開、正式 Firebase 同步。未修改後端，也未執行全量 code test suite。
- 2026-09-29 建 PR 前查 GitHub：open PR／issue 皆為 0，這只描述檢視當時，不代表沒有缺陷。

## 現行紙本／Excel 的意思

來源在使用者本機：`訂飯單.png`；`餐費紀錄表 2026-07 (Sample).xlsx`；repo 的 `docs/iPad人臉辨識訂餐系統設計方案_V3.pdf`（一頁，已抽文並目視）。不隨 PR 複製來源檔或真人資料。

| 來源定位 | 讀到的工作方式 | 前端需求 |
|---|---|---|
| 訂飯單圖片上方與每人空格 | 日期、午／晚餐、價錢、電話；按編號／姓名登記，另有教職員 | 以快速找帳戶為核心；不強制班級或學籍欄才能使用 |
| Excel「(使用說明)餐費收費程序」A1:C10 | 紙本填訂餐金額與收款 → 結算收入支出 → 總表登打 → 數現金與查差額 | 正常操作兩個金額清楚；日末可把紙本心智模型逐項對到系統 |
| 同頁 E1:E2；6 個嵌入圖片（錨點 C3×2、C5、C9、E7、E3） | 以代碼查餘額；圖片示範不同餐費、收入、差額與查帳結果 | 圖片均已抽出目視；其中兩組內容重複。需要個別餐費及可追溯更正，非只有固定便當 |
| 「總         表」A1:I2、E/F/G 後續公式列 | 日期、帳戶代碼、姓名、支出、收入、當筆淨額、累計、備註；G 為 F−E；期初 G 可直接帶值 | 保留餐費／收款／變動／餘額各自意義；期初不是今天收現 |
| 「餘額查詢」A1:J3 | F2 輸入代碼；H2 查餘額；J2 扣當日餐費；C 欄依姓名 SUMIF 總表 G | 系統用穩定帳戶 ID 而非姓名作 key，別名／共用帳戶須明確，避免同名誤合併 |
| 「訂飯名單(建檔)」A147:B153 | 有呆帳、零用金、差額、撿到的、借支等非學生帳戶 | UI 用櫃台收支／現金差異表示，不把它們變成可訂飯的學生 |
| V3 §1–4 | 先 PC、找人→動作→復位、每日核現金；之後才 iPad | 保留操作目的。Google Sheets／離線 iPad 記交易為舊構想，不恢復成這輪 scope |

工作簿名稱雖含 2026-07，總表實際日期包含 2026-07-01 至 2026-09-15；不能按檔名推斷只有七月。此檢視是理解流程，不是對該公司帳目的核算／稽核。來源公式沒有在本輪重算或改寫。

原表的午／晚餐欄經 operator 本輪補充釐清：現在每天只有晚餐；不需要多餐次。超額入帳與人工找零的具體規則已納入新 spec。

## 可重現與靜態確認發現

P0 = 影響選人、餐費、餘額或查帳信任，必須在正式使用前解決；P1 = 阻礙順暢操作／理解。這裡的優先級不是宣告既有線上事故。

| ID／級別／證據 | 步驟與實際結果 | 目標與 code 落點 | 交付／驗收 |
|---|---|---|---|
| F01 P0，UI 已重現（5173） | F1 搜尋 `1`，有超過 6 筆；Down 6 次後無任何可見 selected，Enter 選到未顯示的 `015` | 高亮項永遠可見。`SearchBox.tsx` 只 `slice(0,6)`，Down 上限卻用完整 suggestions；`PosColumn.tsx` submit 用完整 index | M1／K02 |
| F02 P0，UI 已重現（5174、1920×1080） | 選 002 → 其他餐點，品項「測試特殊餐」、110 → Esc → 選 003；預覽仍是特殊餐 110，應回到當日 90 | 全部草稿欄位與人綁定並一次清除。`App.tsx` 的 priceOverride 為 flow 外 state；`useUndoCountdown.ts` 成功關閉有清除，cancelFlow 路徑沒有同等清除 | M1／K06 |
| F03 P0，UI 已重現（5174） | 001 期初 0，訂餐 90 收 0 → 繳 100 → E 編輯繳費 120；帳戶卡 30、最近帳戶 10、F2 目前餘額 10 | 全部視圖同一餘額來源，交易後餘額一致重算。`editActions.ts/editTransaction` 更新 currentBalance，未更新 afterBalance；報表取 afterBalance | M2／L02 |
| F04 P0，靜態確認 | `deleteTransaction` 直接 splice，無 auditEvents／理由／closed 檢查；F1 繳費刪除與 undo 使用它。未實際刪除 | 所有入口共用更正／作廢邊界，不能只改 F2 按鈕。`editActions.ts`、`PosColumn.tsx`、`useUndoCountdown.ts` | M2／L04、L05 |
| F05 P0，UI＋靜態 | F3 學員管理只有搜尋、分頁；Reset 文案回到範例，`resetData` 也未重設 vendors。無空白建檔、期初表單及可用備份 UI | 分離空白／範例／還原，明示重設範圍與檔案回復。`AdminScreen.tsx`、`menuActions.ts`、`posPersistence.ts`；BackupScreen 是未掛路由 placeholder | M0／S01–S06 |
| F06 P1，UI 已重現（無 Firebase 5174） | 初始「雲端已同步」，成功交易顯示「推送中」，隨後回已同步 | 本機只說本機保存；持久化完成才成功。`useCommitLifecycle.ts` 以 800ms timer 模擬同步回饋，不能當遠端確認 | M0／S01 |
| F07 P1，UI＋原始碼 | 選人後無可見「確認登記／取消」按鈕與 Enter/Esc 說明；Enter 可提交。成功時背景又呈現扣款／入帳一次的預覽（訂後 −90 又預覽 −180；繳後 10 又預覽 110） | 可見主動作與焦點；成功狀態只呈現已完成結果。`CustomerCard.tsx`、`PosColumn.tsx`、MainLayout 的成功回饋 | M1／K04、K05 |
| F08 P1，UI＋靜態 | F1 001 訂 90 未付，F2 頁首「共 1 筆」，卡片「總交易 0」；補繳後仍「新增欠款 90」 | 明確區分交易筆數、當筆未收、目前欠款；不能拿當筆餐费缺口當個人欠款。`ledgerReport.ts/calculateLedgerTotals` 排除未付款 order 的 transactionCount，newDebt 為逐筆未付 | M2／L03 |
| F09 P1，UI 已重現 | 更正視窗顯示 `支出金額 (mealPrice)`、`實收金額 (paidAmount)`，只保留原備註也可存；F5 為 `__system__`、transaction ID、`paidAmount:100→120` | 人名／編號、中文欄名、前後值、理由與可開原單的連結；不要讓櫃台猜資料欄位。`EditTransactionModal.tsx`、`AuditTrailTable.tsx` | M2／L02 |
| F10 P1，UI 已重現 | 同一交易 F1 E 顯示 16:42:58，F2 08:42:58，F5 亦 UTC 時間字串 | 顯示統一 Asia/Taipei；營業日與建立時間分開。`AuditTrailTable.tsx` 直接切 ISO 字串；檢查 report rows | M2／L06 |
| F11 P1，UI＋靜態 | idle 焦點在頁面，數字自動進搜尋；姓名須點搜尋，搜尋中的 A 是文字，非新增收支 | 明示快捷鍵生效範圍；F1/完成後可直接輸入姓名與編號。`useFocusSync.ts` 主動 blur；`useAppNavigationShortcuts.ts` 只捕捉數字 | M1／K01 |
| F12 P1，UI＋靜態 | F5「歷史」只有結帳歷史／稽核軌跡；個人交易歷史在 F1，跨日交易查詢在 F2 | 共用既有查詢元件，讓 F5 可由帳戶／日期找到交易與其更正；暫不改 F1–F5 鍵 | M3／D05 |

## 需要定向測試的風險，不列為已重現

| ID | 依據與驗證要求 |
|---|---|
| R01 搜尋契約漂移 | PosColumn 自行 filter studentId/displayName，未用既有 active／alias 搜尋規則，也無 exact ID 優先。用停用帳戶、別名、同名與 `1`／`001` 衝突 fixture 測 K02/K03，不能把 existing domain tests 當 UI 通過 |
| R02 IME／modal／快捷鍵 | SearchBox Enter 未檢查 composition；兩個全域 keyboard hooks 的 dialog guard 未含所有局部 modal（如 editingTx）。測中文選字不選人／送單、開窗 F2 不切頁、Tab 不跑到背景 |
| R03 交易顯示截斷 | App 對 reverse 後 tx slice(0,200)，同一集合給 todayCount／E／RecentStrip。核對原 store 新到舊順序，加入 201 筆確認最新資料與全日總數不受顯示限制影響 |
| R04 期初重算 | recalculateStudentBalances 為所有帳戶從 0 起算，與 mocks 非零 currentBalance／手動期初不相容。取消或重新計算不能抹掉期初；M0/M2 必須共用獨立期初來源 |
| R05 今日菜單／歷史鎖 | AdminScreen save 沒有呼叫完整 validateTodayMenu，也未以選定日期完整鎖定菜單；todayMenu 目前單一物件。測跨日設定、空名稱、inactive vendor、已關帳、舊單快照 |
| R06 長按與焦點 | keyboard handlers 未統一 repeat/composition/修飾鍵規則；重複訂餐確認與一般送出需防同一次長按連過兩層。用實體鍵盤及 E2E 測，不憑一次 Enter 測試下結論 |

## 正常行為也要保留

實測編號→Enter 選人、金額欄自動焦點、Q/W 切換、E 查當日、Escape 取消、F1–F5 切頁可用；訂 90 收 0 後卡片 −90、補收 100 後卡片 10；已訂過者再次選入預設繳費。這些是局部通過，不代表所有焦點組合／帳務路徑通過。現有暖色、大字、左右主操作／最近帳戶佈局可繼續使用。
