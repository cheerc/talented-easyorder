# Issue #586 執行計畫：切回分頁時靜默重新確認使用權

- Issue：#586（切回 EasyOrder 分頁時一律遮罩「正在確認此分頁的使用權」並清空重載畫面）
- 契約來源：`docs/superpowers/specs/2026-10-13-free-production-backend-spec.md` §4.2（使用權租約）
- 派工時機：CheerC 指示等 #585（命令回饋 Toast）全部合併後才派工（cmsg_01NL2RLuU7UMaNjFmadMsJ3uJb8TrzJYN4QWt6nsgSGeTd）。
- 單一 PR（P1）。高風險區：無 Rules 變更、無新 command kind、不碰 P14 備份；只改用戶端租約狀態機，**單一 Reviewer 即可**（不符雙審條件）。

## 1. 目標、範圍與排除

### 根因（依 source，已核對 main `39fe693`）

`frontend/src/providers/FirebaseProvider.tsx:209-240` 的 `onVisibilityChange`：分頁每次變成 `visible`，**不論目前是否已確認持有、離開多久**，都會：

1. `confirmedEpochRef.current = null`、`stopHeartbeat()`；
2. `publishLease({ ...defaultLeaseState, ... })`（`isKnown=false`）→ `AuthGate.tsx:211` 顯示「正在確認系統使用權」，**children 卸載**；
3. `clearSensitiveDataSafely()` → 清空雲端 Zustand 與快取；
4. 讀 `getLeaseStatus` 後 `publishLease({ ...observed, isHolder: false })` → `AuthGate.tsx:240-244` 顯示「正在確認此分頁的使用權」；
5. `probeHolder` 續約成功後才恢復 → 整個外殼重新掛載、所有頁面監聽重讀。

spec §4.2 只要求「失去使用權立即遮罩與清記憶體」與「背景頁可能停 timer，逾期即失去權限」；每次業務讀寫仍由 Rules 檢查。沒有條文要求使用權沒變時遮罩。

### 目標

- 已確認持有人（`isKnown && isHolder && holderUid===uid && confirmedEpochRef===epoch`）切回分頁：
  - 隱藏不到 60 秒：什麼都不做（心跳與租約 `onSnapshot` 仍在運作）。
  - 隱藏 60 秒以上：在背景呼叫既有 `probeHolder(epoch)`（= `renewLease` 交易＋伺服器回讀）一次；**期間不遮罩、不清資料、不停心跳**。
  - 續約成功 → 維持持有，畫面不動。
  - 續約失敗（`stale_epoch`、持有人變更、Rules 拒絕＝已逾期、離線無法證明）→ 走 `probeHolder` 既有失敗分支：遮罩＋清資料（fail closed）。
- 未確認的分頁（已在遮罩中）切回：**維持現有流程不變**。

### 排除（明確不做）

- 不改 `subscribeOperatorAccess`（`authService.ts:142-146`）ID token 刷新時先送 `checking` 的遮罩。#580 已由 CheerC 裁決「另一工作階段登入時遮罩原工作階段」是單一操作員設計（issue #580 comment，2026-10-31）；A04 依賴它。若 CheerC 之後仍偶爾看到「正在確認 Google 帳號與操作員權限…」（另一段文字，約每小時 token 刷新一次），另開 issue 處理。
- 不改 Rules、租約文件、`LEASE_HEARTBEAT_INTERVAL_MS`、Web Lock 選主、`AuthGate.tsx`。
- 不改 A04（`e2e/cloud-production.spec.ts:180`）。

## 2. Rulings

- **Ruling R1：門檻 60 秒，以「隱藏時長」判斷是否背景續約。** — 隱藏不到 60 秒時 timer 節流不足以讓 5 分鐘租約逾期（心跳 120 秒、租約 5 分鐘），而且租約 `onSnapshot` 會即時反映持有人變更；60 秒以上才補一次續約證明，抵銷背景 timer 被節流的風險。頻繁切換不會每次都寫一次租約（Spark 額度）。本機時間只決定「要不要去問伺服器」，不授予或延長使用權，符合 §4.2「本機時鐘與 timer 不授予、延長或證明使用權」。
- **Ruling R2：隱藏時長用 `performance.now()`。** — 單調時鐘，不受系統時間調整影響；Playwright `page.clock` 也會控制它，E2E 可快轉。
- **Ruling R3：重用 `probeHolder`，不新增續約邏輯。** — 它已處理 acquired／stale_epoch／offline／lost 四種結果，且失敗分支就是正確的 fail-closed 行為。
- **Ruling R4：離線導致的續約失敗仍遮罩。** — 與目前 `probeHolder` 行為一致，spec 要求無法證明就不開放；簡化原則下不另做「離線寬限」。
- **Ruling R5：常數 `TAB_RETURN_RECHECK_AFTER_MS = 60 * 1000` 放在 `firebase/activeAccountLease.ts`**，與其他租約常數同處；不放在 `FirebaseProvider.tsx`（避免 react-refresh lint 的元件檔非元件 export）。
- **Ruling R6：spec §4.2 補一句**，把分頁恢復行為寫成契約（見 §3.3），因為這是長期行為、Reviewer 需要依據。

## 3. P1 變更（單一 PR）

### 3.1 `frontend/src/firebase/activeAccountLease.ts`

在 `LEASE_RECHECK_THROTTLE_MS`（約 30 行）之後新增：

```ts
/** 已確認持有的分頁隱藏超過此時間，恢復可見時在背景續約證明一次（#586）。本機時間只決定是否詢問伺服器。 */
export const TAB_RETURN_RECHECK_AFTER_MS = 60 * 1000;
```

### 3.2 `frontend/src/providers/FirebaseProvider.tsx`

1. import 加 `TAB_RETURN_RECHECK_AFTER_MS`。
2. 在租約 effect（133-252 行）內、`let visibilityProbeInFlight = false;` 旁加：
   ```ts
   let hiddenAt: number | null = document.visibilityState === 'hidden' ? performance.now() : null;
   ```
3. 改寫 `onVisibilityChange`（209 行起）為以下順序（舊的「未確認」分支內容原樣保留，不改字）：
   ```ts
   const onVisibilityChange = () => {
     if (document.visibilityState === 'hidden') {
       hiddenAt ??= performance.now();
       return;
     }
     if (document.visibilityState !== 'visible') return;
     const hiddenFor = hiddenAt === null ? Number.POSITIVE_INFINITY : performance.now() - hiddenAt;
     hiddenAt = null;
     if (visibilityProbeInFlight) return;

     const current = leaseRef.current;
     const confirmedHolder = current.isKnown && current.isHolder
       && current.holderUid === currentUid && confirmedEpochRef.current === current.epoch;
     if (confirmedHolder) {
       // #586: a confirmed holder stays mounted; Rules still check every read/write.
       if (hiddenFor < TAB_RETURN_RECHECK_AFTER_MS) return;
       visibilityProbeInFlight = true;
       const epoch = current.epoch;
       probedEpochRef.current = epoch;
       void probeHolder(epoch)
         .catch(() => markUnknownAfterProbeFailure(epoch, '無法確認伺服器租約'))
         .finally(() => { visibilityProbeInFlight = false; });
       return;
     }

     visibilityProbeInFlight = true;
     // ……以下為現有未確認分支，原樣保留（confirmedEpochRef=null、stopHeartbeat、publish default、clear、getLeaseStatus、probeHolder）
   };
   ```
   陷阱：
   - `hiddenAt` 為 `null`（沒看到 hidden 事件就收到 visible）視為無限長 → 走背景續約，而非略過（保守）。
   - **不要**在已確認分支呼叫 `stopHeartbeat()`、`publishLease`、`clearSensitiveDataSafely()` 或把 `confirmedEpochRef` 設 null；`probeHolder` 成功時 `publishLease(stateFromResult(...))` 保持 `isHolder/epoch/isKnown` 不變，心跳 effect（254-281 行）的 deps 不變，不會重啟。
   - `probeHolder` 成功分支（182-187 行）的 epoch 檢查已防止「探測中租約已變」時誤發布。
   - `setObservedLease`（159 行）在 `visibilityProbeInFlight` 為 true 時不會重複 probe，這是預期。

### 3.3 `docs/superpowers/specs/2026-10-13-free-production-backend-spec.md` §4.2

在第 68 行（「持有帳號每 120 秒續約…」那條）末尾接一句：

> 分頁恢復可見時，已確認持有的分頁不遮罩、不清資料：隱藏未滿 60 秒不動作，60 秒以上在背景以 Renew 重新證明一次，失敗（持有人／epoch 改變、Rules 拒絕、無法連線證明）才遮罩並清記憶體；未確認的分頁維持重新讀租約再證明（#586）。

### 3.4 測試 mock 更新（否則常數為 `undefined`，比較永遠為 false）

- `frontend/src/providers/__tests__/FirebaseProvider.test.tsx:28-43` 的 `vi.mock('../../firebase/activeAccountLease', ...)` factory 加 `TAB_RETURN_RECHECK_AFTER_MS: 60_000`。
- `frontend/src/__tests__/helpers/renderApp.tsx:13` 的 factory 回傳物件同樣加入 `TAB_RETURN_RECHECK_AFTER_MS: 60_000`（該 factory 沒有 `importActual`，已核對）。

### 3.5 `docs/DEVELOPMENT-HANDOFF.md`

頂端新增「2026-11-xx Issue #586 接手點」段落：範圍（只改用戶端分頁恢復流程，不改 Rules／command／repository／帳務／備份，不部署，不推進 P18）、RED／GREEN 完整 SHA、驗證結果、下一步（Gate 2 後 squash-merge；CheerC 實機 Chrome 切分頁確認）。

## 4. TDD 與驗證

### RED commit（只含測試，必須在現行程式上失敗）

**Vitest：`frontend/src/providers/__tests__/FirebaseProvider.test.tsx`** 新增 `describe('#586 — tab return keeps a confirmed holder mounted')`。沿用 202 行案例的建立方式（`accessCallback` ok → `leaseCallback` 同 UID epoch 1 → `renewLease` resolved acquired → `isHolder` true）。輔助：

- `setVisibility(state)`：`Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })` 後 `document.dispatchEvent(new Event('visibilitychange'))`，包在 `act`。`afterEach` 刪除覆寫（`delete (document as any).visibilityState` 或還原為 `'visible'`）。
- `vi.spyOn(performance, 'now')` 控制時間。
- 以 `renderHook` 的 callback 把每次 `lease` 推進陣列，斷言「從未出現 `isHolder:false`」。

| # | 前置 → 操作 | 預期 |
|---|---|---|
| V1 | 已確認持有；hidden @t=0 → visible @t=5,000 | `renewLease` 呼叫次數不變（仍 1 次）；`getLeaseStatus` 未呼叫；`clearSensitivePosData` 未呼叫；`stopHeartbeat` 未呼叫；lease 歷程無 `isHolder:false` |
| V2 | 同上；visible @t=61,000 | `renewLease` 第 2 次以 `('op-1', 1)` 呼叫；lease 歷程無 `isHolder:false`；未清資料；`startLeaseHeartbeat` 仍只呼叫 1 次 |
| V3 | V2 但第 2 次 `renewLease` 回 `{status:'lost', message:'伺服器未確認續約；請重新檢查使用權'}` | `isHolder` 變 false；`clearSensitivePosData` 1 次；`stopHeartbeat` 被呼叫 |
| V4 | V2 但第 2 次回 `stale_epoch`，`getLeaseStatus` 回 holder `op-2` epoch 2 | lease `{holderUid:'op-2', epoch:2, isHolder:false}`；清資料 1 次 |
| V5 | 尚未確認（`renewLease` 第一次回 lost，畫面遮罩中）→ hidden → visible | `getLeaseStatus` 被呼叫（現有未確認流程保留） |

V1、V2 在現行程式失敗（現行會 publish default 並清資料）。V3–V5 是回歸保護，現行可能通過，PR 內如實註明。

**E2E：`frontend/e2e/cloud-production.spec.ts`** 新增 `A12: a confirmed holder tab returning from the background stays mounted and re-proves silently after a minute`（接在 A11 後）：

1. `context = browser.newContext({ baseURL: E2E_BASE_URL })`；`page.clock.install({ time: new Date() })`（同 A08 做法）。
2. `signInGoogle(page, E2E_IDENTITIES.operatorA.email)`、按「取得系統使用權」、等 `.operator-strip` 可見、`readAccessLease` 為 `{holderUid: uid, epoch: 1}`，記 `u0 = updatedAt`。
3. `page.evaluate` 安裝遮罩計數：`MutationObserver` 監看 `document.body` subtree，新增節點 `matches('.auth-gate')` 或含 `.auth-gate` 時 `window.__maskCount++`；並安裝 `window.__setVisibility(state)`（同 V 系列的 defineProperty＋dispatch）。
4. 點 `.operator-menu summary` 打開選單（重新掛載會讓 `<details>` 關閉，作為「沒有重新掛載」的可見證據）。
5. 短離開：`__setVisibility('hidden')` → `page.clock.runFor(5_000)` → `__setVisibility('visible')` → `page.waitForTimeout(1_000)`；斷言 `__maskCount === 0`、`.operator-menu` 仍 `open`、`readAccessLease().updatedAt` 等於 `u0`。
6. 長離開：hidden → `runFor(61_000)` → visible；`expect.poll(updatedAt)` 大於 `u0`；斷言 `__maskCount === 0`、選單仍 open、`.operator-strip` 含「租約 Epoch: 1」。
7. 背景期間逾期：`seedAccessLease({ holderUid: uid, epoch: 1, updatedAt: new Date(Date.now() - 6 * 60 * 1000) })`；等一下讓 snapshot 到（同 holder/epoch，不遮罩）；hidden → `runFor(61_000)` → visible；斷言 `.auth-gate` 可見且含「正在確認此分頁的使用權」、`.operator-strip` 數量 0。
8. `finally` 關閉 context。

步驟 5、6 在現行程式失敗（會遮罩、選單被關）。注意：累計快轉 127 秒會觸發一次 120 秒心跳，這不影響斷言（心跳只延長 `updatedAt`；步驟 7 的 seed 在之後才做）。若步驟 7 前心跳剛好把 `updatedAt` 刷新，seed 會覆寫它，順序不衝突。

### GREEN commit

§3.1–3.4 的程式與 mock，加 §3.3 spec 一句；handoff（§3.5）可在同一或下一個 commit。

### 指令（frontend/ 內）

```bash
npx vitest run src/providers/__tests__/FirebaseProvider.test.tsx src/providers/__tests__/firebaseProviderCleanup.test.tsx src/auth/__tests__/AuthGate.test.tsx
npx firebase emulators:exec --project demo-easyorder --config ../firebase.json --only auth,firestore "npx playwright test --config playwright.config.ts -g 'A0[3-8]|A12'"
npx firebase emulators:exec --project demo-easyorder --config ../firebase.json --only auth,firestore "npx playwright test --config playwright.config.ts"
npx eslint src/providers src/firebase/activeAccountLease.ts e2e/cloud-production.spec.ts
npx tsc -p tsconfig.app.json --noEmit   # 與 base 的 diagnostics 數比較，不新增
```

雲端容器內 Playwright 需未追蹤的 config 指定 `launchOptions.executablePath`（見專案 memory）。完整 emulator Vitest 依專案規則 `--maxWorkers=1`，由 CI 跑。本變更不新增 command kind、不改 Rules，`npm run test:cloud-backup` 與 Rules 表達式量測**不適用**，PR 中寫明 N/A 與理由。

## 5. 風險與回歸保護

- **安全**：已確認分頁不再於切回時立即清資料。保護來自三層：租約 `onSnapshot` 即時反映持有人／epoch 改變（`setObservedLease` 會遮罩）；60 秒以上背景續約證明；每次業務讀寫由 Rules 檢查當下租約。最壞情況是租約已逾期但隱藏不到 60 秒——不可能，因為逾期需 5 分鐘未續約。
- **Spark 額度**：短切換 0 次讀寫（原本每次約 3 讀 1 寫＋所有頁面監聽重讀）；長切換 2 讀 1 寫。
- **多分頁同 UID**：每個分頁各自判斷，續約交易同 epoch 互不衝突；心跳 Web Lock 不受影響（A08 回歸）。
- **A04／#580**：token 刷新遮罩路徑未動，A04 不變。
- **回退**：單一 PR revert 即回到舊行為，無資料遷移。
- **部署**：只有前端；依專案規則部署時仍與 Rules、indexes 一起上（由 CheerC 本機執行）。

## 6. 尚待 CheerC 實機確認（PR 不宣稱已驗）

真實 Chrome 多分頁切換、筆電休眠超過 5 分鐘後回來（應遮罩並可按「重新確認使用權」）、Chrome 記憶體節省模式丟棄分頁（會整頁重載，屬瀏覽器行為，非本 issue）。

## 7. P2（第二個 PR，接在 P1 合併後）：自己逾期的租約自動重新取得

### 產品決策

CheerC 2026-11-02（cmsg_01NL2RLuU7UMaNjFmadMsJ3uHWwkyjStdt7Rr2TtgKJxhg）：「通常當天用同一台電腦打開，畫面就會一直掛在那邊，在瀏覽器或分頁沒有被關掉之前，我希望都不要被登出」。Google 登入本來就保留，不會被登出；會中斷的是租約：電腦休眠或闔上超過 5 分鐘，心跳停了，租約逾期，回來後要手動按「重新確認使用權」（P1 之後也是）。

### 行為

已確認持有的分頁失去租約時（P1 的背景續約失敗，或 `startLeaseHeartbeat` 的 `onLost`），先讀一次伺服器租約（`getLeaseStatus`）：

- `isKnown && holderUid === 自己 && epoch === 失去時的 epoch`（沒有人接手、也沒有人釋放，只是自己逾期）→ 自動呼叫一次 `apiAcquireLease(db, uid, epoch, email)`（Rules 依伺服器時間判定已逾期才會成功，epoch+1、寫 `takeover` 事件）。成功 → 以新 epoch 發布持有狀態、重新啟動心跳，**不清資料、不遮罩**（失敗才走 P1 的遮罩路徑）。
- 其他情況（別人持有、`holderUid === null` 已釋放、epoch 改變、離線、讀取失敗）→ 照現行遮罩，不自動取得。A04（同 UID 另一頁釋放後不得自動取得）因 `holderUid === null` 而維持通過。
- 每次失去只自動嘗試一次；失敗不重試。

### Rulings

- **Ruling P2-R1：只限「自己的、未被動過的」逾期租約。** — spec §4.2 禁止的是自動搶占別人（「不自動搶占」）與釋放後自動取得；自己逾期的租約沒有人接手時，自動續上不違反單一操作員設計，也符合 CheerC 的需求。spec §4.2 補一句寫明這個例外；`AuthGate.tsx:233` 註解「Lease observations never auto-acquire」同步改為「only an own, untouched, expired lease is re-acquired automatically」。
- **Ruling P2-R2：epoch 改變不清本機畫面資料**，但新 epoch 之後，舊 epoch 的待決命令依既有 recovery 流程處理（`leaseEpoch` 不符會被 Rules 拒絕，pending journal 顯示待確認），不另做機制。實作時要確認畫面上的頁面用的是 `OperatorContext.epoch` 的最新值送命令。
- 不改 Rules（acquire 規則本來就允許自己逾期後重新取得，見 spec §4.2 P13c1「含同一 UID 在自己逾期後重新取得」）。

### 測試（RED 先）

- Vitest（FirebaseProvider.test.tsx）：P1 的 V3 情境改為「續約 lost，`getLeaseStatus` 回自己同 epoch」→ `acquireLease` 以 `('op-1', 1, email)` 呼叫一次、回 acquired epoch 2 → lease `{epoch:2, isHolder:true}`、未清資料；另一案 `getLeaseStatus` 回 `holderUid:null` → 不呼叫 `acquireLease`、遮罩；heartbeat `onLost` 同樣兩案。
- E2E：P1 的 A12 步驟 7 改為預期**不遮罩**、租約變成 `{holderUid: uid, epoch: 2}`、選單仍開；新增一步：另一個帳號在 A 逾期後先取得（`seedAccessLease` 給 operatorB），A 切回 → 遮罩「目前有人使用中」。
- A04、A05、A08 回歸。

## 8. 不在本計畫：畫面資料自動更新（另案）

目前雲端頁面只在開頁、送出命令後讀資料，沒有即時監聽別人寫入的資料（`onSnapshot` 只用在租約、操作員白名單與連線狀態）。刷臉點餐加入第二個寫入來源後需要即時更新，建議另開 issue：監聽 `system/dataHead` 這一份小文件，`seq` 前進時用既有的增量補讀（`refreshSnapshot`）或整頁重載，每次有命令才多 1 次讀取。是否開案由 CheerC 決定。
