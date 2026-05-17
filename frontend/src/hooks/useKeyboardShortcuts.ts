import { useEffect } from 'react';
import type { PosMode } from '../domain/posFlow';

interface UseKeyboardShortcutsArgs {
  enabled: boolean;
  changeMode: (mode: PosMode) => void;
  enterExpenseMode?: () => void;
  handleConfirm: () => void;
  cancelFlow: () => void;
}

export function useKeyboardShortcuts({ enabled, changeMode, enterExpenseMode, handleConfirm, cancelFlow }: UseKeyboardShortcutsArgs) {
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

      // Q/W/E — suppress in text inputs, allow in number inputs
      const modeKey: Record<string, PosMode> = { q: 'order', w: 'payment', e: 'expense' };
      const key = e.key.toLowerCase();
      if (modeKey[key]) {
        if (tag === 'INPUT') {
          const inputType = (target as HTMLInputElement).type;
          if (inputType === 'text' || inputType === 'search' || inputType === 'email' || inputType === 'password' || inputType === 'url' || inputType === 'tel') {
            return; // suppressed in text-like inputs
          }
          // number input — allow (blur first)
          (target as HTMLInputElement).blur();
        } else if (tag === 'TEXTAREA' || target.contentEditable === 'true') {
          return; // suppressed in text areas
        }
        e.preventDefault();
        if (key === 'e' && enterExpenseMode) {
          enterExpenseMode();
        } else {
          changeMode(modeKey[key]);
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, changeMode, enterExpenseMode, handleConfirm, cancelFlow]);
}
