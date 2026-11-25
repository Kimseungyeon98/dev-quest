// 메인(허브): 이어하기 · 내 상태 · 과목 · 랭킹
const { test, expect } = require('@playwright/test');
const { uniqueName, isolate, signup, api, questIds, catalog } = require('./helpers');

test.beforeEach(async ({ context, baseURL }) => { await isolate(context, baseURL); });

test('처음 온 사람에게는 첫 퀘스트를 추천해요', async ({ page }) => {
  const loaded = [];
  page.on('request', (r) => loaded.push(new URL(r.url()).pathname));
  await signup(page, uniqueName('hb'));
  await expect(page.locator('#hero .eyebrow')).toHaveText('첫 퀘스트 추천');
  await expect(page.locator('#hero .hero-title')).toHaveText(catalog.courses.linux.titles[questIds('linux')[0]]); // 제목도 카탈로그에서
  await expect(page.locator('.tile').first()).toContainText('0 / ' + questIds('linux').length);
  // 허브는 퀘스트 카탈로그만 받고, 과목 데이터 파일(수백 KB)은 받지 않아요
  expect(loaded).toContain('/shared/quests.json');
  expect(loaded.filter((p) => /\/(linux|sql|git|algo)\/js\//.test(p))).toEqual([]);
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
  // SQL 화면에서 남은 저장(떠날 때 보내는 것 포함)이 끝난 뒤에 알고리즘을 저장해야 "가장 최근"이 알고리즘이에요
  await page.evaluate(() => window.DevQuest.sync.ready());
  await expect(page.locator('.dq-sync').first()).toHaveAttribute('data-state', 'saved');
  await page.waitForTimeout(1500);
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

test('랭킹을 누적 · 이번 주로 바꿔 볼 수 있고, 고른 기간을 기억해요', async ({ page }) => {
  await signup(page, uniqueName('hb'));
  await api(page, '/api/progress/sql', { method: 'PUT', body: { data: { solved: questIds('sql').slice(0, 2) }, version: 0 } });
  await page.reload();
  const seg = (where, p) => page.locator(`${where} [data-seg] button[data-period="${p}"]`);
  await expect(seg('#rankMini', 'all')).toHaveAttribute('aria-pressed', 'true');

  await seg('#rankMini', 'week').click();
  await expect(page.locator('#rankMini h2 small')).toContainText('이번 주');
  await expect(page.locator('#rankMini li.me .xp')).toHaveText('200 XP'); // 방금 깬 쉬움 2개
  await page.click('#openRanking');
  await expect(seg('#ranking', 'week')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#rankingBody thead th')).toHaveText(['순위', '닉네임', 'XP', '완료']);
  await expect(page.locator('#rankingBody tr.me')).toContainText('2개');
  await expect(page.locator('#rankingNote')).toContainText('(월)부터');

  await page.reload(); // 기억해요
  await expect(seg('#rankMini', 'week')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#openRanking');
  await seg('#ranking', 'all').click();
  await expect(seg('#rankMini', 'all')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#rankingBody thead th')).toHaveCount(6);
});

test('너무 빠르게 끝내면 확인하는 동안 랭킹에서 빠지고, 본인에게 이유를 알려 줘요', async ({ page }) => {
  await signup(page, uniqueName('hb'));
  const linux = questIds('linux');
  // 한 번에 5개씩(한꺼번에 들어온 기록으로 보지 않는 최대) 5번 = 10분 안에 25개
  for (let i = 1; i <= 5; i++) {
    const r = await api(page, '/api/progress/linux', { method: 'PUT', body: { data: { completed: linux.slice(0, i * 5) }, version: i - 1 } });
    expect(r.status).toBe(200);
  }
  await page.reload();
  await expect(page.locator('#rankMini .rk-excluded')).toContainText('확인하는 동안 랭킹에서 잠시 빠져 있어요');
  await expect(page.locator('#rankMini li.me')).toHaveCount(0);
  await page.click('#openRanking');
  await expect(page.locator('#rankingBody .rk-foot')).toContainText('내 기록은 지금 랭킹에서 빠져 있어요');
});

test('휴대폰 폭에서도 가로 스크롤이 없어요', async ({ page }) => {
  await signup(page, uniqueName('hb'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('#hero .btn-primary')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('내 상태에 연속 학습일과 이번 주 기록', async ({ page }) => {
  await signup(page, uniqueName('hb'));
  await expect(page.locator('#activity')).toBeVisible();
  await expect(page.locator('#activity .act-head')).toContainText('0일');
  await expect(page.locator('#activity .act-tip')).toContainText('연속 학습이 시작돼요');
  await expect(page.locator('#activity .week li')).toHaveCount(7);

  await api(page, '/api/progress/sql', { method: 'PUT', body: { data: { solved: questIds('sql').slice(0, 2) }, version: 0 } });
  await page.reload();
  await expect(page.locator('#activity .act-head')).toContainText('1일');
  await expect(page.locator('#activity .flame.on')).toHaveCount(1);
  await expect(page.locator('#activity .week li.today')).toHaveClass(/lv2/);
  await expect(page.locator('#activity .week-sum')).toContainText('2개 완료');
});
