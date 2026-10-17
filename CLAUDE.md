# Repository guidance

## 開始與交接

- 先看 `git status --short --branch`、branch 與近期 log；保留所有既有未提交變更，不用 reset／checkout 覆寫。再讀 [正式後端交接](docs/DEVELOPMENT-HANDOFF.md) 的目前接手點，以及本次最新使用者授權。handoff 是後端續作權威；歷史 receipt、舊 setup/deploy 指令都不是新授權。不可自行推進下一 phase。
- 本 repo 同時有 PC POS prototype 與逐步開發中的正式後端；功能完成、部署、使用者營運驗收是不同 gate。PR 必須如實記錄 revision、驗證範圍與未執行項目。
- 實作與獨立 review 隔離。review 一律使用獨立 worktree，不碰主工作區；在新的 subagent worktree 派工時明確要求閱讀適用的 `CLAUDE.md`，不假設自動繼承載入。implementer 不自行 merge；Coordinator 依當次授權、review 與 CI 處理。

## 安全與操作邊界

- agent 測試只用 `demo-easyorder` Emulator 與合成資料。Production credentials、資源、bootstrap、deploy 及正式 smoke test 由使用者在自己的電腦操作；不得接收或寫入正式 secret。
- 不碰 payroll、billing／Blaze、Android。文件中舊的 Firebase setup／deploy 命令不代表可用於正式環境或已獲授權。
- 不提交真實姓名、餘額、紙本／Excel、瀏覽器截圖或其他個資。`CLAUDE.md` 是工作指引，不是 Rules、CI、permission 或 security control 的替代品。

## 文件與 context

- [後端 spec](docs/superpowers/specs/2026-10-13-free-production-backend-spec.md) 是後端契約來源；[後端計畫](docs/superpowers/plans/2026-10-13-free-production-backend-plan.md) 是 phase／驗收來源；[ops evidence](docs/ops/free-production-evidence.md) 記錄驗證證據。當前接手與授權看 handoff，不在本檔複製進度、數字、schema 或公式。
- 前端接手入口為 [frontend handoff](docs/FRONTEND-PROTOTYPE-HANDOFF.md)；改 `frontend/` 時再讀 [frontend 局部指引](frontend/CLAUDE.md)。修改 root Rules、scripts 或 CI 時，也要依變更範圍閱讀前端雲端指引及對應 spec，nested 指引不會自動涵蓋 root 檔案。
- 各層 `CLAUDE.md` 指引會串接補充，不是子檔覆蓋父檔；讀／改某區域檔案時載入該區域指引。用 `/context` 的 Memory files 檢查啟動時載入項；nested 指引可按需載入，未必會列在啟動清單。派 subagent worktree 時仍明確指定閱讀適用指引。
- 先由變更區域選讀對應 spec、plan、ops 或驗收文件，不整包載入。Markdown 普通連結是導讀，不會自動 import 目標內容；避免複製同一規則到多份文件。
- 文件變更依 repo docs-check 做 arch／adr／area 判斷。文件命令與路徑須核對現況；docs-only 的 diff/link/path 檢查不等同 app 測試。標明 skipped、pending、failed 與未執行，不把 skipped 當通過。

## 常用入口

- Frontend 開發命令、mode 隔離與驗證範圍見 [`frontend/CLAUDE.md`](frontend/CLAUDE.md)；CI gate 見 [CI workflow](.github/workflows/ci.yml)。
- 溝通、commit 與 PR 使用中文，依 handoff 與 repo PR template；不在文件複製模型／effort 名稱或臨時授權。
