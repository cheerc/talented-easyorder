import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFocusSync } from '../useFocusSync';
import type { PosFlowState } from '../../domain/posFlow';

describe('useFocusSync', () => {
  let setSearchText: ReturnType<typeof vi.fn>;
  let setSearchFocusKey: ReturnType<typeof vi.fn>;
  let setFocusZone: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setSearchText = vi.fn();
    setSearchFocusKey = vi.fn();
    setFocusZone = vi.fn();
  });

  // Ref: #425 — duplicate_warning should force focusZone to 'mode-order'
  it('sets focusZone to mode-order when entering duplicate_warning state', () => {
    const state: PosFlowState = {
      kind: 'duplicate_warning',
      studentId: 'S001',
      source: 'manual',
      paidAmountText: '',
      searchTextHint: '',
    };

    renderHook(() =>
      useFocusSync(state, 'pos', setSearchText, setSearchFocusKey, setFocusZone, 'view-status'),
    );

    expect(setFocusZone).toHaveBeenCalledWith('mode-order');
  });

  it('sets focusZone to mode-order when duplicate_warning even if focusZone is already mode-order', () => {
    const state: PosFlowState = {
      kind: 'duplicate_warning',
      studentId: 'S001',
      source: 'manual',
      paidAmountText: '',
      searchTextHint: '',
    };

    renderHook(() =>
      useFocusSync(state, 'pos', setSearchText, setSearchFocusKey, setFocusZone, 'mode-order'),
    );

    expect(setFocusZone).toHaveBeenCalledWith('mode-order');
  });

  it('M1：回到 idle 時清空搜尋並把游標放回搜尋框', () => {
    const state: PosFlowState = { kind: 'idle', searchText: '' };
    const clearText = vi.fn<(text: string) => void>();
    const bumpKey = vi.fn<React.Dispatch<React.SetStateAction<number>>>();
    renderHook(() => useFocusSync(state, 'pos', clearText, bumpKey, vi.fn(), 'mode-order'));
    expect(clearText).toHaveBeenCalledWith('');
    const updater = bumpKey.mock.calls[0][0] as (k: number) => number;
    expect(updater(3)).toBe(4);
  });
});
