import { test, expect } from './fixtures';
import { settings, release } from './helpers/navigation';

test('cloud shell routes, physical Alt keys, draft guard and themes', async ({ googleSession }) => {
  const { page } = googleSession;
  const acquire = page.getByRole('button', { name: '取得系統使用權' });
  await expect(acquire.or(page.locator('.operator-menu'))).toBeVisible();
  if (await acquire.isVisible()) await acquire.click();
  await expect(page.locator('.operator-menu')).toBeVisible();
  await expect(page.getByRole('region', { name: '待核對命令' })).toHaveCount(0);
  const nav = page.getByRole('navigation', { name: '主要導覽' });
  await expect(nav.getByRole('button')).toHaveCount(5);
  await page.keyboard.press('F3');
  await expect(page.getByRole('navigation', { name: '今日設定' }).getByRole('button', { name: '菜單與開帳' })).toHaveAttribute('aria-current', 'page');
  await settings(page, '學生');
  await page.getByRole('button', { name: '新增學生' }).click();
  const draft = page.getByRole('form', { name: '新增學生' }).getByLabel('學員編號');
  await draft.fill('987');
  await draft.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: '£', code: 'Digit5', altKey: true, bubbles: true, cancelable: true })));
  await expect(page.getByRole('dialog', { name: '離開並捨棄草稿？' })).toBeVisible();
  await page.getByRole('button', { name: '取消離開' }).click();
  await expect(draft).toHaveValue('987');
  await page.keyboard.press('F5');
  await page.getByRole('button', { name: '捨棄草稿' }).click();
  await expect(nav.getByRole('button', { name: '歷史' })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('F3');
  await expect(page.getByRole('navigation', { name: '今日設定' }).getByRole('button', { name: '學生' })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('F2');
  await expect(page.getByRole('button', { name: '今日', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: '本週／本月' }).click();
  await expect(page.getByRole('button', { name: '本週／本月' })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('F4');
  await expect(page.getByRole('heading', { name: '供應商', exact: true }).first()).toBeVisible();
  await page.keyboard.press('F1');
  await expect(nav.getByRole('button', { name: '櫃台' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('cloud-orders-loading')).toHaveCount(0);
  for (const [width, height, theme] of [[1920, 1080, 'warm'], [1366, 768, 'light'], [1024, 768, 'dark']] as const) {
    await page.setViewportSize({ width, height });
    await page.locator('.operator-menu summary').click();
    await page.getByLabel('主題').selectOption(theme);
    await page.locator('.operator-menu summary').click();
    await expect(page.locator('body')).toHaveAttribute('data-theme', theme);
    if (process.env.EASYORDER_EVIDENCE_DIR) await page.screenshot({ path: `${process.env.EASYORDER_EVIDENCE_DIR}/shell-${width}-${theme}.png` });
  }
  await release(page);
});
