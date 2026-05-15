import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from '../ErrorBoundary';

function Boom({ msg }: { msg?: string }) {
  throw new Error(msg ?? 'test crash');
}

function Quiet({ text }: { text?: string }) {
  return <div>{text ?? 'ok'}</div>;
}

describe('ErrorBoundary', () => {
  // Suppress React console.error noise from intentional crashes
  let originalError: typeof console.error;
  beforeEach(() => {
    originalError = console.error;
    console.error = vi.fn();
  });
  afterEach(() => {
    console.error = originalError;
  });

  it('renders children when nothing crashes', () => {
    render(
      <ErrorBoundary fallback={<div>boom</div>}>
        <Quiet text="hello" />
      </ErrorBoundary>
    );
    expect(screen.getByText('hello')).toBeDefined();
  });

  it('renders fallback when child throws', () => {
    render(
      <ErrorBoundary fallback={<div>custom error ui</div>}>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText('custom error ui')).toBeDefined();
  });

  it('calls onError when child throws', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary fallback={<div>err</div>} onError={onError}>
        <Boom msg="specific error" />
      </ErrorBoundary>
    );
    expect(onError).toHaveBeenCalled();
    const err: Error = onError.mock.calls[0][0];
    expect(err.message).toBe('specific error');
  });

  it('resets error state on retry and re-renders children', async () => {
    const user = userEvent.setup();
    let shouldCrash = true;

    function Flaky() {
      if (shouldCrash) throw new Error('first render crash');
      return <div>recovered</div>;
    }

    render(
      <ErrorBoundary fallback={<div>fallback</div>}>
        <Flaky />
      </ErrorBoundary>
    );

    // Initially shows fallback
    expect(screen.getByText('fallback')).toBeDefined();

    // Reset the crash flag and click retry
    shouldCrash = false;
    await user.click(screen.getByText('重試'));

    // Should now show recovered content
    expect(screen.getByText('recovered')).toBeDefined();
  });
});
