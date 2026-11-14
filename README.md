# Talented EasyOrder

PC 晚餐櫃台雲端正式版：前端使用 React、Vite 與 Zustand，後端為 Firebase（Firestore、Auth、Hosting）；正式後端依獨立計畫逐步開發，尚未開放正式帳務操作。原 PC POS prototype 已移除（#709），僅以 git tag `pc-pos-prototype-final` 保存歷史。Android 整合另案。產品現況與接手 gate 以交接及狀態文件為準，本文不複製易過期的 phase 進度或驗證數字。

Project team 請先讀[開發交接入口](docs/DEVELOPMENT-HANDOFF.md)，再按其中連結閱讀 spec、phase plan 與 ops evidence；改前端另讀 [frontend/CLAUDE.md](frontend/CLAUDE.md) 與[前端 UI 規範](docs/FRONTEND-UI-STYLE.md)；不得以此 README 的歷史內容推定接手點或授權。

## 正式後端

正式後端的契約與當前接手方式分別以[spec](docs/superpowers/specs/2026-10-13-free-production-backend-spec.md)、[phase plan](docs/superpowers/plans/2026-10-13-free-production-backend-plan.md)及[handoff](docs/DEVELOPMENT-HANDOFF.md)為準。Production credentials、資源與部署由使用者本機處理；agent 僅用 demo Emulator 與合成資料。

## Getting Started

Requires Node.js 24 (see `.nvmrc`).

```bash
cd frontend
npm install
npm run dev
```

`npm run dev` 需要 `frontend/.env`（範本 `frontend/.env.example`）；缺 Firebase 設定時畫面只顯示標題與錯誤訊息（`main` 的 aria-label 為「Firebase 設定錯誤」），不會退回本機模式。自動化測試用 `demo-easyorder` Emulator，命令見 [frontend/CLAUDE.md](frontend/CLAUDE.md)。

## Firebase 與正式部署

環境只分 `firebase-test` 與 `firebase-production`（不同 Firebase 專案／資料庫）；本機開發與自動化測試只用 `demo-easyorder` Emulator。部署細節見 [P17 本機部署指南](docs/ops/DEPLOYMENT-GUIDE.md)。

依 [P17 本機部署指南](docs/ops/DEPLOYMENT-GUIDE.md) 建立獨立 Spark project，使用 Google provider、精確 UID/email 白名單及傳統 Firebase Hosting。deploy.sh 提供 release 準備、完整性檢查及明示 project 的部署入口；正式資源、設定與 smoke 由本人在本機操作。

[公開 Web config 範本](docs/ops/firebase-web-config.example.json)只在本機私有副本填實值；release build 不讀 .env。一般開發範本仍見 [frontend/.env.example](frontend/.env.example)。不以 email 網域取代白名單、不啟用 Email/Password provider，不沿用 Vercel／payroll 部署。

## Documentation
- Repository guidance: [Root instructions](CLAUDE.md), [Frontend instructions](frontend/CLAUDE.md), [PR review instructions](REVIEW.md), [contributor guide](CONTRIBUTING.md)
- Handoff: [Development handoff](docs/DEVELOPMENT-HANDOFF.md); frontend guidance: [frontend/CLAUDE.md](frontend/CLAUDE.md), [UI style](docs/FRONTEND-UI-STYLE.md)
- Specifications and plans: [backend spec](docs/superpowers/specs/2026-10-13-free-production-backend-spec.md), [backend plan](docs/superpowers/plans/2026-10-13-free-production-backend-plan.md), [this guidance plan](docs/superpowers/plans/2026-10-17-claude-md-guidance.md)
- Architecture, verification and operations: `docs/superpowers/`, `docs/ops/`
