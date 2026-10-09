import { expect, test, type Page } from '@playwright/test';

/** Types the missing letters of the current word, reading the given letters from the boxes. */
async function answerWord(page: Page, word: string, correct = true) {
  const given = (await page.locator('.lb').first().locator('.lb-cell.given').allTextContents()).join('');
  await page.locator('.lb input').first().fill(correct ? word.slice(given.length) : 'qqq');
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
  await expect(page.getByText(/words from your study materials \+ [\d,]+ from trusted DET-level word lists/)).toBeVisible();
  for (const name of ['Active Practice List', 'Completed Checklist', 'Mistake Bank', 'Vocabulary Library', 'Statistics', 'Settings']) {
    await page.getByRole('navigation').getByRole('link', { name: new RegExp(name) }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  }
  await page.goto('/#/report');
  await expect(page.getByText('Unique spelling targets imported')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Real collected material' })).toBeVisible();
  await page.goto('/#/about');
  await expect(page.getByRole('heading', { name: /no “real” or “repeated” DET questions/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('the practice page shows the three DET reading skills', async ({ page }) => {
  await page.goto('/#/practice');
  await expect(page.getByRole('heading', { name: 'Practice skills' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Reading' })).toHaveAttribute('aria-selected', 'true');
  for (const name of ['Fill in the Blanks', 'Read and Complete', 'Interactive Reading']) {
    await expect(page.getByRole('button', { name: `Start ${name}` })).toBeVisible();
  }
  await page.getByRole('tab', { name: 'Vocabulary drills' }).click();
  await expect(page.getByRole('button', { name: 'Start Word Spelling' })).toBeVisible();
});

test('Fill in the Blanks looks like the DET: one box per missing letter, at most 3 letters given', async ({ page }) => {
  await chooseTimer(page, 'Timed');
  await page.getByRole('button', { name: 'Start Fill in the Blanks' }).click();
  await expect(page.getByRole('heading', { name: 'Complete the sentence with the correct word' })).toBeVisible();
  await expect(page.getByRole('timer')).toContainText('for this question');
  const lb = page.locator('.lb').first();
  const given = await lb.locator('.lb-cell.given').count();
  expect(given).toBeGreaterThanOrEqual(1);
  expect(given).toBeLessThanOrEqual(3);
  const empty = await lb.locator('.lb-cell:not(.given)').count();
  expect(empty).toBeGreaterThanOrEqual(1);
  // typing fills one box per letter and never grows a large field
  await expect(page.locator('.lb input').first()).toBeFocused();
  await page.keyboard.type('ab');
  await expect(lb.locator('.lb-cell.typed')).toHaveCount(Math.min(2, empty));
  await page.keyboard.press('Backspace');
  await expect(lb.locator('.lb-cell.typed')).toHaveCount(Math.min(1, empty));
  await expect(page.getByText('💡 Hint')).toHaveCount(0);
});

test('TEST 6 (browser): a wrong answer and the open session survive a page refresh', async ({ page }) => {
  await chooseTimer(page, 'Untimed');
  await page.getByRole('button', { name: 'Start Fill in the Blanks' }).click();
  await expect(page.locator('.det-sentence')).toBeVisible();
  await page.locator('.lb input').first().fill('qqq');
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
  await page.getByLabel('Fill in the Blanks (seconds)').fill('3');
  await page.goto('/#/practice');
  await page.getByRole('button', { name: 'Start Fill in the Blanks' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await expect(page.getByText('⏱ Time is up')).toBeVisible({ timeout: 8000 });
  await expect(page.getByText('Correct spelling:')).toBeVisible();
  await page.goto('/#/stats');
  await expect(page.getByText('1 answers recorded.', { exact: false })).toBeVisible();
});

test('TEST 8 (browser): untimed mode shows no countdown', async ({ page }) => {
  await chooseTimer(page, 'Untimed');
  await page.getByRole('tab', { name: 'Vocabulary drills' }).click();
  await page.getByRole('button', { name: 'Start Small Grammar Words' }).click();
  await expect(page.locator('.det-sentence')).toBeVisible();
  await expect(page.getByTitle('Untimed mode')).toBeVisible();
  await expect(page.getByRole('timer')).toHaveCount(0);
  await page.waitForTimeout(1500);
  await expect(page.locator('.lb input')).toBeEditable();
});

test('TEST 10 + TEST 5 (browser): search a word, master it, and see it move to the Completed Checklist', async ({ page }) => {
  await chooseTimer(page, 'Untimed');
  await page.goto('/#/library');
  await page.getByLabel('Search the vocabulary library').fill('significant');
  await page.getByRole('link', { name: 'significant', exact: true }).click();
  await expect(page.locator('.word-title')).toHaveText('significant');
  await expect(page.getByRole('heading', { name: 'Answer history' })).toBeVisible();
  await expect(page.getByText(/real sentence/).first()).toBeVisible();

  await page.getByRole('button', { name: '▶ Practice this word' }).click();
  // one question per real sentence of the word; two correct answers in different sentences master it
  for (let i = 0; i < 6; i++) {
    await expect(page.locator('.det-sentence').first()).toBeVisible();
    await answerWord(page, 'significant');
    await expect(page.locator('.feedback-head.good')).toContainText('✓ Correct');
    if (i === 1) await expect(page.getByText(/Mastered!/)).toBeVisible();
    const next = page.getByRole('button', { name: /^(Next question|Finish session)/ });
    await expect(next).toBeFocused();
    const finishing = (await next.textContent())?.startsWith('Finish');
    await page.keyboard.press('Enter');
    if (finishing) break;
    await expect(page.locator('.lb input')).toBeFocused();
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

test('Read and Complete: a real text, letter boxes that move to the next word, scored word by word', async ({ page }) => {
  await chooseTimer(page, 'Untimed');
  await page.getByRole('button', { name: 'Start Read and Complete' }).click();
  await expect(page.getByRole('heading', { name: 'Complete the text with the correct words' })).toBeVisible();
  const inputs = page.locator('.lb input');
  await expect(inputs.first()).toBeFocused();
  const n = await inputs.count();
  expect(n).toBeGreaterThanOrEqual(8);
  // fill the first word completely: the cursor jumps to the next word
  const firstMissing = await page.locator('.lb').first().locator('.lb-cell:not(.given)').count();
  await page.keyboard.type('x'.repeat(firstMissing));
  await expect(inputs.nth(1)).toBeFocused();
  // Backspace in an empty word goes back to the previous one
  await page.keyboard.press('Backspace');
  await expect(inputs.first()).toBeFocused();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText(new RegExp(`/${n} words correct`))).toBeVisible();
  await expect(page.getByText(/Small grammar words:/)).toBeVisible();
  await expect(page.getByText(/^Source:/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Next paragraph/ })).toBeFocused();
});

test('Interactive Reading: six questions in DET order with one shared timer', async ({ page }) => {
  await chooseTimer(page, 'Timed');
  await page.getByRole('button', { name: 'Start Interactive Reading' }).click();
  await expect(page.getByRole('heading', { name: 'Select the best option for each missing word' })).toBeVisible();
  await expect(page.getByRole('timer')).toContainText('for 6 questions');
  await expect(page.getByText('Passage', { exact: true })).toBeVisible();
  const cont = page.getByRole('button', { name: 'Continue' });
  await expect(cont).toBeDisabled();
  const selects = page.locator('.ir-selects select');
  for (let i = 0; i < (await selects.count()); i++) await selects.nth(i).selectOption({ index: 1 });
  await cont.click();

  await expect(page.getByRole('heading', { name: 'Select the best sentence to complete the passage' })).toBeVisible();
  await expect(page.getByRole('timer')).toContainText('for 5 questions');
  await page.locator('.ir-option').first().click();
  await cont.click();

  for (let k = 0; k < 2; k++) {
    await expect(page.getByRole('heading', { name: 'Highlight text in the passage to answer the question below' })).toBeVisible();
    const toks = page.locator('.highlightable .tok');
    const a = (await toks.nth(10 + k * 20).boundingBox())!;
    const z = (await toks.nth(14 + k * 20).boundingBox())!;
    await page.mouse.move(a.x + 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(z.x + z.width - 2, z.y + z.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('.ir-answer-box')).not.toContainText('Click and drag');
    await cont.click();
  }
  await expect(page.getByRole('heading', { name: 'Select the idea that is expressed in the passage' })).toBeVisible();
  await page.locator('.ir-option').first().click();
  await cont.click();
  await expect(page.getByRole('heading', { name: 'Select the best title for the passage' })).toBeVisible();
  await expect(page.getByRole('timer')).toContainText('for this question');
  await page.locator('.ir-option').first().click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByRole('heading', { name: 'Your answers' })).toBeVisible();
  await expect(page.getByText(/correct \(\d+%\)/)).toBeVisible();
  await expect(page.getByText('Complete the Sentences')).toBeVisible();
  await expect(page.getByText(/Source:/).first()).toBeVisible();
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
  // a practice question fits the phone screen too
  await page.goto('/#/practice');
  await page.getByRole('button', { name: 'Start Read and Complete' }).click();
  await expect(page.locator('.lb').first()).toBeVisible();
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow2).toBeLessThanOrEqual(0);
  await ctx.close();
});
