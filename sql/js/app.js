(function () {
  'use strict';

  const DATA = window.SQL_LAB_DATA;
  const PROBLEMS = DATA.PROBLEMS;
  const PROBLEMS_BY_ID = {};
  PROBLEMS.forEach((p) => { PROBLEMS_BY_ID[p.id] = p; });

  const STORAGE_KEY = 'sqlQueryLabProgress_v1';

  const state = {
    SQL: null,
    db: null,
    currentProblemId: null,
    solved: new Set(),
    hintIndex: 0,
    cachedSolutionResult: null,
    initialPlanText: null,
  };

  /* ============================================================
   * SQL 실행 엔진 헬퍼
   * ========================================================== */
  function base64ToUint8Array(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function splitStatements(sqlText) {
    const stmts = [];
    let cur = '';
    let inStr = false;
    for (let i = 0; i < sqlText.length; i++) {
      const ch = sqlText[i];
      if (ch === "'") inStr = !inStr;
      if (ch === ';' && !inStr) {
        if (cur.trim()) stmts.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    if (cur.trim()) stmts.push(cur.trim());
    return stmts;
  }

  /* 마지막 문장은 db.prepare()로 직접 실행해서, 0건 SELECT도 컬럼 정보를 잃지 않게 처리 */
  function runSqlReliable(db, sqlText) {
    const stmts = splitStatements(sqlText);
    if (stmts.length === 0) throw new Error('실행할 SQL이 없습니다.');
    let lastResult = null;
    for (let i = 0; i < stmts.length; i++) {
      const isLast = i === stmts.length - 1;
      if (isLast) {
        const stmt = db.prepare(stmts[i]);
        const columns = stmt.getColumnNames();
        const values = [];
        while (stmt.step()) values.push(stmt.get());
        stmt.free();
        lastResult = columns.length > 0 ? { columns, values } : null;
      } else {
        db.run(stmts[i]);
      }
    }
    return lastResult;
  }

  function getPlanText(db, sql) {
    const res = db.exec('EXPLAIN QUERY PLAN ' + sql);
    if (!res[0]) return '';
    return res[0].values.map((row) => row[row.length - 1]).join('\n');
  }

  function normalizeCell(cell) {
    if (cell === null || cell === undefined) return 'NULL';
    if (typeof cell === 'number') {
      if (Number.isInteger(cell)) return String(cell);
      return cell.toFixed(6);
    }
    return String(cell);
  }
  function normalizeResult(res) {
    if (!res) return [];
    return res.values.map((row) => row.map(normalizeCell));
  }
  function rowsMatch(userRows, solRows, orderMatters) {
    let u = userRows.map((r) => r.join('\u0001'));
    let s = solRows.map((r) => r.join('\u0001'));
    if (!orderMatters) { u = u.slice().sort(); s = s.slice().sort(); }
    return JSON.stringify(u) === JSON.stringify(s);
  }

  /* n개 중 k개를 원래 순서를 유지한 채 고르는 모든 조합의 컬럼 인덱스 */
  function columnCombinations(n, k) {
    const out = [];
    (function pick(start, cur) {
      if (cur.length === k) { out.push(cur.slice()); return; }
      for (let i = start; i < n; i++) { cur.push(i); pick(i + 1, cur); cur.pop(); }
    })(0, []);
    return out;
  }

  /* 정답과 같은 개수의 컬럼이면 그대로 비교하고, 사용자가 컬럼을 더 많이 조회했으면(예: SELECT *)
     그중 정답과 값이 일치하는 컬럼 조합이 있는지 찾아서 비교한다. (별칭은 무시) */
  function compareResults(userRes, solRes, orderMatters) {
    if (!userRes || !solRes) return { ok: false, reason: '결과 행이 없습니다' };
    const k = solRes.columns.length;
    const n = userRes.columns.length;
    if (n < k) {
      return { ok: false, reason: `컬럼이 부족합니다 — 내 결과 ${n}개, 기대 ${k}개 (${solRes.columns.join(', ')})` };
    }
    const userRows = normalizeResult(userRes);
    const solRows = normalizeResult(solRes);
    if (userRows.length !== solRows.length) {
      return { ok: false, reason: `행 개수가 다릅니다 (${userRows.length} vs ${solRows.length})` };
    }
    if (n === k) {
      const ok = rowsMatch(userRows, solRows, orderMatters);
      return { ok, reason: ok ? '' : '행 내용이 다릅니다', note: '' };
    }
    for (const combo of columnCombinations(n, k)) {
      const projected = userRows.map((row) => combo.map((i) => row[i]));
      if (rowsMatch(projected, solRows, orderMatters)) {
        return { ok: true, reason: '', note: '추가로 조회한 컬럼은 제외하고 채점했어요' };
      }
    }
    return { ok: false, reason: `행 내용이 다르거나 필요한 컬럼이 없습니다 — 기대 컬럼: ${solRes.columns.join(', ')}`, note: '' };
  }

  /* ============================================================
   * DOM 참조
   * ========================================================== */
  const el = {
    solvedCount: document.getElementById('solvedCount'),
    categoryListDetails: document.getElementById('categoryListDetails'),
    categoryList: document.getElementById('categoryList'),
    currentProblemLabel: document.getElementById('currentProblemLabel'),
    cheatSheetBtn: document.getElementById('cheatSheetBtn'),
    loadingBanner: document.getElementById('loadingBanner'),
    problemBrief: document.getElementById('problemBrief'),
    problemTitle: document.getElementById('problemTitle'),
    problemScenario: document.getElementById('problemScenario'),
    expectedColumns: document.getElementById('expectedColumns'),
    hintBtn: document.getElementById('hintBtn'),
    conceptBtn: document.getElementById('conceptBtn'),
    schemaToggleBtn: document.getElementById('schemaToggleBtn'),
    hintText: document.getElementById('hintText'),
    conceptText: document.getElementById('conceptText'),
    schemaPanel: document.getElementById('schemaPanel'),
    queryWorkArea: document.getElementById('queryWorkArea'),
    targetQueryBox: document.getElementById('targetQueryBox'),
    targetQueryText: document.getElementById('targetQueryText'),
    sqlEditor: document.getElementById('sqlEditor'),
    runBtn: document.getElementById('runBtn'),
    runStatus: document.getElementById('runStatus'),
    resultArea: document.getElementById('resultArea'),
    planArea: document.getElementById('planArea'),
    shortAnswerArea: document.getElementById('shortAnswerArea'),
    shortAnswerPlanBox: document.getElementById('shortAnswerPlanBox'),
    shortAnswerPlanText: document.getElementById('shortAnswerPlanText'),
    shortAnswerQuestion: document.getElementById('shortAnswerQuestion'),
    shortAnswerInput: document.getElementById('shortAnswerInput'),
    shortAnswerSubmit: document.getElementById('shortAnswerSubmit'),
    shortAnswerFeedback: document.getElementById('shortAnswerFeedback'),
    cheatSheetModal: document.getElementById('cheatSheetModal'),
    cheatSheetList: document.getElementById('cheatSheetList'),
    closeCheatSheet: document.getElementById('closeCheatSheet'),
  };

  /* ============================================================
   * 진행 상태 저장
   * ========================================================== */
  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }
  function saveProgress() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      solved: Array.from(state.solved),
      lastProblemId: state.currentProblemId,
    }));
  }
  function markSolved(id) {
    if (state.solved.has(id)) return;
    state.solved.add(id);
    saveProgress();
    renderHeader();
    renderSidebar();
  }

  /* ============================================================
   * 렌더링
   * ========================================================== */
  function renderHeader() {
    el.solvedCount.textContent = `${state.solved.size} / ${PROBLEMS.length} 해결`;
  }

  function renderSidebar() {
    const problem = PROBLEMS_BY_ID[state.currentProblemId];
    const currentCat = problem ? problem.category : null;
    el.categoryList.innerHTML = '';
    DATA.CATEGORIES.forEach((cat) => {
      const catProblems = PROBLEMS.filter((p) => p.category === cat.id);
      const solvedInCat = catProblems.filter((p) => state.solved.has(p.id)).length;

      const details = document.createElement('details');
      details.className = 'category-block';
      if (cat.id === currentCat) details.open = true;

      const summary = document.createElement('summary');
      const catLabel = document.createElement('span');
      catLabel.textContent = `${cat.icon} ${cat.label}`;
      const catProgress = document.createElement('span');
      catProgress.className = 'cat-progress';
      catProgress.textContent = `${solvedInCat}/${catProblems.length}`;
      summary.appendChild(catLabel);
      summary.appendChild(catProgress);
      details.appendChild(summary);

      const ul = document.createElement('ul');
      ul.className = 'problem-list';
      catProblems.forEach((p) => {
        const li = document.createElement('li');
        const solved = state.solved.has(p.id);
        li.className = 'problem-item' + (solved ? ' done' : '') + (p.id === state.currentProblemId ? ' current' : '');
        li.dataset.id = p.id;
        const diff = DATA.DIFFICULTY_META[p.difficulty];
        const icon = document.createElement('span');
        icon.className = 'icon';
        icon.textContent = solved ? '✅' : '▶';
        const label = document.createElement('span');
        label.className = 'problem-label';
        label.textContent = p.title;
        const badge = document.createElement('span');
        badge.className = 'diff-badge diff-' + p.difficulty;
        badge.textContent = diff.stars;
        li.appendChild(icon);
        li.appendChild(label);
        li.appendChild(badge);
        li.addEventListener('click', () => {
          loadProblem(p.id);
          if (window.matchMedia('(max-width: 700px)').matches) {
            el.categoryListDetails.removeAttribute('open');
          }
        });
        ul.appendChild(li);
      });
      details.appendChild(ul);
      el.categoryList.appendChild(details);
    });

    if (problem) el.currentProblemLabel.textContent = '· ' + problem.title;
  }

  function renderProblemBrief(problem) {
    const diff = DATA.DIFFICULTY_META[problem.difficulty];
    el.problemTitle.innerHTML = '';
    const t = document.createElement('span');
    t.textContent = problem.title;
    const tag = document.createElement('span');
    tag.className = 'diff-tag diff-' + problem.difficulty;
    tag.textContent = `${diff.stars} ${diff.label}`;
    el.problemTitle.appendChild(t);
    el.problemTitle.appendChild(tag);
    el.problemScenario.textContent = problem.scenario;
    el.hintText.textContent = '';
    el.hintText.classList.add('hidden');
    el.conceptText.textContent = '';
    el.conceptText.classList.add('hidden');
    el.conceptBtn.classList.toggle('hidden', !problem.concept);
    state.hintIndex = 0;
    el.schemaPanel.classList.add('hidden');
  }

  function renderResultTable(container, result) {
    container.innerHTML = '';
    const countNote = document.createElement('div');
    countNote.className = 'result-count-note';
    countNote.textContent = `${result.values.length}행 × ${result.columns.length}열`;
    container.appendChild(countNote);

    const wrap = document.createElement('div');
    wrap.className = 'result-table-wrap';
    const table = document.createElement('table');
    table.className = 'result-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    result.columns.forEach((c) => {
      const th = document.createElement('th');
      th.textContent = c;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    result.values.slice(0, 200).forEach((row) => {
      const tr = document.createElement('tr');
      row.forEach((cell) => {
        const td = document.createElement('td');
        if (cell === null) { td.textContent = 'NULL'; td.className = 'cell-null'; }
        else td.textContent = String(cell);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    container.appendChild(wrap);
    if (result.values.length > 200) {
      const more = document.createElement('div');
      more.className = 'result-count-note';
      more.textContent = `(상위 200행만 표시, 실제로는 ${result.values.length}행)`;
      container.appendChild(more);
    }
  }

  function renderPlanArea(planText, problem, isInitial) {
    el.planArea.classList.remove('hidden');
    el.planArea.innerHTML = '';
    const labelDiv = document.createElement('div');
    labelDiv.className = 'box-label';
    labelDiv.textContent = isInitial ? '📋 현재 실행계획 (최적화 전)' : '📋 실행계획';
    let cls = '';
    if (!isInitial && (problem.requirePlanIncludes || problem.requirePlanExcludes)) {
      const upper = (planText || '').toUpperCase();
      const ok = (problem.requirePlanIncludes || []).every((f) => upper.includes(f.toUpperCase())) &&
        (problem.requirePlanExcludes || []).every((f) => !upper.includes(f.toUpperCase()));
      cls = ok ? 'plan-ok' : 'plan-warn';
    }
    const pre = document.createElement('pre');
    pre.className = 'plan-text ' + cls;
    pre.textContent = planText || '(실행계획 없음)';
    el.planArea.appendChild(labelDiv);
    el.planArea.appendChild(pre);
  }

  function renderSchemaPanel(schema) {
    el.schemaPanel.innerHTML = '';
    const labelDiv = document.createElement('div');
    labelDiv.className = 'schema-domain-label';
    labelDiv.textContent = '📦 도메인: ' + schema.label;
    el.schemaPanel.appendChild(labelDiv);

    schema.tables.forEach((t) => {
      const card = document.createElement('div');
      card.className = 'table-card';
      const header = document.createElement('div');
      header.className = 'table-card-header';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'table-name';
      nameSpan.textContent = t.name;
      const noteSpan = document.createElement('span');
      noteSpan.className = 'table-note';
      noteSpan.textContent = t.note || '';
      const previewBtn = document.createElement('button');
      previewBtn.className = 'preview-btn';
      previewBtn.textContent = '미리보기';
      header.appendChild(nameSpan);
      header.appendChild(noteSpan);
      header.appendChild(previewBtn);
      card.appendChild(header);

      const colList = document.createElement('div');
      colList.className = 'column-list';
      t.columns.forEach(([cname, ctype]) => {
        const row = document.createElement('div');
        row.className = 'column-row';
        const cn = document.createElement('span');
        cn.className = 'col-name';
        cn.textContent = cname;
        const ct = document.createElement('span');
        ct.className = 'col-type';
        ct.textContent = ctype;
        row.appendChild(cn);
        row.appendChild(ct);
        colList.appendChild(row);
      });
      card.appendChild(colList);

      const previewArea = document.createElement('div');
      previewArea.className = 'preview-area hidden';
      card.appendChild(previewArea);

      previewBtn.addEventListener('click', () => {
        if (!previewArea.classList.contains('hidden')) {
          previewArea.classList.add('hidden');
          previewBtn.textContent = '미리보기';
          return;
        }
        try {
          const res = runSqlReliable(state.db, `SELECT * FROM ${t.name} LIMIT 5`);
          previewArea.innerHTML = '';
          if (res) renderResultTable(previewArea, res);
          previewArea.classList.remove('hidden');
          previewBtn.textContent = '닫기';
        } catch (e) {
          previewArea.textContent = '미리보기 실패: ' + e.message;
          previewArea.classList.remove('hidden');
        }
      });

      el.schemaPanel.appendChild(card);
    });

    if (schema.relations && schema.relations.length) {
      const relBox = document.createElement('div');
      relBox.className = 'relations-box';
      const relLabel = document.createElement('div');
      relLabel.className = 'box-label';
      relLabel.textContent = '🔗 관계';
      relBox.appendChild(relLabel);
      schema.relations.forEach((r) => {
        const row = document.createElement('div');
        row.className = 'relation-row';
        row.textContent = r;
        relBox.appendChild(row);
      });
      el.schemaPanel.appendChild(relBox);
    }
  }

  /* ============================================================
   * 문제 로드 / 실행
   * ========================================================== */
  function loadProblem(id) {
    const problem = PROBLEMS_BY_ID[id];
    if (!problem) return;
    if (state.db) { state.db.close(); state.db = null; }

    state.currentProblemId = id;
    const schema = DATA.SCHEMAS[problem.schemaId];
    state.db = new state.SQL.Database();
    state.db.run(schema.ddl);
    if (problem.setupSql) state.db.run(problem.setupSql);

    state.cachedSolutionResult = null;
    if (problem.type === 'query' && !problem.skipResultCheck && problem.solutionSql) {
      const refDb = new state.SQL.Database();
      refDb.run(schema.ddl);
      if (problem.setupSql) refDb.run(problem.setupSql);
      try {
        state.cachedSolutionResult = runSqlReliable(refDb, problem.solutionSql);
      } catch (e) {
        console.error('solutionSql failed for', problem.id, e);
      }
      refDb.close();
    }

    state.initialPlanText = null;
    if (problem.targetQuery) {
      try { state.initialPlanText = getPlanText(state.db, problem.targetQuery); } catch (e) { state.initialPlanText = null; }
    }

    renderProblemBrief(problem);
    renderSchemaPanel(schema);

    if (state.cachedSolutionResult) {
      el.expectedColumns.textContent = '📋 정답 컬럼 (이 순서대로): ' + state.cachedSolutionResult.columns.join(', ') + '  ·  별칭(AS)은 달라도 됩니다';
      el.expectedColumns.classList.remove('hidden');
    } else {
      el.expectedColumns.classList.add('hidden');
    }

    if (problem.type === 'short-answer') {
      setupShortAnswer(problem);
    } else {
      setupQueryEditor(problem);
    }

    renderSidebar();
    saveProgress();
  }

  function setupQueryEditor(problem) {
    el.shortAnswerArea.classList.add('hidden');
    el.queryWorkArea.classList.remove('hidden');
    el.sqlEditor.value = problem.starterSql || '';
    el.resultArea.innerHTML = '';
    el.runStatus.textContent = '';
    el.runStatus.className = '';

    if (problem.targetQuery) {
      el.targetQueryBox.classList.remove('hidden');
      el.targetQueryText.textContent = problem.targetQuery;
    } else {
      el.targetQueryBox.classList.add('hidden');
    }

    if (problem.targetQuery && state.initialPlanText !== null) {
      renderPlanArea(state.initialPlanText, problem, true);
    } else {
      el.planArea.classList.add('hidden');
    }
  }

  function setupShortAnswer(problem) {
    el.queryWorkArea.classList.add('hidden');
    el.shortAnswerArea.classList.remove('hidden');
    el.shortAnswerQuestion.textContent = problem.question;
    el.shortAnswerInput.value = '';
    el.shortAnswerFeedback.textContent = '';
    el.shortAnswerFeedback.className = '';
    if (problem.targetQuery && state.initialPlanText !== null) {
      el.shortAnswerPlanBox.classList.remove('hidden');
      el.shortAnswerPlanText.textContent = state.initialPlanText;
    } else {
      el.shortAnswerPlanBox.classList.add('hidden');
    }
  }

  function handleRun() {
    const problem = PROBLEMS_BY_ID[state.currentProblemId];
    const sqlText = el.sqlEditor.value;
    el.resultArea.innerHTML = '';

    let result = null;
    let error = null;
    try {
      result = runSqlReliable(state.db, sqlText);
    } catch (e) {
      error = e.message;
    }

    if (error) {
      el.runStatus.textContent = '❌ ' + error;
      el.runStatus.className = 'status-error';
      return;
    }

    if (result) {
      renderResultTable(el.resultArea, result);
    } else {
      el.resultArea.innerHTML = '<div class="no-result-note">(결과 행이 없는 실행이었습니다 — DDL/인덱스 생성 등)</div>';
    }

    let passed = true;
    const reasons = [];
    let passNote = '';

    if (!problem.skipResultCheck && problem.solutionSql) {
      if (!state.cachedSolutionResult) {
        passed = false; reasons.push('기준 정답을 계산할 수 없습니다');
      } else {
        const cmp = compareResults(result, state.cachedSolutionResult, !!problem.orderMatters);
        if (!cmp.ok) { passed = false; reasons.push(cmp.reason || '결과가 정답과 다릅니다'); }
        else if (cmp.note) passNote = cmp.note;
      }
    }

    let planText = null;
    if (problem.requirePlanIncludes || problem.requirePlanExcludes) {
      const planSubject = problem.targetQuery || sqlText;
      try { planText = getPlanText(state.db, planSubject); } catch (e) { planText = null; }
      if (planText === null) {
        passed = false; reasons.push('실행계획을 확인할 수 없습니다');
      } else {
        const upper = planText.toUpperCase();
        (problem.requirePlanIncludes || []).forEach((frag) => {
          if (!upper.includes(frag.toUpperCase())) { passed = false; reasons.push(`실행계획에 "${frag}"가 보이지 않습니다`); }
        });
        (problem.requirePlanExcludes || []).forEach((frag) => {
          if (upper.includes(frag.toUpperCase())) { passed = false; reasons.push(`실행계획에 "${frag}"가 아직 남아있습니다`); }
        });
      }
    } else if (problem.targetQuery) {
      try { planText = getPlanText(state.db, problem.targetQuery); } catch (e) { planText = null; }
    }

    if (problem.requirePatterns) {
      problem.requirePatterns.forEach((re) => {
        if (!re.test(sqlText)) { passed = false; reasons.push('요구되는 구문이 쿼리에서 보이지 않습니다'); }
      });
    }

    if (planText !== null) {
      renderPlanArea(planText, problem, false);
    }

    if (passed) {
      el.runStatus.textContent = '✅ 정답입니다!' + (passNote ? ` (${passNote})` : '');
      el.runStatus.className = 'status-ok';
      markSolved(problem.id);
    } else {
      el.runStatus.textContent = '🤔 아직이에요: ' + reasons.join(' / ');
      el.runStatus.className = 'status-warn';
    }
  }

  function handleShortAnswerSubmit() {
    const problem = PROBLEMS_BY_ID[state.currentProblemId];
    const val = el.shortAnswerInput.value.trim().toLowerCase();
    if (!val) return;
    const accepted = (problem.acceptedAnswers || []).map((a) => a.trim().toLowerCase());
    const ok = accepted.some((a) => val === a || val.includes(a));
    if (ok) {
      el.shortAnswerFeedback.textContent = '✅ 정답입니다!';
      el.shortAnswerFeedback.className = 'status-ok';
      markSolved(problem.id);
    } else {
      el.shortAnswerFeedback.textContent = '🤔 다시 한 번 생각해보세요.';
      el.shortAnswerFeedback.className = 'status-warn';
    }
  }

  function renderCheatSheet() {
    el.cheatSheetList.innerHTML = '';
    const seen = new Set();
    PROBLEMS.forEach((p) => {
      if (!p.pattern || seen.has(p.pattern)) return;
      seen.add(p.pattern);
      const item = document.createElement('div');
      item.className = 'cheat-item';
      const cmd = document.createElement('div');
      cmd.className = 'cmd';
      cmd.textContent = p.pattern;
      const desc = document.createElement('div');
      desc.className = 'desc';
      desc.textContent = p.title;
      item.appendChild(cmd);
      item.appendChild(desc);
      el.cheatSheetList.appendChild(item);
    });
  }

  /* ============================================================
   * 이벤트 바인딩
   * ========================================================== */
  el.runBtn.addEventListener('click', handleRun);
  el.sqlEditor.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleRun();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const ta = el.sqlEditor;
      const start = ta.selectionStart, end = ta.selectionEnd;
      ta.value = ta.value.slice(0, start) + '  ' + ta.value.slice(end);
      ta.selectionStart = ta.selectionEnd = start + 2;
    }
  });

  el.shortAnswerSubmit.addEventListener('click', handleShortAnswerSubmit);
  el.shortAnswerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleShortAnswerSubmit(); }
  });

  el.hintBtn.addEventListener('click', () => {
    const p = PROBLEMS_BY_ID[state.currentProblemId];
    if (!p.hints || p.hints.length === 0) return;
    el.hintText.textContent = '💡 ' + p.hints[state.hintIndex];
    el.hintText.classList.remove('hidden');
    state.hintIndex = (state.hintIndex + 1) % p.hints.length;
  });

  el.conceptBtn.addEventListener('click', () => {
    const p = PROBLEMS_BY_ID[state.currentProblemId];
    if (!p.concept) return;
    el.conceptText.textContent = '📚 ' + p.concept;
    el.conceptText.classList.toggle('hidden');
  });

  el.schemaToggleBtn.addEventListener('click', () => {
    el.schemaPanel.classList.toggle('hidden');
  });

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
    if (saved) state.solved = new Set(saved.solved || []);

    initSqlJs({ wasmBinary: base64ToUint8Array(SQL_WASM_BASE64) }).then((SQL) => {
      state.SQL = SQL;
      el.loadingBanner.classList.add('hidden');
      el.problemBrief.classList.remove('hidden');
      const startId = (saved && saved.lastProblemId && PROBLEMS_BY_ID[saved.lastProblemId]) ? saved.lastProblemId : PROBLEMS[0].id;
      loadProblem(startId);
      renderHeader();
      if (window.matchMedia('(max-width: 700px)').matches) {
        el.categoryListDetails.removeAttribute('open');
      }
    }).catch((err) => {
      el.loadingBanner.textContent = '❌ SQL 엔진 로딩 실패: ' + err.message;
    });
  }

  init();
})();
