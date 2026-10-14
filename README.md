# Talented EasyOrder (PC Counter Prototype)

PC 晚餐櫃台前端 prototype，使用 React、Vite 與 Zustand。目前實作以鍵盤登記、收款、餘額與可追溯查帳為主。正式後端依獨立分階段計畫開發；P00–P04 已合併，P05 command-core 正在實作，尚未完成驗收或部署。Android 整合另案。

Project team 請先讀 [前端交接入口](docs/FRONTEND-PROTOTYPE-HANDOFF.md) 與 [本人操作驗證清單](docs/superpowers/verification/2026-09-29-operator-prototype-checklist.md)。文件描述的新版練習工具仍待分批實作。

正式後端逐 PR 接手方式見[開發交接入口](docs/DEVELOPMENT-HANDOFF.md)；權威規格、階段計畫與執行證據分別連到下方後端索引。

## 正式後端交接（2026-10-13 規劃，尚未上線）

接手團隊先讀[零費用正式後端 spec](docs/superpowers/specs/2026-10-13-free-production-backend-spec.md)，再依[19 個小階段計畫](docs/superpowers/plans/2026-10-13-free-production-backend-plan.md)執行。目標採獨立 Firebase Spark＋Hosting；多個等權 Google 白名單帳號、同時只允許一個帳號使用。既有 Firebase setup／部署腳本尚未符合新規格，不能直接用於正式真實資料或 payroll 專案。P00–P04 已合併。P04 #475 的合併 SHA 為 `837a1e871468db217463e9799480beeb6d7b0ab0`；獨立 review pass、required CI run 38579765651 成功。P05 候選目前本機 production Rules Emulator command suite 49/49 通過；A01/P01/P04/P05 五個 Emulator suites 合併回歸 114/114 通過，Cloud E2E 11/11、隔離 prototype 7/7 通過。完整 Vitest 1296 passed、114 skipped（未啟 Emulator 的五個 Emulator-only suites），full lint/build 通過；app TypeScript 仍 exit 2，與 P04 base 的完整 normalized diagnostics diff 為 0 bytes。P05 仍待新 immutable head 的 required CI 與獨立 review，不是 phase pass。P05 合併後的下一階段是 P06 學生名單與期初從零建檔；本輪尚未開始 P06。完整證據與 Rules budget／expression 限制見[現況與證據](docs/ops/free-production-evidence.md)及[Rules budget盤點](docs/ops/p05-rules-budget.md)。尚未部署或開放正式帳務操作。

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
| `VITE_ALLOWED_EMAIL_DOMAIN` | Email domain for operator access (e.g. `your-company.com`) |

## Documentation
- Specifications: [Frontend prototype spec](docs/superpowers/specs/frontend-prototype-workflow-spec.md)（既有 specs 在同目錄）
- Architecture & Plans: `docs/superpowers/`
