import React from 'react';
import { Field } from './Field';
import './NumberField.css';

interface NumberFieldProps {
  label: string;
  id?: string;
  value?: number | string;
  onChange?: (value: number) => void;
  placeholder?: string;
  help?: string;
  error?: string;
  prefix?: string;
  suffix?: string;
  disabled?: boolean;
  className?: string;
}

export const NumberField = React.memo(function NumberField({
  label,
  id,
  value,
  onChange,
  placeholder,
  help,
  error,
  prefix,
  suffix,
  disabled = false,
  className = '',
}: NumberFieldProps) {
  const inputId = id ?? `numfield-${label.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <Field label={label} htmlFor={inputId} help={help} error={error} className={className}>
      <div className="num-input-wrap">
        {prefix && <span className="num-prefix">{prefix}</span>}
        <input
          id={inputId}
          className="field-input num-input"
          type="number"
          value={value}
          onChange={e => onChange?.(Number(e.target.value))}
          placeholder={placeholder}
          disabled={disabled}
          aria-describedby={error ? `${inputId}-error` : help ? `${inputId}-help` : undefined}
        />
        {suffix && <span className="num-suffix">{suffix}</span>}
      </div>
    </Field>
  );
});
