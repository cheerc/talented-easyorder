import { useEffect } from 'react';
import type { PosMode } from '../domain/posFlow';

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
    if (isDialogOpen) return;
    const onGlobalKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        (document.activeElement as HTMLElement)?.blur();
        setSearchText('');
        setSearchFocusKey(() => 0);
        setTab('pos');
        return;
      }
      if (e.key === 'F2') { e.preventDefault(); setTab('report'); return; }
      if (e.key === 'F3') { e.preventDefault(); setTab('admin'); return; }
      if (e.key === 'F4') { e.preventDefault(); setTab('vendors'); return; }
      if (e.key === 'F5') { e.preventDefault(); setTab('history'); return; }
      if (e.key === 'F6') { e.preventDefault(); setShowDashboard((v: boolean) => !v); return; }

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

      if (e.key === 'Enter') {
        e.preventDefault();
        if (focusZone === 'btn-cancel') cancelFlow();
        else if (focusZone === 'btn-confirm') handleConfirm();
        else if (focusZone === 'btn-delete-order') {
          cancelOrder?.();
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

      const modes = ['mode-order', 'mode-payment', 'btn-delete-order'];
      const i = modes.indexOf(focusZone);
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (focusZone === 'btn-confirm') setFocusZone('btn-cancel');
        else if (focusZone === 'btn-cancel') setFocusZone('btn-cancel');
        else if (i > 0) {
          const nextZone = modes[i - 1];
          setFocusZone(nextZone);
          if (nextZone.startsWith('mode-')) {
            const m = nextZone.replace('mode-', '') as PosMode;
            changeMode(m);
          }
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (focusZone === 'btn-cancel') setFocusZone('btn-confirm');
        else if (focusZone === 'btn-confirm') setFocusZone('btn-confirm');
        else if (i >= 0 && i < modes.length - 1) {
          const nextZone = modes[i + 1];
          setFocusZone(nextZone);
          if (nextZone.startsWith('mode-')) {
            const m = nextZone.replace('mode-', '') as PosMode;
            changeMode(m);
          }
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (i >= 0) setFocusZone('btn-confirm');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (focusZone === 'btn-confirm' || focusZone === 'btn-cancel') setFocusZone('mode-' + currentMode);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, picked, hasFlash, currentMode, focusZone, handleConfirm, cancelFlow, changeMode, setFocusZone, cancelOrder, isDialogOpen]);
}
