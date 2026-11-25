// Dev Quest 브라우저 테스트 설정.
// 실행 전에 백엔드를 띄워 두세요 (README 의 "브라우저 테스트" 참고). 주소는 E2E_BASE_URL 로 바꿀 수 있어요.
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:8080',
    trace: 'off',
    screenshot: 'only-on-failure',
    locale: 'ko-KR',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } }],
});
