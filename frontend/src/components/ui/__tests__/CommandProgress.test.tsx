import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CommandProgress } from '../CommandProgress';

describe('CommandProgress', () => {
  it('mirrors its active flag and is not announced', () => {
    const { rerender } = render(<CommandProgress active />);
    const bar = screen.getByTestId('command-progress');
    expect(bar).toHaveAttribute('data-active', 'true');
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    rerender(<CommandProgress active={false} />);
    expect(screen.getByTestId('command-progress')).toHaveAttribute('data-active', 'false');
  });
});
