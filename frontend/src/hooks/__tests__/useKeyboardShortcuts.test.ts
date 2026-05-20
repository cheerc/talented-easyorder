import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';

describe('useKeyboardShortcuts', () => {
  let changeMode: ReturnType<typeof vi.fn>;
  let cancelOrder: ReturnType<typeof vi.fn>;
  let handleConfirm: ReturnType<typeof vi.fn>;
  let cancelFlow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    changeMode = vi.fn();
    cancelOrder = vi.fn();
    handleConfirm = vi.fn();
    cancelFlow = vi.fn();
  });

  it('calls changeMode("order") when Q is pressed', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, changeMode, handleConfirm, cancelFlow }));

    const event = new KeyboardEvent('keydown', { key: 'q', bubbles: true });
    window.dispatchEvent(event);

    expect(changeMode).toHaveBeenCalledWith('order');
  });

  it('calls changeMode("payment") when W is pressed', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, changeMode, handleConfirm, cancelFlow }));

    const event = new KeyboardEvent('keydown', { key: 'w', bubbles: true });
    window.dispatchEvent(event);

    expect(changeMode).toHaveBeenCalledWith('payment');
  });

  it('does nothing on E in idle (no cancelOrder or not student selected)', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, changeMode, handleConfirm, cancelFlow }));

    const event = new KeyboardEvent('keydown', { key: 'e', bubbles: true });
    window.dispatchEvent(event);

    expect(changeMode).not.toHaveBeenCalled();
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it('calls cancelOrder on E when student selected', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, changeMode, cancelOrder, isStudentSelected: true, handleConfirm, cancelFlow }));

    const event = new KeyboardEvent('keydown', { key: 'e', bubbles: true });
    window.dispatchEvent(event);

    expect(cancelOrder).toHaveBeenCalledOnce();
  });

  it('does nothing on R (no-op everywhere)', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, changeMode, cancelOrder, isStudentSelected: true, handleConfirm, cancelFlow }));

    const event = new KeyboardEvent('keydown', { key: 'r', bubbles: true });
    window.dispatchEvent(event);

    expect(cancelOrder).not.toHaveBeenCalled();
    expect(changeMode).not.toHaveBeenCalled();
  });

  it('calls handleConfirm on Enter', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, changeMode, handleConfirm, cancelFlow }));

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    window.dispatchEvent(event);

    expect(handleConfirm).toHaveBeenCalledOnce();
  });

  it('calls cancelFlow on Escape', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, changeMode, handleConfirm, cancelFlow }));

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    window.dispatchEvent(event);

    expect(cancelFlow).toHaveBeenCalledOnce();
  });

  it('suppresses Q/W/E in text input', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, changeMode, cancelOrder, isStudentSelected: true, handleConfirm, cancelFlow }));

    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', { key: 'q', bubbles: true });
    Object.defineProperty(event, 'target', { value: input });
    input.dispatchEvent(event);

    expect(changeMode).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it('allows Q/W/E in number input', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, changeMode, cancelOrder, isStudentSelected: true, handleConfirm, cancelFlow }));

    const input = document.createElement('input');
    input.type = 'number';
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', { key: 'q', bubbles: true });
    Object.defineProperty(event, 'target', { value: input });
    input.dispatchEvent(event);

    expect(changeMode).toHaveBeenCalledWith('order');

    document.body.removeChild(input);
  });

  it('suppresses Q/W/E in textarea', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: true, changeMode, cancelOrder, isStudentSelected: true, handleConfirm, cancelFlow }));

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    const event = new KeyboardEvent('keydown', { key: 'w', bubbles: true });
    Object.defineProperty(event, 'target', { value: textarea });
    textarea.dispatchEvent(event);

    expect(changeMode).not.toHaveBeenCalled();

    document.body.removeChild(textarea);
  });

  it('does nothing when disabled', () => {
    renderHook(() => useKeyboardShortcuts({ enabled: false, changeMode, handleConfirm, cancelFlow }));

    const event = new KeyboardEvent('keydown', { key: 'q', bubbles: true });
    window.dispatchEvent(event);

    expect(changeMode).not.toHaveBeenCalled();
    expect(handleConfirm).not.toHaveBeenCalled();
    expect(cancelFlow).not.toHaveBeenCalled();
  });

  it('cleans up listeners on unmount', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts({ enabled: true, changeMode, handleConfirm, cancelFlow }));

    unmount();

    const event = new KeyboardEvent('keydown', { key: 'q', bubbles: true });
    window.dispatchEvent(event);

    expect(changeMode).not.toHaveBeenCalled();
  });

  describe('A key — enter expense mode', () => {
    let enterExpenseMode: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      enterExpenseMode = vi.fn();
    });

    it('calls enterExpenseMode on A in idle (no student selected)', () => {
      renderHook(() => useKeyboardShortcuts({ enabled: true, changeMode, handleConfirm, cancelFlow, enterExpenseMode, isStudentSelected: false }));

      const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
      window.dispatchEvent(event);

      expect(enterExpenseMode).toHaveBeenCalledOnce();
    });

    it('does nothing on A when student selected', () => {
      renderHook(() => useKeyboardShortcuts({ enabled: true, changeMode, handleConfirm, cancelFlow, enterExpenseMode, isStudentSelected: true }));

      const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
      window.dispatchEvent(event);

      expect(enterExpenseMode).not.toHaveBeenCalled();
    });

    it('suppresses A in text input', () => {
      renderHook(() => useKeyboardShortcuts({ enabled: true, changeMode, handleConfirm, cancelFlow, enterExpenseMode, isStudentSelected: false }));

      const input = document.createElement('input');
      input.type = 'text';
      document.body.appendChild(input);
      input.focus();

      const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
      Object.defineProperty(event, 'target', { value: input });
      input.dispatchEvent(event);

      expect(enterExpenseMode).not.toHaveBeenCalled();

      document.body.removeChild(input);
    });

    it('allows A in number input', () => {
      renderHook(() => useKeyboardShortcuts({ enabled: true, changeMode, handleConfirm, cancelFlow, enterExpenseMode, isStudentSelected: false }));

      const input = document.createElement('input');
      input.type = 'number';
      document.body.appendChild(input);
      input.focus();

      const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
      Object.defineProperty(event, 'target', { value: input });
      input.dispatchEvent(event);

      expect(enterExpenseMode).toHaveBeenCalledOnce();

      document.body.removeChild(input);
    });
  });
});
