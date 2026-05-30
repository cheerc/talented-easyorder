import { useEffect } from 'react';
import type { PosFlowState } from '../domain/posFlow';

export function useFocusSync(
  state: PosFlowState,
  tab: string,
  setSearchText: (text: string) => void,
  setSearchFocusKey: React.Dispatch<React.SetStateAction<number>>,
  setFocusZone: React.Dispatch<React.SetStateAction<string>>,
) {
  useEffect(() => {
    // Synchronize focusZone with state mode when student selection state changes
    if (state.kind === 'student_selected') {
      setFocusZone('mode-' + state.mode);
    }

    // 任何時候回到 idle 介面，或切換回櫃台且為 idle 時，都要離開焦點，並清空搜尋內容
    // 並且在處於非 idle 狀態時，提前將 searchFocusKey 重置為 0，避免回到 idle 時 SearchBox 自動聚焦
    if (state.kind === 'idle' && tab === 'pos') {
      (document.activeElement as HTMLElement)?.blur();
      setSearchText('');
      setSearchFocusKey(0);
    } else if (state.kind !== 'idle') {
      setSearchFocusKey(0);
    }
  }, [state.kind, state.mode, tab, setSearchText, setSearchFocusKey, setFocusZone]);
}
