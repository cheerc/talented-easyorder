import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DateField } from '../DateField';

function Controlled({ onChange, onConfirm, ...rest }: { onChange: (v: string) => void; onConfirm: (v: string) => void; disabled?: boolean }) {
  // 頁面會把草稿值存起來再傳回 value；controlled input 才會在 Enter／blur 時讀到輸入的日期。
  const [value, setValue] = useState('2026-10-16');
  return (
    <DateField
      id="d"
      variant="date"
      value={value}
      min="2026-10-01"
      onChange={next => { setValue(next); onChange(next); }}
      onConfirm={onConfirm}
      {...rest}
    />
  );
}

function dateField(overrides: { disabled?: boolean } = {}) {
  const onChange = vi.fn();
  const onConfirm = vi.fn();
  const view = render(<Controlled onChange={onChange} onConfirm={onConfirm} {...overrides} />);
  return { ...view, onChange, onConfirm, input: () => screen.getByLabelText('營業日') as HTMLInputElement };
}

describe('DateField（#690：共用單日營業日控制項）', () => {
  describe('date variant', () => {
    it('labels the native date input 「營業日」 and passes value and min through', () => {
      const { input } = dateField();
      expect(input()).toHaveAttribute('type', 'date');
      expect(input()).toHaveValue('2026-10-16');
      expect(input()).toHaveAttribute('min', '2026-10-01');
      expect(input().closest('.date-field-ui')).not.toBeNull();
    });

    it('confirms right away when a complete date is picked (not typed)', () => {
      const { input, onChange, onConfirm } = dateField();
      fireEvent.change(input(), { target: { value: '2026-10-17' } });
      expect(onChange).toHaveBeenCalledWith('2026-10-17');
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onConfirm).toHaveBeenCalledWith('2026-10-17');
    });

    it('while typing, waits for Enter and confirms exactly once', () => {
      const { input, onChange, onConfirm } = dateField();
      fireEvent.keyDown(input(), { key: '7' });
      fireEvent.change(input(), { target: { value: '2026-10-17' } });
      expect(onChange).toHaveBeenCalledWith('2026-10-17');
      expect(onConfirm).not.toHaveBeenCalled();
      fireEvent.keyDown(input(), { key: 'Enter' });
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onConfirm).toHaveBeenCalledWith('2026-10-17');
    });

    it('while typing, also confirms when the field loses focus', () => {
      const { input, onConfirm } = dateField();
      fireEvent.keyDown(input(), { key: '7' });
      fireEvent.change(input(), { target: { value: '2026-10-17' } });
      expect(onConfirm).not.toHaveBeenCalled();
      fireEvent.blur(input());
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onConfirm).toHaveBeenCalledWith('2026-10-17');
    });

    it('does not count Tab or Escape as typing', () => {
      const { input, onConfirm } = dateField();
      fireEvent.keyDown(input(), { key: 'Tab' });
      fireEvent.keyDown(input(), { key: 'Escape' });
      fireEvent.change(input(), { target: { value: '2026-10-18' } });
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('ignores a held-down Enter and Enter while an IME composition is active', () => {
      const { input, onConfirm } = dateField();
      fireEvent.keyDown(input(), { key: 'Enter', repeat: true });
      fireEvent.keyDown(input(), { key: 'Enter', isComposing: true });
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('can be disabled', () => {
      const { input } = dateField({ disabled: true });
      expect(input()).toBeDisabled();
    });
  });

  describe('select variant', () => {
    const options = [{ value: '', label: '今天（2026-10-16）' }, { value: '2026-10-14', label: '補登中 2026-10-14' }];

    it('renders the caller options under the same 「營業日」 label and confirms on change', () => {
      const onConfirm = vi.fn();
      render(<DateField id="s" variant="select" value="" options={options} onConfirm={onConfirm} testId="orders-day-select" />);
      const select = screen.getByLabelText('營業日');
      expect(select.tagName).toBe('SELECT');
      expect(select).toHaveAttribute('data-testid', 'orders-day-select');
      expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual(['今天（2026-10-16）', '補登中 2026-10-14']);
      fireEvent.change(select, { target: { value: '2026-10-14' } });
      expect(onConfirm).toHaveBeenCalledWith('2026-10-14');
    });
  });

  describe('static variant', () => {
    it('shows the date once, in the same control look, still labelled 「營業日」', () => {
      const { container } = render(<DateField id="x" variant="static" value="2026-10-16" />);
      const control = screen.getByLabelText('營業日');
      expect(control).toHaveTextContent('2026-10-16');
      expect(control).toHaveClass('date-field-ui__control');
      expect(container.querySelectorAll('.date-field-ui')).toHaveLength(1);
    });
  });

  describe('shared structure', () => {
    it('uses the same root class and control class for every variant', () => {
      const { container } = render(
        <>
          <DateField id="a" variant="date" value="2026-10-16" onChange={() => {}} onConfirm={() => {}} />
          <DateField id="b" variant="select" value="" options={[{ value: '', label: '今天' }]} onConfirm={() => {}} />
          <DateField id="c" variant="static" value="2026-10-16" />
        </>,
      );
      const roots = container.querySelectorAll('.date-field-ui');
      expect(roots).toHaveLength(3);
      roots.forEach(root => {
        expect(root.querySelector('label.date-field-ui__label')).toHaveTextContent('營業日');
        expect(root.querySelector('.date-field-ui__control')).not.toBeNull();
      });
    });

    it('renders the status slot beside the control, and a help tip when given', () => {
      render(<DateField id="a" variant="date" value="2026-10-16" onChange={() => {}} onConfirm={() => {}} status={<span data-testid="slot">今天</span>} help="改日期後會直接載入該日資料。" />);
      expect(screen.getByTestId('slot').closest('.date-field-ui__status')).not.toBeNull();
      expect(screen.getByRole('button', { name: '營業日說明' })).toBeInTheDocument();
    });

    it('offers a compact size without a second component', () => {
      const { container } = render(<DateField id="a" variant="static" value="2026-10-16" size="compact" />);
      expect(container.querySelector('.date-field-ui')).toHaveClass('date-field-ui--compact');
    });
  });
});
