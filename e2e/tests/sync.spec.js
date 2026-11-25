// 진행도 동기화: 로그인 전 기록 옮기기 · 다른 기기 · 충돌 합치기 · 바로 떠나기 · 로그아웃
const { test, expect } = require('@playwright/test');
const { uniqueName, isolate, signup, login, api } = require('./helpers');

test.beforeEach(async ({ context, baseURL }) => { await isolate(context, baseURL); });

const server = (page) => api(page, '/api/progress').then((r) => r.data.courses);
async function settle(page) {
  await page.waitForTimeout(100);
  await expect(page.locator('.dq-sync')).toHaveAttribute('data-state', 'saved');
}
async function untilServer(page, predicate) {
  await expect.poll(async () => predicate(await server(page)), { timeout: 10_000 }).toBeTruthy();
}

test('로그인 전에 쌓인 기록은 처음 로그인한 계정으로 옮겨져요', async ({ page }) => {
  await page.goto('/login/');
  await page.evaluate(() => {
    localStorage.setItem('sqlQueryLabProgress_v1', JSON.stringify({ solved: ['legacy-1', 'legacy-2'], lastProblemId: 'legacy-2' }));
    localStorage.setItem('gitplaybook:v1', JSON.stringify({ done: { 'basic-01': { t: 1 } }, seen: true }));
  });
  await signup(page, uniqueName('sy'), { next: '/sql/' });
  await expect(page.locator('#dq-notice')).toContainText('계정에 합쳤어요');
  await untilServer(page, (c) => c.sql && c.sql.data.solved.length === 2 && c.git && c.git.data.done['basic-01']);
});

test('다른 기기에서 이어지고, 충돌하면 두 기록을 합쳐요', async ({ page, browser, baseURL }) => {
  const name = uniqueName('sy');
  await signup(page, name, { next: '/algo/' });
  await expect(page.locator('#problemTitle')).not.toBeEmpty();
  await page.locator('#editor').evaluate((ta) => { ta.value = '// A 기기에서 쓴 코드\n' + ta.value; ta.dispatchEvent(new Event('input')); });
  await untilServer(page, (c) => c.algo && JSON.stringify(c.algo.data).includes('A 기기에서'));

  const other = await browser.newContext();
  await isolate(other, baseURL);
  const p2 = await other.newPage();
  await login(p2, name, { next: '/algo/' });
  await expect(p2.locator('#editor')).toHaveValue(/A 기기에서/);

  // 충돌: 두 기기가 같은 버전에서 따로 저장
  await page.goto('/sql/'); await p2.goto('/sql/');
  await expect(page.locator('.dq-sync')).toHaveAttribute('data-state', 'saved');
  await expect(p2.locator('.dq-sync')).toHaveAttribute('data-state', 'saved');
  const add = (id) => { const k = 'sqlQueryLabProgress_v1'; const d = JSON.parse(localStorage.getItem(k) || '{"solved":[]}'); d.solved.push(id); localStorage.setItem(k, JSON.stringify(d)); window.DevQuest.sync.changed('sql'); };
  await page.evaluate(add, 'from-A');
  await settle(page);
  await p2.evaluate(add, 'from-B');
  await expect(p2.locator('#dq-notice')).toContainText('합쳤어요');
  await untilServer(page, (c) => c.sql && ['from-A', 'from-B'].every((x) => c.sql.data.solved.includes(x)));
  await other.close();
});

test('저장하자마자 떠나도 올라가고, 로그아웃하면 이 브라우저 기록은 지워져요', async ({ page }) => {
  await signup(page, uniqueName('sy'), { next: '/git/' });
  await expect(page.locator('.dq-sync')).toHaveAttribute('data-state', 'saved');
  await page.evaluate(() => { const k = 'gitplaybook:v1'; const d = JSON.parse(localStorage.getItem(k) || '{"done":{}}'); d.done = d.done || {}; d.done['quick-leave'] = { t: 2 }; localStorage.setItem(k, JSON.stringify(d)); window.DevQuest.sync.changed('git'); });
  await page.goto('/'); // 1.2초 기다리지 않고 바로 이동
  await untilServer(page, (c) => c.git && c.git.data.done['quick-leave']);

  await Promise.all([page.waitForURL('**/login/'), page.click('#account .dq-logout')]);
  const left = await page.evaluate(() => ['sqlQueryLabProgress_v1', 'gitplaybook:v1', 'algoQuestProgress_v1', 'linuxQuestProgress_v1'].map((k) => localStorage.getItem(k)));
  expect(left).toEqual([null, null, null, null]);
  await signup(page, uniqueName('sy'));
  expect(Object.keys(await server(page))).toHaveLength(0); // 새 계정에는 이전 계정 기록이 안 옮겨져요
});
