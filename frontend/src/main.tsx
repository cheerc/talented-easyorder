import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installErrorListeners } from './errors/errorLogger'

if (import.meta.env.DEV) {
  import('@welldone-software/why-did-you-render').then(({ default: whyDidYouRender }) => {
    whyDidYouRender(React, {
      trackAllPureComponents: true,
      trackHooks: true,
      logOnDifferentValues: true,
    });
  });
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
