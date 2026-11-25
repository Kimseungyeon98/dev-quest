/* Dev Quest 공용 모듈: 난이도·XP·레벨·티어 계산과 과목 상단 바.
 * 모든 과목이 같은 규칙으로 점수를 계산해서 허브와 각 과목 화면이 항상 같은 값을 보여 줘요.
 *
 * 규칙
 *  - 난이도(초급/중급/고급)마다 XP 가중치가 달라요. (초급 100 · 중급 150 · 고급 250)
 *  - 레벨업에 필요한 XP 는 레벨이 오를수록 늘어나요.
 *  - 티어는 "전체 XP 가중치 대비 내가 얻은 XP 비율"로 정해요. */
(function () {
  'use strict';

  const DIFFICULTY = {
    easy: { label: '초급', stars: '★☆☆', xp: 100, cls: 'diff-easy' },
    medium: { label: '중급', stars: '★★☆', xp: 150, cls: 'diff-medium' },
    hard: { label: '고급', stars: '★★★', xp: 250, cls: 'diff-hard' },
  };
  const DIFF_KEYS = ['easy', 'medium', 'hard'];

  /* 'easy' | 'medium' | 'hard' 또는 숫자 난이도(1~5)를 3단계로 맞춘다 */
  function diffKey(d) {
    if (typeof d === 'number') return d <= 2 ? 'easy' : d === 3 ? 'medium' : 'hard';
    return DIFFICULTY[d] ? d : 'easy';
  }
  function diffMeta(d) { return DIFFICULTY[diffKey(d)]; }

  /* 레벨 L → L+1 에 필요한 XP */
  const needFor = (L) => 200 + 50 * L;
  function levelInfo(xp) {
    let level = 1, rest = xp;
    while (rest >= needFor(level)) { rest -= needFor(level); level++; }
    return { level, into: rest, need: needFor(level), total: xp };
  }

  const TIERS = [
    { id: 'seed', name: '새싹', icon: '🌱', min: 0, color: '#8b949e' },
    { id: 'bronze', name: '브론즈', icon: '🥉', min: 0.05, color: '#cd7f32' },
    { id: 'silver', name: '실버', icon: '🥈', min: 0.2, color: '#c0c7d0' },
    { id: 'gold', name: '골드', icon: '🥇', min: 0.4, color: '#e3b341' },
    { id: 'platinum', name: '플래티넘', icon: '💠', min: 0.6, color: '#56d4dd' },
    { id: 'diamond', name: '다이아', icon: '💎', min: 0.8, color: '#79c0ff' },
    { id: 'master', name: '마스터', icon: '👑', min: 0.97, color: '#f778ba' },
  ];
  function tierFor(ratio) {
    let idx = 0;
    TIERS.forEach((t, i) => { if (ratio >= t.min - 1e-9) idx = i; });
    return { tier: TIERS[idx], next: TIERS[idx + 1] || null, index: idx };
  }

  /* items: [{id, difficulty}], doneIds: 완료한 id 배열 */
  function stats(items, doneIds) {
    const done = new Set(doneIds || []);
    const by = { easy: { done: 0, total: 0 }, medium: { done: 0, total: 0 }, hard: { done: 0, total: 0 } };
    let xp = 0, maxXp = 0, doneCount = 0;
    items.forEach((it) => {
      const k = diffKey(it.difficulty);
      by[k].total++; maxXp += DIFFICULTY[k].xp;
      if (done.has(it.id)) { by[k].done++; xp += DIFFICULTY[k].xp; doneCount++; }
    });
    const ratio = maxXp ? xp / maxXp : 0;
    const t = tierFor(ratio);
    return {
      total: items.length, done: doneCount, xp, maxXp, ratio, by,
      level: levelInfo(xp), tier: t.tier, nextTier: t.next,
      toNext: t.next ? Math.max(0, Math.ceil(t.next.min * maxXp - xp)) : 0,
    };
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* ---------- 선 아이콘 ----------
   * 24×24 격자, 1.8px 선. 이모지 대신 써서 운영체제마다 모양이 달라지지 않고 화면이 조용해져요.
   * JS: DevQuest.icon('bulb')  ·  HTML: <span data-icon="bulb"></span> (페이지가 열릴 때 채워져요) */
  const ICONS = {
    book: 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v14H6.5A1.5 1.5 0 0 0 5 18.5z M5 18.5A1.5 1.5 0 0 0 6.5 20H19 M9 7h6',
    bulb: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.9V16h5v-.2c0-.8.4-1.5 1-1.9A6 6 0 0 0 12 3z',
    cap: 'M2.5 9 12 4.5 21.5 9 12 13.5z M6.5 11v4.5c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V11 M21.5 9v5',
    reset: 'M4 4v5h5 M4.6 9A8 8 0 1 1 4 13',
    close: 'M6 6l12 12 M18 6 6 18',
    play: 'M7.5 5.5v13l10-6.5z',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    checkCircle: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M8 12.5l2.5 2.5L16 9.5',
    xCircle: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M9 9l6 6 M15 9l-6 6',
    help: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6 M12 17h.01',
    lock: 'M6.5 10.5h11v9h-11z M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5',
    key: 'M7 9a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M14 12l6.5 6.5 M17.5 15.5l2-2',
    table: 'M3.5 5.5h17v13h-17z M3.5 10h17 M3.5 14.5h17 M9.5 5.5v13',
    target: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M12 12h.01',
    list: 'M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    box: 'M4 7.5 12 3.5l8 4v9l-8 4-8-4z M4 7.5l8 4 8-4 M12 11.5v9',
    loader: 'M12 3v3 M12 18v3 M3 12h3 M18 12h3 M5.6 5.6l2.1 2.1 M16.3 16.3l2.1 2.1 M5.6 18.4l2.1-2.1 M16.3 7.7l2.1-2.1',
    menu: 'M4 6h16 M4 12h16 M4 18h16',
    search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z M15.5 15.5 20 20',
    flask: 'M9 3h6 M10 3v6.5L4.8 18.3A1.8 1.8 0 0 0 6.3 21h11.4a1.8 1.8 0 0 0 1.5-2.7L14 9.5V3 M7.5 15h9',
    branch: 'M6 3.5v10 M8.5 16a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0 M20.5 7a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0 M18 9.5c0 4-4 5-10.5 5.5',
    folder: 'M3.5 6.5A1.5 1.5 0 0 1 5 5h4.5l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z',
    globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M3 12h18 M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z',
    clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M12 7.5V12l3 2',
    trophy: 'M8 21h8 M12 17v4 M7 4h10v5a5 5 0 0 1-10 0z M7 6H4v2a3 3 0 0 0 3 3 M17 6h3v2a3 3 0 0 1-3 3',
    arrow: 'M5 12h14 M13 6l6 6-6 6',
    flame: 'M12 3c.6 3.2 3.6 4.7 4.6 7.8A5.6 5.6 0 1 1 6.2 9.4c.8 1.5 1.8 2.3 2.8 2.5C8.4 8.6 10 5.6 12 3z',
    copy: 'M8.5 8.5h11v12h-11z M5.5 15.5h-1v-12h11v1',
    download: 'M12 4v11 M7.5 10.5 12 15l4.5-4.5 M5 20h14',
    terminal: 'M3.5 5.5h17v13h-17z M7.5 10l3 2.5-3 2.5 M13 15h4',
    dot: 'M12 12h.01',
  };
  function icon(name, size) {
    const d = ICONS[name] || name; // 이름이 없으면 path 문자열로 봐요 (과목 아이콘 courses.js iconPath)
    const px = size || 16;
    return `<svg class="dq-icon" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${esc(d)}"/></svg>`;
  }
  function decorateIcons(root) {
    (root || document).querySelectorAll('[data-icon]:empty').forEach((el) => { el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 16); });
  }

  /* ---------- 정답 뒤 다음 퀘스트로 (Enter / Tab) ----------
   * 정답을 맞힌 "바로 다음" 키가 Enter 나 Tab 이면 다음 퀘스트로 넘어가요. 그 전에 다른 키를 누르면
   * (계속 코드를 고치거나 명령을 치는 경우) 원래 동작으로 돌아가요. 한글 입력 조합 중인 키는 건드리지 않아요. */
  let nextKeyHandler = null;
  function disarmNext() {
    if (nextKeyHandler) window.removeEventListener('keydown', nextKeyHandler, true);
    nextKeyHandler = null;
    document.querySelectorAll('.dq-next.armed').forEach((b) => b.classList.remove('armed'));
  }
  function armNext(go, button) {
    disarmNext();
    nextKeyHandler = (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn'].includes(e.key)) return;
      if (e.target && e.target.closest && e.target.closest('.dq-modal, [role="dialog"]')) return; // 닉네임 창 등에서는 그대로
      const plain = !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey;
      disarmNext();
      if (plain && (e.key === 'Enter' || e.key === 'Tab')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        go();
      }
    };
    window.addEventListener('keydown', nextKeyHandler, true);
    if (button) button.classList.add('armed');
  }
  /* "다음 퀘스트" 버튼을 만들고 Enter/Tab 도 바로 연결해요 */
  function nextButton(label, go, className) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dq-next' + (className ? ' ' + className : '');
    b.innerHTML = `<span>${esc(label)}</span>${icon('arrow', 16)}<span class="dq-keys" aria-hidden="true"><kbd>Enter</kbd><kbd>Tab</kbd></span>`;
    b.setAttribute('aria-keyshortcuts', 'Enter Tab');
    b.addEventListener('click', () => { disarmNext(); go(); });
    armNext(go, b);
    return b;
  }

  /* ---------- 백엔드 API ----------
   * 같은 주소의 Spring 백엔드를 불러요. POST/PUT/DELETE 는 XSRF-TOKEN 쿠키 값을 X-XSRF-TOKEN 헤더로 보내야 해요(CSRF).
   * 돌려주는 값: { ok, status, data }  (data 는 JSON 응답, 오류면 { error: '화면에 보여 줄 문장' }) */
  function cookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  async function api(path, opts) {
    const o = opts || {};
    const method = o.method || 'GET';
    const headers = { Accept: 'application/json' };
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && method !== 'HEAD') { const t = cookie('XSRF-TOKEN'); if (t) headers['X-XSRF-TOKEN'] = t; }
    const init = { method, headers, credentials: 'same-origin', body: o.body !== undefined ? JSON.stringify(o.body) : undefined };
    let res;
    const done = wake.begin();
    try {
      // 잠들었던 서버가 깨어나는 동안 앞단(Railway)이 502·503·504 를 주거나 연결이 끊길 수 있어요. 잠시 뒤 다시 시도해요.
      // 이런 응답은 요청이 서버에 닿지 않은 거라 다시 보내도 안전해요. 연결 실패는 GET 만 다시 보내요 (가입이 두 번 되지 않게).
      const until = Date.now() + WAKE_RETRY_MS;
      for (let attempt = 0; ; attempt++) {
        let retry = false;
        try {
          res = await fetch(path, init);
          retry = res.status === 502 || res.status === 503 || res.status === 504;
        } catch (e) {
          if (method !== 'GET' || Date.now() >= until) return { ok: false, status: 0, data: { error: '서버에 연결하지 못했어요. 네트워크를 확인해 주세요.' } };
          retry = true;
        }
        if (!retry || Date.now() >= until) break;
        wake.show();
        await new Promise((r) => setTimeout(r, Math.min(1000 * (attempt + 1), 4000)));
      }
    } finally {
      done();
    }
    let data = null;
    if ((res.headers.get('Content-Type') || '').includes('json')) { try { data = await res.json(); } catch (e) { data = null; } }
    return { ok: res.ok, status: res.status, data };
  }

  /* ---------- 서버를 깨우는 중 ----------
   * 한동안 아무도 안 쓰면 서버가 잠들어요(Railway Serverless). 다시 깨는 데 몇~십몇 초가 걸려서,
   * API 응답이 WAKE_AFTER_MS 넘게 늦으면 화면 위쪽에 안내를 띄우고 응답이 모두 오면 내려요. */
  const WAKE_AFTER_MS = 1500;
  const WAKE_RETRY_MS = 60000;
  const wake = (() => {
    let pending = 0, timer = null, box = null, shownAt = 0;
    function show() {
      if (box || !document.body) return;
      box = document.createElement('div');
      box.id = 'dq-wake'; box.className = 'dq-wake'; box.setAttribute('role', 'status');
      box.innerHTML = '<span class="dq-wake-dot" aria-hidden="true"></span><span><b>서버를 깨우는 중이에요</b>'
        + '<small>한동안 쉬고 있던 서버가 다시 켜지고 있어요. 보통 10초 안쪽이면 돼요.</small></span>';
      document.body.appendChild(box);
      shownAt = Date.now();
    }
    function hide() {
      if (!box) return;
      const el = box; box = null;
      // 깜빡이지 않게 최소 0.6초는 보여 줘요
      setTimeout(() => { el.classList.add('dq-wake-done'); setTimeout(() => el.remove(), 300); }, Math.max(0, 600 - (Date.now() - shownAt)));
    }
    return {
      show,
      begin() {
        pending++;
        if (!timer && !box) timer = setTimeout(() => { timer = null; if (pending > 0) show(); }, WAKE_AFTER_MS);
        let ended = false;
        return () => {
          if (ended) return; ended = true;
          if (--pending > 0) return;
          if (timer) { clearTimeout(timer); timer = null; }
          hide();
        };
      }
    };
  })();

  // 서버가 깨어나는 동안에도 화면은 바로 뜨게: 사이트 파일을 캐시해 두는 서비스 워커 (/sw.js)
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
  }

  function loginUrl() {
    const here = location.pathname + location.search;
    return '/login/' + (here === '/' ? '' : '?next=' + encodeURIComponent(here));
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src; el.async = false;
      el.onload = resolve; el.onerror = () => reject(new Error('스크립트를 불러오지 못했어요: ' + src));
      document.head.appendChild(el);
    });
  }

  /* ---------- 알림 (화면 아래 작은 안내) ---------- */
  function notice(text, action) {
    let box = document.getElementById('dq-notice');
    if (!box) {
      box = document.createElement('div');
      box.id = 'dq-notice'; box.className = 'dq-notice'; box.setAttribute('role', 'status');
      document.body.appendChild(box);
    }
    box.innerHTML = `<span>${esc(text)}</span>` + (action ? `<button type="button">${esc(action.label)}</button>` : '') + '<button type="button" class="dq-x" aria-label="닫기">×</button>';
    if (action) box.querySelector('button').addEventListener('click', action.run);
    box.querySelector('.dq-x').addEventListener('click', () => box.classList.remove('show'));
    box.classList.add('show');
    clearTimeout(notice.timer);
    if (!action) notice.timer = setTimeout(() => box.classList.remove('show'), 6000);
  }

  /* ---------- 진행도 동기화 ----------
   * 과목 앱은 지금처럼 localStorage(과목의 storageKey)를 읽고 써요. 이 모듈이 그 값을 계정과 맞춰 줘요.
   *  - 페이지를 열면: 서버 진행도를 localStorage 에 먼저 써 두고 과목 앱을 시작해요 (DevQuest.afterSync)
   *  - 앱이 저장하면: DevQuest.sync.changed(과목) → 잠깐 모았다가 PUT /api/progress/{과목}
   *  - 다른 기기에서 먼저 저장했으면(409): 두 기록을 합쳐서(merge) 다시 저장해요
   *  - 아직 못 올린 기록(dirty)은 다음에 페이지를 열 때 올려요
   *  - 로그인 기능 전에 이 브라우저에 쌓인 진행도는 첫 로그인 때 계정에 합쳐요
   *  - 로그아웃하면 이 브라우저의 진행도를 지워서 다른 계정과 섞이지 않게 해요
   * 백엔드 없이(파일·serve.js) 열면 예전처럼 이 브라우저에만 저장해요. */

  /* 두 진행도 합치기: 목록은 합집합, 객체는 키별로, 나머지 값은 a(이 기기)를 따라요 */
  function merge(a, b) {
    if (a === undefined || a === null) return b === undefined ? null : b;
    if (b === undefined || b === null) return a;
    if (Array.isArray(a) && Array.isArray(b)) {
      const out = a.slice();
      const seen = new Set(a.map((x) => JSON.stringify(x)));
      b.forEach((x) => { const k = JSON.stringify(x); if (!seen.has(k)) { seen.add(k); out.push(x); } });
      return out;
    }
    const isObj = (v) => typeof v === 'object' && !Array.isArray(v);
    if (isObj(a) && isObj(b)) {
      const out = Object.assign({}, b);
      Object.keys(a).forEach((k) => { out[k] = merge(a[k], b[k]); });
      return out;
    }
    return a;
  }

  const sync = (function () {
    const META_KEY = 'devQuest:sync'; // { user, courses: { 과목: { version, dirty } } }
    const ACTIVITY_KEY = 'devQuest:activity'; // { 과목: 마지막으로 진행도를 저장한 시각(ms) } — 허브 "이어하기"용
    const PUSH_DELAY = 1200;
    const RETRY_DELAY = 30000;
    const KEEPALIVE_MAX = 60000; // 페이지를 떠날 때 보내는 요청(keepalive)의 본문 한도(64KB)보다 조금 작게
    let mode = 'local';
    let meta = null;
    let readyPromise = null;
    const timers = {}, chains = {}, mergeBase = {};

    const courses = () => window.DEV_QUEST_COURSES || [];
    const courseOf = (id) => courses().find((c) => c.id === id);
    function readMeta() { try { return JSON.parse(localStorage.getItem(META_KEY)); } catch (e) { return null; } }
    function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (e) { /* 무시 */ } }
    function rawLocal(c) { try { return localStorage.getItem(c.storageKey); } catch (e) { return null; } }
    function readLocal(c) { try { const raw = rawLocal(c); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
    function writeLocal(c, data) {
      try { if (data == null) localStorage.removeItem(c.storageKey); else localStorage.setItem(c.storageKey, JSON.stringify(data)); } catch (e) { /* 무시 */ }
    }
    function entry(id) { return (meta.courses[id] = meta.courses[id] || { version: 0, dirty: false }); }
    function activity() { try { return JSON.parse(localStorage.getItem(ACTIVITY_KEY)) || {}; } catch (e) { return {}; } }
    function touch(id, when) {
      const a = activity();
      const t = typeof when === 'number' ? when : Date.parse(when);
      if (!Number.isFinite(t)) return;
      a[id] = Math.max(a[id] || 0, t);
      try { localStorage.setItem(ACTIVITY_KEY, JSON.stringify(a)); } catch (e) { /* 무시 */ }
    }

    function setStatus(state, title) {
      document.querySelectorAll('.dq-sync').forEach((el) => {
        el.dataset.state = state;
        const label = { saved: '저장됨', saving: '저장 중', error: '저장 실패' }[state] || '';
        el.innerHTML = label ? `<span class="dq-sr">${label}</span>` : '';
        el.title = title || { saved: '진행도가 계정에 저장됐어요', saving: '진행도를 저장하는 중이에요', error: '진행도를 저장하지 못했어요' }[state] || '';
      });
    }

    function ready() {
      if (!readyPromise) readyPromise = init().catch((e) => { console.warn('진행도 동기화 실패', e); return mode; });
      return readyPromise;
    }

    async function init() {
      if (location.protocol === 'file:') return mode;
      const me = await getMe();
      if (me.status === 401) { location.href = loginUrl(); return new Promise(() => {}); }
      if (!me.ok || !me.data || !me.data.username) return mode; // 백엔드 없이 연 경우
      const user = me.data.username;
      const all = await api('/api/progress');
      if (!all.ok) { notice('서버에서 진행도를 불러오지 못했어요. 이 브라우저에 있는 기록으로 시작해요.'); return mode; }
      mode = 'server';

      const prev = readMeta();
      let migrated = false;
      if (!prev) {
        // 로그인 기능 전에 이 브라우저에 쌓인 진행도 → 처음 로그인한 계정에 합쳐요
        meta = { user, courses: {} };
        courses().forEach((c) => { if (readLocal(c)) { entry(c.id).dirty = true; migrated = true; } });
      } else if (prev.user !== user) {
        // 이 브라우저에 남은 다른 계정의 기록은 쓰지 않아요
        meta = { user, courses: {} };
      } else {
        meta = { user, courses: prev.courses || {} };
      }

      const server = (all.data && all.data.courses) || {};
      if (!prev || prev.user !== user) { try { localStorage.removeItem(ACTIVITY_KEY); } catch (e) { /* 무시 */ } }
      Object.keys(server).forEach((id) => { if (server[id].updatedAt) touch(id, server[id].updatedAt); });
      const toPush = [];
      courses().forEach((c) => {
        const s = server[c.id];
        const e = entry(c.id);
        const local = readLocal(c);
        if (e.dirty && local) { // 아직 올리지 못한 이 기기의 기록
          writeLocal(c, s ? merge(local, s.data) : local);
          e.version = s ? s.version : 0;
          toPush.push(c.id);
        } else {
          writeLocal(c, s ? s.data : null);
          e.version = s ? s.version : 0;
          e.dirty = false;
        }
      });
      saveMeta();
      toPush.forEach(push);
      if (migrated) notice('이 브라우저에 있던 진행도를 계정에 합쳤어요. 이제 어디서 접속하든 이어서 할 수 있어요.');
      window.addEventListener('pagehide', flushOnLeave);
      setStatus('saved');
      return mode;
    }

    /* 과목 앱이 진행도를 저장한 직후에 불러요 */
    function changed(id) {
      if (courseOf(id)) touch(id, Date.now());
      if (mode !== 'server' || !meta || !courseOf(id)) return;
      entry(id).dirty = true;
      saveMeta();
      setStatus('saving');
      clearTimeout(timers[id]);
      timers[id] = setTimeout(() => push(id), PUSH_DELAY);
    }

    /* 과목별로 한 번에 하나씩 보내요 */
    function push(id) {
      clearTimeout(timers[id]); timers[id] = null;
      chains[id] = (chains[id] || Promise.resolve()).then(() => pushNow(id, 0));
      return chains[id];
    }

    async function pushNow(id, attempt) {
      const c = courseOf(id);
      const e = entry(id);
      if (!e.dirty) return;
      const rawBefore = rawLocal(c);
      let data = readLocal(c) || {};
      if (mergeBase[id]) data = merge(data, mergeBase[id]);
      const r = await api('/api/progress/' + id, { method: 'PUT', body: { data, version: e.version } });
      if (r.ok) {
        e.version = r.data.version;
        if (r.data.updatedAt) touch(id, r.data.updatedAt);
        if (rawLocal(c) === rawBefore) e.dirty = false; // 보내는 동안 또 바뀌었으면 한 번 더 보내요
        saveMeta();
        if (e.dirty) changed(id); else if (!Object.values(timers).some(Boolean)) setStatus('saved');
        return;
      }
      if (r.status === 409 && r.data && r.data.current && attempt < 3) {
        // 다른 기기에서 먼저 저장했어요 → 합쳐서 다시 저장. 열려 있는 화면은 합친 기록을 모르니,
        // 새로고침 전까지는 저장할 때마다 상대 기록을 같이 합쳐서 지워지지 않게 해요
        const current = r.data.current;
        mergeBase[id] = merge(current.data, mergeBase[id]);
        writeLocal(c, merge(readLocal(c) || data, current.data));
        e.version = current.version;
        saveMeta();
        notice('다른 기기에서 저장한 진행도를 합쳤어요.', { label: '새로고침', run: () => location.reload() });
        return pushNow(id, attempt + 1);
      }
      if (r.status === 401) {
        setStatus('error', '로그인이 만료돼서 저장하지 못했어요');
        notice('로그인이 만료돼서 진행도를 저장하지 못했어요. 다시 로그인하면 이어서 저장해요.', { label: '다시 로그인', run: () => { location.href = loginUrl(); } });
        return;
      }
      setStatus('error');
      notice((r.data && r.data.error) || '진행도를 저장하지 못했어요. 잠시 후 다시 시도할게요.');
      if (r.status !== 400 && r.status !== 404 && r.status !== 413) timers[id] = setTimeout(() => push(id), RETRY_DELAY);
    }

    /* 페이지를 떠날 때 아직 안 보낸 기록을 보내요 (실패해도 dirty 가 남아 다음에 열 때 올려요) */
    function flushOnLeave() {
      Object.keys(timers).forEach((id) => {
        if (!timers[id]) return;
        clearTimeout(timers[id]); timers[id] = null;
        const e = entry(id);
        let data = readLocal(courseOf(id)) || {};
        if (mergeBase[id]) data = merge(data, mergeBase[id]);
        const body = JSON.stringify({ data, version: e.version });
        if (body.length > KEEPALIVE_MAX) return;
        try {
          fetch('/api/progress/' + id, {
            method: 'PUT', keepalive: true, credentials: 'same-origin', body,
            headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': cookie('XSRF-TOKEN') || '' },
          });
        } catch (err) { /* 다음에 열 때 올려요 */ }
      });
    }

    /* 로그아웃 전에: 남은 기록을 보내고, 이 브라우저의 진행도를 지워요 */
    async function beforeLogout() {
      if (mode !== 'server' || !meta) return;
      const pending = Object.keys(meta.courses).filter((id) => meta.courses[id].dirty);
      await Promise.all(pending.map(push));
      clearLocal();
    }

    /* 이 브라우저의 진행도 기록 지우기 (로그아웃·탈퇴) */
    function clearLocal() {
      Object.keys(timers).forEach((id) => { clearTimeout(timers[id]); timers[id] = null; });
      courses().forEach((c) => writeLocal(c, null));
      try { localStorage.removeItem(ACTIVITY_KEY); } catch (e) { /* 무시 */ }
      // 다음 로그인 때 "로그인 전 기록"으로 오해하지 않게, 기록이 비어 있다는 표시만 남겨요
      try { localStorage.setItem(META_KEY, JSON.stringify({ user: null, courses: {} })); } catch (e) { /* 무시 */ }
    }

    return { ready, changed, beforeLogout, clearLocal, setStatus, activity, mode: () => mode, merge };
  })();

  /* 진행도를 계정과 맞춘 뒤에 과목 앱 스크립트를 실행해요 */
  function afterSync(srcs) {
    return sync.ready().then(async () => {
      for (const src of [].concat(srcs)) await loadScript(src);
    });
  }

  /* 내 계정 정보 { username, nickname, defaultNickname } — 한 페이지에서 한 번만 불러요 */
  let meCache = null;
  function getMe() {
    if (!meCache) meCache = location.protocol === 'file:' ? Promise.resolve({ ok: false, status: 0, data: null }) : api('/api/me');
    return meCache;
  }
  function setMe(data) {
    meCache = Promise.resolve({ ok: true, status: 200, data });
    document.querySelectorAll('.dq-account .dq-uname').forEach((el) => { el.textContent = data.nickname; });
    document.querySelectorAll('.dq-account .dq-avatar').forEach((el) => { el.textContent = Array.from(data.nickname)[0] || '?'; });
    document.querySelectorAll('.dq-account .dq-user').forEach((el) => {
      el.title = `내 계정 (로그인 아이디: ${data.username})`;
      el.classList.toggle('needs-rc', !data.hasRecoveryCode);
    });
    window.dispatchEvent(new CustomEvent('dq:me', { detail: data })); // 허브 랭킹 등이 다시 그려요
  }

  /* 로그인한 사람(닉네임)과 로그아웃 버튼. 닉네임을 누르면 내 계정(닉네임·비밀번호·복구 코드) 창이 열려요.
   * 백엔드 없이 파일·serve.js 로 열면(/api/me 가 없으면) 아무것도 안 보여요 */
  async function mountAccount(host) {
    if (!host || location.protocol === 'file:') return;
    host.classList.add('dq-account');
    const r = await getMe();
    if (!r.ok || !r.data || !r.data.username) return;
    host.innerHTML = '<span class="dq-sync" aria-live="polite"></span>'
      + `<button type="button" class="dq-user${r.data.hasRecoveryCode ? '' : ' needs-rc'}" title="내 계정 (로그인 아이디: ${esc(r.data.username)})" aria-haspopup="dialog"><span class="dq-avatar" aria-hidden="true">${esc(Array.from(r.data.nickname)[0] || '?')}</span><span class="dq-uname">${esc(r.data.nickname)}</span></button>`
      + '<button type="button" class="dq-logout">로그아웃</button>';
    host.querySelector('.dq-user').addEventListener('click', () => openAccountDialog());
    host.querySelector('.dq-logout').addEventListener('click', logout);
    if (sync.mode() === 'server') sync.setStatus('saved');
    // 복구 코드가 없는 계정(복구 기능 전에 가입)에는 브라우저 세션당 한 번 알려 줘요
    if (!r.data.hasRecoveryCode) {
      let shown = false;
      try { shown = sessionStorage.getItem('devQuest:rcNudge') === '1'; sessionStorage.setItem('devQuest:rcNudge', '1'); } catch (e) { /* 무시 */ }
      if (!shown) notice('비밀번호를 잊었을 때 쓸 복구 코드가 아직 없어요.', { label: '만들기', run: () => { document.getElementById('dq-notice').classList.remove('show'); openAccountDialog('recovery'); } });
    }
  }

  /* ---------- 창(모달) 공통 ----------
   * html 을 담은 창을 열고 { box, close } 를 돌려줘요. Esc·바깥 클릭·[data-close] 로 닫혀요 (locked 면 닫히지 않아요). */
  function openModal(html, opts) {
    const o = opts || {};
    const opener = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'dq-modal';
    wrap.innerHTML = `<div class="dq-modal-box${o.wide ? ' wide' : ''}" role="dialog" aria-modal="true"${o.labelledBy ? ` aria-labelledby="${o.labelledBy}"` : ''}>${html}</div>`;
    document.body.appendChild(wrap);
    const box = wrap.firstElementChild;
    function close() {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      if (opener && opener.focus) opener.focus();
      if (o.onClose) o.onClose();
    }
    function onKey(e) { if (e.key === 'Escape' && !o.locked) close(); }
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => {
      if (o.locked) return;
      if (e.target === wrap || (e.target.closest && e.target.closest('[data-close]'))) close();
    });
    const first = box.querySelector('[autofocus], input, button');
    if (first) first.focus();
    return { box, close };
  }
  const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/;
  const NICKNAME_RE = /^[가-힣A-Za-z0-9_]{2,12}$/;

  /* 복구 코드 보여 주기: 한 번만 보이니 복사·저장하고 "저장했어요"를 체크해야 닫혀요 */
  function showRecoveryCode(code, opts) {
    const o = opts || {};
    const m = openModal(`
      <h2 id="dqRcTitle">${esc(o.title || '복구 코드를 저장해 두세요')}</h2>
      <p class="dq-modal-sub">비밀번호를 잊었을 때 <b>아이디 + 이 코드</b>로 새 비밀번호를 정할 수 있어요. 이 코드는 <b>지금 한 번만</b> 보여요.</p>
      <p class="dq-code" id="dqRcCode">${esc(code)}</p>
      <div class="dq-modal-actions start">
        <button type="button" class="dq-btn-ghost" id="dqRcCopy">${icon('copy')} 복사</button>
        <button type="button" class="dq-btn-ghost" id="dqRcSave">${icon('download')} 파일로 저장</button>
      </div>
      <label class="dq-check"><input type="checkbox" id="dqRcOk" /> 안전한 곳에 저장했어요</label>
      <div class="dq-modal-actions"><button type="button" class="dq-btn" id="dqRcDone" disabled>${esc(o.doneLabel || '확인')}</button></div>`,
      { labelledBy: 'dqRcTitle', locked: true });
    const box = m.box;
    box.querySelector('#dqRcCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(code); notice('복구 코드를 복사했어요.'); }
      catch (e) { const r = document.createRange(); r.selectNodeContents(box.querySelector('#dqRcCode')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); notice('코드를 선택했어요. Ctrl+C 로 복사해 주세요.'); }
    });
    box.querySelector('#dqRcSave').addEventListener('click', () => {
      const text = `Dev Quest 복구 코드\n아이디: ${o.username || ''}\n복구 코드: ${code}\n\n비밀번호를 잊었을 때 로그인 화면의 "비밀번호를 잊었어요"에서 아이디와 이 코드로 새 비밀번호를 정할 수 있어요.\n한 번 쓰면 새 코드로 바뀌어요.\n`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      a.download = 'dev-quest-recovery-code.txt';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    const ok = box.querySelector('#dqRcOk'), done = box.querySelector('#dqRcDone');
    ok.addEventListener('change', () => { done.disabled = !ok.checked; });
    done.addEventListener('click', () => { m.close(); if (o.onDone) o.onDone(); });
  }

  /* 내 계정: 닉네임 · 비밀번호 바꾸기 · 복구 코드. section 으로 처음 보여 줄 곳을 고를 수 있어요 */
  async function openAccountDialog(section) {
    const r = await getMe();
    if (!r.ok || !r.data) return;
    const me = r.data;
    const m = openModal(`
      <div class="dq-modal-head"><h2 id="dqAccTitle">내 계정</h2><button type="button" class="dq-x" data-close aria-label="닫기">${icon('close', 18)}</button></div>
      <p class="dq-modal-sub">로그인 아이디 <b>${esc(me.username)}</b> · 아이디는 다른 사람에게 보이지 않아요.</p>

      <form class="dq-sec" data-sec="nickname" novalidate>
        <h3>닉네임</h3>
        <label for="dqNick">랭킹에 보이는 이름</label>
        <input id="dqNick" type="text" maxlength="12" autocomplete="nickname" spellcheck="false" value="${esc(me.defaultNickname ? '' : me.nickname)}" placeholder="${esc(me.nickname)}" />
        <p class="dq-modal-hint">한글·영문·숫자·_ 2~12자 · 다른 사람과 겹치지 않게</p>
        <p class="dq-modal-error" role="alert"></p>
        <div class="dq-modal-actions"><button type="submit" class="dq-btn">닉네임 저장</button></div>
      </form>

      <form class="dq-sec" data-sec="password" novalidate>
        <h3>비밀번호 바꾸기</h3>
        <label for="dqPwCur">지금 비밀번호</label>
        <input id="dqPwCur" type="password" autocomplete="current-password" maxlength="64" />
        <label for="dqPwNew">새 비밀번호</label>
        <input id="dqPwNew" type="password" autocomplete="new-password" maxlength="64" />
        <label for="dqPwNew2">새 비밀번호 확인</label>
        <input id="dqPwNew2" type="password" autocomplete="new-password" maxlength="64" />
        <p class="dq-modal-hint">8~64자, 영문과 숫자를 모두 · 바꾸면 다른 기기의 로그인은 끊겨요</p>
        <p class="dq-modal-error" role="alert"></p>
        <div class="dq-modal-actions"><button type="submit" class="dq-btn">비밀번호 바꾸기</button></div>
      </form>

      <form class="dq-sec" data-sec="recovery" novalidate>
        <h3>복구 코드</h3>
        <p class="dq-modal-hint dq-rc-state">${me.hasRecoveryCode
          ? '복구 코드가 있어요. 잃어버렸으면 새로 만들어요 (예전 코드는 더 이상 못 써요).'
          : '<b class="dq-warn-text">아직 복구 코드가 없어요.</b> 비밀번호를 잊으면 계정을 되찾을 수 없으니 지금 만들어 두세요.'}</p>
        <label for="dqRcPw">비밀번호 확인</label>
        <input id="dqRcPw" type="password" autocomplete="current-password" maxlength="64" />
        <p class="dq-modal-error" role="alert"></p>
        <div class="dq-modal-actions"><button type="submit" class="dq-btn">${me.hasRecoveryCode ? '새로 만들기' : '복구 코드 만들기'}</button></div>
      </form>

      <details class="dq-sec dq-danger" data-sec="delete">
        <summary><h3>회원 탈퇴</h3></summary>
        <form novalidate>
          <p class="dq-modal-hint">계정과 모든 과목의 진행도·랭킹 기록이 바로 지워지고 되돌릴 수 없어요. 같은 아이디로 다시 가입할 수는 있어요.</p>
          <label for="dqDelPw">비밀번호 확인</label>
          <input id="dqDelPw" type="password" autocomplete="current-password" maxlength="64" />
          <label for="dqDelOk">확인을 위해 <b>탈퇴합니다</b> 라고 입력해 주세요</label>
          <input id="dqDelOk" type="text" autocomplete="off" maxlength="10" />
          <p class="dq-modal-error" role="alert"></p>
          <div class="dq-modal-actions"><button type="submit" class="dq-btn dq-btn-danger">탈퇴하기</button></div>
        </form>
      </details>`, { wide: true, labelledBy: 'dqAccTitle' });
    const box = m.box;
    const sec = (name) => box.querySelector(`[data-sec="${name}"]`);
    function fail(form, res, fallback) {
      const err = form.querySelector('.dq-modal-error');
      err.textContent = (res && res.data && res.data.error) || fallback;
      const field = res && res.data && res.data.field;
      const map = { nickname: '#dqNick', currentPassword: form.dataset.sec === 'recovery' ? '#dqRcPw' : '#dqPwCur', newPassword: '#dqPwNew', password: '#dqRcPw' };
      const el = (field && map[field] && form.querySelector(map[field])) || form.querySelector('input');
      if (el) el.focus();
    }
    if (section && sec(section)) { const el = sec(section).querySelector('input'); sec(section).scrollIntoView({ block: 'nearest' }); if (el) el.focus(); }

    sec('nickname').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget, nickname = form.querySelector('#dqNick').value.trim();
      if (!NICKNAME_RE.test(nickname)) return fail(form, null, '닉네임은 한글·영문·숫자·_ 2~12자예요.');
      const btn = form.querySelector('button'); btn.disabled = true;
      const res = await api('/api/me/nickname', { method: 'PUT', body: { nickname } });
      btn.disabled = false;
      if (!res.ok) return fail(form, res, '저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
      form.querySelector('.dq-modal-error').textContent = '';
      setMe(res.data);
      notice(`닉네임을 "${res.data.nickname}"(으)로 바꿨어요.`);
    });
    sec('password').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const cur = form.querySelector('#dqPwCur').value, next = form.querySelector('#dqPwNew').value, next2 = form.querySelector('#dqPwNew2').value;
      if (!cur) return fail(form, { data: { error: '지금 비밀번호를 입력해 주세요.', field: 'currentPassword' } });
      if (!PASSWORD_RE.test(next)) return fail(form, { data: { error: '새 비밀번호는 8~64자이고, 영문과 숫자를 모두 넣어 주세요.', field: 'newPassword' } });
      if (next !== next2) { form.querySelector('.dq-modal-error').textContent = '새 비밀번호 확인이 일치하지 않아요.'; form.querySelector('#dqPwNew2').focus(); return; }
      const btn = form.querySelector('button'); btn.disabled = true;
      const res = await api('/api/me/password', { method: 'PUT', body: { currentPassword: cur, newPassword: next } });
      btn.disabled = false;
      if (!res.ok) return fail(form, res, '바꾸지 못했어요. 잠시 후 다시 시도해 주세요.');
      form.reset();
      form.querySelector('.dq-modal-error').textContent = '';
      notice('비밀번호를 바꿨어요. 다른 기기의 로그인은 끊겼어요.');
    });
    sec('recovery').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget, password = form.querySelector('#dqRcPw').value;
      if (!password) return fail(form, { data: { error: '비밀번호를 입력해 주세요.', field: 'password' } });
      const btn = form.querySelector('button'); btn.disabled = true;
      const res = await api('/api/me/recovery-code', { method: 'POST', body: { password } });
      btn.disabled = false;
      if (!res.ok) return fail(form, res, '만들지 못했어요. 잠시 후 다시 시도해 주세요.');
      m.close();
      const { recoveryCode, ...rest } = res.data;
      setMe(rest);
      showRecoveryCode(recoveryCode, { username: rest.username, title: '새 복구 코드를 저장해 두세요' });
    });
    box.querySelector('[data-sec="delete"] form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget, err = form.querySelector('.dq-modal-error');
      const password = form.querySelector('#dqDelPw').value;
      if (!password) { err.textContent = '비밀번호를 입력해 주세요.'; form.querySelector('#dqDelPw').focus(); return; }
      if (form.querySelector('#dqDelOk').value.trim() !== '탈퇴합니다') { err.textContent = '"탈퇴합니다" 라고 정확히 입력해 주세요.'; form.querySelector('#dqDelOk').focus(); return; }
      const btn = form.querySelector('button'); btn.disabled = true;
      const res = await api('/api/me', { method: 'DELETE', body: { password } });
      btn.disabled = false;
      if (!res.ok) { err.textContent = (res.data && res.data.error) || '탈퇴하지 못했어요. 잠시 후 다시 시도해 주세요.'; form.querySelector('#dqDelPw').focus(); return; }
      sync.clearLocal();
      location.href = '/login/?bye=1';
    });
    if (section === 'delete') box.querySelector('[data-sec="delete"]').open = true;
  }
  /* 예전 이름 (허브의 "닉네임 정하기" 등에서 불러요) */
  function openNicknameDialog() { return openAccountDialog('nickname'); }

  async function logout() {
    await sync.beforeLogout();
    await api('/api/auth/logout', { method: 'POST' });
    location.href = '/login/';
  }

  /* 과목 상단 바. 페이지에 <header id="dqbar"></header> 를 두고 호출해요.
   * data-dq-slot="lead" / "actions" 가 붙은 자식은 해당 자리로 옮겨 줘요. */
  function mountBar(courseId) {
    const host = document.getElementById('dqbar');
    const course = (window.DEV_QUEST_COURSES || []).find((c) => c.id === courseId) || { name: courseId, icon: '', tagline: '', accent: '#58a6ff' };
    const slots = {};
    Array.from(host.querySelectorAll('[data-dq-slot]')).forEach((n) => { (slots[n.dataset.dqSlot] = slots[n.dataset.dqSlot] || []).push(n); });
    host.className = 'dqbar';
    host.style.setProperty('--dq-accent', course.accent);
    document.documentElement.style.setProperty('--dq-accent', course.accent);
    host.innerHTML = `
      <div class="dq-lead"></div>
      <a class="dq-home" href="../index.html" title="Dev Quest 홈" aria-label="Dev Quest 홈으로">⌂</a>
      <div class="dq-brand"><span class="dq-ico" style="color:${esc(course.accent)}">${course.iconPath ? icon(course.iconPath, 20) : esc(course.icon)}</span><span class="dq-name">${esc(course.name)}</span><small class="dq-tag">${esc(course.tagline)}</small></div>
      <div class="dq-actions"></div>
      <div class="dq-level">
        <span class="dq-tier"></span>
        <span class="dq-lv"></span>
        <div class="dq-xp"><i></i></div>
        <span class="dq-xptext"></span>
      </div>
      <div class="dq-account"></div>`;
    mountAccount(host.querySelector('.dq-account'));
    (slots.lead || []).forEach((n) => host.querySelector('.dq-lead').appendChild(n));
    (slots.actions || []).forEach((n) => host.querySelector('.dq-actions').appendChild(n));
    return {
      update(s) {
        const tier = host.querySelector('.dq-tier');
        tier.innerHTML = `<span class="dq-tdot" aria-hidden="true"></span><span class="dq-tn">${esc(s.tier.name)}</span>`;
        tier.style.color = s.tier.color;
        host.querySelector('.dq-lv').textContent = `Lv.${s.level.level}`;
        host.querySelector('.dq-xp i').style.width = `${Math.round((s.level.into / s.level.need) * 100)}%`;
        host.querySelector('.dq-xptext').textContent = `${s.level.into} / ${s.level.need} XP`;
        host.querySelector('.dq-level').title = `${s.done} / ${s.total} 퀘스트 완료 · 총 ${s.xp} XP (전체 ${s.maxXp} XP 중 ${Math.round(s.ratio * 100)}%)`;
      },
    };
  }

  /* ---------- 퀘스트 목록 (사이드바) 공용 마크업 ----------
   * 세 과목이 똑같은 모양의 분류/항목을 쓰도록 HTML 조각을 만들어 줘요. 스타일은 dq.css 의 .dq-cat / .dq-item.
   * item: { id, title, icon?, difficulty?, done?, locked?, active? } */
  function itemHtml(it) {
    const d = it.difficulty != null ? diffMeta(it.difficulty) : null;
    return `<button type="button" class="dq-item${it.done ? ' done' : ''}${it.active ? ' active' : ''}${it.locked ? ' locked' : ''}" data-id="${esc(it.id)}"${it.locked ? ' aria-disabled="true"' : ''}>`
      + `<span class="dq-i-ico">${icon(it.done ? 'checkCircle' : it.locked ? 'lock' : it.active ? 'play' : 'dot', 16)}</span><span class="dq-i-ti">${esc(it.title)}</span>`
      + (d ? `<span class="dq-i-lv ${d.cls}" title="난이도: ${d.label}">${d.stars}</span>` : '')
      + `<span class="sr-only dq-sr">${it.done ? '완료' : it.locked ? '잠김' : ''}</span></button>`;
  }
  /* cat: { id, icon, label, desc?, done, total }, bodyHtml: itemHtml 들을 이어 붙인 문자열 */
  function catHtml(cat, bodyHtml, open) {
    return `<details class="dq-cat" data-cat="${esc(cat.id)}"${open ? ' open' : ''}><summary><span class="dq-cat-no" aria-hidden="true"></span><span>${esc(cat.label)}</span><span class="dq-cat-count">${cat.done}/${cat.total}</span></summary>`
      + (cat.desc ? `<div class="dq-cat-desc">${esc(cat.desc)}</div>` : '') + bodyHtml + '</details>';
  }

  window.DevQuest = { DIFFICULTY, DIFF_KEYS, diffKey, diffMeta, levelInfo, needFor, TIERS, tierFor, stats, mountBar, esc, itemHtml, catHtml, api, mountAccount, logout, sync, afterSync, merge, notice, getMe, openNicknameDialog, openAccountDialog, showRecoveryCode, openModal,
    icon, decorateIcons, armNext, disarmNext, nextButton };
  // 정적 HTML 의 <span data-icon="…"> 채우기 (스크립트는 body 끝에서 불러서 요소가 이미 있어요)
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => decorateIcons()); else decorateIcons();
  }
})();
