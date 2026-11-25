/* 과목 앱 시작: 계정 진행도를 받은 뒤에 앱 스크립트를 불러요.
 * <script src="../shared/start.js" data-app="js/app.js"></script>
 * (HTML 안에 스크립트를 직접 쓰지 않아요 — 보안 정책(CSP)이 페이지 안 스크립트를 막아요) */
(function () {
  var app = document.currentScript && document.currentScript.getAttribute('data-app');
  if (app) window.DevQuest.afterSync(app);
})();
