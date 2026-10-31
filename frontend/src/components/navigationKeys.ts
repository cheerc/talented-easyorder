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

// Set by compositionstart and cleared by compositionend. A browser is not required to send compositionend (#568), so the state
// is also cleared when the composing element loses focus or the window does, and ignored once that element left the page.
let compositionTarget: EventTarget | null = null;

if (typeof window !== 'undefined') {
  const clear = () => { compositionTarget = null; };
  window.addEventListener('compositionstart', event => { compositionTarget = event.target ?? window; });
  window.addEventListener('compositionend', clear);
  window.addEventListener('focusout', clear);
  window.addEventListener('blur', clear);
}

function compositionActive(): boolean {
  return compositionTarget !== null && (!(compositionTarget instanceof Node) || compositionTarget.isConnected);
}

export function isCompositionKey(event: KeyboardEvent): boolean {
  return compositionActive() || event.isComposing || event.keyCode === 229;
}
