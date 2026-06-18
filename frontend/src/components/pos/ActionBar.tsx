import React from "react";
import type { PosMode } from '../../domain/posFlow';

interface ActionBarProps {
  mode: PosMode;
  setMode: (mode: PosMode) => void;
  onDeleteOrder?: () => void;
  focusZone: string;
}
export const ActionBar = React.memo(function ActionBar({ mode, setMode, onDeleteOrder, focusZone }: ActionBarProps) {
  const opts = [
    { id: 'order' as PosMode, label: '訂便當', hint: 'Q' },
    { id: 'payment' as PosMode, label: '繳費', hint: 'W' },
  ];

  return (
    <div className="actionbar" role="group" aria-label="交易操作">
      <div className="modes modes-3" role="radiogroup" aria-label="交易類型" style={{ display: 'flex', gap: '8px' }}>
        {opts.map(o => {
          const isModeOn = focusZone === 'mode-' + o.id || (mode === o.id && focusZone !== 'btn-delete-order');
          return (
            <button
              key={o.id}
              className={'mode ' + (isModeOn ? 'mode-on' : '') + (focusZone === 'mode-' + o.id ? ' mode-focus' : '')}
              onClick={() => setMode(o.id)}
              role="radio"
              aria-checked={mode === o.id}
              style={{ flex: 1 }}
            >
              <span className="mode-key">{o.hint}</span>
              <span className="mode-lbl">{o.label}</span>
            </button>
          );
        })}
        {onDeleteOrder && (
          <button
            className={'mode ' + (focusZone === 'btn-delete-order' ? 'mode-on mode-focus' : '')}
            onClick={onDeleteOrder}
            style={{ flex: 1 }}
          >
            <span className="mode-key">E</span>
            <span className="mode-lbl">取消訂餐</span>
          </button>
        )}
      </div>
    </div>
  );
});
