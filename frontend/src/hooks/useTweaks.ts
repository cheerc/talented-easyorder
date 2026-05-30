import { useState, useEffect } from 'react';

export function useTweaks() {
  const [tweaks, setTweaks] = useState({ theme: 'warm', fontSize: 'lg', disableHoverSelection: true });
  const setTweak = (k: string, v: string) => setTweaks(prev => {
    if (k === 'disableHoverSelection') {
      return { ...prev, disableHoverSelection: v === 'true' };
    }
    return { ...prev, [k]: v };
  });

  useEffect(() => {
    document.body.setAttribute('data-fs', tweaks.fontSize);
    document.body.setAttribute('data-theme', tweaks.theme);
  }, [tweaks]);

  return { tweaks, setTweak };
}
