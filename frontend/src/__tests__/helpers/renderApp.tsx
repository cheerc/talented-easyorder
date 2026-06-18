import { render, screen, waitFor } from '@testing-library/react';
import App from '../../App';

export async function renderApp() {
  render(<App />);
  await waitFor(() => {
    expect(screen.queryByLabelText('載入中')).toBeNull();
  });
  // Wait for AuthGate to authorize the operator and render the main UI
  await waitFor(() => {
    expect(screen.queryByText('Counter')).toBeTruthy();
  });
}
