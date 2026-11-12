import { useEffect, useRef, type ReactNode } from 'react';

import { NAVIGATION } from './navigationKeys';

export function AppShell({ brand, active, select, status, disabled = false }: {
  brand: ReactNode; active: string; select: (id: string) => void; status?: ReactNode; disabled?: boolean;
}) {
  const tabsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const tabs = tabsRef.current;
    const current = tabs?.querySelector<HTMLElement>('.tab-on');
    // F 鍵／Alt+數字切頁後，若焦點還在分頁列裡（例如滑鼠點過舊分頁），讓焦點跟著目前頁，不留在舊分頁也不掉到 body（#705）。
    if (current && tabs?.contains(document.activeElement) && document.activeElement !== current) current.focus({ preventScroll: true });
    current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  return <header className="topbar app-shell">
    {brand}
    <nav className="tabs" aria-label="主要導覽" ref={tabsRef}>
      {NAVIGATION.map(tab => <button type="button" key={tab.id} className={'tab ' + (active === tab.id ? 'tab-on' : '')} aria-current={active === tab.id ? 'page' : undefined} disabled={disabled} onClick={() => select(tab.id)}><span>{tab.label}</span><kbd className="tab-key" aria-hidden="true">{tab.hint}</kbd></button>)}
    </nav>
    {status}
  </header>;
}
