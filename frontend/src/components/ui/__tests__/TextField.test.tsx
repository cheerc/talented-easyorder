import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextField } from '../TextField';

describe('TextField', () => {
  it('renders label and input', () => {
    render(<TextField label="姓名" />);
    expect(screen.getByText('姓名')).toBeDefined();
    expect(screen.getByRole('textbox')).toBeDefined();
  });

  it('has accessible name from label', () => {
    render(<TextField label="姓名" />);
    expect(screen.getByRole('textbox', { name: '姓名' })).toBeDefined();
  });

  it('calls onChange on input', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TextField label="姓名" onChange={onChange} />);
    await user.type(screen.getByRole('textbox'), 'a');
    expect(onChange).toHaveBeenCalled();
  });

  it('displays error message', () => {
    render(<TextField label="姓名" error="必填" />);
    expect(screen.getByText('必填')).toBeDefined();
  });

  it('displays help text', () => {
    render(<TextField label="姓名" help="全名" />);
    expect(screen.getByText('全名')).toBeDefined();
  });

  it('passes placeholder to input', () => {
    render(<TextField label="姓名" placeholder="輸入..." />);
    expect(screen.getByPlaceholderText('輸入...')).toBeDefined();
  });
});
