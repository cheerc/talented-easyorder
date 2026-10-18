# P12a 收據 dispatch brief

Owner：coordinator。狀態：已獲 release，docs-only receipt PR 已發布，等待獨立 COMMENT review。Pinned base／#521 merge：`c9988b35912f761bb79c08476ac9636c0fcc49aa`；source head：`c161f9196d7836e310c45cdfe3312cefed611842`。獨立複審 [5564603618](https://github.com/cheerc/talented-easyorder/pull/521#pullrequestreview-5564603618) PASS；source CI [39158763724](https://github.com/cheerc/talented-easyorder/actions/runs/39158763724) build-and-test/e2e 均 SUCCESS。Main CI [39159574321](https://github.com/cheerc/talented-easyorder/actions/runs/39159574321) 派工時 pending，Coordinator 後續從 provider 核對為 COMPLETED／SUCCESS，main 仍是同一 merge SHA；本輪依 release 回報，不自行輪詢。Impl 不撰寫設計計畫，不在本批改程式或測試。

## 範圍

僅更新 Markdown：`docs/DEVELOPMENT-HANDOFF.md`、`docs/PROJECT-STATUS.md`、`docs/ops/free-production-evidence.md`、`docs/superpowers/plans/2026-10-13-free-production-backend-plan.md`、coordinator 計畫及本 brief。P12a 的 source head、review 無必修、PR CI、squash merge 與 main CI 必須能逐一對應；main CI 未綠只可準備，不發布收據 PR。

P12a 只完成資料層：完整 server cursor 讀取、帳戶前綴餘額、日 heads／日結／補記／稽核、原始與合併 projection、typed CSV、索引定義與 CI proof。不得稱 F2/F5、匯出列印使用流程、R01/L07 UI E2E 或整個 P12 完成。P12b／P12c 仍由 coordinator 根據合併介面補 pinned base 後派工。

## 證據界線

- source impl、本機回歸、獨立 reviewer 與 CI 的命令／revision／counts 各自歸屬，不拼成一套未實際執行的測試。
- 一般 Vitest 的 Emulator-only skips 不算 Rules pass；新報表 suite 的 JSON gate 要確認 required filename、非零 passed、零 failed／skipped。
- app TSC 以 pinned base 完整正規化診斷比較零新增描述，不稱整個 app TSC 通過；根級 TSC 結果另記。
- 原始 countedCash、目前 effectiveCash、舊補記不計入的語意須保留；stored Unicode 空白 reason 的相容性不得被文件改成拒絕。
- 同日／帳戶超過一頁與 nanos 排序是功能證據，不能推論 Spark 正式讀取容量、正式索引已可用或已部署。P16 容量與使用者正式部署仍未驗。
- 正式 spec 的 L07／§7.3 依較新 R6/R7 UI 政策：僅未曾關帳歷史可在 P12c 學生歷史 UI 更正，不能把此 UI 限制寫成既有 Rules 已收緊。

## 發布與停止

依 repo template 寫中文 docs-only PR，列 `docs-check:` 與精確來源 links；不含模型名、本機絕對路徑、個資或 secrets。收據只跑 diff／內容／links／anchors 核對，未跑 app tests 不勾選。發布後 attach、讀回 provider head／CI，停寫等獨立 reviewer COMMENT review。只有 coordinator 在 exact-head review 與 required CI 綠後合併。收據合併前不開始 P12b code；不用另向使用者要求逐批授權。
