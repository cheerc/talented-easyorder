import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import './HelpTip.css';
import { CircleHelp } from 'lucide-react';

interface HelpTipProps {
  /** 觸發按鈕的 accessible name，例如「備份頻率說明」。 */
  label: string;
  /** 說明內容；\n 會換行。只放功能用途與操作方式，警示請用 Callout（docs/FRONTEND-UI-STYLE.md）。 */
  children: React.ReactNode;
  className?: string;
}

/**
 * 圓形「?」說明：滑鼠移上、Tab 聚焦、點擊都能開（點擊會固定開啟）。
 * Esc 只在說明開啟時關閉並保留焦點，且不再傳給其他全域處理器；說明沒開時 Esc 照常傳遞。
 * 氣泡在按鈕下方置中；靠近視窗左右邊緣時水平位移（`--help-tip-shift`），留在視窗內。
 */
export function HelpTip({ label, children, className = '' }: HelpTipProps) {
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const pinnedRef = useRef(false);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => {
    pinnedRef.current = false;
    setOpen(false);
  }, []);

  // 先清掉舊位移再量，才量得到「置中」的原位；邊距 .5rem 依 root 字級換算，不寫死 px。
  const keepInViewport = useCallback(() => {
    const bubble = bubbleRef.current;
    if (!bubble) return;
    bubble.style.setProperty('--help-tip-shift', '0px');
    const rect = bubble.getBoundingClientRect();
    const margin = (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) * 0.5;
    let shift = 0;
    if (rect.left < margin) shift = margin - rect.left;
    else if (rect.right > window.innerWidth - margin) shift = window.innerWidth - margin - rect.right;
    bubble.style.setProperty('--help-tip-shift', `${shift}px`);
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    keepInViewport();
    window.addEventListener('resize', keepInViewport);
    return () => window.removeEventListener('resize', keepInViewport);
  }, [open, keepInViewport]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.stopImmediatePropagation();
      event.preventDefault();
      close();
    };
    const onPointerDown = (event: Event) => {
      if (!wrapRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, close]);

  return (
    <span
      ref={wrapRef}
      className={['help-tip-ui', className].filter(Boolean).join(' ')}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => { if (!pinnedRef.current) setOpen(false); }}
    >
      <button
        type="button"
        className="help-tip-ui__btn"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={close}
        onClick={() => {
          if (open && pinnedRef.current) close();
          else { pinnedRef.current = true; setOpen(true); }
        }}
      >
        <CircleHelp size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && (
        <span id={id} ref={bubbleRef} role="tooltip" className="help-tip-ui__bubble">{children}</span>
      )}
    </span>
  );
}
