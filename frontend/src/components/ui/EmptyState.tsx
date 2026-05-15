import React from 'react';
import './EmptyState.css';

interface EmptyStateProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}

export const EmptyState = React.memo(function EmptyState({
  title,
  description,
  children,
  className = '',
}: EmptyStateProps) {
  return (
    <div className={['empty-ui', className].filter(Boolean).join(' ')}>
      <div className="empty-icon">📭</div>
      <div className="empty-title">{title}</div>
      {description && <div className="empty-desc">{description}</div>}
      {children && <div className="empty-actions">{children}</div>}
    </div>
  );
});
