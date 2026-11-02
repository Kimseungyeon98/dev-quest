/* git 명령어 구현 (2): log / show / reflog / blame / describe / shortlog / rev-list */
(function () {
  'use strict';
  const G = (globalThis.GitEngine = globalThis.GitEngine || {});
  const { Diff, sha1, GitError, ZERO, pathspecMatcher } = G;
  const U = G.util;
  const C = G.core;
  const { die, fail, parseArgs } = U;
  const COMMANDS = G.commands;

  const LOG_SPEC = {
    flags: {
      '--oneline': 'oneline', '--graph': 'graph', '--all': 'all', '--decorate': 'decorate', '--no-decorate': 'noDecorate', '--merges': 'merges', '--no-merges': 'noMerges',
      '--first-parent': 'firstParent', '--reverse': 'reverse', '--stat': 'stat', '--shortstat': 'shortstat', '--name-only': 'nameOnly', '--name-status': 'nameStatus',
      '-p': 'patch', '--patch': 'patch', '-u': 'patch', '-s': 'noPatch', '--no-patch': 'noPatch', '--abbrev-commit': 'abbrevCommit', '--no-abbrev-commit': 'noAbbrev',
      '--topo-order': 'topo', '--date-order': 'dateOrder', '--branches': 'branches', '--tags': 'tags', '--remotes': 'remotes', '-g': 'walkReflogs', '--walk-reflogs': 'walkReflogs',
      '--follow': 'follow', '-i': 'icase', '--regexp-ignore-case': 'icase', '--no-color': 'noColor', '--color': 'color', '--numstat': 'numstat', '--summary': 'summary',
      '--no-walk': 'noWalk', '--left-right': 'leftRight', '--source': 'source', '--full-history': 'fullHistory', '--simplify-by-decoration': 'simplifyDeco', '--cherry-pick': 'cherryPick', '--ancestry-path': 'ancestryPath',
      '--no-renames': 'noRenames', '--not': 'not', '-m': 'mflag', '--raw': 'raw',
    },
    opts: {
      '-n': 'max', '--max-count': 'max', '--skip': 'skip', '--author': 'author', '--committer': 'committer', '--grep': 'grep', '--since': 'since', '--after': 'since', '--until': 'until', '--before': 'until',
      '--format': 'format', '--pretty': 'format', '--date': 'date', '-S': 'pickaxe', '-G': 'pickaxeRe', '--abbrev': 'abbrev', '-U': 'unified',
    },
    optional: { '--pretty': 'format', '--format': 'format', '--decorate': 'decorate', '--abbrev': 'abbrev', '--date': 'date', '--stat': 'statOpt' },
    numeric: 'max',
  };

  /* 날짜 필터 파싱: "2025-03-01", "3 days ago", "yesterday" */
  function parseDateFilter(ctx, s) {
    if (!s) return null;
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m) {
      const off = 9 * 3600;
      return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) / 1000 - off;
    }
    const r = s.match(/^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/);
    if (r) {
      const mult = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 }[r[2]];
      return ctx.now - parseInt(r[1], 10) * mult;
    }
    if (s === 'yesterday') return ctx.now - 86400;
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    return null;
  }

  function commitMatchesText(c, re) { return re.test(c.message); }

  /* 리비전 인자 해석: include / exclude / paths */
  function parseRevArgs(ctx, repo, rest, dd, o) {
    const include = [];
    const exclude = [];
    const paths = dd.slice();
    let notMode = false;
    let sawDD = dd.length > 0 || false;
    rest.forEach((a) => {
      if (a === '--not') { notMode = !notMode; return; }
      const push = (h, neg) => { if ((neg) !== notMode) exclude.push(h); else include.push(h); };
      if (a.startsWith('^') && a.length > 1) {
        const h = repo.resolveCommit(a.slice(1));
        if (!h) throw die(`bad revision '${a}'`);
        push(h, true);
        return;
      }
      const tri = a.match(/^(.*)\.\.\.(.*)$/);
      const dbl = a.match(/^(.*)\.\.(.*)$/);
      if (tri) {
        const l = repo.resolveCommit(tri[1] || 'HEAD'), r = repo.resolveCommit(tri[2] || 'HEAD');
        if (!l || !r) throw die(`ambiguous argument '${a}': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'`);
        include.push(l, r);
        repo.mergeBases(l, r).forEach((b) => exclude.push(b));
        return;
      }
      if (dbl) {
        const l = repo.resolveCommit(dbl[1] || 'HEAD'), r = repo.resolveCommit(dbl[2] || 'HEAD');
        if (!l || !r) throw die(`ambiguous argument '${a}': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'`);
        exclude.push(l); include.push(r);
        return;
      }
      const h = repo.resolveCommit(a);
      if (h) { push(h, false); return; }
      if (sawDD) throw die(`bad revision '${a}'`);
      // 경로로 간주
      const isPath = repo.work.has(a) || repo.index.has(a) || Array.from(repo.index.keys()).some((k) => k.startsWith(a.replace(/\/$/, '') + '/')) || repo.headFlat().has(a);
      if (isPath) { paths.push(a); return; }
      throw die(`ambiguous argument '${a}': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'`);
    });
    return { include, exclude, paths };
  }

  /* 경로 제한 시 history simplification */
  function filterByPath(repo, list, include, matcher, opts) {
    const flatOf = (h) => {
      const f = repo.commitFlat(h);
      const m = new Map();
      f.forEach((e, p) => { if (matcher(p)) m.set(p, e.hash); });
      return m;
    };
    const same = (a, b) => {
      if (a.size !== b.size) return false;
      for (const [k, v] of a) if (b.get(k) !== v) return false;
      return true;
    };
    const followed = new Set(include);
    const shown = [];
    const treesameFirst = new Map();
    list.forEach((h) => {
      if (!followed.has(h)) return;
      const c = repo.commitObj(h);
      const mine = flatOf(h);
      let treesameParent = null;
      c.parents.forEach((p) => { if (treesameParent === null && same(mine, flatOf(p))) treesameParent = p; });
      void treesameFirst;
      if (c.parents.length === 0) { if (mine.size) shown.push(h); return; }
      if (treesameParent !== null && !opts.fullHistory) { followed.add(treesameParent); return; }
      c.parents.forEach((p) => followed.add(p));
      if (treesameParent === null) shown.push(h);
    });
    return shown;
  }

  function mediumHeader(ctx, repo, hash, c, o, deco) {
    let s = ctx.paint('yellow', `commit ${hash}`) + (deco ? deco : '') + '\n';
    if (c.parents.length > 1) s += `Merge: ${c.parents.map((p) => repo.shortHash(p, 7)).join(' ')}\n`;
    return s;
  }

  /* 한 커밋을 형식에 맞게 문자열 줄 목록으로 만든다 (그래프 없이) */
  function formatCommitText(ctx, repo, hash, o, decoMap, state) {
    const c = repo.commitObj(hash);
    const dateStyle = o.date ? o.date[0] : 'default';
    const abbrev = o.abbrevCommit || o.oneline || (o.format && /^(oneline|short|medium)?$/.test(o.format[0] || ''));
    const deco = state.decorate ? U.decorateText(ctx, repo, hash, decoMap) : '';
    const shortOrFull = (h) => (state.abbrev ? repo.shortHash(h, state.abbrevLen) : h);
    let fmt = o.fmtName;
    if (o.oneline) fmt = 'oneline';
    let text = '';
    void abbrev;
    if (fmt === 'oneline') {
      text = ctx.paint('yellow', shortOrFull(hash)) + deco + ' ' + U.subjectOf(c.message) + '\n';
    } else if (fmt && fmt.startsWith('format:') || fmt && fmt.startsWith('tformat:')) {
      const f = fmt.slice(fmt.indexOf(':') + 1);
      text = U.formatPretty(ctx, repo, hash, f, decoMap) + '\n';
    } else if (fmt === 'short') {
      text = ctx.paint('yellow', `commit ${hash}`) + deco + '\n';
      if (c.parents.length > 1) text += `Merge: ${c.parents.map((p) => repo.shortHash(p, 7)).join(' ')}\n`;
      text += `Author: ${c.author.name} <${c.author.email}>\n\n`;
      text += '    ' + U.subjectOf(c.message) + '\n';
    } else if (fmt === 'full' || fmt === 'fuller') {
      text = ctx.paint('yellow', `commit ${hash}`) + deco + '\n';
      if (c.parents.length > 1) text += `Merge: ${c.parents.map((p) => repo.shortHash(p, 7)).join(' ')}\n`;
      if (fmt === 'full') text += `Author: ${c.author.name} <${c.author.email}>\nCommit: ${c.committer.name} <${c.committer.email}>\n\n`;
      else text += `Author:     ${c.author.name} <${c.author.email}>\nAuthorDate: ${U.formatDate(c.author.ts, c.author.tz, dateStyle, ctx.now)}\nCommit:     ${c.committer.name} <${c.committer.email}>\nCommitDate: ${U.formatDate(c.committer.ts, c.committer.tz, dateStyle, ctx.now)}\n\n`;
      text += U.indentMessage(c.message);
    } else {
      text = mediumHeader(ctx, repo, hash, c, o, deco);
      text += `Author: ${c.author.name} <${c.author.email}>\n`;
      text += `Date:   ${U.formatDate(c.author.ts, c.author.tz, dateStyle, ctx.now)}\n\n`;
      text += U.indentMessage(c.message);
    }
    return text;
  }

  function patchTextFor(ctx, repo, hash, o) {
    const c = repo.commitObj(hash);
    if (c.parents.length > 1 && !o.mflag) return '';
    const parent = c.parents[0];
    const aMap = parent ? repo.commitFlat(parent) : new Map();
    const bMap = repo.commitFlat(hash);
    const changes = U.diffMaps(repo, aMap, bMap, { renames: !o.noRenames, filter: o.pathFilter || undefined });
    if (!changes.length) return '';
    const parts = [];
    if (o.nameOnly) return changes.map((ch) => ch.path).join('\n') + '\n';
    if (o.nameStatus) return changes.map((ch) => (ch.status === 'R' ? `R${String(ch.similarity).padStart(3, '0')}\t${ch.oldPath}\t${ch.path}` : `${ch.status}\t${ch.path}`)).join('\n') + '\n';
    if (o.numstat) return changes.map((ch) => { const n = U.changeCounts(repo, ch); return `${n.added}\t${n.deleted}\t${ch.status === 'R' ? U.renameLabel(ch.oldPath, ch.path) : ch.path}`; }).join('\n') + '\n';
    if (o.shortstat) {
      let a = 0, d = 0;
      changes.forEach((ch) => { const n = U.changeCounts(repo, ch); a += n.added; d += n.deleted; });
      return Diff.summaryLine(changes.length, a, d) + '\n';
    }
    if (o.stat) parts.push(U.diffStatText(repo, changes) + (o.summary ? U.summaryLines(repo, changes) : ''));
    else if (o.summary) parts.push(U.summaryLines(repo, changes));
    if (o.patch) {
      const body = changes.map((ch) => U.renderPatch(repo, ch, { context: o.unified ? parseInt(o.unified[0], 10) : 3 })).join('');
      parts.push(U.colorizePatch(ctx, body));
    }
    return parts.join(o.stat && o.patch ? '\n' : '');
  }

  COMMANDS.log = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, LOG_SPEC, 'log');
    const o = p.f;
    Object.keys(p.o).forEach((k) => { o[k] = p.o[k]; });
    o.fmtName = null;
    if (p.o.format) {
      const f = p.o.format[0];
      if (f === '' || f === undefined) o.fmtName = 'medium';
      else if (['oneline', 'short', 'medium', 'full', 'fuller', 'raw'].includes(f)) { o.fmtName = f; if (f === 'oneline') o.oneline = true; }
      else if (f.startsWith('format:') || f.startsWith('tformat:')) o.fmtName = f;
      else o.fmtName = 'tformat:' + f;
    }
    if (o.oneline && !o.fmtName) o.fmtName = 'oneline';
    if (o.statOpt) o.stat = true;
    let state = { decorate: false, abbrev: false, abbrevLen: 7 };
    const decoCfg = ctx.cfg('log.decorate');
    if (o.decorate) state.decorate = true;
    else if (o.noDecorate) state.decorate = false;
    else if (decoCfg && decoCfg !== 'no' && decoCfg !== 'false') state.decorate = true;
    else if (ctx.tty !== false && ctx.sim.tty && !o.format) state.decorate = true;
    if (o.oneline && !o.noDecorate && (ctx.tty !== false && ctx.sim.tty || decoCfg)) state.decorate = true;
    if (o.fmtName && o.fmtName.startsWith('tformat:')) state.decorate = false;
    state.abbrev = !!(o.oneline || o.abbrevCommit || (!o.noAbbrev && o.fmtName === 'oneline'));
    if (o.abbrev && o.abbrev[0]) state.abbrevLen = parseInt(o.abbrev[0], 10) || 7;
    if (o.fmtName && o.fmtName.startsWith('tformat:') && /%d|%D/.test(o.fmtName)) state.decorate = false;

    const { include, exclude, paths } = parseRevArgs(ctx, repo, p.rest, p.dd, o);
    o.pathFilter = paths.length ? pathspecMatcher(paths) : null;
    if (o.all) {
      const hcAll = repo.headCommit();
      if (hcAll) include.push(hcAll);
      repo.listRefs('refs/').forEach(([, h]) => { const c = repo.peelToCommit(h); if (c) include.push(c); });
    }
    if (o.branches) repo.listRefs('refs/heads/').forEach(([, h]) => include.push(repo.peelToCommit(h)));
    if (o.tags) repo.listRefs('refs/tags/').forEach(([, h]) => include.push(repo.peelToCommit(h)));
    if (o.remotes) repo.listRefs('refs/remotes/').forEach(([, h]) => include.push(h));
    if (o.walkReflogs) return reflogWalk(ctx, repo, p, o, state);
    if (!include.length && !o.all && !o.branches && !o.tags && !o.remotes) {
      const hc = repo.headCommit();
      if (!hc) {
        if (repo.isUnborn()) throw die(`your current branch '${repo.currentBranch()}' does not have any commits yet`);
        throw die('bad default revision \'HEAD\'');
      }
      include.push(hc);
    }
    const uniqInclude = Array.from(new Set(include));
    let order = o.topo || o.graph ? 'topo' : (o.dateOrder ? 'date-order' : 'date');
    let list;
    if (o.noWalk) list = uniqInclude.slice();
    else list = repo.revWalk(uniqInclude, exclude, { order, firstParent: !!o.firstParent, reverse: false });
    if (o.pathFilter) list = filterByPath(repo, list, uniqInclude, o.pathFilter, o);
    if (o.merges) list = list.filter((h) => repo.parents(h).length > 1);
    if (o.noMerges) list = list.filter((h) => repo.parents(h).length <= 1);
    if (o.author) { const re = new RegExp(o.author[0], o.icase ? 'i' : ''); list = list.filter((h) => { const c = repo.commitObj(h); return re.test(`${c.author.name} <${c.author.email}>`); }); }
    if (o.committer) { const re = new RegExp(o.committer[0], o.icase ? 'i' : ''); list = list.filter((h) => { const c = repo.commitObj(h); return re.test(`${c.committer.name} <${c.committer.email}>`); }); }
    if (o.grep) { const re = new RegExp(o.grep[0], o.icase ? 'i' : ''); list = list.filter((h) => commitMatchesText(repo.commitObj(h), re)); }
    if (o.since) { const t = parseDateFilter(ctx, o.since[0]); if (t !== null) list = list.filter((h) => repo.commitObj(h).committer.ts >= t); }
    if (o.until) { const t = parseDateFilter(ctx, o.until[0]); if (t !== null) list = list.filter((h) => repo.commitObj(h).committer.ts <= t); }
    if (o.pickaxe || o.pickaxeRe) {
      const needle = o.pickaxe ? o.pickaxe[0] : null;
      const re = o.pickaxeRe ? new RegExp(o.pickaxeRe[0]) : null;
      const count = (txt) => (needle ? txt.split(needle).length - 1 : 0);
      list = list.filter((h) => {
        const c = repo.commitObj(h);
        const aMap = c.parents[0] ? repo.commitFlat(c.parents[0]) : new Map();
        const bMap = repo.commitFlat(h);
        const changes = U.diffMaps(repo, aMap, bMap, { renames: false, filter: o.pathFilter || undefined });
        return changes.some((ch) => {
          const a = ch.a ? U.contentOf(repo, ch.a) : '', b = ch.b ? U.contentOf(repo, ch.b) : '';
          if (needle) return count(a) !== count(b);
          const changedLines = []; const blocks = Diff.diffBlocks(Diff.splitLines(a), Diff.splitLines(b));
          const al = Diff.splitLines(a), bl = Diff.splitLines(b);
          blocks.forEach((bk) => { al.slice(bk.a0, bk.a1).forEach((l) => changedLines.push(l)); bl.slice(bk.b0, bk.b1).forEach((l) => changedLines.push(l)); });
          return changedLines.some((l) => re.test(l));
        });
      });
    }
    if (o.reverse) list = list.slice().reverse();
    if (o.skip) list = list.slice(parseInt(o.skip[0], 10));
    if (o.max) list = list.slice(0, parseInt(o.max[0], 10));
    if (!list.length) return;
    const decoMap = state.decorate ? U.decorations(repo) : null;
    const isOneline = o.fmtName === 'oneline';
    const isTformat = o.fmtName && o.fmtName.startsWith('tformat:');
    const isFormat = o.fmtName && o.fmtName.startsWith('format:');
    const listSet = new Set(list);
    const graph = o.graph ? new G.Graph({ color: ctx.color }) : null;
    let out = '';
    list.forEach((h, idx) => {
      const needsPatch = o.patch || o.stat || o.nameOnly || o.nameStatus || o.shortstat || o.numstat || o.summary;
      const msg = formatCommitText(ctx, repo, h, o, decoMap, state);
      let extra = '';
      if (needsPatch && !o.noPatch) {
        extra = patchTextFor(ctx, repo, h, o);
        if (extra) extra = (isOneline || isTformat || isFormat ? '' : '\n') + extra;
      }
      const separator = !isOneline && !isTformat && !isFormat && idx > 0;
      if (graph) {
        const parents = repo.parents(h).filter((x) => listSet.has(x)).slice(0, o.firstParent ? 1 : 99);
        graph.update(h, parents);
        let lines = (msg + extra).replace(/\n$/, '').split('\n');
        if (separator) {
          // 커밋 사이 구분 줄: 그래프 패딩 + 개행
          out += graph.paddingLine().replace(/\s+$/, (m) => m) + '\n';
        }
        let first = true;
        lines.forEach((ln) => {
          if (first) {
            for (;;) {
              const gl = graph.nextLine();
              if (gl.isCommitLine) { out += gl.text + ln + '\n'; break; }
              out += gl.text + '\n';
            }
            first = false;
          } else {
            out += graph.paddingLine() + ln + '\n';
          }
        });
        while (!graph.isCommitFinished()) {
          out += graph.nextLine().text + '\n';
        }
        return;
      }
      if (separator) out += '\n';
      out += msg;
      if (extra) out += extra;
    });
    if (isFormat) out = out.replace(/\n$/, '');
    ctx.print(out);
  };

  /* git log -g / git reflog */
  function reflogEntries(ctx, repo, refname) {
    const log = repo.readReflog(refname);
    return log.slice().reverse().map((e, i) => ({ e, i, refname }));
  }

  function reflogWalk(ctx, repo, p, o, state) {
    const refname = p.rest[0] ? ('refs/heads/' + p.rest[0]) : 'HEAD';
    const target = repo.refs.has(p.rest[0] || '') ? p.rest[0] : (p.rest[0] && repo.refs.has('refs/heads/' + p.rest[0]) ? 'refs/heads/' + p.rest[0] : (p.rest[0] ? 'refs/' + p.rest[0] : 'HEAD'));
    void refname;
    const entries = reflogEntries(ctx, repo, p.rest[0] ? target : 'HEAD');
    const decoMap = state.decorate ? U.decorations(repo) : null;
    let out = '';
    const max = o.max ? parseInt(o.max[0], 10) : Infinity;
    entries.slice(0, max).forEach(({ e, i }, idx) => {
      const label = (p.rest[0] || 'HEAD') + `@{${i}}`;
      const deco = state.decorate ? U.decorateText(ctx, repo, e.new, decoMap) : '';
      const c = repo.commitObj(e.new);
      if (o.oneline || o.fmtName === 'oneline') {
        out += `${ctx.paint('yellow', repo.shortHash(e.new, 7))}${deco} ${label}: ${e.msg}\n`;
      } else {
        if (idx > 0) out += '\n';
        out += ctx.paint('yellow', `commit ${e.new}`) + deco + '\n' + `Reflog: ${label} (${e.name} <${e.email}>)\nReflog message: ${e.msg}\n`;
        if (c) out += `Author: ${c.author.name} <${c.author.email}>\nDate:   ${U.formatDate(c.author.ts, c.author.tz, 'default', ctx.now)}\n\n` + U.indentMessage(c.message);
      }
    });
    ctx.print(out);
  }

  COMMANDS.reflog = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    let sub = 'show';
    let rest = args.slice();
    if (rest[0] && ['show', 'expire', 'delete', 'exists'].includes(rest[0])) sub = rest.shift();
    if (sub === 'expire') {
      const all = rest.includes('--all');
      const now = rest.some((a) => a === '--expire=now' || a === '--expire-unreachable=now');
      if (now) {
        if (all) repo.reflogs.forEach((_, k) => { if (k !== 'HEAD' || true) repo.reflogs.set(k, []); });
        else repo.reflogs.set('HEAD', []);
      }
      return;
    }
    if (sub === 'delete') {
      const spec = rest.find((a) => /@\{\d+\}$/.test(a));
      if (spec) {
        const m = spec.match(/^(.*)@\{(\d+)\}$/);
        const rn = m[1] === '' || m[1] === 'HEAD' ? 'HEAD' : 'refs/heads/' + m[1];
        const log = repo.readReflog(rn);
        log.splice(log.length - 1 - parseInt(m[2], 10), 1);
      }
      return;
    }
    const refArg = rest.filter((a) => !a.startsWith('-'))[0];
    let refname = 'HEAD';
    if (refArg && refArg !== 'HEAD') {
      refname = ['refs/heads/' + refArg, 'refs/remotes/' + refArg, 'refs/' + refArg, refArg].find((r) => repo.reflogs.has(r) || repo.refs.has(r)) || 'refs/heads/' + refArg;
    }
    let entries = reflogEntries(ctx, repo, refname);
    const numArg = rest.find((a) => /^-\d+$/.test(a));
    const nIdx = rest.findIndex((a) => a === '-n' || a === '--max-count');
    const maxEntries = numArg ? parseInt(numArg.slice(1), 10) : (nIdx >= 0 ? parseInt(rest[nIdx + 1], 10) : ((rest.find((a) => /^--max-count=\d+$/.test(a)) || '').split('=')[1] ? parseInt(rest.find((a) => /^--max-count=\d+$/.test(a)).split('=')[1], 10) : null));
    if (maxEntries) entries = entries.slice(0, maxEntries);
    if (!entries.length && refArg && !repo.reflogs.has(refname)) throw die(`ambiguous argument '${refArg}': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'`);
    const decoCfg = ctx.cfg('log.decorate');
    const showDeco = (ctx.tty !== false && ctx.sim.tty) || (decoCfg && decoCfg !== 'no');
    const decoMap = showDeco ? U.decorations(repo) : null;
    let out = '';
    entries.forEach(({ e, i }) => {
      const label = (refArg || 'HEAD') + `@{${i}}`;
      const deco = showDeco ? U.decorateText(ctx, repo, e.new, decoMap) : '';
      out += `${ctx.paint('yellow', repo.shortHash(e.new, 7))}${deco} ${label}: ${e.msg}\n`;
    });
    ctx.print(out);
  };

  /* ---------------- git show ---------------- */
  COMMANDS.show = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, {
      flags: { '--stat': 'stat', '--name-only': 'nameOnly', '--name-status': 'nameStatus', '-s': 'noPatch', '--no-patch': 'noPatch', '--oneline': 'oneline', '--no-color': 'noColor', '-p': 'patch', '--patch': 'patch', '--shortstat': 'shortstat', '--abbrev-commit': 'abbrevCommit', '--summary': 'summary', '--decorate': 'decorate', '--no-decorate': 'noDecorate', '--numstat': 'numstat' },
      opts: {}, optional: { '--format': 'format', '--pretty': 'format', '--date': 'date' },
    }, 'show');
    const o = p.f;
    Object.keys(p.o).forEach((k) => { o[k] = p.o[k]; });
    const specs = p.rest.length ? p.rest : ['HEAD'];
    let first = true;
    specs.forEach((spec) => {
      // rev:path
      const colon = spec.indexOf(':');
      if (colon > 0) {
        const rev = spec.slice(0, colon), path = spec.slice(colon + 1);
        const c = repo.resolveCommit(rev);
        if (!c) throw die(`invalid object name '${rev}'.`);
        const flat = repo.commitFlat(c);
        if (flat.has(path)) { ctx.print(repo.blobContent(flat.get(path).hash)); return; }
        const entries = [];
        flat.forEach((_, pp) => { if (pp.startsWith(path.replace(/\/$/, '') + '/')) { const rel = pp.slice(path.replace(/\/$/, '').length + 1); entries.push(rel.includes('/') ? rel.split('/')[0] + '/' : rel); } });
        if (entries.length) { ctx.print(`tree ${spec}\n\n` + Array.from(new Set(entries)).sort().join('\n') + '\n'); return; }
        throw die(`path '${path}' does not exist in '${rev}'`);
      }
      const h = repo.resolve(spec);
      if (!h) throw die(`ambiguous argument '${spec}': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'`);
      const obj = repo.get(h);
      if (!first) ctx.print('\n');
      first = false;
      if (obj.type === 'tag') {
        ctx.print(`tag ${obj.tag}\nTagger: ${obj.tagger.name} <${obj.tagger.email}>\nDate:   ${U.formatDate(obj.tagger.ts, obj.tagger.tz, 'default', ctx.now)}\n\n${obj.message}\n`);
      }
      const ch = repo.peelToCommit(h);
      if (!ch) { ctx.print(JSON.stringify(obj)); return; }
      const state = { decorate: o.decorate || (ctx.tty !== false && ctx.sim.tty && !o.noDecorate) || !!ctx.cfg('log.decorate'), abbrev: !!o.oneline, abbrevLen: 7 };
      const lo = Object.assign({}, o, { fmtName: o.oneline ? 'oneline' : (o.format ? (o.format[0] === 'oneline' ? 'oneline' : o.format[0].startsWith('format:') || ['short', 'full', 'fuller', 'medium'].includes(o.format[0]) ? o.format[0] : 'tformat:' + o.format[0]) : null) });
      const decoMap = state.decorate ? U.decorations(repo) : null;
      ctx.print(formatCommitText(ctx, repo, ch, lo, decoMap, state));
      const needsPatch = !o.noPatch;
      if (needsPatch) {
        const lo2 = Object.assign({}, o, { patch: !(o.stat || o.nameOnly || o.nameStatus || o.shortstat || o.numstat) || o.patch });
        const extra = patchTextFor(ctx, repo, ch, lo2);
        if (extra) ctx.print((lo.fmtName === 'oneline' ? '' : '\n') + extra);
      }
    });
  };

  /* ---------------- git rev-list ---------------- */
  COMMANDS['rev-list'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '--count': 'count', '--all': 'all', '--reverse': 'reverse', '--no-merges': 'noMerges', '--first-parent': 'firstParent', '--topo-order': 'topo' }, opts: { '-n': 'max', '--max-count': 'max' }, numeric: 'max' }, 'rev-list');
    const { include, exclude } = parseRevArgs(ctx, repo, p.rest, p.dd, p.f);
    if (p.f.all) repo.allTips().forEach((t) => include.push(t));
    if (!include.length) { const hc = repo.headCommit(); if (hc) include.push(hc); }
    let list = repo.revWalk(Array.from(new Set(include)), exclude, { order: p.f.topo ? 'topo' : 'date', firstParent: !!p.f.firstParent });
    if (p.f.noMerges) list = list.filter((h) => repo.parents(h).length <= 1);
    if (p.f.reverse) list.reverse();
    if (p.o.max) list = list.slice(0, parseInt(p.o.max[0], 10));
    if (p.f.count) { ctx.print(list.length + '\n'); return; }
    ctx.print(list.join('\n') + (list.length ? '\n' : ''));
  };

  /* ---------------- git shortlog ---------------- */
  COMMANDS.shortlog = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '-s': 'summary', '-n': 'numbered', '-e': 'email', '--summary': 'summary', '--numbered': 'numbered' } }, 'shortlog');
    const hc = repo.headCommit();
    if (!hc) return;
    const list = repo.revWalk([hc], [], { order: 'date' });
    const groups = new Map();
    list.forEach((h) => {
      const c = repo.commitObj(h);
      const key = c.author.name + (p.f.email ? ` <${c.author.email}>` : '');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(U.subjectOf(c.message));
    });
    let keys = Array.from(groups.keys());
    if (p.f.numbered) keys.sort((a, b) => groups.get(b).length - groups.get(a).length || (a < b ? -1 : 1)); else keys.sort();
    let out = '';
    keys.forEach((k) => {
      const subs = groups.get(k);
      if (p.f.summary) out += `${String(subs.length).padStart(6)}\t${k}\n`;
      else { out += `${k} (${subs.length}):\n` + subs.slice().reverse().map((s) => '      ' + s).join('\n') + '\n\n'; }
    });
    ctx.print(out);
  };

  /* ---------------- git blame (간단 버전) ---------------- */
  COMMANDS.blame = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '-s': 'short', '-e': 'email', '-w': 'ws' }, opts: { '-L': 'range' } }, 'blame');
    const file = p.rest.filter((a) => !a.startsWith('-')).slice(-1)[0] || p.dd[0];
    const revArg = p.rest.length > 1 ? p.rest[0] : null;
    if (!file) throw fail('usage: git blame [<options>] [<rev-opts>] [<rev>] [--] <file>', 129);
    const start = revArg ? repo.resolveCommit(revArg) : repo.headCommit();
    if (!start) throw die('no such ref: HEAD');
    const flat = repo.commitFlat(start);
    const useWork = !revArg;
    let curText;
    if (useWork && repo.work.has(file) && repo.index.has(file)) curText = repo.work.get(file); else if (flat.has(file)) curText = repo.blobContent(flat.get(file).hash); else throw die(`no such path ${file} in HEAD`);
    const lines = Diff.splitLines(curText);
    let blameOf = new Array(lines.length).fill(null);
    // 첫 부모 선형 이력을 따라가며 줄 귀속
    let curHash = start;
    let curLines = lines;
    let mapping = lines.map((_, i) => i); // 현재 커밋의 줄 i → 최종 파일 줄 번호
    const uncommitted = useWork && curText !== (flat.has(file) ? repo.blobContent(flat.get(file).hash) : '');
    if (uncommitted) {
      const headLines = Diff.splitLines(flat.has(file) ? repo.blobContent(flat.get(file).hash) : '');
      const blocks = Diff.diffBlocks(headLines, lines);
      const newMap = [];
      const changed = new Set();
      blocks.forEach((b) => { for (let k = b.b0; k < b.b1; k++) changed.add(k); });
      changed.forEach((k) => { blameOf[k] = { hash: ZERO, final: k, work: true }; });
      let hi = 0, li = 0;
      const mp = [];
      while (li < lines.length) {
        if (changed.has(li)) { li++; continue; }
        mp.push({ cur: hi, fin: li });
        hi++; li++;
        void newMap;
      }
      // 단순화: 변경되지 않은 줄은 HEAD 와 일치
      curLines = headLines;
      mapping = new Array(headLines.length).fill(-1);
      let bi = 0;
      let fin = 0;
      const unchangedFinal = [];
      for (let k = 0; k < lines.length; k++) if (!changed.has(k)) unchangedFinal.push(k);
      void bi; void fin;
      // HEAD 줄 중 남아있는 줄 ↔ 최종 줄 매칭
      const matchedHead = [];
      let hpos = 0;
      blocks.forEach((b) => { for (; hpos < b.a0; hpos++) matchedHead.push(hpos); hpos = b.a1; });
      for (; hpos < headLines.length; hpos++) matchedHead.push(hpos);
      matchedHead.forEach((hl, idx) => { mapping[hl] = unchangedFinal[idx]; });
    }
    const resolveFile = (h) => { const f = repo.commitFlat(h); return f.has(file) ? Diff.splitLines(repo.blobContent(f.get(file).hash)) : null; };
    for (let guard = 0; guard < 1000; guard++) {
      const c = repo.commitObj(curHash);
      const parent = c.parents[0];
      const parentLines = parent ? resolveFile(parent) : null;
      if (!parentLines) {
        mapping.forEach((fin, i) => { if (fin >= 0 && !blameOf[fin]) blameOf[fin] = { hash: curHash, orig: i + 1 }; });
        break;
      }
      const blocks = Diff.diffBlocks(parentLines, curLines);
      const added = new Set();
      blocks.forEach((b) => { for (let k = b.b0; k < b.b1; k++) added.add(k); });
      const newMapping = new Array(parentLines.length).fill(-1);
      let pi = 0;
      for (let k = 0; k < curLines.length; k++) {
        if (added.has(k)) { if (mapping[k] >= 0 && !blameOf[mapping[k]]) blameOf[mapping[k]] = { hash: curHash, orig: k + 1 }; continue; }
        // 변경되지 않은 줄은 부모의 대응 줄
        while (pi < parentLines.length && blocks.some((b) => pi >= b.a0 && pi < b.a1)) pi++;
        if (pi < parentLines.length) { newMapping[pi] = mapping[k]; pi++; }
      }
      curHash = parent; curLines = parentLines; mapping = newMapping;
      if (mapping.every((x) => x < 0 || blameOf[x])) break;
    }
    let range = [1, lines.length];
    if (p.o.range) { const m = p.o.range[0].match(/^(\d+)(?:,(\+?)(\d+))?$/); if (m) range = [parseInt(m[1], 10), m[3] ? (m[2] ? parseInt(m[1], 10) + parseInt(m[3], 10) - 1 : parseInt(m[3], 10)) : parseInt(m[1], 10)]; }
    const nameW = Math.max(...lines.map((_, i) => ((blameOf[i] && blameOf[i].hash !== ZERO ? repo.commitObj(blameOf[i].hash).author.name : 'Not Committed Yet').length)));
    let out = '';
    const wLines = String(lines.length).length;
    lines.forEach((ln, i) => {
      if (i + 1 < range[0] || i + 1 > range[1]) return;
      const b = blameOf[i] || { hash: ZERO };
      const isWork = b.hash === ZERO;
      const c = isWork ? null : repo.commitObj(b.hash);
      const who = isWork ? 'Not Committed Yet' : c.author.name;
      const date = isWork ? U.formatDate(ctx.now, ctx.sim.tz, 'iso', ctx.now) : U.formatDate(c.author.ts, c.author.tz, 'iso', ctx.now);
      const h = isWork ? '00000000' : repo.shortHash(b.hash, 7).padEnd(8, '0').slice(0, 8).replace(/^(.{7})0$/, '$1');
      const hh = isWork ? '00000000' : (c.parents.length === 0 ? '^' + repo.shortHash(b.hash, 7) : repo.shortHash(b.hash, 8));
      void h;
      if (p.f.short) out += `${hh} ${String(i + 1).padStart(wLines)}) ${ln.replace(/\n$/, '')}\n`;
      else out += `${hh} (${who.padEnd(nameW)} ${date} ${String(i + 1).padStart(wLines)}) ${ln.replace(/\n$/, '')}\n`;
    });
    ctx.print(out);
  };

  /* ---------------- git describe ---------------- */
  COMMANDS.describe = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '--tags': 'tags', '--always': 'always', '--abbrev=0': 'abbrev0', '--long': 'long' } }, 'describe');
    const target = repo.resolveCommit(p.rest[0] || 'HEAD');
    if (!target) throw die('No names found, cannot describe anything.');
    const tags = new Map();
    repo.listRefs('refs/tags/').forEach(([n, h]) => {
      const obj = repo.get(h);
      if (!p.f.tags && obj.type !== 'tag') return;
      tags.set(repo.peelToCommit(h), n.slice(10));
    });
    // BFS 로 가장 가까운 태그 찾기
    let best = null;
    const seen = new Set([target]);
    let frontier = [{ h: target, depth: 0 }];
    while (frontier.length && !best) {
      const next = [];
      for (const f of frontier) {
        if (tags.has(f.h)) { best = f; break; }
        repo.parents(f.h).forEach((pp) => { if (!seen.has(pp)) { seen.add(pp); next.push({ h: pp, depth: f.depth + 1 }); } });
      }
      frontier = next;
    }
    if (!best) {
      if (p.f.always) { ctx.print(repo.shortHash(target, 7) + '\n'); return; }
      throw die('No names found, cannot describe anything.');
    }
    // 태그와 target 사이 커밋 수
    const anc = repo.ancestors(best.h);
    let count = 0;
    repo.ancestors(target).forEach((h) => { if (!anc.has(h)) count++; });
    if (count === 0 && !p.f.long) ctx.print(tags.get(best.h) + '\n');
    else ctx.print(`${tags.get(best.h)}-${count}-g${repo.shortHash(target, 7)}\n`);
  };

  G.logHelpers = { parseRevArgs, formatCommitText, parseDateFilter };
})();
