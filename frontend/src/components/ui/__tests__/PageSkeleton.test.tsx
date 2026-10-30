import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PageSkeleton } from '../PageSkeleton';

describe('PageSkeleton', () => {
  it('以 status 朗讀「載入中」並保留高度，不用純文字取代版面', () => {
    const { container } = render(<PageSkeleton />);
    const status = screen.getByRole('status', { name: '載入中' });
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveClass('page-skeleton');
    expect(container.querySelectorAll('.page-skeleton__block').length).toBeGreaterThanOrEqual(3);
    expect(status.textContent).not.toContain('載入中...');
  });
});
