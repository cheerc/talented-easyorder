# 雲端前端 UI 規範（#648）

改 `frontend/` 雲端頁（F1–F5 與 `components/ui/`）的畫面前必讀。範圍只含雲端模式；prototype 頁面（`npm run dev:prototype`、`AdminScreen`、`ReportScreen`、`HistoryScreen`、`report/` 的 `.rpt-*`）不套用。這是簡單的午餐訂餐系統：規範以好維護、少例外為先，不新增與本文件衝突的字級、顏色或元件。

視覺參照（假資料，僅供方向；以本文件為準，用瀏覽器直接開檔，不載外部資源）：

- [`assets/ui-style/style-guide-mockup.html`](assets/ui-style/style-guide-mockup.html)：字級、顏色、元件、版面；F2 今日、F3 菜單與開帳、F4 供應商；淺色／暖色／深色。
- [`assets/ui-style/f1-counter-mockup.html`](assets/ui-style/f1-counter-mockup.html)：F1 櫃台三種狀態（未選學生、已選學生、尚未開帳）。

## 設計基準與等比放大

- 基準：MacBook Air 13 吋預設縮放，1440×900 CSS px。正式櫃台 24 吋 1920×1080 PC 等比放大。
- `frontend/src/styles/cloud-scale.css` 在 `html[data-app-mode="cloud"]` 設 `font-size: clamp(14px, calc(100vw / 90), 21.333px)`（1440→16px、1920→21.33px）。屬性由 `main.tsx` 呼叫 `applyAppModeAttribute`（`appMode.ts`）設定；prototype 不帶該屬性，`html` 維持原本的 15px。
- 新寫尺寸（字級、間距、寬高）一律用 rem 或下表 token；不新增 px 字級。雲端 `body` 為 `--t-md`（1440 寬＝17px、1920 寬＝22.67px），與改版前預設（`uiTweaksStore` 預設 `scale='large'` → `body[data-fs="lg"]` 的 `--fs: 17px`）在 1440 相同；`cloud-scale.css` 以 rem 覆蓋 `body[data-fs]` 這個 prototype tweak，雲端不再受它影響（`--fs` 仍給 prototype）。
- `--r`、`--r-lg` 仍是 px（prototype 共用 `tokens.css`，改 rem 會讓 prototype 縮小）；雲端新元件直接引用即可。
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

- `HelpTip`：圓形「?」。滑鼠移上、Tab 聚焦、點擊（固定開啟）皆可開；Esc 或點外面關。Esc 只在說明開啟時攔截並保留焦點，說明沒開時照常傳給全域鍵盤處理（F 鍵、Alt+數字、Esc）。氣泡在按鈕下方，不遮住觸發點；內容的 `\n` 會換行。
- `Callout`：`variant: 'warn' | 'ok' | 'info'`，圖示＋文字，可放子元素（例如日期 chip）。
- `ActionCard`：整張是一個 `<button>`，圖示、標題、說明、動作膠囊、`Kbd`；accessible name 是「標題，說明，動作」，不含 Kbd。
- `StatTile`：標籤＋大數字（等寬）；`warn` 只給需要處理的數字。

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

## 未來展望

資料備份頻率與備份功能的後續調整（#649）不在本規範範圍，見該 issue 與後端 spec。
