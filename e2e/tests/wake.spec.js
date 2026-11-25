// 잠든 서버가 깨어나는 동안: "서버를 깨우는 중" 안내 · 다시 시도 · 캐시해 둔 화면 먼저 보여 주기
const { test, expect } = require('@playwright/test');
const { uniqueName, isolate, signup } = require('./helpers');

test.beforeEach(async ({ context, baseURL }) => { await isolate(context, baseURL); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('API 가 늦으면 "서버를 깨우는 중" 안내를 보여 주고, 응답이 오면 내려요', async ({ page }) => {
  await signup(page, uniqueName('wk'));
  await page.route('**/api/me', async (route) => { await sleep(3000); await route.continue(); });
  await page.reload();
  await expect(page.locator('#dq-wake')).toContainText('서버를 깨우는 중');
  await expect(page.locator('#hero .btn-primary')).toBeVisible();
  await expect(page.locator('#dq-wake')).toHaveCount(0, { timeout: 15_000 });
});

test('깨어나는 동안 502·503 이 오면 잠시 뒤 다시 시도해요', async ({ page }) => {
  await signup(page, uniqueName('wk'));
  let failures = 2;
  await page.route('**/api/progress', async (route) => {
    if (failures > 0) { failures--; return route.fulfill({ status: 503, body: 'waking up' }); }
    return route.continue();
  });
  await page.reload();
  await expect(page.locator('#dq-wake')).toBeVisible();
  await expect(page.locator('#rankMini')).toBeVisible(); // 서버 모드로 시작했어요
  await expect(page.locator('#dq-wake')).toHaveCount(0, { timeout: 15_000 });
  expect(failures).toBe(0);
  await expect(page.locator('#dq-notice')).toHaveCount(0); // "불러오지 못했어요" 안내는 없어요
});

test.describe('서비스 워커', () => {
  test.use({ serviceWorkers: 'allow' });

  test('서버가 늦으면 캐시해 둔 화면을 먼저 보여 줘요', async ({ page, context, baseURL }) => {
    await signup(page, uniqueName('wk'));
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()));
    await page.reload(); // 이제 서비스 워커가 화면을 맡아요
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.reload(); // 화면 파일을 캐시에 담아요
    await expect(page.locator('#hero .btn-primary')).toBeVisible();

    // 서버가 잠들었다고 치고 모든 요청을 8초씩 늦춰요
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    const delayed = [];
    await context.route('**/*', async (route) => {
      if (!route.request().url().startsWith(baseURL)) return route.abort();
      delayed.push(new URL(route.request().url()).pathname);
      await sleep(8000);
      return route.continue().catch(() => {});
    });
    const started = Date.now();
    const res = await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('#hero')).toBeVisible({ timeout: 7000 });
    expect(Date.now() - started).toBeLessThan(8000);
    expect(res.fromServiceWorker()).toBe(true); // 화면은 캐시에서
    expect(delayed).toContain('/'); // 서버에도 물어봤지만(늦게 오는 응답으로 캐시를 고쳐요) 기다리지 않았어요
    await expect(page.locator('#dq-wake')).toContainText('서버를 깨우는 중');
    await expect(page.locator('#dq-wake')).toHaveCount(0, { timeout: 30_000 }); // 깨어나면 내려요
  });
});
