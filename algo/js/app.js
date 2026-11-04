(function () {
  'use strict';

  const DQ = window.DevQuest;
  const AJ = window.AlgoJudge;
  const { CATEGORIES, PROBLEMS } = window.ALGO_DATA;
  const BY_ID = {};
  PROBLEMS.forEach((p) => { BY_ID[p.id] = p; });
  const CAT_BY_ID = {};
  CATEGORIES.forEach((c) => { CAT_BY_ID[c.id] = c; });

  const STORAGE_KEY = 'algoQuestProgress_v1';
  // XP·레벨·티어 규칙은 ../shared/dq.js 의 공용 규칙을 써요 (과목 간 동일)
  const dqBar = DQ.mountBar('algo');
  const ITEMS = PROBLEMS.map((p) => ({ id: p.id, difficulty: p.difficulty }));
  const OUT_DIR = '/files/algo/'; // 컴파일된 .class 와 채점 결과가 저장되는 CheerpJ 가상 폴더 (IndexedDB)

  const $ = (id) => document.getElementById(id);
  const esc = DQ.esc;

  const state = {
    currentId: null,
    solved: new Set(),
    codes: {},       // 문제별로 작성 중인 코드
    hintIndex: 0,
    busy: false,
    javaReady: false,
  };

  /* ============================================================
   * 진행 상태 저장
   * ========================================================== */
  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ solved: Array.from(state.solved), lastId: state.currentId, codes: state.codes }));
    } catch (e) { /* 저장 공간이 없어도 계속 진행 */ }
  }
  function markSolved(id) {
    if (state.solved.has(id)) return false;
    state.solved.add(id);
    saveProgress();
    renderHeader();
    renderSidebar();
    return true;
  }

  /* ============================================================
   * 문제 설명 마크업: 문단(빈 줄), `코드`, **굵게** 만 지원
   * ========================================================== */
  function inline(s) {
    return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  }
  function paragraphs(s) {
    return s.split(/\n\n+/).map((para) => `<p>${inline(para).replace(/\n/g, '<br>')}</p>`).join('');
  }

  /* ============================================================
   * 에디터 (CodeMirror 를 못 불러오면 textarea 로 대신해요)
   * ========================================================== */
  const editor = (function () {
    const ta = $('editor');
    if (window.CodeMirror) {
      const cm = window.CodeMirror.fromTextArea(ta, {
        mode: 'text/x-java', theme: 'dq', lineNumbers: true, indentUnit: 4, tabSize: 4, indentWithTabs: false,
        matchBrackets: true, autoCloseBrackets: true,
        extraKeys: {
          Tab: (c) => (c.somethingSelected() ? c.indentSelection('add') : c.replaceSelection('    ', 'end')),
          'Shift-Tab': (c) => c.indentSelection('subtract'),
        },
      });
      return {
        get: () => cm.getValue(),
        set: (v) => { cm.setValue(v); cm.clearHistory(); },
        onChange: (fn) => cm.on('change', fn),
        refresh: () => cm.refresh(),
      };
    }
    ta.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const s = ta.selectionStart;
      ta.value = ta.value.slice(0, s) + '    ' + ta.value.slice(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = s + 4;
    });
    return {
      get: () => ta.value,
      set: (v) => { ta.value = v; },
      onChange: (fn) => ta.addEventListener('input', fn),
      refresh: () => {},
    };
  })();

  /* ============================================================
   * Java 실행 (CheerpJ: 브라우저 안의 JVM 에서 진짜 javac 와 java 를 돌려요)
   * javac 를 매번 새로 띄우면 준비에만 4초 정도 걸려서, 상주 컴파일러(AlgoHost)를 라이브러리 모드로 올려 두고
   * JavaCompiler·파일 매니저를 재사용해요 (컴파일 약 0.6초). 채점도 같은 JVM 에서 새 ClassLoader 로 실행해요.
   * 라이브러리 모드를 쓸 수 없으면 javac 를 매번 띄우는 방식으로 돌아가요. 한 번에 하나만 실행할 수 있어서 작업을 줄 세워요.
   * ========================================================== */
  // AlgoHost.class 는 /files/ (IndexedDB) 에 남아서 다음 방문 때는 다시 컴파일하지 않아요. 소스를 고치면 폴더 버전을 올리세요.
  const HOST_DIR = '/files/algo-host-v3/';
  const LIB_DIR = `/files/algo-lib-v${AJ.JUDGE_LIB_VERSION}/`; // 한 번만 컴파일해 두는 JudgeCore (judge.js)
  const HOST_SRC = String.raw`import java.io.*;
import java.lang.reflect.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import javax.tools.*;

/* Algorithm Quest 상주 컴파일러: javac 와 파일 매니저를 한 번만 만들어 두고 재사용해요 */
public class AlgoHost {
    static JavaCompiler compiler;
    static StandardJavaFileManager files;

    /* request: 줄바꿈으로 이은 [출력 폴더, 클래스패스 폴더들(공백으로 구분), 소스 파일...].
     * 결과: "OK\n" 또는 "FAIL\n" 뒤에 컴파일러 메시지 */
    public static String compile(String request) {
        try {
            if (compiler == null) {
                compiler = ToolProvider.getSystemJavaCompiler();
                files = compiler.getStandardFileManager(null, null, StandardCharsets.UTF_8);
            }
            String[] parts = request.split("\n");
            String classPath = String.join(File.pathSeparator, parts[1].trim().split(" "));
            List<String> options = Arrays.asList("-d", parts[0], "-cp", classPath, "-encoding", "UTF-8", "-nowarn", "-proc:none");
            List<File> sources = new ArrayList<>();
            for (int i = 2; i < parts.length; i++) sources.add(new File(parts[i]));
            StringWriter out = new StringWriter();
            boolean ok = compiler.getTask(out, files, null, options, null, files.getJavaFileObjectsFromFiles(sources)).call();
            return (ok ? "OK\n" : "FAIL\n") + out;
        } catch (Throwable e) {
            return "FAIL\n" + e;
        }
    }

    /* 파일 매니저는 클래스패스 폴더 목록을 기억해 둬요. 클래스패스 폴더에 새 .class 를 만든 뒤에는 새로 만들어야 보여요 */
    public static void reset() {
        try { if (files != null) files.close(); } catch (IOException e) { }
        compiler = null;
        files = null;
    }

    /* 새 ClassLoader 로 cls.main(arg0, arg1) 을 실행해요 (매번 새로 읽어서 고친 코드와 새 static 값이 바로 반영돼요).
     * classPath: 공백으로 구분한 폴더들 (같은 ClassLoader 에 넣어야 패키지 전용 클래스끼리 접근할 수 있어요). 결과: "OK" 또는 "ERR 오류" */
    public static String run(String classPath, String cls, String arg0, String arg1) {
        String[] dirs = classPath.trim().split(" ");
        URL[] urls = new URL[dirs.length];
        try {
            for (int i = 0; i < dirs.length; i++) urls[i] = new File(dirs[i]).toURI().toURL();
        } catch (Throwable e) {
            return "ERR " + e;
        }
        try (URLClassLoader loader = new URLClassLoader(urls, AlgoHost.class.getClassLoader())) {
            loader.loadClass(cls).getMethod("main", String[].class).invoke(null, (Object) new String[]{ arg0, arg1 });
            return "OK";
        } catch (InvocationTargetException e) {
            return "ERR " + e.getCause();
        } catch (Throwable e) {
            return "ERR " + e;
        }
    }
}
`;

  const Java = {
    initPromise: null,
    hostPromise: null,
    chain: Promise.resolve(),
    init() {
      if (!this.initPromise) {
        this.initPromise = typeof window.cheerpjInit === 'function'
          ? window.cheerpjInit({ version: 17, status: 'none' })
          : Promise.reject(new Error('Java 실행기(CheerpJ)를 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.'));
      }
      return this.initPromise;
    },
    /* 상주 컴파일러. 준비하지 못하면 null (javac 를 매번 띄우는 방식으로 대신해요) */
    host() {
      if (!this.hostPromise) {
        this.hostPromise = (async () => {
          await this.init();
          if (typeof window.cheerpjRunLibrary !== 'function') return null;
          if (!(await this.exists(HOST_DIR + 'AlgoHost.class'))) {
            this.writeFile('/str/AlgoHost.java', HOST_SRC);
            $('console').textContent = '';
            const code = await window.cheerpjRunMain('com.sun.tools.javac.Main', HOST_DIR, '/str/AlgoHost.java', '-d', HOST_DIR, '-nowarn');
            if (code !== 0) { console.warn('AlgoHost 컴파일 실패', this.console()); return null; }
          }
          const lib = await window.cheerpjRunLibrary(HOST_DIR);
          const host = await lib.AlgoHost;
          if (!(await this.exists(LIB_DIR + 'JudgeCore.class'))) {
            this.writeFile('/str/JudgeCore.java', AJ.JUDGE_LIB);
            const r = String(await host.compile([LIB_DIR, HOST_DIR, '/str/JudgeCore.java'].join('\n')));
            if (!r.startsWith('OK')) { console.warn('JudgeCore 컴파일 실패', r); return null; }
            await host.reset();
          }
          return host;
        })().catch((e) => { console.warn('상주 컴파일러를 쓸 수 없어요', e); return null; });
      }
      return this.hostPromise;
    },
    async exists(path) {
      try { return (await window.cjFileBlob(path)).size > 0; } catch (e) { return false; }
    },
    enqueue(fn) {
      const r = this.chain.then(fn);
      this.chain = r.catch(() => {});
      return r;
    },
    writeFile(path, text) { window.cheerpOSAddStringFile(path, new TextEncoder().encode(text)); },
    console() { return $('console').textContent; },
    async compile(files) {
      const host = await this.host();
      // 상주 컴파일러가 없으면 JudgeCore 도 매번 같이 컴파일해요
      const all = host ? files : { ...files, 'JudgeCore.java': AJ.JUDGE_LIB };
      const paths = Object.keys(all).map((name) => { this.writeFile('/str/' + name, all[name]); return '/str/' + name; });
      if (host) {
        // 클래스패스에는 JudgeCore 폴더만 둬요 (Solution·Judge 는 매번 소스로 주니까요)
        const r = String(await host.compile([OUT_DIR, LIB_DIR, ...paths].join('\n')));
        const nl = r.indexOf('\n');
        return { ok: r.slice(0, nl) === 'OK', output: r.slice(nl + 1) };
      }
      $('console').textContent = '';
      const code = await window.cheerpjRunMain('com.sun.tools.javac.Main', OUT_DIR, ...paths, '-d', OUT_DIR, '-encoding', 'UTF-8', '-nowarn');
      return { ok: code === 0, output: this.console() };
    },
    /* 결과의 output 은 System.err 처럼 콘솔로 나간 내용, error 는 실행 자체가 실패한 이유 */
    async run(cls, args) {
      $('console').textContent = '';
      const host = await this.host();
      if (host) {
        const r = String(await host.run(OUT_DIR + ' ' + LIB_DIR, cls, args[0], args[1]));
        return { error: r === 'OK' ? '' : r.replace(/^ERR /, ''), output: this.console() };
      }
      const code = await window.cheerpjRunMain(cls, OUT_DIR, ...args);
      return { error: code === 0 ? '' : `종료 코드 ${code}`, output: this.console() };
    },
    async read(path) { return (await window.cjFileBlob(path)).text(); },
  };

  function setJavaStatus(text, cls) {
    const el = $('javaStatus');
    el.textContent = text;
    el.className = 'java-status' + (cls ? ' ' + cls : '');
  }

  /* 페이지를 열면 바로 상주 컴파일러를 올리고 한 번 컴파일해 둬요 (첫 컴파일이 가장 느려서 문제를 읽는 동안 미리 데워요) */
  function warmUp() {
    setJavaStatus('☕ Java 준비 중… (처음엔 30초 정도)', 'busy');
    Java.enqueue(async () => {
      await Java.init();
      // 지금 문제의 시작 코드로 두 번 컴파일해서 컴파일러의 JIT 를 데워 둬요 (두 번째부터 눈에 띄게 빨라져요)
      const p = BY_ID[state.currentId];
      const files = { 'Solution.java': AJ.instrument(AJ.starterCode(p)).code, 'Judge.java': AJ.judgeSource(p) };
      await Java.compile(files);
      await Java.compile(files);
    }).then(() => {
      state.javaReady = true;
      if (!state.busy) setJavaStatus('☕ Java 17 준비 완료', 'ready');
    }, (e) => setJavaStatus('⚠️ ' + (e.message || e), 'error'));
  }

  /* ============================================================
   * 실행·채점
   * ========================================================== */
  function showProgress(text, sub) {
    const box = $('resultBody');
    box.className = 'result-progress';
    box.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : '');
    setJavaStatus(text, 'busy');
  }
  function setBusy(b) {
    state.busy = b;
    $('runBtn').disabled = b;
    $('submitBtn').disabled = b;
  }

  async function runCode(mode) {
    if (state.busy) return;
    const p = BY_ID[state.currentId];
    const src = editor.get();
    setBusy(true);
    const t0 = performance.now();
    let result;
    try {
      const cases = AJ.buildCases(p, mode);
      const ins = AJ.instrument(src);
      result = await Java.enqueue(async () => {
        if (!state.javaReady) showProgress('☕ Java 준비 중…', '처음 한 번은 Java 실행기를 내려받느라 30초 정도 걸려요.');
        await Java.init();
        showProgress('🔨 컴파일 중…', state.javaReady ? '' : '첫 컴파일은 조금 오래 걸려요.');
        const tc = performance.now();
        const c = await Java.compile({ 'Solution.java': ins.code, 'Judge.java': AJ.judgeSource(p) });
        if (!c.ok) return { compileError: AJ.cleanCompilerOutput(c.output, src, ins.inserts, p) || '컴파일에 실패했어요.' };
        showProgress(`🏃 실행 중… (테스트 ${cases.length}개)`, mode === 'submit' ? '효율성 테스트는 입력이 커서 조금 걸릴 수 있어요.' : '');
        const tr = performance.now();
        const token = 'r' + Date.now() + Math.random().toString(36).slice(2);
        Java.writeFile('/str/input.json', AJ.judgeInput(cases, token));
        const r = await Java.run('Judge', ['/str/input.json', OUT_DIR + 'result.json']);
        let parsed = null;
        try { parsed = JSON.parse(await Java.read(OUT_DIR + 'result.json')); } catch (e) { parsed = null; }
        if (!parsed || parsed.token !== token) return { crash: [r.error, (r.output || '').trim()].filter(Boolean).join('\n') || '채점 결과를 읽지 못했어요. 다시 시도해 주세요.' };
        return { graded: AJ.grade(cases, parsed.results), stderr: r.output, compileMs: tr - tc, runMs: performance.now() - tr };
      });
      state.javaReady = true;
    } catch (e) {
      result = { crash: e.message || String(e) };
    }
    setBusy(false);
    setJavaStatus(state.javaReady ? '☕ Java 17 준비 완료' : '⚠️ Java 를 준비하지 못했어요', state.javaReady ? 'ready' : 'error');
    if (state.currentId !== p.id) return; // 실행 중에 다른 문제로 옮겼으면 결과를 버려요
    renderResult(p, mode, result, performance.now() - t0);
  }

  const STATUS_TEXT = { pass: '통과', fail: '실패', error: '실패 (런타임 에러)', timeout: '실패 (시간 초과)', skip: '건너뜀 (시간 초과가 반복돼서)' };
  const GROUP_TITLE = { example: '입출력 예', test: '정확성 테스트', big: '효율성 테스트' };

  function argsText(p, args) {
    return p.method.params.map((x, i) => `${x.name} = ${AJ.formatValue(args[i], 400)}`).join('\n');
  }

  function caseHtml(p, g) {
    const head = `<span>${esc(g.label)} 〉</span><span class="st ${g.status}">${STATUS_TEXT[g.status]}</span>`
      + (g.status !== 'skip' ? `<span class="ms">(${g.ms.toFixed(2)}ms)</span>` : '')
      + (g.note ? `<span class="note">· ${esc(g.note)}</span>` : '');
    const rows = [];
    if (g.kind !== 'big') {
      rows.push(['입력값', esc(argsText(p, g.args))]);
      rows.push(['기댓값', esc(AJ.formatValue(g.expected, 400))]);
    }
    if (g.status === 'pass' || g.status === 'fail') {
      if (g.kind !== 'big' || g.status === 'fail') rows.push(['실행 결과', esc(AJ.formatValue(g.actual, 400)), g.status === 'fail']);
    }
    if (g.status === 'error') rows.push(['오류', esc(g.err || ''), true]);
    if (g.status === 'timeout') rows.push(['안내', `제한 시간(${(g.limit / 1000).toFixed(0)}초)을 넘겼어요. 무한 루프이거나 시간 복잡도가 너무 커요.`, true]);
    if (g.out) rows.push(['출력', esc(g.out)]);
    // 입출력 예는 항상, 숨은 테스트는 틀렸을 때만 펼쳐 볼 수 있게
    const showDetail = rows.length && (g.kind === 'example' || g.status !== 'pass' || g.out);
    if (!showDetail) return `<div class="case"><div class="case-line">${head}</div></div>`;
    const dl = rows.map(([k, v, bad]) => `<dt>${k}</dt><dd${bad ? ' class="bad"' : ''}>${v}</dd>`).join('');
    const open = g.kind === 'example' && g.status !== 'pass' ? ' open' : '';
    return `<details class="case"${open}><summary>${head}</summary><dl class="case-detail">${dl}</dl></details>`;
  }

  function renderResult(p, mode, r, elapsed) {
    const box = $('resultBody');
    box.className = '';
    if (r.compileError) {
      box.innerHTML = `<p class="result-title">❌ 컴파일 오류</p><pre class="compile-error">${esc(r.compileError)}</pre>`;
      return;
    }
    if (r.crash) {
      box.innerHTML = `<p class="result-title">❌ 실행하지 못했어요</p><pre class="compile-error">${esc(r.crash)}</pre>`;
      return;
    }
    const g = r.graded;
    let html = '';
    ['example', 'test', 'big'].forEach((kind) => {
      const list = g.filter((x) => x.kind === kind);
      if (!list.length) return;
      const passed = list.filter((x) => x.pass).length;
      html += `<div class="group-title">${GROUP_TITLE[kind]} · ${passed}/${list.length}</div>` + list.map((x) => caseHtml(p, x)).join('');
    });
    const total = g.length, passed = g.filter((x) => x.pass).length;
    const secs = `걸린 시간 ${(elapsed / 1000).toFixed(1)}초 (컴파일 ${(r.compileMs / 1000).toFixed(1)}초 · 채점 ${(r.runMs / 1000).toFixed(1)}초)`;
    if (mode === 'run') {
      html += passed === total
        ? `<div class="verdict ok">입출력 예를 모두 통과했어요 👍<small>이제 "제출 후 채점하기"로 숨겨진 테스트까지 확인해 보세요. · ${secs}</small></div>`
        : `<div class="verdict ng">입출력 예 ${passed}/${total} 통과<small>틀린 예제를 펼쳐서 기댓값과 실행 결과를 비교해 보세요. · ${secs}</small></div>`;
    } else if (passed === total) {
      const first = markSolved(p.id);
      const xp = DQ.diffMeta(p.difficulty).xp;
      html += `<div class="verdict ok">🎉 정답이에요! 모든 테스트를 통과했어요.<small>${first ? `+${xp} XP 획득 · ` : ''}${secs}</small></div>`;
      if (first) toast(`🎉 정답! +${xp} XP`);
    } else {
      const part = (kind) => { const l = g.filter((x) => x.kind === kind); return l.length ? `${GROUP_TITLE[kind]} ${l.filter((x) => x.pass).length}/${l.length}` : ''; };
      const hint = g.some((x) => x.kind === 'big' && x.status === 'timeout') ? '효율성 테스트에서 시간 초과가 났어요. 더 빠른 알고리즘이 필요해요 — 힌트를 참고해 보세요.' : '틀린 테스트를 펼쳐서 입력값을 확인해 보세요.';
      html += `<div class="verdict ng">아쉽지만 틀렸어요 — ${[part('example'), part('test'), part('big')].filter(Boolean).join(' · ')}<small>${hint} · ${secs}</small></div>`;
    }
    const stderr = (r.stderr || '').trim();
    if (stderr) html += `<div class="group-title">표준 에러 (System.err)</div><pre class="stderr">${esc(stderr.slice(0, 4000))}</pre>`;
    box.innerHTML = html;
  }

  let toastTimer = null;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
  }

  /* ============================================================
   * 화면 그리기
   * ========================================================== */
  function renderHeader() {
    dqBar.update(DQ.stats(ITEMS, Array.from(state.solved)));
  }

  function renderSidebar() {
    const p = BY_ID[state.currentId];
    const list = $('questList');
    const opened = new Set(Array.from(list.querySelectorAll('details.dq-cat[open]')).map((d) => d.dataset.cat));
    const first = list.children.length === 0;
    list.innerHTML = CATEGORIES.map((cat) => {
      const ps = PROBLEMS.filter((x) => x.category === cat.id);
      const items = ps.map((x) => DQ.itemHtml({ id: x.id, title: x.title, difficulty: x.difficulty, done: state.solved.has(x.id), active: x.id === state.currentId })).join('');
      const done = ps.filter((x) => state.solved.has(x.id)).length;
      return DQ.catHtml({ id: cat.id, icon: cat.icon, label: cat.label, desc: cat.desc, done, total: ps.length }, items, (p && cat.id === p.category) || (!first && opened.has(cat.id)));
    }).join('');
    $('currentLabel').textContent = p ? '· ' + p.title : '';
  }

  function examplesHtml(p) {
    const head = p.method.params.map((x) => `<th>${esc(x.name)}</th>`).join('') + '<th>result</th>';
    const rows = p.examples.map((e) => '<tr>' + e.args.map((a) => `<td>${esc(AJ.formatValue(a, 400))}</td>`).join('') + `<td>${esc(AJ.formatValue(e.expected, 400))}</td></tr>`).join('');
    return `<table class="examples"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  }

  function loadProblem(id) {
    const p = BY_ID[id];
    if (!p) return;
    state.currentId = id;
    state.hintIndex = 0;
    const cat = CAT_BY_ID[p.category];
    const d = DQ.diffMeta(p.difficulty);
    $('problemTitle').textContent = p.title;
    $('problemMeta').innerHTML = `<span class="chip">${esc(cat.icon)} ${esc(cat.label)}</span>`
      + `<span class="chip ${d.cls}">${d.stars} ${d.label} · ${d.xp} XP</span>`
      + `<span class="chip">⏱ 케이스당 ${((p.limitMs || AJ.DEFAULT_LIMIT_MS) / 1000).toFixed(0)}초</span>`
      + (state.solved.has(id) ? '<span class="chip solved">✓ 해결함</span>' : '');
    $('problemDesc').innerHTML = paragraphs(p.desc);
    $('problemConstraints').innerHTML = p.constraints.map((c) => `<li>${inline(c)}</li>`).join('');
    $('problemExamples').innerHTML = examplesHtml(p);
    ['hintBox', 'conceptBox', 'answerBox'].forEach((b) => { $(b).classList.add('hidden'); $(b).innerHTML = ''; });
    $('hintBtn').textContent = `💡 힌트 (0/${p.hints.length})`;
    $('problemPane').scrollTop = 0;
    editor.set(state.codes[id] || AJ.starterCode(p));
    const box = $('resultBody');
    box.className = 'result-placeholder';
    box.textContent = '"코드 실행"은 입출력 예만, "제출 후 채점하기"는 숨겨진 정확성·효율성 테스트까지 채점해요.';
    renderSidebar();
    saveProgress();
  }

  /* ============================================================
   * 힌트 / 개념 / 모범 답안
   * ========================================================== */
  $('hintBtn').addEventListener('click', () => {
    const p = BY_ID[state.currentId];
    if (state.hintIndex < p.hints.length) state.hintIndex++;
    const box = $('hintBox');
    box.innerHTML = '<ol>' + p.hints.slice(0, state.hintIndex).map((h) => `<li>${inline(h)}</li>`).join('') + '</ol>';
    box.classList.remove('hidden');
    $('hintBtn').textContent = `💡 힌트 (${state.hintIndex}/${p.hints.length})`;
  });
  $('conceptBtn').addEventListener('click', () => {
    const p = BY_ID[state.currentId];
    const box = $('conceptBox');
    if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
    box.innerHTML = paragraphs(p.concept);
    box.classList.remove('hidden');
  });
  $('answerBtn').addEventListener('click', () => {
    const box = $('answerBox');
    if (!box.classList.contains('hidden')) { box.classList.add('hidden'); return; }
    box.innerHTML = '<p>모범 답안을 볼까요? 힌트를 보고 한 번 더 시도해 보면 훨씬 오래 기억에 남아요.</p><div class="answer-actions"><button type="button" id="answerShow">답안 보기</button></div>';
    box.classList.remove('hidden');
  });
  $('answerBox').addEventListener('click', (e) => {
    const p = BY_ID[state.currentId];
    const box = $('answerBox');
    if (e.target.id === 'answerShow') {
      box.innerHTML = `<pre class="code">${esc(p.solution)}</pre><p>${inline(p.explain)}</p><div class="answer-actions"><button type="button" id="answerCopy">에디터에 붙여넣기</button></div>`;
    } else if (e.target.id === 'answerCopy') {
      if (editor.get().trim() !== AJ.starterCode(p).trim() && !window.confirm('지금 작성한 코드를 모범 답안으로 바꿀까요?')) return;
      editor.set(p.solution);
    }
  });

  $('resetBtn').addEventListener('click', () => {
    const p = BY_ID[state.currentId];
    if (!window.confirm('작성한 코드를 지우고 시작 코드로 되돌릴까요?')) return;
    delete state.codes[p.id];
    editor.set(AJ.starterCode(p));
    saveProgress();
  });

  let saveTimer = null;
  editor.onChange(() => {
    const p = BY_ID[state.currentId];
    if (!p) return;
    const v = editor.get();
    if (v.trim() === AJ.starterCode(p).trim()) delete state.codes[p.id];
    else state.codes[p.id] = v;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveProgress, 400);
  });

  $('runBtn').addEventListener('click', () => runCode('run'));
  $('submitBtn').addEventListener('click', () => runCode('submit'));
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      runCode(e.shiftKey ? 'submit' : 'run');
    } else if (e.key === 'Escape') {
      $('cheatSheetModal').classList.add('hidden');
    }
  });

  $('questList').addEventListener('click', (e) => {
    const btn = e.target.closest('.dq-item');
    if (!btn) return;
    loadProblem(btn.dataset.id);
    if (window.matchMedia('(max-width: 1100px)').matches) {
      $('questListDetails').removeAttribute('open');
      $('problemPane').scrollIntoView({ block: 'start' });
    }
  });

  /* ============================================================
   * 자바 치트시트
   * ========================================================== */
  const CHEAT = [
    ['배열', `int[] a = {3, 1, 2};
Arrays.sort(a);                 // 오름차순
Arrays.fill(dp, -1);
int[] b = a.clone();
int[] part = Arrays.copyOfRange(a, 0, 2);
System.out.println(Arrays.toString(a));

int[][] m = new int[n][m];
Arrays.sort(m, (x, y) -> Integer.compare(x[0], y[0]));`],
    ['문자열', `s.length(); s.charAt(i); s.substring(a, b);
String[] w = s.trim().split("\\\\s+");
char[] cs = s.toCharArray(); Arrays.sort(cs);
String t = new String(cs);
int n = Integer.parseInt("42");
String v = String.valueOf(42);

StringBuilder sb = new StringBuilder();
sb.append("a").append(1); sb.reverse(); sb.toString();`],
    ['리스트', `List<Integer> list = new ArrayList<>();
list.add(3); list.get(0); list.size();
Collections.sort(list);
Collections.sort(list, Collections.reverseOrder());
int[] arr = list.stream().mapToInt(Integer::intValue).toArray();
// 그래프 인접 리스트
List<List<Integer>> g = new ArrayList<>();
for (int i = 0; i < n; i++) g.add(new ArrayList<>());`],
    ['해시', `Map<String, Integer> m = new HashMap<>();
m.put("a", 1);
m.getOrDefault("b", 0);
m.merge("a", 1, Integer::sum);   // 개수 세기
m.containsKey("a");
for (Map.Entry<String, Integer> e : m.entrySet()) { e.getKey(); e.getValue(); }

Set<Integer> set = new HashSet<>();
set.add(1); set.contains(1); set.size();`],
    ['스택·큐·덱', `Deque<Integer> stack = new ArrayDeque<>();
stack.push(1); stack.pop(); stack.peek();

Deque<Integer> queue = new ArrayDeque<>();
queue.offer(1); queue.poll(); queue.peek();

// 덱: 양쪽에서 넣고 빼기
dq.offerLast(x); dq.pollFirst(); dq.peekLast();
stack.isEmpty();`],
    ['우선순위 큐 (힙)', `PriorityQueue<Integer> min = new PriorityQueue<>();
PriorityQueue<Integer> max = new PriorityQueue<>(Collections.reverseOrder());
min.offer(5); min.poll(); min.peek();

// {노드, 거리} 를 거리 순으로
PriorityQueue<int[]> pq =
    new PriorityQueue<>((x, y) -> Integer.compare(x[1], y[1]));`],
    ['오버플로 조심', `Integer.MAX_VALUE   // 2,147,483,647 (약 21억)
long sum = 0;       // 합·곱이 21억을 넘을 수 있으면 long
long big = (long) a * b;
int mid = (lo + hi) >>> 1;   // lo + hi 오버플로 방지
final int MOD = 1_000_000_007;
x = (x + y) % MOD;`],
    ['자주 쓰는 패턴', `int[] dr = {-1, 1, 0, 0}, dc = {0, 0, -1, 1}; // 상하좌우
boolean[][] visited = new boolean[n][m];

Math.max(a, b); Math.min(a, b); Math.abs(x);
// 디버깅 출력은 채점 결과의 "출력" 칸에 보여요
System.out.println("i = " + i);`],
  ];
  $('cheatSheetBody').innerHTML = '<div class="cheat-grid">' + CHEAT.map(([t, code]) => `<section><h4>${esc(t)}</h4><pre class="code">${esc(code)}</pre></section>`).join('') + '</div>';
  $('cheatSheetBtn').addEventListener('click', () => $('cheatSheetModal').classList.remove('hidden'));
  $('closeCheatSheet').addEventListener('click', () => $('cheatSheetModal').classList.add('hidden'));
  $('cheatSheetModal').addEventListener('click', (e) => { if (e.target.id === 'cheatSheetModal') $('cheatSheetModal').classList.add('hidden'); });

  /* ============================================================
   * 시작
   * ========================================================== */
  const saved = loadProgress();
  if (saved) {
    state.solved = new Set((saved.solved || []).filter((id) => BY_ID[id]));
    state.codes = saved.codes || {};
  }
  loadProblem(saved && BY_ID[saved.lastId] ? saved.lastId : PROBLEMS[0].id);
  renderHeader();
  if (window.matchMedia('(max-width: 1100px)').matches) $('questListDetails').removeAttribute('open');
  if (location.protocol === 'file:') {
    setJavaStatus('⚠️ 파일로 열면 Java 를 실행할 수 없어요', 'error');
    $('resultBody').innerHTML = '<div class="verdict ng">이 과목은 웹 서버로 열어야 해요<small>브라우저 안에서 Java 를 실행하는 CheerpJ 는 file:// 주소에서 동작하지 않아요. 저장소 루트에서 <code>node algo/tools/serve.js</code> 를 실행한 뒤 http://localhost:8000/algo/ 로 열어 주세요.</small></div>';
    setBusy(true);
  } else {
    warmUp();
  }
})();
