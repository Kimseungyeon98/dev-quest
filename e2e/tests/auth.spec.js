// 로그인 · 회원가입 · 로그아웃 · 자동 로그인
const { test, expect } = require('@playwright/test');
const { uniqueName, isolate, signup, login } = require('./helpers');

test.beforeEach(async ({ context, baseURL }) => { await isolate(context, baseURL); });

test('로그인하지 않으면 로그인 화면으로, 가입하면 복구 코드를 보여 주고 원래 주소로', async ({ page }) => {
  await page.goto('/sql/');
  await expect(page).toHaveURL(/\/login\/\?next=%2Fsql%2F$/);
  const code = await signup(page, uniqueName('au'), { next: '/sql/' });
  expect(code).toMatch(/^[2-9A-Z]{4}(-[2-9A-Z]{4}){3}$/);
  await expect(page.locator('.dqbar .dq-user')).toBeVisible();
});

test('가입 입력값을 먼저 확인해요', async ({ page }) => {
  await page.goto('/login/#signup');
  await page.fill('#username', uniqueName('au'));
  await page.fill('#password', 'abc12345');
  await page.fill('#password2', 'abc99999');
  await page.click('#submit');
  await expect(page.locator('#error')).toContainText('일치하지 않아요');
  await page.fill('#password', 'short');
  await page.fill('#password2', 'short');
  await page.click('#submit');
  await expect(page.locator('#error')).toContainText('8~64자');
});

test('틀린 비밀번호 안내 · 로그아웃 · 자동 로그인', async ({ page, browser, baseURL }) => {
  const name = uniqueName('au');
  await signup(page, name);
  await Promise.all([page.waitForURL('**/login/'), page.click('#account .dq-logout')]);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login\/$/);

  await page.fill('#username', name);
  await page.fill('#password', 'wrong1234');
  await page.click('#submit');
  await expect(page.locator('#error')).toContainText('맞지 않아요');

  await login(page, name, { remember: true });
  const rm = (await page.context().cookies()).find((c) => c.name === 'remember-me');
  expect(rm.expires).toBeGreaterThan(Date.now() / 1000 + 29 * 86400);

  // 브라우저를 닫았다 연 상황: 세션 쿠키 없이 자동 로그인 쿠키만
  const other = await browser.newContext();
  await isolate(other, baseURL);
  await other.addCookies([rm]);
  const p2 = await other.newPage();
  await p2.goto('/algo/');
  await expect(p2).toHaveURL(/\/algo\/$/);
  await other.close();
});
