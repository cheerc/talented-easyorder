import { useEffect } from 'react';
import type { PosFlowState } from '../domain/posFlow';

/**
 * Ref: #328 — No cleanup needed: this effect only calls React setState
 * functions and HTMLElement.blur(). There are no subscriptions, event
 * listeners, or timers to clean up on unmount.
 */

export function useFocusSync(
  state: PosFlowState,
  tab: string,
  setSearchText: (text: string) => void,
  setSearchFocusKey: React.Dispatch<React.SetStateAction<number>>,
  setFocusZone: React.Dispatch<React.SetStateAction<string>>,
  focusZone: string,
) {
  useEffect(() => {
    // Synchronize focusZone with state mode when student selection state changes
    // Skip if focusZone is 'view-status' — RecentStrip click intentionally set it
    if (state.kind === 'student_selected' && focusZone !== 'view-status') {
      setFocusZone('mode-' + state.mode);
    }

    // Ref: #425 — force focusZone to order mode when duplicate warning is shown
    if (state.kind === 'duplicate_warning') {
      setFocusZone('mode-order');
    }

    // M1：回到搜尋（完成、取消、切回櫃台）時清空搜尋並把游標放進搜尋框，姓名可以直接打，不用先點。
    if (state.kind === 'idle' && tab === 'pos') {
      setSearchText('');
      setSearchFocusKey(k => k + 1);
    }
  }, [state.kind, state.mode, tab, setSearchText, setSearchFocusKey, setFocusZone, focusZone]);
}
