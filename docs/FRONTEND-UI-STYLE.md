# 雲端前端 UI 規範（#648）

改 `frontend/` 雲端頁（F1–F5 與 `components/ui/`）的畫面前必讀。範圍只含雲端模式。這是簡單的午餐訂餐系統：規範以好維護、少例外為先，不新增與本文件衝突的字級、顏色或元件。

視覺參照（假資料，僅供方向；以本文件為準，用瀏覽器直接開檔，不載外部資源）：

- [`assets/ui-style/style-guide-mockup.html`](assets/ui-style/style-guide-mockup.html)：字級、顏色、元件、版面；F2 今日、F3 菜單與開帳、F4 供應商；淺色／暖色／深色。
- [`assets/ui-style/f1-counter-mockup.html`](assets/ui-style/f1-counter-mockup.html)：F1 櫃台三種狀態（未選學生、已選學生、尚未開帳）。

## 設計基準與等比放大

- 基準：MacBook Air 13 吋預設縮放，1440×900 CSS px。正式櫃台 24 吋 1920×1080 PC 等比放大。
- `frontend/src/styles/cloud-scale.css` 在 `html[data-app-mode="cloud"]` 設 `font-size: clamp(14px, calc(100vw / 90), 21.333px)`（1440→16px、1920→21.33px）。屬性由 `main.tsx` 呼叫 `applyAppModeAttribute`（`appMode.ts`）設定，一律設為 `cloud`。
- 新寫尺寸（字級、間距、寬高）一律用 rem 或下表 token；不新增 px 字級。雲端 `body` 為 `--t-md`（1440 寬＝17px、1920 寬＝22.67px），與改版前預設（`uiTweaksStore` 預設 `scale='large'` → `body[data-fs="lg"]` 的 `--fs: 17px`）在 1440 相同；`cloud-scale.css` 以 rem 覆蓋 `body` 字級，`body[data-fs]` 不再影響雲端 `body`（`--fs` 仍供 `Toast` 等少數元件使用）。
- `--r`、`--r-lg` 是 px（`tokens.css`）；雲端新元件直接引用即可。
- 字型：系統字型，不載網路字型、不加 `@font-face`、不改 CSP。`--font-sans`（PingFang TC、Microsoft JhengHei、Noto Sans TC、system-ui）；`--font-mono`（ui-monospace、SF Mono、Consolas）用於金額與編號。

## Token

字級與間距定義一次於 `tokens.css` 的 `:root`，與主題無關；顏色才分三主題（`:root` 淺色、`[data-theme="dark"]`、`[data-theme="warm"]`）。新增顏色 token 必須三主題都定義（`cloudPagesCss.test.ts` 檢查）。

| Token | rem | 1440 寬 | 用途 |
|---|---|---|---|
| `--t-xs` | .8125 | 13px | 按鍵、表格、說明氣泡 |
| `--t-sm` | .9375 | 15px | 標籤、提示 |
| `--t-md` | 1.0625 | 17px | 內文（雲端 body） |
| `--t-lg` | 1.25 | 20px | 區塊標題 |
| `--t-xl` | 1.625 | 26px | 重點 |
| `--t-2xl` | 2.25 | 36px | 頁面標題 |
| `--t-num` | 2.5 | 40px | 大數字（StatTile） |
| `--s1`…`--s7` | .25／.5／.75／1／1.5／2／3 | 4…48px | 間距 |

顏色角色：強調色（`--accent*`）只給「下一步」；警示色（`--warn*`）只給金額與不可逆；`--danger` 給錯誤說明；說明小字用 `--ink-hint`（`--ink-3` 對比不足）。對比度以 Chromium 實測為準（`ux-ui-audit` 的 `probe-core.js`），單元測試只檢查 token 三主題齊全。

## 共用元件（`frontend/src/components/ui/`）

既有：`Button`、`StatusBadge`、`EmptyState`、`Kbd`、`Card`、`Tabs`、`Modal` 等。新增：

- `HelpTip`：圓形「?」。滑鼠移上、Tab 聚焦、點擊（固定開啟）皆可開；Esc 或點外面關。Esc 只在說明開啟時攔截並保留焦點，說明沒開時照常傳給全域鍵盤處理（F 鍵、Alt+數字、Esc）。放在 `Modal` 內也一樣：說明開啟時第一次 Esc 只關說明，下一次 Esc 才照 Modal 原流程（關閉，或先跳出捨棄確認）。氣泡在按鈕下方，不遮住觸發點；靠近視窗左右邊緣時水平位移（`--help-tip-shift`，邊距 `.5rem`），留在視窗內；內容的 `\n` 會換行。
- `Callout`：`variant: 'warn' | 'ok' | 'info'`，圖示＋文字，可放子元素（例如日期 chip）。
- `ActionCard`：整張是一個 `<button>`，圖示、標題、說明、動作膠囊、`Kbd`；accessible name 是「標題，說明，動作」，不含 Kbd。唯一的 `layout` 屬性：`hero`（預設，依 F1 mockup 置中直排、虛線強調色外框，用在整頁被擋住時）、`inline`（橫排，膠囊緊接文字，用在資訊列內的小卡）。
- `StatTile`：標籤＋大數字（等寬）；`warn` 只給需要處理的數字。
- `DateField`：單日「營業日」控制項，F1／F2／F3 共用，標籤固定為「營業日」；外觀取 F2 日結日期列（等寬字、`--t-lg`、最小高度 3rem）。三種變體：`date`（原生日期，輸入中不載入、Enter 或離開欄位才確認，滑鼠選日期立刻確認）、`select`（選項由頁面提供，F1 用）、`static`（唯讀、同外觀）；右側 `status` slot 由頁面放狀態徽章與今天／過去日期／未來日期；`size="compact"` 給較小的標題列。新頁面要選單日營業日時用它，不要自己寫日期列。
- 營業日顯示：畫面上當標題、表格日期欄、日期 chip、選項或橫幅開頭的營業日，一律用 `formatBusinessDate`（`utils/businessDate.ts`）顯示成 `YYYY-MM-DD（五）`（全形括號）；CSV、檔名、`aria-label`、命令標籤、句中日期與原生日期欄維持純 `YYYY-MM-DD`。

## 原生 select 基線（#706）

雲端所有原生 `<select>` 共用 `frontend/src/styles/cloud-select.css`（限 `html[data-app-mode="cloud"]`）：`appearance: none`、用 CSS 自畫向下三角箭頭（顏色 `--ink-2`，停用 `--ink-3`，三主題通用，不硬寫色碼）、`padding-right` 預留箭頭空間、`font: inherit`（低 specificity，各頁字級優先）。頁面與 `DateField` 只管自己的高度、字級、左內距與外框；**不要**在頁面 CSS 再處理箭頭或 `padding-right`，背景請用 `background-color`，不要用 `background` 簡寫（會清掉箭頭）。守門：`cloudPagesCss.test.ts` 的「#706 雲端 select 共用基線」。

## HelpTip 與 Callout 的分類（依語意，不依現有 class）

- 涉及金額、不可逆、資料遺失、重複收款風險、阻擋操作的原因 → `Callout`，常駐可見。
- 功能用途與操作方式 → `HelpTip`。
- 一句同時包含兩者時拆開：警示留在 Callout，用途進 HelpTip。
- 每個改版 PR 在 PR body 列「收進 ? 的句子」與「保持可見的警示」兩張清單，供 reviewer 逐句核對。

## 版面原則

- 每頁同骨架：頁面標題＋右側摘要、子分頁底線、日期列在最上。
- 兩欄上緣對齊；面板內不再包框；只在有內容時才出現的區塊不常駐。
- 金額靠右、等寬（`.dt-num`、`--font-mono`）；表頭垂直置中（`data-table.css`）。
- 不出現工程用語：seq、H、epoch、tombstone、RecordBackup 等。
- 按鈕寫出按下去會發生的事（「前往菜單與開帳」，不是「確定」）。
- 鍵盤流程（F1–F5、Alt+1–5、Q/W/E/R/A、Esc）不得因 UI 改版改變。

## CSS 守門與逐頁收斂

`frontend/src/components/cloud/__tests__/cloudPagesCss.test.ts` 檢查：token 齊全且為 rem、三主題顏色 token 齊全、雲端等比放大只限 `data-app-mode="cloud"`、頁面 CSS 不對 `th` 宣告 `vertical-align: top`、無硬寫色碼，以及**硬寫 px 字級**。

px 字級檢查採明確清單：`FONT_SIZE_CHECKED_UI_CSS`（新 ui 元件）、`FONT_SIZE_CHECKED_STYLES_CSS`（`data-table.css`）、`FONT_SIZE_CHECKED_CLOUD_CSS`（雲端頁）。測試另掃 `components/cloud/` 目錄：新增的頁面 CSS 若不在清單內就會失敗，不能漏檢。**每個雲端頁在自己的改版 Phase 把該頁 CSS 加進 `FONT_SIZE_CHECKED_CLOUD_CSS`，且字級改用 token；P8 結束時，所有雲端頁 CSS 都必須在清單內。** 新增 `components/ui` 元件 CSS 也要加進 `FONT_SIZE_CHECKED_UI_CSS`。

**雲端外殼字級（#667）**：`topbar.css` 的 px 字級保留不改，雲端以 `cloud-scale.css` 覆寫。雲端外殼（品牌、主分頁、「異常 N」、次級導覽、操作員選單）的字級在 `cloud-scale.css` 以 `html[data-app-mode="cloud"] …` 覆寫成 token 或 `em`（附屬小字如 `.tab-key` 用相對父元素的 `em`），1920 才會依 1440 等比放大約 4/3。原生 `button`、`select`、`input` 不繼承字級：新增雲端頁時要設 token 或 `font: inherit`。守門：`cloudPagesCss.test.ts` 的 `CLOUD_SHELL_SELECTORS`（每個選擇器都要有雲端覆寫，且不是 px）；`ui-closeout.spec.ts` 的「外殼與原生控制項等比放大」在櫃台、今日帳、菜單與開帳量同一頁 1440／1920 的 computed font-size，比值須在 4/3 ± 0.02，並確認五個主分頁仍在同一列。

## 驗證入口

[#648／#650／#652 Chrome 操作清單與工程真頁面證據](ops/2026-11-05-ui-chrome-verification.md)：三主題、兩尺寸、真 App fixture 重跑方式，以及待使用者填寫的驗收表；不是使用者已驗收的紀錄。

## 未來展望

資料備份頻率與備份功能的後續調整（#649）不在本規範範圍，見該 issue 與後端 spec。
