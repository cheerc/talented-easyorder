# 無障礙與 iPad 觸控體驗實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 Talented EasyOrder 的午餐櫃台 PWA 能在 iPad、鍵盤、螢幕閱讀器、色弱情境與高齡操作者手上穩定完成訂餐、儲值、取消與日結流程。

**Architecture:** 以 WCAG 2.1 AA 作為最低合規基準，並針對 iPad 午餐尖峰情境採用更嚴格的 44px 觸控目標、明確焦點、可朗讀狀態與非純色彩提示。先建立可測的 a11y 基礎元件與 CSS tokens，再逐步改造 POS、報表、管理、供應商與未來 iPad handoff 畫面。

**Tech Stack:** Vite 8, React 19, TypeScript 6, Zustand 5, Vitest 4, React Testing Library, `@testing-library/jest-dom`, CSS custom properties, WAI-ARIA patterns, WCAG 2.1 AA, iPadOS Safari / VoiceOver manual test matrix.

---

## 已讀資料與現況

- 派發指定的 `/Users/cheerc/talented-easyorder/docs/superpowers/specs/talented-easyorder-spec.pdf` 目前不存在。
- 已改讀實際存在的 `docs/iPad人臉辨識訂餐系統設計方案_V3.pdf`。
- 已讀 `docs/superpowers/specs/2026-05-14-pc-pos-order-flow-spec.md`。
- 已讀 `docs/superpowers/specs/2026-05-14-google-sheets-sync-offline-spec.md`。
- 已讀 `docs/superpowers/specs/2026-05-14-ipad-face-auth-handoff-spec.md`。
- 已讀 `docs/superpowers/plans/2026-05-15-pwa-offline-first-strategy.md`。
- 已檢查 `frontend/src/App.tsx`、`frontend/src/components/pos-components.tsx`、`frontend/src/components/screens.tsx`、`frontend/src/index.css`、`frontend/package.json`。

## 官方參考來源

- W3C WCAG 2.1: https://www.w3.org/TR/WCAG21/
- W3C WCAG 2.1 Target Size 2.5.5: https://www.w3.org/WAI/WCAG21/Understanding/target-size.html
- W3C WCAG 2.1 Contrast Minimum 1.4.3: https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum
- W3C WCAG 2.1 Focus Visible 2.4.7: https://www.w3.org/WAI/WCAG21/Understanding/focus-visible

注意：WCAG 2.1 的 `2.5.5 Target Size` 是 AAA，不是 AA；本系統仍應採用 44px 目標，因為 iPad 觸控、高齡操作者、午餐尖峰與不可輕易復原的交易動作都需要比 AA 更保守的觸控規格。

## 目前主要缺口

1. `TopBar` tabs、日期 input、報表 mini buttons、Tweaks controls 等控制項高度可能低於 44px。
2. `SearchBox` suggestions 使用 `div`，缺少 `listbox` / `option` / `aria-activedescendant`，VoiceOver 不知道目前選到哪一位學生。
3. `ActionBar` 有自訂 `focusZone`，但 DOM focus 沒有同步到按鈕；鍵盤操作者與螢幕閱讀器會看到不同狀態。
4. 日期 input 使用 inline style `outline: 'none'`，缺少可見焦點。
5. `.search-input`、`.pay-input-main`、`.rpt-edit-input`、`.adm-input` 都移除 outline，只靠局部 border 或 container focus；需要全域一致的 `:focus-visible`。
6. 成功 banner、重複訂餐 warning、sync 狀態、離線/排隊/失敗等狀態沒有 `aria-live` 或 `role="status"`。
7. 報表列與備份卡有 clickable `div`，缺少按鈕語意與鍵盤觸發。
8. 目前字體大小只有 `md` / `lg` tweak，仍大量使用 px，沒有跟系統動態字體或高齡模式形成清楚策略。
9. 色彩語意高度依賴綠、橘、藍、紅；欠款、同步、危險、成功需要文字、圖示、形狀一起呈現。
10. iPad privacy 需求尚未落到 a11y：iPad handoff 畫面不可把餘額/欠款朗讀給學生。

## A11y 基準

### WCAG 2.1 AA 必須覆蓋

- `1.3.1 Info and Relationships`: 表格、群組、label、錯誤訊息需有語意。
- `1.3.4 Orientation`: 不鎖單一方向；PC 寬屏與 iPad 直橫向都可用。
- `1.4.1 Use of Color`: 狀態不能只靠顏色。
- `1.4.3 Contrast Minimum`: 一般文字至少 4.5:1，大字至少 3:1。
- `1.4.4 Resize Text`: 放大到 200% 不丟功能。
- `1.4.10 Reflow`: 小視窗或 iPad split view 不應橫向爆版。
- `1.4.11 Non-text Contrast`: focus、icon、button border、狀態 pill 至少 3:1。
- `2.1.1 Keyboard`: 所有功能可鍵盤操作。
- `2.1.2 No Keyboard Trap`: dialog/banner/搜尋建議不可困住焦點。
- `2.1.4 Character Key Shortcuts`: Q/W/E/F1-F4 快捷鍵需可停用、重映射或只在安全 context 觸發。
- `2.4.3 Focus Order`: 搜尋、建議、交易模式、金額、確認、取消順序符合畫面與任務。
- `2.4.7 Focus Visible`: 每個可操作元素都有可見焦點。
- `2.5.1 Pointer Gestures`: 不要求複雜手勢才能完成核心交易。
- `2.5.2 Pointer Cancellation`: 危險/交易動作需避免 down-event 即提交。
- `2.5.3 Label in Name`: 可見文字與 accessible name 一致。
- `4.1.2 Name, Role, Value`: 自訂控制項需有正確 role/name/state。
- `4.1.3 Status Messages`: 成功、錯誤、同步、排隊狀態需可被 assistive tech 得知。

### EasyOrder 額外標準

- 所有 primary/secondary/destructive touch targets 至少 `44px x 44px`。
- 金額、確認、取消、日結、刪除、重置等高風險目標建議 `48px x 48px` 以上。
- 高齡模式最低 body 字級 `18px`，核心金額與學生姓名不得低於 `22px`。
- iPad 學生面向畫面只能朗讀辨識成功、姓名與請到櫃台，不朗讀餘額或欠款。
- 完成交易後，焦點回到搜尋欄前，上一位學生的財務資訊須消失。

## 建議檔案結構

- Create: `frontend/src/accessibility/a11yConstants.ts` - 觸控尺寸、contrast token 名稱、狀態文字、ARIA label helper。
- Create: `frontend/src/accessibility/useAnnouncer.ts` - 集中管理 `aria-live` 訊息。
- Create: `frontend/src/accessibility/a11yAudit.ts` - 靜態檢查 helper，例如觸控尺寸與 mode name 對照。
- Create: `frontend/src/accessibility/__tests__/a11yAudit.test.ts`。
- Modify: `frontend/src/index.css` - 全域 focus-visible、動態字體 tokens、touch target utilities、高對比配色。
- Modify: `frontend/src/components/pos-components.tsx` - `TopBar`、`SearchBox`、`ActionBar`、`ConfirmBanner`、`RecentStrip` 語意化。
- Modify: `frontend/src/components/screens.tsx` - 報表表格、inline edit、admin form、vendors、backup cards 的 button/form 語意。
- Modify: `frontend/src/App.tsx` - 焦點管理、快捷鍵 context、成功/錯誤 announcement。
- Modify: `frontend/src/test/setup.ts` - 加入 resize/focus 測試需要的 mock。
- Test: `frontend/src/components/__tests__/pos-a11y.test.tsx`。
- Test: `frontend/src/components/__tests__/screens-a11y.test.tsx`。
- Docs: `docs/qa/accessibility-checklist.md`。

## Task 1: 建立 A11y 常數與檢查基準

**Files:**
- Create: `frontend/src/accessibility/a11yConstants.ts`
- Create: `frontend/src/accessibility/a11yAudit.ts`
- Create: `frontend/src/accessibility/__tests__/a11yAudit.test.ts`

- [ ] **Step 1: 寫常數與 accessible label 對照測試**

```ts
import { describe, expect, it } from 'vitest';
import { MIN_TOUCH_TARGET_PX, actionModeLabels, getActionModeLabel } from '../a11yConstants';

describe('a11y constants', () => {
  it('uses 44px as the minimum touch target', () => {
    expect(MIN_TOUCH_TARGET_PX).toBe(44);
  });

  it('has accessible names for all POS modes', () => {
    expect(actionModeLabels).toEqual({
      order: '訂便當',
      topup: '純繳費或儲值',
      cancel: '取消當日訂餐',
    });
    expect(getActionModeLabel('order')).toBe('訂便當');
  });
});
```

- [ ] **Step 2: 新增常數實作**

```ts
export const MIN_TOUCH_TARGET_PX = 44;
export const HIGH_RISK_TOUCH_TARGET_PX = 48;

export const actionModeLabels = {
  order: '訂便當',
  topup: '純繳費或儲值',
  cancel: '取消當日訂餐',
} as const;

export type AccessibleActionMode = keyof typeof actionModeLabels;

export function getActionModeLabel(mode: AccessibleActionMode): string {
  return actionModeLabels[mode];
}
```

- [ ] **Step 3: 新增觸控尺寸 helper**

```ts
import { MIN_TOUCH_TARGET_PX } from './a11yConstants';

export interface TargetSizeInput {
  width: number;
  height: number;
}

export function meetsMinimumTouchTarget(target: TargetSizeInput): boolean {
  return target.width >= MIN_TOUCH_TARGET_PX && target.height >= MIN_TOUCH_TARGET_PX;
}
```

- [ ] **Step 4: 跑測試**

Run: `cd frontend && npx vitest run src/accessibility/__tests__/a11yAudit.test.ts`

Expected: tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/accessibility
git commit -m "test: add accessibility baseline constants"
```

## Task 2: CSS 觸控目標與焦點樣式

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1: 新增全域 focus-visible 與 touch utilities**

```css
:root {
  --target-min: 44px;
  --target-risk: 48px;
  --focus-ring: 0 0 0 3px color-mix(in oklch, var(--accent) 65%, white);
  --focus-outline: 2px solid var(--accent-ink);
}

button,
input,
select,
textarea,
[role="button"],
[role="radio"],
[role="tab"] {
  min-height: var(--target-min);
}

button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
[tabindex]:focus-visible,
[role="button"]:focus-visible,
[role="radio"]:focus-visible,
[role="tab"]:focus-visible {
  outline: var(--focus-outline);
  outline-offset: 3px;
  box-shadow: var(--focus-ring);
}

.touch-risk {
  min-height: var(--target-risk);
  min-width: var(--target-risk);
}
```

- [ ] **Step 2: 修正小尺寸控制項**

將 `.tab`、`.rpt-mini-btn`、`.ghost-btn`、`.btn-quick`、`.adm-input`、`.rpt-edit-input`、`.twk-*` 中實際可操作項目的高度調整到至少 44px；純視覺 `.kbd` 不必達 44px，因為它不是互動目標。

- [ ] **Step 3: 移除破壞焦點的 inline style**

`TopBar` 日期 input 目前 inline 設定 `outline: 'none'`。改成 class，例如 `.date-input`，並讓它吃全域 focus-visible。

- [ ] **Step 4: 跑樣式與型別檢查**

Run: `cd frontend && npx tsc --noEmit && npm run lint`

Expected: both commands pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/index.css frontend/src/components/pos-components.tsx
git commit -m "fix: add accessible focus and touch targets"
```

## Task 3: POS 搜尋與 ActionBar 語意化

**Files:**
- Modify: `frontend/src/components/pos-components.tsx`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/components/__tests__/pos-a11y.test.tsx`

- [ ] **Step 1: 寫 SearchBox ARIA 測試**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SearchBox } from '../pos-components';

const students = [
  {
    studentId: '015',
    displayName: '周映彤',
    status: 'active',
    currentBalance: 100,
    aliases: [],
    faceEnrollmentStatus: 'none',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    revision: 1,
  },
];

describe('SearchBox accessibility', () => {
  it('exposes combobox and active option semantics', () => {
    render(
      <SearchBox
        value="周"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onEsc={vi.fn()}
        suggestions={students}
        activeIdx={0}
        onPick={vi.fn()}
        onHover={vi.fn()}
        focusKey={0}
        disabled={false}
      />,
    );

    expect(screen.getByRole('combobox', { name: '輸入編號或姓名' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox', { name: '搜尋結果' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /015 周映彤/ })).toHaveAttribute('aria-selected', 'true');
  });
});
```

- [ ] **Step 2: 改 SearchBox 語意**

搜尋 input 使用 `role="combobox"`、`aria-autocomplete="list"`、`aria-controls`、`aria-activedescendant`；建議容器使用 `role="listbox"`；每列使用 `role="option"`、`id`、`aria-selected`。

- [ ] **Step 3: 改 ActionBar mode buttons**

模式按鈕使用 `aria-pressed` 或 `role="radio"` + `radiogroup`。若保留 Q/W/E 快捷鍵，accessible name 必須包含可見 label，不要只朗讀快捷鍵。

- [ ] **Step 4: 同步 DOM focus**

`focusZone` 改變時，對應 DOM 元素應取得 focus，或移除自訂 focus model 改用原生 tab/focus order。不要只改 CSS class。

- [ ] **Step 5: 跑測試**

Run: `cd frontend && npx vitest run src/components/__tests__/pos-a11y.test.tsx`

Expected: tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/pos-components.tsx frontend/src/components/__tests__/pos-a11y.test.tsx
git commit -m "fix: improve POS keyboard and screen reader semantics"
```

## Task 4: Status Messages 與交易完成 announcement

**Files:**
- Create: `frontend/src/accessibility/useAnnouncer.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/pos-components.tsx`
- Test: `frontend/src/components/__tests__/pos-a11y.test.tsx`

- [ ] **Step 1: 寫 announcement hook**

```ts
import { useCallback, useState } from 'react';

export function useAnnouncer() {
  const [message, setMessage] = useState('');
  const announce = useCallback((nextMessage: string) => {
    setMessage('');
    window.setTimeout(() => setMessage(nextMessage), 0);
  }, []);
  return { message, announce };
}
```

- [ ] **Step 2: 加入 live region**

在 `App.tsx` 根層加入：

```tsx
<div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
  {a11yMessage}
</div>
```

`.sr-only` 放在 `frontend/src/index.css`，使用視覺隱藏但可被螢幕閱讀器朗讀的標準樣式。

- [ ] **Step 3: 交易與同步狀態 announcement**

成功交易 announce 範例：`已完成，周映彤，訂便當，交易後餘額 10 元`。離線/排隊/同步失敗 announce 必須說明 operator 下一步，不可只說錯誤碼。

- [ ] **Step 4: 重複訂餐 warning 語意**

重複訂餐 warning 使用 `role="alertdialog"` 或等效 blocking dialog pattern，焦點移到 warning，Esc 關閉後回到確認按鈕。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/pos-components.tsx frontend/src/accessibility/useAnnouncer.ts frontend/src/index.css
git commit -m "fix: announce POS status changes accessibly"
```

## Task 5: 報表與管理畫面語意化

**Files:**
- Modify: `frontend/src/components/screens.tsx`
- Test: `frontend/src/components/__tests__/screens-a11y.test.tsx`

- [ ] **Step 1: 報表列改成可操作按鈕或 table 結構**

目前可展開 row 是 clickable `div`。改成明確 button，例如：

```tsx
<button
  type="button"
  className="rpt-row-toggle"
  aria-expanded={isExpanded}
  aria-controls={`student-${g.sid}-transactions`}
  onClick={() => toggleExpand(g.sid)}
>
  <span className="mono">{g.sid}</span>
  <span>{g.name}</span>
  <span>{g.txs.length} 筆紀錄</span>
</button>
```

- [ ] **Step 2: 補齊 form labels**

Admin 與 Vendor 的 input/select 必須有 programmatic label；不能只靠 placeholder。

- [ ] **Step 3: Dead buttons 先 honest disabled**

`列印`、`匯出 CSV`、`推送至雲端` 若尚未實作，使用 `disabled` 與可朗讀原因，例如 `aria-describedby="export-disabled-reason"`。

- [ ] **Step 4: 危險操作使用明確 dialog**

重置、刪除、覆蓋匯入等操作不可只用 `window.confirm` 當最終 UX；建立後續共用 confirm dialog 時需支援 focus trap、Esc、取消焦點回復與原因文字。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/screens.tsx frontend/src/components/__tests__/screens-a11y.test.tsx
git commit -m "fix: improve report and admin accessibility"
```

## Task 6: 動態字體與高齡操作者模式

**Files:**
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/tweaks-panel.tsx`

- [ ] **Step 1: 建立字級階層**

使用 CSS variables 管理字級，不要在元件內散落固定 px：

```css
:root {
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-md: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.375rem;
  --text-amount: 2rem;
}

body[data-fs="senior"] {
  --fs: 18px;
  --text-xs: 0.875rem;
  --text-sm: 1rem;
  --text-md: 1.125rem;
  --text-lg: 1.25rem;
  --text-xl: 1.5rem;
  --text-amount: 2.25rem;
}
```

- [ ] **Step 2: 加入 senior 選項**

Tweaks 或正式設定加入 `senior`，label 用 `高齡友善`。若 Tweaks 是 demo-only，正式設定應落在 Admin 或 operator preference，不放在會干擾午餐流程的位置。

- [ ] **Step 3: 驗證 200% zoom**

Manual: iPad Safari 與 desktop browser 200% zoom 下，POS 仍可搜尋、選學生、輸入金額、確認、取消，不遮擋完成 banner。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/index.css frontend/src/App.tsx frontend/src/components/tweaks-panel.tsx
git commit -m "feat: add senior-friendly typography mode"
```

## Task 7: 色盲友善與 contrast audit

**Files:**
- Modify: `frontend/src/index.css`
- Create: `docs/qa/accessibility-checklist.md`

- [ ] **Step 1: 定義狀態不只靠顏色**

每個狀態都要有文字與形狀：

- Success: `已完成` + check icon + green tone.
- Warning: `欠款` / `重複訂餐` + warning icon + amber tone.
- Error: `失敗` + error icon + red tone.
- Queued/offline: `排隊中` / `離線` + queue count + neutral/warn tone.
- Conflict: `需處理` + badge + action button.

- [ ] **Step 2: 建立 contrast checklist**

`docs/qa/accessibility-checklist.md` 需列出要檢查的 token pairs：`--ink` on `--panel`、`--ink-2` on `--panel`、`--warn` on `--warn-soft`、`--accent-ink` on `--accent-soft`、button focus ring on panel/bg、dark/warm/light themes。

- [ ] **Step 3: 修正不合格 pair**

如果任一文字 pair 低於 4.5:1，改 token。大字與粗體只能在符合 WCAG large text 條件時使用 3:1，不可把所有金額都當例外。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/index.css docs/qa/accessibility-checklist.md
git commit -m "fix: document and improve accessible color states"
```

## Task 8: VoiceOver 與 iPad 手動驗收

**Files:**
- Create: `docs/qa/ipad-voiceover-test-plan.md`
- Create: `docs/qa/ipad-touch-test-plan.md`

- [ ] **Step 1: 寫 VoiceOver 測試腳本**

腳本必須覆蓋：

1. 開啟 POS，VoiceOver 朗讀品牌、日期、sync 狀態、搜尋欄。
2. 搜尋學生，逐筆朗讀搜尋結果與目前選取項。
3. 選擇學生後朗讀姓名、編號、目前餘額、交易模式、金額欄。
4. 訂便當、純繳費、取消訂餐都可不看畫面完成。
5. 重複訂餐 warning 被朗讀，且焦點停在可選的否/是。
6. 完成 banner 被朗讀，dismiss 後回到下一位搜尋。
7. iPad handoff 畫面只朗讀辨識成功與姓名，不朗讀餘額/欠款。

- [ ] **Step 2: 寫 touch 測試腳本**

腳本必須覆蓋：

1. iPad 橫向與直向。
2. 44px touch target 檢查。
3. 午餐尖峰連續 20 筆訂單。
4. 手指誤觸取消/確認的防護。
5. 系統字體放大。
6. iPad split view 或較窄 viewport。

- [ ] **Step 3: Commit**

```bash
git add docs/qa/ipad-voiceover-test-plan.md docs/qa/ipad-touch-test-plan.md
git commit -m "docs: add iPad accessibility QA scripts"
```

## 驗證指令

每個實作 PR 完成前至少執行：

```bash
cd frontend
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

若新增 component a11y tests，額外執行：

```bash
cd frontend
npx vitest run src/components/__tests__/pos-a11y.test.tsx src/components/__tests__/screens-a11y.test.tsx
```

人工驗收不可省略，因為 VoiceOver、iPad touch、200% zoom、色弱模擬與午餐尖峰操作無法只靠 jsdom 證明。

## DISCUSS WITH USER

1. 高齡友善模式要成為預設，還是保留一般/高齡兩種可切換模式？
2. 學生搜尋結果是否可以朗讀餘額？若櫃台環境會被學生聽到，應改成只朗讀姓名/編號，餘額用 operator-only 視覺區塊。
3. Q/W/E/F1-F4 快捷鍵是否允許停用？WCAG 2.1 的 character key shortcut 要求需要明確處理。
4. iPad handoff 畫面是否學生會直接看到/聽到？若是，該畫面必須採用更嚴格 privacy copy。
5. 是否接受引入 `vitest-axe` 或 `axe-core` 作為自動化輔助？它不能取代人工驗收，但能抓部分語意/contrast 問題。

## Definition Of Done

- 所有核心互動目標至少 44px，高風險動作至少 48px。
- 所有可操作元素有可見 `:focus-visible`。
- 搜尋、模式、報表展開、dialog、完成 banner 都有正確 name/role/value。
- 成功、錯誤、sync、queue、conflict 狀態可被螢幕閱讀器得知。
- 文字與非文字 contrast 符合 WCAG 2.1 AA；44px target 作為 EasyOrder 額外標準。
- 200% zoom、iPad 直橫向、VoiceOver 與午餐尖峰手動腳本通過。
- iPad 學生面向流程不暴露餘額、欠款或付款資訊。
