import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Kbd } from '../Kbd';

describe('Kbd', () => {
  it('renders children', () => {
    render(<Kbd>↵</Kbd>);
    expect(screen.getByText('↵')).toBeDefined();
  });

  it('applies default kbd class', () => {
    render(<Kbd>Esc</Kbd>);
    const el = screen.getByText('Esc');
    expect(el.className).toContain('kbd-ui');
  });

  it('applies lg size class', () => {
    render(<Kbd size="lg">↵</Kbd>);
    const el = screen.getByText('↵');
    expect(el.className).toContain('kbd-ui-lg');
  });

  it('renders as kbd element', () => {
    render(<Kbd>Ctrl</Kbd>);
    const el = screen.getByText('Ctrl');
    expect(el.tagName).toBe('KBD');
  });

  it('applies additional className', () => {
    render(<Kbd className="light">F1</Kbd>);
    const el = screen.getByText('F1');
    expect(el.className).toContain('light');
  });
});
