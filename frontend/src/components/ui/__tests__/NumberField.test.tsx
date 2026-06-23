import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NumberField } from '../NumberField';

describe('NumberField', () => {
  it('renders label and input', () => {
    render(<NumberField label="金額" />);
    expect(screen.getByText('金額')).toBeDefined();
    expect(screen.getByRole('textbox')).toBeDefined();
  });

  it('has accessible name from label', () => {
    render(<NumberField label="金額" />);
    expect(screen.getByRole('textbox', { name: '金額' })).toBeDefined();
  });

  it('calls onChange with numeric value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NumberField label="金額" onChange={onChange} />);
    await user.type(screen.getByRole('textbox'), '42');
    expect(onChange).toHaveBeenCalled();
  });

  it('displays error message', () => {
    render(<NumberField label="金額" error="必須為正數" />);
    expect(screen.getByText('必須為正數')).toBeDefined();
  });

  it('renders prefix when provided', () => {
    render(<NumberField label="金額" prefix="$" />);
    expect(screen.getByText('$')).toBeDefined();
  });

  it('renders suffix when provided', () => {
    render(<NumberField label="金額" suffix="元" />);
    expect(screen.getByText('元')).toBeDefined();
  });
});
