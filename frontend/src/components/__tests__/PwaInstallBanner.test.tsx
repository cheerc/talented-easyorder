import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PwaInstallBanner } from '../PwaInstallBanner';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

describe('PwaInstallBanner', () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  const listeners: Record<string, (e: AnyObj) => void> = {};

  beforeEach(() => {
    addEventListenerSpy = vi.spyOn(window, 'addEventListener').mockImplementation(
      (type: string, handler: AnyObj) => {
        listeners[type] = handler;
      }
    );
  });

  afterEach(() => {
    addEventListenerSpy.mockRestore();
    delete listeners['beforeinstallprompt'];
  });

  it('does not render banner initially (no install prompt stored)', () => {
    render(<PwaInstallBanner />);
    expect(screen.queryByText('安裝此應用程式')).toBeNull();
  });

  it('renders banner after beforeinstallprompt fires', () => {
    render(<PwaInstallBanner />);
    const mockEvent = {
      prompt: vi.fn(),
      preventDefault: vi.fn(),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    };
    act(() => {
      listeners['beforeinstallprompt']?.(mockEvent);
    });
    expect(screen.getByText('安裝此應用程式')).toBeDefined();
  });

  it('calls prompt() when install button clicked', async () => {
    const user = userEvent.setup();
    const mockPrompt = vi.fn();
    render(<PwaInstallBanner />);
    act(() => {
      listeners['beforeinstallprompt']?.({
        prompt: mockPrompt,
        preventDefault: vi.fn(),
        userChoice: Promise.resolve({ outcome: 'accepted' as const }),
      });
    });
    await user.click(screen.getByText('安裝'));
    expect(mockPrompt).toHaveBeenCalled();
  });

  it('hides banner after dismiss click', async () => {
    const user = userEvent.setup();
    const mockPrompt = vi.fn();
    render(<PwaInstallBanner />);
    act(() => {
      listeners['beforeinstallprompt']?.({
        prompt: mockPrompt,
        preventDefault: vi.fn(),
        userChoice: Promise.resolve({ outcome: 'accepted' as const }),
      });
    });
    await user.click(screen.getByText('稍後'));
    expect(screen.queryByText('安裝此應用程式')).toBeNull();
  });

  it('hides banner after successful install', async () => {
    const user = userEvent.setup();
    const mockPrompt = vi.fn();
    render(<PwaInstallBanner />);
    act(() => {
      listeners['beforeinstallprompt']?.({
        prompt: mockPrompt,
        preventDefault: vi.fn(),
        userChoice: Promise.resolve({ outcome: 'accepted' as const }),
      });
    });
    await user.click(screen.getByText('安裝'));
    // After userChoice resolves to 'accepted', banner hides
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText('安裝此應用程式')).toBeNull();
  });
});
