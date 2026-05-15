# Android 與跨平台支援策略實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 EasyOrder 從 iPad Safari PWA 假設擴展為 iPadOS + Android 手機/平板都可安全操作的跨平台 PWA，並釐清何時維持純 PWA、何時需要 Android TWA、何時不該走 App Store wrapper。

**Architecture:** 以「純 PWA 優先、TWA 作為 Android 發行選項、native wrapper 作為最後升級路徑」為策略。把平台差異隔離在 feature detection、install adapter、device capability adapter、responsive layout tokens、camera/face-recognition adapter 與測試矩陣，不讓 POS 帳務流程分叉。

**Tech Stack:** Vite 8, React 19, TypeScript 6, Zustand 5, IndexedDB, Service Worker, Web App Manifest, Workbox / `vite-plugin-pwa`, MediaDevices `getUserMedia`, optional Android Trusted Web Activity via Bubblewrap, Playwright cross-browser smoke tests, BrowserStack 或實機測試矩陣。

---

## 已讀資料與現況

- 派發指定的 `/Users/cheerc/talented-easyorder/docs/superpowers/specs/talented-easyorder-spec.pdf` 目前不存在。
- 已改讀實際存在的 `docs/iPad人臉辨識訂餐系統設計方案_V3.pdf`。
- 已讀 `docs/superpowers/specs/2026-05-14-ipad-face-auth-handoff-spec.md`。
- 已讀 `docs/superpowers/specs/2026-05-14-google-sheets-sync-offline-spec.md`。
- 已讀 `docs/superpowers/plans/2026-05-15-pwa-offline-first-strategy.md`。
- 已讀 `docs/superpowers/plans/2026-05-15-deployment-hosting-strategy.md`。
- 已讀 `docs/superpowers/plans/2026-05-15-accessibility-plan.md`。
- 已檢查 `frontend/src/App.tsx`、`frontend/src/components/pos-components.tsx`、`frontend/src/components/screens.tsx`、`frontend/src/index.css`、`frontend/package.json`、`frontend/vite.config.ts`。

## 官方來源檢查於 2026-05-15

- WebKit Web Push for Web Apps on iOS and iPadOS: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- web.dev PWA installation: https://web.dev/learn/pwa/installation
- Chrome Developers Trusted Web Activity overview: https://developer.chrome.com/docs/android/trusted-web-activity/
- Chrome Developers Trusted Web Activity quick start: https://developer.chrome.com/docs/android/trusted-web-activity/quick-start
- MDN Service Worker API: https://developer.mozilla.org/docs/Web/API/Service_Worker_API
- MDN MediaDevices `getUserMedia`: https://developer.mozilla.org/docs/Web/API/MediaDevices/getUserMedia
- MDN Storage quotas and eviction criteria: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- MDN Push API: https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- Apple App Store Review Guidelines: https://developer.apple.com/app-store/review/guidelines/

## 核心結論

1. **先維持純 PWA。** EasyOrder 是校園內部 POS，純 PWA + custom domain + installation runbook 比 Play Store 上架更快、更少審核風險。
2. **Android 支援不應等同於 TWA。** Android Chrome 已有較完整 install prompt / WebAPK / Web Push / Service Worker 體驗；TWA 只在需要 Play Store 發現、MDM 發派、品牌化安裝或學校要求「像 app」時才做。
3. **iOS/iPadOS 要保守。** iPadOS Home Screen web app 需要使用者手動 Add to Home Screen；同一 PWA 可被安裝多次且 storage isolated，這對本地帳務是重大風險。
4. **Android 尺寸差異比 iPad 大。** Android 要支援手機、7-8 吋平板、10 吋平板與低階裝置，不能只用目前偏桌面/iPad 的寬版 POS layout。
5. **相機/人臉辨識要 feature detection + adapter。** 不可假設 Safari PWA 與 Android Chrome 的 camera permission、facingMode、效能、背景行為一致。
6. **離線與 storage 必須按平台驗證。** IndexedDB、Cache API、storage quota、eviction 與 installed PWA storage 行為都要在目標 iPad/Android 實機測試。

## PWA 跨平台差異

### iPad Safari / Home Screen Web App

- 安裝流程：沒有自動 install prompt；需 Share -> Add to Home Screen。
- Installed runtime：Home Screen web app 使用 WebKit/Web.app，不完全等同 Safari tab。
- 多重安裝：同一 PWA 可被安裝多次，而且可能有隔離 storage。EasyOrder 必須禁止同一裝置多個 production icon 同時使用。
- Push：iOS/iPadOS 16.4+ 的 Home Screen web app 支援 Web Push，且 permission 必須由使用者互動觸發。
- PWA display：iOS/iPadOS 主要支援 standalone；`minimal-ui` 會 fallback。
- 風險：camera permission、storage isolation、background lifetime、cache eviction、同站多 icon 對 local-first ledger 的影響。

### Android Chrome PWA

- 安裝流程：可出現 install prompt，也可由 app 內按鈕觸發 `beforeinstallprompt`。
- Installed runtime：Chrome/GMS 常見情況會建立 WebAPK；不可假設所有 Android browser 都是 WebAPK，可能只是 shortcut。
- Push：Android Chrome Web Push 較成熟，但仍需要 permission、service worker 與 server subscription 管理。
- PWA display：standalone/fullscreen/minimal-ui 支援度通常比 iOS 彈性高。
- 風險：裝置碎片化、低階 CPU/RAM、不同瀏覽器、WebView/OEM browser 行為、虛擬鍵盤 viewport resize。

### TWA

- TWA 是 Android app 包裝方式，讓 app 以 browser engine 全螢幕顯示受信任網站。
- 需要 Digital Asset Links 驗證 app 與網站 ownership；驗證失敗會 fallback 到 Custom Tab。
- 可用 Bubblewrap 產生 Android wrapper。
- TWA 不是離線資料庫或帳務同步解法；它只是 Android 發行/包裝層。
- TWA 不解決 iOS App Store；iOS 若要上架通常是 WKWebView/native wrapper，且需符合 App Store Review Guidelines 的 minimum functionality。

## 觸控與 UI 適配策略

### Breakpoints

建議新增 platform-independent layout tokens：

| Token | 寬度 | 目標裝置 | Layout |
|---|---:|---|---|
| `compact` | `< 600px` | Android phone | 單欄、搜尋優先、側欄摺疊、報表改 summary-first。 |
| `medium` | `600-899px` | 小 Android tablet / iPad split view | POS 單欄 + sticky action bar，最近交易可收合。 |
| `tablet` | `900-1199px` | iPad / 10 吋 Android tablet | 目前雙欄 POS 可保留，但 touch targets 要增大。 |
| `desktop` | `>= 1200px` | PC counter | TopBar + 雙欄 + 報表密度較高。 |

### Layout 原則

- 核心 POS 不做 landing page；第一屏仍是搜尋/訂餐工作台。
- Android phone 上不要同時顯示搜尋、學生卡、側欄最近交易與 Tweaks；分階段顯示。
- 金額 input 與確認/取消需在虛擬鍵盤出現時仍可操作。
- 報表表格在 compact/medium 下改為可展開 list，不用橫向塞滿。
- 供應商電話在 mobile 仍可 `tel:`，但不能把電話 icon 當唯一可點目標。

### 觸控與手勢

- 所有互動目標至少 44px，高風險交易目標至少 48px。
- 不依賴 swipe 才能完成核心工作；Android/iOS 返回手勢可能與 app 內手勢衝突。
- Android back button / browser back 要被明確處理：
  - selected student 狀態：先回 idle，不離開 app。
  - dialog/warning 狀態：先關 dialog。
  - unsynced queue 存在時：阻止關閉前顯示安全提示。
- iOS edge-swipe/back gesture 不可造成未提交交易遺失；用 crash draft 與 explicit cancel。

### 虛擬鍵盤

- iOS Safari 與 Android Chrome 對 viewport resize、safe area、input scrollIntoView 行為不同。
- 金額 input 使用 `inputMode="numeric"` 而不是只靠 `type="number"`，避免 locale/stepper/decimal 行為不一致。
- 確認按鈕要在 keyboard open 時可見，必要時用 sticky bottom action bar。
- Search input focus 不可在完成 banner 未 dismiss 前自動拉起鍵盤。

## 裝置特定功能

### Camera / Face Recognition

- `getUserMedia` 需要 secure context 與 permission；不可在 HTTP production 使用。
- 以 adapter 包起 camera access：
  - `BrowserCameraAdapter`
  - `FaceRecognizerAdapter`
  - `DeviceCapabilityProbe`
- 不直接使用非標準/低支援的 `FaceDetector` 作為核心方案。
- Android 低階裝置可能無法即時跑人臉模型；需性能 gate：
  - camera start <= 1500ms。
  - recognition P95 <= 1500ms。
  - UI frame 不低於可操作水準。
- iPad 與 Android 都必須保留手動搜尋 fallback。
- iPad/Android 學生面向畫面都不可顯示或朗讀餘額、欠款、付款資訊。

### IndexedDB / Storage

- IndexedDB 是 local-first ledger/queue 的主存放層；Zustand 只做 UI facade。
- 啟動時要跑 storage probe：
  - IndexedDB open。
  - readwrite transaction。
  - quota estimate。
  - persistent storage request outcome。
- Android Chrome 通常 storage 能力較好，但低階/清理工具/OEM browser 仍可能清資料。
- iOS/iPadOS installed PWA storage isolation 與多 icon 是更大的帳務風險。
- 不允許 production 同一天在同一帳務單位用多個孤立 local store 分別收款，除非 multi-device sync/conflict 已完成。

### Offline Cache

- Service Worker 只 cache app shell 與安全 static assets。
- Mutation API、sync write、closeout、migration 不可用 cache 假成功。
- Android Chrome 的 service worker/background behavior 通常較完整，但不可依賴 Background Sync 作為唯一補登機制。
- iOS/iPadOS background lifetime 較保守，必須以前景 reconnect flush 為主。

### Performance

- Android 需把 low-end device 當一級測試目標。
- 避免午餐尖峰中載入大模型、大圖片、大 chunk。
- PWA shell 與 POS core 要 code split；face model route lazy load。
- Recently list、report grouping、search filter 需限制資料量與 memoization。
- 測試目標：
  - cold start 到可搜尋 <= 3s on baseline Android tablet。
  - search keystroke P95 <= 50ms with target student count。
  - transaction local commit <= 150ms。
  - face model not loaded on PC POS route。

## 開發與測試策略

### Adapter / Feature Detection

**Files to create:**

- `frontend/src/platform/platformCapabilities.ts`
- `frontend/src/platform/installPrompt.ts`
- `frontend/src/platform/viewport.ts`
- `frontend/src/platform/cameraCapabilities.ts`
- `frontend/src/platform/storageCapabilities.ts`
- `frontend/src/platform/__tests__/*.test.ts`

Capability shape:

```ts
export interface PlatformCapabilities {
  runtime: 'browser_tab' | 'installed_pwa' | 'twa' | 'unknown';
  os: 'ios' | 'ipados' | 'android' | 'desktop' | 'unknown';
  browser: 'safari' | 'chrome' | 'edge' | 'firefox' | 'samsung' | 'unknown';
  displayMode: 'browser' | 'standalone' | 'fullscreen' | 'minimal-ui';
  supportsBeforeInstallPrompt: boolean;
  supportsServiceWorker: boolean;
  supportsPush: boolean;
  supportsBadging: boolean;
  supportsGetUserMedia: boolean;
  supportsIndexedDB: boolean;
  coarsePointer: boolean;
}
```

Rules:

- 使用 feature detection 優先，不用 user agent 作為唯一依據。
- UA 只用來改善 copy，例如顯示 iOS manual install steps 或 Android Chrome install button。
- 所有 capability 都要能被測試 mock。

### CI 與測試矩陣

第一階段 CI：

- Unit: platform capability helpers。
- Component: compact/medium/tablet rendering smoke。
- Build: `npm run build`。
- Optional Playwright desktop Chromium/WebKit smoke once Playwright is introduced。

實機/雲端測試矩陣：

| Platform | Browser/runtime | 必測項目 |
|---|---|---|
| iPadOS current | Safari tab | install guide、camera prompt、IndexedDB probe、POS workflow。 |
| iPadOS current | Home Screen PWA | storage isolation、push permission、offline shell、camera behavior。 |
| Android current | Chrome tab | install prompt、virtual keyboard、camera、push、offline。 |
| Android current | Chrome installed PWA/WebAPK | display mode、storage、cache、push、back button。 |
| Android low-end | Chrome installed PWA | cold start、search latency、local commit、memory。 |
| Android tablet | Chrome installed PWA | tablet layout、touch target、split screen。 |
| Desktop PC | Chrome/Edge | counter workflow remains stable。 |

BrowserStack / LambdaTest 可覆蓋 breadth，但 camera、offline、storage isolation、TWA 和 lunch-speed tests 仍需要實機。

### 漸進增強與優雅降級

- POS core: 必須在支援 IndexedDB/local storage 的 browser tab 可用。
- Install prompt: Android 有 prompt 就用；iOS 顯示 manual guide；沒有 install 能力仍可 browser tab 使用。
- Push: 只作提醒/狀態，不作帳務正確性依賴。
- Camera: 不支援或權限拒絕時，回 PC manual search。
- TWA: 沒有 TWA 不影響純 PWA；TWA verification 失敗不能破壞帳務。
- Background behavior: 不依賴背景同步完成 closeout；使用前景 flush 與 repair UI。

## 部署與發行策略

### 純 PWA

Recommended default for pilot.

- 一個 HTTPS custom domain。
- Cloudflare Workers Static Assets + Worker API if Plan 2 approved。
- `manifest.webmanifest`、icons、theme color、standalone display。
- Android install button + iOS manual guide。
- 校園 SOP 控制 device enrollment：每台正式裝置只有一個 production icon。

### Android TWA / Google Play

Use only when one of these is true:

- 學校要求從 Play Store 或 MDM 安裝。
- 需要 app launcher / policy / kiosk distribution 的一致性。
- 需要用 Play Store review/distribution 管控版本。
- 非技術使用者無法 reliably 安裝純 PWA。

TWA implementation needs:

- `assetlinks.json` on production domain。
- Android package generated by Bubblewrap。
- Play Store listing assets。
- release signing key ownership。
- TWA verification test。
- fallback behavior check when verification fails.

TWA non-goals:

- 不解決 iOS。
- 不替代 IndexedDB migration/sync。
- 不允許 Android 與 iPad 帳務行為分叉。

### App Store / iOS Wrapper

Not recommended for initial pilot.

- Pure PWA cannot be listed directly as a normal App Store app.
- WKWebView/native wrapper must provide enough native/app-like value and pass Apple review.
- A wrapper that is just a website bookmark has review risk under Apple minimum functionality expectations.
- If iOS App Store distribution becomes mandatory, write a separate native-wrapper feasibility plan covering App Review, privacy labels, camera permission text, offline storage, and support ownership.

### 更新機制

- Pure PWA: deploy static assets/service worker; app detects new version and prompts operator to update outside active lunch flow.
- Android WebAPK: metadata/icon updates may involve browser/WebAPK update path; do not rely on instant icon/name changes.
- TWA: wrapper updates go through Play Store; web content still updates by deployment, but wrapper capabilities/config need app release.
- iOS Home Screen PWA: web content updates via deployment/service worker; no App Store review, but service worker cache must not silently swap during active POS transaction.

## 實作任務

### Task 1: Platform Capability Layer

**Files:**
- Create: `frontend/src/platform/platformCapabilities.ts`
- Test: `frontend/src/platform/__tests__/platformCapabilities.test.ts`

- [ ] Define `PlatformCapabilities` type.
- [ ] Implement `detectDisplayMode()` using `window.matchMedia('(display-mode: standalone)')` and browser fallback.
- [ ] Implement feature checks for service worker, push, badging, getUserMedia, IndexedDB, coarse pointer.
- [ ] Unit test Android/iOS/desktop mocked capabilities.
- [ ] Commit:

```bash
git add frontend/src/platform
git commit -m "feat: add platform capability detection"
```

### Task 2: Cross-Platform Install UX

**Files:**
- Create: `frontend/src/platform/installPrompt.ts`
- Modify: `frontend/src/components/screens.tsx`
- Docs: `docs/ops/pwa-install-runbook.md`

- [ ] Add Android/Chromium `beforeinstallprompt` adapter.
- [ ] Add iPad/iPhone manual Add to Home Screen instructions.
- [ ] Add duplicate-install warning for iOS/iPadOS and production devices.
- [ ] Add Admin install readiness panel, not POS interrupt.
- [ ] Commit:

```bash
git add frontend/src/platform/installPrompt.ts frontend/src/components/screens.tsx docs/ops/pwa-install-runbook.md
git commit -m "feat: add cross-platform PWA install guidance"
```

### Task 3: Responsive POS Layout

**Files:**
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/pos-components.tsx`
- Test: `frontend/src/components/__tests__/responsive-pos.test.tsx`

- [ ] Add compact/medium/tablet/desktop CSS tokens.
- [ ] Collapse side menu/recent strip on compact.
- [ ] Use sticky bottom action bar for selected-student state on mobile.
- [ ] Replace `type="number"` amount UX with `inputMode="numeric"` and validation-owned parsing.
- [ ] Test compact render does not hide search, amount, confirm, cancel.
- [ ] Commit:

```bash
git add frontend/src/index.css frontend/src/App.tsx frontend/src/components/pos-components.tsx frontend/src/components/__tests__/responsive-pos.test.tsx
git commit -m "fix: adapt POS layout for Android devices"
```

### Task 4: Android Back / iOS Navigation Safety

**Files:**
- Create: `frontend/src/platform/navigationGuards.ts`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/platform/__tests__/navigationGuards.test.ts`

- [ ] Define safe back behavior for idle, selected student, duplicate warning, crash draft, unsynced queue.
- [ ] Use history state only for app-local recovery, not as accounting truth.
- [ ] Add `beforeunload` warning only when unsynced local rows or uncommitted draft exists.
- [ ] Commit:

```bash
git add frontend/src/platform/navigationGuards.ts frontend/src/platform/__tests__/navigationGuards.test.ts frontend/src/App.tsx
git commit -m "fix: guard mobile navigation during POS work"
```

### Task 5: Camera And Face Capability Adapter

**Files:**
- Create: `frontend/src/platform/cameraCapabilities.ts`
- Modify: `frontend/src/domain/faceFeasibility.ts`
- Docs: `docs/face-handoff/cross-platform-camera-test.md`

- [ ] Probe secure context, `navigator.mediaDevices?.getUserMedia`, facingMode behavior, permission failure, startup time.
- [ ] Store no raw images in logs.
- [ ] Add Android low-end performance gate.
- [ ] Add fallback copy for unsupported camera: `請改用櫃台搜尋`。
- [ ] Commit:

```bash
git add frontend/src/platform/cameraCapabilities.ts frontend/src/domain/faceFeasibility.ts docs/face-handoff/cross-platform-camera-test.md
git commit -m "feat: add cross-platform camera capability checks"
```

### Task 6: Storage And Offline Platform Probe

**Files:**
- Create: `frontend/src/platform/storageCapabilities.ts`
- Modify: `frontend/src/storage/storageHealth.ts`
- Docs: `docs/ops/storage-platform-matrix.md`

- [ ] Probe IndexedDB open/readwrite, Cache API, storage estimate, persistent storage request.
- [ ] Record results by install runtime: Safari tab, iOS Home Screen, Android Chrome tab, Android installed PWA, TWA.
- [ ] Block production multi-device local-only usage until sync/conflict plan is implemented.
- [ ] Commit:

```bash
git add frontend/src/platform/storageCapabilities.ts frontend/src/storage/storageHealth.ts docs/ops/storage-platform-matrix.md
git commit -m "feat: add platform storage probes"
```

### Task 7: TWA Feasibility Package

**Files:**
- Create: `docs/deployment/android-twa-feasibility.md`
- Create: `docs/deployment/android-twa-release-checklist.md`

- [ ] Document pure PWA vs TWA decision gate.
- [ ] Document Bubblewrap setup, package name, signing ownership, `assetlinks.json`, Play Console assets, test devices.
- [ ] Document verification failure fallback to Custom Tab.
- [ ] Document that TWA does not change ledger/sync behavior.
- [ ] Commit:

```bash
git add docs/deployment/android-twa-feasibility.md docs/deployment/android-twa-release-checklist.md
git commit -m "docs: add Android TWA feasibility gate"
```

### Task 8: Cross-Platform QA Matrix

**Files:**
- Create: `docs/qa/cross-platform-pwa-test-matrix.md`
- Modify: `.github/workflows/ci.yml` only if Playwright/browser smoke is approved.

- [ ] Define manual tests for iPad Safari, iPad Home Screen, Android Chrome tab, Android installed PWA, Android low-end, Android tablet, desktop PC.
- [ ] Define smoke test scenarios: install prompt visibility, offline app shell, POS order, crash draft, storage probe, camera permission fallback.
- [ ] Add Playwright plan for Chromium + WebKit desktop as baseline, with real-device coverage kept manual/BrowserStack.
- [ ] Commit:

```bash
git add docs/qa/cross-platform-pwa-test-matrix.md .github/workflows/ci.yml
git commit -m "docs: add cross-platform PWA QA matrix"
```

## 驗證指令

每個實作 PR 完成前執行：

```bash
cd frontend
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

若導入 Playwright，再加入：

```bash
cd frontend
npx playwright test
```

人工驗收必須包含：

- iPad Safari tab。
- iPad Home Screen PWA。
- Android Chrome tab。
- Android installed PWA/WebAPK。
- Android low-end phone or tablet。
- Desktop counter browser。

## DISCUSS WITH USER

1. Android 支援的第一目標是手機、平板，還是兩者同時？
2. 學校是否要求 Play Store / MDM 安裝？如果沒有，建議先純 PWA。
3. 是否需要 push notification？若只是午餐櫃台 POS，push 可能不是 MVP 必需。
4. Android 是否也要做人臉辨識，還是只做 PC/POS 操作支援？
5. 是否允許多台 Android/iPad 同時記帳？若允許，必須先完成 cloud sync/conflict，不可只靠 local-first。
6. 低階 Android 裝置最低硬體規格要怎麼定義？
7. iOS App Store 是否真的需要？若需要，需另開 native wrapper feasibility，不建議把它混入 PWA plan。

## Definition Of Done

- 平台 capability layer 可測，且不靠 UA 作為唯一判斷。
- Android Chrome 與 iPad Safari/Home Screen 都有正確 install guidance。
- compact/medium/tablet/desktop layout 可完成 POS 核心流程。
- Android back、iOS navigation、virtual keyboard 不會造成未提交交易遺失。
- Camera/face feature 以 adapter 與實機 gate 控制，不假設跨平台一致。
- IndexedDB/Cache/storage probes 覆蓋 iOS Home Screen、Android installed PWA 與 browser tab。
- TWA 被明確定義為 Android 發行選項，不是 MVP 必需，也不是帳務同步方案。
- QA matrix 包含實機或 BrowserStack 覆蓋；CI 只承擔可自動化的 baseline。
