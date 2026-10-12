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
  const ref = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focusKey > 0 && !disabled) ref.current?.focus(); }, [focusKey, disabled]);
  // M1 F01：高亮的那一筆一定捲到看得見的位置，Enter 選到的就是畫面上高亮的人。
  const lastIdx = suggestions.length - 1;
  const shownIdx = Math.min(activeIdx, Math.max(lastIdx, 0));
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-idx="${shownIdx}"]`);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [shownIdx, suggestions]);
  const query = value.trim();

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
              // 輸入法選字中的 Enter 只是選字，不選人。
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === 'Enter') {
                e.preventDefault(); e.stopPropagation();
                if (value.trim() === '') {
                  e.currentTarget.blur();
                } else {
                  onSubmit();
                }
              }
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur(); onEsc(); }
              else if (e.key === 'ArrowDown') { e.preventDefault(); if (lastIdx >= 0) onHover(Math.min(shownIdx + 1, lastIdx)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); if (lastIdx >= 0) onHover(Math.max(shownIdx - 1, 0)); }
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
      {suggestions.length > 0 && query && (
        <div className="suggest">
          <div className="sug-list" role="listbox" aria-label="學員建議清單" ref={listRef}>
          {suggestions.map((s, i) => (
            <div
              key={s.studentId}
              data-idx={i}
              role="option"
              aria-selected={i === shownIdx}
              className={'sug-row ' + (i === shownIdx ? 'sug-on' : '')}
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
          </div>
          <div className="sug-foot">
            {suggestions.length > 1 && <span>共 {suggestions.length} 筆 ·</span>}
            <span className="kbd">↑</span><span className="kbd">↓</span> 選擇 ·
            <span className="kbd">↵</span> 確認 ·
            <span className="kbd">Esc</span> 清空
          </div>
        </div>
      )}
      {suggestions.length === 0 && query && (
        <div className="suggest" role="status">
          <div className="sug-empty">找不到「{query}」：沒有符合的啟用中帳戶。請確認編號或姓名，停用的帳戶不會出現。</div>
        </div>
      )}
    </div>
  );
});
