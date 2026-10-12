# Talented EasyOrder (PC Counter Prototype)

PC 晚餐櫃台前端 prototype，使用 React、Vite 與 Zustand。當前重點是鍵盤登記、收款、餘額與可追溯查帳；iPad／人臉辨識及後端擴充暫緩。

Project team 請先讀 [前端交接入口](docs/FRONTEND-PROTOTYPE-HANDOFF.md) 與 [本人操作驗證清單](docs/superpowers/verification/2026-09-29-operator-prototype-checklist.md)。文件描述的新版練習工具仍待分批實作。

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
