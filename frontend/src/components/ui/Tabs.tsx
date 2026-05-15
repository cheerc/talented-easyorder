import React from 'react';
import './Tabs.css';

interface TabItem {
  id: string;
  label: string;
}

interface TabsProps {
  items: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}

export const Tabs = React.memo(function Tabs({
  items,
  active,
  onChange,
  className = '',
}: TabsProps) {
  return (
    <div className={['tabs-ui', className].filter(Boolean).join(' ')} role="tablist">
      {items.map(item => (
        <button
          key={item.id}
          role="tab"
          aria-selected={item.id === active}
          className={['tab-ui', item.id === active ? 'tab-ui-on' : ''].filter(Boolean).join(' ')}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
});
