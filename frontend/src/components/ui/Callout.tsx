import React from 'react';
import './Callout.css';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';

type CalloutVariant = 'warn' | 'ok' | 'info';

interface CalloutProps {
  variant: CalloutVariant;
  children: React.ReactNode;
  role?: 'alert' | 'status' | 'note';
  className?: string;
}

const ICONS = {
  warn: TriangleAlert,
  ok: CircleCheck,
  info: Info,
} satisfies Record<CalloutVariant, typeof CircleAlert>;

/**
 * 常駐提示：涉及金額、不可逆、資料遺失、重複收款風險或阻擋操作原因時使用；
 * 功能用途與操作方式改用 HelpTip（docs/FRONTEND-UI-STYLE.md）。
 */
export function Callout({ variant, children, role, className = '' }: CalloutProps) {
  const Icon = ICONS[variant];
  return (
    <div className={['callout-ui', `callout-${variant}`, className].filter(Boolean).join(' ')} role={role}>
      <span className="callout-ui__icon" aria-hidden="true"><Icon size={18} strokeWidth={2} /></span>
      <div className="callout-ui__body">{children}</div>
    </div>
  );
}
