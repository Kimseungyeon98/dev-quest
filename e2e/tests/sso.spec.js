// SSO: 로그인 화면의 "○○로 계속하기" · 처음 로그인하면 새 계정 · 내 계정에서 연결하기/끊기
// 가짜 로그인 서비스(e2e/fixtures/fake-oauth.js, 제공자 이름 "fake")로 진짜와 같은 흐름을 확인해요.
const { test, expect } = require('@playwright/test');
const { uniqueName, isolate, signup, api } = require('./helpers');

test.beforeEach(async ({ context, baseURL }) => { await isolate(context, baseURL); });

/** 가짜 서비스 로그인 화면에서 로그인 */
async function fakeLogin(page, sub, email) {
  await page.waitForURL(/localhost:9099\/authorize/);
  await page.fill('#sub', sub);
  if (email) await page.fill('#email', email);
  await page.click('#login');
}

test('로그인 화면의 SSO 버튼으로 가입하고, 다음에는 같은 계정으로 로그인', async ({ page, context }) => {
  const sub = uniqueName('fk');
  await page.goto('/login/?next=' + encodeURIComponent('/sql/'));
  const btn = page.locator('.sso-btn[data-provider="fake"]');
  await expect(btn).toHaveText(/fake로 계속하기/);
  await btn.click();
  await fakeLogin(page, sub, 'fk@example.com');
  await page.waitForURL((u) => u.pathname === '/');
  await expect(page.locator('#dq-notice')).toContainText('가입을 환영해요');
  expect(new URL(page.url()).search).toBe(''); // 안내를 보여 준 뒤 주소는 깨끗하게

  const me = await api(page, '/api/me');
  expect(me.data.username).toMatch(/^f_[a-z0-9]{8}$/);
  expect(me.data.hasPassword).toBe(false);

  // 내 계정: 비밀번호 만들기 · 연결됨 · 복구 코드는 필요 없음
  await page.evaluate(() => window.DevQuest.openAccountDialog());
  await expect(page.locator('[data-sec="password"] h3')).toHaveText('비밀번호 만들기');
  await expect(page.locator('#dqPwCur')).toBeHidden();
  await expect(page.locator('[data-sec="sso"] li')).toContainText('연결됨 · fk@example.com');
  await expect(page.locator('[data-sec="recovery-none"]')).toBeVisible();
  // 마지막 로그인 방법은 끊을 수 없어요
  await page.click('[data-sec="sso"] [data-unlink="fake"]');
  await expect(page.locator('[data-sec="sso"] .dq-modal-error')).toContainText('로그인할 방법이 하나는 남아 있어야 해요');

  // 로그아웃하고 다시 SSO 로그인 → 같은 계정, 원래 가려던 화면으로
  await api(page, '/api/auth/logout', { method: 'POST' });
  await context.clearCookies();
  await page.goto('/login/?next=' + encodeURIComponent('/sql/'));
  await page.click('.sso-btn[data-provider="fake"]');
  await fakeLogin(page, sub);
  await page.waitForURL((u) => u.pathname === '/sql/');
  expect((await api(page, '/api/me')).data.username).toBe(me.data.username);
});

test('비밀번호 계정에 SSO 를 연결하고 끊기', async ({ page }) => {
  const name = uniqueName('sl');
  await signup(page, name);
  await page.evaluate(() => window.DevQuest.openAccountDialog());
  const row = page.locator('[data-sec="sso"] li');
  await expect(row).toContainText('연결 안 됨');
  await page.click('[data-sec="sso"] [data-link="fake"]');
  await fakeLogin(page, uniqueName('fk'), 'sl@example.com');

  await page.waitForURL((u) => u.pathname === '/');
  await expect(page.locator('#dq-notice')).toContainText('로그인을 연결했어요');
  await expect(row).toContainText('연결됨 · sl@example.com'); // 돌아오면 내 계정 창이 열려요
  expect((await api(page, '/api/me')).data.username).toBe(name);

  await page.click('[data-sec="sso"] [data-unlink="fake"]');
  await expect(row).toContainText('연결 안 됨');
});
