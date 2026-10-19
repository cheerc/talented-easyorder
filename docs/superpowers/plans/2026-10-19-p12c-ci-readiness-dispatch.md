# P12c L07 CI readiness 同步修正

Owner：coordinator。已派工；base `3d49c8f267d1a15b5b036d899d38fa7bdcd5ab93`、目前 source `c6c9fe2ba4f44a08368793843d2d3da192b0e02c`、PR #525。獨立 review5569465904 PASS、R6解除，其餘必修已解除。本批只修 E2E 等待條件與文件，不改 runtime/Rules/reader/command/registry/print CSS。Impl 不寫 plan。

## 已證實的診斷

舊 head6307426 CI39227562185：legacy24 pass，P12c主L07 case在等待更新後H時5000ms poll timeout；另一case pass，prototype因&&未執行。coordinator下載provider raw trace，確認 headBeforeCorrection=232，expect@340 start52130.227/deadline約57130ms；內層locator.innerText pw:api@341 start52131.142，產品 after snapshot57480.612已含H233與正確餘額$-2,965，但poll deadline已到。這直接支持『產品已完成刷新、測試巢狀poll與locator deadline競態』，不據此宣稱正式環境latency或所有舊failure根因。更正receipt成功提示只代表write完成，不能替代fresh read readiness。

## 最小修正

保留headBeforeCorrection與amount/settlement斷言，不降低成只看到提示即成功。該fixture此階段只有一次合法更正會新增命令，先驗headBeforeCorrection為有限安全整數，再以直接Playwright web-first locator assertion等待 `account-history-ready` 的H等於headBeforeCorrection+1（結尾數字精確匹配）。套用頁面既有完整查帳等待界線30,000ms（前面初次ready已使用），不用 `expect.poll(async locator.innerText)` 的外層5000ms搭內層無限locator timeout。這是等待同一必要UI狀態，不加retry/sleep，也不減少H/餘額/後日settlement逐欄不變斷言。H已ready後既有balance必須符合+25；若需調整其等待同樣用web-first精確內容斷言，不增無界等待或模糊數字比較。

以有界延遲的fresh-read實驗（測試專用route控制，可用browser page.clock或可控release；不改產品）守住：receipt先到、ready超過5秒但30秒內到的case必須能通過；查詢永遠無新H則仍fail，不能用oldready提示蒙混。若用受控hold，必須明確release且保留exactH斷言，不加任意sleep掩蓋。

## 驗證與交付

只改該E2E檔與必要 evidence／本brief／目前PR狀態。可用舊CI trace作RED已證實證據，保留來源head與trace時間；P12c browser2case重跑留JSON/trace/PDF，lint/rootTSC與diff/docs-check。未變runtime不重跑全unit/75emu/舊anchors，requiredCI照完整流程跑。新head只對此測試delta獨立審查，不冒稱前headPASS已覆蓋後續差異。中文commit/push同PR，主動交fullhead/URL/結果後停寫；CI與review全綠才merge，P12未完成。
