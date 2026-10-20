import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installErrorListeners } from './errors/errorLogger'
import { isPrototypeMode } from './appMode'
import { retireLegacyRuntimeCache } from './storage/retireLegacyRuntimeCache'

// M0：瀏覽器分頁標題也標示本機練習，避免與一般模式混淆。
if (isPrototypeMode) {
  document.title = `本機練習 · ${document.title}`
}

// Ref: #291 — Capture cleanup for HMR to prevent listener leaks.
const cleanupErrorListeners = installErrorListeners();
if (import.meta.hot) {
  import.meta.hot.dispose(() => cleanupErrorListeners());
}

const root = createRoot(document.getElementById('root')!);
let startupInProgress = false;

async function startAppAfterCacheRetirement(): Promise<void> {
  if (startupInProgress) return;
  startupInProgress = true;
  try {
    await retireLegacyRuntimeCache();
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  } catch {
    root.render(
      <main className="auth-gate" aria-label="離線快取清理狀態">
        <h1>Talented EasyOrder</h1>
        <p role="alert">舊版離線快取尚未確認清除，正式功能已暫停。請關閉其他 EasyOrder 分頁後重新嘗試。</p>
        <button type="button" onClick={() => void startAppAfterCacheRetirement()}>重新嘗試</button>
      </main>,
    );
  } finally {
    startupInProgress = false;
  }
}

void startAppAfterCacheRetirement();
