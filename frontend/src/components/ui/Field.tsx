import React, { useId } from 'react';
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
  const autoId = useId();
  const fieldId = htmlFor ?? autoId;
  const helpId = `${fieldId}-help`;
  const errorId = `${fieldId}-error`;

  return (
    <div className={['field-ui', error ? 'field-err' : '', className].filter(Boolean).join(' ')}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {help && !error && <div id={helpId} className="field-help">{help}</div>}
      {error && <div id={errorId} className="field-error" role="alert">{error}</div>}
    </div>
  );
});
