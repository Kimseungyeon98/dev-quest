// 테스트 공통 도우미
const path = require('path');
const { expect } = require('@playwright/test');

const PASSWORD = 'abc12345';
let seq = 0;
/** 아이디 규칙(영문·숫자·_ 4~20자)에 맞는, 실행마다 겹치지 않는 아이디 */
function uniqueName(prefix) {
  seq += 1;
  return `${prefix}_${Date.now().toString(36).slice(-5)}${process.pid % 100}${seq}`.slice(0, 20);
}

/**
 * 바깥 네트워크는 막고(테스트가 인터넷에 기대지 않게), Java 실행기(CheerpJ)는 가짜로 바꿔요.
 * CodeMirror CDN 이 막히면 Algorithm Quest 는 textarea 편집기로 동작해요.
 */
async function isolate(context, baseURL) {
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.includes('leaningtech.com')) return route.fulfill({ path: path.join(__dirname, '..', 'fixtures', 'stub-cheerpj.js'), contentType: 'text/javascript' });
    if (url.startsWith(baseURL) || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('http://localhost:9099/')) return route.continue(); // 가짜 SSO
    return route.abort();
  });
}

/** 가입 → 복구 코드 창에서 "저장했어요" 체크 → 시작하기. 복구 코드를 돌려줘요 */
async function signup(page, name, { next = '/', remember = false } = {}) {
  await page.goto('/login/' + (next !== '/' ? '?next=' + encodeURIComponent(next) : ''));
  await page.click('#tabSignup');
  await page.fill('#username', name);
  await page.fill('#password', PASSWORD);
  await page.fill('#password2', PASSWORD);
  if (remember) await page.check('#rememberMe');
  await page.click('#submit');
  const code = (await page.locator('#dqRcCode').textContent()).trim();
  await expect(page.locator('#dqRcDone')).toBeDisabled();
  await page.check('#dqRcOk');
  await Promise.all([page.waitForURL((u) => u.pathname + u.search === next), page.click('#dqRcDone')]);
  return code;
}

async function login(page, name, { password = PASSWORD, next = '/', remember = false } = {}) {
  await page.goto('/login/' + (next !== '/' ? '?next=' + encodeURIComponent(next) : ''));
  await page.fill('#username', name);
  await page.fill('#password', password);
  if (remember) await page.check('#rememberMe');
  await Promise.all([page.waitForURL((u) => u.pathname + u.search === next), page.click('#submit')]);
}

/** 페이지 안에서 API 부르기 (CSRF 헤더 포함) */
function api(page, path, opts) {
  return page.evaluate(([p, o]) => window.DevQuest.api(p, o), [path, opts || {}]);
}

/** 퀘스트 카탈로그 (과목별 퀘스트 id·난이도) */
const catalog = require(path.join(__dirname, '..', '..', 'shared', 'quests.json'));
const questIds = (course, diff) => Object.entries(catalog.courses[course].quests).filter(([, d]) => !diff || d === diff).map(([id]) => id);

module.exports = { PASSWORD, uniqueName, isolate, signup, login, api, catalog, questIds };
