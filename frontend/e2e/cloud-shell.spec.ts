import { test, expect } from './fixtures';
import { settings, release } from './helpers/navigation';
import { enterSystem } from './helpers/session';

test('cloud shell routes, physical Alt keys, draft guard and themes', async ({ googleSession }) => {
  const { page } = googleSession;
  await enterSystem(page);
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

  // #665：Modal 內說明開啟時，第一次 Esc 只關說明；有草稿也不出現捨棄確認，第二次 Esc 才走原流程。
  const codeHelp = createDialog.getByRole('button', { name: '編號正規化說明' });
  await codeHelp.click();
  await expect(createDialog.getByRole('tooltip')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(createDialog.getByRole('tooltip')).toHaveCount(0);
  await expect(createDialog).toBeVisible();
  await expect(createDialog.getByRole('group', { name: '新增學生草稿離開確認' })).toHaveCount(0);
  await expect(codeHelp).toBeFocused();
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

test('the brand button returns to the counter and reloads the whole app (#710)', async ({ googleSession }) => {
  const { page } = googleSession;
  await enterSystem(page);
  await settings(page, '學生');
  const brand = page.getByRole('button', { name: '訂餐櫃台，回到櫃台並重新整理' });
  await expect(page.locator('.brand-sub')).toHaveCount(0);
  await expect(brand).toBeEnabled();

  // 滑鼠：整頁重新載入（頁面上的標記消失）並落在 F1 櫃台，網址不留 #counter。
  await page.evaluate(() => { (window as unknown as { __beforeBrandReload?: number }).__beforeBrandReload = 1; });
  await Promise.all([page.waitForEvent('load'), brand.click()]);
  await enterSystem(page);
  expect(await page.evaluate(() => (window as unknown as { __beforeBrandReload?: number }).__beforeBrandReload)).toBeUndefined();
  await expect(page.getByRole('main', { name: '雲端櫃台點餐' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '主要導覽' }).getByRole('button', { name: '櫃台', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => new URL(page.url()).hash).toBe('');

  // 鍵盤：品牌可聚焦，Enter 同樣整頁重新載入。
  await settings(page, '學生');
  await page.evaluate(() => { (window as unknown as { __beforeBrandReload?: number }).__beforeBrandReload = 2; });
  await brand.focus();
  await expect(brand).toBeFocused();
  await Promise.all([page.waitForEvent('load'), page.keyboard.press('Enter')]);
  await enterSystem(page);
  expect(await page.evaluate(() => (window as unknown as { __beforeBrandReload?: number }).__beforeBrandReload)).toBeUndefined();
  await expect(page.getByRole('main', { name: '雲端櫃台點餐' })).toBeVisible();

  // 沒有帶標記的重新整理（Ctrl+R）維持原本落點，不回櫃台。
  await page.reload();
  await enterSystem(page);
  await expect(page.getByRole('main', { name: '雲端學生管理' })).toBeVisible();
  await release(page);
});

test('operator menu closes on an outside click (#704)', async ({ googleSession }) => {
  const { page } = googleSession;
  await enterSystem(page);
  const menu = page.locator('.operator-menu');
  await menu.locator('summary').click();
  await expect(menu).toHaveAttribute('open', '');
  await page.locator('.brand-name').click();
  await expect(menu).not.toHaveAttribute('open', '');
  // 再開一次，點選單內部不收起。
  await menu.locator('summary').click();
  await expect(menu).toHaveAttribute('open', '');
  await menu.locator('.operator-menu__help').click();
  await expect(menu).toHaveAttribute('open', '');
});

test('F-key navigation moves the tab focus with the page and the ring is not clipped (#705)', async ({ googleSession }) => {
  const { page } = googleSession;
  await enterSystem(page);
  const nav = page.getByRole('navigation', { name: '主要導覽' });
  await nav.getByRole('button', { name: '櫃台' }).click();
  await page.keyboard.press('F3');
  const settingsTab = nav.getByRole('button', { name: '今日設定' });
  await expect(settingsTab).toHaveAttribute('aria-current', 'page');
  await expect(settingsTab).toBeFocused();
  await expect(nav.getByRole('button', { name: '櫃台' })).not.toBeFocused();

  // 環狀外框必須畫在按鈕內側：.tabs 的 overflow 會把按鈕外面的外框裁掉。
  await page.keyboard.press('Shift+Tab');
  const focused = nav.locator('.tab:focus');
  await expect(focused).toHaveCount(1);
  const ring = await focused.evaluate(node => {
    const style = getComputedStyle(node);
    const tab = node.getBoundingClientRect();
    const tabs = node.parentElement!.getBoundingClientRect();
    // 外框外緣 = 按鈕邊緣 + offset + 寬度（offset 為負時在按鈕內側）。
    const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
    return {
      style: style.outlineStyle,
      outerTop: tab.top - reach, outerBottom: tab.bottom + reach,
      tabsTop: tabs.top, tabsBottom: tabs.bottom,
    };
  });
  expect(ring.style).toBe('solid');
  expect(ring.outerTop).toBeGreaterThanOrEqual(ring.tabsTop);
  expect(ring.outerBottom).toBeLessThanOrEqual(ring.tabsBottom);
});
