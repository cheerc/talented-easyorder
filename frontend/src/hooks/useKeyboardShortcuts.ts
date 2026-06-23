import { useEffect, useRef } from 'react';
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

// Ref: #292 — Use refs for callback dependencies so the keydown listener
// is registered once on mount (when enabled) instead of re-registered on
// every state change. Only `enabled` and `isDialogOpen` control registration.
export function useKeyboardShortcuts({ enabled, changeMode, cancelOrder, isStudentSelected, handleConfirm, cancelFlow, enterExpenseMode, setFocusZone, isDialogOpen }: UseKeyboardShortcutsArgs) {
  const changeModeRef = useRef(changeMode);
  const cancelOrderRef = useRef(cancelOrder);
  const isStudentSelectedRef = useRef(isStudentSelected);
  const handleConfirmRef = useRef(handleConfirm);
  const cancelFlowRef = useRef(cancelFlow);
  const enterExpenseModeRef = useRef(enterExpenseMode);
  const setFocusZoneRef = useRef(setFocusZone);

  useEffect(() => { changeModeRef.current = changeMode; });
  useEffect(() => { cancelOrderRef.current = cancelOrder; });
  useEffect(() => { isStudentSelectedRef.current = isStudentSelected; });
  useEffect(() => { handleConfirmRef.current = handleConfirm; });
  useEffect(() => { cancelFlowRef.current = cancelFlow; });
  useEffect(() => { enterExpenseModeRef.current = enterExpenseMode; });
  useEffect(() => { setFocusZoneRef.current = setFocusZone; });

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
        cancelFlowRef.current();
        return;
      }

      // Enter always works (delegated to navigation shortcuts if student is selected to avoid double trigger)
      if (e.key === 'Enter') {
        if (isStudentSelectedRef.current) {
          return;
        }
        e.preventDefault();
        handleConfirmRef.current();
        return;
      }

      // Q/W — suppress in text inputs, allow in numeric inputs (data-numeric-input)
      const modeKey: Record<string, PosMode> = { q: 'order', w: 'payment' };
      if (modeKey[key]) {
        if (tag === 'INPUT') {
          const input = target as HTMLInputElement;
          if (!input.hasAttribute('data-numeric-input')) {
            return;
          }
          input.blur();
        } else if (tag === 'TEXTAREA' || target.contentEditable === 'true') {
          return;
        }
        e.preventDefault();
        changeModeRef.current(modeKey[key]);
        setFocusZoneRef.current?.('mode-' + modeKey[key]);
        return;
      }

      // E — switch to order status view when student selected, no-op otherwise
      if (key === 'e' && isStudentSelectedRef.current) {
        if (tag === 'INPUT') {
          const input = target as HTMLInputElement;
          if (!input.hasAttribute('data-numeric-input')) {
            return;
          }
          input.blur();
        } else if (tag === 'TEXTAREA' || target.contentEditable === 'true') {
          return;
        }
        e.preventDefault();
        setFocusZoneRef.current?.('view-status');
        return;
      }

      // A — enter expense mode in idle only (no student selected)
      if (key === 'a' && enterExpenseModeRef.current && !isStudentSelectedRef.current) {
        if (tag === 'INPUT') {
          const input = target as HTMLInputElement;
          if (!input.hasAttribute('data-numeric-input')) {
            return;
          }
        } else if (tag === 'TEXTAREA' || target.contentEditable === 'true') {
          return;
        }
        e.preventDefault();
        enterExpenseModeRef.current();
        return;
      }

      // R — no-op everywhere (was cancel order, now E handles cancel)
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, isDialogOpen]);
}
