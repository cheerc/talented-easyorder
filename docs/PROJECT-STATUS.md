# Project Status — Talented EasyOrder

> **Last inspected:** 2026-09-29，程式基準 `884a996`。
> 本輪只更新 spec／計畫／驗收文件；沒有改應用程式、沒有完成本人驗收。

## 1. 當前方向

PC 晚餐櫃台前端 prototype：鍵盤為主、滑鼠為輔，保留 operator 約七成滿意的 F1。每天一餐（晚餐）；餐費90找零後記90，多留10元則記100。支援1920×1080 PC及MacBook Pro 13吋，按可用視窗重排，不整頁縮小。

先完成本機模擬、F1操作、更正追溯、日末核帳。後端、iPad、人臉辨識、同步架構擴充均暫緩。

交接入口：[FRONTEND-PROTOTYPE-HANDOFF](FRONTEND-PROTOTYPE-HANDOFF.md)。現行排程：[ROADMAP](superpowers/plans/ROADMAP.md)／[詳細計畫](superpowers/plans/2026-09-29-frontend-prototype-refocus.md)。原 Google Sheets roadmap 已封存，不再作排程來源。

## 2. 現況與驗收 gate

operator 已表示 F2–F5 尚未充分操作驗證。已 merge、open issue=0、測試通過都不等於 UI 被接受。2026-09-29 建立本文件PR之前，GitHub open PR／issue 查詢為空；新發現記於下列 audit，尚未自動開 issues。

[操作 audit](superpowers/reviews/2026-09-29-frontend-workflow-audit.md) 記錄已重現與靜態風險；[本人驗收清單](superpowers/verification/2026-09-29-operator-prototype-checklist.md) 是唯一詳細操作清單，不在此重複維護。

| 優先項目 | 證據／狀態 | 下一步 |
|---|---|---|
| F01 不可見搜尋候選可被Enter選取 | UI重現；未修 | M1 |
| F02 取消特殊餐後價格帶到下一人 | UI重現；未修 | M1 |
| F03 更正收款後F1／最近帳戶／F2餘額不同 | UI重現；未修 | M2，帳務 gate |
| F04 部分刪除／undo無稽核與鎖帳檢查 | 靜態確認；未修 | M2 |
| F05/F06 空白建檔缺口／本機假同步回饋 | 畫面＋程式確認；F06 已修待驗（M0 第一批）；F05 空白起點與手動建帳戶／期初已修待驗（M0 第二批），匯出還原與只清交易已修待驗（M0 第三批），練習營業日與別名／停用已修待驗（M0 第四批），日期 key 菜單已修待驗（M0 第五批） | M0 |
| F07–F12 提示、筆數、追溯文案、時間、焦點、歷史入口 | audit列明；未修 | M1–M3 |
| R01–R06 邊界風險 | 定向測試待做，不能稱已重現 | 按plan分批驗 |

本人回饋可直接用清單 ID，team 再整理 issue／修復PR並回填。狀態採「發現／待重現／已修待驗／本人通過」，不得因 issue 關閉直接填通過。

## 3. 分批進度

| 批次 | Code／team驗證 | 本人驗收 |
|---|---|---|
| M0 隔離本機、空白建檔、期初、快照 | 第一批（`dev:prototype` 入口、Firebase 隔離、移除本機假同步）、第二批（空白／範例起點、手動建帳戶與期初）、第三批（匯出還原快照、只清交易）、第四批（練習營業日、別名編輯、停用／恢復帳戶、快照還原補強）、第五批（日期 key 菜單 `menusByDate`，未設定的日子沿用較早日期）已實作；M0 計畫項目程式面皆已實作，待操作者依 S01–S06 驗收 | 未驗 |
| M1 F1鍵盤／草稿／回饋／尺寸 | 待實作 | 未驗 |
| M2 餘額一致／更正作廢／稽核 | 待實作 | 未驗 |
| M3 F2–F5每日閉環 | 待實作 | 未驗 |
| M4 自建資料多日模擬 | 待前述交付 | 未驗 |

歷史 Phase1.0／1.1／1.2 已交付、Sheets phase obsolete、Phase2未啟動的背景保留於[原status快照](superpowers/reviews/2026-09-14-project-status-baseline.md)，不以歷史DONE代替上述新一輪驗收。

## 4. 程式架構與本輪驗證限制

現有 frontend 為 Vite／React／TypeScript／Zustand，IndexedDB（含localStorage fallback）與Firebase程式並存。未設定完整Firebase配置時App已有local-only分支，但尚不具備這輪要求的明確環境隔離、空白建檔、完整快照工具。

本輪實際操作：使用者5173唯讀流程，另origin的5174副本（禁用Firebase）做範例訂餐／繳費／更正／草稿取消。已目視1920×1080 content viewport；Mac實際視窗、125%、Windows IME、全面關帳／退款／故障等仍待按清單驗證。

本PR只改Markdown，做文件連結、數字案例、diff格式檢查。**沒有重跑code test suite**。2026-09-14的991 passed／8 skipped等健康度數字仍在原快照，僅為歷史基線，不冒充本輪測試結果。

既有BackupScreen未掛路由且為placeholder、版本號不一致、舊TODO等技術背景見原快照。本輪只處理會阻礙prototype驗證的部分，不開全面技術債清理。

## 5. 維護方式

每批team交付或本人回饋時，更新檢視日期、實際commit、修復PR、清單ID及驗收結果；保持「code已寫／team已驗／本人通過」分離。新的產品決策先更新workflow spec，再改對應plan與清單。此輪文件PR由project team review、rework、merge，作者不代為merge。
