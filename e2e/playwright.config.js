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
    // 서비스 워커(사이트 파일 캐시)는 기본으로 끄고, 필요한 테스트(wake.spec.js)에서만 켜요
    serviceWorkers: 'block',
  },
  // 가짜 SSO 서비스 (sso.spec.js). 서버는 --spring.config.additional-location=file:e2e/fixtures/fake-oauth.yml 로 띄워야 해요
  webServer: { command: 'node fixtures/fake-oauth.js', url: 'http://localhost:9099/health', reuseExistingServer: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } }],
});
