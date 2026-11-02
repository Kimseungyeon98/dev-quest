/* git 명령어 공통 유틸: Ctx, 인자 파서, 색상, diff/stat, status, 날짜, pretty format */
(function () {
  'use strict';
  const G = (globalThis.GitEngine = globalThis.GitEngine || {});
  const { Diff, sha1, GitError, ZERO } = G;

  class NeedInput extends Error {
    constructor(kind, payload, index) { super('need input'); this.kind = kind; this.payload = payload; this.index = index; }
  }

  const ANSI = {
    reset: '0', bold: '1', red: '31', green: '32', yellow: '33', blue: '34', magenta: '35', cyan: '36',
    boldred: '1;31', boldgreen: '1;32', boldyellow: '1;33', boldblue: '1;34', boldmagenta: '1;35', boldcyan: '1;36', dim: '2',
  };

  function die(msg, code) { return new GitError('fatal: ' + msg, code === undefined ? 128 : code); }
  function fail(text, code) { return new GitError(text, code === undefined ? 1 : code); }

  /* ---------------- 실행 컨텍스트 ---------------- */
  class Ctx {
    constructor(sim, repo, opts) {
      opts = opts || {};
      this.sim = sim;
      this.repo = repo;
      this.out = [];
      this.color = sim.color && !opts.noColor;
      this.inputs = opts.inputs || [];
      this.inputIndex = 0;
      this.cmdName = '';
      this.actor = opts.actor || null; // 팀원 등 다른 사람 신원
      this.session = opts.session || { globalConfig: sim.globalConfig };
    }
    print(t) { if (t) this.out.push({ s: 'out', t }); }
    eprint(t) { if (t) this.out.push({ s: 'err', t }); }
    paint(name, text) {
      if (!this.color || !text) return text;
      return `\x1b[${ANSI[name] || name}m${text}\x1b[m`;
    }
    get now() { return this.sim.clock; }
    cfg(key) {
      const v = this.repo ? this.repo.getConfig(key) : undefined;
      if (v !== undefined) return v;
      return this.session.globalConfig.get(key);
    }
    ident(kind) {
      const name = this.cfg('user.name');
      const email = this.cfg('user.email');
      if (!name || !email) {
        throw new GitError([
          'Author identity unknown',
          '',
          '*** Please tell me who you are.',
          '',
          'Run',
          '',
          '  git config --global user.email "you@example.com"',
          '  git config --global user.name "Your Name"',
          '',
          "to set your account's default identity.",
          'Omit --global to set the identity only in this repository.',
          '',
          !email ? `fatal: unable to auto-detect email address (got '${this.sim.username}@${this.sim.hostname}.(none)')` : 'fatal: empty ident name (for <' + email + '>) not allowed',
        ].join('\n'), 128);
      }
      return { name, email, ts: this.now, tz: this.sim.tz };
    }
    input(kind, payload) {
      if (this.sim.inputProvider) {
        const v = this.sim.inputProvider(kind, payload);
        if (v !== undefined && v !== null) return v;
      }
      if (this.inputIndex < this.inputs.length) return this.inputs[this.inputIndex++];
      throw new NeedInput(kind, payload, this.inputIndex);
    }
    /* 한 줄 프롬프트(git add -p 등): 안내문을 출력하고 답을 받는다 */
    prompt(text) {
      const since = this.out.slice(this._pi || 0).map((o) => o.t).join('');
      this.print(text);
      const ans = this.input('prompt', { text, since });
      this.print(ans + '\n');
      this._pi = this.out.length;
      return ans;
    }
  }

  /* ---------------- 인자 파서 ---------------- */
  /* spec: { flags: {'-a':'all','--all':'all'}, opts: {'-m':'message','--message':'message'}, numeric: 'n' } */
  function parseArgs(args, spec, cmdName, usage) {
    const f = {};
    const o = {};
    const rest = [];
    let dd = null;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (dd) { dd.push(a); continue; }
      if (a === '--') { dd = []; continue; }
      if (a.startsWith('--')) {
        const eq = a.indexOf('=');
        const name = eq >= 0 ? a.slice(0, eq) : a;
        const val = eq >= 0 ? a.slice(eq + 1) : null;
        if (spec.flags && spec.flags[name] !== undefined) { f[spec.flags[name]] = true; continue; }
        if (spec.opts && spec.opts[name] !== undefined) {
          const key = spec.opts[name];
          let v = val;
          if (v === null) { i++; v = args[i]; if (v === undefined) throw fail(`error: option \`${name.slice(2)}' requires a value`, 129); }
          (o[key] = o[key] || []).push(v);
          continue;
        }
        if (spec.optional && spec.optional[name] !== undefined) {
          const key = spec.optional[name];
          (o[key] = o[key] || []).push(val === null ? '' : val);
          continue;
        }
        throw fail(`error: unknown option \`${a.slice(2).split('=')[0]}'\n${usage || 'usage: git ' + cmdName + ' [<options>]'}`, 129);
      }
      if (a.length > 1 && a[0] === '-' && !/^-\d+$/.test(a)) {
        let j = 1;
        let consumed = false;
        while (j < a.length) {
          const ch = '-' + a[j];
          if (spec.flags && spec.flags[ch] !== undefined) { f[spec.flags[ch]] = true; j++; continue; }
          if (spec.opts && spec.opts[ch] !== undefined) {
            const key = spec.opts[ch];
            let v = a.slice(j + 1);
            if (v === '') { i++; v = args[i]; if (v === undefined) throw fail(`error: switch \`${a[j]}' requires a value`, 129); }
            (o[key] = o[key] || []).push(v);
            consumed = true;
            break;
          }
          if (spec.optional && spec.optional[ch] !== undefined) {
            (o[spec.optional[ch]] = o[spec.optional[ch]] || []).push(a.slice(j + 1));
            consumed = true;
            break;
          }
          if (spec.numericAfter && /\d/.test(a[j])) { /* -U3 같은 경우는 opts 에서 처리 */ }
          throw fail(`error: unknown switch \`${a[j]}'\n${usage || 'usage: git ' + cmdName + ' [<options>]'}`, 129);
        }
        void consumed;
        continue;
      }
      if (/^-\d+$/.test(a) && spec.numeric) { o[spec.numeric] = [a.slice(1)]; continue; }
      rest.push(a);
    }
    return { f, o, rest, dd: dd || [], hasDD: dd !== null };
  }

  /* ---------------- 날짜 ---------------- */
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function tzOffsetSec(tz) {
    const m = String(tz).match(/^([+-])(\d\d)(\d\d)$/);
    if (!m) return 0;
    return (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 3600 + parseInt(m[3], 10) * 60);
  }
  function p2(n) { return String(n).padStart(2, '0'); }
  function formatDate(ts, tz, style, now) {
    const d = new Date((ts + tzOffsetSec(tz)) * 1000);
    const Y = d.getUTCFullYear(), Mo = d.getUTCMonth(), D = d.getUTCDate();
    const hh = p2(d.getUTCHours()), mm = p2(d.getUTCMinutes()), ss = p2(d.getUTCSeconds());
    switch (style) {
      case 'iso': case 'iso8601': return `${Y}-${p2(Mo + 1)}-${p2(D)} ${hh}:${mm}:${ss} ${tz}`;
      case 'iso-strict': return `${Y}-${p2(Mo + 1)}-${p2(D)}T${hh}:${mm}:${ss}${tz.slice(0, 3)}:${tz.slice(3)}`;
      case 'short': return `${Y}-${p2(Mo + 1)}-${p2(D)}`;
      case 'raw': return `${ts} ${tz}`;
      case 'unix': return String(ts);
      case 'relative': return relativeDate(now - ts);
      case 'format-local': return `${Y}-${p2(Mo + 1)}-${p2(D)}`;
      default: return `${DAYS[d.getUTCDay()]} ${MONTHS[Mo]} ${D} ${hh}:${mm}:${ss} ${Y} ${tz}`;
    }
  }
  function relativeDate(diff) {
    if (diff < 0) diff = 0;
    if (diff < 90) return `${diff} second${diff === 1 ? '' : 's'} ago`;
    let v = Math.floor((diff + 30) / 60);
    if (v < 90) return `${v} minute${v === 1 ? '' : 's'} ago`;
    v = Math.floor((v + 30) / 60);
    if (v < 36) return `${v} hour${v === 1 ? '' : 's'} ago`;
    let days = Math.floor((v + 12) / 24);
    if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
    if (days < 70) { const w = Math.floor((days + 3) / 7); return `${w} week${w === 1 ? '' : 's'} ago`; }
    if (days < 365) { const mo = Math.floor((days + 15) / 30); return `${mo} month${mo === 1 ? '' : 's'} ago`; }
    if (days < 1825) {
      const totalMonths = Math.floor((days * 12 * 2 + 365) / (365 * 2));
      const years = Math.floor(totalMonths / 12);
      const months = totalMonths % 12;
      if (months) return `${years} year${years === 1 ? '' : 's'}, ${months} month${months === 1 ? '' : 's'} ago`;
      return `${years} year${years === 1 ? '' : 's'} ago`;
    }
    const y = Math.floor((days + 183) / 365);
    return `${y} years ago`;
  }

  /* ---------------- 파일 내용 / diff ---------------- */
  function isBinary(content) { return content.indexOf('\0') >= 0; }
  function contentOf(repo, e) { return e.content !== undefined ? e.content : repo.blobContent(e.hash); }
  function hashOfEntry(repo, e) {
    if (e.hash) return e.hash;
    e.hash = sha1.hashObject('blob', e.content);
    return e.hash;
  }

  function sortedPaths(a, b) {
    const s = new Set();
    a.forEach((_, k) => s.add(k));
    b.forEach((_, k) => s.add(k));
    return Array.from(s).sort();
  }

  /* 두 파일 맵(path→{hash|content, mode})의 변경 목록 (rename 감지 포함) */
  function diffMaps(repo, aMap, bMap, opts) {
    opts = opts || {};
    const changes = [];
    sortedPaths(aMap, bMap).forEach((p) => {
      if (opts.filter && !opts.filter(p)) return;
      const a = aMap.get(p), b = bMap.get(p);
      if (a && b) {
        if (hashOfEntry(repo, a) !== hashOfEntry(repo, b) || a.mode !== b.mode) changes.push({ path: p, status: 'M', a, b });
      } else if (a) changes.push({ path: p, status: 'D', a, b: null });
      else changes.push({ path: p, status: 'A', a: null, b });
    });
    if (opts.renames !== false) detectRenames(repo, changes);
    return changes;
  }

  function detectRenames(repo, changes) {
    const dels = changes.filter((c) => c.status === 'D');
    const adds = changes.filter((c) => c.status === 'A');
    if (!dels.length || !adds.length) return;
    const usedD = new Set(), usedA = new Set();
    const pairs = [];
    // 완전 일치
    adds.forEach((ad) => {
      let best = null;
      dels.forEach((dl) => {
        if (usedD.has(dl)) return;
        if (hashOfEntry(repo, dl.a) === hashOfEntry(repo, ad.b)) {
          const bn1 = dl.path.split('/').pop(), bn2 = ad.path.split('/').pop();
          const score = bn1 === bn2 ? 1 : 0;
          if (!best || score > best.score) best = { dl, score };
        }
      });
      if (best) { usedD.add(best.dl); usedA.add(ad); pairs.push({ dl: best.dl, ad, sim: 60000 }); }
    });
    // 유사도 기반
    const cand = [];
    adds.forEach((ad) => {
      if (usedA.has(ad)) return;
      dels.forEach((dl) => {
        if (usedD.has(dl)) return;
        const ca = contentOf(repo, dl.a), cb = contentOf(repo, ad.b);
        if (isBinary(ca) || isBinary(cb)) return;
        const sc = Diff.similarityScore(ca, cb);
        if (sc >= 30000) cand.push({ dl, ad, sim: sc });
      });
    });
    cand.sort((x, y) => y.sim - x.sim || (x.ad.path < y.ad.path ? -1 : 1) || (x.dl.path < y.dl.path ? -1 : 1));
    cand.forEach((c) => {
      if (usedD.has(c.dl) || usedA.has(c.ad)) return;
      usedD.add(c.dl); usedA.add(c.ad); pairs.push(c);
    });
    pairs.forEach((p) => {
      p.dl.removed = true;
      p.ad.status = 'R';
      p.ad.oldPath = p.dl.path;
      p.ad.a = p.dl.a;
      p.ad.similarity = Math.floor(p.sim * 100 / 60000);
    });
    for (let i = changes.length - 1; i >= 0; i--) if (changes[i].removed) changes.splice(i, 1);
    changes.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  }

  /* 변경 하나를 git diff 형식의 문자열로 */
  function renderPatch(repo, ch, opts) {
    opts = opts || {};
    const ctxLines = opts.context === undefined ? 3 : opts.context;
    const abbrev = (e) => (e ? repo.shortHash(hashOfEntry(repo, e), 7) : '0000000');
    const aName = ch.status === 'R' ? ch.oldPath : ch.path;
    let s = `diff --git a/${aName} b/${ch.path}\n`;
    const aE = ch.a, bE = ch.b;
    const aC = aE ? contentOf(repo, aE) : '';
    const bC = bE ? contentOf(repo, bE) : '';
    if (ch.status === 'R') {
      s += `similarity index ${ch.similarity}%\nrename from ${ch.oldPath}\nrename to ${ch.path}\n`;
      if (ch.similarity === 100) return s;
      s += `index ${abbrev(aE)}..${abbrev(bE)}${aE.mode === bE.mode ? ' ' + bE.mode : ''}\n`;
    } else if (ch.status === 'A') s += `new file mode ${bE.mode || '100644'}\nindex 0000000..${abbrev(bE)}\n`;
    else if (ch.status === 'D') s += `deleted file mode ${aE.mode || '100644'}\nindex ${abbrev(aE)}..0000000\n`;
    else s += `index ${abbrev(aE)}..${abbrev(bE)} ${bE.mode || '100644'}\n`;
    if (isBinary(aC) || isBinary(bC)) {
      s += `Binary files ${ch.status === 'A' ? '/dev/null' : 'a/' + aName} and ${ch.status === 'D' ? '/dev/null' : 'b/' + ch.path} differ\n`;
      return s;
    }
    if (aC === bC) return s;
    s += `--- ${ch.status === 'A' ? '/dev/null' : 'a/' + aName}\n`;
    s += `+++ ${ch.status === 'D' ? '/dev/null' : 'b/' + ch.path}\n`;
    s += Diff.unifiedBody(Diff.splitLines(aC), Diff.splitLines(bC), ctxLines);
    return s;
  }

  function colorizePatch(ctx, text) {
    if (!ctx.color) return text;
    return text.split('\n').map((l) => {
      if (l === '') return l;
      if (/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename from|rename to|old mode|new mode)/.test(l)) return ctx.paint('bold', l);
      if (l.startsWith('@@')) {
        const m = l.match(/^(@@ [^@]*@@)(.*)$/);
        return m ? ctx.paint('cyan', m[1]) + m[2] : l;
      }
      if (l.startsWith('+')) return ctx.paint('green', l);
      if (l.startsWith('-')) return ctx.paint('red', l);
      return l;
    }).join('\n');
  }

  function changeCounts(repo, ch) {
    const aC = ch.a ? contentOf(repo, ch.a) : '';
    const bC = ch.b ? contentOf(repo, ch.b) : '';
    if (isBinary(aC) || isBinary(bC)) return { added: 0, deleted: 0, binary: true };
    const c = Diff.countChanges(Diff.diffBlocks(Diff.splitLines(aC), Diff.splitLines(bC)));
    return { added: c.added, deleted: c.deleted, binary: false };
  }

  function renameLabel(oldP, newP) {
    // git 의 pprint_rename: 공통 접두/접미를 {a => b} 로 묶는다
    let pfx = 0;
    const lastSlash = (s, upto) => s.slice(0, upto).lastIndexOf('/');
    let i = 0;
    while (i < oldP.length && i < newP.length && oldP[i] === newP[i]) i++;
    pfx = lastSlash(oldP, i) + 1; // 공통 디렉터리 접두 길이
    if (pfx > 0 && oldP.slice(0, pfx) !== newP.slice(0, pfx)) pfx = 0;
    let sfx = 0;
    let a = oldP.length, b = newP.length;
    while (a > pfx && b > pfx && oldP[a - 1] === newP[b - 1]) { a--; b--; }
    // 접미는 '/' 경계에서만
    let suffixStart = oldP.length;
    const oSuffix = oldP.slice(a), nSuffix = newP.slice(b);
    void nSuffix;
    const slashIdx = oSuffix.indexOf('/');
    if (slashIdx >= 0) sfx = oSuffix.length - slashIdx; else sfx = 0;
    suffixStart = oldP.length - sfx;
    const nSuffixStart = newP.length - sfx;
    const mid1 = oldP.slice(pfx, Math.max(suffixStart, pfx));
    const mid2 = newP.slice(pfx, Math.max(nSuffixStart, pfx));
    if (pfx === 0 && sfx === 0) return `${oldP} => ${newP}`;
    return `${oldP.slice(0, pfx)}{${mid1} => ${mid2}}${oldP.slice(Math.max(suffixStart, pfx))}`;
  }

  function diffStatText(repo, changes, opts) {
    const files = changes.map((ch) => {
      const c = changeCounts(repo, ch);
      return { name: ch.status === 'R' ? renameLabel(ch.oldPath, ch.path) : ch.path, added: c.added, deleted: c.deleted, binary: c.binary };
    });
    return Diff.formatStat(files, opts);
  }

  function summaryLines(repo, changes) {
    let s = '';
    changes.forEach((ch) => {
      if (ch.status === 'A') s += ` create mode ${ch.b.mode || '100644'} ${ch.path}\n`;
      else if (ch.status === 'D') s += ` delete mode ${ch.a.mode || '100644'} ${ch.path}\n`;
      else if (ch.status === 'R') s += ` rename ${renameLabel(ch.oldPath, ch.path)} (${ch.similarity}%)\n`;
    });
    return s;
  }

  /* ---------------- 작업 트리 → 맵 ---------------- */
  function workMap(repo, filter) {
    const m = new Map();
    repo.work.forEach((content, p) => { if (!filter || filter(p)) m.set(p, { content, mode: (repo.index.get(p) || {}).mode || '100644' }); });
    return m;
  }
  function indexMap(repo, filter) {
    const m = new Map();
    repo.index.forEach((e, p) => { if (!filter || filter(p)) m.set(p, { hash: e.hash, mode: e.mode }); });
    return m;
  }

  /* ---------------- status ---------------- */
  function computeStatus(repo, opts) {
    opts = opts || {};
    const H = repo.headFlat();
    const staged = [];
    sortedPaths(H, repo.index).forEach((p) => {
      if (repo.unmerged.has(p)) return;
      const h = H.get(p), i = repo.index.get(p);
      if (!h && i) staged.push({ path: p, status: 'A', a: null, b: { hash: i.hash, mode: i.mode } });
      else if (h && !i) staged.push({ path: p, status: 'D', a: h, b: null });
      else if (h.hash !== i.hash) staged.push({ path: p, status: 'M', a: h, b: { hash: i.hash, mode: i.mode } });
    });
    detectRenames(repo, staged);
    const unstaged = [];
    Array.from(repo.index.keys()).sort().forEach((p) => {
      if (repo.unmerged.has(p)) return;
      const i = repo.index.get(p);
      const w = repo.work.get(p);
      if (w === undefined) unstaged.push({ path: p, status: 'D' });
      else if (sha1.hashObject('blob', w) !== i.hash) unstaged.push({ path: p, status: 'M' });
    });
    // 충돌 파일의 작업 트리 상태는 unmerged 로만 보고
    const unmerged = [];
    Array.from(repo.unmerged.keys()).sort().forEach((p) => {
      const st = repo.unmerged.get(p);
      const key = (st[1] ? '1' : '') + (st[2] ? '2' : '') + (st[3] ? '3' : '');
      unmerged.push({ path: p, key });
    });
    // untracked
    const rules = repo.ignoreRules();
    const trackedDirs = new Set();
    const addTracked = (p) => { const parts = p.split('/'); for (let k = 1; k < parts.length; k++) trackedDirs.add(parts.slice(0, k).join('/')); };
    repo.index.forEach((_, p) => addTracked(p));
    repo.unmerged.forEach((_, p) => addTracked(p));
    const untracked = new Set();
    const ignored = new Set();
    Array.from(repo.work.keys()).sort().forEach((p) => {
      if (repo.index.has(p) || repo.unmerged.has(p)) return;
      if (repo.isIgnored(p, rules)) { ignored.add(p); return; }
      if (opts.untrackedAll) { untracked.add(p); return; }
      const parts = p.split('/');
      let reported = null;
      for (let k = 1; k < parts.length; k++) {
        const dir = parts.slice(0, k).join('/');
        if (!trackedDirs.has(dir)) { reported = dir + '/'; break; }
      }
      untracked.add(reported || p);
    });
    return { staged, unstaged, unmerged, untracked: Array.from(untracked).sort(), ignored: Array.from(ignored).sort() };
  }

  const UNMERGED_LABELS = {
    '123': 'both modified:', '23': 'both added:', '12': 'deleted by them:', '13': 'deleted by us:',
    '2': 'added by us:', '3': 'added by them:', '1': 'both deleted:',
  };
  // key 는 존재하는 stage 조합. 1,2,3 → 양쪽 수정 / 2,3 → 양쪽 추가 / 1,3 → 우리쪽 삭제 / 1,2 → 그쪽 삭제
  function unmergedLabel(key) {
    return UNMERGED_LABELS[key] || 'unmerged:';
  }
  const SHORT_UNMERGED = { '123': 'UU', '23': 'AA', '12': 'UD', '13': 'DU', '2': 'AU', '3': 'UA', '1': 'DD' };

  /* ahead/behind 계산 */
  function aheadBehind(repo, local, remote) {
    const lAnc = repo.ancestors(local), rAnc = repo.ancestors(remote);
    let ahead = 0, behind = 0;
    lAnc.forEach((h) => { if (!rAnc.has(h)) ahead++; });
    rAnc.forEach((h) => { if (!lAnc.has(h)) behind++; });
    return { ahead, behind };
  }

  function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

  function trackingMessage(ctx, repo, branch, opts) {
    opts = opts || {};
    const upRef = repo.upstreamRef(branch);
    if (!upRef) return null;
    const upName = upRef.replace(/^refs\/remotes\//, '');
    const upHash = repo.readRef(upRef);
    const local = repo.readRef('refs/heads/' + branch);
    if (!upHash) {
      return { text: `Your branch is based on '${upName}', but the upstream is gone.\n  (use "git branch --unset-upstream" to fixup)\n`, kind: 'gone', upName };
    }
    if (!local) return null;
    const { ahead, behind } = aheadBehind(repo, local, upHash);
    if (!ahead && !behind) return { text: `Your branch is up to date with '${upName}'.\n`, kind: 'same', upName, ahead, behind };
    if (ahead && !behind) return { text: `Your branch is ahead of '${upName}' by ${plural(ahead, 'commit')}.\n  (use "git push" to publish your local commits)\n`, kind: 'ahead', upName, ahead, behind };
    if (!ahead && behind) return { text: `Your branch is behind '${upName}' by ${plural(behind, 'commit')}, and can be fast-forwarded.\n  (use "git pull" to update your local branch)\n`, kind: 'behind', upName, ahead, behind };
    return { text: `Your branch and '${upName}' have diverged,\nand have ${ahead} and ${behind} different commits each, respectively.\n  (use "git pull" if you want to integrate the remote branch with yours)\n`, kind: 'diverged', upName, ahead, behind };
  }

  /* HEAD 가 어디서 detach 됐는지 */
  function detachedDescription(repo) {
    const log = repo.readReflog('HEAD');
    for (let i = log.length - 1; i >= 0; i--) {
      const m = log[i].msg.match(/^checkout: moving from (.+) to (.+)$/);
      if (m) {
        const target = m[2];
        const h = repo.resolveCommit(target);
        const cur = repo.headCommit();
        const isRef = ['refs/tags/' + target, 'refs/heads/' + target, 'refs/remotes/' + target].some((r) => repo.refs.has(r));
        const label = isRef ? target : repo.shortHash(h || cur, 7);
        if (h && h === cur) return `HEAD detached at ${label}`;
        return `HEAD detached from ${label}`;
      }
    }
    return `HEAD detached at ${repo.shortHash(repo.headCommit(), 7)}`;
  }

  function statusLong(ctx, opts) {
    opts = opts || {};
    const repo = ctx.repo;
    const st = computeStatus(repo, opts);
    const unborn = repo.isUnborn();
    let out = '';
    const advice = ctx.cfg('advice.statusHints') !== 'false';
    const rb = repo.state.rebase;
    const inMergeLike = !!(repo.state.merge || repo.state.cherryPick || repo.state.revert);
    if (rb) out = rebaseStatusHeader(ctx, repo, rb, '');
    else if (repo.isDetached()) out += detachedDescription(repo) + '\n';
    else out += `On branch ${repo.currentBranch()}\n`;
    if (!repo.isDetached() && !unborn) {
      const tm = trackingMessage(ctx, repo, repo.currentBranch());
      if (tm) out += tm.text + '\n';
    } else if (!repo.isDetached() && unborn) {
      const tm = trackingMessage(ctx, repo, repo.currentBranch());
      void tm;
    }
    if (unborn) out += opts.forCommit ? '\nInitial commit\n\n' : '\nNo commits yet\n\n';
    // 진행 중인 작업 안내
    out += inProgressAdvice(ctx, repo, st, advice);
    const col = (name, t) => ctx.paint(name, t);
    if (st.staged.length) {
      out += 'Changes to be committed:\n';
      if (advice && !inMergeLike) out += unborn ? '  (use "git rm --cached <file>..." to unstage)\n' : '  (use "git restore --staged <file>..." to unstage)\n';
      st.staged.forEach((ch) => {
        const label = { A: 'new file:', M: 'modified:', D: 'deleted:', R: 'renamed:' }[ch.status];
        const name = ch.status === 'R' ? `${ch.oldPath} -> ${ch.path}` : ch.path;
        out += '\t' + col('green', label.padEnd(12) + name) + '\n';
      });
      out += '\n';
    }
    if (st.unmerged.length) {
      out += 'Unmerged paths:\n';
      if (advice) out += (inMergeLike ? '' : (unborn ? '  (use "git rm --cached <file>..." to unstage)\n' : '  (use "git restore --staged <file>..." to unstage)\n')) + '  (use "git add <file>..." to mark resolution)\n';
      st.unmerged.forEach((u) => {
        out += '\t' + col('red', unmergedLabel(u.key).padEnd(17) + u.path) + '\n';
      });
      out += '\n';
    }
    if (st.unstaged.length) {
      out += 'Changes not staged for commit:\n';
      if (advice) {
        const hasDel = st.unstaged.some((c) => c.status === 'D');
        out += hasDel ? '  (use "git add/rm <file>..." to update what will be committed)\n' : '  (use "git add <file>..." to update what will be committed)\n';
        out += '  (use "git restore <file>..." to discard changes in working directory)\n';
      }
      st.unstaged.forEach((ch) => {
        const label = ch.status === 'D' ? 'deleted:' : 'modified:';
        out += '\t' + col('red', label.padEnd(12) + ch.path) + '\n';
      });
      out += '\n';
    }
    if (st.untracked.length) {
      out += 'Untracked files:\n';
      if (advice) out += '  (use "git add <file>..." to include in what will be committed)\n';
      st.untracked.forEach((p) => { out += '\t' + col('red', p) + '\n'; });
      out += '\n';
    }
    const committable = st.staged.length > 0;
    const workdirDirty = st.unstaged.length > 0 || st.unmerged.length > 0;
    if (!committable) {
      if (workdirDirty) out += advice ? 'no changes added to commit (use "git add" and/or "git commit -a")\n' : 'no changes added to commit\n';
      else if (st.untracked.length) out += advice ? 'nothing added to commit but untracked files present (use "git add" to track)\n' : 'nothing added to commit but untracked files present\n';
      else if (unborn) out += advice ? 'nothing to commit (create/copy files and use "git add" to track)\n' : 'nothing to commit\n';
      else out += 'nothing to commit, working tree clean\n';
    }
    return { text: out, st };
  }

  function inProgressAdvice(ctx, repo, st, advice) {
    let out = '';
    const unmerged = st.unmerged.length > 0;
    if (repo.state.merge) {
      if (unmerged) {
        out += 'You have unmerged paths.\n';
        if (advice) out += '  (fix conflicts and run "git commit")\n  (use "git merge --abort" to abort the merge)\n';
      } else {
        out += 'All conflicts fixed but you are still merging.\n';
        if (advice) out += '  (use "git commit" to conclude merge)\n';
      }
      out += '\n';
    } else if (repo.state.cherryPick) {
      const h = repo.shortHash(repo.state.cherryPick.head, 7);
      if (unmerged) {
        out += `You are currently cherry-picking commit ${h}.\n`;
        if (advice) out += '  (fix conflicts and run "git cherry-pick --continue")\n  (use "git cherry-pick --skip" to skip this patch)\n  (use "git cherry-pick --abort" to cancel the cherry-pick operation)\n';
      } else {
        out += `You are currently cherry-picking commit ${h}.\n`;
        if (advice) out += '  (all conflicts fixed: run "git cherry-pick --continue")\n  (use "git cherry-pick --skip" to skip this patch)\n  (use "git cherry-pick --abort" to cancel the cherry-pick operation)\n';
      }
      out += '\n';
    } else if (repo.state.revert) {
      const h = repo.shortHash(repo.state.revert.head, 7);
      out += `You are currently reverting commit ${h}.\n`;
      if (advice) {
        out += unmerged ? '  (fix conflicts and run "git revert --continue")\n' : '  (all conflicts fixed: run "git revert --continue")\n';
        out += '  (use "git revert --skip" to skip this patch)\n  (use "git revert --abort" to cancel the revert operation)\n';
      }
      out += '\n';
    } else if (repo.state.bisect) {
      out += `You are currently bisecting, started from branch '${repo.state.bisect.startBranch || repo.shortHash(repo.state.bisect.startHead, 7)}'.\n`;
      if (advice) out += '  (use "git bisect reset" to get back to the original branch)\n';
      out += '\n';
    }
    return out;
  }

  function rebaseStatusHeader(ctx, repo, rb, out) {
    // 진행 상황 헤더는 branch 줄 앞이 아니라 뒤에 오므로 별도 문자열로 만든다
    let s = '';
    const interactive = rb.interactive;
    s += `${interactive ? 'interactive rebase' : 'rebase'} in progress; onto ${repo.shortHash(rb.onto, 7)}\n`;
    const done = rb.done || [];
    const todo = rb.todo || [];
    const fmt = (e) => `   ${e.cmd} ${repo.shortHash(e.hash, 7)} ${e.subject}`;
    if (interactive || true) {
      if (done.length) {
        s += done.length === 1 ? 'Last command done (1 command done):\n' : `Last commands done (${done.length} commands done):\n`;
        done.slice(-2).forEach((e) => { s += fmt(e) + '\n'; });
        if (done.length > 2) s += `  (see more in file .git/rebase-merge/done)\n`;
      }
      if (todo.length) {
        s += todo.length === 1 ? 'Next command to do (1 remaining command):\n' : `Next commands to do (${todo.length} remaining commands):\n`;
        todo.slice(0, 2).forEach((e) => { s += fmt(e) + '\n'; });
        s += '  (use "git rebase --edit-todo" to view and edit)\n';
      } else s += 'No commands remaining.\n';
    }
    const head = rb.headName ? rb.headName.replace(/^refs\/heads\//, '') : null;
    s += `You are currently ${rb.stoppedEdit ? 'editing a commit while rebasing' : 'rebasing'} branch '${head}' on '${repo.shortHash(rb.onto, 7)}'.\n`;
    s += rb.stoppedEdit ? '  (use "git commit --amend" to amend the current commit)\n  (use "git rebase --continue" once you are satisfied with your changes)\n' : (rb.conflict ? '  (fix conflicts and then run "git rebase --continue")\n  (use "git rebase --skip" to skip this patch)\n  (use "git rebase --abort" to check out the original branch)\n' : '  (all conflicts fixed: run "git rebase --continue")\n');
    s += '\n';
    return out.replace(/^(.*\n)/, '$1') + s;
  }

  function statusShort(ctx, opts) {
    const repo = ctx.repo;
    const st = computeStatus(repo, opts);
    const lines = [];
    const entries = new Map();
    const get = (p) => { if (!entries.has(p)) entries.set(p, { x: ' ', y: ' ', path: p }); return entries.get(p); };
    st.staged.forEach((ch) => {
      const e = get(ch.path);
      e.x = ch.status;
      if (ch.status === 'R') e.orig = ch.oldPath;
    });
    st.unstaged.forEach((ch) => { get(ch.path).y = ch.status; });
    st.unmerged.forEach((u) => { const e = get(u.path); const code = SHORT_UNMERGED[u.key] || 'UU'; e.x = code[0]; e.y = code[1]; });
    Array.from(entries.keys()).sort().forEach((p) => {
      const e = entries.get(p);
      const name = e.orig ? `${e.orig} -> ${e.path}` : e.path;
      let xs = e.x, ys = e.y;
      if (ctx.color) {
        if (e.x !== ' ') xs = ctx.paint('green', e.x);
        if (e.y !== ' ') ys = ctx.paint('red', e.y);
      }
      lines.push(`${xs}${ys} ${name}`);
    });
    st.untracked.forEach((p) => lines.push(`${ctx.paint('red', '??')} ${p}`));
    let head = '';
    if (opts && opts.branch) {
      if (repo.isDetached()) head = '## HEAD (no branch)\n';
      else {
        const b = repo.currentBranch();
        if (repo.isUnborn()) head = `## No commits yet on ${b}\n`;
        else {
          head = `## ${b}`;
          const tm = trackingMessage(ctx, repo, b);
          if (tm) {
            head += `...${tm.upName}`;
            if (tm.kind === 'ahead') head += ` [ahead ${tm.ahead}]`;
            else if (tm.kind === 'behind') head += ` [behind ${tm.behind}]`;
            else if (tm.kind === 'diverged') head += ` [ahead ${tm.ahead}, behind ${tm.behind}]`;
            else if (tm.kind === 'gone') head += ' [gone]';
          }
          head += '\n';
        }
      }
    }
    return head + (lines.length ? lines.join('\n') + '\n' : '');
  }

  /* ---------------- 데코레이션 / pretty ---------------- */
  function decorations(repo) {
    const map = new Map(); // hash → [{type,name}]
    const add = (h, type, name) => { if (!map.has(h)) map.set(h, []); map.get(h).unshift({ type, name }); };
    const hc = repo.headCommit();
    if (hc) add(hc, 'head', 'HEAD');
    const allRefs = repo.listRefs('refs/');
    if (repo.symrefs) repo.symrefs.forEach((target, ref) => { const th = repo.refs.get(target); if (th && ref.startsWith('refs/remotes/')) allRefs.push([ref, th]); });
    allRefs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    allRefs.forEach(([n, h]) => {
      if (n.startsWith('refs/heads/')) add(repo.peelToCommit(h) || h, 'branch', n.slice(11));
      else if (n.startsWith('refs/remotes/')) { if (!n.endsWith('/HEAD') || true) add(repo.peelToCommit(h) || h, 'remote', n.slice(13)); }
      else if (n.startsWith('refs/tags/')) add(repo.peelToCommit(h) || h, 'tag', n.slice(10));
      else if (n === 'refs/stash') add(h, 'stash', 'refs/stash');
    });
    return map;
  }

  function decorateText(ctx, repo, hash, decoMap) {
    const list = decoMap.get(hash);
    if (!list || !list.length) return '';
    const cur = repo.currentBranch();
    const parts = [];
    const head = list.find((d) => d.type === 'head');
    if (head) {
      if (repo.head.ref) {
        parts.push(ctx.paint('boldcyan', 'HEAD -> ') + ctx.paint('boldgreen', cur));
      } else parts.push(ctx.paint('boldcyan', 'HEAD'));
    }
    list.forEach((d) => {
      if (d.type === 'head') return;
      if (d.type === 'branch' && repo.head.ref && d.name === cur) return;
      if (d.type === 'branch') parts.push(ctx.paint('boldgreen', d.name));
      else if (d.type === 'remote') parts.push(ctx.paint('boldred', d.name));
      else if (d.type === 'tag') parts.push(ctx.paint('boldyellow', 'tag: ' + d.name));
      else parts.push(ctx.paint('boldmagenta', d.name));
    });
    if (!parts.length) return '';
    const sep = ctx.paint('yellow', ', ');
    return ctx.paint('yellow', ' (') + parts.join(sep) + ctx.paint('yellow', ')');
  }

  function indentMessage(msg) {
    const lines = msg.replace(/\n$/, '').split('\n');
    return lines.map((l) => '    ' + l).join('\n') + '\n';
  }
  function subjectOf(msg) {
    const paragraphs = msg.replace(/^\n+/, '').split('\n\n')[0];
    return paragraphs.split('\n').map((l) => l.trim()).join(' ').trim();
  }
  function bodyOf(msg) {
    const idx = msg.indexOf('\n\n');
    return idx < 0 ? '' : msg.slice(idx + 2);
  }

  /* --format 문자열 처리 */
  function formatPretty(ctx, repo, hash, fmt, decoMap) {
    const c = repo.commitObj(hash);
    const now = ctx.now;
    return fmt.replace(/%(%|H|h|T|t|P|p|an|ae|aN|aE|ad|aD|ai|aI|as|ar|at|cn|ce|cd|cD|ci|cI|cs|cr|ct|s|b|B|d|D|e|n|Cred|Cgreen|Cblue|Cresetx|Creset|Cyellow|Cblue|Cbold|x[0-9a-fA-F]{2})/g, (m, k) => {
      switch (k) {
        case '%': return '%';
        case 'H': return hash;
        case 'h': return repo.shortHash(hash, 7);
        case 'T': return c.tree;
        case 't': return repo.shortHash(c.tree, 7);
        case 'P': return c.parents.join(' ');
        case 'p': return c.parents.map((p) => repo.shortHash(p, 7)).join(' ');
        case 'an': return c.author.name;
        case 'aN': return c.author.name;
        case 'ae': case 'aE': return c.author.email;
        case 'ad': return formatDate(c.author.ts, c.author.tz, 'default', now);
        case 'aD': return formatDate(c.author.ts, c.author.tz, 'default', now);
        case 'ai': return formatDate(c.author.ts, c.author.tz, 'iso', now);
        case 'aI': return formatDate(c.author.ts, c.author.tz, 'iso-strict', now);
        case 'as': return formatDate(c.author.ts, c.author.tz, 'short', now);
        case 'ar': return formatDate(c.author.ts, c.author.tz, 'relative', now);
        case 'at': return String(c.author.ts);
        case 'cn': return c.committer.name;
        case 'ce': return c.committer.email;
        case 'cd': case 'cD': return formatDate(c.committer.ts, c.committer.tz, 'default', now);
        case 'ci': return formatDate(c.committer.ts, c.committer.tz, 'iso', now);
        case 'cI': return formatDate(c.committer.ts, c.committer.tz, 'iso-strict', now);
        case 'cs': return formatDate(c.committer.ts, c.committer.tz, 'short', now);
        case 'cr': return formatDate(c.committer.ts, c.committer.tz, 'relative', now);
        case 'ct': return String(c.committer.ts);
        case 's': return subjectOf(c.message);
        case 'b': return bodyOf(c.message);
        case 'B': return c.message;
        case 'd': return decoMap ? decorateText(ctx, repo, hash, decoMap) : '';
        case 'D': { const t = decoMap ? decorateText({ paint: (n, x) => x }, repo, hash, decoMap) : ''; return t.replace(/^ \(/, '').replace(/\)$/, ''); }
        case 'n': return '\n';
        case 'Cred': return ctx.paint('red', '').replace(/\x1b\[m$/, '') ;
        case 'Cgreen': return ctx.color ? '\x1b[32m' : '';
        case 'Cblue': return ctx.color ? '\x1b[34m' : '';
        case 'Cyellow': return ctx.color ? '\x1b[33m' : '';
        case 'Cbold': return ctx.color ? '\x1b[1m' : '';
        case 'Creset': return ctx.color ? '\x1b[m' : '';
        default:
          if (k[0] === 'x') return String.fromCharCode(parseInt(k.slice(1), 16));
          return m;
      }
    });
  }

  G.util = {
    NeedInput, Ctx, die, fail, parseArgs, formatDate, relativeDate, isBinary, contentOf, hashOfEntry, diffMaps, detectRenames,
    renderPatch, colorizePatch, changeCounts, diffStatText, summaryLines, renameLabel, workMap, indexMap, computeStatus,
    statusLong, statusShort, trackingMessage, aheadBehind, plural, detachedDescription, decorations, decorateText,
    indentMessage, subjectOf, bodyOf, formatPretty, sortedPaths, unmergedLabel,
  };
  G.NeedInput = NeedInput;
})();
