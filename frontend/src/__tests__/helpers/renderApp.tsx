import { render, screen, waitFor } from '@testing-library/react';
import App from '../../App';
import { NEXT_ENTER_GUARD_MS } from '../../components/pos/ConfirmBanner';

/** M4：成功畫面出現後要隔一下、放開再按 Enter 才回下一位；測試照人的節奏等過保護時間再按。 */
export async function pressEnterForNext(user: { keyboard: (text: string) => Promise<void> }) {
  await new Promise(r => setTimeout(r, NEXT_ENTER_GUARD_MS + 20));
  await user.keyboard('{Enter}');
}

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
