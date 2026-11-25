/* git/index.html 이 시나리오 파일(scenario-files.js 의 목록)을 순서대로 불러요.
 * 파서가 이 스크립트를 실행하는 자리에 바로 끼워 넣어서, 다음 스크립트(ui-render.js)보다 먼저 실행돼요. */
window.GIT_PLAYBOOK_SCENARIO_FILES.forEach(function (f) { document.write('<script src="js/' + f + '"><' + '/script>'); });
