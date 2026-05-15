import React from 'react';
import './Kbd.css';

interface KbdProps {
  children: React.ReactNode;
  size?: 'sm' | 'lg';
  className?: string;
}

export const Kbd = React.memo(function Kbd({
  children,
  size,
  className = '',
}: KbdProps) {
  const cls = ['kbd-ui', size === 'lg' ? 'kbd-ui-lg' : '', className]
    .filter(Boolean)
    .join(' ');

  return <kbd className={cls}>{children}</kbd>;
});
