/* 허브(메인) 화면: 이어하기 · 내 상태 · 과목 · 랭킹 */
(function () {
  'use strict';
  const DQ = window.DevQuest;
  const courses = window.DEV_QUEST_COURSES;
  const esc = DQ.esc;
  const ITEMS_KEY = 'devQuest:items:v2'; // 과목별 퀘스트 목록 캐시 [id, 난이도, 제목] — 다음 방문 때 먼저 보여 주려고
  const items = readJson(ITEMS_KEY, {});
  let serverMode = false;

  function readJson(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
  }
  // 퀘스트 목록은 카탈로그(shared/quests.json, 약 20KB) 하나로 받아요. 과목 데이터 파일(모두 수백 KB)은 과목 화면에서만 읽어요.
  async function loadCatalog() {
    try {
      const res = await fetch('shared/quests.json', { credentials: 'same-origin' });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }
  const savedOf = (c) => readJson(c.storageKey, null);
  function doneIdsOf(c) {
    const saved = savedOf(c);
    try { return saved ? c.doneIds(saved) : []; } catch (e) { return []; }
  }
  const listOf = (c) => (items[c.id] || []).map((x) => ({ id: x[0], difficulty: x[1], title: x[2] || x[0] }));
  const iconSvg = (c, size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${esc(c.iconPath || '')}"/></svg>`;
  const arrow = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14 M13 6l6 6-6 6"/></svg>';

  /* ---------- 이어할 퀘스트 고르기 ----------
   * 1) 가장 최근에 진행도를 저장한 과목부터 2) 그 과목에서 마지막으로 연 퀘스트, 이미 끝냈으면 그다음 안 끝낸 퀘스트
   * 아직 기록이 없으면 첫 과목의 첫 퀘스트를 추천해요. */
  function nextQuestIn(c) {
    const list = listOf(c);
    if (!list.length) return null;
    const done = new Set(doneIdsOf(c));
    let last = null;
    try { const saved = savedOf(c); last = saved && c.lastId ? c.lastId(saved, list) : null; } catch (e) { last = null; }
    const at = list.findIndex((q) => q.id === last);
    if (at >= 0 && !done.has(last)) return list[at];
    return list.slice(at + 1).find((q) => !done.has(q.id)) || list.find((q) => !done.has(q.id)) || null;
  }
  function pickContinue() {
    const act = DQ.sync.activity();
    const started = courses.filter((c) => act[c.id] || doneIdsOf(c).length || savedOf(c));
    started.sort((a, b) => (act[b.id] || 0) - (act[a.id] || 0));
    for (const c of started) { const q = nextQuestIn(c); if (q) return { mode: 'continue', course: c, quest: q }; }
    for (const c of courses) { const q = nextQuestIn(c); if (q) return { mode: started.length ? 'continue' : 'start', course: c, quest: q }; }
    return courses.every((c) => items[c.id]) ? { mode: 'done' } : null;
  }

  function renderHero(statsById) {
    const el = document.getElementById('hero');
    const pick = pickContinue();
    if (!pick) { el.innerHTML = '<p class="eyebrow">이어서 할 퀘스트</p><p class="hero-title skeleton">퀘스트를 불러오는 중…</p>'; return; }
    if (pick.mode === 'done') {
      const total = courses.reduce((n, c) => n + items[c.id].length, 0);
      el.innerHTML = `<p class="eyebrow">모든 퀘스트 완료</p><h2 class="hero-title">${total}개 퀘스트를 모두 끝냈어요</h2>
        <p class="hero-meta">어느 과목이든 들어가서 복습할 수 있어요.</p>
        <div class="hero-actions"><a class="btn btn-ghost" href="#courses">과목 고르기</a></div>`;
      return;
    }
    const { course: c, quest: q } = pick;
    const s = statsById[c.id];
    const d = DQ.diffMeta(q.difficulty);
    const pct = s ? Math.round(s.ratio * 100) : 0;
    el.style.setProperty('--fill', c.accent);
    el.innerHTML = `
      <p class="eyebrow">${pick.mode === 'start' ? '첫 퀘스트 추천' : '이어서 할 퀘스트'}</p>
      <div class="hero-course"><span class="ico" style="--c:${esc(c.accent)}">${iconSvg(c, 22)}</span><span>${esc(c.name)}</span></div>
      <h2 class="hero-title">${esc(q.title)}</h2>
      <p class="hero-meta"><span class="${d.cls}" style="font-weight:700">${d.label}</span><span class="mono">+${d.xp} XP</span>${s ? `<span>이 과목 ${s.done} / ${s.total} 완료</span>` : ''}</p>
      <div class="bar thin" role="progressbar" aria-label="${esc(c.name)} 진행률" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
      <div class="hero-actions">
        <a class="btn btn-primary" href="${esc(c.path)}index.html#${encodeURIComponent(q.id)}">${pick.mode === 'start' ? '시작하기' : '이어하기'} ${arrow}</a>
        <a class="btn btn-ghost" href="#courses">다른 과목 고르기</a>
      </div>`;
  }

  function renderStatus(all, known) {
    const el = document.getElementById('statusMain');
    const pill = document.getElementById('statusPill');
    document.getElementById('status').style.setProperty('--tier', all.tier.color);
    pill.style.setProperty('--tier', all.tier.color);
    pill.innerHTML = `<span class="dot" aria-hidden="true"></span><b>${esc(all.tier.name)}</b><span class="mono">Lv.${all.level.level} · ${all.xp.toLocaleString()} XP</span>`;
    let next = '<p class="next-line"><span>최고 티어에 도달했어요</span></p><div class="bar"><i style="width:100%;--fill:var(--tier);background:var(--tier)"></i></div>';
    if (all.nextTier && known) {
      const from = all.tier.min * all.maxXp, to = all.nextTier.min * all.maxXp;
      const pct = Math.max(0, Math.min(100, Math.round(((all.xp - from) / Math.max(1, to - from)) * 100)));
      next = `<div><p class="next-line" style="margin:0 0 8px"><span>${esc(all.nextTier.name)}까지</span><span class="mono">${all.toNext.toLocaleString()} XP</span></p>
        <div class="bar" role="progressbar" aria-label="${esc(all.nextTier.name)}까지 진행률" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%;background:var(--tier)"></i></div></div>`;
    }
    el.innerHTML = `
      <h2 id="statusTitle">내 상태</h2>
      <div class="tier-line"><span class="tier-name">${esc(all.tier.name)}</span><span class="mono">Lv.${all.level.level}</span></div>
      ${next}
      <dl class="stats">
        <div><dt>총 XP</dt><dd>${all.xp.toLocaleString()}</dd></div>
        <div><dt>완료</dt><dd>${all.done}<small> / ${all.total}</small></dd></div>
      </dl>`;
  }

  function renderCourses(statsById) {
    const total = courses.reduce((n, c) => n + (items[c.id] ? items[c.id].length : 0), 0);
    document.getElementById('coursesMeta').textContent = `${courses.length}과목` + (total ? ` · 퀘스트 ${total}개` : '');
    document.getElementById('courseGrid').innerHTML = courses.map((c) => {
      const s = statsById[c.id];
      const pct = s ? Math.round(s.ratio * 100) : 0;
      return `<a class="tile" href="${esc(c.path)}index.html" style="--c:${esc(c.accent)}" aria-label="${esc(c.name)} — ${s ? `${s.done}/${s.total} 완료` : '불러오는 중'}">
        <div class="tile-head"><span class="ico">${iconSvg(c, 22)}</span><span class="tile-name">${esc(c.short || c.name)}</span></div>
        <div class="tile-nums"><span class="tile-pct">${s ? pct + '%' : '–'}</span><span class="tile-cnt">${s ? `${s.done} / ${s.total}` : ''}</span></div>
        <div class="bar thin" aria-hidden="true"><i style="width:${pct}%;background:${esc(c.accent)}"></i></div>
      </a>`;
    }).join('');
  }

  function renderRules() {
    document.getElementById('rules').innerHTML = `
      <h2 id="rulesTitle">점수는 이렇게 쌓여요</h2>
      <p>퀘스트를 깨면 난이도만큼 XP를 얻어요.</p>
      <div>${DQ.DIFF_KEYS.map((k) => `<div class="xp-row"><span>${DQ.DIFFICULTY[k].label}</span><span class="mono">${DQ.DIFFICULTY[k].xp} XP</span></div>`).join('')}</div>
      <p class="tiers">티어는 전체 XP 중 얻은 비율이에요. ${DQ.TIERS.slice(1).map((t) => `${esc(t.name)} ${Math.round(t.min * 100)}%`).join(' · ')}</p>`;
  }

  function render() {
    const known = courses.every((c) => items[c.id]);
    const statsById = {};
    const allItems = [], allDone = [];
    courses.forEach((c) => {
      if (!items[c.id]) return;
      const list = items[c.id].map((x) => ({ id: x[0], difficulty: x[1] }));
      const done = doneIdsOf(c);
      statsById[c.id] = DQ.stats(list, done);
      list.forEach((x) => allItems.push({ id: c.id + ':' + x.id, difficulty: x.difficulty })); // 과목 id 접두사로 id 충돌 방지
      done.forEach((id) => allDone.push(c.id + ':' + id));
    });
    renderHero(statsById);
    renderStatus(DQ.stats(allItems, allDone), known);
    renderCourses(statsById);
  }

  /* ---------- 연속 학습일 · 이번 주 (백엔드로 열었을 때만) ---------- */
  const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
  async function renderActivity() {
    const el = document.getElementById('activity');
    const r = await DQ.api('/api/me/activity');
    if (!r.ok || !r.data) return;
    const a = r.data;
    const level = (n) => (n >= 4 ? 3 : n >= 2 ? 2 : n >= 1 ? 1 : 0);
    const cells = a.week.days.map((d) => {
      const date = new Date(d.date + 'T00:00:00');
      const name = DAY_NAMES[date.getDay()];
      const label = `${date.getMonth() + 1}월 ${date.getDate()}일 (${name}) · ${d.done ? `${d.done}개 완료 · +${d.xp} XP` : '기록 없음'}`;
      const cls = [`lv${level(d.done)}`, d.date === a.today ? 'today' : '', d.date > a.today ? 'future' : ''].filter(Boolean).join(' ');
      return `<li class="${cls}" title="${esc(label)}"><span class="cell" role="img" aria-label="${esc(label)}"></span><span aria-hidden="true">${name}</span></li>`;
    }).join('');
    let tip;
    if (a.activeToday) tip = '오늘도 해냈어요. 내일도 이어 가요!';
    else if (a.streak > 0) tip = `오늘 하나 깨면 <b>${a.streak + 1}일 연속</b>!`;
    else tip = '오늘 퀘스트를 하나 깨면 연속 학습이 시작돼요.';
    el.innerHTML = `
      <div class="act-head">
        <span class="flame${a.activeToday ? ' on' : ''}">${DQ.icon('flame', 18)}</span>
        <div><b>${a.streak}일</b> 연속 학습${a.bestStreak > a.streak ? `<small>최고 ${a.bestStreak}일</small>` : ''}</div>
      </div>
      <p class="act-tip">${tip}</p>
      <ol class="week" aria-label="이번 주 기록 (월~일)">${cells}</ol>
      <p class="week-sum">이번 주 <b>+${a.week.xp.toLocaleString()} XP</b> · ${a.week.done}개 완료</p>`;
    el.hidden = false;
  }

  /* ---------- 랭킹 미니 (상위 5명 + 나) ---------- */
  function posHtml(rank) {
    return `<span class="pos${rank <= 3 ? ' pos-' + rank : ''}" aria-label="${rank}위">${rank}</span>`;
  }
  /* 기간: all(누적) · week(이번 주, 월요일 0시부터 새로 끝낸 퀘스트) */
  const PERIOD_KEY = 'devQuest:rankingPeriod';
  let rankingPeriod = 'all';
  try { if (localStorage.getItem(PERIOD_KEY) === 'week') rankingPeriod = 'week'; } catch (e) { /* 무시 */ }
  const PERIODS = [{ id: 'all', label: '누적' }, { id: 'week', label: '이번 주' }];
  function paintSegs() {
    document.querySelectorAll('[data-seg]').forEach((g) => {
      if (!g.children.length) g.innerHTML = PERIODS.map((x) => `<button type="button" data-period="${x.id}">${x.label}</button>`).join('');
      g.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === rankingPeriod)));
    });
  }
  function setPeriod(p) {
    if (p === rankingPeriod) return;
    rankingPeriod = p;
    try { localStorage.setItem(PERIOD_KEY, p); } catch (e) { /* 무시 */ }
    paintSegs();
    renderRankMini();
    if (rankingReady) loadRanking();
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-seg] button[data-period]');
    if (b) setPeriod(b.dataset.period);
  });
  const EMPTY = {
    all: '아직 랭킹에 오른 사람이 없어요. 첫 퀘스트를 깨면 1등이에요!',
    week: '이번 주에 퀘스트를 깬 사람이 아직 없어요. 지금 깨면 이번 주 1등이에요!'
  };
  /* 랭킹 확인 중(review)·숨김(hidden)이면 본인에게 이유를 알려 줘요 */
  const EXCLUDED = {
    review: '퀘스트를 아주 빠르게 끝낸 기록이 있어서 확인하는 동안 랭킹에서 잠시 빠져 있어요. 진행도는 그대로 저장되고, 확인이 끝나면 다시 보여요.',
    hidden: '운영 정책에 따라 랭킹에서 빠져 있어요. 진행도는 그대로 저장돼요.'
  };
  const excludedHtml = (data) => EXCLUDED[data.myStatus] ? `<p class="rk-excluded" role="note">${EXCLUDED[data.myStatus]}</p>` : '';
  function weekLabel(data) {
    if (!data.weekStart) return '';
    const [, m, d] = data.weekStart.split('-').map(Number);
    return `${m}월 ${d}일(월)부터`;
  }

  let miniSeq = 0;
  async function renderRankMini() {
    const el = document.getElementById('rankMini');
    el.hidden = false;
    const period = rankingPeriod, seq = ++miniSeq;
    const [r, me] = await Promise.all([DQ.api('/api/ranking?course=all&period=' + period + '&limit=5'), DQ.getMe()]);
    if (seq !== miniSeq) return; // 그 사이 기간을 바꿨어요
    if (!r.ok) { el.innerHTML = `<h2 id="rankMiniTitle">랭킹</h2><p class="empty">${esc((r.data && r.data.error) || '랭킹을 불러오지 못했어요.')}</p>`; return; }
    const data = r.data;
    const row = (e) => `<li${e.me ? ' class="me"' : ''}>${posHtml(e.rank)}<span class="who">${esc(e.nickname)}${e.me ? '<span class="me-badge">나</span>' : ''}</span><span class="xp">${e.xp.toLocaleString()} XP</span></li>`;
    let list;
    if (!data.entries.length) list = `<p class="empty">${EMPTY[period]}</p>`;
    else {
      // 내가 상위 5명 안이면 그 줄을 강조하고, 밖이면 맨 아래에 내 줄을 따로 붙여요
      const meListed = data.entries.some((e) => e.me);
      list = '<ol class="mini-list">' + data.entries.map(row).join('')
        + (data.me && !meListed ? row(data.me) : '') + '</ol>';
    }
    const nudge = me.ok && me.data && me.data.defaultNickname
      ? `<p class="nudge">랭킹에는 닉네임이 보여요. 지금은 기본 닉네임 <b>${esc(me.data.nickname)}</b> 이에요. <button type="button" class="linkbtn" id="nickBtn">닉네임 정하기</button></p>` : '';
    const sub = period === 'week' ? `이번 주 ${data.players.toLocaleString()}명` : `전체 ${data.players.toLocaleString()}명`;
    el.innerHTML = `<div class="sec-head" style="margin:0"><h2 id="rankMiniTitle">랭킹 <small>· ${sub}</small></h2>
        <div class="seg" data-seg role="group" aria-label="랭킹 기간"></div>
        <button type="button" class="linkbtn" id="openRanking" aria-controls="ranking" aria-expanded="${!document.getElementById('ranking').hidden}">전체 랭킹 보기 →</button></div>
      ${list}${excludedHtml(data)}${nudge}`;
    paintSegs();
    el.querySelector('#openRanking').addEventListener('click', toggleRanking);
    const nb = el.querySelector('#nickBtn');
    if (nb) nb.addEventListener('click', () => DQ.openNicknameDialog());
  }

  /* ---------- 전체 랭킹 (탭 + 표, 펼쳐 보기) ---------- */
  const TAB_KEY = 'devQuest:rankingTab';
  const rankingCache = {};
  let rankingTab = 'all', rankingReady = false;
  const rankingTabs = () => [{ id: 'all', label: '전체' }].concat(courses.map((c) => ({ id: c.id, label: c.short || c.name })));
  function toggleRanking() {
    const sec = document.getElementById('ranking');
    sec.hidden = !sec.hidden;
    const btn = document.getElementById('openRanking');
    if (btn) { btn.setAttribute('aria-expanded', String(!sec.hidden)); btn.textContent = sec.hidden ? '전체 랭킹 보기 →' : '전체 랭킹 접기'; }
    if (sec.hidden) return;
    if (!rankingReady) initRanking();
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function initRanking() {
    rankingReady = true;
    paintSegs();
    try { const t = localStorage.getItem(TAB_KEY); if (t && rankingTabs().some((x) => x.id === t)) rankingTab = t; } catch (e) { /* 무시 */ }
    const tabs = document.getElementById('rankingTabs');
    tabs.innerHTML = rankingTabs().map((t) => `<button type="button" role="tab" data-tab="${esc(t.id)}">${esc(t.label)}</button>`).join('');
    tabs.addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) selectTab(b.dataset.tab); });
    tabs.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const ids = rankingTabs().map((t) => t.id);
      const next = ids[(ids.indexOf(rankingTab) + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
      selectTab(next);
      tabs.querySelector(`[data-tab="${next}"]`).focus();
    });
    selectTab(rankingTab);
  }
  function selectTab(id) {
    rankingTab = id;
    try { localStorage.setItem(TAB_KEY, id); } catch (e) { /* 무시 */ }
    document.querySelectorAll('#rankingTabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
    loadRanking();
  }
  async function loadRanking() {
    const id = rankingTab, period = rankingPeriod, key = period + ':' + id;
    const current = () => rankingTab === id && rankingPeriod === period;
    const body = document.getElementById('rankingBody');
    if (!rankingCache[key]) {
      body.innerHTML = '<p class="empty">랭킹을 불러오는 중…</p>';
      const r = await DQ.api('/api/ranking?course=' + encodeURIComponent(id) + '&period=' + period + '&limit=50');
      if (!r.ok) { if (current()) body.innerHTML = `<p class="empty">${esc((r.data && r.data.error) || '랭킹을 불러오지 못했어요.')}</p>`; return; }
      rankingCache[key] = r.data;
    }
    if (current()) renderRanking(rankingCache[key]);
  }
  function rowHtml(e, data) {
    if (data.period === 'week') {
      return `<tr${e.me ? ' class="me"' : ''}><td class="rank">${posHtml(e.rank)}</td>`
        + `<td class="who">${esc(e.nickname)}${e.me ? '<span class="me-badge">나</span>' : ''}</td>`
        + `<td class="num">+${e.xp.toLocaleString()}</td>`
        + `<td class="num">${e.done}개</td></tr>`;
    }
    const t = DQ.tierFor(data.maxXp ? e.xp / data.maxXp : 0).tier;
    return `<tr${e.me ? ' class="me"' : ''}><td class="rank">${posHtml(e.rank)}</td>`
      + `<td class="who">${esc(e.nickname)}${e.me ? '<span class="me-badge">나</span>' : ''}</td>`
      + `<td class="tier" style="color:${t.color}">${esc(t.name)}</td>`
      + `<td class="num lv">Lv.${DQ.levelInfo(e.xp).level}</td>`
      + `<td class="num">${e.xp.toLocaleString()} XP</td>`
      + `<td class="num done">${e.done} / ${data.totalQuests}</td></tr>`;
  }
  function renderRanking(data) {
    const body = document.getElementById('rankingBody');
    const week = data.period === 'week';
    document.getElementById('rankingNote').textContent = week
      ? `이번 주 ${weekLabel(data)} 새로 끝낸 퀘스트의 XP 예요 (한국 시간). XP 가 같으면 먼저 도달한 사람이 위예요`
      : 'XP 가 같으면 먼저 도달한 사람이 위예요';
    if (!data.entries.length) { body.innerHTML = `<p class="empty">${EMPTY[week ? 'week' : 'all']}</p>` + excludedHtml(data); return; }
    const cols = week ? 4 : 6;
    let rows = data.entries.map((e) => rowHtml(e, data)).join('');
    if (data.me && !data.entries.some((e) => e.me)) rows += `<tr class="gap"><td colspan="${cols}">⋯</td></tr>` + rowHtml(data.me, data);
    const head = week
      ? '<th>순위</th><th>닉네임</th><th class="num">XP</th><th class="num">완료</th>'
      : '<th>순위</th><th>닉네임</th><th>티어</th><th class="num lv">레벨</th><th class="num">XP</th><th class="num done">완료</th>';
    const mine = EXCLUDED[data.myStatus] ? '내 기록은 지금 랭킹에서 빠져 있어요'
      : data.me ? `내 순위 <b>${data.me.rank}위</b>`
      : (week ? '이번 주엔 아직 내 순위가 없어요 — 퀘스트를 깨면 올라가요' : '아직 내 순위가 없어요 — 퀘스트를 깨면 올라가요');
    body.innerHTML = `<div class="rk-list"><table class="rk-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`
      + `<p class="rk-foot">${week ? '이번 주 ' : ''}${data.players.toLocaleString()}명 참여 · ${mine}</p>` + excludedHtml(data);
  }

  /* ---------- 시작 ---------- */
  renderRules();
  render(); // 처음엔 이 브라우저의 기록과 캐시로 먼저 그려요
  DQ.sync.ready().then((mode) => {
    serverMode = mode === 'server';
    render();
    DQ.mountAccount(document.getElementById('account'));
    if (serverMode) {
      renderRankMini();
      renderActivity();
      // 닉네임을 바꾸면 랭킹을 새로 받아요
      window.addEventListener('dq:me', () => {
        Object.keys(rankingCache).forEach((k) => delete rankingCache[k]);
        renderRankMini();
        if (!document.getElementById('ranking').hidden) loadRanking();
      });
    }
  });
  loadCatalog().then((catalog) => {
    if (!catalog || !catalog.courses) return;
    courses.forEach((c) => {
      const q = catalog.courses[c.id];
      if (q) items[c.id] = Object.keys(q.quests).map((id) => [id, q.quests[id], (q.titles && q.titles[id]) || '']);
    });
    try { localStorage.setItem(ITEMS_KEY, JSON.stringify(items)); } catch (e) { /* 무시 */ }
    render();
  });
})();
