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
    let res;
    try {
      res = await fetch(path, { method, headers, credentials: 'same-origin', body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
    } catch (e) {
      return { ok: false, status: 0, data: { error: '서버에 연결하지 못했어요. 네트워크를 확인해 주세요.' } };
    }
    let data = null;
    if ((res.headers.get('Content-Type') || '').includes('json')) { try { data = await res.json(); } catch (e) { data = null; } }
    return { ok: res.ok, status: res.status, data };
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
      courses().forEach((c) => writeLocal(c, null));
      try { localStorage.removeItem(ACTIVITY_KEY); } catch (e) { /* 무시 */ }
      // 다음 로그인 때 "로그인 전 기록"으로 오해하지 않게, 기록이 비어 있다는 표시만 남겨요
      try { localStorage.setItem(META_KEY, JSON.stringify({ user: null, courses: {} })); } catch (e) { /* 무시 */ }
    }

    return { ready, changed, beforeLogout, setStatus, activity, mode: () => mode, merge };
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
    document.querySelectorAll('.dq-account .dq-user').forEach((el) => { el.title = `닉네임 바꾸기 (로그인 아이디: ${data.username})`; });
    window.dispatchEvent(new CustomEvent('dq:me', { detail: data })); // 허브 랭킹 등이 다시 그려요
  }

  /* 로그인한 사람(닉네임)과 로그아웃 버튼. 닉네임을 누르면 바꿀 수 있어요.
   * 백엔드 없이 파일·serve.js 로 열면(/api/me 가 없으면) 아무것도 안 보여요 */
  async function mountAccount(host) {
    if (!host || location.protocol === 'file:') return;
    host.classList.add('dq-account');
    const r = await getMe();
    if (!r.ok || !r.data || !r.data.username) return;
    host.innerHTML = '<span class="dq-sync" aria-live="polite"></span>'
      + `<button type="button" class="dq-user" title="닉네임 바꾸기 (로그인 아이디: ${esc(r.data.username)})"><span class="dq-avatar" aria-hidden="true">${esc(Array.from(r.data.nickname)[0] || '?')}</span><span class="dq-uname">${esc(r.data.nickname)}</span></button>`
      + '<button type="button" class="dq-logout">로그아웃</button>';
    host.querySelector('.dq-user').addEventListener('click', () => openNicknameDialog());
    host.querySelector('.dq-logout').addEventListener('click', logout);
    if (sync.mode() === 'server') sync.setStatus('saved');
  }

  /* 닉네임 바꾸기 창. 저장하면 화면의 닉네임을 모두 바꾸고 'dq:me' 이벤트를 보내요 */
  const NICKNAME_RE = /^[가-힣A-Za-z0-9_]{2,12}$/;
  async function openNicknameDialog() {
    const r = await getMe();
    if (!r.ok || !r.data) return;
    const opener = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'dq-modal';
    wrap.innerHTML = `
      <form class="dq-modal-box" role="dialog" aria-modal="true" aria-labelledby="dqNickTitle" novalidate>
        <h2 id="dqNickTitle">닉네임 바꾸기</h2>
        <p class="dq-modal-sub">랭킹에는 로그인 아이디 대신 닉네임이 보여요.</p>
        <label for="dqNick">닉네임</label>
        <input id="dqNick" type="text" maxlength="12" autocomplete="nickname" spellcheck="false" value="${esc(r.data.defaultNickname ? '' : r.data.nickname)}" placeholder="${esc(r.data.nickname)}" />
        <p class="dq-modal-hint">한글·영문·숫자·_ 2~12자 · 다른 사람과 겹치지 않게</p>
        <p class="dq-modal-error" role="alert"></p>
        <div class="dq-modal-actions">
          <button type="button" class="dq-btn-ghost" data-close>취소</button>
          <button type="submit" class="dq-btn">저장</button>
        </div>
      </form>`;
    document.body.appendChild(wrap);
    const input = wrap.querySelector('#dqNick');
    const error = wrap.querySelector('.dq-modal-error');
    const submit = wrap.querySelector('button[type="submit"]');
    input.focus();
    function close() {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      if (opener && opener.focus) opener.focus();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.hasAttribute('data-close')) close(); });
    wrap.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nickname = input.value.trim();
      if (!NICKNAME_RE.test(nickname)) { error.textContent = '닉네임은 한글·영문·숫자·_ 2~12자예요.'; input.focus(); return; }
      submit.disabled = true;
      const res = await api('/api/me/nickname', { method: 'PUT', body: { nickname } });
      submit.disabled = false;
      if (!res.ok) { error.textContent = (res.data && res.data.error) || '저장하지 못했어요. 잠시 후 다시 시도해 주세요.'; input.focus(); return; }
      setMe(res.data);
      close();
      notice(`닉네임을 "${res.data.nickname}"(으)로 바꿨어요.`);
    });
  }
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
      <div class="dq-brand"><span class="dq-ico">${esc(course.icon)}</span><span class="dq-name">${esc(course.name)}</span><small class="dq-tag">${esc(course.tagline)}</small></div>
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
        tier.innerHTML = `${s.tier.icon}<span class="dq-tn"> ${esc(s.tier.name)}</span>`;
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
      + `<span class="dq-i-ico">${it.icon || (it.locked ? '🔒' : '▶')}</span><span class="dq-i-ti">${esc(it.title)}</span>`
      + (d ? `<span class="dq-i-lv ${d.cls}" title="난이도: ${d.label}">${d.stars}</span>` : '')
      + `<span class="dq-i-ck">${it.done ? '✓' : ''}</span></button>`;
  }
  /* cat: { id, icon, label, desc?, done, total }, bodyHtml: itemHtml 들을 이어 붙인 문자열 */
  function catHtml(cat, bodyHtml, open) {
    return `<details class="dq-cat" data-cat="${esc(cat.id)}"${open ? ' open' : ''}><summary><span>${esc(cat.icon)}</span><span>${esc(cat.label)}</span><span class="dq-cat-count">${cat.done}/${cat.total}</span></summary>`
      + (cat.desc ? `<div class="dq-cat-desc">${esc(cat.desc)}</div>` : '') + bodyHtml + '</details>';
  }

  window.DevQuest = { DIFFICULTY, DIFF_KEYS, diffKey, diffMeta, levelInfo, needFor, TIERS, tierFor, stats, mountBar, esc, itemHtml, catHtml, api, mountAccount, logout, sync, afterSync, merge, notice, getMe, openNicknameDialog };
})();
