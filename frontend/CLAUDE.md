# Frontend guidance

本指引適用於 `frontend/`。Node 版本以 [`../.nvmrc`](../.nvmrc) 與 [`package.json`](package.json) 的 engines 為準；修改前端區域檔案時載入本檔。

## 開發與檢查命令

以下命令的工作目錄皆為 `frontend/`：

```bash
npm run dev                 # 一般模式
npm run dev:prototype       # 隔離的本機練習模式
npm run lint
npm run build
npx vitest run              # 一般單元測試；Emulator-only suites 未設定時可能 skip
npm run test:cloud-backup   # demo-easyorder Firestore Emulator 備份驗證
npm run test:e2e            # demo-easyorder Auth/Firestore Emulator + cloud、prototype E2E
```

Cloud Rules／command 證明需在 `demo-easyorder` Emulator 中實際執行；Vitest skip 不是 Emulator pass。App project TypeScript baseline、required gates 及 docs-only CI 分類以 [workflow](../.github/workflows/ci.yml) 和 [正式後端 handoff](../docs/DEVELOPMENT-HANDOFF.md) 為準；bare `tsc` 或 Vite build 不能取代 App project baseline。只改文件時做 diff、連結與路徑核對即可，不能宣稱跑過 app suites。

## Mode 與程式導航

- `src/appMode.ts` 判定 prototype／cloud 模式及設定；`src/App.tsx` 組裝應用；`src/providers/`、`src/auth/` 管理 Firebase 與登入；`src/domain/` 放領域契約，`src/firebase/` 放 cloud repository，`src/store/` 與 `src/components/` 放狀態及介面。沿用附近的測試與分層，不在 UI 繞過 repository。
- `npm run dev:prototype` 是明確的本機練習入口，使用隔離的 prototype 儲存名稱。Cloud 缺 Firebase 設定必須 fail closed，不得退回 prototype／local POS；cloud 與 prototype 不共用業務資料或寫入路徑。
- Cloud 業務寫入經 typed command／repository，Firestore Rules 是授權邊界；不得恢復裸寫、legacy sync、離線排隊或以登入 UI 代替 Rules。租約是否有效以伺服器確認及 Rules 為準，不用本機倒數授權。
- 未知提交結果時保留原 command ID，先確認 receipt／server state；不可當失敗換 ID 重送或重複收款。讀取須遵循 server confirmation、新鮮度及 fail-closed 契約。詳見 [正式後端 spec](../docs/superpowers/specs/2026-10-13-free-production-backend-spec.md)，不要在此複製完整 schema／流程。

## 驗收與相容

- 帳務、command 或 Rules 變更依適用 unit、真 Emulator 與 UI/E2E gates 驗證；照 handoff／CI 的實際適用範圍選命令並記錄結果，不以一般 Vitest 的 skip 代替安全證明。
- 新增或改變 command kind 時，同步檢查 `src/firebase/cloudBackup.ts` decoder/replay 與備份相容測試；不相容資料須 fail closed。細節以 [後端計畫](../docs/superpowers/plans/2026-10-13-free-production-backend-plan.md) 及備份 spec／測試為準。
- 不建立泛用或空白的 firebase、domain、store、components、docs 子目錄指引。只有穩定且區域專屬的規則才新增更深層文件。
