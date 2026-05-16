# EasyOrder Firebase + Vercel Setup

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

Build command: `cd frontend && npm run build`

Output directory: `frontend/dist`

Phase 1 does not use Vercel Serverless Functions.
