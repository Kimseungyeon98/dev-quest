/* 화면 조각 렌더링: ANSI → HTML, 마크다운(간이), 커밋 그래프, 작업공간/원격/기록 패널 */
(function () {
  'use strict';
  const G = globalThis.GitEngine;
  const U = G.util;
  const GP = globalThis.GP;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- 간이 마크다운 ---------- */
  function inline(t) {
    return esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }
  function md(text) {
    const out = [];
    let quote = [];
    const flush = () => { if (quote.length) { out.push('<blockquote>' + quote.map(inline).join('<br>') + '</blockquote>'); quote = []; } };
    text.split('\n').forEach((line) => {
      if (/^>\s?/.test(line)) { quote.push(line.replace(/^>\s?/, '')); return; }
      flush();
      if (line.trim() === '') { out.push('<div class="gap"></div>'); return; }
      out.push('<p>' + inline(line) + '</p>');
    });
    flush();
    return out.join('');
  }

  /* ---------- ANSI → HTML ---------- */
  const FG = { 30: 'k', 31: 'r', 32: 'g', 33: 'y', 34: 'b', 35: 'm', 36: 'c', 37: 'w', 90: 'gr', 91: 'r', 92: 'g', 93: 'y', 94: 'b', 95: 'm', 96: 'c', 97: 'w' };
  function ansiToHtml(text) {
    // 캐리지 리턴: 줄에서 마지막 \r 뒤의 내용만 남긴다
    const lines = text.split('\n').map((ln) => {
      if (ln.indexOf('\r') >= 0) { const parts = ln.split('\r'); let last = parts[parts.length - 1]; if (last === '' && parts.length > 1) last = parts[parts.length - 2]; return last; }
      return ln;
    });
    const s = lines.join('\n').replace(/\x1b\[K/g, '');
    let html = '';
    let open = false;
    let state = { bold: false, fg: null };
    const re = /\x1b\[([0-9;]*)m/g;
    let last = 0, m;
    const emit = (chunk) => { if (chunk) html += esc(chunk); };
    const openSpan = () => {
      if (open) { html += '</span>'; open = false; }
      const cls = [];
      if (state.bold) cls.push('b');
      if (state.fg) cls.push('c-' + state.fg);
      if (cls.length) { html += `<span class="${cls.join(' ')}">`; open = true; }
    };
    while ((m = re.exec(s))) {
      emit(s.slice(last, m.index));
      last = m.index + m[0].length;
      const codes = m[1] === '' ? [0] : m[1].split(';').map(Number);
      codes.forEach((c) => {
        if (c === 0) state = { bold: false, fg: null };
        else if (c === 1) state.bold = true;
        else if (FG[c]) state.fg = FG[c];
        else if (c === 39) state.fg = null;
        else if (c === 22) state.bold = false;
      });
      openSpan();
    }
    emit(s.slice(last));
    if (open) html += '</span>';
    return html;
  }

  /* ---------- 커밋 그래프 ---------- */
  const LANE_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f778ba', '#a371f7', '#39c5cf', '#ff7b72', '#79c0ff'];
  const ROW_H = 58, LANE_W = 22, PAD = 14;

  function collectCommits(repo, opts) {
    const tips = [];
    const head = repo.headCommit();
    if (head) tips.push(head);
    repo.refs.forEach((h, n) => { if (n === 'refs/stash') return; const c = repo.peelToCommit(h); if (c) tips.push(c); });
    let lost = new Set();
    if (opts.showLost) {
      const reach = repo.reachableFromAllRefs();
      repo.readReflog('HEAD').forEach((e) => { [e.new, e.old].forEach((h) => { if (h && /^[0-9a-f]{40}$/.test(h) && repo.commitObj(h) && !reach.has(h)) { tips.push(h); } }); });
      const reach2 = reach;
      repo.revWalk(Array.from(new Set(tips)), [], { order: 'date' }).forEach((h) => { if (!reach2.has(h)) lost.add(h); });
    }
    const list = tips.length ? repo.revWalk(Array.from(new Set(tips)), [], { order: 'topo' }) : [];
    return { list, lost };
  }

  function graphHtml(repo, opts) {
    opts = opts || {};
    if (!repo) return '<div class="empty">저장소가 아직 없어요.<br><code>git init</code> 으로 시작해 보세요.</div>';
    const limit = opts.limit || 40;
    const { list: all, lost } = collectCommits(repo, opts);
    if (!all.length) return '<div class="empty">아직 커밋이 없어요.<br>첫 커밋을 만들면 여기에 그래프가 그려져요.</div>';
    const list = all.slice(0, limit);
    const pos = new Map(list.map((h, i) => [h, i]));
    // 라벨
    const labels = new Map();
    const addLabel = (h, cls, text) => { if (!labels.has(h)) labels.set(h, []); labels.get(h).push({ cls, text }); };
    const cur = repo.headCommit();
    repo.refs.forEach((h, n) => {
      const c = repo.peelToCommit(h);
      if (!c) return;
      if (n.startsWith('refs/heads/')) { const bn = n.slice(11); if (repo.head.ref === n) addLabel(c, 'head', 'HEAD → ' + bn); else addLabel(c, 'branch', bn); } else if (n.startsWith('refs/remotes/')) addLabel(c, 'remote', n.slice(13));
      else if (n.startsWith('refs/tags/')) addLabel(c, 'tag', '🏷 ' + n.slice(10));
    });
    if (cur && !repo.head.ref) addLabel(cur, 'head', 'HEAD (detached)');
    const stash = repo.readRef('refs/stash');
    // 레인 배치
    const lanes = [];
    const rows = [];
    const edges = [];
    list.forEach((h, r) => {
      let lane = lanes.indexOf(h);
      if (lane < 0) { lane = lanes.indexOf(null); if (lane < 0) { lane = lanes.length; lanes.push(h); } else lanes[lane] = h; }
      const joining = [];
      lanes.forEach((x, i) => { if (x === h && i !== lane) { joining.push(i); lanes[i] = null; } });
      const c = repo.commitObj(h);
      const parents = c.parents;
      parents.forEach((p, k) => {
        let travel = lanes.indexOf(p);
        if (travel < 0) {
          if (k === 0) { travel = lane; lanes[lane] = p; } else { travel = lanes.indexOf(null); if (travel < 0) { travel = lanes.length; lanes.push(p); } else lanes[travel] = p; }
        } else if (k === 0 && travel !== lane) lanes[lane] = null;
        edges.push({ fromLane: lane, fromRow: r, parent: p, travel, color: k === 0 ? lane : travel });
      });
      if (!parents.length) lanes[lane] = null;
      rows.push({ h, lane, c });
    });
    const maxLane = Math.max(...rows.map((r) => r.lane), ...edges.map((e) => e.travel), 0);
    const W = PAD * 2 + maxLane * LANE_W;
    const H = list.length * ROW_H;
    const X = (l) => PAD + l * LANE_W;
    const Y = (r) => r * ROW_H + ROW_H / 2;
    let svg = `<svg class="gsvg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">`;
    edges.forEach((e) => {
      const pr = pos.has(e.parent) ? pos.get(e.parent) : null;
      const pl = pr !== null ? rows[pr].lane : e.travel;
      const x1 = X(e.fromLane), y1 = Y(e.fromRow), xt = X(e.travel);
      const col = LANE_COLORS[e.color % LANE_COLORS.length];
      const y2 = pr !== null ? Y(pr) : H;
      const x2 = X(pl);
      let d = `M${x1},${y1}`;
      if (x1 !== xt) d += ` C${x1},${y1 + ROW_H * 0.5} ${xt},${y1 + ROW_H * 0.3} ${xt},${y1 + ROW_H * 0.8}`;
      if (pr !== null && xt !== x2) { d += ` L${xt},${y2 - ROW_H * 0.8} C${xt},${y2 - ROW_H * 0.3} ${x2},${y2 - ROW_H * 0.5} ${x2},${y2}`; } else d += ` L${x2},${y2}`;
      svg += `<path d="${d}" stroke="${col}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    });
    rows.forEach((row, r) => {
      const col = LANE_COLORS[row.lane % LANE_COLORS.length];
      const isHead = row.h === cur;
      const isLost = lost.has(row.h);
      const merge = row.c.parents.length > 1;
      const fresh = opts.fresh && opts.fresh.has(row.h);
      if (fresh) svg += `<circle class="pulse" cx="${X(row.lane)}" cy="${Y(r)}" r="11" fill="none" stroke="${col}" stroke-width="2"/>`;
      svg += `<circle cx="${X(row.lane)}" cy="${Y(r)}" r="${isHead ? 8 : 6.5}" fill="${isLost ? 'var(--bg)' : (merge ? 'var(--bg)' : col)}" stroke="${isHead ? '#f0883e' : col}" stroke-width="${isHead ? 3 : 2.4}" ${isLost ? 'stroke-dasharray="3 2"' : ''}/>`;
    });
    svg += '</svg>';
    let rowsHtml = '';
    rows.forEach((row) => {
      const chips = (labels.get(row.h) || []).sort((a, b) => ({ head: 0, branch: 1, remote: 2, tag: 3 }[a.cls] - { head: 0, branch: 1, remote: 2, tag: 3 }[b.cls])).map((l) => `<span class="gl gl-${l.cls}">${esc(l.text)}</span>`).join('');
      const stashChip = stash && row.h === stash ? '<span class="gl gl-stash">stash</span>' : '';
      const lostChip = lost.has(row.h) ? '<span class="gl gl-lost">길 잃은 커밋</span>' : '';
      const c = row.c;
      const fresh = opts.fresh && opts.fresh.has(row.h) ? ' fresh' : '';
      rowsHtml += `<div class="grow${fresh}${lost.has(row.h) ? ' lost' : ''}" data-hash="${row.h}" style="height:${ROW_H}px"><div class="gl-line">${chips}${stashChip}${lostChip}</div><div class="gmsg"><code class="gh">${row.h.slice(0, 7)}</code> <span class="gs">${esc(U.subjectOf(c.message))}</span></div><div class="gauth">${esc(c.author.name)}</div></div>`;
    });
    const more = all.length > limit ? `<div class="gmore">… 오래된 커밋 ${all.length - limit}개는 생략했어요</div>` : '';
    return `<div class="graph-wrap"><div class="graph-body"><div class="graph-svg" style="width:${W}px">${svg}</div><div class="graph-rows" style="margin-left:${W + 4}px">${rowsHtml}</div></div>${more}</div>`;
  }

  /* ---------- 작업공간 ---------- */
  const STATUS_LABEL = { M: ['수정됨', 'mod'], A: ['새 파일', 'add'], D: ['삭제됨', 'del'], R: ['이름 변경', 'ren'] };
  function filesHtml(lab) {
    const repo = lab.repo();
    if (!repo) return '<div class="empty">저장소가 없어요. <code>git init</code> 을 실행해 보세요.</div>';
    const st = U.computeStatus(repo, {});
    const fileBtn = (p, cls, tag) => `<button class="file ${cls}" data-file="${esc(p)}"><i>${tag}</i><span>${esc(p)}</span></button>`;
    const un = st.unmerged.map((u) => fileBtn(u.path, 'conf', 'U')).join('');
    const unstaged = st.unstaged.map((c) => fileBtn(c.path, c.status === 'D' ? 'del' : 'mod', c.status)).join('');
    const untracked = st.untracked.map((p) => fileBtn(p, 'new', '?')).join('');
    const staged = st.staged.map((c) => fileBtn(c.path, STATUS_LABEL[c.status][1], c.status === 'R' ? 'R' : c.status)).join('');
    const headFlat = repo.headFlat();
    const tracked = Array.from(repo.index.keys()).sort();
    const clean = tracked.filter((p) => !st.staged.some((c) => c.path === p) && !st.unstaged.some((c) => c.path === p));
    const state = [];
    if (repo.state.merge) state.push('🔀 병합 진행 중 (충돌 해결 후 git commit)');
    if (repo.state.rebase) state.push('🏗 rebase 진행 중 (git rebase --continue / --abort)');
    if (repo.state.cherryPick) state.push('🍒 cherry-pick 진행 중');
    if (repo.state.revert) state.push('⏪ revert 진행 중');
    if (repo.state.bisect) state.push('🧬 bisect 진행 중 (git bisect reset 으로 종료)');
    const stashList = repo.readReflog('refs/stash').slice().reverse();
    return `
      ${state.length ? `<div class="state-banner">${state.join('<br>')}</div>` : ''}
      <div class="zones">
        <div class="zone zone-wd"><h4>작업 폴더 <small>Working Directory</small></h4>
          <div class="zone-body">${un}${unstaged}${untracked || ''}${!un && !unstaged && !untracked ? '<div class="muted">변경 없음 ✓</div>' : ''}</div></div>
        <div class="arrow">git add ➜</div>
        <div class="zone zone-idx"><h4>스테이징 <small>Staging Area</small></h4>
          <div class="zone-body">${staged || '<div class="muted">비어 있음</div>'}</div></div>
        <div class="arrow">git commit ➜</div>
        <div class="zone zone-repo"><h4>저장소 <small>HEAD</small></h4>
          <div class="zone-body"><div class="muted">${headFlat.size}개 파일 추적 중</div>
          <div class="tree">${Array.from(headFlat.keys()).sort().slice(0, 30).map((p) => `<button class="file clean" data-file="${esc(p)}"><i>·</i><span>${esc(p)}</span></button>`).join('')}</div></div></div>
      </div>
      <div class="legend"><span><i class="mod">M</i> 수정</span><span><i class="new">?</i> 새 파일(추적 안 됨)</span><span><i class="add">A</i> 추가</span><span><i class="del">D</i> 삭제</span><span><i class="conf">U</i> 충돌</span> <em>파일을 누르면 내용을 보고 편집할 수 있어요</em></div>
      ${stashList.length ? `<h4 class="sub">📦 Stash</h4><div class="stash">${stashList.map((e, i) => `<div><code>stash@{${i}}</code> ${esc(e.msg)}</div>`).join('')}</div>` : ''}
      <details class="clean-list"><summary>변경 없는 추적 파일 ${clean.length}개</summary>${clean.map((p) => `<button class="file clean" data-file="${esc(p)}"><i>·</i><span>${esc(p)}</span></button>`).join('')}</details>`;
  }

  /* ---------- 원격 ---------- */
  function remoteHtml(lab) {
    const repo = lab.repo();
    const names = repo ? Array.from(repo.config.keys()).map((k) => (k.match(/^remote\.([^.]+)\.url$/) || [])[1]).filter(Boolean) : [];
    let html = '';
    if (!names.length) html += '<div class="empty">연결된 원격이 없어요.<br><code>git remote add origin &lt;URL&gt;</code></div>';
    names.forEach((n) => {
      const url = repo.config.get(`remote.${n}.url`);
      const rr = lab.sim.net.get(url);
      html += `<div class="remote-card"><div class="remote-head"><strong>${esc(n)}</strong> <code>${esc(url)}</code></div>`;
      if (!rr) html += '<div class="muted">접근할 수 없는 저장소 (URL 확인)</div>';
      else {
        const branches = rr.branches();
        if (!branches.length) html += '<div class="muted">비어 있는 저장소</div>';
        branches.forEach(([b, h]) => {
          const c = rr.commitObj(h);
          const prot = rr.protectedBranches && rr.protectedBranches.has(b) ? ' 🔒' : '';
          const lh = repo.readRef('refs/heads/' + b);
          let badge = '';
          if (lh) {
            if (lh === h) badge = '<span class="badge ok">동기화됨</span>';
            else if (repo.has(h)) { const ab = U.aheadBehind(repo, lh, h); badge = `<span class="badge ${ab.behind ? 'warn' : 'info'}">${ab.ahead ? '내가 ' + ab.ahead + '개 앞섬 ' : ''}${ab.behind ? '내가 ' + ab.behind + '개 뒤처짐' : ''}</span>`; } else badge = '<span class="badge warn">내가 모르는 커밋 있음 (fetch 필요)</span>';
          }
          html += `<div class="rbranch"><span class="rb-name">${esc(b)}${prot}</span> <code>${h.slice(0, 7)}</code> <span class="rb-msg">${esc(c ? U.subjectOf(c.message) : '')}</span> ${badge}</div>`;
        });
        const tags = rr.listRefs('refs/tags/');
        if (tags.length) html += `<div class="rtags">${tags.map(([t]) => `<span class="gl gl-tag">🏷 ${esc(t.slice(10))}</span>`).join('')}</div>`;
      }
      html += '</div>';
    });
    const actors = Object.keys(lab.actors).filter((a) => lab.actorRepo(a));
    if (actors.length && names.length) {
      html += '<div class="team"><h4>👥 팀원 행동 시뮬레이션</h4><div class="team-note">팀원이 원격에 변경을 올리면 내 로컬은 뒤처져요. 직접 만들어 보면서 pull / push 를 연습해 보세요.</div>';
      actors.forEach((a) => {
        const who = GP.PEOPLE[a];
        html += `<div class="team-row"><span>🧑‍💻 ${esc(who ? who.name : a)}</span><button class="mini-btn" data-team="push" data-actor="${a}">새 커밋 push</button><button class="mini-btn" data-team="readme" data-actor="${a}">README 수정 push</button></div>`;
      });
      html += '</div>';
    }
    return html;
  }

  /* ---------- 기록 ---------- */
  function logHtml(lab) {
    const repo = lab.repo();
    if (!repo) return '<div class="empty">저장소가 없어요.</div>';
    const log = repo.readReflog('HEAD').slice().reverse().slice(0, 25);
    const info = [];
    const cur = repo.currentBranch();
    info.push(`<div class="kv"><span>HEAD</span><b>${cur ? '브랜치 ' + esc(cur) : '분리됨 (detached)'}</b></div>`);
    if (cur) {
      const ab = repo.upstreamRef(cur) ? U.trackingMessage({ paint: (a, t) => t }, repo, cur) : null;
      info.push(`<div class="kv"><span>upstream</span><b>${repo.upstreamName(cur) ? esc(repo.upstreamName(cur)) : '없음'}</b></div>`);
      if (ab && ab.text) info.push(`<div class="kv wide"><span></span><em>${esc(ab.text.split('\n')[0])}</em></div>`);
    }
    return `<div class="kvs">${info.join('')}</div>
      <h4 class="sub">🕑 reflog (HEAD 가 움직인 기록)</h4>
      <div class="reflog">${log.length ? log.map((e, i) => `<div class="rl"><code>HEAD@{${i}}</code> <code class="gh">${e.new.slice(0, 7)}</code> <span>${esc(e.msg)}</span></div>`).join('') : '<div class="muted">아직 기록이 없어요</div>'}</div>
      <div class="muted small">reflog 는 reset·rebase 로 사라진 커밋을 되찾는 마지막 보험이에요.</div>`;
  }

  globalThis.GPUI = { esc, md, ansiToHtml, graphHtml, filesHtml, remoteHtml, logHtml };
})();
