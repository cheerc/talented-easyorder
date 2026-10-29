import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppNavigationShortcuts } from '../useAppNavigationShortcuts';

const DEFAULT_PROPS = {
  tab: 'pos',
  setTab: vi.fn(),
  setShowDashboard: vi.fn(),
  picked: null,
  expenseProps: null,
  currentMode: 'order' as const,
  hasFlash: false,
  focusZone: 'mode-order',
  setFocusZone: vi.fn(),
  changeMode: vi.fn(),
  cancelFlow: vi.fn(),
  handleConfirm: vi.fn(),
  setSearchText: vi.fn(),
  setSearchFocusKey: vi.fn(),
  cancelOrder: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
});

function keydown(key: string, target?: Element) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true });
  if (target) {
    Object.defineProperty(event, 'target', { value: target, configurable: true });
  }
  act(() => {
    window.dispatchEvent(event);
  });
}

describe('useAppNavigationShortcuts — F-keys', () => {
  it('M1 K09：有對話框開著時 F 鍵不切頁', () => {
    const setTab = vi.fn();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    try {
      renderHook(() => useAppNavigationShortcuts({ ...DEFAULT_PROPS, setTab }));
      keydown('F2');
      expect(setTab).not.toHaveBeenCalled();
    } finally {
      dialog.remove();
    }
  });

  it('A1: F1 focuses POS tab, clears search, sets tab to pos', () => {
    const props = { ...DEFAULT_PROPS, tab: 'report', setSearchText: vi.fn(), setSearchFocusKey: vi.fn(), setTab: vi.fn() };
    renderHook(() => useAppNavigationShortcuts(props));

    keydown('F1');

    expect(props.setSearchText).toHaveBeenCalledWith('');
    expect(props.setTab).toHaveBeenCalledWith('pos');
  });

  it('A2: F2-F5 switch tabs', () => {
    const setTab = vi.fn();
    renderHook(
      (props) => useAppNavigationShortcuts(props),
      { initialProps: { ...DEFAULT_PROPS, setTab } }
    );

    keydown('F2'); expect(setTab).toHaveBeenCalledWith('report');
    keydown('F3'); expect(setTab).toHaveBeenCalledWith('admin');
    keydown('F4'); expect(setTab).toHaveBeenCalledWith('vendors');
    keydown('F5'); expect(setTab).toHaveBeenCalledWith('history');
  });

  it('A3: F6 toggles dashboard', () => {
    const setShowDashboard = vi.fn();
    renderHook(() => useAppNavigationShortcuts({ ...DEFAULT_PROPS, setShowDashboard }));

    keydown('F6');
    expect(setShowDashboard).toHaveBeenCalled();
  });

  it('A4: digit key sets search text in POS tab with no student picked', () => {
    const setSearchText = vi.fn();
    renderHook(() => useAppNavigationShortcuts({ ...DEFAULT_PROPS, setSearchText, tab: 'pos', picked: null, expenseProps: null }));

    keydown('5');

    expect(setSearchText).toHaveBeenCalledWith('5');
  });

  it('A5: digit key ignored on INPUT/TEXTAREA', () => {
    const setSearchText = vi.fn();
    renderHook(() => useAppNavigationShortcuts({ ...DEFAULT_PROPS, setSearchText, tab: 'pos', picked: null, expenseProps: null }));

    const input = document.createElement('input');
    keydown('5', input);

    expect(setSearchText).not.toHaveBeenCalled();
  });

  it('A6: digit key ignored on non-POS tab', () => {
    const setSearchText = vi.fn();
    renderHook(() => useAppNavigationShortcuts({ ...DEFAULT_PROPS, setSearchText, tab: 'report', picked: null, expenseProps: null }));

    keydown('5');

    expect(setSearchText).not.toHaveBeenCalled();
  });

  it('A7: Enter on mode-{currentMode} calls handleConfirm', () => {
    const handleConfirm = vi.fn();
    renderHook(() => useAppNavigationShortcuts({ ...DEFAULT_PROPS, picked: {}, handleConfirm, focusZone: 'mode-order', currentMode: 'order' }));

    keydown('Enter');

    expect(handleConfirm).toHaveBeenCalled();
  });

  it('M1 K08：長按 Enter 的重複事件不送出', () => {
    const handleConfirm = vi.fn();
    renderHook(() => useAppNavigationShortcuts({ ...DEFAULT_PROPS, picked: {}, handleConfirm, focusZone: 'mode-order', currentMode: 'order' }));

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true }));

    expect(handleConfirm).not.toHaveBeenCalled();
  });

  it('M1：焦點在按鈕上時 Enter 交給按鈕（取消鍵不會被當成送出）', () => {
    const handleConfirm = vi.fn();
    renderHook(() => useAppNavigationShortcuts({ ...DEFAULT_PROPS, picked: {}, handleConfirm, focusZone: 'mode-order', currentMode: 'order' }));

    keydown('Enter', document.createElement('button'));

    expect(handleConfirm).not.toHaveBeenCalled();
  });

  it('M1：滑鼠點過上方模式鍵（焦點在 .actionbar 的按鈕）後，Enter 仍照目前模式送出', () => {
    const handleConfirm = vi.fn();
    renderHook(() => useAppNavigationShortcuts({ ...DEFAULT_PROPS, picked: {}, handleConfirm, focusZone: 'mode-order', currentMode: 'order' }));
    const bar = document.createElement('div');
    bar.className = 'actionbar';
    const modeBtn = document.createElement('button');
    bar.appendChild(modeBtn);

    keydown('Enter', modeBtn);

    expect(handleConfirm).toHaveBeenCalledOnce();
  });

  it('A7b: Enter on view-status is no-op (does not call cancelOrder)', () => {
    const cancelOrder = vi.fn();
    renderHook(() => useAppNavigationShortcuts({ ...DEFAULT_PROPS, picked: {}, cancelOrder, focusZone: 'view-status' }));

    keydown('Enter');

    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it('A8: Enter on mode-{differentMode} calls changeMode', () => {
    const changeMode = vi.fn();
    const setFocusZone = vi.fn();
    renderHook(() => useAppNavigationShortcuts({ ...DEFAULT_PROPS, picked: {}, changeMode, setFocusZone, focusZone: 'mode-payment', currentMode: 'order' }));

    keydown('Enter');

    expect(changeMode).toHaveBeenCalledWith('payment');
    expect(setFocusZone).toHaveBeenCalledWith('mode-payment');
  });

  it('A9: Escape calls cancelFlow', () => {
    const cancelFlow = vi.fn();
    renderHook(() => useAppNavigationShortcuts({ ...DEFAULT_PROPS, picked: {}, cancelFlow }));

    keydown('Escape');

    expect(cancelFlow).toHaveBeenCalled();
  });
});

describe('useAppNavigationShortcuts — Arrow navigation', () => {
  it('A10: ArrowLeft/ArrowRight cycle through mode row', () => {
    const setFocusZone = vi.fn();
    const changeMode = vi.fn();
    renderHook(() => useAppNavigationShortcuts({ ...DEFAULT_PROPS, picked: {}, setFocusZone, changeMode, focusZone: 'mode-order' }));

    keydown('ArrowRight');
    expect(setFocusZone).toHaveBeenCalledWith('mode-payment');
    expect(changeMode).toHaveBeenCalledWith('payment');
  });

  it('A10b: ArrowDown from mode row is no-op (no confirm row)', () => {
    const setFocusZone = vi.fn();
    renderHook(() => useAppNavigationShortcuts({ ...DEFAULT_PROPS, picked: {}, setFocusZone, focusZone: 'mode-order' }));

    keydown('ArrowDown');
    expect(setFocusZone).not.toHaveBeenCalled();
  });

  it('A11: shortcuts disabled when isDialogOpen', () => {
    const setTab = vi.fn();
    renderHook(() => useAppNavigationShortcuts({ ...DEFAULT_PROPS, picked: {}, setTab, isDialogOpen: true }));

    keydown('F1');
    expect(setTab).not.toHaveBeenCalled();
  });

  it('A12: cleanup on unmount removes event listeners', () => {
    const removeListenerSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useAppNavigationShortcuts({ ...DEFAULT_PROPS, picked: {} }));
    unmount();

    expect(removeListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

    removeListenerSpy.mockRestore();
  });
});

describe('useAppNavigationShortcuts — input method and repeat guards', () => {
  it('ignores a navigation key while the event is composing but still suppresses the browser default', () => {
    const setTab = vi.fn();
    renderHook(() => useAppNavigationShortcuts({ ...DEFAULT_PROPS, setTab }));

    const event = new KeyboardEvent('keydown', { key: 'F2', isComposing: true, bubbles: true, cancelable: true });
    act(() => { window.dispatchEvent(event); });

    expect(event.defaultPrevented).toBe(true);
    expect(setTab).not.toHaveBeenCalled();
  });

  it('ignores navigation keys between compositionstart and compositionend', () => {
    const setTab = vi.fn();
    renderHook(() => useAppNavigationShortcuts({ ...DEFAULT_PROPS, setTab }));

    act(() => { window.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', bubbles: true, cancelable: true })); });
    expect(setTab).not.toHaveBeenCalled();
    act(() => { window.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); });

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', bubbles: true, cancelable: true })); });
    expect(setTab).toHaveBeenCalledWith('admin');
  });

  it('ignores the legacy keyCode 229 used by IMEs', () => {
    const setTab = vi.fn();
    renderHook(() => useAppNavigationShortcuts({ ...DEFAULT_PROPS, setTab }));

    const event = new KeyboardEvent('keydown', { key: 'F4', bubbles: true, cancelable: true });
    Object.defineProperty(event, 'keyCode', { value: 229 });
    act(() => { window.dispatchEvent(event); });

    expect(setTab).not.toHaveBeenCalled();
  });

  it('ignores repeated navigation keys', () => {
    const setTab = vi.fn();
    renderHook(() => useAppNavigationShortcuts({ ...DEFAULT_PROPS, setTab }));

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', repeat: true, bubbles: true, cancelable: true })); });

    expect(setTab).not.toHaveBeenCalled();
  });

  it('ignores physical Option+Digit navigation while composing', () => {
    const setTab = vi.fn();
    renderHook(() => useAppNavigationShortcuts({ ...DEFAULT_PROPS, setTab }));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '£', code: 'Digit3', altKey: true, isComposing: true, bubbles: true, cancelable: true }));
    });

    expect(setTab).not.toHaveBeenCalled();
  });
});

