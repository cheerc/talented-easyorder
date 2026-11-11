import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { HelpTip } from './HelpTip';
import './DateField.css';

export interface DateFieldOption {
  value: string;
  label: string;
}

interface DateFieldCommonProps {
  /** 控制項 id，label 以它關聯。 */
  id: string;
  /** 右側狀態區（徽章、今天／過去日期／未來日期等），由頁面提供。 */
  status?: ReactNode;
  /** 有就在標籤旁放「營業日說明」?；只放用途與操作方式。 */
  help?: string;
  /** compact 給空間較小的標題列用，仍是同一個元件。 */
  size?: 'default' | 'compact';
  disabled?: boolean;
  testId?: string;
}

export type DateFieldProps = DateFieldCommonProps & (
  | {
    /** 原生日期輸入：輸入中不確認，Enter 或離開欄位才確認；用滑鼠選日期則立刻確認。 */
    variant: 'date';
    value: string;
    min?: string;
    /** 每次輸入都會呼叫，讓頁面保存草稿值。 */
    onChange: (value: string) => void;
    /** 日期確認時呼叫（頁面在這裡驗證並載入）。 */
    onConfirm: (value: string) => void;
  }
  | {
    /** 下拉選單：選項由呼叫端提供，選了就確認。 */
    variant: 'select';
    value: string;
    options: DateFieldOption[];
    onConfirm: (value: string) => void;
  }
  | {
    /** 唯讀顯示：外觀與其他變體相同，沒有可切換的日期時使用。 */
    variant: 'static';
    value: string;
  }
);

/** 營業日單日控制項（#690）：F1／F2／F3 共用，標籤固定為「營業日」。 */
export function DateField(props: DateFieldProps) {
  const { id, status, help, size = 'default', disabled, testId } = props;
  const typingRef = useRef(false);
  const className = `date-field-ui${size === 'compact' ? ' date-field-ui--compact' : ''}`;
  const controlClass = `date-field-ui__control${props.variant === 'static' ? ' date-field-ui__control--static' : ''}`;

  let control: ReactNode;
  if (props.variant === 'date') {
    const { value, min, onChange, onConfirm } = props;
    control = (
      <input
        id={id}
        className={controlClass}
        type="date"
        min={min}
        value={value}
        data-testid={testId}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (event.repeat || event.nativeEvent.isComposing) return;
            typingRef.current = false;
            onConfirm(event.currentTarget.value);
          } else if (event.key !== 'Tab' && event.key !== 'Escape') {
            typingRef.current = true;
          }
        }}
        onChange={event => {
          const next = event.target.value;
          onChange(next);
          if (!typingRef.current) onConfirm(next);
        }}
        onBlur={event => {
          typingRef.current = false;
          onConfirm(event.currentTarget.value);
        }}
        disabled={disabled}
        required
      />
    );
  } else if (props.variant === 'select') {
    const { value, options, onConfirm } = props;
    control = (
      <select
        id={id}
        className={controlClass}
        value={value}
        data-testid={testId}
        disabled={disabled}
        onChange={event => onConfirm(event.target.value)}
      >
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    );
  } else {
    control = <output id={id} className={controlClass} data-testid={testId}>{props.value}</output>;
  }

  return (
    <section className={className} aria-label="營業日選擇">
      <label className="date-field-ui__label" htmlFor={id}>營業日</label>
      {control}
      {help && <HelpTip label="營業日說明">{help}</HelpTip>}
      {status && <div className="date-field-ui__status">{status}</div>}
    </section>
  );
}
