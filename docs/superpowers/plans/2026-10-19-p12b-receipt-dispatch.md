# P12b 收據 dispatch brief

Owner：coordinator。狀態：已派工，先準備；main CI pending 時不得發布。Impl 不寫設計、不改程式／Rules／測試。

Pinned base：`759a37cc9d2c503365b07c4f4662f328efd3aa75`（P12b squash merge）；收據 branch `codex/p12b-receipt`。功能 PR [#523](https://github.com/cheerc/talented-easyorder/pull/523) final source `f63cf1180394d1a4ffe3f0770efc4687a6d4752b`、runtime source `1d2e3f4da70ec744b4250cf281ab5fd53ee518de`。獨立 COMMENT [5566424126](https://github.com/cheerc/talented-easyorder/pull/523#pullrequestreview-5566424126) PASS，無必修。final-head CI [39191296570](https://github.com/cheerc/talented-easyorder/actions/runs/39191296570) build-and-test／e2e 均 SUCCESS。已合併；main CI [39194450495](https://github.com/cheerc/talented-easyorder/actions/runs/39194450495) 派工時 IN_PROGRESS，須由 coordinator 確認成功後才能發布，不先記綠燈。

## 範圍

僅 Markdown：handoff、PROJECT-STATUS、free-production-evidence、主 backend phase plan、coordinator 進度計畫及本 brief。記錄 P12b 已合併的 Export／Print 發起稽核與 typed adapter／Rules／備份契約；P12c 正式 UI、R01/L07 仍未完成。P12 整體不可先標完成，P13 不開始。

## 證據規則

- 所有 source/head/review/PR CI/squash merge/main CI 逐一對應；舊 head 的結果不得代替最終 head。main CI pending 可以先準備，綠燈才發布。
- cap 診斷以精確 Rules hash 與選定 fixture 為界：raw 正向、成本控制單 predicate 四格矩陣、三緊錨點與現行完整13對錨點各自歸屬，不能只看到 assertFails 就稱 guard cap-free。新 head 若改 Rules，前一 hash 數字不得直接沿用。
- 保留 runtime 1000-expression boundary 與 compile-time too-complex 的差別。沒有執行的 name-filtered／compile-failed cases 不算 passed；selected executed／skip 與全套數字分開。
- 因果控制的 mutant 接受偽造欄位、原版拒絕，證明該 predicate 的語意作用；原始負向仍有 cap diagnostics 就如實記，不稱全部負向 cap-free。actor padding 的來源與補測歸屬清楚。
- backup 正常 roundtrip 與 manifest/replay 分層拒絕、真 business projections 未改動、未知結果同 ID 回收，照最終實測記錄，不以單元型別通過代替 server 行為。
- impl、reviewer、CI 的命令／counts／revision 分開。app TSC 正規化零新增不寫成 clean pass；一般 Vitest Emulator-only skips 不算 Rules 證據。
- 只有發起稽核，不保證使用者已存檔或印表機完成；P12c 未掛 UI 前不可稱完整使用流程。未部署、正式 indexes／Spark 容量／正式資料／營運驗收未驗。

## 交付

同步目前摘要表與詳細 checkpoint，保留有日期的歷史結論。只驗 docs diff／links／anchors／內容，未跑 app tests 不勾；中文 commit/PR，含 docs-check 與來源 links，不含模型名／本機絕對路徑／個資秘密。發 PR 後 attach、讀回 provider head／CI，停寫交獨立 COMMENT review；coordinator 在 exact-head review＋required CI 綠後 merge。P12c 由 coordinator 補實際接口與 pinned base 再派工。
