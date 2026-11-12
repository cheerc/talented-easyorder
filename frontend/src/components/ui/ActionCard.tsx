import React from 'react';
import './ActionCard.css';
import { Kbd } from './Kbd';

/** hero：整頁被擋住時的置中直排主版面；inline：放在資訊列內的精簡橫排（膠囊緊接文字）。 */
export type ActionCardLayout = 'hero' | 'inline';

interface ActionCardProps {
  title: string;
  description?: string;
  /** 動作膠囊文字，寫出按下去會發生的事，例如「前往菜單與開帳」。 */
  actionLabel: string;
  icon?: React.ReactNode;
  kbd?: string;
  layout?: ActionCardLayout;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

/** 整張是一個 button 的大卡片；accessible name 為「標題，說明，動作」，Kbd 只供視覺提示。 */
export function ActionCard({ title, description, actionLabel, icon, kbd, layout = 'hero', onClick, disabled, className = '' }: ActionCardProps) {
  const name = [title, description, actionLabel].filter(Boolean).join('，');
  return (
    <button
      type="button"
      className={['action-card-ui', `action-card-ui--${layout}`, className].filter(Boolean).join(' ')}
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
