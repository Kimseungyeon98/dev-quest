/* Git Playbook 앱: 시나리오 선택, 터미널, 시각화, 진행도 */
(function () {
  'use strict';
  const GP = globalThis.GP, UI = globalThis.GPUI, G = globalThis.GitEngine, U = G.util;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const STORE_KEY = 'gitplaybook:v1';

  /* ---------- 저장소(localStorage) ---------- */
  let store = { done: {}, seen: false };
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) store = Object.assign(store, JSON.parse(raw)); } catch (e) { /* 무시 */ }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* 무시 */ } };

  /* ---------- 상태 ---------- */
  let lab = null, sc = null;
  let busy = false;
  let hintShown = 0;
  let goalOk = [];
  let solved = false;
  let showLost = false;
  let freshSet = new Set();
  let cmdHistory = [], histPos = -1, draft = '';
  let termHtml = '';
  let visTab = 'graph';
  let mpane = 'story';

  const SANDBOX = {
    id: 'sandbox', cat: 'sandbox', level: 0, icon: '🧪', title: '자유 연습장', tags: [], hints: [],
    story: '마음껏 명령어를 실험해 보세요! 샘플 주문 관리 시스템 저장소(커밋 8개)와 원격 저장소(origin), 팀원 minji · jun 이 준비되어 있어요.\n\n> "망가뜨려도 괜찮아. 오른쪽 **원격** 탭에서 팀원이 push 하게 만들어 pull / 충돌도 연습해 보자. 마음에 안 들면 [처음부터] 버튼!"',
    why: '', goals: [], solution: { cmds: [], explain: '' },
  };

  /* ---------- 유틸 ---------- */
  const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
  function toast(msg, ms) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms || 2200);
  }
  function scrollTerm() { const o = $('#termOut'); o.scrollTop = o.scrollHeight; }

  /* ---------- 모달 ---------- */
  let modalResolve = null;
  function openModal(title, bodyHtml, buttons, onClose) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHtml;
    const foot = $('#modalFoot'); foot.innerHTML = '';
    buttons.forEach((b) => {
      const el = document.createElement('button');
      el.className = 'btn' + (b.primary ? ' btn-primary' : '');
      el.textContent = b.label;
      el.addEventListener('click', () => b.onClick && b.onClick());
      foot.appendChild(el);
    });
    $('#modal').hidden = false;
    modalResolve = onClose || null;
    return $('#modalBody');
  }
  function closeModal(cancelled) {
    $('#modal').hidden = true;
    const r = modalResolve; modalResolve = null;
    if (r && cancelled) r();
  }
  $('#modalX').addEventListener('click', () => closeModal(true));
  $('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(true); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(true); });

  /* git 이 요구하는 입력(편집기/파일/프롬프트)을 모달로 받는다 */
  const EDITOR_INFO = {
    COMMIT_EDITMSG: ['커밋 메시지 입력', '첫 줄이 제목이에요. # 로 시작하는 줄은 무시돼요. 내용을 비우고 저장하면 커밋이 취소됩니다.'],
    MERGE_MSG: ['병합 커밋 메시지', '# 로 시작하는 줄은 무시돼요.'],
    TAG_EDITMSG: ['태그 메시지 입력', '# 로 시작하는 줄은 무시돼요.'],
    'git-rebase-todo': ['rebase 작업 목록 (git-rebase-todo)', '위에서 아래로 실행돼요. 맨 앞 단어를 바꿔 보세요: pick(유지) · reword(메시지 수정) · edit(멈춤) · squash(앞과 합치고 메시지 합침) · fixup(앞에 합치고 이 메시지는 버림) · drop(삭제). 줄 순서를 바꾸면 커밋 순서도 바뀌어요. 전부 지우면 rebase 가 취소돼요.'],
  };
  function ask(kind, payload) {
    return new Promise((resolve) => {
      if (kind === 'editor') {
        const info = EDITOR_INFO[payload.kind] || ['편집기', ''];
        const body = openModal(info[0], `<p class="note">${UI.esc(info[1])}</p><textarea id="edTa" spellcheck="false"></textarea>`, [
          { label: '취소 (중단)', onClick: () => { closeModal(false); resolve(null); } },
          { label: '저장하고 닫기', primary: true, onClick: () => { const v = $('#edTa').value; closeModal(false); resolve(v); } },
        ], () => resolve(null));
        const ta = $('#edTa', body); ta.value = payload.initial || ''; setTimeout(() => ta.focus(), 30);
        if (payload.kind === 'COMMIT_EDITMSG') { ta.setSelectionRange(0, 0); }
      } else if (kind === 'file') {
        const body = openModal(`편집: ${payload.path}`, `<p class="note">${payload.isNew ? '새 파일이에요.' : ''} 내용을 수정하고 저장하세요. (실제 nano / vim 대신 간단한 편집창이에요)</p><textarea id="edTa" spellcheck="false"></textarea>`, [
          { label: '취소', onClick: () => { closeModal(false); resolve(null); } },
          { label: '저장', primary: true, onClick: () => { const v = $('#edTa').value; closeModal(false); resolve(v); } },
        ], () => resolve(null));
        const ta = $('#edTa', body); ta.value = payload.content || ''; setTimeout(() => ta.focus(), 30);
      } else if (kind === 'prompt') {
        const body = openModal('git 이 물어보고 있어요', `<pre id="pmText"></pre><p class="note">y(예) · n(아니오) · q(그만) · a(이후 전부) · d(이후 안 함) · s(더 잘게 나누기)</p><input id="pmIn" type="text" autocomplete="off" autocapitalize="off">`, [
          ...['y', 'n', 'q', 'a', 'd', 's'].map((k) => ({ label: k, onClick: () => { closeModal(false); resolve(k); } })),
        ], () => resolve(null));
        $('#pmText', body).innerHTML = UI.ansiToHtml((payload.since || '') + payload.text);
        const inp = $('#pmIn', body);
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const v = inp.value.trim() || 'y'; closeModal(false); resolve(v); } });
        setTimeout(() => inp.focus(), 30);
      } else resolve(null);
    });
  }

  /* ---------- 진행도 ---------- */
  function doneCount() { return GP.scenarios.filter((s) => store.done[s.id]).length; }
  function renderTop() {
    const n = doneCount(), total = GP.scenarios.length;
    $('#topProgress').innerHTML = `<span>${n}/${total}<span class="hide-s"> 완료</span></span><div class="pbar"><i style="width:${Math.round((n / total) * 100)}%"></i></div>`;
  }

  /* ---------- 사이드바 ---------- */
  function scItemHtml(s) {
    const done = !!store.done[s.id];
    return `<button class="sc-item${done ? ' done' : ''}${sc && sc.id === s.id ? ' active' : ''}" data-id="${s.id}"><span class="ico">${s.icon}</span><span class="ti">${UI.esc(s.title)}</span><span class="lv" title="난이도">${'★'.repeat(s.level)}</span><span class="ck">${done ? '✓' : ''}</span></button>`;
  }
  function renderSidebar() {
    const open = JSON.parse(sessionStorage.getItem('gp:open') || 'null');
    $('#scenarioList').innerHTML = GP.categories.map((c, i) => {
      const list = GP.scenarios.filter((s) => s.cat === c.id);
      const done = list.filter((s) => store.done[s.id]).length;
      const isOpen = open ? open.includes(c.id) : (i < 2 || (sc && sc.cat === c.id));
      return `<details class="cat" data-cat="${c.id}" ${isOpen ? 'open' : ''}><summary><span>${c.icon}</span><span>${c.name}</span><span class="cat-count">${done}/${list.length}</span></summary><div class="cat-desc">${UI.esc(c.desc)}</div>${list.map(scItemHtml).join('')}</details>`;
    }).join('');
  }
  $('#scenarioList').addEventListener('toggle', () => {
    sessionStorage.setItem('gp:open', JSON.stringify($$('#scenarioList details[open]').map((d) => d.dataset.cat)));
  }, true);
  document.addEventListener('click', (e) => {
    const it = e.target.closest('.sc-item');
    if (it && it.dataset.id) { loadScenario(it.dataset.id); closeSidebar(); $('#sosResults').hidden = true; }
  });

  function openSidebar() { $('#sidebar').classList.add('open'); $('#scrim').hidden = false; }
  function closeSidebar() { $('#sidebar').classList.remove('open'); $('#scrim').hidden = true; }
  $('#btnMenu').addEventListener('click', openSidebar);
  $('#scrim').addEventListener('click', closeSidebar);

  /* ---------- SOS 검색 ---------- */
  const SYN = {
    거절: ['rejected', 'non-fast-forward', 'push'], 충돌: ['conflict'], 되돌: ['undo', 'reset', 'revert', 'restore'], 취소: ['abort', 'undo', 'reset'], 삭제: ['delete', 'remove', 'rm'],
    합치: ['merge', 'squash'], 복구: ['reflog', 'recover', 'restore'], 푸시: ['push'], 풀: ['pull'], 브랜치: ['branch'], 커밋: ['commit'], 메시지: ['message', 'amend'],
    비밀번호: ['.env', 'secret'], 실수: ['reset', 'reflog', 'revert'], 누가: ['blame'], 언제: ['bisect', 'log'], 임시: ['stash'], 원격: ['remote', 'origin'],
  };
  function searchScenarios(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return GP.scenarios.map((s) => {
      const hay = (s.title + ' ' + s.tags.join(' ') + ' ' + s.story + ' ' + (s.why || '')).toLowerCase();
      let score = 0;
      for (const w of words) {
        let hit = hay.includes(w);
        if (!hit) Object.keys(SYN).forEach((k) => { if (w.includes(k) && SYN[k].some((x) => hay.includes(x))) hit = true; });
        if (!hit) return null;
        score += (s.title.toLowerCase().includes(w) ? 3 : 0) + (s.tags.join(' ').toLowerCase().includes(w) ? 2 : 0) + 1;
      }
      return { s, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 8).map((x) => x.s);
  }
  $('#sosInput').addEventListener('input', (e) => {
    const q = e.target.value.trim();
    const box = $('#sosResults');
    if (!q) { box.hidden = true; return; }
    const res = searchScenarios(q);
    box.hidden = false;
    box.innerHTML = res.length ? res.map(scItemHtml).join('') : '<div class="sos-empty">일치하는 상황이 없어요. 다른 단어로 검색해 보세요 (예: push, 충돌, 되돌리기)</div>';
  });
  $('#btnSos').addEventListener('click', () => { openSidebar(); setTimeout(() => $('#sosInput').focus(), 250); });

  /* ---------- 시나리오 화면 ---------- */
  function storyHtml() {
    const done = store.done[sc.id];
    const cat = GP.categories.find((c) => c.id === sc.cat);
    const goals = sc.goals.map((g, i) => `<li data-g="${i}" class="${goalOk[i] ? 'ok' : ''}"><span class="mk">${goalOk[i] ? '✓' : ''}</span><span>${UI.esc(g[0])}</span></li>`).join('');
    const hintHtml = sc.hints.slice(0, hintShown).map((h) => `<li>${UI.md(h).replace(/<\/?p>/g, '')}</li>`).join('');
    return `
      <div class="sc-head"><div class="big">${sc.icon}</div><div><h2 class="sc-title">${UI.esc(sc.title)}</h2>
        <div class="sc-meta">${cat ? cat.icon + ' ' + cat.name + ' · ' : sc.id === 'sandbox' ? '' : ''}${sc.level ? `난이도 <span class="stars">${stars(sc.level)}</span>` : '자유 모드'}${done ? ' · <span style="color:var(--green)">✓ 완료</span>' : ''}</div></div></div>
      <div class="story">${UI.md(sc.story)}</div>
      ${sc.goals.length ? `<ul class="goals" id="goalList">${goals}</ul>` : ''}
      <div id="successBox">${solved ? successHtml() : ''}</div>
      <div class="sc-actions">
        ${sc.hints.length ? `<button class="btn" id="btnHint">💡 힌트 ${hintShown}/${sc.hints.length}</button>` : ''}
        ${sc.solution && sc.solution.cmds.length ? '<button class="btn" id="btnSol">✅ 정답 보기</button><button class="btn" id="btnAuto">▶ 정답 자동 실행</button>' : ''}
      </div>
      <div id="hintBox">${hintHtml ? `<details class="fold" open><summary>💡 힌트</summary><div><ol class="hintlist">${hintHtml}</ol></div></details>` : ''}</div>
      ${sc.why ? `<details class="fold"><summary>📚 왜 배우나요? (개념 노트)</summary><div>${UI.md(sc.why)}</div></details>` : ''}
      <div id="solBox"></div>`;
  }
  function successHtml() {
    const idx = GP.scenarios.findIndex((s) => s.id === sc.id);
    const next = GP.scenarios[idx + 1];
    return `<div class="success"><h3>🎉 해결했어요!</h3><div>${UI.esc(sc.solution.explain || '')}</div>${next ? `<div class="sc-actions"><button class="btn btn-primary" data-next="${next.id}">다음: ${UI.esc(next.title)} →</button></div>` : '<div>모든 시나리오를 끝냈어요! 🏆</div>'}</div>`;
  }
  function renderStory() { $('#storyBox').innerHTML = storyHtml(); }
  $('#storyBox').addEventListener('click', (e) => {
    const t = e.target;
    if (t.id === 'btnHint') {
      if (hintShown < sc.hints.length) { hintShown++; usedHints(); renderStory(); }
    } else if (t.id === 'btnSol') {
      const cmds = sc.solution.cmds.map((c) => (Array.isArray(c) ? (c[0] === 'write' ? `# 파일 ${c[1]} 을(를) 편집기로 수정:\n${c[2].replace(/\n$/, '')}` : '# (설정 작업)') : (typeof c === 'string' ? c : c.cmd))).join('\n');
      $('#solBox').innerHTML = `<details class="fold sol" open><summary>✅ 정답 예시</summary><div><pre>${UI.esc(cmds)}</pre><div>${UI.md(sc.solution.explain || '')}</div></div></details>`;
      markAssisted();
    } else if (t.id === 'btnAuto') autoSolve();
    else if (t.dataset && t.dataset.next) loadScenario(t.dataset.next);
  });
  function usedHints() { if (!sc || sc.id === 'sandbox') return; store.hints = store.hints || {}; store.hints[sc.id] = Math.max(store.hints[sc.id] || 0, hintShown); save(); }
  function markAssisted() { if (!sc || sc.id === 'sandbox') return; store.assisted = store.assisted || {}; store.assisted[sc.id] = true; save(); }

  function updateGoals() {
    if (!sc || !sc.goals.length) return;
    const env = lab.env();
    const prev = goalOk.slice();
    goalOk = sc.goals.map((g) => { try { return !!g[1](env); } catch (e) { return false; } });
    $$('#goalList li').forEach((li, i) => { li.classList.toggle('ok', goalOk[i]); li.querySelector('.mk').textContent = goalOk[i] ? '✓' : ''; });
    const all = goalOk.every(Boolean);
    if (all && !solved) {
      solved = true;
      if (!store.done[sc.id]) { store.done[sc.id] = { t: Date.now() }; save(); }
      $('#successBox').innerHTML = successHtml();
      renderTop(); renderSidebar();
      toast('🎉 모든 목표 달성!', 2600);
      if (window.matchMedia('(max-width: 960px)').matches) setNavPip('story', true);
    } else if (!all && prev.some((v, i) => v !== goalOk[i])) { /* 일부 변경 */ }
  }
  function setNavPip(pane, on) {
    const b = $(`#bottomNav button[data-pane="${pane}"]`); if (!b) return;
    let p = b.querySelector('.pip');
    if (on && !p) { p = document.createElement('i'); p.className = 'pip'; b.appendChild(p); } else if (!on && p) p.remove();
  }

  /* ---------- 터미널 ---------- */
  function promptHtml() {
    const p = lab.promptInfo();
    const warn = /\||@/.test(p.branch);
    return `<span class="p-cwd">${UI.esc(p.cwd)}</span>${p.branch ? ` <span class="p-br${warn ? ' warn' : ''}">(${UI.esc(p.branch)})</span>` : ''}<span class="dl"> $</span>`;
  }
  function renderPrompt() {
    const p = lab.promptInfo();
    const warn = /\||@/.test(p.branch);
    $('#promptLabel').innerHTML = `${UI.esc(p.cwd)}${p.branch ? ` <span class="br${warn ? ' warn' : ''}">(${UI.esc(p.branch)})</span>` : ''}<span class="dl"> $</span>`;
    $('#termTitle').textContent = `kim@dev-laptop: ${p.cwd}`;
  }
  function termAppend(html) { termHtml += html; $('#termOut').insertAdjacentHTML('beforeend', html); scrollTerm(); }
  function termClear() { termHtml = ''; $('#termOut').innerHTML = ''; }
  function sysLine(t) { termAppend(`<div class="ln-sys">${UI.esc(t)}</div>`); }

  const SHELL_HELP = 'git 명령어를 직접 입력해 보세요. 그 밖에 쓸 수 있는 명령: ls, cat, echo, nano <파일>, mkdir, rm, mv, cp, touch, sed, grep, cd 등.\n  clear = 화면 지우기 · reset = 이 시나리오 처음부터\n  파일은 오른쪽 "작업공간" 탭에서 눌러서 바로 편집할 수도 있어요.';
  async function runLine(line) {
    const raw = line.trim();
    termAppend(`<div class="ln-cmd">${promptHtml()} ${UI.esc(line)}</div>`);
    if (!raw) return;
    cmdHistory.push(raw); histPos = cmdHistory.length;
    if (raw === 'clear') { termClear(); return; }
    if (raw === 'reset') { resetScenario(); return; }
    if (raw === 'help' || raw === '?') { sysLine(SHELL_HELP); return; }
    busy = true;
    const before = new Set(); const repo0 = lab.repo(); if (repo0) repo0.objects.forEach((o, h) => { if (o.type === 'commit') before.add(h); });
    let res;
    try {
      res = await lab.runInteractive(raw, ask);
    } catch (e) {
      console.error(e);
      termAppend(`<div class="c-r">시뮬레이터 내부 오류: ${UI.esc(e.message)}</div>`);
      busy = false; return;
    }
    const text = (res.out || []).map((o) => o.t).join('');
    if (text) termAppend(`<div>${UI.ansiToHtml(text.endsWith('\n') ? text.slice(0, -1) : text)}</div>`);
    // 새 커밋 강조
    freshSet = new Set();
    const repo1 = lab.repo(); if (repo1) repo1.objects.forEach((o, h) => { if (o.type === 'commit' && !before.has(h)) freshSet.add(h); });
    busy = false;
    afterCommand();
  }
  function afterCommand() {
    renderPrompt(); renderChips(); refreshVis(); updateGoals();
    if (freshSet.size) setTimeout(() => { freshSet = new Set(); refreshGraph(); }, 4500);
  }

  $('#termForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) return;
    const inp = $('#termInput'); const v = inp.value; inp.value = '';
    runLine(v);
  });
  $('#termInput').addEventListener('keydown', (e) => {
    const inp = e.target;
    if (e.key === 'ArrowUp') { e.preventDefault(); if (histPos === cmdHistory.length) draft = inp.value; if (histPos > 0) { histPos--; inp.value = cmdHistory[histPos]; } } else if (e.key === 'ArrowDown') { e.preventDefault(); if (histPos < cmdHistory.length - 1) { histPos++; inp.value = cmdHistory[histPos]; } else { histPos = cmdHistory.length; inp.value = draft; } } else if (e.key === 'Tab') { e.preventDefault(); complete(inp); } else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); termClear(); }
  });
  $('#termOut').addEventListener('click', () => { if (!window.getSelection().toString() && window.innerWidth > 960) $('#termInput').focus(); });
  $('#btnClear').addEventListener('click', termClear);
  $('#btnReset').addEventListener('click', () => { if (confirm('이 시나리오를 처음 상태로 되돌릴까요?')) resetScenario(); });

  /* 탭 자동완성 */
  function complete(inp) {
    const v = inp.value; const parts = v.split(/\s+/); const last = parts[parts.length - 1] || '';
    let cands = [];
    const repo = lab.repo();
    if (parts.length <= 1) cands = ['git'].concat(['ls', 'cat', 'echo', 'nano', 'cd', 'clear', 'reset']);
    else if (parts[0] === 'git' && parts.length === 2) cands = Object.keys(G.commands).filter((c) => !c.startsWith('_'));
    else if (repo) {
      repo.branches().forEach(([b]) => cands.push(b));
      repo.listRefs('refs/remotes/').forEach(([n]) => cands.push(n.slice(13)));
      repo.listRefs('refs/tags/').forEach(([n]) => cands.push(n.slice(10)));
      repo.work.forEach((_, p) => cands.push(p));
      ['--oneline', '--graph', '--all', '--staged', '--hard', '--soft', '--amend', '--no-edit', '--abort', '--continue', '--rebase', '-m', '-u', '--force-with-lease'].forEach((o) => cands.push(o));
    }
    const m = cands.filter((c) => c.startsWith(last));
    if (m.length === 1) { parts[parts.length - 1] = m[0]; inp.value = parts.join(' ') + ' '; } else if (m.length > 1) {
      let pre = m[0]; m.forEach((c) => { while (!c.startsWith(pre)) pre = pre.slice(0, -1); });
      if (pre.length > last.length) { parts[parts.length - 1] = pre; inp.value = parts.join(' '); } else sysLine(m.slice(0, 24).join('   '));
    }
  }

  /* 명령어 칩 */
  function renderChips() {
    const repo = lab.repo();
    let list = ['git status', 'git log --oneline --graph --all', 'git diff', 'git add .', 'git commit -m ""', 'git branch -a', 'git switch ', 'git stash'];
    if (repo) {
      const s = repo.state;
      if (s.merge) list = ['git status', 'git diff', 'git add .', 'git commit --no-edit', 'git merge --abort', 'git checkout --ours ', 'git checkout --theirs '];
      else if (s.rebase) list = ['git status', 'git add .', 'git rebase --continue', 'git rebase --skip', 'git rebase --abort'];
      else if (s.cherryPick) list = ['git status', 'git add .', 'git cherry-pick --continue', 'git cherry-pick --abort'];
      else if (s.bisect) list = ['git bisect good', 'git bisect bad', 'git bisect log', 'git bisect reset', 'git status'];
      else if (repo.isDetached()) list = ['git status', 'git reflog', 'git switch -c ', 'git switch main', 'git log --oneline --graph --all'];
    } else list = ['git init', 'ls', 'git clone ', 'cd ..'];
    $('#chips').innerHTML = list.map((c) => `<button type="button" class="cmd-chip" data-c="${UI.esc(c)}">${UI.esc(c)}</button>`).join('');
  }
  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('.cmd-chip'); if (!b) return;
    const inp = $('#termInput'); inp.value = b.dataset.c; inp.focus();
    const q = inp.value.indexOf('""'); if (q >= 0) inp.setSelectionRange(q + 1, q + 1);
  });

  /* ---------- 시각화 ---------- */
  function refreshGraph() {
    const repo = lab.repo();
    const tools = repo ? `<div class="graph-tools"><label><input type="checkbox" id="chkLost" ${showLost ? 'checked' : ''}> reflog 의 길 잃은 커밋도 보기</label><span>커밋을 누르면 상세 내용</span></div>` : '';
    $('#visGraph').innerHTML = tools + UI.graphHtml(repo, { showLost, fresh: freshSet });
  }
  function refreshVis() {
    refreshGraph();
    $('#visFiles').innerHTML = UI.filesHtml(lab);
    $('#visRemote').innerHTML = UI.remoteHtml(lab);
    $('#visLog').innerHTML = UI.logHtml(lab);
  }
  $('#visGraph').addEventListener('change', (e) => { if (e.target.id === 'chkLost') { showLost = e.target.checked; refreshGraph(); } });
  $('#visGraph').addEventListener('click', (e) => {
    const row = e.target.closest('.grow'); if (!row) return;
    const h = row.dataset.hash;
    const r = lab.sim.exec(`git show --stat ${h}`);
    const body = openModal(`커밋 ${h.slice(0, 7)}`, `<pre>${UI.ansiToHtml(r.text || '')}</pre>`, [
      { label: '해시를 터미널에 넣기', onClick: () => { const inp = $('#termInput'); inp.value = (inp.value + ' ' + h.slice(0, 7)).trim(); closeModal(false); setMobilePane('term'); inp.focus(); } },
      { label: '닫기', primary: true, onClick: () => closeModal(false) },
    ]);
    void body;
  });
  $('#visFiles').addEventListener('click', (e) => {
    const b = e.target.closest('.file'); if (!b) return;
    openFile(b.dataset.file);
  });
  function openFile(path) {
    const dir = lab.dir(); if (!dir) return;
    const content = dir.files.has(path) ? dir.files.get(path) : '';
    const exists = dir.files.has(path);
    openModal(`${exists ? '편집' : '삭제된 파일'}: ${path}`, `<p class="note">저장하면 작업 폴더의 파일이 바뀌어요. (그 뒤 <code>git status</code> / <code>git diff</code> 로 확인!)</p><textarea id="edTa" spellcheck="false"></textarea>`, [
      { label: '닫기', onClick: () => closeModal(false) },
      { label: '저장', primary: true, onClick: () => { dir.files.set(path, $('#edTa').value); closeModal(false); sysLine(`# ${path} 파일을 편집기에서 저장했어요`); afterCommand(); } },
    ]);
    $('#edTa').value = content;
  }
  $('#visRemote').addEventListener('click', (e) => {
    const b = e.target.closest('[data-team]'); if (!b) return;
    teamAction(b.dataset.actor, b.dataset.team);
  });
  let teamN = 0;
  function teamAction(actor, kind) {
    try {
      const who = GP.PEOPLE[actor]; teamN++;
      lab.runActor(actor, 'git pull -q --rebase');
      const a = lab.sim.actors.get(actor);
      if (kind === 'push') {
        a.dir.files.set(`team/${actor}-${teamN}.md`, `# ${who.name} 의 메모 ${teamN}\n`);
        lab.runActor(actor, 'git add -A'); lab.runActor(actor, `git commit -q -m "${who.name.split(' ')[0]}: 문서 ${teamN} 추가"`);
      } else {
        const cur = a.dir.files.get('README.md') || '# 주문 관리 시스템\n';
        a.dir.files.set('README.md', cur.replace(/^# .*\n/, (m) => m) + `\n- ${who.name} 의 변경 ${teamN}\n`);
        lab.runActor(actor, 'git add -A'); lab.runActor(actor, `git commit -q -m "${who.name.split(' ')[0]}: README 수정 ${teamN}"`);
      }
      const r = lab.runActor(actor, 'git push -q');
      toast(r.code === 0 ? `${who.name} 이(가) 원격에 push 했어요` : `${who.name} 의 push 가 실패했어요`);
      refreshVis(); updateGoals();
    } catch (e) { toast('팀원 행동 실패: ' + e.message); }
  }
  $$('#visTabs button').forEach((b) => b.addEventListener('click', () => setVis(b.dataset.vis)));
  function setVis(v) {
    visTab = v;
    $$('#visTabs button').forEach((b) => b.classList.toggle('active', b.dataset.vis === v));
    $$('.vis').forEach((el) => el.classList.toggle('active', el.id === 'vis' + v[0].toUpperCase() + v.slice(1)));
  }

  /* ---------- 모바일 패널 ---------- */
  function setMobilePane(p) {
    mpane = p;
    document.body.dataset.mpane = p;
    $$('#bottomNav button').forEach((b) => b.classList.toggle('active', b.dataset.pane === p));
    if (p === 'graph' || p === 'files' || p === 'remote') setVis(p);
    if (p === 'story') setNavPip('story', false);
    if (p === 'term') setTimeout(scrollTerm, 30);
  }
  $$('#bottomNav button').forEach((b) => b.addEventListener('click', () => setMobilePane(b.dataset.pane)));

  /* ---------- 시나리오 로드/리셋 ---------- */
  function buildLab(s) {
    const l = new GP.Lab({ color: true });
    if (s.id === 'sandbox') l.setup(GP.remoteOps(8, ['minji', 'jun']));
    else l.setup(s.setup);
    return l;
  }
  function loadScenario(id) {
    sc = id === 'sandbox' ? SANDBOX : GP.scenarios.find((s) => s.id === id);
    if (!sc) return;
    try { lab = buildLab(sc); } catch (e) { console.error(e); toast('시나리오 준비 중 오류: ' + e.message, 5000); return; }
    hintShown = (store.hints && store.hints[sc.id]) || 0;
    if (hintShown > sc.hints.length) hintShown = 0;
    solved = !!store.done[sc.id] && false;
    goalOk = sc.goals.map(() => false);
    freshSet = new Set(); showLost = false;
    termClear(); cmdHistory = []; histPos = 0;
    renderStory(); renderSidebar(); renderTop();
    renderPrompt(); renderChips(); refreshVis();
    sysLine(sc.id === 'sandbox' ? '# 자유 연습장이에요. 아무 명령이나 실험해 보세요. (도움말: help)' : `# 시나리오 준비 완료 — "${sc.title}"  (도움말: help, 화면 지우기: clear)`);
    updateGoals();
    solved = sc.goals.length > 0 && goalOk.every(Boolean) ? false : false;
    try { history.replaceState(null, '', '#' + sc.id); } catch (e) { /* 무시 */ }
    const m = window.matchMedia('(max-width: 960px)').matches;
    setMobilePane(m ? 'story' : 'story');
    $('#centerCol').scrollTop = 0;
    const st = $('#paneStory'); if (st) st.scrollTop = 0;
  }
  function resetScenario() { if (sc) loadScenario(sc.id); toast('처음 상태로 되돌렸어요'); }
  $('#btnSandbox').addEventListener('click', () => { loadScenario('sandbox'); closeSidebar(); });
  $('#btnResetAll').addEventListener('click', () => {
    if (confirm('완료 기록을 모두 지울까요?')) { store = { done: {}, seen: true }; save(); renderTop(); renderSidebar(); if (sc) renderStory(); }
  });

  /* 정답 자동 실행 */
  async function autoSolve() {
    if (busy || !sc) return;
    if (!confirm('정답 명령을 터미널에서 자동으로 실행해 보여줄까요?\n(완료 기록에는 "정답을 본 것"으로 표시돼요)')) return;
    markAssisted();
    setMobilePane('term');
    busy = true;
    for (const step of sc.solution.cmds) {
      if (Array.isArray(step)) {
        try {
          if (step[0] === 'write') sysLine(`# ${step[1]} 파일을 이렇게 수정했다고 가정:\n${step[2].replace(/\n$/, '')}`);
          lab.setup([step]);
        } catch (e) { sysLine('# 단계 실패: ' + e.message); }
        renderPrompt(); refreshVis(); updateGoals(); continue;
      }
      const cmd = typeof step === 'string' ? step : step.cmd;
      const inputs = (typeof step === 'object' && step.inputs) || [];
      termAppend(`<div class="ln-cmd">${promptHtml()} ${UI.esc(cmd)}</div>`);
      await new Promise((r) => setTimeout(r, 450));
      let k = 0;
      const res = await lab.runInteractive(cmd, async (kind, payload) => { const v = inputs[k++]; return typeof v === 'function' ? v(payload) : v; });
      const text = (res.out || []).map((o) => o.t).join('');
      if (text) termAppend(`<div>${UI.ansiToHtml(text.endsWith('\n') ? text.slice(0, -1) : text)}</div>`);
      renderPrompt(); refreshVis(); updateGoals();
      await new Promise((r) => setTimeout(r, 450));
    }
    busy = false; renderChips();
  }

  /* ---------- 도움말 ---------- */
  function showHelp() {
    openModal('Git Playbook 사용법', `
      <ol class="help-list">
        <li><b>상황 읽기</b> — 왼쪽 목록에서 시나리오를 고르면 "오늘 이런 일이 생겼어요" 형식으로 문제가 나와요.</li>
        <li><b>터미널에 명령 입력</b> — 실제 git 과 같은 출력이 나와요. 편집기(vim 등)가 필요한 순간엔 간단한 입력창이 열려요.</li>
        <li><b>그래프로 확인</b> — 오른쪽 탭에서 커밋 그래프, 작업공간(스테이징), 원격, reflog 를 볼 수 있어요.</li>
        <li><b>목표 달성</b> — 체크리스트가 모두 ✓ 되면 해결! 막히면 💡힌트 → 📚개념 → ✅정답 순서로 보세요.</li>
        <li><b>🆘 상황 찾기</b> — "push 가 거절돼요", "충돌" 처럼 지금 겪는 문제로 비슷한 시나리오를 검색할 수 있어요.</li>
        <li><b>🧪 자유 연습장</b> — 원격과 팀원이 있는 샘플 저장소에서 마음껏 실험해 보세요.</li>
      </ol>
      <p class="note">Tab 키: 자동완성 · ↑↓: 이전 명령 · Ctrl+L: 화면 지우기 · 완료 기록은 이 브라우저에만 저장돼요.</p>`, [{ label: '시작하기', primary: true, onClick: () => closeModal(false) }]);
    store.seen = true; save();
  }
  $('#btnHelp').addEventListener('click', showHelp);

  /* ---------- 시작 ---------- */
  function init() {
    renderTop(); renderSidebar();
    const hash = location.hash.replace('#', '');
    const first = (hash && (hash === 'sandbox' || GP.scenarios.find((s) => s.id === hash))) ? hash : (GP.scenarios.find((s) => !store.done[s.id]) || GP.scenarios[0]).id;
    loadScenario(first);
    if (!store.seen) showHelp();
    window.__gp = { get lab() { return lab; }, get sc() { return sc; }, runLine, loadScenario };
  }
  init();
})();
