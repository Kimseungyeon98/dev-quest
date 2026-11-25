// e2e 테스트용 가짜 CheerpJ (진짜는 cjrtnc.leaningtech.com 에서 받아요 — 테스트에서는 네트워크 없이 이 파일로 바꿔요)
// 파일은 메모리에 두고, 실행하면 문제의 JS 참조 풀이(ref)로 정답 결과를 만들어요. 그래서 제출하면 항상 정답이에요.
// window.__hang = true 면 실행이 끝나지 않아요 (멈춤 감지 확인용).
(function () {
  const files = {}; window.__log = []; window.__delay = 0; window.__hang = false;
  const text = (b) => new TextDecoder().decode(b);
  window.cheerpjInit = async () => {};
  window.cheerpOSAddStringFile = (p, bytes) => { files[p] = text(bytes); };
  window.cjFileBlob = async (p) => { if (!(p in files)) throw new Error('no ' + p); return new Blob([files[p]]); };
  window.cheerpjRunMain = async (...a) => { window.__log.push(['main', a[0], a[1]]); if (a[0] === 'com.sun.tools.javac.Main') { const d = a[a.indexOf('-d') + 1]; files[d + 'AlgoHost.class'] = 'x'; } return 0; };
  window.cheerpjRunLibrary = async (dir) => ({ AlgoHost: Promise.resolve({
    compile: async (req) => { window.__log.push(['compile', req.split('\n')[0]]); const d = req.split('\n')[0]; files[d + 'JudgeCore.class'] = 'x'; return 'OK\n'; },
    reset: async () => {},
    run: (cp, cls, inp, out) => {
      window.__log.push(['run']);
      if (window.__hang) return new Promise(() => {});
      return new Promise((res) => setTimeout(() => {
        const input = JSON.parse(files[inp]);
        const title = (document.getElementById('problemTitle') || {}).textContent;
        const p = window.ALGO_DATA.PROBLEMS.find((x) => x.id === window.__pid) || window.ALGO_DATA.PROBLEMS.find((x) => x.title === title);
        const results = input.cases.map((c) => ({ s: 'ok', v: p.ref(...JSON.parse(JSON.stringify(c.a))), ms: 1, out: '', err: null }));
        files[out] = JSON.stringify({ token: input.token, results });
        res('OK');
      }, window.__delay));
    },
  }) });
})();
