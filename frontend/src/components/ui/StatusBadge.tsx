import React from 'react';
import './StatusBadge.css';

type BadgeVariant = 'neutral' | 'ok' | 'warn' | 'err';

interface StatusBadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export const StatusBadge = React.memo(function StatusBadge({
  children,
  variant = 'neutral',
  className = '',
}: StatusBadgeProps) {
  return (
    <span className={['badge-ui', `badge-${variant}`, className].filter(Boolean).join(' ')}>
      {children}
    </span>
  );
});
