import React, { useEffect, useRef } from 'react';
import './Modal.css';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function makeBackgroundInert(dialog: HTMLElement): () => void {
  const previous = new Map<HTMLElement, boolean>();
  const previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  let branch = dialog;
  while (branch.parentElement) {
    const parent = branch.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
      previous.set(sibling, sibling.inert === true);
      sibling.inert = true;
    }
    branch = parent;
  }
  return () => {
    for (const [element, wasInert] of previous) {
      if (element.isConnected) element.inert = wasInert;
    }
    document.body.style.overflow = previousBodyOverflow;
  };
}

export const Modal = React.memo(function Modal({
  open,
  title,
  onClose,
  children,
  className = '',
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  // Record the opener during the render that opens the dialog: a child's autoFocus runs in the
  // commit, before this component's effects, so reading activeElement in the effect would get the
  // dialog's own button and cancel could not restore focus (#581 D3).
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  if (open && !wasOpenRef.current && typeof document !== 'undefined') {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpenRef.current = open;

  // M1 K09：開啟時把焦點移進對話框（子元件已用 autoFocus 指定的就不動），關閉時還給原本的元素，
  // 避免 Tab／Enter 落在對話框後面的按鈕上。
  useEffect(() => {
    if (!open) return;
    const previous = openerRef.current;
    const panel = panelRef.current;
    const restoreBackground = panel ? makeBackgroundInert(panel) : () => {};
    if (panel && !panel.contains(document.activeElement)) {
      const body = panel.querySelector<HTMLElement>('.modal-body');
      const target = body?.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
      target.focus();
    }
    return () => {
      restoreBackground();
      if (previous && previous.isConnected && previous !== document.body) previous.focus();
    };
  }, [open]);

  // M1 K09：對話框開著時 Esc 只關對話框。在 capture 階段處理並停止傳遞，背景的「取消整筆」收不到同一次 Esc；
  // 監聽不隨 onClose 重新註冊，避免背景先觸發重繪時把這次 Esc 的監聽拆掉。
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      if (e.key === 'Tab') {
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        // 焦點不在對話框內（例如被背景元素拿走）時，直接拉回對話框。
        if (!panel.contains(document.activeElement)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
          return;
        }
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;

  return (
    <div className="modal-overlay" data-testid="modal-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        className={['modal-panel', className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={title}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="關閉">
            ✕
          </button>
        </div>
        <div className="modal-body">
          {children}
        </div>
      </div>
    </div>
  );
});
