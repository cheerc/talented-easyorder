import type { Page } from '@playwright/test';

export async function settings(page: Page, tab: '學生' | '菜單與開帳' | '本機診斷') {
  await page.getByRole('navigation', { name: '主要導覽' }).getByRole('button', { name: '今日設定', exact: true }).click();
  await page.getByRole('navigation', { name: '今日設定' }).getByRole('button', { name: tab, exact: true }).click();
}
export async function report(page: Page) {
  await page.getByRole('navigation', { name: '主要導覽' }).getByRole('button', { name: '今日帳', exact: true }).click();
  await page.getByRole('navigation', { name: '今日帳' }).getByRole('button', { name: '本週／本月', exact: true }).click();
}
export async function release(page: Page) {
  const menu = page.locator('.operator-menu');
  if (!await menu.evaluate(element => (element as HTMLDetailsElement).open)) await menu.locator('summary').click();
  await menu.getByRole('button', { name: '釋放使用權並登出' }).click();
}

export async function releaseOwner(button: import('@playwright/test').Locator) {
  const menu = button.locator('xpath=ancestor::details');
  if (!await menu.evaluate(element => (element as HTMLDetailsElement).open)) await menu.locator('summary').click();
  await button.click();
}
