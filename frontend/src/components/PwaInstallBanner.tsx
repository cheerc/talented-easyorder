import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from './ui/Button';

export const PwaInstallBanner = React.memo(function PwaInstallBanner() {
  const [show, setShow] = useState(false);
  const deferredPromptRef = useRef<Event | null>(null);

  const onBeforeInstall = useCallback((e: Event) => {
    e.preventDefault();
    deferredPromptRef.current = e;
    setShow(true);
  }, []);

  useEffect(() => {
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, [onBeforeInstall]);

  const handleInstall = useCallback(async () => {
    const evt = deferredPromptRef.current as { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> } | null;
    if (!evt) return;
    await evt.prompt();
    const choice = await evt.userChoice;
    if (choice.outcome === 'accepted') {
      deferredPromptRef.current = null;
      setShow(false);
    }
  }, []);

  const handleDismiss = useCallback(() => {
    deferredPromptRef.current = null;
    setShow(false);
  }, []);

  if (!show) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      background: 'var(--panel)',
      borderTop: '1px solid var(--line)',
      padding: '16px 24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '14px',
      zIndex: 40,
      boxShadow: '0 -4px 16px rgba(0,0,0,0.08)',
    }}>
      <span style={{ fontSize: '15px', fontWeight: 500, color: 'var(--ink)' }}>
        安裝此應用程式
      </span>
      <span style={{ fontSize: '13px', color: 'var(--ink-3)' }}>
        快速存取，離線也能使用
      </span>
      <div style={{ display: 'flex', gap: '8px', marginLeft: '12px' }}>
        <Button variant="ghost" size="sm" onClick={handleDismiss}>
          稍後
        </Button>
        <Button size="sm" onClick={handleInstall}>
          安裝
        </Button>
      </div>
    </div>
  );
});
