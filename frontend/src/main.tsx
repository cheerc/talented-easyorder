import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installErrorListeners } from './errors/errorLogger'
import { isPrototypeMode } from './appMode'

// M0：瀏覽器分頁標題也標示本機練習，避免與一般模式混淆。
if (isPrototypeMode) {
  document.title = `本機練習 · ${document.title}`
}

// Ref: #291 — Capture cleanup for HMR to prevent listener leaks.
const cleanupErrorListeners = installErrorListeners();
if (import.meta.hot) {
  import.meta.hot.dispose(() => cleanupErrorListeners());
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
