import React from 'react';
import './Button.css';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'> {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

const ButtonImpl = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { children, variant = 'primary', size = 'md', className = '', type = 'button', ...rest },
  ref,
) {
  const cls = ['btn-ui', `btn-${variant}`, size !== 'md' ? `btn-${size}` : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <button {...rest} ref={ref} type={type} className={cls}>
      {children}
    </button>
  );
});

export const Button = React.memo(ButtonImpl);
