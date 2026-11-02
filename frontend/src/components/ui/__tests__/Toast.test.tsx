import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toast } from '../Toast';

describe('Toast', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('keeps its status region mounted even without a message so screen readers announce the next one', () => {
    render(<Toast message="" />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('shows the message and hides it by itself after 4 seconds', () => {
    render(<Toast message="已確認 001 王小明 訂餐完成" />);
    expect(screen.getByTestId('toast')).toHaveTextContent('已確認 001 王小明 訂餐完成');
    act(() => { vi.advanceTimersByTime(3_999); });
    expect(screen.getByTestId('toast')).toBeVisible();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByTestId('toast')).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows a new message again and restarts the timer', () => {
    const { rerender } = render(<Toast message="第一句" />);
    act(() => { vi.advanceTimersByTime(4_000); });
    expect(screen.queryByTestId('toast')).toBeNull();
    rerender(<Toast message="第二句" />);
    expect(screen.getByTestId('toast')).toHaveTextContent('第二句');
    act(() => { vi.advanceTimersByTime(3_999); });
    expect(screen.getByTestId('toast')).toBeVisible();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('honours durationMs', () => {
    render(<Toast message="可撤回" durationMs={5_000} />);
    act(() => { vi.advanceTimersByTime(4_999); });
    expect(screen.getByTestId('toast')).toBeVisible();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('does not restart the timer when only its duration changes', () => {
    const { rerender } = render(<Toast message="可撤回" durationMs={5_000} />);
    act(() => { vi.advanceTimersByTime(4_500); });
    rerender(<Toast message="可撤回" durationMs={4_000} />);
    act(() => { vi.advanceTimersByTime(600); });
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('closes with its close button and renders an action next to the message', () => {
    render(<Toast message="已確認" action={<button type="button">撤回</button>} testId="my-toast" />);
    expect(screen.getByTestId('my-toast')).toBeVisible();
    expect(screen.getByRole('button', { name: '撤回' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '關閉通知' }));
    expect(screen.queryByTestId('my-toast')).toBeNull();
  });

  it('shows an action without a message', () => {
    render(<Toast message="" action={<button type="button">撤回</button>} />);
    expect(screen.getByRole('button', { name: '撤回' })).toBeVisible();
  });
});
