import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelpTip } from '../HelpTip';

function setup() {
  render(
    <div>
      <button type="button">外面</button>
      <HelpTip label="備份說明">第一行{'\n'}第二行</HelpTip>
    </div>,
  );
  return screen.getByRole('button', { name: '備份說明' });
}

describe('HelpTip', () => {
  it('預設不顯示說明內容', () => {
    setup();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('滑鼠移上顯示、移開關閉', async () => {
    const user = userEvent.setup();
    const trigger = setup();
    await user.hover(trigger);
    expect(screen.getByRole('tooltip').textContent).toContain('第一行');
    await user.unhover(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('Tab 聚焦顯示、離開關閉', async () => {
    const user = userEvent.setup();
    const trigger = setup();
    await user.tab(); // 外面
    await user.tab();
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    await user.tab();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('點擊後固定開啟（移開不關），再點一次關閉', async () => {
    const user = userEvent.setup();
    const trigger = setup();
    await user.hover(trigger);
    await user.click(trigger);
    await user.unhover(trigger);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    await user.click(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('Esc 關閉並保留焦點，且不讓 Esc 傳給其他全域處理器', async () => {
    const user = userEvent.setup();
    const trigger = setup();
    await user.click(trigger);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    let leaked = false;
    const spy = () => { leaked = true; };
    window.addEventListener('keydown', spy);
    await user.keyboard('{Escape}');
    window.removeEventListener('keydown', spy);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(leaked).toBe(false);
  });

  it('Esc 在說明未開啟時不攔截', async () => {
    const user = userEvent.setup();
    setup();
    let seen = false;
    const spy = () => { seen = true; };
    window.addEventListener('keydown', spy);
    await user.keyboard('{Escape}');
    window.removeEventListener('keydown', spy);
    expect(seen).toBe(true);
  });

  it('點外面關閉', async () => {
    const user = userEvent.setup();
    const trigger = setup();
    await user.click(trigger);
    fireEvent.pointerDown(screen.getByRole('button', { name: '外面' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('開啟時 aria-describedby 指到 tooltip 內容，關閉時不指', async () => {
    const user = userEvent.setup();
    const trigger = setup();
    expect(trigger.getAttribute('aria-describedby')).toBeNull();
    await user.click(trigger);
    const tip = screen.getByRole('tooltip');
    expect(trigger.getAttribute('aria-describedby')).toBe(tip.id);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('tooltip 保留換行（white-space: pre-line 由 class 提供）', async () => {
    const user = userEvent.setup();
    const trigger = setup();
    await user.click(trigger);
    expect(screen.getByRole('tooltip').className).toContain('help-tip-ui__bubble');
  });
});
