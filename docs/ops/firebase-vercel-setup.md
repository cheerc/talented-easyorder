# EasyOrder Firebase + Vercel Setup

> **2026-10-13 適用範圍：** 本文保留既有設計／實作參考；新正式後端以[零費用 spec](../superpowers/specs/2026-10-13-free-production-backend-spec.md)及[階段計畫](../superpowers/plans/2026-10-13-free-production-backend-plan.md)為準，尚未實作。不得依舊文將 EasyOrder 部署到 payroll 計費專案；正式部署、備份與安全操作須等計畫中對應階段更新並驗證。

## Firebase Project

1. Create an independent Firebase project for EasyOrder.
2. Add a Web app and copy config values into Vercel environment variables.
3. Enable Firebase Auth Google provider.
4. Add `talented.com.tw` Workspace users only.
5. Enable Firestore in production mode.
6. Deploy `firestore.rules` and `firestore.indexes.json`.
7. Sign in once as `cheerc@talented.com.tw` and create `operators/{uid}` with `role=admin` and `active=true`.

## Vercel

Set these environment variables for Production and Preview:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_USE_EMULATOR=false`
- `VITE_FIRESTORE_ENDPOINT=https://firestore.googleapis.com` (required explicit HTTPS origin when Emulator mode is disabled)

Build command: `cd frontend && npm run build`

Output directory: `frontend/dist`

Phase 1 does not use Vercel Serverless Functions.
