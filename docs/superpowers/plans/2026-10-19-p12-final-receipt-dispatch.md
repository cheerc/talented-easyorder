# P12 最終收據 dispatch brief

Owner：coordinator。狀態：已派工，先準備，main CI 綠燈才發布。收據 branch `codex/p12-final-receipt`，pinned base `5742e66e218070167498e5daa7d9c8da7e1f91fc`（P12c #525 squash merge）。Source final `07750a9d45bfb3b4442054482fe9b289f6fb4f38`，runtime final `c6c9fe2ba4f44a08368793843d2d3da192b0e02c`。Runtime PASS [5569465904](https://github.com/cheerc/talented-easyorder/pull/525#pullrequestreview-5569465904)＋test/docs final delta PASS [5569731354](https://github.com/cheerc/talented-easyorder/pull/525#pullrequestreview-5569731354)，combined no remaining findings。Exact final source CI [39232200728](https://github.com/cheerc/talented-easyorder/actions/runs/39232200728) build-and-test/e2e SUCCESS。Merge main CI [39234769046](https://github.com/cheerc/talented-easyorder/actions/runs/39234769046) 派工時 IN_PROGRESS，不能先稱綠燈。

## 範圍與順序

只修改 Markdown：PROJECT-STATUS、DEVELOPMENT-HANDOFF、free-production-evidence、主 phase plan、coordinator progress plan、P12c dispatch 狀態與本 brief。Impl 不寫 plan，不改 runtime／Rules／index／workflow／tests。以 P12c 真正 merge SHA 開收據 branch；功能 main CI 成功才發布收據 PR。coordinator 再派獨立 docs review，exact-head CI／review 都通過才合併，最後核實收據 main CI。

## 證據與口徑

- P12a #521／收據 #522、P12b #523／收據 #524、P12c #525（含後續 rework），來源 head、review、source CI、merge、main CI 各自對應，不把先前 head 證據冒充最終 head。若 reviewer 有必修，保留舊 REWORK 與新 PASS 身分。
- 完成條件以 P12c brief R01／L07 真 UI／輸出／mutation 證據為準，分列 impl、reviewer、provider CI 各自實際 executed counts。一般 unit 的 Emulator skips 不算 Rules proof。只有本地 GREEN 或 PR 開啟不能稱 P12 完成。
- 描述 P12a 完整報表 reader／prefix／projection／CSV、P12b Export/Print 發起 command／Rules／recovery／backup、P12c F2/F5 與使用流程的最終交付；既有 source of truth 用 links，不另複製完整契約。
- 維持 bounded null-date query 與缺 committedAt 索引可見性限制；不宣稱全庫壞資料偵測。純只讀 nanoseconds fixture（Admin 合成時間）與合法 typed-command／真 UI 更正、後日 settlement 不變分列，不混稱寫入授權證據。
- legacy cloud／獨立 P12c／prototype 三段各有 globalSetup，required runners 都實際執行。保留曾見共用日期衝突與改為獨立 invocation 的理由；不把檔名排序當隔離。
- App TSC exact-base/candidate diagnostics 與完整 normalized diff 如實列出；exit2／208 inherited 零新增不是 clean pass。先前 CloudStudentsPage callback assertion fail、後續 targeted/full green、Firebase CLI telemetry timeout 與 temporary-config success 分開，不因共時觀察推定根因。
- 只保證瀏覽器 download/print 已發起；不保證檔案已保存或印表機完成。P12 closed/everclosed F5 唯讀是此 UI 政策，不冒稱 backend Rules 收緊。
- 未部署 production、未驗正式 indexes／quota／latency、真實營運與本人驗收；P13／P15–P18 等後續仍未開始。P12 工程驗收完成與正式營運接受分開，使用者未授權擴展後續 milestone。

## 交付

目前摘要／狀態表同步，dated historical checkpoints 保留原意。docs-check、links/anchors、diff/check、中文 commit/PR；不新增模型名、本機路徑、個資／秘密。發布後主動交 provider URL／full head／docs proof，停止寫入交獨立 reviewer。coordinator 最終需核實 source 及 receipt main CI 成功，完成所有已定案驗收才向使用者報 P12 完成。

## 本次釘選補充

- 舊 head2b89d1c review5568149846 R1/R2/R3；157c3db review5568788073 R1仍開、R4/R5；6307426 review5569277570唯一R6，後c6 review5569465904全部解除；077 review5569731354只test/docsdelta。保留精確head與狀態，避免只列最後PASS讓歷史失真，也不必複製完整finding文字。
- 舊6307426 CI39227562185 build成功、legacy24成功、P12c主L07 H刷新nestedpoll5sec失敗／另一case成功、prototype未執行；provider rawtrace顯示H232→233與正確balance在poll deadline後約350ms出現。新077 delta directwebfirst exactH=before+1採既有30sec readiness，不加retry，不改runtime；獨立review正控制hold5523.3ms→H233通過、未release負控制在30sec失敗。只記此一次trace支持的測試deadline競態，不推產品正式latency。
- Runtime impl驗證1949 passed／736 Emulator skips；reviewerR6 probes14/14、targeted73/73、freshP12c2/2與真portal四PDF。最終test-only delta reviewer freshP12c2/2、lint/rootTSC與負控制、174links。未變runtime的舊75Emulator與前輪PDF可沿revision適用性引用，不當新跑數字。
- 收據初稿先記main CI派工時pending；coordinator另傳成功身分才更新目前摘要為工程交付／驗收完成，最終收據PR尚待獨立審查/合併。不要發布後仍稱PR未建立。P12程式完成與最終收據流程完成分清，最終對使用者完成報告由coordinator在收據mainCI成功後給。
