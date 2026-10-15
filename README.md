# Talented EasyOrder (PC Counter Prototype)

PC 晚餐櫃台前端 prototype，使用 React、Vite 與 Zustand。目前實作以鍵盤登記、收款、餘額與可追溯查帳為主。正式後端依獨立分階段計畫開發；P00–P05 已合併。P06 學生管理已有真 production Rules Emulator 局部證據，仍在完成 UI、CI、回歸及獨立 review gates，未完成 phase acceptance；正式服務仍未部署。Android 整合另案。

Project team 請先讀 [前端交接入口](docs/FRONTEND-PROTOTYPE-HANDOFF.md) 與 [本人操作驗證清單](docs/superpowers/verification/2026-09-29-operator-prototype-checklist.md)。文件描述的新版練習工具仍待分批實作。

正式後端逐 PR 接手方式見[開發交接入口](docs/DEVELOPMENT-HANDOFF.md)；P06 目前已通過未篩選 production Emulator command/list 108/108、P05 recovery 2/2、A01 10/10、P01 36/36、P04 lease 19/19，但 filtered run 的未選案例不計通過，整個 phase 仍未驗收。最新 gate 與 500/501 list 限制見下方後端索引。

## 正式後端交接（2026-10-13 規劃，尚未上線）

接手團隊先讀[零費用正式後端 spec](docs/superpowers/specs/2026-10-13-free-production-backend-spec.md)，再依[19 個小階段計畫](docs/superpowers/plans/2026-10-13-free-production-backend-plan.md)執行。目標採獨立 Firebase Spark＋Hosting；多個等權 Google 白名單帳號、同時只允許一個帳號使用。既有 Firebase setup／部署腳本尚未符合新規格，不能直接用於正式真實資料或 payroll 專案。P00–P05 已合併；P05 PR #476 base 為 `837a1e871468db217463e9799480beeb6d7b0ab0`、source head 為 `0fe7ac738c8495def1c9fdc19580745ff4b4e33f`、實際 merge SHA 為 `41cd08715c435bc5d72ee38985fccd40e0ee4dd1`。獨立 review [通過](https://github.com/cheerc/talented-easyorder/pull/476#pullrequestreview-5521098252)，required CI run [38596486712](https://github.com/cheerc/talented-easyorder/actions/runs/38596486712) 的兩個 jobs 均成功，正式 pinned Chromium 148.0.7778.96／Playwright v1223。P05 production Rules Emulator 為 79/79；A01/P01/P05/P04 lease sequential Emulator regression 為 144/144、0 skipped；Cloud E2E 12/12、隔離 prototype 7/7，合計 19/19。完整 Vitest 1,297 passed、144 skipped（五個 Emulator-only suites，已由獨立 Emulator regression 執行），full lint/build 通過；app TypeScript exit 2，290 項 inherited diagnostics 的 542 行 normalized output 與 base 完全相同。P06 學生管理位於 `codex/backend-p06-students`，實際 PR base `b53423aa71ed4cfac2428f290c648e5a999a0cae`（含 P05 code merge `41cd08715c435bc5d72ee38985fccd40e0ee4dd1` 與 #477 receipt）。demo Emulator 未篩選 production command/list suites 108/108、P05 post-commit recovery 2/2、A01 10/10、P01 36/36、P04 lease 19/19 已通過；filtered 40-test 結果中另有 57 項未選，不能視為通過。P06 尚待完整 prescribed-order regression、UI/E2E、full local suites、CI 與獨立 review。完整歷史證據與目前 WIP／Rules budget 見[現況與證據](docs/ops/free-production-evidence.md)及[Rules budget盤點](docs/ops/p05-rules-budget.md)。尚未部署或開放正式帳務操作。

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
