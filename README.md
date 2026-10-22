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

## Fork & Setup

1. Fork this repo
2. `cd frontend && cp .env.example .env`
3. Edit `.env` with your Firebase project values
4. `npm install && npm run dev`

### Firebase Setup

- Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
- Enable Authentication (Email/Password or Google)
- Enable Cloud Firestore
- Copy your Web app config to `.env`
- Deploy Firestore rules: `firebase deploy --only firestore:rules`
- Update `firestore.rules` to allow your email domain (replace `talented.com.tw`)
- (Optional) Set up App Check for production

### Environment Variables

See [`frontend/.env.example`](frontend/.env.example) for all required variables. Key ones:

| Variable | Description |
|----------|-------------|
| `VITE_FIREBASE_API_KEY` | Firebase Web API key |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID |
| `VITE_FIRESTORE_ENDPOINT` | Required HTTPS Firestore endpoint outside Emulator mode |
| `VITE_ALLOWED_EMAIL_DOMAIN` | Email domain for operator access (e.g. `your-company.com`) |

## Documentation
- Repository guidance: [Root instructions](CLAUDE.md), [Frontend instructions](frontend/CLAUDE.md), [contributor guide](CONTRIBUTING.md)
- Handoffs: [Frontend](docs/FRONTEND-PROTOTYPE-HANDOFF.md), [Backend](docs/DEVELOPMENT-HANDOFF.md)
- Specifications and plans: [Frontend prototype spec](docs/superpowers/specs/frontend-prototype-workflow-spec.md), [backend spec](docs/superpowers/specs/2026-10-13-free-production-backend-spec.md), [backend plan](docs/superpowers/plans/2026-10-13-free-production-backend-plan.md), [this guidance plan](docs/superpowers/plans/2026-10-17-claude-md-guidance.md)
- Architecture, verification and operations: `docs/superpowers/`, `docs/ops/`
