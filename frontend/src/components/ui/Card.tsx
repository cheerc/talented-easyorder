import React from 'react';
import './Card.css';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  as?: 'section' | 'article' | 'div';
}

export const Card = React.memo(function Card({
  children,
  className = '',
  as: Tag = 'section',
}: CardProps) {
  return (
    <Tag className={['card-ui', className].filter(Boolean).join(' ')}>
      {children}
    </Tag>
  );
});
