import React, { useId } from 'react';
import { Field } from './Field';
import './TextField.css';

interface ReasonFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** 在欄位裡按 Enter（不是輸入法選字）時呼叫。 */
  onSubmit?: () => void;
  error?: string;
  placeholder?: string;
  autoFocus?: boolean;
}

/** M2：更正、刪除、取消訂餐共用的「理由（必填）」欄位；理由會寫進稽核紀錄。 */
export const ReasonField = React.memo(function ReasonField({
  value, onChange, onSubmit, error, placeholder = '例如：收款金額打錯、家長來電取消', autoFocus = false,
}: ReasonFieldProps) {
  const id = `reason-${useId()}`;
  return (
    <Field label="理由（必填，會記在稽核紀錄）" htmlFor={id} error={error}>
      <input
        id={id}
        className="field-input"
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key !== 'Enter' || e.repeat || e.nativeEvent.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          onSubmit?.();
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-required="true"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
    </Field>
  );
});
