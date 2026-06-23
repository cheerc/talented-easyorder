import { render, screen, fireEvent } from '@testing-library/react';
import { NumericInput } from '../NumericInput';

describe('NumericInput IME detection (#403)', () => {
  it('ignores keyDown when isComposing is true', () => {
    const onKeyDown = vi.fn();
    render(<NumericInput onKeyDown={onKeyDown} />);
    const input = screen.getByRole('textbox');

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    Object.defineProperty(event, 'isComposing', { value: true });
    input.dispatchEvent(event);

    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('detects non-ASCII input and restores previous value', () => {
    const onChange = vi.fn();
    render(<NumericInput value="123" onChange={onChange} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    // With type="text", e.target.value contains actual IME characters
    fireEvent.change(input, { target: { value: 'ㄆㄊㄍ' } });
    expect(onChange).not.toHaveBeenCalled();
    // Value should be restored to previous
    expect(input.value).toBe('123');
  });

  it('passes through normal digit input', () => {
    const onChange = vi.fn();
    render(<NumericInput value="" onChange={onChange} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: '456' } });
    expect(onChange).toHaveBeenCalledWith('456');
  });

  it('passes through empty string input', () => {
    const onChange = vi.fn();
    render(<NumericInput value="123" onChange={onChange} />);
    const input = screen.getByRole('textbox');

    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('forwards keyDown for normal keys when not composing', () => {
    const onKeyDown = vi.fn();
    render(<NumericInput onKeyDown={onKeyDown} />);
    const input = screen.getByRole('textbox');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onKeyDown).toHaveBeenCalled();
  });

  it('blocks letter keys (a-z) via preventDefault', () => {
    const onKeyDown = vi.fn();
    render(<NumericInput onKeyDown={onKeyDown} />);
    const input = screen.getByRole('textbox');

    const event = new KeyboardEvent('keydown', {
      key: 'a',
      bubbles: true,
      cancelable: true,
    });
    const preventSpy = vi.spyOn(event, 'preventDefault');
    input.dispatchEvent(event);

    expect(preventSpy).toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('allows digit keys through', () => {
    const onKeyDown = vi.fn();
    render(<NumericInput onKeyDown={onKeyDown} />);
    const input = screen.getByRole('textbox');

    fireEvent.keyDown(input, { key: '5' });
    expect(onKeyDown).toHaveBeenCalled();
  });

  it('has data-numeric-input attribute', () => {
    render(<NumericInput />);
    const input = screen.getByRole('textbox');
    expect(input.getAttribute('data-numeric-input')).toBe('true');
  });

  it('has inputMode="numeric" and pattern', () => {
    render(<NumericInput />);
    const input = screen.getByRole('textbox');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('pattern')).toBe('[0-9]*');
  });
});
