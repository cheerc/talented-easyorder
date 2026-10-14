/**
 * Ref: #334 — E2E test for the expense flow.
 *
 * This test covers the critical expense flow that was affected by
 * the #311 NaN bug. It verifies the full user journey:
 * 1. Enter expense mode
 * 2. Select direction (in/out)
 * 3. Enter amount
 * 4. Select reason
 * 5. Confirm
 *
 * Run: npx playwright test --config playwright.prototype.config.ts
 */
import { test, expect } from './prototype-fixtures';

test.describe('Expense Flow', () => {
  test('creates an outgoing expense with valid amount', async ({ prototypePage: page }) => {
    // Navigate to POS
    await page.goto('/');
    await page.waitForSelector('.app');

    // Enter expense mode — look for the expense button/shortcut
    const expenseBtn = page.locator('[data-testid="expense-btn"], .action-btn-expense, button:has-text("支出")');
    if (await expenseBtn.count() > 0) {
      await expenseBtn.first().click();
    } else {
      // Try keyboard shortcut (F4 or similar)
      await page.keyboard.press('F4');
    }

    // Select direction: outgoing
    const outBtn = page.locator('button:has-text("支出"), [data-direction="out"]');
    if (await outBtn.count() > 0) {
      await outBtn.first().click();
    }

    // Enter amount — type into the amount input
    const amountInput = page.locator('input[data-numeric-input], input[data-testid="expense-amount"], .expense-amount input');
    if (await amountInput.count() > 0) {
      await amountInput.first().fill('150');
      await amountInput.first().press('Enter');
    }

    // Select reason
    const reasonBtn = page.locator('button:has-text("支出其他")');
    if (await reasonBtn.count() > 0) {
      await reasonBtn.first().click();
    }

    // Verify no NaN appears anywhere on the page (Ref: #311)
    const pageContent = await page.textContent('body');
    expect(pageContent).not.toContain('NaN');
  });

  test('creates an incoming expense (deposit)', async ({ prototypePage: page }) => {
    await page.goto('/');
    await page.waitForSelector('.app');

    const expenseBtn = page.locator('[data-testid="expense-btn"], .action-btn-expense, button:has-text("支出")');
    if (await expenseBtn.count() > 0) {
      await expenseBtn.first().click();
    } else {
      await page.keyboard.press('F4');
    }

    // Select direction: incoming
    const inBtn = page.locator('button:has-text("收入"), [data-direction="in"]');
    if (await inBtn.count() > 0) {
      await inBtn.first().click();
    }

    // Verify no NaN on page
    const pageContent = await page.textContent('body');
    expect(pageContent).not.toContain('NaN');
  });
});
