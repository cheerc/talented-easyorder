import React, { useId } from 'react';
import './StatTile.css';

interface StatTileProps {
  label: string;
  value: React.ReactNode;
  /** 標警示（金額異常、需要處理）；一般數字不要標。 */
  warn?: boolean;
  className?: string;
}

/** 標籤＋大數字（等寬）；群組名稱為「標籤 數字」。 */
export function StatTile({ label, value, warn, className = '' }: StatTileProps) {
  const id = useId();
  return (
    <div
      role="group"
      aria-labelledby={`${id}-label ${id}-value`}
      className={['stat-tile-ui', warn ? 'stat-tile-ui--warn' : '', className].filter(Boolean).join(' ')}
    >
      <span id={`${id}-label`} className="stat-tile-ui__label">{label}</span>
      <span id={`${id}-value`} className="stat-tile-ui__value">{value}</span>
    </div>
  );
}
