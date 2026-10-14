import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('../appMode', async importOriginal => ({
  ...(await importOriginal<typeof import('../appMode')>()),
  isPrototypeMode: false,
  validateAppModeConfig: () => ({ ok: false as const, error: 'missing Firebase configuration' }),
}));
vi.mock('../providers/FirebaseProvider', () => ({
  FirebaseProvider: ({ children }: { children: ReactNode }) => children,
}));

import App from '../App';

describe('App mode gate', () => {
  it('fails closed when non-prototype mode has incomplete Firebase configuration', () => {
    render(<App />);

    expect(screen.getByRole('alert').textContent).toContain('missing Firebase configuration');
    expect(screen.queryByRole('tab')).toBeNull();
    expect(document.querySelector('.app')).toBeNull();
  });
});
