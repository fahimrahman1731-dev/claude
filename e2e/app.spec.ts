import { expect, test, type Page } from '@playwright/test';

/** Reads the visible letters of the current gap and types the rest of `word`. */
async function answerGap(page: Page, word: string, correct = true) {
  const visible = (await page.locator('.gap .vis').first().textContent()) ?? '';
  await page.locator('.gap input').first().fill(correct ? word.slice(visible.length) : 'qqq');
  await page.keyboard.press('Enter');
}

async function chooseTimer(page: Page, label: 'Timed' | 'Untimed' | 'Custom') {
  await page.goto('/#/practice');
  await page.getByRole('group', { name: 'Timer mode' }).getByRole('button', { name: label, exact: true }).click();
}

test('dashboard, navigation and import report load without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('2,601 words imported from your study materials')).toBeVisible();
  for (const name of ['Active Practice List', 'Completed Checklist', 'Mistake Bank', 'Vocabulary Library', 'Statistics', 'Settings']) {
    await page.getByRole('navigation').getByRole('link', { name: new RegExp(name) }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  }
  await page.goto('/#/report');
  await expect(page.getByText('Unique spelling targets imported')).toBeVisible();
  expect(errors).toEqual([]);
});

test('TEST 6 (browser): a wrong answer and the open session survive a page refresh', async ({ page }) => {
  await chooseTimer(page, 'Untimed');
  await page.getByRole('button', { name: /Fill in the Blanks/ }).first().click();
  await page.getByRole('button', { name: '▶ Start Fill in the Blanks' }).click();
  await expect(page.locator('.q-sentence')).toBeVisible();
  await page.locator('.gap input').fill('qqq');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Correct spelling:')).toBeVisible();
  const correct = (await page.locator('.answer-line strong').first().textContent())!;

  await page.reload();
  await expect(page.getByText('Correct spelling:')).toBeVisible();
  await expect(page.locator('.answer-line strong').first()).toHaveText(correct);

  await page.goto('/#/mistakes');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mistake Bank' })).toBeVisible();
  await expect(page.getByText(/^1 mistakes on 1 words/)).toBeVisible();
  await expect(page.getByRole('link', { name: correct.toLowerCase() }).first()).toBeVisible();
});

test('TEST 7 (browser): the countdown expires, the answer is shown and the result saved', async ({ page }) => {
  await page.goto('/#/settings');
  await page.getByRole('group', { name: 'Timer mode' }).getByRole('button', { name: 'Custom timer' }).click();
  const field = page.getByLabel('Fill in the Blanks (seconds)');
  await field.fill('3');
  await page.goto('/#/practice');
  await page.getByRole('button', { name: /Fill in the Blanks/ }).first().click();
  await page.getByRole('button', { name: '▶ Start Fill in the Blanks' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await expect(page.getByText('⏱ Time is up')).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('Correct spelling:')).toBeVisible();
  await page.goto('/#/stats');
  await expect(page.getByText('1 answers recorded.', { exact: false })).toBeVisible();
});

test('TEST 8 (browser): untimed mode shows no countdown', async ({ page }) => {
  await chooseTimer(page, 'Untimed');
  await page.getByRole('button', { name: /Small Grammar Words/ }).first().click();
  await page.getByRole('button', { name: '▶ Start Small Grammar Words' }).click();
  await expect(page.locator('.q-sentence')).toBeVisible();
  await expect(page.getByTitle('Untimed mode')).toBeVisible();
  await expect(page.getByRole('timer')).toHaveCount(0);
  await page.waitForTimeout(1500);
  await expect(page.locator('.gap input')).toBeEditable();
});

test('TEST 10 + TEST 5 (browser): search a word, master it, and see it move to the Completed Checklist', async ({ page }) => {
  await chooseTimer(page, 'Untimed');
  await page.goto('/#/library');
  await page.getByLabel('Search the vocabulary library').fill('significant');
  await page.getByRole('link', { name: 'significant', exact: true }).click();
  await expect(page.locator('.word-title')).toHaveText('significant');
  await expect(page.getByRole('heading', { name: 'Answer history' })).toBeVisible();

  await page.getByRole('button', { name: '▶ Practice this word' }).click();
  for (let i = 0; i < 2; i++) {
    await expect(page.locator('.q-sentence')).toBeVisible();
    await answerGap(page, 'significant');
    await expect(page.locator('.feedback-head.good')).toContainText('✓ Correct');
    await expect(page.getByRole('button', { name: /^(Next question|Finish session)/ })).toBeFocused();
    await page.keyboard.press('Enter');
    if (i === 0) await expect(page.locator('.gap input')).toBeFocused();
  }
  await expect(page.getByRole('heading', { name: 'Session finished' })).toBeVisible();
  await page.goto('/#/completed');
  await expect(page.getByRole('link', { name: 'significant', exact: true })).toBeVisible();
  await page.goto('/#/active');
  await page.getByLabel('Search active words').fill('significant');
  await expect(page.getByRole('link', { name: 'significant', exact: true })).toHaveCount(0);
  await page.goto('/#/library/w%3Asignificant');
  await expect(page.getByText(/Mastered on/)).toBeVisible();
});

test('Read and Complete: a paragraph with many gaps is scored word by word', async ({ page }) => {
  await chooseTimer(page, 'Untimed');
  await page.getByRole('button', { name: /Read and Complete/ }).first().click();
  await page.getByRole('button', { name: '▶ Start Read and Complete' }).click();
  const inputs = page.locator('.gap input');
  await expect(inputs.first()).toBeVisible();
  const n = await inputs.count();
  expect(n).toBeGreaterThanOrEqual(8);
  await inputs.first().fill('x');
  await page.keyboard.press('Enter');
  await expect(inputs.nth(1)).toBeFocused();
  await page.getByRole('button', { name: 'Submit paragraph' }).click();
  await expect(page.getByText(new RegExp(`/${n} words correct`))).toBeVisible();
  await expect(page.getByText(/Small grammar words:/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Next paragraph/ })).toBeFocused();
});

test('mobile layout has no horizontal scroll and the menu opens', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 760 } });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('navigation').getByRole('link', { name: /Mistake Bank/ }).click();
  await expect(page.getByRole('heading', { name: 'Mistake Bank' })).toBeVisible();
  await ctx.close();
});
