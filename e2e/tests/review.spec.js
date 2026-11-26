// 오답 노트: 틀리거나 힌트를 본 퀘스트가 허브에 모이고, 노트에서 열어 다시 맞히면 졸업해요
const { test, expect } = require('@playwright/test');
const { uniqueName, isolate, signup, questIds } = require('./helpers');

test.beforeEach(async ({ context, baseURL, page }) => {
  await isolate(context, baseURL);
  await signup(page, uniqueName('rv'));
});

test('Linux: 틀린 명령 → 노트에 올라가고, 노트에서 열어 다시 맞히면 졸업', async ({ page }) => {
  const first = questIds('linux')[0];
  await expect(page.locator('#review .review-empty')).toContainText('아직 비어 있어요');

  await page.goto('/linux/');
  await expect(page.locator('#missionTitle')).toContainText('1화');
  await page.fill('#terminalInput', 'pwdd'); // 없는 명령
  await page.press('#terminalInput', 'Enter');
  await page.fill('#terminalInput', 'pwd');
  await page.press('#terminalInput', 'Enter');
  await expect(page.locator('.success-banner')).toBeVisible();

  await page.goto('/');
  const item = page.locator('#review .review-list li');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('틀림 1');
  await expect(item).toContainText('맞혔어요 · 한 번 더!');
  await expect(item.locator('a.rv-go')).toHaveAttribute('href', `linux/index.html?review=1#${first}`);

  await item.locator('a.rv-go').click();
  await expect(page.locator('#missionTitle')).toContainText('1화');
  await page.fill('#terminalInput', 'pwd');
  await page.press('#terminalInput', 'Enter');
  await expect(page.locator('.success-banner')).toBeVisible(); // 이미 끝낸 미션도 노트에서 열면 다시 성공 표시
  await expect(page.locator('#dq-notice')).toContainText('오답 노트에서 졸업했어요');

  await page.goto('/');
  await expect(page.locator('#review .review-empty')).toContainText('모두 졸업했어요');
  await expect(page.locator('#review .sec-head')).toContainText('1개 졸업');
});

test('SQL: 틀린 쿼리와 힌트를 세고, 노트에서 뺄 수 있어요', async ({ page }) => {
  await page.goto('/sql/');
  await expect(page.locator('#problemTitle')).toContainText('VIP', { timeout: 30_000 });
  await page.fill('#sqlEditor', 'SELECT name FROM customers');
  await page.click('#runBtn');
  await expect(page.locator('#runStatus')).toContainText('아직이에요');
  await page.fill('#sqlEditor', 'SELEC broken');
  await page.click('#runBtn');
  await page.click('#hintBtn');
  await page.waitForTimeout(300);

  await page.goto('/');
  const item = page.locator('#review .review-list li');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('틀림 2');
  await expect(item).toContainText('힌트 1');
  await expect(item).toContainText('아직 못 풀었어요');
  await expect(item.locator('.rv-title')).toContainText('VIP');

  await item.locator('.rv-x').click();
  await expect(page.locator('#review .review-empty')).toBeVisible();
});
