# Security Notes

## Error Logging

### localStorage Design Decision

`appendErrorLog()` 使用同步 `localStorage.setItem()` 寫入，而非 async IndexedDB。

**理由**：`appendErrorLog` 在 `ErrorBoundary.componentDidCatch` 與 global error listeners（`window.onerror`、`unhandledrejection`）中被同步呼叫。React error boundary 的 `componentDidCatch` 不支援 async 操作——若改為 async IndexedDB 寫入，React render 與 error logging 之間會產生 race condition，可能導致 error 遺失或 partial state 寫入。

**已知 tradeoff**：`localStorage` 對瀏覽器 devtools 使用者可見。目前所有寫入的 entry 已通過 `sanitizeMessage()` / `sanitizeContext()` 去識別化，PII 不會洩漏到 localStorage。

**未來方向**：可評估 IndexedDB + Web Crypto 加密方案，在保留同步寫入安全性的同時增加儲存層的加密保護。
