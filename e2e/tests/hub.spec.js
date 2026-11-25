// 메인(허브): 이어하기 · 내 상태 · 과목 · 랭킹
const { test, expect } = require('@playwright/test');
const { uniqueName, isolate, signup, api, questIds } = require('./helpers');

test.beforeEach(async ({ context, baseURL }) => { await isolate(context, baseURL); });

test('처음 온 사람에게는 첫 퀘스트를 추천해요', async ({ page }) => {
  await signup(page, uniqueName('hb'));
  await expect(page.locator('#hero .eyebrow')).toHaveText('첫 퀘스트 추천');
  await expect(page.locator('#hero .btn-primary')).toHaveAttribute('href', 'linux/index.html#' + questIds('linux')[0]);
});

test('가장 최근 과목의 마지막 퀘스트를 이어하고, 과목 화면이 그 퀘스트를 열어요', async ({ page }) => {
  await signup(page, uniqueName('hb'));
  const sql = questIds('sql'), algo = questIds('algo');
  await api(page, '/api/progress/algo', { method: 'PUT', body: { data: { solved: algo.slice(0, 3), lastId: algo[2], codes: {} }, version: 0 } });
  await page.waitForTimeout(30);
  await api(page, '/api/progress/sql', { method: 'PUT', body: { data: { solved: sql.slice(0, 9), lastProblemId: sql[10] }, version: 0 } });
  await page.reload();
  const cta = page.locator('#hero .btn-primary');
  await expect(cta).toHaveAttribute('href', 'sql/index.html#' + sql[10]);
  await expect(page.locator('#hero .hero-course')).toHaveText('SQL Quest');
  const title = (await page.locator('#hero .hero-title').textContent()).trim();
  await expect(page.locator('.tile').nth(1)).toContainText('9 / 36');

  await cta.click();
  await expect(page.locator('#problemTitle')).toContainText(title, { timeout: 30_000 });

  // 알고리즘: 마지막 문제를 이미 풀었으면 다음 안 푼 문제
  await page.goto('/');
  await api(page, '/api/progress/algo', { method: 'PUT', body: { data: { solved: algo.slice(0, 3), lastId: algo[2], codes: {} }, version: 1 } });
  await page.reload();
  await expect(cta).toHaveAttribute('href', 'algo/index.html#' + algo[3]);
});

test('랭킹 미니 목록과 전체 랭킹 펼치기', async ({ page }) => {
  await signup(page, uniqueName('hb'));
  await api(page, '/api/progress/sql', { method: 'PUT', body: { data: { solved: questIds('sql').slice(0, 2) }, version: 0 } });
  await page.reload();
  const me = page.locator('#rankMini li.me');
  await expect(me).toHaveCount(1);
  await expect(page.locator('#nickBtn')).toBeVisible(); // 기본 닉네임이면 "닉네임 정하기"

  await page.click('#openRanking');
  await expect(page.locator('#ranking')).toBeVisible();
  await expect(page.locator('#rankingTabs button')).toHaveText(['전체', 'Linux', 'SQL', 'Git', 'Algorithm']);
  await page.click('#rankingTabs button[data-tab="sql"]');
  await expect(page.locator('#rankingBody .rk-foot')).toContainText('내 순위');
  await page.click('#openRanking');
  await expect(page.locator('#ranking')).toBeHidden();
});

test('휴대폰 폭에서도 가로 스크롤이 없어요', async ({ page }) => {
  await signup(page, uniqueName('hb'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('#hero .btn-primary')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
