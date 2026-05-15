import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from '../Tabs';

describe('Tabs', () => {
  const items = [
    { id: 'a', label: '選項A' },
    { id: 'b', label: '選項B' },
    { id: 'c', label: '選項C' },
  ];

  it('renders all tab items', () => {
    render(<Tabs items={items} active="a" onChange={() => {}} />);
    expect(screen.getByText('選項A')).toBeDefined();
    expect(screen.getByText('選項B')).toBeDefined();
    expect(screen.getByText('選項C')).toBeDefined();
  });

  it('calls onChange when tab clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Tabs items={items} active="a" onChange={onChange} />);
    await user.click(screen.getByText('選項B'));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('applies active class to selected tab', () => {
    render(<Tabs items={items} active="b" onChange={() => {}} />);
    const activeTab = screen.getByText('選項B');
    expect(activeTab.className).toContain('tab-ui-on');
  });
});
