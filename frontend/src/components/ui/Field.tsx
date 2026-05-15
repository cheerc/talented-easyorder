import React from 'react';
import './Field.css';

interface FieldProps {
  label: string;
  htmlFor?: string;
  help?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}

export const Field = React.memo(function Field({
  label,
  htmlFor,
  help,
  error,
  children,
  className = '',
}: FieldProps) {
  return (
    <div className={['field-ui', error ? 'field-err' : '', className].filter(Boolean).join(' ')}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {help && !error && <div className="field-help">{help}</div>}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
});
