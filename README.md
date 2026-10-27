# Talented EasyOrder (PC Counter Prototype)

PC 晚餐櫃台 prototype 使用 React、Vite 與 Zustand；正式後端依獨立計畫逐步開發，尚未部署或開放正式帳務操作。Android 整合另案。產品現況與接手 gate 以交接及狀態文件為準，本文不複製易過期的 phase 進度或驗證數字。

Project team 請先讀[前端交接入口](docs/FRONTEND-PROTOTYPE-HANDOFF.md)與[本人操作驗證清單](docs/superpowers/verification/2026-09-29-operator-prototype-checklist.md)。正式後端請先讀[開發交接入口](docs/DEVELOPMENT-HANDOFF.md)，再按其中連結閱讀 spec、phase plan 與 ops evidence；不得以此 README 的歷史內容推定接手點或授權。

## 正式後端

正式後端的契約與當前接手方式分別以[spec](docs/superpowers/specs/2026-10-13-free-production-backend-spec.md)、[phase plan](docs/superpowers/plans/2026-10-13-free-production-backend-plan.md)及[handoff](docs/DEVELOPMENT-HANDOFF.md)為準。Production credentials、資源與部署由使用者本機處理；agent 僅用 demo Emulator 與合成資料。

## Getting Started

Requires Node.js 24 (see `.nvmrc`).

```bash
cd frontend
npm install
npm run dev
```

### 本機練習模式

```bash
cd frontend
npm run dev:prototype   # http://localhost:5174
```

練習模式不初始化 Firebase（即使有 `.env` 也一樣），不需登入，資料存在獨立的瀏覽器儲存區（`*-prototype`），不影響一般模式。畫面右上與分頁標題標示「本機練習」。

## Firebase 與正式部署

依 [P17 本機部署指南](docs/ops/DEPLOYMENT-GUIDE.md) 建立獨立 Spark project，使用 Google provider、精確 UID/email 白名單及傳統 Firebase Hosting。deploy.sh 提供 release 準備、完整性檢查及明示 project 的部署入口；正式資源、設定與 smoke 由本人在本機操作。

[公開 Web config 範本](docs/ops/firebase-web-config.example.json)只在本機私有副本填實值；release build 不讀 .env。一般開發範本仍見 [frontend/.env.example](frontend/.env.example)。不以 email 網域取代白名單、不啟用 Email/Password provider，不沿用 Vercel／payroll 部署。

## Documentation
- Repository guidance: [Root instructions](CLAUDE.md), [Frontend instructions](frontend/CLAUDE.md), [contributor guide](CONTRIBUTING.md)
- Handoffs: [Frontend](docs/FRONTEND-PROTOTYPE-HANDOFF.md), [Backend](docs/DEVELOPMENT-HANDOFF.md)
- Specifications and plans: [Frontend prototype spec](docs/superpowers/specs/frontend-prototype-workflow-spec.md), [backend spec](docs/superpowers/specs/2026-10-13-free-production-backend-spec.md), [backend plan](docs/superpowers/plans/2026-10-13-free-production-backend-plan.md), [this guidance plan](docs/superpowers/plans/2026-10-17-claude-md-guidance.md)
- Architecture, verification and operations: `docs/superpowers/`, `docs/ops/`
