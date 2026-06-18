import { render, screen, fireEvent } from '@testing-library/react';
import { NumericInput } from '../NumericInput';

describe('NumericInput IME detection (#403)', () => {
  it('ignores keyDown when isComposing is true', () => {
    const onKeyDown = vi.fn();
    render(<NumericInput onKeyDown={onKeyDown} />);
    const input = screen.getByRole('spinbutton');

    // Dispatch a native KeyboardEvent with isComposing=true
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    // Override isComposing (readonly in KeyboardEvent)
    Object.defineProperty(event, 'isComposing', { value: true });
    input.dispatchEvent(event);

    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('detects non-ASCII input and restores previous value', () => {
    const onChange = vi.fn();
    render(<NumericInput value="123" onChange={onChange} />);
    const input = screen.getByRole('spinbutton') as HTMLInputElement;

    // Simulate IME producing Chinese characters via native event
    // jsdom sanitizes type=number, so we set value directly and trigger change
    Object.defineProperty(input, 'value', { value: '一二三', writable: true, configurable: true });
    fireEvent.change(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('passes through normal digit input', () => {
    const onChange = vi.fn();
    render(<NumericInput value="" onChange={onChange} />);
    const input = screen.getByRole('spinbutton');

    fireEvent.change(input, { target: { value: '456' } });
    expect(onChange).toHaveBeenCalledWith('456');
  });

  it('passes through empty string input', () => {
    const onChange = vi.fn();
    render(<NumericInput value="123" onChange={onChange} />);
    const input = screen.getByRole('spinbutton');

    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('forwards keyDown for normal keys when not composing', () => {
    const onKeyDown = vi.fn();
    render(<NumericInput onKeyDown={onKeyDown} />);
    const input = screen.getByRole('spinbutton');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onKeyDown).toHaveBeenCalled();
  });
});
