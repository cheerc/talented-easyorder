import { useEffect } from 'react';
import type { PosMode } from '../domain/posFlow';

interface UseKeyboardShortcutsArgs {
  enabled: boolean;
  changeMode: (mode: PosMode) => void;
  cancelOrder?: () => void;
  isStudentSelected?: boolean;
  handleConfirm: () => void;
  cancelFlow: () => void;
  enterExpenseMode?: () => void;
  setFocusZone?: (zone: string) => void;
  isDialogOpen?: boolean;
}

export function useKeyboardShortcuts({ enabled, changeMode, cancelOrder, isStudentSelected, handleConfirm, cancelFlow, enterExpenseMode, setFocusZone, isDialogOpen }: UseKeyboardShortcutsArgs) {
  useEffect(() => {
    if (!enabled || isDialogOpen) return;

    const onKey = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const isPrimaryShortcut = ['q', 'w', 'e', 'a', 'escape', 'enter'].includes(key);
      if (e.defaultPrevented && !isPrimaryShortcut) return;

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

      // Enter always works (delegated to navigation shortcuts if student is selected to avoid double trigger)
      if (e.key === 'Enter') {
        if (isStudentSelected) {
          return;
        }
        e.preventDefault();
        handleConfirm();
        return;
      }

      // Q/W — suppress in text inputs, allow in number inputs
      const modeKey: Record<string, PosMode> = { q: 'order', w: 'payment' };
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
        setFocusZone?.('mode-' + modeKey[key]);
        return;
      }

      // E — select the cancel order button when student selected, no-op otherwise
      if (key === 'e' && isStudentSelected) {
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
        setFocusZone?.('btn-delete-order');
        return;
      }

      // A — enter expense mode in idle only (no student selected)
      if (key === 'a' && enterExpenseMode && !isStudentSelected) {
        if (tag === 'INPUT') {
          const inputType = (target as HTMLInputElement).type;
          if (inputType === 'text' || inputType === 'search' || inputType === 'email' || inputType === 'password' || inputType === 'url' || inputType === 'tel') {
            return;
          }
        } else if (tag === 'TEXTAREA' || target.contentEditable === 'true') {
          return;
        }
        e.preventDefault();
        enterExpenseMode();
        return;
      }

      // R — no-op everywhere (was cancel order, now E handles cancel)
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, changeMode, cancelOrder, isStudentSelected, handleConfirm, cancelFlow, enterExpenseMode, setFocusZone, isDialogOpen]);
}
