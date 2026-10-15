# P06 獨立 source review 留存

此檔由 Coordinator 原文保存 reviewer 已產出的報告，方便其他 session／本機接續。不是 GitHub review 發佈或最後文件 checkpoint 的 review；兩位子代理於文件收尾時遇到用量限制，最後文件差異仍需獨立複審。P06 未 merge，required CI 未核實。

## 完整 source review

P06 獨立 source review：PASS

PR：https://github.com/cheerc/talented-easyorder/pull/478

審查固定 SHA：`ccd625db68f58e8acac8267c3fedb4af26839463`。已用 `git rev-parse ccd625d^{commit}` 獨立核對。PR base：`b53423aa71ed4cfac2428f290c648e5a999a0cae`。本次結論只適用上述 source；先前傳遞的 `ccd625d38b47e2ab660a1dd3ae6f5f608f5fb3b4` 並非存在的 commit。

未發現仍阻擋此 source 的 correctness 或安全問題。前次 `fc94b289a64c49df8a4fd55c205b5ee5ac23f4cc` 的三項 UI blockers，以及本輪發現的 status reason 契約不一致，均已關閉：

1. Typed `LEASE_LOST`／`UNAUTHORIZED`／`ACCESS_BUSY` 在 list、command、receipt read/replay 路徑統一呼叫 `revokeAuthorization`。此函式在排入 React updater 前同步撤銷該 identity、遞增 generation/list request 並清除 command flight。state 清空名單、草稿、PreparedCommand、receipt 與個資，只保留 commandId；同 identity 的新 async 入口亦被 latch 阻擋。兩個 deferred regressions 分別驗證 pending command 在 list denial 後不能回填，以及 receipt read denial 後 pending list 不能回填；另有 initial list denial 的同 identity retry 阻擋。恢復提示要求重新登入／取得使用權，或整頁重載經伺服器再次驗權。
2. 已確認 receipt 後若 list reload 失敗，保留 receipt phase；專用按鈕與 header retry 只重新讀取名單，不再讀 receipt 或把已知提交降為 unknown。對應 regression 明確 assert `readCommand` 未被呼叫。
3. Unknown recovery 查到同 ID receipt 後，使用原 frozen input 與同 commandId 呼叫原 repository；create/edit/status 均保留原 target、payload、expectedRevision、opening/reason。repository 以 `sameCommandSemantics` 與存量 fingerprint 比對，合法同 ID／不同內容不能被 UI 宣告成功。碰撞 regression 驗證不刷新名單、不顯示成功、不換新 commandId。
4. SetStudentStatus reason 已統一為必要 literal 1–500 字：domain types、adapter input、normalizer、receipt decoder、repo envelope 與 Rules shape 一致。缺漏／空字串在 repository 回 `INVALID_INPUT`；raw Rules 對缺漏／空字串拒絕且原子不變。UI 保持自行 trim；沒有新增跨語言 whitespace regex。

另重新核對：central Rules 必須連結實際 student/head 寫入與 revision advance；student get/list 授權只依 Google operator/current holder，完整資源 schema 由 server-only decoder 驗證；顯示名與 aliases 採一致 literal 字串契約。六種 command allowlist 與其餘十六種 deny 維持，學生建立只影響 head/receipt/student，沒有 transaction/day/payment effect；opening 日期限制與固定 string ID 保留。server-only list 的 500 人完整／第 501 人 fail-closed、seq/dataset/goLive 前後一致性、CloudApp 不掛舊 POS 與 prototype 隔離均維持。P06 no-cache 靜態 budget 仍為 11/20；negative expression-cap 的既有限制未被當成各 guard 的獨立證明。

已只讀核對作者產出的五份 Emulator JSON 與 session log：A01 10/10、P01 36/36、P04 19/19、command/failure 103/103、command/list 112/112，全部 failed=0、pending=0；後兩份重複 command suite，依 suite＋完整 case name 去重為 179 個通過案例。session log 記錄 exit 0。這是核對既有執行證據，reviewer 沒有自行跑測試或啟動 emulator。

本次 PASS 是 source gate，並非 P06 phase acceptance 或 merge 許可。最終全量 Vitest、lint/build、完整 TSC normalized baseline 比較、Cloud/prototype E2E 與官方 pinned-browser required CI，仍應由作者／Coordinator 依最終 SHA 確認；不可沿用舊 SHA 的 CI。未部署、未操作 production keys/resources/bootstrap，未 merge。

此報告目前僅存於 `/tmp/p06-review-ccd625d.md`，尚未發佈為 GitHub review/comment。GitHub API 的網路政策阻擋仍由 Coordinator 追蹤。

## 最後程式差異與執行證據複核

P06 delta source review：PASS（等待最後文件 checkpoint）

固定 SHA：`7494b521098080f719d7c59a09536667eb942591`；已獨立 `git rev-parse HEAD` 核對。

相對已審查的 `ccd625db68f58e8acac8267c3fedb4af26839463`，唯一變更為 CloudStudentsPage unit test 在新增表單內將姓名定位器 `{ name: '姓名', exact: true }` 改為 `{ name: /^姓名$/ }`。這仍精確匹配相同 accessible name，沒有削弱業務 assertions，沒有 production source 變更。前次 source PASS 維持。

只讀核對最新作者產物，沒有重跑測試：

- `/tmp/p06-resume-full-vitest-final-r2.json`：success=true，逐 assertions 為 1329 passed、179 skipped、0 failed。179 skips 恰為六套 Emulator-only suites，另由真 Emulator reports 覆蓋。
- 五份 `/tmp/p06-resume-{a01,p01,p04,p05-p06-commands,p06-students}.json`：各 10、36、19、103、112 passed，全部零 failed／pending；以 suite path＋完整 case name 去重為 179 個通過案例，不加總重複的 command suite。
- TSC base/current exit 檔皆為 2。raw 與 normalized 各 542 行、290 diagnostic headers。normalized 全部 bytes 相等，`/tmp/p06-resume-app-tsc.diff` 為 0 bytes。raw 並非全部 bytes 相等：差異只有 App.tsx 的行號 118→119、203→204；另獨立僅正規化 `(行,列)` 後完整內容相等。這是 inherited baseline 無新增診斷，不是 clean TSC pass。
- `/tmp/p06-resume-lint.log` 無 lint diagnostics；`/tmp/p06-resume-build.log` 記錄 build/PWA 產物成功生成。
- `/tmp/p06-resume-system-e2e.log`：Cloud 13/13（含 D01），prototype 7/7，合計 20/20，session exit 0。這是 system Chromium 診斷，不取代官方 pinned-browser required CI。

最後文件 SHA 尚未固定；本文件不宣稱 GitHub review 已發佈、required CI 通過、phase acceptance、merge 或部署。GitHub API 仍受網路政策阻擋。
