import { create } from 'zustand';

export type UiTheme = 'warm' | 'light' | 'dark';
export type UiScale = 'normal' | 'large';

export interface UiTweaksPersisted {
  theme: UiTheme;
  scale: UiScale;
  disableHoverSelection: boolean;
}

export interface UiTweaks extends UiTweaksPersisted {
  /** Backward-compatible alias for scale: 'large' -> 'lg', 'normal' -> 'md' */
  fontSize: 'md' | 'lg';
}

export const UI_TWEAKS_STORAGE_KEY = 'easyorder-ui-tweaks';

export const DEFAULT_UI_TWEAKS: UiTweaksPersisted = {
  theme: 'warm',
  scale: 'large',
  disableHoverSelection: false,
};

export function parseUiTweaks(raw: unknown): UiTweaksPersisted {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_UI_TWEAKS };
  }
  const obj = raw as Record<string, unknown>;

  let theme: UiTheme = DEFAULT_UI_TWEAKS.theme;
  if (obj.theme === 'warm' || obj.theme === 'light' || obj.theme === 'dark') {
    theme = obj.theme;
  }

  let scale: UiScale = DEFAULT_UI_TWEAKS.scale;
  if (obj.scale === 'normal' || obj.scale === 'large') {
    scale = obj.scale;
  } else if (obj.fontSize === 'lg' || obj.fontSize === 'large') {
    scale = 'large';
  } else if (obj.fontSize === 'md' || obj.fontSize === 'normal') {
    scale = 'normal';
  }

  let disableHoverSelection: boolean = DEFAULT_UI_TWEAKS.disableHoverSelection;
  if (typeof obj.disableHoverSelection === 'boolean') {
    disableHoverSelection = obj.disableHoverSelection;
  } else if (obj.disableHoverSelection === 'true') {
    disableHoverSelection = true;
  } else if (obj.disableHoverSelection === 'false') {
    disableHoverSelection = false;
  }

  return { theme, scale, disableHoverSelection };
}

export function loadPersistedUiTweaks(): UiTweaksPersisted {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ...DEFAULT_UI_TWEAKS };
    }
    const raw = window.localStorage.getItem(UI_TWEAKS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_UI_TWEAKS };
    const parsed = JSON.parse(raw);
    return parseUiTweaks(parsed);
  } catch {
    return { ...DEFAULT_UI_TWEAKS };
  }
}

export function savePersistedUiTweaks(tweaks: UiTweaksPersisted): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const payload: UiTweaksPersisted = {
      theme: tweaks.theme,
      scale: tweaks.scale,
      disableHoverSelection: tweaks.disableHoverSelection,
    };
    window.localStorage.setItem(UI_TWEAKS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // QuotaExceededError or private browsing / SecurityError restrictions
  }
}

export function applyBodyAttributes(tweaks: { theme: UiTheme; scale: UiScale }): void {
  if (typeof document === 'undefined' || !document.body) return;
  document.body.setAttribute('data-theme', tweaks.theme);
  document.body.setAttribute('data-scale', tweaks.scale);
  document.body.setAttribute('data-fs', tweaks.scale === 'large' ? 'lg' : 'md');
}

export interface UiTweaksState extends UiTweaksPersisted {
  setTweak: (key: string, value: string | boolean) => void;
  setTweaks: (updates: Partial<UiTweaksPersisted & { fontSize?: string }>) => void;
  resetToDefault: () => void;
}

export const useUiTweaksStore = create<UiTweaksState>((set, get) => {
  const initial = loadPersistedUiTweaks();
  applyBodyAttributes(initial);

  return {
    ...initial,
    setTweak: (key: string, value: string | boolean) => {
      const current = get();
      let nextTheme = current.theme;
      let nextScale = current.scale;
      let nextHover = current.disableHoverSelection;

      if (key === 'theme') {
        if (value === 'warm' || value === 'light' || value === 'dark') {
          nextTheme = value;
        }
      } else if (key === 'scale') {
        if (value === 'normal' || value === 'large') {
          nextScale = value;
        }
      } else if (key === 'fontSize') {
        nextScale = (value === 'lg' || value === 'large') ? 'large' : 'normal';
      } else if (key === 'disableHoverSelection') {
        nextHover = typeof value === 'boolean' ? value : value === 'true';
      }

      const nextState: UiTweaksPersisted = {
        theme: nextTheme,
        scale: nextScale,
        disableHoverSelection: nextHover,
      };

      set(nextState);
      savePersistedUiTweaks(nextState);
      applyBodyAttributes(nextState);
    },
    setTweaks: (updates: Partial<UiTweaksPersisted & { fontSize?: string }>) => {
      const current = get();
      const nextState: UiTweaksPersisted = parseUiTweaks({
        ...current,
        ...updates,
      });
      set(nextState);
      savePersistedUiTweaks(nextState);
      applyBodyAttributes(nextState);
    },
    resetToDefault: () => {
      const nextState = { ...DEFAULT_UI_TWEAKS };
      set(nextState);
      savePersistedUiTweaks(nextState);
      applyBodyAttributes(nextState);
    },
  };
});

export function reloadUiTweaksFromStorage(): UiTweaksPersisted {
  const reloaded = loadPersistedUiTweaks();
  useUiTweaksStore.setState(reloaded);
  applyBodyAttributes(reloaded);
  return reloaded;
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === UI_TWEAKS_STORAGE_KEY) {
      reloadUiTweaksFromStorage();
    }
  });
}
