import React, { useEffect, useRef } from "react";
import type { StudentAccount } from '../../domain/student';
import { fmt } from './utils';

interface SearchBoxProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: () => void;
  onEsc: () => void;
  suggestions: StudentAccount[];
  activeIdx: number;
  onPick: (s: StudentAccount) => void;
  onHover: (idx: number) => void;
  focusKey: number;
  disabled: boolean;
  onEnterExpense?: () => void;
  disableHoverSelection?: boolean;
}
export const SearchBox = React.memo(function SearchBox({ value, onChange, onSubmit, onEsc, suggestions, activeIdx, onPick, onHover, focusKey, disabled, onEnterExpense, disableHoverSelection = true }: SearchBoxProps) {
  const ref = useRef(null);
  useEffect(() => { if (focusKey > 0 && !disabled) ref.current?.focus(); }, [focusKey, disabled]);

  return (
    <div className="searchwrap">
      <label className="search-label">輸入編號或姓名</label>
      <div className="search-row">
        <div className="search">
          <span className="search-prefix">#</span>
          <input
            ref={ref}
            className="search-input"
            aria-label="輸入學員編號或姓名"
            value={value}
            disabled={disabled}
            autoComplete="off"
            spellCheck="false"
            placeholder="例如 015 或 周映彤"
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault(); e.stopPropagation();
                if (value.trim() === '') {
                  e.currentTarget.blur();
                } else {
                  onSubmit();
                }
              }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur(); onEsc(); }
              else if (e.key === 'ArrowDown') { e.preventDefault(); onHover(Math.min(activeIdx + 1, suggestions.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); onHover(Math.max(activeIdx - 1, 0)); }
            }}
          />
          <span className="search-enter"><span className="kbd kbd-lg">↵</span></span>
        </div>
        {onEnterExpense && (
          <button className="mode" onClick={onEnterExpense} style={{ flex: 'none', width: 'auto', padding: '14px 28px' }}>
            <span className="mode-key">A</span>
            <span className="mode-lbl" style={{ fontSize: '22px' }}>新增櫃台收支</span>
          </button>
        )}
      </div>
      {suggestions.length > 0 && value && (
        <div className="suggest" role="listbox" aria-label="學員建議清單">
          {suggestions.slice(0, 6).map((s, i) => (
            <div
              key={s.studentId}
              role="option"
              aria-selected={i === activeIdx}
              className={'sug-row ' + (i === activeIdx ? 'sug-on' : '')}
              onMouseEnter={() => {
                if (!disableHoverSelection) {
                  onHover(i);
                }
              }}
              onClick={() => onPick(s)}
            >
              <span className="sug-id mono">{s.studentId}</span>
              <span className="sug-name">{s.displayName}</span>
              <span className={'sug-bal mono ' + (s.currentBalance < 0 ? 'is-debt' : s.currentBalance < 90 ? 'is-low' : '')}>
                {s.currentBalance < 0 ? `欠 ${fmt(s.currentBalance)}` : `$${fmt(s.currentBalance)}`}
              </span>
            </div>
          ))}
          <div className="sug-foot">
            <span className="kbd">↑</span><span className="kbd">↓</span> 選擇 ·
            <span className="kbd">↵</span> 確認 ·
            <span className="kbd">Esc</span> 清空
          </div>
        </div>
      )}
    </div>
  );
});
