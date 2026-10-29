export const NAVIGATION = [
  { id: 'pos', label: '櫃台', hint: 'F1' },
  { id: 'report', label: '今日帳', hint: 'F2' },
  { id: 'admin', label: '今日設定', hint: 'F3' },
  { id: 'vendors', label: '供應商', hint: 'F4' },
  { id: 'history', label: '歷史', hint: 'F5' },
] as const;

export function navigationKey(event: KeyboardEvent): number | null {
  if (event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (!event.altKey && /^F[1-5]$/.test(event.key)) return Number(event.key.slice(1)) - 1;
  if (event.altKey && /^Digit[1-5]$/.test(event.code)) return Number(event.code.slice(5)) - 1;
  return null;
}

let compositionActive = false;
let compositionTracked = false;

function ensureCompositionTracking() {
  if (compositionTracked || typeof window === 'undefined') return;
  compositionTracked = true;
  window.addEventListener('compositionstart', () => { compositionActive = true; });
  window.addEventListener('compositionend', () => { compositionActive = false; });
}

export function isCompositionKey(event: KeyboardEvent): boolean {
  ensureCompositionTracking();
  return compositionActive || event.isComposing || event.keyCode === 229;
}
