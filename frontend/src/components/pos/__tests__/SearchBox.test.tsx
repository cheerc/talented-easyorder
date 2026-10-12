import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchBox } from '../../pos/SearchBox';
import type { StudentAccount } from '../../../domain/student';

// Ref: #350 — Tests for POS SearchBox component

function makeStudent(overrides: Record<string, unknown> = {}): StudentAccount {
  return {
    studentId: 's1',
    displayName: '王小明',
    currentBalance: 500,
    ...overrides,
  } as StudentAccount;
}

describe('SearchBox', () => {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onEsc: vi.fn(),
    suggestions: [] as StudentAccount[],
    activeIdx: 0,
    onPick: vi.fn(),
    onHover: vi.fn(),
    focusKey: 0,
    disabled: false,
  };

  it('renders input with label', () => {
    render(<SearchBox {...defaultProps} />);
    expect(screen.getByLabelText('輸入學員編號或姓名')).toBeDefined();
  });

  it('calls onChange when typing', () => {
    const onChange = vi.fn();
    render(<SearchBox {...defaultProps} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('輸入學員編號或姓名'), { target: { value: '015' } });
    expect(onChange).toHaveBeenCalledWith('015');
  });

  it('calls onSubmit on Enter with non-empty value', () => {
    const onSubmit = vi.fn();
    render(<SearchBox {...defaultProps} value="015" onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByLabelText('輸入學員編號或姓名'), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalled();
  });

  it('does not show suggestions when value is empty', () => {
    const suggestions = [makeStudent()];
    render(<SearchBox {...defaultProps} suggestions={suggestions} value="" />);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows suggestions when value is non-empty', () => {
    const suggestions = [makeStudent()];
    render(<SearchBox {...defaultProps} suggestions={suggestions} value="王" />);
    expect(screen.getByRole('listbox')).toBeDefined();
    expect(screen.getByText('王小明')).toBeDefined();
  });

  it('calls onPick when suggestion is clicked', () => {
    const student = makeStudent();
    const onPick = vi.fn();
    render(<SearchBox {...defaultProps} suggestions={[student]} value="王" onPick={onPick} />);
    fireEvent.click(screen.getByText('王小明'));
    expect(onPick).toHaveBeenCalledWith(student);
  });

  it('shows expense button when onEnterExpense is provided', () => {
    const onEnterExpense = vi.fn();
    render(<SearchBox {...defaultProps} onEnterExpense={onEnterExpense} />);
    expect(screen.getByText('新增櫃台收支')).toBeDefined();
  });

  it('disables input when disabled prop is true', () => {
    render(<SearchBox {...defaultProps} disabled={true} />);
    const input = screen.getByLabelText('輸入學員編號或姓名') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });

  it('shows debt styling for negative balance', () => {
    const student = makeStudent({ currentBalance: -100 });
    render(<SearchBox {...defaultProps} suggestions={[student]} value="王" />);
    expect(screen.getByText(/欠/)).toBeDefined();
  });
});

describe('SearchBox long lists and keyboard (M1 F01 / K02)', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({
    studentId: `01${i}`, displayName: `學員${i}`, currentBalance: 100, status: 'active', aliases: [],
  }) as unknown as StudentAccount);
  const base = {
    value: '01', onChange: vi.fn(), onSubmit: vi.fn(), onEsc: vi.fn(), suggestions: many,
    activeIdx: 0, onPick: vi.fn(), onHover: vi.fn(), focusKey: 0, disabled: false,
  };

  it('renders every candidate (no hidden 7th row) and highlights the active one', () => {
    render(<SearchBox {...base} activeIdx={7} />);
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(9);
    expect(options[7].getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText(/共 9 筆/)).toBeDefined();
  });

  it('ArrowDown stops at the last visible candidate and ArrowUp at the first', () => {
    const onHover = vi.fn();
    const { rerender } = render(<SearchBox {...base} activeIdx={8} onHover={onHover} />);
    const input = screen.getByLabelText('輸入學員編號或姓名');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(onHover).toHaveBeenLastCalledWith(8);
    rerender(<SearchBox {...base} activeIdx={0} onHover={onHover} />);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onHover).toHaveBeenLastCalledWith(0);
  });

  it('shows a no-result message for an unknown code', () => {
    render(<SearchBox {...base} value="999" suggestions={[]} />);
    expect(screen.getByRole('status').textContent).toContain('找不到「999」');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Enter while an input method is composing does not submit', () => {
    const onSubmit = vi.fn();
    render(<SearchBox {...base} onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByLabelText('輸入學員編號或姓名'), { key: 'Enter', isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText('輸入學員編號或姓名'), { key: 'Enter', keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
