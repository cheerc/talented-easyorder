import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatTile } from '../StatTile';

describe('StatTile', () => {
  it('顯示標籤與數字', () => {
    render(<StatTile label="今日份數" value="128" />);
    expect(screen.getByText('今日份數')).toBeTruthy();
    expect(screen.getByText('128').className).toContain('stat-tile-ui__value');
  });

  it('標籤與數字合併成一個可讀的群組名稱', () => {
    render(<StatTile label="今日份數" value="128" />);
    expect(screen.getByRole('group', { name: '今日份數 128' })).toBeTruthy();
  });

  it('warn 套用警示 class，預設不套', () => {
    const { rerender, container } = render(<StatTile label="A" value="1" />);
    expect(container.querySelector('.stat-tile-ui--warn')).toBeNull();
    rerender(<StatTile label="A" value="1" warn />);
    expect(container.querySelector('.stat-tile-ui--warn')).not.toBeNull();
  });
});
