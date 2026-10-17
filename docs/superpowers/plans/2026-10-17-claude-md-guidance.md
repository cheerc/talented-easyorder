# 分層 CLAUDE.md 建立計畫

日期：2026-10-17。狀態：第一版文件實作、獨立 review 與 CI 已完成；本次計畫增量待 Coordinator 核對，merge 狀態以 [PR #500](https://github.com/cheerc/talented-easyorder/pull/500) 為準。本計畫是文件工作安排，不授權開發下一個產品 phase。

## 目標與依據

為新 session 提供精簡且可信的 repo 入口，以及修改 frontend 時適用的局部指引。使用者已授權在既有 worktree 實作、commit、push 與開 PR（base `main`）；Coordinator 本人於獨立 review worktree 執行 review，不轉派 review subagent；實作與指定研究可依授權委派，implementer 不 merge。

已核對的基準：`95b76952a5d6a77d09781c5a142a5ffb424b539a`。根與子目錄沒有既有 tracked CLAUDE.md／AGENTS.md。`docs/DEVELOPMENT-HANDOFF.md`、`docs/PROJECT-STATUS.md` 與後端 phase plan 指向 P10b，並非使用者訊息中的 P0b；不在 CLAUDE.md 複製易過期的 phase 狀態，不因本計畫開始 P10b。

來源與權責：
- [正式後端交接](../../DEVELOPMENT-HANDOFF.md)：當前接手點、停止點、協作、production 限制。
- [正式後端 spec](../specs/2026-10-13-free-production-backend-spec.md)：安全與帳務契約。
- [後端 phase plan](2026-10-13-free-production-backend-plan.md)：phase 邊界、驗收及備份相容要求。
- `frontend/package.json`、`.github/workflows/ci.yml`：可執行命令與 CI；一般 Vitest skip 不能當 Emulator proof，docs-only CI 會跳過 app gates。
- 官方 [memory](https://code.claude.com/docs/en/memory)、[large codebases](https://code.claude.com/docs/en/large-codebases)、[worktrees](https://code.claude.com/docs/en/worktrees) 文件已由研究 agent 核對。從 root 啟動時載入 root，frontend 指引在讀取其區域檔案時按需載入；從 frontend 啟動時載入該目錄與 ancestors，不載入所有兄弟目錄。普通 Markdown links 為導讀，不用 `@import` 將整份 spec／plan 強制納入 context。預設位置的 subagent worktree 另有 root 指引載入例外，派工時應明確要求讀取適用的 CLAUDE.md，不假設繼承 context 等同完成載入。

## 範圍與設計

新增 `CLAUDE.md`、`frontend/CLAUDE.md`，不為每個子資料夾建檔；維持約 100 行內／檔為此次編輯目標，而非新增硬性 CI 契約。root 不當架構手冊或進度副本；frontend 不重寫帳務公式、schema、Rules 限制數字或各 command payload。

### Task 1：root CLAUDE.md

交付高頻且可執行的規則：
- repo 為 PC POS prototype 與逐 phase 雲端後端並存；技術交付、部署與本人營運驗收分開。
- 開工檢視 branch/status/log、保留未提交內容；讀 handoff 當前接手點及最新使用者授權，不把歷史收據的停止點當成最新決策，也不自動推進後續 phase。
- 實作與獨立 review 隔離；review 一律獨立 worktree、不碰主工作區；implementer 不自行 merge，由 Coordinator 按 handoff 與當次授權檢查 CI/review 後處理。不要在 CLAUDE.md 複製永久 admin bypass 授權或模型／effort 名稱。
- 安全：agent 測試限 `demo-easyorder` Emulator／合成資料；production credentials、資源、bootstrap、deploy、正式 smoke test 交由使用者本機；不碰 payroll、billing／Blaze、Android；舊 setup/deploy 指令不構成授權。
- 文件／規格／進度／evidence 單一來源導航；需改哪個 domain 才讀對應 spec／plan／ops，避免整包載入。root Rules／scripts 任務也要沿連結讀 frontend 的雲端注意事項，不依賴 nested 自動載入涵蓋 root 檔案。
- 驗證須對應 exact revision 與範圍，區分 skipped/pending/failed；docs-only 用 diff/link/path 檢查，不冒稱 app tests；文件變更做 docs-check。
- 最少必要的 frontend 與 CI pointers；中文溝通／commit／PR 依 handoff，不寫真實個資。

### Task 2：frontend CLAUDE.md

交付 frontend 區域的實作導航與注意事項：
- 所列 npm／npx 命令標清工作目錄為 `frontend/`；Node 版本指向 `.nvmrc`／package engines，不再建立版本副本。
- 命令採 repo 已存在的 dev:prototype、lint、build、Vitest、cloud backup、E2E scripts；Emulator proof 與 App TSC baseline 的詳細安排指向 CI／handoff，不宣稱 Vite build 或 bare tsc 能替代 app project 檢查。
- appMode／App／firebase／domain／store／tests 的少量可靠導航。
- prototype/cloud 隔離；cloud 缺設定 fail closed，不降級本機 POS；不得為方便接回裸寫入／legacy sync。
- cloud command/repository 與 Rules 為安全寫入邊界；同 ID recovery、server confirmation、lease 與 read freshness 的核心提醒，詳細契約留 spec。
- 帳務／Rules 變更需對應 unit、真 Emulator、UI/E2E 適用 gates；新 kind 要同步考慮備份 decoder/replay 相容測試。分清現行實作與後續 phase 目標，不把尚未改成 memory cache 等目標寫成完成。
- 不再建立 firebase、domain、store、components、docs 等空泛／重複 CLAUDE.md；日後出現局部且穩定的專屬規則才拆。

### Task 3：導航與直接矛盾修正

- `README.md`：Documentation 索引加入 root/frontend 指引及本計畫；開頭與正式後端段落的過期 P06 狀態改成 handoff/plan/status pointers，刪除重複 receipt，不重新抄一份 P10b 進度。不大規模清理其他歷史文件。
- `CONTRIBUTING.md`：Branch Flow 的 `dev` 指示與目前 main／handoff 不符，最小修正為 feature branch 與目前 default base、正式後端流程指向 handoff；CI commands 註明工作目錄與 docs-only 例外，不聲稱本次執行 app tests。其餘不重寫。
- 本計畫沿 repo 現有 `docs/superpowers/plans/` 版本化慣例保存，由 README 指向；完成後更新實際狀態與偏差，不做自引用 current HEAD。
- 不改產品 source、Rules、CI、dependencies、settings，不新增 hook、自動化機制或為自然語言句子上測試；不修改 phase receipt 將本次文件 PR 冒充產品進度。

## 實作與本機文件檢查

第一版五檔變更 `CLAUDE.md`、`frontend/CLAUDE.md`、`README.md`、`CONTRIBUTING.md` 與本計畫，head 為 `d93dc3da5554adebebbc18dc207ce3df2cf15e60`，見 [PR #500](https://github.com/cheerc/talented-easyorder/pull/500)。兩份指引均少於 100 行；本機 `git diff --check` 通過；逐項核對所列 frontend scripts、Node engine、workflow 的 cwd 與 docs-only 分類，並檢查 36 個本機 Markdown 檔案連結及引用的核心 source paths，均存在（CONTRIBUTING 的既有 GitHub issues route 不作本機檔案路徑解析）。Coordinator 本人對此 exact head 完成獨立 review，0 findings；CI run [38993180291](https://github.com/cheerc/talented-easyorder/actions/runs/38993180291)：`build-and-test` docs-only 成功、`e2e` skipped。該 CI 沒有執行 app lint/build/Vitest/Emulator/E2E，本地亦未跑這些 app suites。

Payroll 文件僅做唯讀 `CLAUDE.md` 寫法比較：root 以任務→延伸文件導航的模式已有相同目的，無需新增索引表或深層指引；更高密度的即時數字、CI 路由與測試細節不作為本 repo 的寫法範本。抽查沒有足夠證據宣稱任何特定規則已過時；未修改 payroll 檔案或執行業務操作。此比較未改動其餘四檔。本次計畫增量仍待 Coordinator 核對；新 head 的 CI 狀態獨立待確認，不沿用第一版 CI 結果。

## 驗收與驗證

1. 兩份 CLAUDE.md 不包含已完成 phase 清單、測試數字、完整 schema／公式或全量 @import；root/前端責任清楚，規則有現行依據。
2. 檢查新／修改 Markdown 的本機 links 與 code path 是否存在；命令對照 scripts／workflow；不為自然語言 exact wording 建 regression test。
3. `git diff --check` 通過；完整 base-to-head diff 僅包含上述文件；敏感資料與本機絕對路徑檢查。
4. docs-check 預期：`docs-check: arch=Y adr=N area=Y — update CLAUDE.md, frontend/CLAUDE.md, README.md, CONTRIBUTING.md, docs/superpowers/plans/2026-10-17-claude-md-guidance.md`。本次建立的是 agent 導讀與既有規則入口，無新產品架構選型，不另寫 ADR。
5. PR CI docs-only gate 成功只證明文件路徑分類與 required job 成功；app lint/build/Vitest/Emulator/E2E 本次不需執行並明確記未執行。
6. Coordinator 在另一個獨立 review worktree 檢視 exact PR head 的完整 diff 與 source-of-truth、載入語義、links、範圍；有 finding 交回 implementer 修正後複審。
7. PR body 依 template，包含 base/head SHA、實際驗證、docs-check、未部署、限制；無對應 issue 不新增或誤關 issue。作者開 PR 後停下，不 merge。
8. Coordinator 核對 PR head 未變、獨立 review／required CI／當前 merge 授權；merge 後讀回 MERGED 與 merge SHA，不改主工作區 checkout、不開始 P10b。

## 風險與回復

- README／CONTRIBUTING 的舊說法可能與新入口衝突，僅修正直接相關入口；不擴張成全面 docs sweep。
- CLAUDE.md 是模型 context，不是可保證強制執行的 security control 或 hook；不能保證每次模型完全遵守，也不聲稱能取代 Rules／CI／permissions。
- 文件變更可由後續文件 PR 修正或 revert；沒有資料 migration、production 操作或產品行為變更。
