# NumericInput IME Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix issue #403 — `<input type="number">` silently converts IME (注音) characters to empty string, bypassing all IME detection logic. Change to `type="text" inputMode="numeric"` so the existing guards work correctly.

**Architecture:** Single-component fix in `NumericInput.tsx` (all 6+ consumer sites auto-inherit). `useKeyboardShortcuts.ts` must be updated to recognize `data-numeric-input` attribute instead of relying on `inputType === 'number'`. Three test files need `spinbutton` → `textbox` role migration.

**Tech Stack:** React 18, TypeScript, Vitest, @testing-library/react

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `frontend/src/components/ui/NumericInput.tsx` | MODIFY | Core fix: `type="number"` → `type="text" inputMode="numeric" pattern="[0-9]*"`, add `data-numeric-input` attr, block letter keys in `handleKeyDown` |
| `frontend/src/hooks/useKeyboardShortcuts.ts` | MODIFY | Detect `data-numeric-input` attr instead of `inputType === 'number'` for Q/W/E/A shortcut passthrough |
| `frontend/src/components/ui/__tests__/NumericInput.test.tsx` | MODIFY | Update tests: `spinbutton` → `textbox`, add letter-key blocking tests, fix IME detection test |
| `frontend/src/components/ui/__tests__/NumberField.test.tsx` | MODIFY | Update `spinbutton` → `textbox` |
| `frontend/src/hooks/__tests__/useKeyboardShortcuts.test.ts` | MODIFY | Update "allows Q/W/E in number input" → use `data-numeric-input` attr; update "allows A in number input" similarly |

---

### Task 1: Update NumericInput tests (RED phase)

**Files:**
- Modify: `frontend/src/components/ui/__tests__/NumericInput.test.tsx`

- [ ] **Step 1: Update existing tests to expect `type="text"` behavior**

Replace all `getByRole('spinbutton')` with `getByRole('textbox')` and update the IME detection test to work with real `e.target.value` (no longer needing `Object.defineProperty` hack). Add new tests for letter-key blocking.

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { NumericInput } from '../NumericInput';

describe('NumericInput IME detection (#403)', () => {
  it('ignores keyDown when isComposing is true', () => {
    const onKeyDown = vi.fn();
    render(<NumericInput onKeyDown={onKeyDown} />);
    const input = screen.getByRole('textbox');

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    Object.defineProperty(event, 'isComposing', { value: true });
    input.dispatchEvent(event);

    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('detects non-ASCII input and restores previous value', () => {
    const onChange = vi.fn();
    render(<NumericInput value="123" onChange={onChange} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    // With type="text", e.target.value contains actual IME characters
    fireEvent.change(input, { target: { value: 'ㄆㄊㄍ' } });
    expect(onChange).not.toHaveBeenCalled();
    // Value should be restored to previous
    expect(input.value).toBe('123');
  });

  it('passes through normal digit input', () => {
    const onChange = vi.fn();
    render(<NumericInput value="" onChange={onChange} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: '456' } });
    expect(onChange).toHaveBeenCalledWith('456');
  });

  it('passes through empty string input', () => {
    const onChange = vi.fn();
    render(<NumericInput value="123" onChange={onChange} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('forwards keyDown for normal keys when not composing', () => {
    const onKeyDown = vi.fn();
    render(<NumericInput onKeyDown={onKeyDown} />);
    const input = screen.getByRole('textbox');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onKeyDown).toHaveBeenCalled();
  });

  it('blocks letter keys (a-z) via preventDefault', () => {
    const onKeyDown = vi.fn();
    render(<NumericInput onKeyDown={onKeyDown} />);
    const input = screen.getByRole('textbox');

    const event = new KeyboardEvent('keydown', {
      key: 'a',
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    input.dispatchEvent(event);

    expect(preventSpy).toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('allows digit keys through', () => {
    const onKeyDown = vi.fn();
    render(<NumericInput onKeyDown={onKeyDown} />);
    const input = screen.getByRole('textbox');

    fireEvent.keyDown(input, { key: '5' });
    expect(onKeyDown).toHaveBeenCalled();
  });

  it('has data-numeric-input attribute', () => {
    render(<NumericInput />);
    const input = screen.getByRole('textbox');
    expect(input.getAttribute('data-numeric-input')).toBe('true');
  });

  it('has inputMode="numeric" and pattern', () => {
    render(<NumericInput />);
    const input = screen.getByRole('textbox');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('pattern')).toBe('[0-9]*');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/ui/__tests__/NumericInput.test.tsx`
Expected: FAIL — `getByRole('textbox')` won't find `type="number"` input (it has role `spinbutton`), and new tests for `data-numeric-input` and letter-blocking will fail.

---

### Task 2: Implement NumericInput fix (GREEN phase)

**Files:**
- Modify: `frontend/src/components/ui/NumericInput.tsx`

- [ ] **Step 3: Update NumericInput implementation**

```tsx
import React, { useRef } from 'react';

interface NumericInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  value?: number | string;
  onChange?: (value: string) => void;
}

export const NumericInput = React.memo(React.forwardRef<HTMLInputElement, NumericInputProps>(
  function NumericInput({ value, onChange, onKeyDown, ...rest }, ref) {
    const imeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Ref: #403 — ignore keyDown during IME composition
      if (e.nativeEvent.isComposing) return;

      // Block characters not valid in numeric input
      // Allow: digits, Backspace, Delete, Tab, Escape, Enter, arrows, Home, End, navigation
      if (
        e.key.length === 1 &&
        !/[0-9]/.test(e.key) &&
        !e.ctrlKey && !e.metaKey && !e.altKey
      ) {
        e.preventDefault();
        return;
      }

      onKeyDown?.(e);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;

      // Ref: #403 — detect non-ASCII input (IME active)
      if (/[^\x20-\x7E]/.test(raw)) {
        e.target.value = String(value ?? '');
        const IME_WARNING_HINT = '請切換回英數輸入法（目前可能是中文輸入法）';
        e.target.setCustomValidity(IME_WARNING_HINT);
        e.target.reportValidity();
        // Auto-clear after 4s; use ref to avoid leak
        if (imeTimerRef.current) clearTimeout(imeTimerRef.current);
        imeTimerRef.current = setTimeout(() => {
          e.target.setCustomValidity('');
        }, 4000);
        return;
      }

      if (raw === '' || /^\d*$/.test(raw)) {
        onChange?.(raw);
      }
    };

    return (
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        data-numeric-input="true"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        {...rest}
      />
    );
  },
));
```

Key changes from current code:
1. `type="number"` → `type="text" inputMode="numeric" pattern="[0-9]*"` — lets `e.target.value` contain actual IME chars
2. `data-numeric-input="true"` — marker for `useKeyboardShortcuts` to identify numeric inputs
3. `handleKeyDown` expanded — blocks single-char non-digit keys (letters, symbols) since `type="text"` doesn't auto-block them; allows control keys, navigation, digits
4. `onWheel` handler removed — `type="text"` doesn't change value on scroll

- [ ] **Step 4: Run NumericInput tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/ui/__tests__/NumericInput.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/NumericInput.tsx frontend/src/components/ui/__tests__/NumericInput.test.tsx
git commit -m "fix(NumericInput): type=number→text to fix IME bypass (#403)

<input type=\"number\"> silently converts non-ASCII chars to empty string
in e.target.value, bypassing all IME detection logic. Switch to
type=\"text\" inputMode=\"numeric\" so handleChange receives actual IME
characters and the existing non-ASCII guard works correctly.

- Add data-numeric-input attr for useKeyboardShortcuts integration
- Block letter keys in handleKeyDown (type=\"text\" no longer auto-blocks)
- Remove onWheel handler (not needed for type=\"text\")"
```

---

### Task 3: Update useKeyboardShortcuts to detect data-numeric-input

**Files:**
- Modify: `frontend/src/hooks/__tests__/useKeyboardShortcuts.test.ts`

- [ ] **Step 6: Update keyboard shortcut tests (RED phase)**

Update the two tests that create `type="number"` inputs to instead create `type="text"` inputs with `data-numeric-input="true"`:

In `useKeyboardShortcuts.test.ts`, replace the test at lines 115-130:

```typescript
  it('allows Q/W/E in numeric input (data-numeric-input)', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, changeMode, cancelOrder, isStudentSelected: true, handleConfirm, cancelFlow }));

    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('data-numeric-input', 'true');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', { key: 'q', bubbles: true });
    Object.defineProperty(event, 'target', { value: input });
    input.dispatchEvent(event);

    expect(changeMode).toHaveBeenCalledWith('order');

    document.body.removeChild(input);
  });
```

And replace the test at lines 212-227:

```typescript
    it('allows A in numeric input (data-numeric-input)', () => {
      renderHook(() => useKeyboardShortcuts({ enabled: true, changeMode, handleConfirm, cancelFlow, enterExpenseMode, isStudentSelected: false }));

      const input = document.createElement('input');
      input.type = 'text';
      input.setAttribute('data-numeric-input', 'true');
      document.body.appendChild(input);
      input.focus();

      const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
      Object.defineProperty(event, 'target', { value: input });
      input.dispatchEvent(event);

      expect(enterExpenseMode).toHaveBeenCalledOnce();

      document.body.removeChild(input);
    });
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/hooks/__tests__/useKeyboardShortcuts.test.ts`
Expected: FAIL — shortcut handler still checks `inputType === 'number'`, won't match `type="text"` + `data-numeric-input`

---

- [ ] **Step 8: Update useKeyboardShortcuts implementation (GREEN phase)**

**Files:**
- Modify: `frontend/src/hooks/useKeyboardShortcuts.ts`

In `useKeyboardShortcuts.ts`, add a helper function and update each shortcut block's input-type check. The key change: instead of checking if `inputType` is NOT in the text-like list, check if the input has `data-numeric-input`:

Replace lines 67-83 (Q/W block):

```typescript
      // Q/W — suppress in text inputs, allow in numeric inputs (data-numeric-input)
      const modeKey: Record<string, PosMode> = { q: 'order', w: 'payment' };
      if (modeKey[key]) {
        if (tag === 'INPUT') {
          const input = target as HTMLInputElement;
          if (!input.hasAttribute('data-numeric-input')) {
            return;
          }
          input.blur();
        } else if (tag === 'TEXTAREA' || target.contentEditable === 'true') {
          return;
        }
        e.preventDefault();
        changeModeRef.current(modeKey[key]);
        setFocusZoneRef.current?.('mode-' + modeKey[key]);
        return;
      }
```

Replace lines 86-99 (E block):

```typescript
      // E — switch to order status view when student selected, no-op otherwise
      if (key === 'e' && isStudentSelectedRef.current) {
        if (tag === 'INPUT') {
          const input = target as HTMLInputElement;
          if (!input.hasAttribute('data-numeric-input')) {
            return;
          }
          input.blur();
        } else if (tag === 'TEXTAREA' || target.contentEditable === 'true') {
          return;
        }
        e.preventDefault();
        setFocusZoneRef.current?.('view-status');
        return;
      }
```

Replace lines 101-114 (A block):

```typescript
      // A — enter expense mode in idle only (no student selected)
      if (key === 'a' && enterExpenseModeRef.current && !isStudentSelectedRef.current) {
        if (tag === 'INPUT') {
          const input = target as HTMLInputElement;
          if (!input.hasAttribute('data-numeric-input')) {
            return;
          }
        } else if (tag === 'TEXTAREA' || target.contentEditable === 'true') {
          return;
        }
        e.preventDefault();
        enterExpenseModeRef.current();
        return;
      }
```

- [ ] **Step 9: Run useKeyboardShortcuts tests to verify they pass**

Run: `cd frontend && npx vitest run src/hooks/__tests__/useKeyboardShortcuts.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add frontend/src/hooks/useKeyboardShortcuts.ts frontend/src/hooks/__tests__/useKeyboardShortcuts.test.ts
git commit -m "fix(useKeyboardShortcuts): detect data-numeric-input attr (#403)

NumericInput changed from type=number to type=text, so shortcuts can
no longer rely on inputType !== 'text' to decide passthrough. Now
checks for data-numeric-input attribute which NumericInput sets."
```

---

### Task 4: Update NumberField tests

**Files:**
- Modify: `frontend/src/components/ui/__tests__/NumberField.test.tsx`

- [ ] **Step 11: Update NumberField tests**

Replace all `getByRole('spinbutton')` with `getByRole('textbox')`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NumberField } from '../NumberField';

describe('NumberField', () => {
  it('renders label and input', () => {
    render(<NumberField label="金額" />);
    expect(screen.getByText('金額')).toBeDefined();
    expect(screen.getByRole('textbox')).toBeDefined();
  });

  it('has accessible name from label', () => {
    render(<NumberField label="金額" />);
    expect(screen.getByRole('textbox', { name: '金額' })).toBeDefined();
  });

  it('calls onChange with numeric value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NumberField label="金額" onChange={onChange} />);
    await user.type(screen.getByRole('textbox'), '42');
    expect(onChange).toHaveBeenCalled();
  });

  it('displays error message', () => {
    render(<NumberField label="金額" error="必須為正數" />);
    expect(screen.getByText('必須為正數')).toBeDefined();
  });

  it('renders prefix when provided', () => {
    render(<NumberField label="金額" prefix="$" />);
    expect(screen.getByText('$')).toBeDefined();
  });

  it('renders suffix when provided', () => {
    render(<NumberField label="金額" suffix="元" />);
    expect(screen.getByText('元')).toBeDefined();
  });
});
```

- [ ] **Step 12: Run NumberField tests**

Run: `cd frontend && npx vitest run src/components/ui/__tests__/NumberField.test.tsx`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add frontend/src/components/ui/__tests__/NumberField.test.tsx
git commit -m "test(NumberField): update role spinbutton→textbox (#403)"
```

---

### Task 5: Full test suite + manual verification

- [ ] **Step 14: Run all related tests together**

Run: `cd frontend && npx vitest run src/components/ui/__tests__/NumericInput.test.tsx src/components/ui/__tests__/NumberField.test.tsx src/hooks/__tests__/useKeyboardShortcuts.test.ts src/components/__tests__/EditTransactionModal.test.tsx`
Expected: ALL PASS

- [ ] **Step 15: Run full test suite to check for regressions**

Run: `cd frontend && npx vitest run`
Expected: ALL PASS — no other tests should reference `spinbutton` role

- [ ] **Step 16: Manual verification on localhost:5173**

1. Switch keyboard to 注音 input method
2. Select a student → enter payment mode (W key or click)
3. Focus the 繳費金額 input → type Q (ㄆ) → should see IME warning tooltip, no 注音 residue in field
4. Switch back to English → type digits → should work normally
5. Press Q to switch mode → should work (blur + mode change)
6. In AdminScreen: test 便當單價 / 開帳金額 inputs similarly
