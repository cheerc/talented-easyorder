import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Field } from '../Field';

describe('Field', () => {
  it('renders label', () => {
    render(<Field label="姓名"><input /></Field>);
    expect(screen.getByText('姓名')).toBeDefined();
  });

  it('renders help text', () => {
    render(<Field label="姓名" help="請輸入全名"><input /></Field>);
    expect(screen.getByText('請輸入全名')).toBeDefined();
  });

  it('renders error message', () => {
    render(<Field label="姓名" error="此欄位必填"><input /></Field>);
    expect(screen.getByText('此欄位必填')).toBeDefined();
  });

  it('associates label with input via htmlFor', () => {
    render(<Field label="姓名" htmlFor="name"><input id="name" /></Field>);
    const label = screen.getByText('姓名');
    expect(label.getAttribute('for')).toBe('name');
  });

  it('applies error class when error is set', () => {
    render(<Field label="姓名" error="必填"><input /></Field>);
    const field = screen.getByText('姓名').closest('.field-ui');
    expect(field?.className).toContain('field-err');
  });
});
