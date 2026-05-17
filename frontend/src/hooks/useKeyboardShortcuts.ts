import { useEffect } from 'react';
import type { PosMode } from '../domain/posFlow';

interface UseKeyboardShortcutsArgs {
  enabled: boolean;
  changeMode: (mode: PosMode) => void;
  cancelOrder?: () => void;
  isStudentSelected?: boolean;
  handleConfirm: () => void;
  cancelFlow: () => void;
}

export function useKeyboardShortcuts({ enabled, changeMode, cancelOrder, isStudentSelected, handleConfirm, cancelFlow }: UseKeyboardShortcutsArgs) {
  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      const target = e.target as HTMLElement;
      const tag = target.tagName;

      // Escape always works
      if (e.key === 'Escape') {
        e.preventDefault();
        if (tag === 'INPUT' || tag === 'TEXTAREA') {
          (target as HTMLInputElement).blur();
        }
        cancelFlow();
        return;
      }

      // Enter always works
      if (e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
        return;
      }

      // Q/W — suppress in text inputs, allow in number inputs
      const modeKey: Record<string, PosMode> = { q: 'order', w: 'payment' };
      const key = e.key.toLowerCase();
      if (modeKey[key]) {
        if (tag === 'INPUT') {
          const inputType = (target as HTMLInputElement).type;
          if (inputType === 'text' || inputType === 'search' || inputType === 'email' || inputType === 'password' || inputType === 'url' || inputType === 'tel') {
            return;
          }
          (target as HTMLInputElement).blur();
        } else if (tag === 'TEXTAREA' || target.contentEditable === 'true') {
          return;
        }
        e.preventDefault();
        changeMode(modeKey[key]);
        return;
      }

      // E — cancel order when student selected, no-op otherwise (idle expense entry is now a button)
      if (key === 'e' && cancelOrder && isStudentSelected) {
        if (tag === 'INPUT') {
          const inputType = (target as HTMLInputElement).type;
          if (inputType === 'text' || inputType === 'search' || inputType === 'email' || inputType === 'password' || inputType === 'url' || inputType === 'tel') {
            return;
          }
          (target as HTMLInputElement).blur();
        } else if (tag === 'TEXTAREA' || target.contentEditable === 'true') {
          return;
        }
        e.preventDefault();
        cancelOrder();
        return;
      }

      // R — no-op everywhere (was cancel order, now E handles cancel)
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, changeMode, cancelOrder, isStudentSelected, handleConfirm, cancelFlow]);
}
