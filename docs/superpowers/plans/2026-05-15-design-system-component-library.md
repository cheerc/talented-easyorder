# Design System Component Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Talented EasyOrder 目前散落在 `index.css`、POS 元件、報表、管理頁、調校面板中的重複 UI pattern，收斂成可測、可預覽、可逐步替換的前端設計系統與 component library。

**Architecture:** 先抽出設計 token 與 UI primitive，不先大改視覺風格；Button/Card/Modal/Form/Status/Kbd/Tabs 作為穩定底層，POS、報表、供應商、管理頁只透過 composition 使用它們。保留現有 `data-theme="warm|dark"` 和 `data-fs` 機制，但把 theme/font-scale 控制集中到明確的 theme controller，並用輕量 component workbench 讓 reviewer 能在不跑完整 POS flow 的情況下檢查狀態。

**Tech Stack:** Vite 8, React 19, TypeScript 6, Zustand 5, Vitest 4, Testing Library, CSS custom properties, CSS cascade layers, Ladle or Storybook for component previews, existing `data-theme` and `data-fs` attributes.

---

## Required Reads Completed

- `docs/superpowers/plans/ROADMAP.md`
- `docs/superpowers/plans/2026-05-15-frontend-performance-optimization.md`
- `docs/superpowers/plans/2026-05-15-pwa-offline-first-strategy.md`
- `docs/superpowers/plans/2026-05-15-user-operation-sop-ux-analysis.md`
- `docs/superpowers/specs/2026-05-14-pc-pos-order-flow-spec.md`
- `docs/superpowers/specs/2026-05-14-order-ledger-cash-close-spec.md`
- `docs/superpowers/specs/2026-05-14-menu-vendor-management-spec.md`
- `docs/superpowers/specs/2026-05-14-student-account-management-spec.md`
- `frontend/index.html`
- `frontend/package.json`
- `frontend/src/App.tsx`
- `frontend/src/components/pos-components.tsx`
- `frontend/src/components/screens.tsx`
- `frontend/src/components/tweaks-panel.tsx`
- `frontend/src/index.css`

Requested but unavailable on 2026-05-15:

- `/Users/cheerc/talented-easyorder/docs/superpowers/specs/talented-easyorder-spec.pdf`
- `docs/superpowers/specs/talented-easyorder-spec.pdf`

Replacement source of truth used for this plan: the markdown specs above, current frontend code, and earlier approved plans.

## Official Sources Checked On 2026-05-15

- React component reference: https://react.dev/reference/react/components
- React `<input>` reference: https://react.dev/reference/react-dom/components/input
- Storybook React Vite docs: https://storybook.js.org/docs/get-started/frameworks/react-vite
- Ladle docs: https://ladle.dev/docs/
- MDN CSS custom properties: https://developer.mozilla.org/en-US/docs/Web/CSS/--*
- MDN CSS cascade layers: https://developer.mozilla.org/en-US/docs/Web/CSS/@layer
- WAI-ARIA Authoring Practices Guide: https://www.w3.org/WAI/ARIA/apg/
- MDN `<dialog>` element: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog

## Current UI Inventory

### Current Token Surface

`frontend/src/index.css` already defines the important raw tokens:

| Token | Current Examples | Design-System Role |
|---|---|---|
| Color | `--bg`, `--panel`, `--ink`, `--ink-2`, `--ink-3`, `--line`, `--line-2`, `--accent`, `--accent-ink`, `--accent-soft`, `--warn`, `--warn-soft`, `--pos` | Keep as semantic color tokens; add alias tokens only where components need clearer intent. |
| Radius | `--r`, `--r-lg` | Extend to `--radius-sm/md/lg/xl` aliases while mapping existing values. |
| Shadow | `--shadow` | Keep one default elevation; add component-specific shadows only after measured need. |
| Typography | `--fs`, `.mono`, large inline sizes in POS side card and payment input | Add font size/line height/weight scale and remove inline typography from App. |
| Theme | `[data-theme="dark"]`, `[data-theme="warm"]` | Preserve; centralize theme selection and persistence. |
| Font scale | `body[data-fs="lg"]` | Preserve; centralize as accessibility preference rather than Tweaks-only side effect. |

### Repeated UI Patterns

| Pattern | Current Locations | Issue | Primitive |
|---|---|---|---|
| Primary/secondary/destructive buttons | `.btn-confirm`, `.btn-cancel`, `.ghost-btn`, `.rpt-mini-btn`, `.btn-quick`, `.twk-btn`, tab buttons | Different class names encode same visual states; keyboard/touch states are inconsistent. | `Button` |
| Cards/panels | `.card`, `.adm-card`, `.customer`, `.side-menu`, `.pay-panel`, tweak panels | Padding/radius/elevation vary without a named reason. | `Card` |
| Modal/confirmation | duplicate order warning, `confirm()` in report/admin reset/delete, future sync conflict/closeout blockers | Browser `confirm()` is untestable and cannot show domain context. | `Modal` + `ConfirmDialog` |
| Form fields | `.adm-input`, search input, report edit input, tweak radio, amount input | Label/help/error patterns are not shared. | `Field`, `TextField`, `NumberField`, `RadioGroup` |
| Status chips | `.sync`, `.pill`, balance labels, historical lock, sync status | Color/status semantics are local to each screen. | `StatusBadge` |
| Keyboard hints | `.kbd`, duplicated text for Enter/Esc/F keys | Need consistent sizing and accessibility labels. | `Kbd` |
| Tabs/nav | top nav tabs, report date range, tweak sections | Similar active/inactive behavior with different classes. | `Tabs` or `SegmentedControl` |
| Empty/lock states | `IdleHero`, historical lock, report empty | Copy and layout vary; future offline/security states need same surface. | `EmptyState` |

## Strategic Recommendation

### Use A Thin Design System, Not A Full Redesign

The app is a working POS prototype. The first design-system PRs should not change behavior or visual language; they should make the existing language reusable and testable.

Recommended scope order:

1. Extract token files and component primitives without changing rendered UI.
2. Add a component workbench so visual review can happen without full POS state setup.
3. Replace repeated buttons/cards/forms in small slices.
4. Replace blocking browser dialogs with app-owned `ConfirmDialog` after Button/Card/Form primitives exist.
5. Centralize theme and font-scale controller so future PWA/device setup can document it.

### Component Workbench Choice

| Option | Strengths | Risks | Recommendation |
|---|---|---|---|
| Storybook React Vite | Mature ecosystem, addon docs, interaction testing, visual-regression integrations, familiar to many reviewers. | Heavier install, more config, slower startup, can become a parallel app to maintain. | Use if the team wants long-lived design docs and visual regression in CI. |
| Ladle | Lightweight Vite-native React story runner, quick setup, lower maintenance for a small POS app. **Dev-only dependency** — excluded from production bundle and PWA app-shell precache. | Smaller ecosystem than Storybook; fewer built-in enterprise docs patterns. | **Recommended first choice** for this repo unless reviewer requires Storybook. |
| No workbench | Zero dependency and no extra scripts. | UI primitives are hard to review and regressions stay hidden until full flow testing. | Not recommended. |

Recommended first implementation: `@ladle/react` with `npm run stories`. It is enough for Button/Card/Modal/Form previews and keeps the repo lean. If the team later needs screenshot diffing, accessibility addons, or richer docs, migrate story files to Storybook-compatible patterns.

## Component Specifications

### Button

**Responsibility:** One element for click/tap/keyboard actions with variant, size, loading, disabled, icon, and shortcut display. It must preserve native `<button>` semantics.

**Variants:** `primary`, `secondary`, `ghost`, `danger`, `soft`, `quick`.

**Sizes:** `sm`, `md`, `lg`, `xl`. All sizes enforce a minimum 44x44px touch target (Accessibility plan requirement for iPad/Android). Use typography and padding for visual density — never shrink hit area below 44px. `xl` is for POS payment/confirmation high-risk touch targets (48px+).

**API:**

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft' | 'quick';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconBefore?: ReactNode;
  iconAfter?: ReactNode;
  shortcut?: string;
  fullWidth?: boolean;
  loading?: boolean;
}
```

Rules:

- Default `type="button"` unless caller provides another type.
- If `loading`, set `aria-busy="true"` and keep button disabled.
- Shortcut is visual help; button label still names the action.
- `danger` requires visible text, not icon-only.

### Card

**Responsibility:** Shared panel surface with predictable padding, border, radius, and optional header/footer.

**Variants:** `panel`, `elevated`, `soft`, `danger`, `interactive`.

**API:**

```tsx
import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'section' | 'article' | 'div';
  variant?: 'panel' | 'elevated' | 'soft' | 'danger' | 'interactive';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
}
```

Rules:

- `interactive` cards need keyboard behavior from caller or a semantic child button/link.
- Do not make arbitrary divs clickable without `role`, `tabIndex`, and keyboard activation.

### Modal And ConfirmDialog

**Responsibility:** Replace `window.confirm()` and future conflict/closeout blockers with accessible app-owned dialogs.

**Components:**

- `Modal`: controlled dialog shell.
- `ConfirmDialog`: opinionated destructive/confirmation wrapper.

**API:**

```tsx
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}
```

Rules:

- Escape closes only if `onCancel` is allowed.
- Focus returns to the trigger after close.
- Dangerous actions require a `danger` or `warning` tone.
- Report delete/reset must show transaction/student/date context, not generic text only.

### Form Components

**Responsibility:** Standardize label/help/error/required/disabled layout while keeping form state local to domain screens.

**Components:**

- `Field`
- `TextField`
- `NumberField`
- `SelectField`
- `RadioGroup`
- `SearchField`

**API:**

```tsx
export interface FieldProps {
  id: string;
  label: string;
  helpText?: string;
  errorText?: string;
  required?: boolean;
  children: React.ReactNode;
}

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  id: string;
  label: string;
  helpText?: string;
  errorText?: string;
}
```

Rules:

- Use `aria-describedby` when help or error text exists.
- Number fields for money should parse in domain code; UI component only provides string input and basic numeric attributes.
- Search suggestions remain POS-owned because keyboard navigation is domain behavior.

### Theme Controller

**Responsibility:** Centralize theme and font-scale state so `TweaksPanel`, PWA setup, and future user preferences do not each mutate `document.body` independently.

**Theme state:**

```ts
export type AppTheme = 'warm' | 'dark';
export type FontScale = 'base' | 'lg';

export interface ThemePreference {
  theme: AppTheme;
  fontScale: FontScale;
}
```

Rules:

- `document.body.dataset.theme` and `document.body.dataset.fs` remain the DOM contract.
- Persist only theme/font scale in localStorage; do not mix it with accounting data.
- On invalid stored values, fall back to `{ theme: 'warm', fontScale: 'lg' }` because current `index.html` starts with that visual baseline.

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `frontend/src/styles/tokens.css` | Create | Raw and semantic CSS variables, theme overrides, font-scale vars. |
| `frontend/src/styles/components.css` | Create | Base component classes for UI primitives. |
| `frontend/src/index.css` | Modify | Import token/component CSS and keep domain screen styles until migrated. |
| `frontend/src/components/ui/Button.tsx` | Create | Shared button primitive. |
| `frontend/src/components/ui/Card.tsx` | Create | Shared card/panel primitive. |
| `frontend/src/components/ui/Modal.tsx` | Create | Controlled modal shell. |
| `frontend/src/components/ui/ConfirmDialog.tsx` | Create | Confirmation and destructive action dialog. |
| `frontend/src/components/ui/Field.tsx` | Create | Label/help/error wrapper. |
| `frontend/src/components/ui/TextField.tsx` | Create | Input wrapper over `Field`. |
| `frontend/src/components/ui/NumberField.tsx` | Create | Numeric input wrapper over `Field`. |
| `frontend/src/components/ui/StatusBadge.tsx` | Create | Sync, balance, warning, and neutral badges. |
| `frontend/src/components/ui/Kbd.tsx` | Create | Keyboard shortcut hint. |
| `frontend/src/components/ui/Tabs.tsx` | Create | Top nav/report date range/tweak segment primitive. |
| `frontend/src/components/ui/EmptyState.tsx` | Create | Idle, empty report, historical lock states. |
| `frontend/src/components/ui/index.ts` | Create | Public UI primitive exports. |
| `frontend/src/components/ui/*.test.tsx` | Create | Unit/accessibility smoke tests for primitives. |
| `frontend/src/components/ui/*.stories.tsx` | Create | Ladle or Storybook stories for each primitive. |
| `frontend/src/theme/themeTypes.ts` | Create | `AppTheme`, `FontScale`, and preference types. |
| `frontend/src/theme/themeController.ts` | Create | DOM apply, validation, localStorage persistence. |
| `frontend/src/theme/themeController.test.ts` | Create | Invalid-storage fallback and DOM dataset tests. |
| `frontend/src/components/pos-components.tsx` | Modify | Replace buttons, kbd hints, cards gradually. |
| `frontend/src/components/screens.tsx` | Modify | Replace admin/report/vendor forms, cards, and confirm dialogs gradually. |
| `frontend/src/components/tweaks-panel.tsx` | Modify | Use `themeController` instead of direct body mutation. |
| `frontend/package.json` | Modify | Add `stories` script and chosen preview dependency. |
| `docs/design-system/component-inventory.md` | Create | Human-readable mapping from old classes to new primitives. |

## Implementation Plan

### Task 1: Extract token CSS without changing visuals

**Files:**

- Create: `frontend/src/styles/tokens.css`
- Modify: `frontend/src/index.css`
- Create: `docs/design-system/component-inventory.md`

- [ ] **Step 1: Move root/theme/font-scale variables into `tokens.css`**

```css
:root {
  --bg: #f4f4f2;
  --panel: #ffffff;
  --ink: #15181c;
  --ink-2: #5a5f66;
  --ink-3: #9aa0a8;
  --line: #e6e5e1;
  --line-2: #efeeea;
  --accent: oklch(64% 0.16 152);
  --accent-ink: oklch(38% 0.14 152);
  --accent-soft: oklch(96% 0.04 152);
  --warn: oklch(58% 0.18 32);
  --warn-soft: oklch(96% 0.04 32);
  --pos: oklch(58% 0.14 230);
  --shadow: 0 1px 0 rgba(0, 0, 0, .02), 0 8px 24px -16px rgba(0, 0, 0, .08);
  --r: 10px;
  --r-lg: 16px;
  --fs: 15px;

  --radius-sm: 8px;
  --radius-md: var(--r);
  --radius-lg: var(--r-lg);
  --radius-xl: 24px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
}

[data-theme="dark"] {
  --bg: #0e1014;
  --panel: #161a20;
  --ink: #f4f5f7;
  --ink-2: #a8aeb8;
  --ink-3: #6b7280;
  --line: #262b33;
  --line-2: #1d2229;
  --accent: oklch(72% 0.18 152);
  --accent-ink: oklch(82% 0.16 152);
  --accent-soft: oklch(28% 0.06 152);
  --warn: oklch(70% 0.20 32);
  --warn-soft: oklch(28% 0.06 32);
  --shadow: 0 1px 0 rgba(255, 255, 255, .02), 0 8px 24px -16px rgba(0, 0, 0, .4);
}

[data-theme="warm"] {
  --bg: #f6f1e8;
  --panel: #fffaf1;
  --ink: #1f1a13;
  --ink-2: #6b5f4d;
  --ink-3: #a59478;
  --line: #e9dec9;
  --line-2: #f1e8d3;
  --accent: oklch(62% 0.14 60);
  --accent-ink: oklch(40% 0.12 60);
  --accent-soft: oklch(94% 0.04 60);
  --warn: oklch(56% 0.18 28);
  --warn-soft: oklch(94% 0.05 28);
}

body[data-fs="lg"] {
  --fs: 17px;
}
```

- [ ] **Step 2: Import tokens first in `index.css`**

```css
@import './styles/tokens.css';

* {
  box-sizing: border-box;
}
```

Remove duplicated token declarations from `index.css` after import. Keep all existing component classes in place for now.

- [ ] **Step 3: Document current class mapping**

```md
# Component Inventory

| Old class/pattern | First replacement primitive | Notes |
|---|---|---|
| `.btn-confirm` | `Button variant="primary" size="lg"` | POS confirm and duplicate warning. |
| `.btn-cancel` | `Button variant="secondary" size="lg"` | POS cancel and warning cancel. |
| `.ghost-btn` | `Button variant="ghost" size="md"` | Report toolbar. |
| `.rpt-mini-btn` | `Button variant="ghost" size="sm"` | Report row actions. |
| `.card`, `.adm-card`, `.side-menu` | `Card` | Keep domain layout classes around Card. |
| browser `confirm()` | `ConfirmDialog` | Report delete and reset flows. |
| `.adm-input`, `.rpt-edit-input` | `TextField` / `NumberField` | Preserve domain parsing. |
| `.pill`, `.sync` | `StatusBadge` | Add tone mapping. |
| `.kbd` | `Kbd` | Consistent shortcut display. |
```

- [ ] **Step 4: Run style-neutral checks**

```bash
cd frontend
npm run build
```

Expected: build passes and the rendered app looks visually unchanged.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/styles/tokens.css frontend/src/index.css docs/design-system/component-inventory.md
git commit -m "refactor: extract frontend design tokens"
```

### Task 2: Add UI primitive shell and Button/Card/Kbd

**Files:**

- Create: `frontend/src/styles/components.css`
- Modify: `frontend/src/index.css`
- Create: `frontend/src/components/ui/Button.tsx`
- Create: `frontend/src/components/ui/Card.tsx`
- Create: `frontend/src/components/ui/Kbd.tsx`
- Create: `frontend/src/components/ui/index.ts`
- Create: `frontend/src/components/ui/Button.test.tsx`
- Create: `frontend/src/components/ui/Card.test.tsx`

- [ ] **Step 1: Import component CSS after tokens**

```css
@import './styles/tokens.css';
@import './styles/components.css';
```

- [ ] **Step 2: Add Button implementation**

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft' | 'quick';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconBefore?: ReactNode;
  iconAfter?: ReactNode;
  shortcut?: string;
  fullWidth?: boolean;
  loading?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  iconBefore,
  iconAfter,
  shortcut,
  fullWidth = false,
  loading = false,
  className = '',
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  const classes = [
    'ui-button',
    `ui-button--${variant}`,
    `ui-button--${size}`,
    fullWidth ? 'ui-button--full' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button
      {...props}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading ? 'true' : undefined}
    >
      {iconBefore && <span className="ui-button__icon" aria-hidden="true">{iconBefore}</span>}
      <span className="ui-button__label">{children}</span>
      {shortcut && <span className="ui-button__shortcut">{shortcut}</span>}
      {iconAfter && <span className="ui-button__icon" aria-hidden="true">{iconAfter}</span>}
    </button>
  );
}
```

- [ ] **Step 3: Add Button CSS**

```css
.ui-button {
  align-items: center;
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-weight: 700;
  gap: var(--space-2);
  justify-content: center;
  min-height: 44px; /* a11y: all interactive elements must be ≥44px touch target */
  padding: 0 var(--space-4);
  transition: background .15s ease, border-color .15s ease, color .15s ease, transform .15s ease;
}

.ui-button:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}

.ui-button:disabled {
  cursor: not-allowed;
  opacity: .55;
}

.ui-button--primary { background: var(--ink); border-color: var(--ink); color: var(--bg); }
.ui-button--secondary { background: var(--panel); color: var(--ink); }
.ui-button--ghost { background: transparent; color: var(--ink-2); }
.ui-button--danger { background: var(--warn); border-color: var(--warn); color: white; }
.ui-button--soft { background: var(--line-2); color: var(--ink); }
.ui-button--quick { background: var(--panel); color: var(--ink-2); }
.ui-button--sm { min-height: 44px; padding: 0 var(--space-3); font-size: 13px; } /* a11y: visually compact but touch target stays ≥44px */
.ui-button--lg { min-height: 48px; padding: 0 var(--space-5); }
.ui-button--xl { min-height: 64px; padding: 0 var(--space-6); font-size: 18px; }
.ui-button--full { width: 100%; }
.ui-button__shortcut { border: 1px solid currentColor; border-radius: 6px; font-size: 12px; line-height: 1; opacity: .75; padding: 3px 5px; }
```

- [ ] **Step 4: Add Card and Kbd**

```tsx
import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'section' | 'article' | 'div';
  variant?: 'panel' | 'elevated' | 'soft' | 'danger' | 'interactive';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  title?: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
}

export function Card({ as: Component = 'section', variant = 'panel', padding = 'md', title, description, footer, className = '', children, ...props }: CardProps) {
  const classes = ['ui-card', `ui-card--${variant}`, `ui-card--pad-${padding}`, className].filter(Boolean).join(' ');
  return (
    <Component {...props} className={classes}>
      {(title || description) && (
        <header className="ui-card__header">
          {title && <h2 className="ui-card__title">{title}</h2>}
          {description && <p className="ui-card__description">{description}</p>}
        </header>
      )}
      <div className="ui-card__body">{children}</div>
      {footer && <footer className="ui-card__footer">{footer}</footer>}
    </Component>
  );
}
```

```tsx
import type { HTMLAttributes } from 'react';

export function Kbd({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return <kbd {...props} className={['ui-kbd', className].filter(Boolean).join(' ')} />;
}
```

- [ ] **Step 5: Add primitive smoke tests**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './Button';

it('renders a native button with default type and shortcut text', () => {
  render(<Button shortcut="Enter">確認</Button>);

  const button = screen.getByRole('button', { name: /確認/ });
  expect(button).toHaveAttribute('type', 'button');
  expect(screen.getByText('Enter')).toBeInTheDocument();
});
```

- [ ] **Step 6: Run focused tests**

```bash
cd frontend
npx vitest run src/components/ui/Button.test.tsx src/components/ui/Card.test.tsx
```

Expected: tests pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/styles/components.css frontend/src/index.css frontend/src/components/ui
git commit -m "feat: add frontend ui primitives"
```

### Task 3: Add Field, TextField, NumberField, StatusBadge, Tabs, and EmptyState

**Files:**

- Create: `frontend/src/components/ui/Field.tsx`
- Create: `frontend/src/components/ui/TextField.tsx`
- Create: `frontend/src/components/ui/NumberField.tsx`
- Create: `frontend/src/components/ui/StatusBadge.tsx`
- Create: `frontend/src/components/ui/Tabs.tsx`
- Create: `frontend/src/components/ui/EmptyState.tsx`
- Modify: `frontend/src/components/ui/index.ts`
- Modify: `frontend/src/styles/components.css`
- Create: `frontend/src/components/ui/Field.test.tsx`
- Create: `frontend/src/components/ui/Tabs.test.tsx`

- [ ] **Step 1: Add Field and text inputs**

```tsx
import type { InputHTMLAttributes, ReactNode } from 'react';

export interface FieldProps {
  id: string;
  label: string;
  helpText?: string;
  errorText?: string;
  required?: boolean;
  children: ReactNode;
}

export function Field({ id, label, helpText, errorText, required = false, children }: FieldProps) {
  const helpId = helpText ? `${id}-help` : undefined;
  const errorId = errorText ? `${id}-error` : undefined;

  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={id}>
        {label}{required && <span aria-hidden="true"> *</span>}
      </label>
      {children}
      {helpText && <div id={helpId} className="ui-field__help">{helpText}</div>}
      {errorText && <div id={errorId} className="ui-field__error" role="alert">{errorText}</div>}
    </div>
  );
}

export type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  id: string;
  label: string;
  helpText?: string;
  errorText?: string;
};

export function TextField({ id, label, helpText, errorText, required, className = '', ...props }: TextFieldProps) {
  const describedBy = [helpText ? `${id}-help` : '', errorText ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;

  return (
    <Field id={id} label={label} helpText={helpText} errorText={errorText} required={required}>
      <input
        {...props}
        id={id}
        required={required}
        aria-invalid={errorText ? 'true' : undefined}
        aria-describedby={describedBy}
        className={['ui-input', className].filter(Boolean).join(' ')}
      />
    </Field>
  );
}
```

- [ ] **Step 2: Add NumberField as a string-input wrapper**

```tsx
import type { TextFieldProps } from './TextField';
import { TextField } from './TextField';

export function NumberField(props: TextFieldProps) {
  return <TextField {...props} inputMode="numeric" pattern="[0-9]*" />;
}
```

Domain screens still parse numbers with explicit domain rules. The component does not convert empty string to zero.

- [ ] **Step 3: Add StatusBadge, Tabs, EmptyState**

```tsx
import type { HTMLAttributes, ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function StatusBadge({ tone = 'neutral', className = '', ...props }: StatusBadgeProps) {
  return <span {...props} className={['ui-badge', `ui-badge--${tone}`, className].filter(Boolean).join(' ')} />;
}

export interface TabItem {
  id: string;
  label: ReactNode;
  shortcut?: string;
}

export interface TabsProps {
  label: string;
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
}

export function Tabs({ label, items, value, onChange }: TabsProps) {
  return (
    <div className="ui-tabs" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === value}
          className={'ui-tab ' + (item.id === value ? 'ui-tab--active' : '')}
          onClick={() => onChange(item.id)}
        >
          <span>{item.label}</span>
          {item.shortcut && <span className="ui-tab__shortcut">{item.shortcut}</span>}
        </button>
      ))}
    </div>
  );
}

export interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <section className="ui-empty" aria-live="polite">
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  );
}
```

- [ ] **Step 4: Add accessibility tests**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TextField } from './TextField';

it('links label, help text, and error text to the input', () => {
  render(<TextField id="student-name" label="學生姓名" helpText="可輸入姓名或學號" errorText="必填" />);

  const input = screen.getByLabelText('學生姓名');
  expect(input).toHaveAccessibleDescription('可輸入姓名或學號 必填');
  expect(input).toHaveAttribute('aria-invalid', 'true');
});
```

- [ ] **Step 5: Run tests**

```bash
cd frontend
npx vitest run src/components/ui/Field.test.tsx src/components/ui/Tabs.test.tsx
```

Expected: tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui frontend/src/styles/components.css
git commit -m "feat: add form and status primitives"
```

### Task 4: Add Modal and replace browser confirmations in one slice

**Files:**

- Create: `frontend/src/components/ui/Modal.tsx`
- Create: `frontend/src/components/ui/ConfirmDialog.tsx`
- Create: `frontend/src/components/ui/ConfirmDialog.test.tsx`
- Modify: `frontend/src/components/screens.tsx`
- Modify: `frontend/src/styles/components.css`

- [ ] **Step 1: Add controlled ConfirmDialog**

```tsx
import { useEffect, useId, useRef } from 'react';
import { Button } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = '取消',
  tone = 'default',
  onConfirm,
  onCancel,
  triggerRef,
}: ConfirmDialogProps) {
  const id = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus management: move focus into dialog on open, return on close
  useEffect(() => {
    if (open) {
      cancelRef.current?.focus();
    } else if (triggerRef?.current) {
      triggerRef.current.focus();
    }
  }, [open, triggerRef]);

  // Escape key handler
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  // Focus containment: trap Tab within dialog
  useEffect(() => {
    if (!open || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', handleTab);
    return () => dialog.removeEventListener('keydown', handleTab);
  }, [open]);

  if (!open) return null;

  const titleId = `${id}-title`;
  const descId = `${id}-description`;

  return (
    <div className="ui-modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        ref={dialogRef}
        className="ui-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        <p id={descId}>{description}</p>
        <div className="ui-modal__actions">
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </section>
    </div>
  );
}
```

This version includes full a11y compliance per the Accessibility plan:
- `useId()` for unique aria IDs (no collisions with multiple dialogs)
- `role="alertdialog"` for blocking confirmation/destructive patterns
- Initial focus moves to cancel button on open
- Focus returns to trigger element on close via `triggerRef`
- Escape key closes the dialog
- Focus containment (Tab trap) prevents focus from escaping

Do not leave both `window.confirm()` and `ConfirmDialog` in the same action path.

- [ ] **Step 2: Replace report delete confirmation**

In `ReportScreen`, store pending delete ID:

```tsx
const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
const pendingDeleteRow = tx.find((row) => row.transactionId === pendingDeleteId) ?? null;
```

Replace `deleteRow`:

```tsx
const requestDeleteRow = (event: React.MouseEvent, transactionId: string) => {
  event.stopPropagation();
  setPendingDeleteId(transactionId);
};

const confirmDeleteRow = () => {
  if (!pendingDeleteId) return;
  onDelete(pendingDeleteId);
  setPendingDeleteId(null);
};
```

Render dialog:

```tsx
<ConfirmDialog
  open={Boolean(pendingDeleteRow)}
  tone="danger"
  title="刪除交易紀錄"
  description={pendingDeleteRow ? `確定刪除 ${pendingDeleteRow.studentNameSnapshot} 在 ${pendingDeleteRow.createdAt.slice(11, 19)} 的紀錄？` : ''}
  confirmLabel="刪除"
  onConfirm={confirmDeleteRow}
  onCancel={() => setPendingDeleteId(null)}
/>
```

- [ ] **Step 3: Test delete confirmation path**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

it('uses app confirm dialog before deleting report transaction', () => {
  const onDelete = vi.fn();
  render(<ReportScreen projection={projectionFixture} onUpdate={vi.fn()} onDelete={onDelete} todayMenu={menuFixture} viewDate="2026-05-15" />);

  fireEvent.click(screen.getAllByRole('button', { name: '刪除' })[0]);
  expect(screen.getByRole('dialog', { name: '刪除交易紀錄' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '刪除' }));
  expect(onDelete).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 4: Run tests**

```bash
cd frontend
npx vitest run src/components/ui/ConfirmDialog.test.tsx src/components/screens.test.tsx
```

Expected: dialog and report tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui frontend/src/components/screens.tsx frontend/src/styles/components.css
git commit -m "feat: add confirmation dialog primitive"
```

### Task 5: Centralize theme and font-scale control

**Files:**

- Create: `frontend/src/theme/themeTypes.ts`
- Create: `frontend/src/theme/themeController.ts`
- Create: `frontend/src/theme/themeController.test.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/tweaks-panel.tsx`

- [ ] **Step 1: Add theme types and validation**

```ts
export type AppTheme = 'warm' | 'dark';
export type FontScale = 'base' | 'lg';

export interface ThemePreference {
  theme: AppTheme;
  fontScale: FontScale;
}

export const defaultThemePreference: ThemePreference = {
  theme: 'warm',
  fontScale: 'lg',
};

export function normalizeThemePreference(value: unknown): ThemePreference {
  if (!value || typeof value !== 'object') return defaultThemePreference;
  const record = value as Record<string, unknown>;
  return {
    theme: record.theme === 'dark' || record.theme === 'warm' ? record.theme : defaultThemePreference.theme,
    fontScale: record.fontScale === 'base' || record.fontScale === 'lg' ? record.fontScale : defaultThemePreference.fontScale,
  };
}
```

- [ ] **Step 2: Add DOM/localStorage controller**

```ts
import { defaultThemePreference, normalizeThemePreference, type ThemePreference } from './themeTypes';

const storageKey = 'easyorder-theme-preference';

export function applyThemePreference(preference: ThemePreference, target: HTMLElement = document.body) {
  target.dataset.theme = preference.theme;
  target.dataset.fs = preference.fontScale;
}

export function loadThemePreference(storage: Storage = localStorage): ThemePreference {
  const raw = storage.getItem(storageKey);
  if (!raw) return defaultThemePreference;

  try {
    return normalizeThemePreference(JSON.parse(raw));
  } catch {
    return defaultThemePreference;
  }
}

export function saveThemePreference(preference: ThemePreference, storage: Storage = localStorage) {
  storage.setItem(storageKey, JSON.stringify(preference));
}
```

- [ ] **Step 3: Add invalid-storage tests**

```ts
import { describe, expect, it } from 'vitest';
import { applyThemePreference, loadThemePreference, saveThemePreference } from './themeController';

class MapStorage implements Storage {
  private readonly data = new Map<string, string>();
  length = 0;

  constructor(entries: Array<[string, string]> = []) {
    entries.forEach(([key, value]) => this.setItem(key, value));
  }

  clear() {
    this.data.clear();
    this.length = 0;
  }

  getItem(key: string) {
    return this.data.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.data.delete(key);
    this.length = this.data.size;
  }

  setItem(key: string, value: string) {
    this.data.set(key, value);
    this.length = this.data.size;
  }
}

it('falls back for invalid stored theme preference', () => {
  const storage = new MapStorage([['easyorder-theme-preference', '{bad json']]);

  expect(loadThemePreference(storage)).toEqual({ theme: 'warm', fontScale: 'lg' });
});

it('saves and loads a valid theme preference', () => {
  const storage = new MapStorage();

  saveThemePreference({ theme: 'dark', fontScale: 'base' }, storage);

  expect(loadThemePreference(storage)).toEqual({ theme: 'dark', fontScale: 'base' });
});

it('applies theme preference to a target element', () => {
  const target = document.createElement('div');

  applyThemePreference({ theme: 'dark', fontScale: 'base' }, target);

  expect(target.dataset.theme).toBe('dark');
  expect(target.dataset.fs).toBe('base');
});
```

Use the local `MapStorage` above when the existing test setup does not expose a `Storage`-compatible object.

- [ ] **Step 4: Wire App and TweaksPanel through controller**

`App.tsx` should load preference once and pass values/actions to `TweaksPanel`. `TweaksPanel` should no longer call `document.body.setAttribute` directly.

- [ ] **Step 5: Run tests and build**

```bash
cd frontend
npx vitest run src/theme/themeController.test.ts
npm run build
```

Expected: theme controller tests and build pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/theme frontend/src/App.tsx frontend/src/components/tweaks-panel.tsx
git commit -m "refactor: centralize frontend theme preferences"
```

### Task 6: Add component workbench

**Files:**

- Modify: `frontend/package.json`
- Modify: `package-lock.json`
- Create: `frontend/src/components/ui/Button.stories.tsx`
- Create: `frontend/src/components/ui/Card.stories.tsx`
- Create: `frontend/src/components/ui/ConfirmDialog.stories.tsx`
- Create: `frontend/src/components/ui/Form.stories.tsx`
- Create: `docs/design-system/workbench.md`

- [ ] **Step 1: Choose workbench dependency**

Recommended first choice:

```bash
cd frontend
npm install -D @ladle/react
npm pkg set scripts.stories="ladle serve"
npm pkg set scripts.stories:build="ladle build"
```

If the reviewer explicitly selects Storybook instead:

```bash
cd frontend
npx storybook@latest init --builder vite
npm pkg set scripts.stories="storybook dev -p 6006"
npm pkg set scripts.stories:build="storybook build"
```

Do not install both in the same PR.

- [ ] **Step 2: Add Button stories**

```tsx
import { Button } from './Button';

export const Variants = () => (
  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
    <Button variant="primary" shortcut="Enter">確認收款</Button>
    <Button variant="secondary" shortcut="Esc">取消</Button>
    <Button variant="ghost">列印</Button>
    <Button variant="danger">刪除交易</Button>
    <Button variant="quick">$85</Button>
  </div>
);

export const Sizes = () => (
  <div style={{ display: 'grid', gap: 12, maxWidth: 420 }}>
    <Button size="sm">小型</Button>
    <Button size="md">一般</Button>
    <Button size="lg">大型</Button>
    <Button size="xl" fullWidth>POS 主要操作</Button>
  </div>
);
```

- [ ] **Step 3: Add theme preview wrapper**

Workbench should show both warm and dark themes without relying on the production `body` state:

```tsx
export function ThemeFrame({ theme, children }: { theme: 'warm' | 'dark'; children: React.ReactNode }) {
  return (
    <div data-theme={theme} style={{ background: 'var(--bg)', color: 'var(--ink)', padding: 24 }}>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Add workbench docs**

````md
# Design System Workbench

Run:

```bash
cd frontend
npm run stories
```

Review rules:

- Check warm and dark themes for every primitive.
- Check keyboard focus ring on Button, Tabs, and ConfirmDialog actions.
- Check touch target size for POS-sized buttons.
- Do not approve primitive changes based only on the full app; inspect the story in isolation.
````

- [ ] **Step 5: Build stories**

```bash
cd frontend
npm run stories:build
```

Expected: workbench static build passes.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json package-lock.json frontend/src/components/ui/*.stories.tsx docs/design-system/workbench.md
git commit -m "docs: add frontend component workbench"
```

### Task 7: Migrate current screens in safe slices

**Files:**

- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/pos-components.tsx`
- Modify: `frontend/src/components/screens.tsx`
- Modify: `frontend/src/components/tweaks-panel.tsx`
- Modify: `frontend/src/index.css`
- Modify: `docs/design-system/component-inventory.md`

- [ ] **Step 1: Replace duplicate-order warning buttons and kbd hints**

```tsx
<ConfirmBanner>
  <Button variant="secondary" size="lg" shortcut="Esc" onClick={() => setConfirmDup(false)}>
    否
  </Button>
  <Button variant="primary" size="lg" shortcut="Enter" onClick={doConfirm}>
    是，再訂一份
  </Button>
</ConfirmBanner>
```

- [ ] **Step 2: Replace report toolbar buttons**

```tsx
<div className="rpt-actions">
  <Button variant="ghost">列印</Button>
  <Button variant="ghost">匯出 CSV</Button>
  <Button variant="primary">推送至雲端</Button>
</div>
```

- [ ] **Step 3: Replace admin card and inputs**

```tsx
<Card title="今日便當設定" className="adm-card">
  <TextField id="menu-name" label="便當名稱" value={name} onChange={(event) => setName(event.target.value)} />
  <NumberField id="menu-price" label="單價（元）" value={String(price)} onChange={(event) => setPrice(Number(event.target.value || 0))} />
  <TextField id="menu-vendor" label="供應商" value={vendor} onChange={(event) => setVendor(event.target.value)} />
  <Button variant="primary" onClick={save}>儲存便當設定</Button>
</Card>
```

- [ ] **Step 4: Remove migrated legacy CSS only after references disappear**

```bash
cd frontend
rg -n "btn-confirm|btn-cancel|ghost-btn|adm-input|rpt-mini-btn|kbd" src
```

Expected: classes removed in this slice have no references. Delete only unused CSS blocks; leave still-used legacy classes in place.

- [ ] **Step 5: Run full frontend gate**

```bash
cd frontend
npx tsc --noEmit
npm run lint
npx vitest run
npm run build
```

Expected: all commands pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components frontend/src/index.css docs/design-system/component-inventory.md
git commit -m "refactor: migrate screens to ui primitives"
```

## DISCUSS WITH USER

1. **Workbench choice:** approve Ladle as the first component workbench, or require Storybook despite the larger dependency/config footprint.
2. **Visual freeze:** confirm the first design-system implementation should preserve current warm/dark look exactly, with no redesign beyond component consistency.
3. **Dialog scope:** approve replacing browser `confirm()` with app-owned `ConfirmDialog` in the first UI primitive pass.
4. **Theme persistence:** confirm `easyorder-theme-preference` should live outside `pos-storage` so UI preferences never mix with accounting data.
5. **Token naming:** approve keeping existing semantic tokens (`--bg`, `--panel`, `--ink`) and adding aliases, rather than renaming every CSS variable at once.
6. **Migration sequence:** confirm POS confirmation controls and report toolbar are the first migration targets before lower-risk admin/vendor forms.

## Acceptance Criteria

- `index.css` no longer owns raw token definitions directly; token CSS is isolated and imported first.
- Button/Card/Form/Modal/Status/Kbd/Tabs primitives exist with TypeScript props and focused tests.
- Browser `confirm()` is removed from at least one real destructive path and replaced by app-owned confirmation UI.
- Theme and font-scale state are centralized and validated before applying to `document.body`.
- Component workbench can render primitives in warm and dark themes.
- Existing POS keyboard/touch workflows remain intact after the first migration slice.
- Legacy CSS is removed only after reference checks prove it is unused.
- Full frontend gate passes before a design-system PR is considered ready.

## Non-Goals

- Do not redesign the visual identity in the first design-system pass.
- Do not split every screen CSS file in the same PR as primitives; keep migration incremental.
- Do not move accounting/domain state into UI primitives.
- Do not introduce a third theme until warm/dark and font-scale are centralized.
- Do not make component workbench deployment public by default; keep it a developer/reviewer tool unless a later deployment plan approves publishing it.
