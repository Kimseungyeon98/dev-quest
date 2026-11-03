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
   * 한 번에 하나만 실행할 수 있어서 작업을 줄 세워요.
   * ========================================================== */
  const Java = {
    initPromise: null,
    chain: Promise.resolve(),
    init() {
      if (!this.initPromise) {
        this.initPromise = typeof window.cheerpjInit === 'function'
          ? window.cheerpjInit({ version: 17, status: 'none' })
          : Promise.reject(new Error('Java 실행기(CheerpJ)를 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.'));
      }
      return this.initPromise;
    },
    enqueue(fn) {
      const r = this.chain.then(fn);
      this.chain = r.catch(() => {});
      return r;
    },
    writeFile(path, text) { window.cheerpOSAddStringFile(path, new TextEncoder().encode(text)); },
    console() { return $('console').textContent; },
    async compile(files) {
      $('console').textContent = '';
      const paths = Object.keys(files).map((name) => { this.writeFile('/str/' + name, files[name]); return '/str/' + name; });
      const code = await window.cheerpjRunMain('com.sun.tools.javac.Main', OUT_DIR, ...paths, '-d', OUT_DIR, '-encoding', 'UTF-8', '-nowarn');
      return { ok: code === 0, output: this.console() };
    },
    async run(cls, args) {
      $('console').textContent = '';
      const code = await window.cheerpjRunMain(cls, OUT_DIR, ...args);
      return { code, output: this.console() };
    },
    async read(path) { return (await window.cjFileBlob(path)).text(); },
  };

  function setJavaStatus(text, cls) {
    const el = $('javaStatus');
    el.textContent = text;
    el.className = 'java-status' + (cls ? ' ' + cls : '');
  }

  /* 페이지를 열면 바로 javac 를 한 번 돌려 둬요 (첫 컴파일이 가장 느려서 문제를 읽는 동안 미리 데워요) */
  function warmUp() {
    setJavaStatus('☕ Java 준비 중… (처음엔 30초 정도)', 'busy');
    Java.enqueue(async () => {
      await Java.init();
      const c = await Java.compile({ 'Warm.java': 'public class Warm { public static void main(String[] a) { } }' });
      if (c.ok) await Java.run('Warm', []);
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
        const c = await Java.compile({ 'Solution.java': ins.code, 'Judge.java': AJ.judgeSource(p) });
        if (!c.ok) return { compileError: AJ.cleanCompilerOutput(c.output, src, ins.inserts, p) || '컴파일에 실패했어요.' };
        showProgress(`🏃 실행 중… (테스트 ${cases.length}개)`, mode === 'submit' ? '효율성 테스트는 입력이 커서 조금 걸릴 수 있어요.' : '');
        const token = 'r' + Date.now() + Math.random().toString(36).slice(2);
        Java.writeFile('/str/input.json', AJ.judgeInput(cases, token));
        const r = await Java.run('Judge', ['/str/input.json', OUT_DIR + 'result.json']);
        let parsed = null;
        try { parsed = JSON.parse(await Java.read(OUT_DIR + 'result.json')); } catch (e) { parsed = null; }
        if (!parsed || parsed.token !== token) return { crash: (r.output || '').trim() || '채점 결과를 읽지 못했어요. 다시 시도해 주세요.' };
        return { graded: AJ.grade(cases, parsed.results), stderr: r.output };
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
    const secs = `걸린 시간 ${(elapsed / 1000).toFixed(1)}초 (컴파일 포함)`;
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
