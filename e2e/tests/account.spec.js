// 내 계정: 닉네임 · 비밀번호 바꾸기 · 복구 코드 · 비밀번호 재설정
const { test, expect } = require('@playwright/test');
const { uniqueName, isolate, signup, login, PASSWORD } = require('./helpers');

test.beforeEach(async ({ context, baseURL }) => { await isolate(context, baseURL); });

test('내 계정 창에서 닉네임 바꾸기', async ({ page }) => {
  await signup(page, uniqueName('ac'));
  await page.click('#account .dq-user');
  const nick = '닉' + Date.now().toString(36).slice(-6);
  await page.fill('#dqNick', nick);
  await page.click('[data-sec="nickname"] button[type="submit"]');
  await expect(page.locator('#account .dq-uname')).toHaveText(nick);
  await page.keyboard.press('Escape');
  await expect(page.locator('.dq-modal')).toHaveCount(0);
});

test('비밀번호 바꾸면 다른 기기는 로그아웃, 이 기기는 그대로', async ({ page, browser, baseURL }) => {
  const name = uniqueName('ac');
  await signup(page, name);
  const other = await browser.newContext();
  await isolate(other, baseURL);
  const p2 = await other.newPage();
  await login(p2, name);

  await page.click('#account .dq-user');
  await page.fill('#dqPwCur', 'wrong1234');
  await page.fill('#dqPwNew', 'newpass123');
  await page.fill('#dqPwNew2', 'newpass123');
  await page.click('[data-sec="password"] button[type="submit"]');
  await expect(page.locator('[data-sec="password"] .dq-modal-error')).toContainText('지금 비밀번호가 맞지 않아요');
  await page.fill('#dqPwCur', PASSWORD);
  await page.click('[data-sec="password"] button[type="submit"]');
  await expect(page.locator('#dq-notice')).toContainText('비밀번호를 바꿨어요');

  await page.reload();
  await expect(page).toHaveURL(/\/$/); // 이 기기는 그대로
  await p2.goto('/');
  await expect(p2).toHaveURL(/\/login\//); // 다른 기기는 끊김
  await login(p2, name, { password: 'newpass123' });
  await other.close();
});

test('비밀번호를 잊었을 때 복구 코드로 재설정하고, 쓴 코드는 다시 못 씀', async ({ page }) => {
  const name = uniqueName('ac');
  const code = await signup(page, name);
  await Promise.all([page.waitForURL('**/login/'), page.click('#account .dq-logout')]);

  await page.click('#forgotBtn');
  await expect(page.locator('#recoverHead')).toBeVisible();
  await page.fill('#username', name);
  await page.fill('#recoveryCode', code.toLowerCase().replace(/-/g, ' '));
  await page.fill('#password', 'fresh1234');
  await page.fill('#password2', 'fresh1234');
  await page.click('#submit');
  const fresh = (await page.locator('#dqRcCode').textContent()).trim();
  expect(fresh).not.toBe(code);
  await page.check('#dqRcOk');
  await Promise.all([page.waitForURL((u) => u.pathname === '/'), page.click('#dqRcDone')]);

  await Promise.all([page.waitForURL('**/login/'), page.click('#account .dq-logout')]);
  await page.goto('/login/#recover');
  await page.fill('#username', name);
  await page.fill('#recoveryCode', code);
  await page.fill('#password', 'again1234');
  await page.fill('#password2', 'again1234');
  await page.click('#submit');
  await expect(page.locator('#error')).toContainText('아이디 또는 복구 코드가 맞지 않아요');
  await login(page, name, { password: 'fresh1234' });
});

test('복구 코드 새로 만들기 (비밀번호 확인)', async ({ page }) => {
  const name = uniqueName('ac');
  const code = await signup(page, name);
  await page.click('#account .dq-user');
  await page.fill('#dqRcPw', PASSWORD);
  await page.click('[data-sec="recovery"] button[type="submit"]');
  const next = (await page.locator('#dqRcCode').textContent()).trim();
  expect(next).not.toBe(code);
  await page.keyboard.press('Escape');
  await expect(page.locator('#dqRcCode')).toBeVisible(); // 저장했다고 체크하기 전에는 안 닫혀요
  await page.check('#dqRcOk');
  await page.click('#dqRcDone');
  await expect(page.locator('.dq-modal')).toHaveCount(0);
});

test('회원 탈퇴: 확인 문구까지 넣어야 지워지고, 이 브라우저 기록도 지워져요', async ({ page }) => {
  const name = uniqueName('ac');
  await signup(page, name, { next: '/sql/' });
  await expect(page.locator('.dq-sync')).toHaveAttribute('data-state', 'saved');
  await page.click('.dqbar .dq-user');
  await page.click('[data-sec="delete"] summary');
  await page.fill('#dqDelPw', PASSWORD);
  await page.fill('#dqDelOk', '탈퇴');
  await page.click('[data-sec="delete"] button[type="submit"]');
  await expect(page.locator('[data-sec="delete"] .dq-modal-error')).toContainText('탈퇴합니다');
  await page.fill('#dqDelOk', '탈퇴합니다');
  await Promise.all([page.waitForURL('**/login/'), page.click('[data-sec="delete"] button[type="submit"]')]);
  await expect(page.locator('#dq-notice')).toContainText('탈퇴했어요');
  expect(await page.evaluate(() => localStorage.getItem('sqlQueryLabProgress_v1'))).toBeNull();
  await page.fill('#username', name);
  await page.fill('#password', PASSWORD);
  await page.click('#submit');
  await expect(page.locator('#error')).toContainText('맞지 않아요');
});
