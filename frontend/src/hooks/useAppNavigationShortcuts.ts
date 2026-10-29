import { useEffect } from 'react';
import type { PosMode } from '../domain/posFlow';
import { NAVIGATION, navigationKey, isCompositionKey } from '../components/navigationKeys';

interface UseAppNavigationShortcutsArgs {
  tab: string;
  setTab: (tab: string) => void;
  setShowDashboard: (v: boolean | ((prev: boolean) => boolean)) => void;
  picked: unknown;
  expenseProps: unknown;
  currentMode: PosMode;
  hasFlash: boolean;
  focusZone: string;
  setFocusZone: (zone: string) => void;
  changeMode: (mode: PosMode) => void;
  cancelFlow: () => void;
  handleConfirm: () => void;
  setSearchText: (text: string) => void;
  setSearchFocusKey: (updater: (prev: number) => number) => void;
  cancelOrder?: () => void;
  isDialogOpen?: boolean;
}

export function useAppNavigationShortcuts(args: UseAppNavigationShortcutsArgs) {
  const { tab, setTab, setShowDashboard, picked, expenseProps, currentMode, hasFlash, focusZone, setFocusZone, changeMode, cancelFlow, handleConfirm, setSearchText, setSearchFocusKey, cancelOrder, isDialogOpen } = args;

  // Global keyboard shortcuts: F-keys + digit key auto-focus
  useEffect(() => {
    const onGlobalKey = (e: KeyboardEvent) => {
      const nav = navigationKey(e);
      if (nav !== null) {
        e.preventDefault();
        if (isCompositionKey(e) || e.repeat) return;
        if (isDialogOpen || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        if (nav === 0) { setSearchText(''); setSearchFocusKey(k => k + 1); }
        setTab(NAVIGATION[nav].id);
        return;
      }
      if (e.key === 'F6' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        if (isCompositionKey(e) || e.repeat) return;
        if (!isDialogOpen && !document.querySelector('[role="dialog"][aria-modal="true"]')) setShowDashboard(v => !v);
        return;
      }
      if (isDialogOpen || e.ctrlKey || e.metaKey || e.altKey) return;

      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') {
        return;
      }

      if (/^[0-9]$/.test(e.key) && tab === 'pos' && !picked && !expenseProps) {
        setSearchText(e.key);
        setSearchFocusKey(prev => prev + 1);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  }, [tab, picked, expenseProps, setTab, setShowDashboard, setSearchText, setSearchFocusKey, isDialogOpen]);

  // Arrow key navigation for focus zones
  useEffect(() => {
    if (tab !== 'pos' || hasFlash || !picked || isDialogOpen) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      if (e.key.startsWith('Arrow') && ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA')) return;

      if (e.key === 'Enter') {
        // M1：焦點在動作按鈕上時讓按鈕自己處理，Enter 按到哪顆就是哪顆（例如「取消」不會被當成送出）。
        // 上方的模式鍵（訂餐／繳費／訂餐狀況）例外：滑鼠點過後按 Enter 仍照目前模式送出。
        const target = e.target as HTMLElement;
        if (target.tagName === 'BUTTON' && !target.closest('.actionbar')) return;
        // 對話框裡的 Enter 由對話框自己處理，不送出背景的草稿。
        if (target.closest?.('[role="dialog"]')) return;
        e.preventDefault();
        // M1 K08：長按 Enter 的重複事件不送出。
        if (e.repeat) return;
        if (focusZone === 'view-status') {
          // Ref: #400 — view-status is read-only display, Enter is no-op
          return;
        } else if (focusZone.startsWith('mode-')) {
          const m = focusZone.replace('mode-', '') as PosMode;
          if (m === currentMode) {
            handleConfirm();
          } else {
            changeMode(m);
            setFocusZone('mode-' + m);
          }
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        cancelFlow();
        return;
      }

      const modes = ['mode-order', 'mode-payment', 'view-status'];
      const i = modes.indexOf(focusZone);
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (i > 0) {
          const nextZone = modes[i - 1];
          setFocusZone(nextZone);
          if (nextZone.startsWith('mode-')) {
            const m = nextZone.replace('mode-', '') as PosMode;
            changeMode(m);
          }
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (i >= 0 && i < modes.length - 1) {
          const nextZone = modes[i + 1];
          setFocusZone(nextZone);
          if (nextZone.startsWith('mode-')) {
            const m = nextZone.replace('mode-', '') as PosMode;
            changeMode(m);
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, picked, hasFlash, currentMode, focusZone, handleConfirm, cancelFlow, changeMode, setFocusZone, cancelOrder, isDialogOpen]);
}
