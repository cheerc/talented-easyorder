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
