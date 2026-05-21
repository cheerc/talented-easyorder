import React from 'react';

interface NumericInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  value?: number | string;
  onChange?: (value: string) => void;
}

export const NumericInput = React.memo(React.forwardRef<HTMLInputElement, NumericInputProps>(
  function NumericInput({ value, onChange, onKeyDown, ...rest }, ref) {
    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (['-', '+', 'e', 'E', '.'].includes(e.key)) {
        e.preventDefault();
        return;
      }
      onKeyDown?.(e);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      if (v === '' || /^\d*$/.test(v)) {
        onChange?.(v);
      }
    };

    const handleWheel = (e: React.WheelEvent<HTMLInputElement>) => {
      e.currentTarget.blur();
    };

    return (
      <input
        ref={ref}
        type="number"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
        {...rest}
      />
    );
  },
));
