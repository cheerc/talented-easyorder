import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Callout } from '../Callout';

describe('Callout', () => {
  it.each(['warn', 'ok', 'info'] as const)('%s 變體套用對應 class 並顯示文字', variant => {
    render(<Callout variant={variant}>內容文字</Callout>);
    const el = screen.getByText('內容文字').closest('.callout-ui')!;
    expect(el.className).toContain(`callout-${variant}`);
  });

  it('圖示只供裝飾，不進 accessible tree', () => {
    const { container } = render(<Callout variant="warn">x</Callout>);
    expect(container.querySelector('.callout-ui__icon')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('可放子元素（例如日期 chip）', () => {
    render(<Callout variant="warn">未關帳：<button type="button">11/04</button></Callout>);
    expect(screen.getByRole('button', { name: '11/04' })).toBeTruthy();
  });

  it('可指定 role', () => {
    render(<Callout variant="warn" role="alert">擋住了</Callout>);
    expect(screen.getByRole('alert').textContent).toContain('擋住了');
  });
});
