import React from 'react';
import './ActionCard.css';
import { Kbd } from './Kbd';

interface ActionCardProps {
  title: string;
  description?: string;
  /** 動作膠囊文字，寫出按下去會發生的事，例如「前往菜單與開帳」。 */
  actionLabel: string;
  icon?: React.ReactNode;
  kbd?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

/** 整張是一個 button 的大卡片；accessible name 為「標題，說明，動作」，Kbd 只供視覺提示。 */
export function ActionCard({ title, description, actionLabel, icon, kbd, onClick, disabled, className = '' }: ActionCardProps) {
  const name = [title, description, actionLabel].filter(Boolean).join('，');
  return (
    <button
      type="button"
      className={['action-card-ui', className].filter(Boolean).join(' ')}
      aria-label={name}
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <span className="action-card-ui__icon" aria-hidden="true">{icon}</span>}
      <span className="action-card-ui__text" aria-hidden="true">
        <span className="action-card-ui__title">{title}</span>
        {description && <span className="action-card-ui__desc">{description}</span>}
      </span>
      <span className="action-card-ui__cta" aria-hidden="true">
        <span className="action-card-ui__pill">{actionLabel}</span>
        {kbd && <Kbd>{kbd}</Kbd>}
      </span>
    </button>
  );
}
