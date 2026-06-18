import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installErrorListeners } from './errors/errorLogger'

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
