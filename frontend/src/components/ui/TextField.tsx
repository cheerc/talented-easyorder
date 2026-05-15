import React from 'react';
import { Field } from './Field';
import './TextField.css';

interface TextFieldProps {
  label: string;
  id?: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  help?: string;
  error?: string;
  disabled?: boolean;
  className?: string;
}

export const TextField = React.memo(function TextField({
  label,
  id,
  value,
  onChange,
  placeholder,
  help,
  error,
  disabled = false,
  className = '',
}: TextFieldProps) {
  const inputId = id ?? `textfield-${label.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <Field label={label} htmlFor={inputId} help={help} error={error} className={className}>
      <input
        id={inputId}
        className="field-input"
        type="text"
        value={value}
        onChange={e => onChange?.(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-describedby={error ? `${inputId}-error` : help ? `${inputId}-help` : undefined}
      />
    </Field>
  );
});
