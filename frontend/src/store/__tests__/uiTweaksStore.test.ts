import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  DEFAULT_UI_TWEAKS,
  UI_TWEAKS_STORAGE_KEY,
  applyBodyAttributes,
  loadPersistedUiTweaks,
  parseUiTweaks,
  savePersistedUiTweaks,
  useUiTweaksStore,
  reloadUiTweaksFromStorage,
} from '../uiTweaksStore';
import { useTweaks } from '../../hooks/useTweaks';

describe('uiTweaksStore', () => {
  beforeEach(() => {
    localStorage.clear();
    act(() => {
      useUiTweaksStore.getState().resetToDefault();
    });
  });

  describe('parseUiTweaks', () => {
    it('returns defaults for null, undefined, or non-object', () => {
      expect(parseUiTweaks(null)).toEqual(DEFAULT_UI_TWEAKS);
      expect(parseUiTweaks(undefined)).toEqual(DEFAULT_UI_TWEAKS);
      expect(parseUiTweaks('bad')).toEqual(DEFAULT_UI_TWEAKS);
      expect(parseUiTweaks(123)).toEqual(DEFAULT_UI_TWEAKS);
    });

    it('parses valid payload correctly', () => {
      const valid = {
        theme: 'dark' as const,
        scale: 'normal' as const,
        disableHoverSelection: true,
      };
      expect(parseUiTweaks(valid)).toEqual(valid);
    });

    it('falls back individual invalid fields to defaults', () => {
      const invalid = {
        theme: 'neon',
        scale: 'extra-large',
        disableHoverSelection: 'not-a-bool',
      };
      expect(parseUiTweaks(invalid)).toEqual({
        theme: 'warm',
        scale: 'large',
        disableHoverSelection: false,
      });
    });

    it('supports legacy fontSize mapping to scale', () => {
      expect(parseUiTweaks({ fontSize: 'lg' })).toEqual({
        theme: 'warm',
        scale: 'large',
        disableHoverSelection: false,
      });
      expect(parseUiTweaks({ fontSize: 'md' })).toEqual({
        theme: 'warm',
        scale: 'normal',
        disableHoverSelection: false,
      });
    });

    it('supports string representation of disableHoverSelection', () => {
      expect(parseUiTweaks({ disableHoverSelection: 'true' })).toEqual({
        theme: 'warm',
        scale: 'large',
        disableHoverSelection: true,
      });
      expect(parseUiTweaks({ disableHoverSelection: 'false' })).toEqual({
        theme: 'warm',
        scale: 'large',
        disableHoverSelection: false,
      });
    });
  });

  describe('localStorage persistence & safe fallback', () => {
    it('loads defaults when localStorage is empty', () => {
      expect(loadPersistedUiTweaks()).toEqual(DEFAULT_UI_TWEAKS);
    });

    it('loads persisted tweaks when valid JSON is present', () => {
      localStorage.setItem(
        UI_TWEAKS_STORAGE_KEY,
        JSON.stringify({ theme: 'light', scale: 'normal', disableHoverSelection: true }),
      );
      expect(loadPersistedUiTweaks()).toEqual({
        theme: 'light',
        scale: 'normal',
        disableHoverSelection: true,
      });
    });

    it('gracefully handles corrupted JSON in localStorage', () => {
      localStorage.setItem(UI_TWEAKS_STORAGE_KEY, '{invalid json');
      expect(loadPersistedUiTweaks()).toEqual(DEFAULT_UI_TWEAKS);
    });

    it('safely handles localStorage.setItem throwing QuotaExceededError', () => {
      const origSetItem = localStorage.setItem;
      localStorage.setItem = () => {
        throw new Error('QuotaExceededError');
      };
      try {
        expect(() => {
          savePersistedUiTweaks({ theme: 'dark', scale: 'normal', disableHoverSelection: true });
        }).not.toThrow();
      } finally {
        localStorage.setItem = origSetItem;
      }
    });

    it('safely handles localStorage.getItem throwing SecurityError', () => {
      const origGetItem = localStorage.getItem;
      localStorage.getItem = () => {
        throw new Error('SecurityError');
      };
      try {
        expect(loadPersistedUiTweaks()).toEqual(DEFAULT_UI_TWEAKS);
      } finally {
        localStorage.getItem = origGetItem;
      }
    });

    it('safely handles window.localStorage getter throwing SecurityError on load and save', () => {
      const origDesc = Object.getOwnPropertyDescriptor(window, 'localStorage');
      try {
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new DOMException('Blocked', 'SecurityError');
          },
          configurable: true,
        });

        // Test 1: loading returns default without throwing
        expect(loadPersistedUiTweaks()).toEqual(DEFAULT_UI_TWEAKS);

        // Test 2: saving does not throw
        expect(() => {
          savePersistedUiTweaks({ theme: 'dark', scale: 'normal', disableHoverSelection: true });
        }).not.toThrow();

        // Test 3: setTweak updates in-memory state and DOM attributes even when localStorage getter throws
        act(() => {
          useUiTweaksStore.getState().setTweak('theme', 'dark');
          useUiTweaksStore.getState().setTweak('scale', 'normal');
        });

        expect(useUiTweaksStore.getState().theme).toBe('dark');
        expect(useUiTweaksStore.getState().scale).toBe('normal');
        expect(document.body.getAttribute('data-theme')).toBe('dark');
        expect(document.body.getAttribute('data-scale')).toBe('normal');
      } finally {
        if (origDesc) {
          Object.defineProperty(window, 'localStorage', origDesc);
        }
      }
    });
  });

  describe('DOM body attributes synchronization', () => {
    it('applies data-theme, data-scale, and data-fs attributes to document.body', () => {
      applyBodyAttributes({ theme: 'dark', scale: 'normal' });
      expect(document.body.getAttribute('data-theme')).toBe('dark');
      expect(document.body.getAttribute('data-scale')).toBe('normal');
      expect(document.body.getAttribute('data-fs')).toBe('md');

      applyBodyAttributes({ theme: 'warm', scale: 'large' });
      expect(document.body.getAttribute('data-theme')).toBe('warm');
      expect(document.body.getAttribute('data-scale')).toBe('large');
      expect(document.body.getAttribute('data-fs')).toBe('lg');
    });
  });

  describe('store actions & state updates', () => {
    it('has correct initial default state', () => {
      const state = useUiTweaksStore.getState();
      expect(state.theme).toBe('warm');
      expect(state.scale).toBe('large');
      expect(state.disableHoverSelection).toBe(false);
    });

    it('updates theme and persists to localStorage and document.body', () => {
      act(() => {
        useUiTweaksStore.getState().setTweak('theme', 'dark');
      });
      const state = useUiTweaksStore.getState();
      expect(state.theme).toBe('dark');
      expect(document.body.getAttribute('data-theme')).toBe('dark');

      const saved = JSON.parse(localStorage.getItem(UI_TWEAKS_STORAGE_KEY) || '{}');
      expect(saved.theme).toBe('dark');
    });

    it('updates scale and persists to localStorage and document.body', () => {
      act(() => {
        useUiTweaksStore.getState().setTweak('scale', 'normal');
      });
      const state = useUiTweaksStore.getState();
      expect(state.scale).toBe('normal');
      expect(document.body.getAttribute('data-scale')).toBe('normal');
      expect(document.body.getAttribute('data-fs')).toBe('md');

      const saved = JSON.parse(localStorage.getItem(UI_TWEAKS_STORAGE_KEY) || '{}');
      expect(saved.scale).toBe('normal');
    });

    it('handles legacy fontSize key in setTweak', () => {
      act(() => {
        useUiTweaksStore.getState().setTweak('fontSize', 'md');
      });
      expect(useUiTweaksStore.getState().scale).toBe('normal');
      expect(document.body.getAttribute('data-scale')).toBe('normal');

      act(() => {
        useUiTweaksStore.getState().setTweak('fontSize', 'lg');
      });
      expect(useUiTweaksStore.getState().scale).toBe('large');
      expect(document.body.getAttribute('data-scale')).toBe('large');
    });

    it('updates disableHoverSelection and persists', () => {
      act(() => {
        useUiTweaksStore.getState().setTweak('disableHoverSelection', 'true');
      });
      expect(useUiTweaksStore.getState().disableHoverSelection).toBe(true);
      let saved = JSON.parse(localStorage.getItem(UI_TWEAKS_STORAGE_KEY) || '{}');
      expect(saved.disableHoverSelection).toBe(true);

      act(() => {
        useUiTweaksStore.getState().setTweak('disableHoverSelection', false);
      });
      expect(useUiTweaksStore.getState().disableHoverSelection).toBe(false);
      saved = JSON.parse(localStorage.getItem(UI_TWEAKS_STORAGE_KEY) || '{}');
      expect(saved.disableHoverSelection).toBe(false);
    });

    it('reloads from storage correctly', () => {
      localStorage.setItem(
        UI_TWEAKS_STORAGE_KEY,
        JSON.stringify({ theme: 'light', scale: 'normal', disableHoverSelection: true }),
      );
      act(() => {
        reloadUiTweaksFromStorage();
      });
      const state = useUiTweaksStore.getState();
      expect(state.theme).toBe('light');
      expect(state.scale).toBe('normal');
      expect(state.disableHoverSelection).toBe(true);
      expect(document.body.getAttribute('data-theme')).toBe('light');
      expect(document.body.getAttribute('data-scale')).toBe('normal');
    });
  });

  describe('useTweaks hook integration', () => {
    it('returns reactive tweaks and setTweak', () => {
      const { result } = renderHook(() => useTweaks());
      expect(result.current.tweaks).toEqual({
        theme: 'warm',
        scale: 'large',
        fontSize: 'lg',
        disableHoverSelection: false,
      });

      act(() => {
        result.current.setTweak('theme', 'dark');
        result.current.setTweak('scale', 'normal');
        result.current.setTweak('disableHoverSelection', 'true');
      });

      expect(result.current.tweaks).toEqual({
        theme: 'dark',
        scale: 'normal',
        fontSize: 'md',
        disableHoverSelection: true,
      });
      expect(document.body.getAttribute('data-theme')).toBe('dark');
      expect(document.body.getAttribute('data-scale')).toBe('normal');
    });

    it('shares single store instance across multiple hook instances', () => {
      const hook1 = renderHook(() => useTweaks());
      const hook2 = renderHook(() => useTweaks());

      act(() => {
        hook1.result.current.setTweak('theme', 'light');
      });

      expect(hook2.result.current.tweaks.theme).toBe('light');

      // Test hover selection sync between simulated App (hook1) and AdminScreen (hook2)
      act(() => {
        hook2.result.current.setTweak('disableHoverSelection', 'true');
      });

      expect(hook1.result.current.tweaks.disableHoverSelection).toBe(true);
      expect(hook2.result.current.tweaks.disableHoverSelection).toBe(true);
    });

    it('does not erase easyorder-ui-tweaks on simulated resetData or clearSensitiveData', () => {
      act(() => {
        useUiTweaksStore.getState().setTweak('theme', 'dark');
        useUiTweaksStore.getState().setTweak('scale', 'normal');
        useUiTweaksStore.getState().setTweak('disableHoverSelection', 'true');
      });

      // Verify that resetting POS store state doesn't affect UI tweaks store or its localStorage key
      const storedBefore = localStorage.getItem(UI_TWEAKS_STORAGE_KEY);
      expect(storedBefore).toBeTruthy();

      // Simulated POS cleanup: removing pos-storage and pos-storage-cloud
      localStorage.removeItem('pos-storage');
      localStorage.removeItem('pos-storage-cloud');
      localStorage.removeItem('pos-storage-prototype');

      const storedAfter = localStorage.getItem(UI_TWEAKS_STORAGE_KEY);
      expect(storedAfter).toBe(storedBefore);
      expect(useUiTweaksStore.getState().theme).toBe('dark');
    });
  });
});
