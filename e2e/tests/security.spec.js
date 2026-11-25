// 보안 정책(CSP): 모든 화면이 정책을 어기지 않고 동작하는지 (인라인 스크립트·허용하지 않은 주소 등)
const { test, expect } = require('@playwright/test');
const { uniqueName, isolate, signup } = require('./helpers');

test.beforeEach(async ({ context, baseURL }) => { await isolate(context, baseURL); });

/** 페이지에서 일어난 CSP 위반을 모아요 */
async function watchCsp(page) {
  const found = [];
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) found.push(m.text()); });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => console.error('Refused to (CSP) ' + e.violatedDirective + ' ' + e.blockedURI));
  });
  return found;
}

test('모든 화면이 보안 정책(CSP) 안에서 동작해요', async ({ page }) => {
  const violations = await watchCsp(page);
  await page.goto('/login/');
  await expect(page.locator('#submit')).toBeVisible();
  await signup(page, uniqueName('sec'));
  await expect(page.locator('#hero .btn-primary')).toBeVisible();
  await expect(page.locator('#rankMini li, #rankMini .empty').first()).toBeVisible();

  await page.goto('/linux/');
  await expect(page.locator('.dq-sync')).toHaveAttribute('data-state', 'saved');
  await page.goto('/sql/');
  await expect(page.locator('#loadingBanner')).toBeHidden({ timeout: 30_000 }); // SQLite(WebAssembly)가 떴어요
  await page.goto('/git/');
  await page.locator('#modal').waitFor({ state: 'visible', timeout: 3000 }).then(() => page.click('#modalX')).catch(() => {});
  await expect(page.locator('#scenarioList details').first()).toBeAttached();
  await page.goto('/algo/');
  await expect(page.locator('#runBtn')).toBeVisible();
  await page.waitForTimeout(500);

  expect(violations).toEqual([]);
});

test('정책이 실제로 인라인 스크립트를 막아요', async ({ page }) => {
  await signup(page, uniqueName('sec'));
  const ran = await page.evaluate(() => new Promise((resolve) => {
    window.__injected = false;
    const s = document.createElement('script');
    s.textContent = 'window.__injected = true';
    document.body.appendChild(s);
    setTimeout(() => resolve(window.__injected), 100);
  }));
  expect(ran).toBe(false);
});
