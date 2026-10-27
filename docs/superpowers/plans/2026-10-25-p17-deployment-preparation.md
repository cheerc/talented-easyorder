# P17 部署準備執行計畫

> 此為 2026-10-25 的歷史計畫與驗證記錄；後續授權、實際部署及未完成項以 [P17 live evidence](../../ops/free-production-evidence.md#p17-user-authorized-live-verification-2026-10-27) 為準。

日期：2026-10-25。依據：後端 phase plan P17、spec §11、使用者本次授權「能處理的都先處理完」。來源 main／#557：`5929f1b3835e498750f696139b6ae21f740095d8`。本工作不提交、不發布、不操作正式資源。

## 分工與順序

1. Agent：核對合併版本與 provider CI，重查官方 Spark、Hosting、Auth、region 文件；查明既有失敗，維持失敗與未執行項可見。
2. Agent：以測試先行替換舊部署入口，移除 payroll／Vercel 部署；提供固定 project 的 release、來源與檔案摘要、完整性檢查。build 僅用明示 Web config，不載入本機 `.env*`。
3. Agent：Firebase Hosting SPA、安全標頭、CSP、靜態資產與 service worker 快取設定；在 demo Hosting Emulator 實際檢查回應與頁面。
4. Agent：補足空白專案 `init` 後的安全啟用入口；拒絕已有帳務，預設試算，白名單與空租約建立後最後解除維護。正式目標需要本機終端確認。
5. Agent：準備部署、首登、index、匿名 smoke、DNS 切換、回退、quota 與 P18 交接 runbook，取代舊 ops 指令。核對 docs-check、build、lint、適用 unit／Emulator／E2E。
6. 使用者：在自己的 Firebase／Google／DNS 帳號建立獨立 Spark project、選 Firestore region、設定 Google provider 與 Web config；登入 CLI，執行正式部署及 bootstrap。先預設 HTTPS domain，再決定空閒自訂網域。只回報匿名結果。
7. 使用者：正式 smoke、獨立空 Spark 還原演練及 P18 真實資料／三日對帳、密碼與第二副本保管、本人簽收。

## 驗收

- 錯誤 project、設定缺漏、release 被改動、Emulator release 嘗試正式 deploy、非 TTY 正式執行均拒絕；每次部署明示並再次核對 project，index → rules → frontend。
- 空白啟用只能作用於 schema 1、維護中、seq 0／null ID、無業務文件的 dataset；不造財務初值；重試不覆蓋衝突白名單或租約。
- 真 Hosting Emulator 回應證明 SPA、安全標頭、CSP、cache，瀏覽器不 bypass CSP。Emulator 不證明雲端 index 可用、Google OAuth、計費狀態或正式延遲。
- 所有正式驗證標 UNVERIFIED，直到本人實際操作回報。P16 日常 100 筆容量裁定與儲存 WARN／FAIL 保留，不因 P17 抹除。

## 已知風險

- #557 merge 後 Frontend CI run `40129255597` 失敗於回填未知結果續作測試，E2E skipped；先調查，不冒稱 P16 合併等於 release green。
- 舊 `deploy.sh` 會合併 payroll Rules，不能再沿用。現有 root firebase config 未設定 Hosting。
- 現有維護 CLI 的 `finalize` 需要備份鏈，不能用來啟用全新空白專案；P17 補獨立入口，不偽造財務備份。
- 正式帳號／資源／DNS／真資料處置依本專案既有安全邊界由本人執行；不是額外的批准要求。

## 結果

本機工程準備完成，尚未 commit／PR／部署。release guards 7/7、完整 unit 2,360 passed（958 skipped）、P15／Rules matrix／P17 launcher 95/95、額外 stale-head 原子性 1/1、cloud E2E 26/26、enforce-CSP Hosting smoke、lint、文件連結／YAML／diff 檢查通過；TypeScript 既有 App 206 與 maintenance 3 項診斷未增加，不宣稱零錯誤。upstream main CI attempt 2 的 build-and-test／e2e 均 success（不代表未提交 P17 變更的 provider CI）；完整證據見 [P17 evidence](../../ops/free-production-evidence.md#p17-local-deployment-preparation-2026-10-25)。下一個本人 gate 是部署指南第 1 節的獨立 Spark 驗證 project／Google Auth；正式部署與營運簽收仍 UNVERIFIED。
