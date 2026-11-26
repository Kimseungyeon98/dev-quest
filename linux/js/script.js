(function () {
  'use strict';

  /* 엔진(가상 파일시스템·명령어·실행기)은 vfs.js · commands.js · shell.js 에 있어요 (linux/index.html 이 먼저 불러요) */
  const { HOME_PATH, D, F, arraysEqual, getNodeFromHome, buildRoot, cloneTree, displayPath, getNode, resolvePath, executeChain } = window.LinuxEngine;

  /* ============================================================
   * 미션 데이터 (js/missions.js)
   * ========================================================== */
  const MISSIONS = window.LINUX_MISSIONS_FACTORY({ D, F, HOME_PATH, getNodeFromHome, arraysEqual });

  /* ============================================================
   * 게임 상태 / 저장
   * ========================================================== */
  const STORAGE_KEY = 'linuxQuestProgress_v1';
  // XP·레벨·티어 규칙은 ../shared/dq.js 의 공용 규칙을 써요 (과목 간 동일)
  const dqBar = window.DevQuest.mountBar('linux');
  const MISSION_ITEMS = MISSIONS.map((m) => ({ id: m.id, difficulty: m.difficulty }));

  const DIFFICULTY_META = {
    easy: { label: '초급', stars: '★☆☆', className: 'diff-easy' },
    medium: { label: '중급', stars: '★★☆', className: 'diff-medium' },
    hard: { label: '고급', stars: '★★★', className: 'diff-hard' },
  };

  const game = {
    ctx: null,
    currentIndex: 0,
    completed: new Set(),
    hintIndex: 0,
    historyPointer: 0,
  };

  let viState = null;

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }
  function saveProgress() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      currentIndex: game.currentIndex,
      completed: Array.from(game.completed),
    }));
    DevQuest.sync.changed('linux'); // 계정에도 저장
  }
  function isUnlocked(i) {
    return i === 0 || game.completed.has(MISSIONS[i - 1].id);
  }

  /* ============================================================
   * DOM 참조
   * ========================================================== */
  const el = {
    missionList: document.getElementById('missionList'),
    missionListDetails: document.getElementById('missionListDetails'),
    currentMissionLabel: document.getElementById('currentMissionLabel'),
    missionTitle: document.getElementById('missionTitle'),
    missionDesc: document.getElementById('missionDesc'),
    hintBtn: document.getElementById('hintBtn'),
    hintText: document.getElementById('hintText'),
    conceptBtn: document.getElementById('conceptBtn'),
    conceptText: document.getElementById('conceptText'),
    resetMissionBtn: document.getElementById('resetMissionBtn'),
    terminalOutput: document.getElementById('terminalOutput'),
    terminalInput: document.getElementById('terminalInput'),
    terminalInputLine: document.getElementById('terminalInputLine'),
    terminalWindow: document.getElementById('terminalWindow'),
    promptLabel: document.getElementById('promptLabel'),
    viBuffer: document.getElementById('viBuffer'),
    viStatusBar: document.getElementById('viStatusBar'),
    cheatSheetBtn: document.getElementById('cheatSheetBtn'),
    cheatSheetModal: document.getElementById('cheatSheetModal'),
    cheatSheetList: document.getElementById('cheatSheetList'),
    closeCheatSheet: document.getElementById('closeCheatSheet'),
  };

  function promptString() {
    return `user@linux-game:${displayPath(game.ctx.cwd)}$`;
  }

  function updatePromptLabel() {
    el.promptLabel.textContent = promptString();
  }

  function appendLine(text, className) {
    const div = document.createElement('div');
    div.className = 'line ' + className;
    div.textContent = text;
    el.terminalOutput.appendChild(div);
  }

  function appendPromptLine(raw) {
    const div = document.createElement('div');
    div.className = 'line prompt-line';
    const echoSpan = document.createElement('span');
    echoSpan.className = 'prompt-echo';
    echoSpan.textContent = 'user@linux-game:';
    const pathSpan = document.createElement('span');
    pathSpan.className = 'path-echo';
    pathSpan.textContent = displayPath(game.ctx.cwd);
    const dollarSpan = document.createElement('span');
    dollarSpan.className = 'prompt-echo';
    dollarSpan.textContent = '$ ';
    const cmdSpan = document.createElement('span');
    cmdSpan.className = 'cmd-text';
    cmdSpan.textContent = raw;
    div.appendChild(echoSpan);
    div.appendChild(pathSpan);
    div.appendChild(dollarSpan);
    div.appendChild(cmdSpan);
    el.terminalOutput.appendChild(div);
  }

  function scrollTerminalToBottom() {
    el.terminalOutput.scrollTop = el.terminalOutput.scrollHeight;
  }

  function spawnConfetti() {
    const emojis = ['🎉', '✨', '🐧', '⭐'];
    for (let i = 0; i < 14; i++) {
      const span = document.createElement('span');
      span.className = 'confetti';
      span.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      span.style.left = Math.random() * 100 + 'vw';
      span.style.animationDuration = 1.6 + Math.random() * 1.2 + 's';
      document.body.appendChild(span);
      setTimeout(() => span.remove(), 3000);
    }
  }

  function appendSuccessBanner(mission) {
    const wrap = document.createElement('div');
    wrap.className = 'success-banner';
    const title = document.createElement('div');
    title.className = 'title';
    title.innerHTML = window.DevQuest.icon('checkCircle', 18) + ' 미션 성공! ' + window.DevQuest.esc(mission.title);
    const xp = document.createElement('div');
    xp.className = 'xp';
    xp.textContent = `+${window.DevQuest.diffMeta(mission.difficulty).xp} XP 획득`;
    wrap.appendChild(title);
    wrap.appendChild(xp);

    const nextIndex = game.currentIndex + 1;
    if (nextIndex < MISSIONS.length) {
      // 정답 직후 Enter·Tab 으로도 넘어가요 (다른 키를 누르면 원래대로)
      wrap.appendChild(window.DevQuest.nextButton('다음 퀘스트', () => loadMission(nextIndex)));
    } else {
      const done = document.createElement('div');
      done.className = 'title';
      done.style.marginTop = '6px';
      done.innerHTML = window.DevQuest.icon('trophy', 18) + ' 모든 미션 클리어! 당신은 이제 리눅스 명령어를 다루는 SI 개발자입니다.';
      wrap.appendChild(done);
    }
    el.terminalOutput.appendChild(wrap);
    spawnConfetti();
  }

  function renderHeader() {
    dqBar.update(window.DevQuest.stats(MISSION_ITEMS, Array.from(game.completed)));
  }

  function renderSidebar() {
    // 다시 그려도 사용자가 펼쳐 둔 분류는 유지하고, 지금 미션이 속한 분류는 항상 펼친다
    const opened = new Set(Array.from(el.missionList.querySelectorAll('details.dq-cat[open]')).map((d) => d.dataset.cat));
    const first = el.missionList.children.length === 0;
    const currentCat = MISSIONS[game.currentIndex] && MISSIONS[game.currentIndex].category;
    const DQ = window.DevQuest;
    el.missionList.innerHTML = (window.LINUX_CATEGORIES || []).map((cat) => {
      const entries = MISSIONS.map((m, i) => ({ m, i })).filter((x) => x.m.category === cat.id);
      if (!entries.length) return '';
      const items = entries.map(({ m, i }) => DQ.itemHtml({
        id: m.id, title: m.title, difficulty: m.difficulty, done: game.completed.has(m.id), locked: !isUnlocked(i), active: i === game.currentIndex,
      })).join('');
      const done = entries.filter((x) => game.completed.has(x.m.id)).length;
      return DQ.catHtml({ id: cat.id, icon: cat.icon, label: cat.label, desc: cat.desc, done, total: entries.length }, items, cat.id === currentCat || (!first && opened.has(cat.id)));
    }).join('');
    const current = MISSIONS[game.currentIndex];
    if (current) el.currentMissionLabel.textContent = '· ' + current.title;
  }

  el.missionList.addEventListener('click', (e) => {
    const btn = e.target.closest('.dq-item');
    if (!btn || btn.classList.contains('locked')) return;
    loadMission(MISSIONS.findIndex((m) => m.id === btn.dataset.id));
    if (window.matchMedia('(max-width: 700px)').matches) el.missionListDetails.removeAttribute('open');
  });

  function renderMissionBrief(mission) {
    const diff = DIFFICULTY_META[mission.difficulty];
    el.missionTitle.innerHTML = '';
    const titleText = document.createElement('span');
    titleText.textContent = mission.title;
    const diffTag = document.createElement('span');
    diffTag.className = 'diff-tag ' + diff.className;
    diffTag.textContent = `${diff.stars} ${diff.label}`;
    el.missionTitle.appendChild(titleText);
    el.missionTitle.appendChild(diffTag);
    el.missionDesc.textContent = mission.desc;
    el.hintText.textContent = '';
    el.hintText.classList.add('hidden');
    game.hintIndex = 0;
    el.conceptText.textContent = '';
    el.conceptText.classList.add('hidden');
    el.conceptBtn.classList.toggle('hidden', !mission.concept);
  }

  function clearTerminalDOM() {
    el.terminalOutput.innerHTML = '';
  }

  function loadMission(index) {
    window.DevQuest.disarmNext();
    if (viState) closeViEditor(false, true);
    const mission = MISSIONS[index];
    game.currentIndex = index;
    game.reviewReported = { wrong: false, correct: false }; // 오답 노트: 미션을 열 때마다 한 번씩만 알려요
    game.ctx = {
      root: buildRoot(cloneTree(mission.fs || {})),
      cwd: HOME_PATH.slice(),
      history: [],
      processes: mission.processes ? cloneTree(mission.processes) : [],
      services: mission.services ? cloneTree(mission.services) : [],
      containers: mission.containers ? cloneTree(mission.containers) : [],
      images: mission.images ? cloneTree(mission.images) : [],
      jobs: [],
      diskOutput: mission.diskOutput || null,
      duOutput: mission.duOutput || null,
      memOutput: mission.memOutput || null,
    };
    game.historyPointer = 0;
    clearTerminalDOM();
    appendLine(`=== ${mission.title} ===`, 'system-line');
    appendLine('명령어를 입력하고 Enter를 눌러 미션을 해결하세요. (도움이 필요하면 "help" 입력)', 'system-line');
    renderMissionBrief(mission);
    updatePromptLabel();
    renderSidebar();
    saveProgress();
    el.terminalInput.focus();
  }

  function completeMission() {
    const mission = MISSIONS[game.currentIndex];
    if (game.completed.has(mission.id)) return;
    reportCorrect(mission);
    game.completed.add(mission.id);
    saveProgress();
    appendSuccessBanner(mission);
    renderHeader();
    renderSidebar();
  }

  function handleSubmit() {
    const raw = el.terminalInput.value;
    if (raw.trim() === '') return;
    if (/^(vi|vim)\s+\S+/.test(raw.trim())) {
      appendPromptLine(raw);
      game.ctx.history.push(raw.trim());
      el.terminalInput.value = '';
      updatePromptLabel();
      openViEditor(raw.trim());
      return;
    }
    appendPromptLine(raw);
    const chainResult = executeChain(raw, game.ctx);
    el.terminalInput.value = '';
    game.historyPointer = game.ctx.history.length;
    if (!chainResult) { updatePromptLabel(); return; }

    let allOutput = [];
    let hadError = false;
    let lastSeg = null;
    chainResult.segments.forEach((seg) => {
      if (seg.clear) clearTerminalDOM();
      if (seg.error) { appendLine(seg.error, 'error-line'); hadError = true; }
      else seg.output.forEach((line) => appendLine(line, 'output-line'));
      allOutput = allOutput.concat(seg.output || []);
      lastSeg = seg;
    });
    if (chainResult.backgroundJob) {
      appendLine(`[${chainResult.backgroundJob.id}] ${chainResult.backgroundJob.pid}`, 'system-line');
    }
    updatePromptLabel();

    checkMissionProgress({
      ctx: game.ctx,
      cmdName: lastSeg ? lastSeg.cmdName : null,
      args: lastSeg ? lastSeg.args : [],
      raw: chainResult.raw,
      output: lastSeg ? lastSeg.output : [],
      error: lastSeg ? lastSeg.error : null,
      allOutput,
      hadError,
      cmdNames: chainResult.segments.map((s) => s.cmdName),
    });
    scrollTerminalToBottom();
  }

  function checkMissionProgress(state) {
    const mission = MISSIONS[game.currentIndex];
    let passed = false;
    if (game.completed.has(mission.id)) {
      // 이미 끝낸 미션을 다시 푼 경우: 오답 노트에서 열었으면 졸업 (배너도 다시 보여 줘요)
      if (game.reviewReported && game.reviewReported.correct) return;
      try { passed = mission.check(state); } catch (e) { passed = false; }
      if (passed) {
        const fromNotes = window.DevQuest.review.target() === mission.id;
        reportCorrect(mission);
        if (fromNotes) appendSuccessBanner(mission);
      }
      return;
    }
    try { passed = mission.check(state); } catch (e) { passed = false; }
    if (passed) completeMission();
    else if (state.hadError && game.reviewReported && !game.reviewReported.wrong) {
      game.reviewReported.wrong = true; // 오류가 난 명령 (미션을 열 때마다 한 번만 셉니다)
      window.DevQuest.review.wrong('linux', mission.id);
    }
  }
  function reportCorrect(mission) {
    if (!game.reviewReported) game.reviewReported = {};
    if (game.reviewReported.correct) return;
    game.reviewReported.correct = true;
    window.DevQuest.review.correct('linux', mission.id);
  }

  /* ============================================================
   * vi / vim 미니 에디터 (모드 기반 실제 키 입력 처리)
   * ========================================================== */
  function writeFileAtSegs(ctx, segs, content) {
    const segsCopy = segs.slice();
    const name = segsCopy.pop();
    const parent = getNode(ctx.root, segsCopy);
    if (!parent || parent.type !== 'dir') return;
    if (!parent.children[name]) parent.children[name] = F('');
    if (parent.children[name].type === 'file') parent.children[name].content = content;
  }

  function openViEditor(raw) {
    const filePath = raw.trim().split(/\s+/)[1];
    const segs = resolvePath(game.ctx.cwd, filePath);
    const node = getNode(game.ctx.root, segs);
    const isNew = !node || node.type !== 'file';
    const content = node && node.type === 'file' ? node.content : '';
    viState = {
      lines: content.split('\n'),
      cursorRow: 0,
      cursorCol: 0,
      mode: 'normal',
      cmdBuffer: '',
      pendingKey: null,
      yank: null,
      dirty: false,
      isNew,
      filePath,
      segs,
      rawCmd: raw,
      lastMsg: null,
    };
    el.terminalOutput.classList.add('hidden');
    el.terminalInputLine.classList.add('hidden');
    el.viBuffer.classList.remove('hidden');
    el.viStatusBar.classList.remove('hidden');
    el.terminalInput.blur();
    document.addEventListener('keydown', onViKeyDown, true);
    renderVi();
  }

  function closeViEditor(saved, silent) {
    document.removeEventListener('keydown', onViKeyDown, true);
    const st = viState;
    if (saved && st) {
      writeFileAtSegs(game.ctx, st.segs, st.lines.join('\n'));
    }
    el.viBuffer.classList.add('hidden');
    el.viStatusBar.classList.add('hidden');
    el.terminalOutput.classList.remove('hidden');
    el.terminalInputLine.classList.remove('hidden');
    viState = null;
    if (silent || !st) return;
    if (saved) {
      appendLine(`"${st.filePath}" ${st.lines.length}L, ${st.lines.join('\n').length}C written`, 'output-line');
    }
    updatePromptLabel();
    checkMissionProgress({
      ctx: game.ctx,
      cmdName: 'vi',
      args: st.rawCmd.trim().split(/\s+/).slice(1),
      raw: st.rawCmd,
      output: [],
      error: null,
      allOutput: [],
      hadError: false,
      cmdNames: ['vi'],
      viSaved: saved,
    });
    scrollTerminalToBottom();
    el.terminalInput.focus();
  }

  function runViCommand(cmd) {
    const st = viState;
    const c = cmd.trim();
    if (c === 'w') {
      writeFileAtSegs(game.ctx, st.segs, st.lines.join('\n'));
      st.dirty = false;
      st.mode = 'normal';
      st.lastMsg = `"${st.filePath}" written`;
    } else if (c === 'q') {
      if (st.dirty) {
        st.mode = 'normal';
        st.lastMsg = 'E37: No write since last change (add ! to override)';
      } else {
        closeViEditor(false);
      }
    } else if (c === 'q!') {
      closeViEditor(false);
    } else if (c === 'wq' || c === 'x') {
      closeViEditor(true);
    } else {
      st.mode = 'normal';
      st.lastMsg = `E492: Not an editor command: ${c}`;
    }
  }

  function onViKeyDown(e) {
    if (!viState) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const allowedSpecial = ['Escape', 'Enter', 'Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (e.key.length > 1 && !allowedSpecial.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const st = viState;

    if (st.mode === 'insert') {
      if (e.key === 'Escape') {
        st.mode = 'normal';
        if (st.cursorCol > 0) st.cursorCol--;
      } else if (e.key === 'Enter') {
        const line = st.lines[st.cursorRow];
        const before = line.slice(0, st.cursorCol);
        const after = line.slice(st.cursorCol);
        st.lines.splice(st.cursorRow, 1, before, after);
        st.cursorRow++;
        st.cursorCol = 0;
        st.dirty = true;
      } else if (e.key === 'Backspace') {
        if (st.cursorCol > 0) {
          const line = st.lines[st.cursorRow];
          st.lines[st.cursorRow] = line.slice(0, st.cursorCol - 1) + line.slice(st.cursorCol);
          st.cursorCol--;
          st.dirty = true;
        } else if (st.cursorRow > 0) {
          const prevLen = st.lines[st.cursorRow - 1].length;
          st.lines[st.cursorRow - 1] += st.lines[st.cursorRow];
          st.lines.splice(st.cursorRow, 1);
          st.cursorRow--;
          st.cursorCol = prevLen;
          st.dirty = true;
        }
      } else if (e.key.length === 1) {
        const line = st.lines[st.cursorRow];
        st.lines[st.cursorRow] = line.slice(0, st.cursorCol) + e.key + line.slice(st.cursorCol);
        st.cursorCol++;
        st.dirty = true;
      }
      renderVi();
      return;
    }

    if (st.mode === 'command') {
      if (e.key === 'Escape') {
        st.mode = 'normal';
        st.cmdBuffer = '';
        renderVi();
      } else if (e.key === 'Enter') {
        const cmdToRun = st.cmdBuffer;
        st.cmdBuffer = '';
        runViCommand(cmdToRun);
        if (viState) renderVi();
      } else if (e.key === 'Backspace') {
        st.cmdBuffer = st.cmdBuffer.slice(0, -1);
        renderVi();
      } else if (e.key.length === 1) {
        st.cmdBuffer += e.key;
        renderVi();
      }
      return;
    }

    // normal mode
    const key = e.key;
    if (st.pendingKey) {
      const combo = st.pendingKey + key;
      st.pendingKey = null;
      if (combo === 'dd') {
        st.yank = st.lines[st.cursorRow];
        st.lines.splice(st.cursorRow, 1);
        if (st.lines.length === 0) st.lines = [''];
        if (st.cursorRow >= st.lines.length) st.cursorRow = st.lines.length - 1;
        st.cursorCol = 0;
        st.dirty = true;
      } else if (combo === 'yy') {
        st.yank = st.lines[st.cursorRow];
      } else if (combo === 'gg') {
        st.cursorRow = 0;
        st.cursorCol = 0;
      }
      renderVi();
      return;
    }
    if (key === 'd' || key === 'y' || key === 'g') { st.pendingKey = key; return; }

    if (key === 'i') { st.mode = 'insert'; }
    else if (key === 'a') { st.mode = 'insert'; st.cursorCol = Math.min(st.cursorCol + 1, st.lines[st.cursorRow].length); }
    else if (key === 'o') { st.lines.splice(st.cursorRow + 1, 0, ''); st.cursorRow++; st.cursorCol = 0; st.mode = 'insert'; st.dirty = true; }
    else if (key === 'O') { st.lines.splice(st.cursorRow, 0, ''); st.cursorCol = 0; st.mode = 'insert'; st.dirty = true; }
    else if (key === 'x') {
      const line = st.lines[st.cursorRow];
      if (st.cursorCol < line.length) {
        st.lines[st.cursorRow] = line.slice(0, st.cursorCol) + line.slice(st.cursorCol + 1);
        st.dirty = true;
      }
    } else if (key === 'p') {
      if (st.yank !== null) { st.lines.splice(st.cursorRow + 1, 0, st.yank); st.cursorRow++; st.dirty = true; }
    } else if (key === 'G') { st.cursorRow = st.lines.length - 1; st.cursorCol = 0; }
    else if (key === ':') { st.mode = 'command'; st.cmdBuffer = ''; }
    else if (key === 'h' || key === 'ArrowLeft') { st.cursorCol = Math.max(0, st.cursorCol - 1); }
    else if (key === 'l' || key === 'ArrowRight') { st.cursorCol = Math.min(st.lines[st.cursorRow].length, st.cursorCol + 1); }
    else if (key === 'j' || key === 'ArrowDown') { st.cursorRow = Math.min(st.lines.length - 1, st.cursorRow + 1); st.cursorCol = Math.min(st.cursorCol, st.lines[st.cursorRow].length); }
    else if (key === 'k' || key === 'ArrowUp') { st.cursorRow = Math.max(0, st.cursorRow - 1); st.cursorCol = Math.min(st.cursorCol, st.lines[st.cursorRow].length); }

    renderVi();
  }

  function renderVi() {
    if (!viState) return;
    const st = viState;
    el.viBuffer.innerHTML = '';
    st.lines.forEach((line, i) => {
      const lineDiv = document.createElement('div');
      lineDiv.className = 'vi-line';
      const numSpan = document.createElement('span');
      numSpan.className = 'vi-linenum';
      numSpan.textContent = String(i + 1).padStart(3, ' ');
      lineDiv.appendChild(numSpan);
      const textSpan = document.createElement('span');
      textSpan.className = 'vi-text';
      if (i === st.cursorRow) {
        const before = line.slice(0, st.cursorCol);
        const atChar = line.slice(st.cursorCol, st.cursorCol + 1) || ' ';
        const after = line.slice(st.cursorCol + 1);
        textSpan.appendChild(document.createTextNode(before));
        const cursorSpan = document.createElement('span');
        cursorSpan.className = 'vi-cursor';
        cursorSpan.textContent = atChar;
        textSpan.appendChild(cursorSpan);
        textSpan.appendChild(document.createTextNode(after));
      } else {
        textSpan.textContent = line;
      }
      lineDiv.appendChild(textSpan);
      el.viBuffer.appendChild(lineDiv);
    });
    const fillerCount = Math.max(0, 16 - st.lines.length);
    for (let i = 0; i < fillerCount; i++) {
      const d = document.createElement('div');
      d.className = 'vi-filler';
      d.textContent = '~';
      el.viBuffer.appendChild(d);
    }

    let statusText;
    if (st.mode === 'insert') statusText = '-- INSERT --';
    else if (st.mode === 'command') statusText = ':' + st.cmdBuffer;
    else if (st.lastMsg) { statusText = st.lastMsg; st.lastMsg = null; }
    else statusText = `"${st.filePath}"${st.isNew ? ' [New File]' : ''} ${st.lines.length}L${st.dirty ? ' [+]' : ''}`;
    el.viStatusBar.textContent = statusText;
  }

  function renderCheatSheet() {
    el.cheatSheetList.innerHTML = '';
    const seen = new Set();
    MISSIONS.forEach((m, i) => {
      if (!isUnlocked(i) && !game.completed.has(m.id)) return;
      m.commandsTaught.forEach((c) => {
        if (seen.has(c.cmd)) return;
        seen.add(c.cmd);
        const item = document.createElement('div');
        item.className = 'cheat-item';
        const cmd = document.createElement('div');
        cmd.className = 'cmd';
        cmd.textContent = c.cmd;
        const desc = document.createElement('div');
        desc.className = 'desc';
        desc.textContent = c.desc;
        item.appendChild(cmd);
        item.appendChild(desc);
        el.cheatSheetList.appendChild(item);
      });
    });
    if (seen.size === 0) {
      const empty = document.createElement('div');
      empty.className = 'desc';
      empty.textContent = '아직 배운 명령어가 없습니다. 첫 미션을 클리어해보세요!';
      el.cheatSheetList.appendChild(empty);
    }
  }

  /* ============================================================
   * 이벤트 바인딩
   * ========================================================== */
  el.terminalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (game.ctx.history.length === 0) return;
      game.historyPointer = Math.max(0, game.historyPointer - 1);
      el.terminalInput.value = game.ctx.history[game.historyPointer] || '';
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (game.ctx.history.length === 0) return;
      game.historyPointer = Math.min(game.ctx.history.length, game.historyPointer + 1);
      el.terminalInput.value = game.ctx.history[game.historyPointer] || '';
    }
  });

  el.terminalWindow.addEventListener('click', () => el.terminalInput.focus());

  el.hintBtn.addEventListener('click', () => {
    const mission = MISSIONS[game.currentIndex];
    el.hintText.innerHTML = window.DevQuest.icon('bulb') + ' ' + window.DevQuest.esc(mission.hints[game.hintIndex]);
    window.DevQuest.review.hint('linux', mission.id);
    el.hintText.classList.remove('hidden');
    game.hintIndex = (game.hintIndex + 1) % mission.hints.length;
  });

  el.conceptBtn.addEventListener('click', () => {
    const mission = MISSIONS[game.currentIndex];
    if (!mission.concept) return;
    el.conceptText.innerHTML = window.DevQuest.icon('cap') + ' ' + window.DevQuest.esc(mission.concept);
    el.conceptText.classList.toggle('hidden');
  });

  el.resetMissionBtn.addEventListener('click', () => loadMission(game.currentIndex));

  el.cheatSheetBtn.addEventListener('click', () => {
    renderCheatSheet();
    el.cheatSheetModal.classList.remove('hidden');
  });
  el.closeCheatSheet.addEventListener('click', () => el.cheatSheetModal.classList.add('hidden'));
  el.cheatSheetModal.addEventListener('click', (e) => {
    if (e.target === el.cheatSheetModal) el.cheatSheetModal.classList.add('hidden');
  });

  /* ============================================================
   * 초기화
   * ========================================================== */
  function init() {
    const saved = loadProgress();
    if (saved) {
      game.completed = new Set(saved.completed || []);
      game.currentIndex = Math.min(saved.currentIndex || 0, MISSIONS.length - 1);
    }
    // 허브의 "이어하기"가 #미션id 로 보내면 그 미션부터 (열린 미션만)
    const linked = MISSIONS.findIndex((m) => m.id === location.hash.slice(1));
    if (linked >= 0 && (isUnlocked(linked) || game.completed.has(MISSIONS[linked].id))) game.currentIndex = linked;
    if (location.hash) try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* 무시 */ }
    loadMission(game.currentIndex);
    renderHeader();
    if (window.matchMedia('(max-width: 700px)').matches) {
      el.missionListDetails.removeAttribute('open');
    }
  }

  init();
})();
