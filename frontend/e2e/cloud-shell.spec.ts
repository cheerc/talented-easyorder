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
  const addStudent = page.getByRole('button', { name: '新增學生' });
  await addStudent.click();
  const createDialog = page.getByRole('dialog', { name: '新增學生' });
  const draft = createDialog.getByRole('form', { name: '新增學生' }).getByLabel('學員編號');
  await draft.fill('987');
  await draft.evaluate(element => element.dispatchEvent(new KeyboardEvent('keydown', { key: '£', code: 'Digit5', altKey: true, bubbles: true, cancelable: true })));
  await expect(createDialog).toBeVisible();
  await expect(draft).toHaveValue('987');
  await expect(page.getByRole('navigation', { name: '今日設定' }).getByRole('button', { name: '學生' })).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('F5');
  await expect(createDialog).toBeVisible();
  await expect(draft).toHaveValue('987');

  await page.keyboard.press('Escape');
  const discardConfirmation = createDialog.getByRole('group', { name: '新增學生草稿離開確認' });
  await expect(discardConfirmation).toBeVisible();
  await discardConfirmation.getByRole('button', { name: '取消離開' }).click();
  await expect(draft).toHaveValue('987');
  await page.keyboard.press('Escape');
  await createDialog.getByRole('button', { name: '捨棄草稿' }).click();
  await expect(createDialog).toHaveCount(0);
  await expect(addStudent).toBeFocused();
  await page.keyboard.press('F5');
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
    if (width === 1024) {
      // P6：≤1180px 雲端外殼也是兩列——品牌與狀態同一列，五個主分頁獨佔第二列且都在視窗內。
      const shell = await page.locator('header.app-shell').evaluate(node => {
        const box = (selector: string) => node.querySelector(selector)!.getBoundingClientRect();
        const brand = box('.brand'); const status = box('.status'); const tabs = box('.tabs');
        const tabBoxes = Array.from(node.querySelectorAll('.tabs .tab')).map(tab => tab.getBoundingClientRect());
        return {
          brandTop: brand.top, statusTop: status.top, tabsTop: tabs.top, brandBottom: brand.bottom,
          tabLeft: Math.min(...tabBoxes.map(rect => rect.left)), tabRight: Math.max(...tabBoxes.map(rect => rect.right)),
          columns: getComputedStyle(node).gridTemplateColumns.split(' ').length,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      expect(Math.abs(shell.brandTop - shell.statusTop)).toBeLessThan(shell.brandBottom - shell.brandTop);
      expect(shell.columns, '≤1180px 外殼應為兩欄 grid（雲端基準三欄規則不得蓋掉）').toBe(2);
      expect(shell.tabsTop).toBeGreaterThanOrEqual(shell.brandBottom);
      expect(shell.tabLeft).toBeGreaterThanOrEqual(0);
      expect(shell.tabRight).toBeLessThanOrEqual(width);
      expect(shell.overflow).toBeLessThanOrEqual(0);
    }
  }
  await release(page);
});
