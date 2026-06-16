# Talented EasyOrder (iPad POS)

A highly responsive, offline-first iPad POS system with facial recognition support (Phase 2), built with React, Vite, and Zustand.

## Getting Started

```bash
cd frontend
npm install
npm run dev
```

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
- Specifications: `docs/specs/`
- Architecture & Plans: `docs/superpowers/`
