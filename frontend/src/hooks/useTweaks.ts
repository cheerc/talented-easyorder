import { useEffect, useMemo } from 'react';
import { useUiTweaksStore, applyBodyAttributes, type UiTweaks } from '../store/uiTweaksStore';

export function useTweaks() {
  const theme = useUiTweaksStore(s => s.theme);
  const scale = useUiTweaksStore(s => s.scale);
  const disableHoverSelection = useUiTweaksStore(s => s.disableHoverSelection);
  const setTweak = useUiTweaksStore(s => s.setTweak);

  const tweaks: UiTweaks = useMemo(() => ({
    theme,
    scale,
    disableHoverSelection,
    fontSize: scale === 'large' ? 'lg' : 'md',
  }), [theme, scale, disableHoverSelection]);

  useEffect(() => {
    applyBodyAttributes({ theme, scale });
  }, [theme, scale]);

  return { tweaks, setTweak };
}
