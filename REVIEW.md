# Review instructions

本檔只規範 GitHub PR 自動 review 要回報什麼、用什麼嚴重度、略過什麼。專案規範與安全邊界以 `CLAUDE.md`（root 與變更檔案所在目錄）為準；後端契約來源是 `docs/superpowers/specs/2026-10-13-free-production-backend-spec.md`，phase／驗收來源是 `docs/superpowers/plans/2026-10-13-free-production-backend-plan.md`，當前接手與授權看 `docs/DEVELOPMENT-HANDOFF.md`。本檔不複製那些文件的 schema、公式或進度數字。

所有 finding 與 summary 用繁體中文撰寫；程式碼、路徑、命令保留原文。

## 範圍與證據

- 只審本 PR 的 merge-base diff（`base...head`）。base 上本來就有的問題不歸給本 PR。
- PR 描述、commit message、程式註解、handoff／evidence 文件裡的說法都是待驗證的宣稱，不是證據。證據只有 source 本身（`path:line` 引用）。不要從函式或變數命名推論行為；追到實際 caller → callee 與資料流，確認失敗情境可達、上游沒有防護，才回報。
- 每個 finding 都要寫出：位置（`path:line`）、失敗情境（什麼輸入／狀態／時序 → 什麼錯誤結果，以及預期結果）、引用證據。寫不出具體失敗情境的不回報。
- 發現一類缺陷時，掃完整個 diff，把同類的所有實例在同一次 review 一起回報，不要分次擠牙膏。
- 後續 push 觸發的 re-review：先確認先前 🔴 是否已修；只審新增的變更，不對未改動的程式碼追加新的 🟡。作者在 thread 回覆並引用 source 說明不需修改的，除非能指出該說明的具體錯誤，否則不重提。

## 🔴 Important 在本 repo 的定義

本 repo 管學生餘額與現金帳，以下任一項即為 Important：

1. **帳務口徑錯誤**：金額、delta、餘額、日結現金、退款、更正的計算偏離 spec §7（例如重複扣退款、餐費當現金支出、出現直接指定餘額的入口、voided 交易仍有貢獻）。
2. **Rules／授權邊界放寬**：`firestore.rules` 新增未明列的可寫路徑、允許一般 client 刪除財務／command／結帳文件（spec 明文例外除外）、略過 allowlist／lease／maintenance／schema／counterpart 檢查、`allow list` 未要求 `limit` 或上限超過 spec 規定，或以前端登入 UI 取代 Rules。
3. **Cloud 寫入繞過 typed command／repository**：UI 直接寫 Firestore、恢復裸寫入、legacy sync、離線排隊、persistent local cache，或把正式帳務／完整個資存進 localStorage／IndexedDB／service worker cache。
4. **命令冪等與復原錯誤**：結果未知時換新 commandId 重送、可能重複收款、不先查 receipt／server state 就當失敗、無上限自動重試、`runTransaction` 在完成全部讀取前就開始寫入。
5. **租約與模式隔離**：以本機倒數判定 lease 有效；cloud 缺 Firebase 設定時沒有 fail closed、退回 prototype／local POS；prototype 與 cloud 共用業務資料、storage namespace 或寫入路徑。
6. **備份相容**：新增或改變 command kind、command payload 或投影欄位，卻沒有同步 `frontend/src/firebase/cloudBackup.ts` 的 decoder／replay 與 `frontend/src/firebase/__tests__/cloudBackup.spec.ts` 等相容測試；不相容資料沒有 fail closed。
7. **讀取一致性**：多頁讀取未以資料序號前後一致驗證、報表／匯出只取第一頁卻當完整資料、查詢未帶 `limit`。
8. **Secrets、個資與正式環境**：提交 credentials、service account、正式 Firebase config／project id、真實姓名、餘額、紙本或截圖資料；測試、script 或 CI 預設連到 `demo-easyorder` 以外的 project；新增會在 agent／CI 端執行正式 deploy、bootstrap 或 production smoke 的路徑。
9. **CI gate 被削弱**：`.github/workflows/**` 或 `scripts/**` 中跳過、刪除、`continue-on-error`、放寬 docs-only 分類、讓 e2e 彙總在分組缺少／取消／失敗時仍通過，或讓 Emulator-required suite 在未設定時以 skip 代替失敗。不得以 skip／disable／quarantine 測試換取綠燈。
10. **測試沒有驗到真正入口**：帳務、command、Rules、lease、備份／復原的行為變更，沒有驅動實際 production 入口（repository／command 或 UI flow）的測試，只對內部 helper 餵合成資料；或 Rules／command 證明只在一般 Vitest 下會 skip、沒有加進 CI 的 Emulator 步驟。
11. **虛假驗證宣稱**：diff 內的文件（handoff、plan receipt、ops evidence、CHANGELOG）或 PR 描述把 pending／skipped／未執行寫成通過、宣稱已部署或已經使用者實機驗收、docs-only PR 宣稱跑過 app tests，或宣稱的 commit SHA／測試檔與 diff 不符。PR 描述的問題寫在 summary。
12. **違反 `CLAUDE.md` 的安全與操作邊界**：碰 payroll、billing／Blaze、Android，或自行推進 handoff 未授權的下一 phase（diff 實作了 plan 中後續 phase 的範圍且 PR 未說明授權來源）。

## 🟡 Nit

- 每次 review 最多 3 個 Nit。
- 只回報有具體好處的簡化、可讀性問題，或有 `CLAUDE.md`／spec 文字依據的寫法問題。
- 文件、commit、PR 中出現 AI 模型名稱：Nit（handoff 規定不寫）。

## 🟣 Pre-existing

- 只回報已用 source 證實、且與本 PR 觸及的檔案或流程直接相關的既有缺陷；它不阻擋本 PR。
- 不回報 `docs/ops/baselines/75e7a96-tsc-app.txt` 已記錄的 TypeScript baseline 錯誤，也不回報 handoff 已列為已知、未處理的項目。

## 不要回報

- CI 已檢查的項目：ESLint、格式、`tsc` 型別錯誤、build 失敗。
- 沒有具體失敗情境的主觀風格、命名、檔案拆分或重構建議。
- 純 UI 文案、樣式或版面調整缺少單元測試。
- Commit message 格式（`CONTRIBUTING.md` 的 Conventional Commits 與 `CLAUDE.md` 的中文要求並存，不以此開 finding）。
- `frontend/package-lock.json` 的內容細節、`docs/ui_sample/**`、PDF 等二進位或範例素材。
- 歷史紀錄文件中已過時的內容：`docs/retro/**`、`docs/superpowers/**/archive/**`、舊的 dispatch／receipt／review 紀錄、handoff 中較早日期的接手段落。只有本 PR 新寫入的錯誤宣稱才回報。

## 依變更區域必查

- **`firestore.rules`、`firestore.indexes.json`**：每份文件寫入與整筆 transaction 的 Rules 存取次數仍符合 spec §6.3 的預算，helper 沒有重複 `get`；預設 deny；每個 command kind 在 `frontend/src/firebase/__tests__/cloudRulesMatrix.spec.ts` 有對應 allow／deny case；新增 index 與 spec §8 的查詢策略一致。
- **`frontend/src/firebase/**`、`frontend/src/domain/**`**：同 commandId 復原、server confirmation、有限重試、讀取新鮮度與 fail closed；新增 command kind 同步 Rules、備份 decoder／replay 及對應 `*.spec.ts`。
- **`frontend/src/appMode.ts`、`frontend/src/providers/**`、`frontend/src/auth/**`**：cloud／prototype 判定與隔離、缺設定 fail closed、登出清除訂閱與 store。
- **`frontend/src/components/**`、`frontend/src/store/**`**：UI 不繞過 repository 寫資料；送出中防連按；結果未知時顯示確認中而非允許重新收款。
- **`.github/workflows/**`、`scripts/**`**：Emulator 一律 `--project demo-easyorder`；改 release 或 e2e gate 時同步更新 `scripts/__tests__/release.test.mjs`、`scripts/__tests__/e2e-ci.test.mjs`；新增 Emulator-required suite 時 CI 有對應步驟並設定 `EASYORDER_REQUIRE_*`。
- **`deploy.sh`、`firebase.json`、`vercel.json`、Hosting／CSP 設定**：不放寬 CSP；不加入 agent 或 CI 可直接執行的正式部署路徑。
- **`docs/**` 與 `*.md`（docs-only PR）**：新增或修改的相對連結與 code path 確實存在；文件中的命令與 `frontend/package.json`、CI workflow 一致；handoff／evidence 如實區分 passed、skipped、pending、未執行；`CLAUDE.md` 不放易過期的 phase 進度、測試數字、schema 或公式；不含真實個資。

## TDD 證據

handoff 要求帳務、command、Rules 行為變更的 PR 記錄 RED（先失敗的測試）與 GREEN（實作）commit。若這類 PR 的 commit 與描述都看不出 RED／GREEN 證據，在 summary 以 🔴 指出。純文件、spec、行為不變的重構不適用。
