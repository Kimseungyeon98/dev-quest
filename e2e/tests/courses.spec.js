// 과목 화면: 정답 뒤 Enter·Tab 으로 다음 퀘스트 · 선 아이콘
const { test, expect } = require('@playwright/test');
const { uniqueName, isolate, signup } = require('./helpers');

test.beforeEach(async ({ context, baseURL, page }) => {
  await isolate(context, baseURL);
  await signup(page, uniqueName('co'));
});

test('Linux: 정답 뒤 Enter 로 다음 미션, 다른 키를 먼저 누르면 원래대로', async ({ page }) => {
  await page.goto('/linux/');
  const title = page.locator('#missionTitle');
  await expect(title).toContainText('1화');
  await page.fill('#terminalInput', 'pwd');
  await page.press('#terminalInput', 'Enter');
  await expect(page.locator('.success-banner .dq-next.armed')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(title).toContainText('2화');

  // 2화를 풀고 다른 키를 먼저 치면 Enter 는 명령 실행
  await page.fill('#terminalInput', 'ls');
  await page.press('#terminalInput', 'Enter');
  await expect(page.locator('.dq-next.armed')).toBeVisible();
  await page.type('#terminalInput', 'pwd');
  await page.press('#terminalInput', 'Enter');
  await expect(title).toContainText('2화');
  await expect(page.locator('.dq-next.armed')).toHaveCount(0);
});

test('SQL: 정답 뒤 Tab 으로 다음 문제', async ({ page }) => {
  await page.goto('/sql/');
  await expect(page.locator('#problemTitle')).toContainText('VIP', { timeout: 30_000 });
  await page.fill('#sqlEditor', "SELECT name, email FROM customers WHERE grade = 'VIP' ORDER BY signup_date ASC");
  await page.click('#runBtn');
  await expect(page.locator('#runStatus')).toContainText('정답');
  await expect(page.locator('.dq-next.armed')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator('#problemTitle')).toContainText('최근 가입한 회원');
  await expect(page.locator('.dq-next')).toHaveCount(0);
});

test('Git: 해결 뒤 Enter 로 다음 시나리오, 버튼 안 아이콘을 눌러도 동작', async ({ page }) => {
  await page.goto('/git/#basic-01');
  // 처음 방문하면 도움말 창이 조금 늦게 떠요 — 뜨면 닫아요
  await page.locator('#modal').waitFor({ state: 'visible', timeout: 3000 }).then(() => page.click('#modalX')).catch(() => {});
  await expect(page.locator('#modal')).toBeHidden();
  await expect(page.locator('#btnResetAll')).toHaveCount(0); // 진행 기록 초기화는 없어요
  const hint = page.locator('#btnHint');
  const before = await hint.textContent();
  await page.locator('#btnHint svg').click({ force: true });
  await expect(hint).not.toHaveText(before);

  page.once('dialog', (d) => d.accept()); // "정답을 자동으로 실행해 보여줄까요?"
  await page.click('#btnAuto');
  await expect(page.locator('#successBox [data-next].armed')).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__gp.sc.id)).toBe('basic-02');
});

test('Algorithm: 제출 정답 뒤 Tab 으로 다음 문제 (가짜 Java 실행기)', async ({ page }) => {
  await page.goto('/algo/');
  await expect(page.locator('#javaStatus')).toHaveClass(/ready/, { timeout: 15_000 });
  const first = await page.locator('#problemTitle').textContent();
  await page.click('#submitBtn');
  await expect(page.locator('.verdict.ok .dq-next.armed')).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Tab');
  await expect(page.locator('#problemTitle')).not.toHaveText(first);
});

test('과목 상단 바와 사이드바에는 이모지 대신 선 아이콘', async ({ page }) => {
  for (const course of ['linux', 'sql', 'git', 'algo']) {
    await page.goto(`/${course}/`);
    await expect(page.locator('.dq-item').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.dqbar .dq-ico svg')).toHaveCount(1);
    const text = await page.evaluate(() => [document.querySelector('.dqbar'), ...document.querySelectorAll('.dq-cat summary, .dq-item')].map((e) => e.textContent).join(' '));
    expect(text, course).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  }
});
