# Talented EasyOrder 前端 prototype Roadmap

更新：2026-09-29。當前工作是 PC 晚餐櫃台操作與帳務追溯的前端驗證，尚未完成本人驗收。

## 當前順序

| 批次 | 可驗證結果 | Gate |
|---|---|---|
| M0 | 隔離本機練習、空白建檔、期初、匯出還原 | S01–S06 |
| M1 | F1 鍵盤連續操作、正確選人／餐費、可見提交回饋 | K01–K09 |
| M2 | 更正後餘額一致、原單與理由可追、現金語義清楚 | L01–L06 |
| M3 | 晚餐設定、日末對帳、關帳重開、歷史回查 | D01–D06 |
| M4 | 本人自建資料連續三天模擬 | operator 簽收 |

細節見 [分批實作計畫](2026-09-29-frontend-prototype-refocus.md)、[新 spec](../specs/frontend-prototype-workflow-spec.md)、[交接入口](../../FRONTEND-PROTOTYPE-HANDOFF.md)。完成狀態看 [PROJECT-STATUS](../../PROJECT-STATUS.md)，不能由 plan checkbox／舊 DONE 檔名推定。

保留既有 React／Vite／Zustand 與本機持久化；Firebase 既有程式不屬本輪改造範圍。原 Google Sheets roadmap 已失效；人臉辨識、後端、完整 catalog 等暫緩，未排在 M4 後自動開工。

[舊 roadmap 原文](archive/2026-09-29-roadmap-before-prototype-refocus.md) 僅供歷史查閱，原 Phase DONE 代表過去交付，不等於目前 UI 已被本人接受。
