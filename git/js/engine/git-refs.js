/* git 명령어 구현 (3): branch / tag / checkout / switch / restore / reset / clean / 배관 명령 */
(function () {
  'use strict';
  const G = (globalThis.GitEngine = globalThis.GitEngine || {});
  const { Diff, sha1, GitError, ZERO, cleanupMessage, pathspecMatcher } = G;
  const U = G.util;
  const C = G.core;
  const { die, fail, parseArgs, plural } = U;
  const COMMANDS = G.commands;

  const HINT_DETACHED = (name) => `Note: switching to '${name}'.

You are in 'detached HEAD' state. You can look around, make experimental
changes and commit them, and you can discard any commits you make in this
state without impacting any branches by switching back to a branch.

If you want to create a new branch to retain commits you create, you may
do so (now or later) by using -c with the switch command. Example:

  git switch -c <new-branch-name>

Or undo this operation with:

  git switch -

Turn off this advice by setting config variable advice.detachedHead to false

`;

  function worktreePath(ctx, repo) { return `${ctx.sim.homePath}/${repo.name}`; }
  function cfgBool(v, def) { if (v === undefined) return def; return !/^(false|no|off|0)$/i.test(String(v)); }
  function describeHead(ctx, repo, hash) { return `${repo.shortHash(hash, 7)} ${U.subjectOf(repo.commitObj(hash).message)}`; }
  function identOf(ctx) { return ctx.ident('committer'); }

  /* ---------------- 패턴(글롭) ---------------- */
  function globMatch(pattern, s) {
    let re = '^';
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === '*') re += '.*';
      else if (c === '?') re += '.';
      else if (c === '[') { const j = pattern.indexOf(']', i); if (j < 0) re += '\\['; else { re += pattern.slice(i, j + 1).replace('[!', '[^'); i = j; } }
      else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(re + '$').test(s);
  }

  /* ---------------- for-each-ref 스타일 포맷 ---------------- */
  function refFormat(ctx, repo, fmt, refname, hash) {
    const obj = repo.get(hash);
    const commitHash = repo.peelToCommit(hash);
    const c = commitHash ? repo.commitObj(commitHash) : null;
    const tagObj = obj && obj.type === 'tag' ? obj : null;
    const short = (r) => r.replace(/^refs\/(heads|tags|remotes)\//, '');
    const dateFmt = (ident, style) => (ident ? U.formatDate(ident.ts, ident.tz, style || 'default', ctx.now) : '');
    return fmt.replace(/%\(([^)]+)\)/g, (m, atom) => {
      const [name, mod] = atom.split(':');
      switch (name) {
        case 'refname': return mod === 'short' ? short(refname) : refname;
        case 'objectname': return mod === 'short' ? repo.shortHash(hash, 7) : hash;
        case 'objecttype': return obj ? obj.type : '';
        case 'HEAD': return repo.head.ref === refname ? '*' : ' ';
        case 'subject': return c ? U.subjectOf(c.message) : '';
        case 'body': return c ? U.bodyOf(c.message) : '';
        case 'contents': return tagObj ? tagObj.message : (c ? c.message : '');
        case 'authorname': return c ? c.author.name : '';
        case 'authoremail': return c ? `<${c.author.email}>` : '';
        case 'authordate': return c ? dateFmt(c.author, mod) : '';
        case 'committername': return c ? c.committer.name : '';
        case 'committeremail': return c ? `<${c.committer.email}>` : '';
        case 'committerdate': return c ? dateFmt(c.committer, mod) : '';
        case 'creatordate': return tagObj ? dateFmt(tagObj.tagger, mod) : (c ? dateFmt(c.committer, mod) : '');
        case 'taggername': return tagObj ? tagObj.tagger.name : '';
        case 'taggerdate': return tagObj ? dateFmt(tagObj.tagger, mod) : '';
        case 'tag': return tagObj ? tagObj.tag : '';
        case '*objectname': return tagObj ? (mod === 'short' ? repo.shortHash(tagObj.object, 7) : tagObj.object) : '';
        case 'upstream': {
          const br = refname.replace(/^refs\/heads\//, '');
          const up = repo.upstreamRef(br);
          if (!up) return '';
          return mod === 'short' ? up.replace(/^refs\/(remotes|heads)\//, '') : up;
        }
        case 'upstream:track': case 'upstream:trackshort': return '';
        default: return m;
      }
    });
  }

  function sortRefs(ctx, repo, list, keys) {
    if (!keys.length) return list;
    const val = (key, [refname, hash]) => {
      const k = key.replace(/^-/, '');
      if (k === 'refname') return refname;
      if (k === 'objectname') return hash;
      const c = repo.commitObj(repo.peelToCommit(hash) || '');
      if (!c) return '';
      if (k === 'committerdate' || k === 'creatordate') return c.committer.ts;
      if (k === 'authordate') return c.author.ts;
      if (k === 'authorname') return c.author.name;
      if (k === 'committername') return c.committer.name;
      if (k === 'taggerdate') { const o = repo.get(hash); return o && o.type === 'tag' ? o.tagger.ts : 0; }
      if (k === 'version:refname' || k === 'v:refname') return refname;
      return '';
    };
    const out = list.slice();
    keys.slice().reverse().forEach((key) => {
      const desc = key.startsWith('-');
      const ver = /version:refname|v:refname/.test(key);
      out.sort((a, b) => {
        const va = val(key, a), vb = val(key, b);
        let r;
        if (ver) r = versionCompare(va, vb);
        else r = va < vb ? -1 : va > vb ? 1 : 0;
        return desc ? -r : r;
      });
    });
    return out;
  }
  function versionCompare(a, b) {
    const sa = a.split(/(\d+)/), sb = b.split(/(\d+)/);
    for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
      const x = sa[i] || '', y = sb[i] || '';
      if (/^\d+$/.test(x) && /^\d+$/.test(y)) { const d = parseInt(x, 10) - parseInt(y, 10); if (d) return d; } else if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }

  /* ---------------- branch ---------------- */
  function trackSummary(ctx, repo, branch, hash) {
    const upRef = repo.upstreamRef(branch);
    if (!upRef) return '';
    const upName = upRef.replace(/^refs\/remotes\//, '').replace(/^refs\/heads\//, '');
    const upHash = repo.readRef(upRef);
    if (!upHash) return ` [${ctx.paint('blue', upName)}: gone]`;
    const { ahead, behind } = U.aheadBehind(repo, hash, upHash);
    let t = '';
    if (ahead && behind) t = `: ahead ${ahead}, behind ${behind}`;
    else if (ahead) t = `: ahead ${ahead}`;
    else if (behind) t = `: behind ${behind}`;
    return ` [${ctx.paint('blue', upName)}${t}]`;
  }

  function setUpstream(ctx, repo, branch, upstreamSpec, quiet) {
    let remote, mergeRef, label;
    if (upstreamSpec === branch && repo.refs.has('refs/heads/' + upstreamSpec)) {
      ctx.eprint(`warning: not setting branch '${branch}' as its own upstream\n`);
      return;
    }
    if (repo.refs.has('refs/heads/' + upstreamSpec)) { remote = '.'; mergeRef = 'refs/heads/' + upstreamSpec; label = upstreamSpec; } else if (repo.refs.has('refs/remotes/' + upstreamSpec)) {
      const idx = upstreamSpec.indexOf('/');
      remote = upstreamSpec.slice(0, idx); mergeRef = 'refs/heads/' + upstreamSpec.slice(idx + 1); label = upstreamSpec;
    } else {
      throw new GitError(`fatal: the requested upstream branch '${upstreamSpec}' does not exist\nhint: \nhint: If you are planning on basing your work on an upstream\nhint: branch that already exists at the remote, you may need to\nhint: run "git fetch" to retrieve it.\nhint: \nhint: If you are planning to push out a new local branch that\nhint: will track its remote counterpart, you may want to use\nhint: "git push -u" to set the upstream config as you push.\nhint: Disable this message with "git config advice.setUpstreamFailure false"`.replace(/hint: \n/g, 'hint:\n'), 128);
    }
    repo.config.set(`branch.${branch}.remote`, remote);
    repo.config.set(`branch.${branch}.merge`, mergeRef);
    if (!quiet) ctx.print(`branch '${branch}' set up to track '${label}'.\n`);
  }
  function unsetUpstream(repo, branch) {
    repo.config.delete(`branch.${branch}.remote`);
    repo.config.delete(`branch.${branch}.merge`);
  }

  function branchFromStart(ctx, repo, startSpec) {
    const spec = startSpec || 'HEAD';
    const h = repo.resolveCommit(spec);
    if (!h) {
      if (!startSpec && repo.isUnborn()) throw die(`not a valid object name: '${repo.currentBranch()}'`);
      throw die(`not a valid object name: '${spec}'`);
    }
    return h;
  }

  function validBranchName(name) {
    return name && !/[\s~^:?*[\\]|\.\.|^[-.]|\.lock$|\/$|^\/|@\{|\/\/|\.$/.test(name) && name !== '@';
  }

  /* --merged / --contains 처럼 값이 선택인 옵션: 다음 인자를 값으로 취급, 없으면 HEAD */
  function normalizeOptionalCommitOpts(args, names) {
    const out = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (names.includes(a)) {
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith('-')) { out.push(a + '=' + next); i++; } else out.push(a + '=HEAD');
      } else out.push(a);
    }
    return out;
  }

  COMMANDS.branch = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    args = normalizeOptionalCommitOpts(args, ['--merged', '--no-merged', '--contains']);
    const p = parseArgs(args, {
      flags: {
        '-a': 'all', '--all': 'all', '-r': 'remotes', '--remotes': 'remotes', '-v': 'v', '-vv': 'vv', '--verbose': 'v', '-d': 'delete', '--delete': 'delete', '-D': 'forceDelete',
        '-m': 'move', '--move': 'move', '-M': 'forceMove', '-c': 'copy', '--copy': 'copy', '-C': 'forceCopy', '-f': 'force', '--force': 'force', '-l': 'list', '--list': 'list',
        '--show-current': 'showCurrent', '--unset-upstream': 'unsetUp', '--no-track': 'noTrack', '-q': 'quiet', '--quiet': 'quiet', '--no-color': 'noColor', '--color': 'color',
        '-t': 'track', '--track': 'track', '--edit-description': 'editDesc',
      },
      opts: { '-u': 'setUp', '--set-upstream-to': 'setUp', '--contains': 'contains', '--merged': 'merged', '--no-merged': 'noMerged', '--format': 'format', '--sort': 'sort', '--points-at': 'pointsAt' },
    }, 'branch');
    const f = p.f;
    const verbose = f.v ? 1 : 0;
    const vv = args.reduce((n, a) => n + (/^-v+$/.test(a) ? a.length - 1 : (a === '--verbose' ? 1 : 0)), 0) >= 2;
    const doList = f.list || (!p.rest.length && !f.delete && !f.forceDelete && !f.move && !f.forceMove && !f.copy && !f.forceCopy && !p.o.setUp && !f.unsetUp && !f.showCurrent && !f.editDesc) || false;

    if (f.showCurrent) { if (repo.currentBranch()) ctx.print(repo.currentBranch() + '\n'); return; }

    if (f.delete || f.forceDelete) {
      if (!p.rest.length) throw die('branch name required');
      let err = false;
      const cur = repo.currentBranch();
      p.rest.forEach((name) => {
        const ref = f.remotes ? 'refs/remotes/' + name : 'refs/heads/' + name;
        const h = repo.readRef(ref);
        if (!h) { ctx.eprint(`error: ${f.remotes ? 'remote-tracking branch' : 'branch'} '${name}' not found\n`); err = true; return; }
        if (!f.remotes && name === cur) { ctx.eprint(`error: cannot delete branch '${name}' used by worktree at '${worktreePath(ctx, repo)}'\n`); err = true; return; }
        if (!f.forceDelete) {
          const up = repo.upstreamRef(name);
          const base = (up && repo.readRef(up)) || repo.headCommit();
          if (base && !repo.isAncestor(h, base)) {
            ctx.eprint(`error: the branch '${name}' is not fully merged\n`);
            if (cfgBool(ctx.cfg('advice.forcedeletebranch'), true)) ctx.eprint(`hint: If you are sure you want to delete it, run 'git branch -D ${name}'\nhint: Disable this message with "git config advice.forceDeleteBranch false"\n`);
            err = true; return;
          }
        }
        repo.deleteRef(ref);
        repo.reflogs.delete(ref);
        if (!f.remotes) { unsetUpstream(repo, name); }
        ctx.print(`Deleted ${f.remotes ? 'remote-tracking branch' : 'branch'} ${name} (was ${repo.shortHash(h, 7)}).\n`);
      });
      if (err) throw fail('', 1);
      return;
    }

    if (f.move || f.forceMove || f.copy || f.forceCopy) {
      const isMove = f.move || f.forceMove;
      const force = f.forceMove || f.forceCopy;
      let oldName, newName;
      if (p.rest.length === 1) { oldName = repo.currentBranch(); newName = p.rest[0]; if (!oldName) throw die('cannot rename the current branch while not on any'); } else if (p.rest.length === 2) { oldName = p.rest[0]; newName = p.rest[1]; } else throw die('too many arguments');
      if (!repo.refs.has('refs/heads/' + oldName) && !(repo.currentBranch() === oldName && repo.isUnborn())) throw die(`no branch named '${oldName}'`);
      if (!validBranchName(newName)) throw die(`'${newName}' is not a valid branch name`);
      if (repo.refs.has('refs/heads/' + newName) && !force) throw die(`a branch named '${newName}' already exists`);
      const ident = identOf(ctx);
      const h = repo.readRef('refs/heads/' + oldName);
      if (isMove) {
        const wasCurrent = repo.currentBranch() === oldName;
        if (h) {
          const log = repo.readReflog('refs/heads/' + oldName).slice();
          repo.refs.delete('refs/heads/' + oldName);
          repo.reflogs.delete('refs/heads/' + oldName);
          repo.refs.set('refs/heads/' + newName, h);
          repo.reflogs.set('refs/heads/' + newName, log);
          repo.logRef('refs/heads/' + newName, h, h, `Branch: renamed refs/heads/${oldName} to refs/heads/${newName}`, ident);
        }
        // 설정 이전
        ['remote', 'merge'].forEach((k) => {
          const v = repo.config.get(`branch.${oldName}.${k}`);
          if (v !== undefined) { repo.config.set(`branch.${newName}.${k}`, v); repo.config.delete(`branch.${oldName}.${k}`); }
        });
        if (wasCurrent) {
          repo.head = { ref: 'refs/heads/' + newName };
          if (h) repo.logRef('HEAD', h, h, `Branch: renamed refs/heads/${oldName} to refs/heads/${newName}`, ident);
        }
      } else {
        repo.refs.set('refs/heads/' + newName, h);
        repo.logRef('refs/heads/' + newName, ZERO, h, `Branch: copied refs/heads/${oldName} to refs/heads/${newName}`, ident);
      }
      return;
    }

    if (f.unsetUp) {
      const name = p.rest[0] || repo.currentBranch();
      if (!repo.refs.has('refs/heads/' + name)) throw die(`branch '${name}' does not exist`);
      if (!repo.config.get(`branch.${name}.merge`)) throw die(`branch '${name}' has no upstream information`);
      unsetUpstream(repo, name);
      return;
    }
    if (p.o.setUp) {
      const name = p.rest[0] || repo.currentBranch();
      if (!name || !repo.refs.has('refs/heads/' + name)) throw die(`branch '${name || 'HEAD'}' does not exist`);
      setUpstream(ctx, repo, name, p.o.setUp[0], f.quiet);
      return;
    }

    if (!doList) {
      // 브랜치 만들기
      const name = p.rest[0];
      if (!validBranchName(name)) throw die(`'${name}' is not a valid branch name`);
      if (repo.refs.has('refs/heads/' + name) && !f.force) throw die(`a branch named '${name}' already exists`);
      if (f.force && name === repo.currentBranch()) throw die(`cannot force update the branch '${name}' used by worktree at '${worktreePath(ctx, repo)}'`);
      const startSpec = p.rest[1];
      const h = branchFromStart(ctx, repo, startSpec);
      const ident = identOf(ctx);
      const existed = repo.refs.has('refs/heads/' + name);
      const old = repo.readRef('refs/heads/' + name);
      const msg = existed ? `branch: Reset to ${startSpec || 'HEAD'}` : `branch: Created from ${startSpec || 'HEAD'}`;
      repo.refs.set('refs/heads/' + name, h);
      repo.logRef('refs/heads/' + name, old || ZERO, h, msg, ident);
      // 원격 추적 브랜치에서 만들면 upstream 설정
      if (startSpec && !f.noTrack && repo.refs.has('refs/remotes/' + startSpec) && cfgBool(ctx.cfg('branch.autosetupmerge'), true)) setUpstream(ctx, repo, name, startSpec, f.quiet);
      else if (startSpec && f.track && repo.refs.has('refs/heads/' + startSpec)) setUpstream(ctx, repo, name, startSpec, f.quiet);
      return;
    }

    /* 목록 */
    const patterns = p.rest;
    const cur = repo.currentBranch();
    const color = ctx.color;
    void color;
    let entries = [];
    if (!f.remotes) repo.branches().forEach(([n, h]) => entries.push({ kind: 'local', name: n, ref: 'refs/heads/' + n, hash: h }));
    if (f.remotes || f.all) {
      repo.listRefs('refs/remotes/').forEach(([n, h]) => {
        const nm = n.slice(13);
        entries.push({ kind: 'remote', name: f.all ? 'remotes/' + nm : nm, ref: n, hash: h });
      });
      if (repo.symrefs) repo.symrefs.forEach((target, ref) => {
        if (!ref.startsWith('refs/remotes/')) return;
        const nm = ref.slice(13);
        entries.push({ kind: 'remote', name: f.all ? 'remotes/' + nm : nm, ref, hash: repo.refs.get(target), alias: target.slice(13) });
      });
    }
    entries.sort((a, b) => (a.kind === b.kind ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : (a.kind === 'local' ? -1 : 1)));
    if (patterns.length) entries = entries.filter((e) => patterns.some((pt) => globMatch(pt, e.name)));
    const filterHash = (spec) => { const h = spec ? repo.resolveCommit(spec) : repo.headCommit(); if (!h) throw die(`malformed object name ${spec}`); return h; };
    if (p.o.contains) { const h = filterHash(p.o.contains[0]); entries = entries.filter((e) => e.hash && repo.isAncestor(h, repo.peelToCommit(e.hash))); }
    if (p.o.merged) { const h = filterHash(p.o.merged[0]); entries = entries.filter((e) => repo.isAncestor(repo.peelToCommit(e.hash), h)); }
    if (p.o.noMerged) { const h = filterHash(p.o.noMerged[0] || 'HEAD'); entries = entries.filter((e) => !repo.isAncestor(repo.peelToCommit(e.hash), h)); }
    if (p.o.pointsAt) { const h = repo.resolveCommit(p.o.pointsAt[0]); entries = entries.filter((e) => e.hash === h); }
    if (p.o.sort) {
      const keys = p.o.sort;
      const sorted = sortRefs(ctx, repo, entries.map((e) => [e.ref, e.hash]), keys).map((x) => x[0]);
      entries.sort((a, b) => sorted.indexOf(a.ref) - sorted.indexOf(b.ref));
    }
    let out = '';
    if (p.o.format) {
      entries.forEach((e) => { out += refFormat(ctx, repo, p.o.format[0], e.ref, e.hash) + '\n'; });
      ctx.print(out);
      return;
    }
    const detached = repo.isDetached() && !f.remotes && !patterns.length;
    const width = Math.max(0, ...entries.map((e) => e.name.length + (e.alias ? 0 : 0)));
    if (detached) {
      const label = `(${U.detachedDescription(repo)})`;
      const hc = repo.headCommit();
      const pad = Math.max(width, label.length);
      let line = `* ${ctx.paint('green', label)}`;
      if (verbose || vv) line = `* ${ctx.paint('green', label.padEnd(pad))} ${repo.shortHash(hc, 7)} ${U.subjectOf(repo.commitObj(hc).message)}`;
      out += line + '\n';
    }
    const w2 = Math.max(width, detached && (verbose || vv) ? `(${U.detachedDescription(repo)})`.length : 0);
    entries.forEach((e) => {
      const isCur = e.kind === 'local' && e.name === cur && !repo.isDetached();
      const mark = isCur ? '* ' : '  ';
      let nm = e.name;
      const colored = isCur ? ctx.paint('green', nm) : (e.kind === 'remote' ? ctx.paint('red', nm) : nm);
      if (e.alias) { out += `${mark}${colored} -> ${e.alias}\n`; return; }
      if (verbose || vv) {
        const c = repo.commitObj(repo.peelToCommit(e.hash));
        let line = mark + colored + ' '.repeat(w2 - nm.length) + ' ' + repo.shortHash(e.hash, 7);
        if (vv && e.kind === 'local') line += trackSummary(ctx, repo, e.name, e.hash);
        line += ' ' + (c ? U.subjectOf(c.message) : '');
        out += line + '\n';
      } else out += mark + colored + '\n';
    });
    ctx.print(out);
  };

  /* ---------------- tag ---------------- */
  COMMANDS.tag = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    args = normalizeOptionalCommitOpts(args, ['--merged', '--no-merged', '--contains']);
    const p = parseArgs(args, {
      flags: { '-a': 'annotate', '--annotate': 'annotate', '-d': 'delete', '--delete': 'delete', '-l': 'list', '--list': 'list', '-f': 'force', '--force': 'force', '-s': 'sign', '-v': 'verify', '--verify': 'verify', '--no-color': 'noColor' },
      opts: { '-m': 'message', '--message': 'message', '-F': 'file', '--file': 'file', '--sort': 'sort', '--contains': 'contains', '--points-at': 'pointsAt', '--merged': 'merged', '--no-merged': 'noMerged', '--format': 'format' },
      optional: { '-n': 'lines' },
    }, 'tag');
    const f = p.f;
    if (f.delete) {
      if (!p.rest.length) throw fail('error: tag name required', 1);
      let err = false;
      p.rest.forEach((name) => {
        const h = repo.readRef('refs/tags/' + name);
        if (!h) { ctx.eprint(`error: tag '${name}' not found.\n`); err = true; return; }
        repo.deleteRef('refs/tags/' + name);
        ctx.print(`Deleted tag '${name}' (was ${repo.shortHash(h, 7)})\n`);
      });
      if (err) throw fail('', 1);
      return;
    }
    const creating = !f.list && p.rest.length > 0 && !p.o.lines;
    const listing = f.list || !creating;
    if (f.verify) throw fail('error: no signature found', 1);
    if (listing && !creating) {
      let list = repo.listRefs('refs/tags/').map(([n, h]) => [n, h]);
      const pats = p.rest;
      if (pats.length) list = list.filter(([n]) => pats.some((pt) => globMatch(pt, n.slice(10))));
      if (p.o.contains) { const h = repo.resolveCommit(p.o.contains[0]); list = list.filter(([, th]) => repo.isAncestor(h, repo.peelToCommit(th))); }
      if (p.o.pointsAt) { const h = repo.resolve(p.o.pointsAt[0]); list = list.filter(([, th]) => th === h || repo.peelToCommit(th) === h); }
      if (p.o.merged) { const h = repo.resolveCommit(p.o.merged[0]); list = list.filter(([, th]) => repo.isAncestor(repo.peelToCommit(th), h)); }
      if (p.o.noMerged) { const h = repo.resolveCommit(p.o.noMerged[0]); list = list.filter(([, th]) => !repo.isAncestor(repo.peelToCommit(th), h)); }
      if (p.o.sort) list = sortRefs(ctx, repo, list, p.o.sort);
      else if (!p.o.sort) {
        const cfgSort = ctx.cfg('tag.sort');
        if (cfgSort) list = sortRefs(ctx, repo, list, [cfgSort]);
      }
      let out = '';
      list.forEach(([n, h]) => {
        const name = n.slice(10);
        if (p.o.format) { out += refFormat(ctx, repo, p.o.format[0], n, h) + '\n'; return; }
        if (p.o.lines !== undefined) {
          const nl = p.o.lines[0] === '' ? 1 : parseInt(p.o.lines[0], 10);
          const obj = repo.get(h);
          const msg = obj && obj.type === 'tag' ? obj.message : repo.commitObj(repo.peelToCommit(h)).message;
          const ls = msg.replace(/\n+$/, '').split('\n');
          const shown = nl > 0 ? ls.slice(0, nl) : [];
          out += name.padEnd(15) + ' ' + (shown[0] || '') + '\n';
          shown.slice(1).forEach((l) => { out += ' '.repeat(16) + l + '\n'; });
          return;
        }
        out += name + '\n';
      });
      ctx.print(out);
      return;
    }
    // 생성
    const name = p.rest[0];
    if (!name || /[\s~^:?*[\\]|\.\.|^-|\.lock$|\/$|@\{/.test(name)) throw die(`'${name}' is not a valid tag name.`);
    const exists = repo.refs.has('refs/tags/' + name);
    if (exists && !f.force) throw die(`tag '${name}' already exists`);
    const targetSpec = p.rest[1] || 'HEAD';
    const targetHash = repo.resolve(targetSpec);
    if (!targetHash) throw die(`Failed to resolve '${targetSpec}' as a valid ref.`);
    const old = repo.readRef('refs/tags/' + name);
    const annotated = f.annotate || f.sign || p.o.message || p.o.file;
    let ref = targetHash;
    if (annotated) {
      let message;
      if (p.o.message) message = cleanupMessage(p.o.message.join('\n\n'), false);
      else if (p.o.file) message = cleanupMessage(ctx.sim.readFileForGit ? ctx.sim.readFileForGit(ctx, p.o.file[0]) : '', false);
      else {
        const tpl = `\n#\n# Write a message for tag:\n#   ${name}\n# Lines starting with '#' will be ignored.\n`;
        message = cleanupMessage(ctx.input('editor', { kind: 'TAG_EDITMSG', initial: tpl }), true);
        if (!message) throw fail('fatal: no tag message?', 128);
      }
      const tagger = identOf(ctx);
      const obj = repo.get(targetHash);
      ref = repo.putTag({ object: targetHash, objType: obj.type, tag: name, tagger, message: message.endsWith('\n') ? message : message + '\n' });
    }
    repo.refs.set('refs/tags/' + name, ref);
    if (exists && f.force && old !== ref) ctx.print(`Updated tag '${name}' (was ${repo.shortHash(old, 7)})\n`);
  };

  /* ---------------- checkout / switch 공통 ---------------- */
  function orphanWarning(ctx, repo, oldCommit, newCommit) {
    // oldCommit 에서만 도달 가능한 (어떤 ref 와도 연결되지 않은) 커밋
    const exclude = repo.allTips().filter((t) => t !== oldCommit || false);
    const keep = new Set();
    exclude.forEach((t) => repo.ancestors(t).forEach((x) => keep.add(x)));
    if (newCommit) repo.ancestors(newCommit).forEach((x) => keep.add(x));
    // 현재 HEAD(detached) 자체는 ref 가 아니므로 allTips 에서 제외해야 한다
    const refTips = [];
    repo.refs.forEach((h, n) => { if (n !== 'refs/stash') { const c = repo.peelToCommit(h); if (c) refTips.push(c); } });
    const keep2 = new Set();
    refTips.forEach((t) => repo.ancestors(t).forEach((x) => keep2.add(x)));
    if (newCommit) repo.ancestors(newCommit).forEach((x) => keep2.add(x));
    if (keep2.has(oldCommit)) {
      ctx.eprint(`Previous HEAD position was ${describeHead(ctx, repo, oldCommit)}\n`);
      return;
    }
    const lost = repo.revWalk([oldCommit], Array.from(new Set(refTips.concat(newCommit ? [newCommit] : []))), { order: 'date' });
    const n = lost.length;
    let t = `Warning: you are leaving ${n} commit${n === 1 ? '' : 's'} behind, not connected to\nany of your branches:\n\n`;
    lost.forEach((h) => { t += `  ${repo.shortHash(h, 7)} ${U.subjectOf(repo.commitObj(h).message)}\n`; });
    t += `\nIf you want to keep ${n === 1 ? 'it' : 'them'} by creating a new branch, this may be a good time\nto do so with:\n\n git branch <new-branch-name> ${repo.shortHash(oldCommit, 7)}\n\n`;
    ctx.eprint(t);
  }

  function headLabel(repo) { return repo.head.ref ? repo.currentBranch() : repo.headCommit(); }

  /*
   * 실제로 HEAD/인덱스/작업트리를 옮긴다.
   *  opts: { target: {ref}|{hash}, targetCommit, label, create, reset, force, quiet, orphan, track, mode:'checkout'|'switch' }
   */
  function doSwitch(ctx, repo, opts) {
    const ident = identOf(ctx);
    const oldCommit = repo.headCommit();
    const oldWasBranch = !!repo.head.ref;
    const oldLabel = headLabel(repo) || 'HEAD';
    const newCommit = opts.targetCommit || null;
    const sameBranch = opts.target.ref && repo.head.ref === opts.target.ref;
    const wantFlat = newCommit ? repo.commitFlat(newCommit) : new Map();

    if (opts.orphan) {
      // 인덱스/작업트리는 그대로, HEAD 만 새 (아직 없는) 브랜치로
      const orphanLines = C.localChangeLines(repo);
      if (orphanLines.length) ctx.print(orphanLines.join('\n') + '\n');
      repo.head = { ref: opts.target.ref };
      if (!opts.quiet) ctx.eprint(`Switched to a new branch '${opts.label}'\n`);
      if (newCommit) {
        // --orphan <name> <start>: 시작 지점의 트리를 가져온다
        C.hardResetTo(repo, wantFlat);
      }
      return;
    }

    if (!sameBranch || opts.reset || oldCommit !== newCommit) {
      if (opts.force) {
        C.hardResetTo(repo, wantFlat);
        repo.state.merge = null; repo.state.cherryPick = null; repo.state.revert = null;
      } else if (oldCommit !== newCommit) {
        const r = C.switchTree(ctx, repo, wantFlat, {});
        if (r.conflicts.length || r.untrackedOverwrite.length) throw fail(C.switchErrorMessage(r, 'checkout'), 1);
      }
    }
    const lines = oldCommit !== newCommit ? C.localChangeLines.call(null, repo) : [];
    // switchTree 는 HEAD 를 바꾸기 전에 호출되므로 localChangeLines 는 새 HEAD 기준으로 다시 계산한다
    void lines;
    const savedHead = repo.head;
    const savedRef = oldCommit;
    // 새 HEAD 로 이동 (로컬 변경 목록 계산을 위해 임시 반영)
    const tmpHead = opts.target.ref ? { ref: opts.target.ref } : { hash: newCommit };
    let oldRefVal = null;
    if (opts.reset && !opts.create) { oldRefVal = repo.readRef(opts.target.ref); repo.refs.set(opts.target.ref, newCommit); }
    if (opts.create) {
      const old = repo.readRef(opts.target.ref);
      repo.refs.set(opts.target.ref, newCommit);
      repo.logRef(opts.target.ref, old || ZERO, newCommit, opts.createMsg || 'branch: Created from HEAD', ident);
    } else if (opts.target.ref && !repo.refs.has(opts.target.ref)) {
      repo.refs.set(opts.target.ref, newCommit);
    }
    repo.head = tmpHead;
    const changes = !opts.force ? C.localChangeLines(repo) : [];
    repo.head = savedHead;
    void savedRef;
    if (changes.length) ctx.print(changes.join('\n') + '\n');
    if (!opts.quiet && !oldWasBranch && oldCommit && newCommit !== oldCommit) orphanWarning(ctx, repo, oldCommit, newCommit);
    const msg = `checkout: moving from ${oldLabel} to ${opts.label}`;
    if (opts.target.ref && opts.reset && !opts.create) {
      repo.logRef(opts.target.ref, oldRefVal || ZERO, newCommit, opts.resetMsg || 'branch: Reset to HEAD', ident);
      if (sameBranch) repo.logRef('HEAD', oldRefVal || ZERO, newCommit, opts.resetMsg || 'branch: Reset to HEAD', ident);
    }
    const detachedNoop = !oldWasBranch && !tmpHead.ref && oldCommit === newCommit;
    if (detachedNoop) repo.head = tmpHead; else repo.setHead(tmpHead, msg, ident);
    if (opts.track) setUpstream(ctx, repo, opts.target.ref.replace(/^refs\/heads\//, ''), opts.track, opts.quiet);
    if (opts.quiet) return;
    if (!opts.target.ref) {
      const name = opts.label;
      if (oldWasBranch && !opts.detachQuiet && opts.advice !== false && cfgBool(ctx.cfg('advice.detachedhead'), true) && !opts.forceDetach) ctx.eprint(HINT_DETACHED(name));
      ctx.eprint(`HEAD is now at ${describeHead(ctx, repo, newCommit)}\n`);
      return;
    }
    const brName = opts.target.ref.replace(/^refs\/heads\//, '');
    if (opts.create) ctx.eprint(opts.reset ? `Switched to and reset branch '${brName}'\n` : `Switched to a new branch '${brName}'\n`);
    else if (opts.reset) ctx.eprint(sameBranch ? `Reset branch '${brName}'\n` : `Switched to and reset branch '${brName}'\n`);
    else if (sameBranch) ctx.eprint(`Already on '${brName}'\n`);
    else ctx.eprint(`Switched to branch '${brName}'\n`);
    if (opts.create) return;
    const tm = U.trackingMessage(ctx, repo, brName);
    if (tm) ctx.print(tm.text);
  }

  /* 경로 복원: source = Map(path → {hash,mode}) */
  function restoreToPaths(ctx, repo, opts) {
    const { source, paths, toIndex, toWork } = opts;
    const matcher = pathspecMatcher(paths);
    const universe = new Set();
    source.forEach((_, p) => { if (matcher(p)) universe.add(p); });
    if (opts.includeIndex) {
      repo.index.forEach((_, p) => { if (matcher(p)) universe.add(p); });
      repo.unmerged.forEach((_, p) => { if (matcher(p)) universe.add(p); });
    }
    if (opts.includeWork) repo.work.forEach((_, p) => { if (matcher(p) && (repo.index.has(p) || source.has(p))) universe.add(p); });
    if (!universe.size) return { matched: 0 };
    let updated = 0;
    Array.from(universe).sort().forEach((p) => {
      const s = source.get(p);
      if (repo.unmerged.has(p) && !opts.stage && !toIndex) {
        if (!opts.ours && !opts.theirs && !opts.force) { ctx.eprint(`error: path '${p}' is unmerged\n`); opts.hadError = true; return; }
      }
      let entry = s;
      if (opts.stage) { const st = repo.unmerged.get(p); entry = st && st[opts.stage]; if (!entry) { ctx.eprint(`error: path '${p}' does not have ${opts.stage === 2 ? 'our' : 'their'} version\n`); opts.hadError = true; return; } }
      if (toIndex) {
        if (entry) repo.index.set(p, { hash: entry.hash, mode: entry.mode }); else repo.index.delete(p);
        repo.unmerged.delete(p);
      }
      if (toWork) {
        if (entry) repo.work.set(p, repo.blobContent(entry.hash)); else { repo.work.delete(p); C.removeEmptyParents(repo, p); }
      }
      updated++;
    });
    return { matched: universe.size, updated };
  }

  function noMatch(paths) { return fail(`error: pathspec '${paths.find(Boolean)}' did not match any file(s) known to git`, 1); }
  function explainNoMatch(repo, paths, universe) {
    const matcher = (s) => pathspecMatcher([s]);
    const bad = paths.find((s) => { const m = matcher(s); let hit = false; universe.forEach((_, p) => { if (m(p)) hit = true; }); return !hit; });
    return bad;
  }

  COMMANDS.checkout = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, {
      flags: { '-q': 'quiet', '--quiet': 'quiet', '-f': 'force', '--force': 'force', '--detach': 'detach', '-t': 'track', '--track': 'track', '--no-track': 'noTrack', '-m': 'merge', '--merge': 'merge', '-p': 'patch', '--patch': 'patch', '--ours': 'ours', '--theirs': 'theirs', '--no-guess': 'noGuess', '--guess': 'guess', '--progress': 'progress', '--no-progress': 'noProgress', '-l': 'reflogCreate' },
      opts: { '-b': 'newBranch', '-B': 'resetBranch', '--orphan': 'orphan' },
    }, 'checkout');
    const f = p.f;
    let positional = p.rest.slice();
    let paths = p.dd.slice();
    const hasDD = p.hasDD;
    const quiet = !!f.quiet;

    if (f.patch) throw fail('error: git checkout -p 는 이 시뮬레이터에서 지원하지 않아요. git restore -p 를 써 보세요.', 1);

    const newName = p.o.newBranch ? p.o.newBranch[0] : p.o.resetBranch ? p.o.resetBranch[0] : null;
    const isReset = !!p.o.resetBranch;
    const orphanName = p.o.orphan ? p.o.orphan[0] : null;

    /* 1) 파일 복원 모드 판별 */
    let treeish = null;
    let filePaths = null;
    if (!newName && !orphanName && !f.detach) {
      if (hasDD) {
        if (positional.length) treeish = positional[0];
        filePaths = paths;
      } else if (positional.length) {
        // 첫 인자가 브랜치/커밋으로 해석되면 브랜치 전환, 아니면 경로
        const first = positional[0];
        const asRev = first === '-' || repo.resolveCommit(first);
        const remoteDwim = !asRev && dwimRemote(repo, first);
        if (!asRev && !remoteDwim) filePaths = positional;
        else if (positional.length > 1) {
          // <tree-ish> <paths>
          treeish = first;
          filePaths = positional.slice(1);
        }
      }
    } else if (hasDD) {
      filePaths = paths;
    }
    if (filePaths && filePaths.length === 0 && hasDD && !positional.length && !treeish) {
      // git checkout --  (경로 없음)
      return;
    }
    if (filePaths) {
      if (f.force && false) return;
      let source, label = null;
      if (treeish) {
        const ch = repo.resolveCommit(treeish);
        if (!ch) throw die(`invalid reference: ${treeish}`);
        source = repo.commitFlat(ch);
        label = repo.commitObj(ch).tree;
      } else {
        source = repo.indexFlat();
        if (repo.unmerged.size) repo.unmerged.forEach((st, pth) => { if (!source.has(pth)) { const e = st[2] || st[3] || st[1]; if (e) source.set(pth, e); } });
      }
      const matcher = pathspecMatcher(filePaths);
      let any = false;
      source.forEach((_, pth) => { if (matcher(pth)) any = true; });
      const unmatched = filePaths.filter((s) => { const m = pathspecMatcher([s]); let hit = false; source.forEach((_, pth) => { if (m(pth)) hit = true; }); return !hit; });
      if (!any || unmatched.length) throw fail(unmatched.map((s) => `error: pathspec '${s}' did not match any file(s) known to git`).join('\n'), 1);
      const opts = { source, paths: filePaths, toIndex: !!treeish, toWork: true, ours: f.ours, theirs: f.theirs, force: f.force, stage: f.ours ? 2 : (f.theirs ? 3 : 0) };
      if (!treeish && !f.ours && !f.theirs && !f.merge) {
        // 인덱스에서 가져오기: 충돌 파일 처리
        const m2 = pathspecMatcher(filePaths);
        let unmergedHit = false;
        repo.unmerged.forEach((_, pth) => { if (m2(pth)) unmergedHit = true; });
        if (unmergedHit && !f.force) {
          const bad = Array.from(repo.unmerged.keys()).filter((pth) => m2(pth)).sort();
          bad.forEach((pth) => ctx.eprint(`error: path '${pth}' is unmerged\n`));
          throw fail('', 1);
        }
      }
      if (f.merge && G.merge && G.merge.recreateConflict) {
        G.merge.recreateConflict(ctx, repo, filePaths);
        return;
      }
      const r = restoreToPaths(ctx, repo, opts);
      if (opts.hadError) throw fail('', 1);
      if (!quiet && !hasDD) {
        if (treeish) ctx.eprint(`Updated ${plural(r.updated, 'path')} from ${repo.shortHash(label, 7)}\n`);
        else ctx.eprint(`Updated ${plural(r.updated, 'path')} from the index\n`);
      }
      return;
    }

    /* 2) 브랜치 전환 모드 */
    if (f.merge) throw fail('error: --merge 옵션은 이 시뮬레이터에서 지원하지 않아요.', 1);
    if (orphanName) {
      if (repo.refs.has('refs/heads/' + orphanName)) throw die(`a branch named '${orphanName}' already exists`);
      const start = positional[0] ? repo.resolveCommit(positional[0]) : null;
      doSwitch(ctx, repo, { target: { ref: 'refs/heads/' + orphanName }, targetCommit: start, label: orphanName, orphan: true, quiet });
      return;
    }
    if (newName) {
      if (!validBranchName(newName)) throw die(`'${newName}' is not a valid branch name`);
      const exists = repo.refs.has('refs/heads/' + newName);
      if (exists && !isReset) throw die(`a branch named '${newName}' already exists`);
      const startSpec = positional[0];
      const startHash = branchFromStart(ctx, repo, startSpec);
      const startIsRemote = startSpec && repo.refs.has('refs/remotes/' + startSpec) && !f.noTrack;
      const track = startIsRemote && cfgBool(ctx.cfg('branch.autosetupmerge'), true) ? startSpec : (f.track && startSpec ? startSpec : null);
      const old = repo.readRef('refs/heads/' + newName);
      doSwitch(ctx, repo, {
        target: { ref: 'refs/heads/' + newName }, targetCommit: startHash, label: newName, create: !exists, reset: exists, force: f.force, quiet, track,
        createMsg: `branch: Created from ${startSpec || 'HEAD'}`, resetMsg: `branch: Reset to ${startSpec || 'HEAD'}`,
      });
      void old;
      return;
    }
    if (!positional.length) {
      if (f.detach) {
        const hc = repo.headCommit();
        if (!hc) throw die('You are on a branch yet to be born');
        doSwitch(ctx, repo, { target: { hash: hc }, targetCommit: hc, label: 'HEAD', quiet, force: f.force, forceDetach: true });
        return;
      }
      // git checkout  (현재 상태 요약)
      const tm = repo.currentBranch() ? U.trackingMessage(ctx, repo, repo.currentBranch()) : null;
      const lines = C.localChangeLines(repo);
      if (lines.length) ctx.print(lines.join('\n') + '\n');
      if (tm) ctx.print(tm.text);
      return;
    }
    const spec = positional[0];
    if (positional.length > 1) throw fail(`error: pathspec '${positional[1]}' did not match any file(s) known to git`, 1);
    if ((spec === 'HEAD' || spec === '@') && !f.detach && !repo.refs.has('refs/heads/' + spec)) {
      const lines = C.localChangeLines(repo);
      if (lines.length) ctx.print(lines.join('\n') + '\n');
      return;
    }
    checkoutTarget(ctx, repo, spec, { quiet, force: f.force, detach: f.detach, noGuess: f.noGuess, mode: 'checkout', track: f.track });
  };

  function dwimRemote(repo, name) {
    const matches = repo.listRefs('refs/remotes/').filter(([n]) => n.split('/').slice(3).join('/') === name && !n.endsWith('/HEAD'));
    return matches.length === 1 ? matches[0] : null;
  }

  function resolveSpecialPrev(repo) {
    const log = repo.readReflog('HEAD');
    for (let i = log.length - 1; i >= 0; i--) {
      const m = log[i].msg.match(/^checkout: moving from (.+) to (.+)$/);
      if (m) return m[1];
    }
    return null;
  }

  function checkoutTarget(ctx, repo, spec, o) {
    let name = spec;
    if (spec === '-') {
      const prev = resolveSpecialPrev(repo);
      if (!prev) throw die('invalid reference: @{-1}');
      name = prev;
    }
    const isBranch = repo.refs.has('refs/heads/' + name);
    if (isBranch && !o.detach) {
      const h = repo.readRef('refs/heads/' + name);
      doSwitch(ctx, repo, { target: { ref: 'refs/heads/' + name }, targetCommit: h, label: name, quiet: o.quiet, force: o.force });
      return;
    }
    let commit = repo.resolveCommit(name);
    if (!commit && !o.noGuess) {
      const d = dwimRemote(repo, name);
      if (d) {
        const remoteRef = d[0].replace(/^refs\/remotes\//, '');
        doSwitch(ctx, repo, {
          target: { ref: 'refs/heads/' + name }, targetCommit: d[1], label: name, create: true, quiet: o.quiet, force: o.force, track: remoteRef,
          createMsg: `branch: Created from refs/remotes/${remoteRef}`,
        });
        return;
      }
    }
    if (!commit) {
      if (o.mode === 'switch') throw die(`invalid reference: ${spec}`);
      throw fail(`error: pathspec '${spec}' did not match any file(s) known to git`, 1);
    }
    if (o.mode === 'switch' && !o.detach) {
      const kind = repo.refs.has('refs/tags/' + name) ? 'tag' : repo.refs.has('refs/remotes/' + name) ? 'remote branch' : 'commit';
      throw die(`a branch is expected, got ${kind} '${spec}'`);
    }
    const hasLocal = repo.headCommit() === commit && repo.isDetached();
    void hasLocal;
    doSwitch(ctx, repo, { target: { hash: commit }, targetCommit: commit, label: spec === '-' ? name : spec, quiet: o.quiet, force: o.force, forceDetach: o.detach });
  }

  COMMANDS.switch = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, {
      flags: { '-q': 'quiet', '--quiet': 'quiet', '-d': 'detach', '--detach': 'detach', '-f': 'force', '--force': 'force', '--discard-changes': 'force', '-t': 'track', '--track': 'track', '--no-track': 'noTrack', '-m': 'merge', '--merge': 'merge', '--guess': 'guess', '--no-guess': 'noGuess' },
      opts: { '-c': 'create', '--create': 'create', '-C': 'forceCreate', '--force-create': 'forceCreate', '--orphan': 'orphan' },
    }, 'switch');
    const f = p.f;
    const quiet = !!f.quiet;
    const positional = p.rest;
    if (f.merge) throw fail('error: --merge 옵션은 이 시뮬레이터에서 지원하지 않아요.', 1);
    if (p.o.orphan) {
      const nm = p.o.orphan[0];
      if (repo.refs.has('refs/heads/' + nm)) throw die(`a branch named '${nm}' already exists`);
      doSwitch(ctx, repo, { target: { ref: 'refs/heads/' + nm }, targetCommit: null, label: nm, orphan: true, quiet });
      return;
    }
    if (p.o.create || p.o.forceCreate) {
      const nm = (p.o.create || p.o.forceCreate)[0];
      const isReset = !!p.o.forceCreate;
      if (!validBranchName(nm)) throw die(`'${nm}' is not a valid branch name`);
      const exists = repo.refs.has('refs/heads/' + nm);
      if (exists && !isReset) throw die(`a branch named '${nm}' already exists`);
      const startSpec = positional[0];
      const startHash = branchFromStart(ctx, repo, startSpec);
      const startIsRemote = startSpec && repo.refs.has('refs/remotes/' + startSpec) && !f.noTrack;
      const track = startIsRemote && cfgBool(ctx.cfg('branch.autosetupmerge'), true) ? startSpec : (f.track && startSpec ? startSpec : null);
      doSwitch(ctx, repo, {
        target: { ref: 'refs/heads/' + nm }, targetCommit: startHash, label: nm, create: !exists, reset: exists, force: f.force, quiet, track,
        createMsg: `branch: Created from ${startSpec || 'HEAD'}`, resetMsg: `branch: Reset to ${startSpec || 'HEAD'}`,
      });
      return;
    }
    if (f.detach && !positional.length) {
      const hc = repo.headCommit();
      doSwitch(ctx, repo, { target: { hash: hc }, targetCommit: hc, label: 'HEAD', quiet, force: f.force, forceDetach: true });
      return;
    }
    if (!positional.length) throw die('missing branch or commit argument');
    checkoutTarget(ctx, repo, positional[0], { quiet, force: f.force, detach: f.detach, mode: 'switch', track: f.track, noGuess: f.noGuess });
  };

  /* ---------------- restore ---------------- */
  COMMANDS.restore = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, {
      flags: { '-S': 'staged', '--staged': 'staged', '-W': 'worktree', '--worktree': 'worktree', '-q': 'quiet', '--quiet': 'quiet', '--ours': 'ours', '--theirs': 'theirs', '-p': 'patch', '--patch': 'patch', '-m': 'merge', '--merge': 'merge', '--ignore-unmerged': 'ignoreUnmerged', '--progress': 'progress' },
      opts: { '-s': 'source', '--source': 'source' },
    }, 'restore');
    const f = p.f;
    const paths = p.rest.concat(p.dd);
    if (f.patch) throw fail('error: restore -p 는 이 시뮬레이터에서 지원하지 않아요. git add -p 로 대신 연습해 보세요.', 1);
    if (!paths.length) throw fail('fatal: you must specify path(s) to restore', 128);
    const toIndex = !!f.staged;
    const toWork = !!f.worktree || !f.staged;
    let source;
    if (p.o.source) {
      const ch = repo.resolveCommit(p.o.source[0]);
      if (!ch) throw die(`could not resolve ${p.o.source[0]}`);
      source = repo.commitFlat(ch);
    } else if (toIndex) {
      source = repo.headFlat();
    } else {
      source = repo.indexFlat();
      repo.unmerged.forEach((st, pth) => { if (!source.has(pth)) { const e = st[2] || st[3] || st[1]; if (e) source.set(pth, e); } });
    }
    const universe = new Map(source);
    if (toIndex) repo.index.forEach((e, pth) => universe.set(pth, e));
    const matcher = pathspecMatcher(paths);
    let any = false;
    universe.forEach((_, pth) => { if (matcher(pth)) any = true; });
    const unmatched = paths.filter((s) => { const m = pathspecMatcher([s]); let hit = false; universe.forEach((_, pth) => { if (m(pth)) hit = true; }); return !hit; });
    if (!any || unmatched.length) throw fail(unmatched.map((s) => `error: pathspec '${s}' did not match any file(s) known to git`).join('\n'), 1);
    // 충돌 파일
    const m2 = pathspecMatcher(paths);
    const unmergedHits = Array.from(repo.unmerged.keys()).filter((pth) => m2(pth)).sort();
    if (unmergedHits.length && !f.ours && !f.theirs && !f.merge && !p.o.source && !f.staged) {
      unmergedHits.forEach((pth) => ctx.eprint(`error: path '${pth}' is unmerged\n`));
      throw fail('', 1);
    }
    if (f.merge && G.merge && G.merge.recreateConflict) { G.merge.recreateConflict(ctx, repo, paths); return; }
    const opts = { source, paths, toIndex, toWork, includeIndex: toIndex, includeWork: false, ours: f.ours, theirs: f.theirs, stage: f.ours ? 2 : (f.theirs ? 3 : 0) };
    if (!toIndex && !p.o.source) {
      // 작업트리 복원: 인덱스가 원본. 인덱스에 없는 경로는 대상이 아님
    }
    restoreToPaths(ctx, repo, opts);
    if (opts.hadError) throw fail('', 1);
  };

  /* ---------------- reset ---------------- */
  function unstagedAfterReset(repo) {
    const lines = [];
    const paths = new Set();
    repo.index.forEach((_, pth) => paths.add(pth));
    Array.from(paths).sort().forEach((pth) => {
      const i = repo.index.get(pth);
      const w = repo.work.get(pth);
      if (w === undefined) lines.push('D\t' + pth);
      else if (sha1.hashObject('blob', w) !== i.hash) lines.push('M\t' + pth);
    });
    return lines;
  }

  COMMANDS.reset = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, {
      flags: { '--soft': 'soft', '--mixed': 'mixed', '--hard': 'hard', '--keep': 'keep', '--merge': 'merge', '-q': 'quiet', '--quiet': 'quiet', '-p': 'patch', '--patch': 'patch', '--no-refresh': 'noRefresh', '-N': 'intent' },
    }, 'reset');
    const f = p.f;
    if (f.patch) throw fail('error: reset -p 는 이 시뮬레이터에서 지원하지 않아요.', 1);
    const modes = ['soft', 'mixed', 'hard', 'keep', 'merge'].filter((m) => f[m]);
    let mode = modes[0] || 'mixed';
    let pos = p.rest.slice();
    let paths = p.dd.slice();
    let rev = null;
    if (p.hasDD) { if (pos.length) rev = pos[0]; } else if (pos.length) {
      const first = pos[0];
      if (repo.resolve(first) !== null && repo.resolveCommit(first) !== null) { rev = first; paths = pos.slice(1); } else {
        // 경로로 간주 (작업트리/인덱스/HEAD 에 존재해야 함)
        const known = repo.work.has(first) || repo.index.has(first) || repo.headFlat().has(first) || Array.from(repo.index.keys()).some((k) => k.startsWith(first.replace(/\/$/, '') + '/')) || first === '.';
        if (!known) throw die(`ambiguous argument '${first}': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'`);
        paths = pos;
      }
    }
    const ident = identOf(ctx);
    if (paths.length) {
      if (modes.length && mode !== 'mixed') throw die(`Cannot do ${mode} reset with paths.`);
      let target;
      if (rev) {
        const ch = repo.resolveCommit(rev);
        if (!ch) throw die(`Failed to resolve '${rev}' as a valid tree.`);
        target = repo.commitFlat(ch);
      } else target = repo.headFlat();
      const matcher = pathspecMatcher(paths);
      const universe = new Set();
      target.forEach((_, pth) => { if (matcher(pth)) universe.add(pth); });
      repo.index.forEach((_, pth) => { if (matcher(pth)) universe.add(pth); });
      repo.unmerged.forEach((_, pth) => { if (matcher(pth)) universe.add(pth); });
      Array.from(universe).forEach((pth) => {
        const e = target.get(pth);
        if (e) repo.index.set(pth, { hash: e.hash, mode: e.mode }); else repo.index.delete(pth);
        repo.unmerged.delete(pth);
      });
      if (!f.quiet) {
        const lines = unstagedAfterReset(repo);
        if (lines.length) ctx.print('Unstaged changes after reset:\n' + lines.join('\n') + '\n');
      }
      return;
    }
    const spec = rev || 'HEAD';
    const target = repo.resolveCommit(spec);
    if (!target) {
      if (!rev && repo.isUnborn()) {
        if (mode === 'hard') throw die('Could not parse object \'HEAD\'.');
        repo.index = new Map(); repo.unmerged = new Map();
        return;
      }
      throw die(`ambiguous argument '${spec}': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'`);
    }
    const old = repo.headCommit();
    const flat = repo.commitFlat(target);
    if (mode === 'keep' || mode === 'merge') {
      const r = C.switchTree(ctx, repo, flat, {});
      if (r.conflicts.length) {
        throw fail(`error: Entry '${r.conflicts[0]}' not uptodate. Cannot update.\nfatal: Could not reset index file to revision '${spec}'.`, 128);
      }
    } else if (mode === 'hard') {
      C.hardResetTo(repo, flat);
    } else if (mode === 'mixed') {
      repo.setIndexFromFlat(flat);
      repo.unmerged = new Map();
    }
    if (old) repo.special.ORIG_HEAD = old;
    const msg = `reset: moving to ${spec}`;
    if (repo.head.ref) repo.updateRef(repo.head.ref, target, msg, ident);
    else if (old !== target) repo.moveDetachedHead(target, msg, ident);
    if (mode !== 'soft') { repo.state.merge = null; repo.state.cherryPick = null; repo.state.revert = null; }
    if (mode === 'hard' && !f.quiet) ctx.print(`HEAD is now at ${describeHead(ctx, repo, target)}\n`);
    else if (mode === 'mixed' && !f.quiet) {
      const lines = unstagedAfterReset(repo);
      if (lines.length) ctx.print('Unstaged changes after reset:\n' + lines.join('\n') + '\n');
    }
  };

  /* ---------------- clean ---------------- */
  COMMANDS.clean = function (ctx, args) {
    const repo = C.requireWorktree(ctx);
    const p = parseArgs(args, {
      flags: { '-n': 'dry', '--dry-run': 'dry', '-f': 'force', '--force': 'force', '-d': 'dirs', '-x': 'allIgnored', '-X': 'onlyIgnored', '-q': 'quiet', '--quiet': 'quiet', '-i': 'interactive', '--interactive': 'interactive' },
      opts: { '-e': 'exclude', '--exclude': 'exclude' },
    }, 'clean');
    const f = p.f;
    if (f.interactive) throw fail('이 시뮬레이터에서는 대화형 clean(-i)을 지원하지 않아요. -n 으로 미리보기 후 -f 로 실행해 보세요.', 1);
    const requireForce = cfgBool(ctx.cfg('clean.requireforce'), true);
    if (!f.dry && !f.force && requireForce) throw die('clean.requireForce is true and -f not given: refusing to clean');
    const paths = p.rest.concat(p.dd);
    const matcher = paths.length ? pathspecMatcher(paths) : () => true;
    const rules = repo.ignoreRules();
    const trackedPaths = new Set(repo.index.keys());
    repo.unmerged.forEach((_, k) => trackedPaths.add(k));
    const hasTrackedUnder = (dir) => Array.from(trackedPaths).some((t) => t.startsWith(dir + '/'));
    const candidates = new Map(); // path → isDir
    const untrackedFiles = Array.from(repo.work.keys()).filter((pth) => !trackedPaths.has(pth)).sort();
    const exPats = (p.o.exclude || []);
    untrackedFiles.forEach((pth) => {
      const ignored = repo.isIgnored(pth, rules) || exPats.some((e) => globMatch(e, pth.split('/').pop()));
      if (f.onlyIgnored && !ignored) return;
      if (!f.onlyIgnored && !f.allIgnored && ignored) return;
      if (!matcher(pth)) return;
      // 완전히 추적되지 않는 최상위 디렉터리를 찾는다
      const parts = pth.split('/');
      let topUntrackedDir = null;
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join('/');
        if (!hasTrackedUnder(dir)) { topUntrackedDir = dir; break; }
      }
      if (topUntrackedDir) {
        if (f.dirs) candidates.set(topUntrackedDir + '/', true);
      } else candidates.set(pth, false);
    });
    if (f.dirs) {
      repo.dirs.forEach((d) => {
        const hasFiles = Array.from(repo.work.keys()).some((k) => k.startsWith(d + '/'));
        if (hasFiles || hasTrackedUnder(d)) return;
        if (!matcher(d)) return;
        // 상위가 이미 후보면 생략
        const parts = d.split('/');
        for (let i = 1; i < parts.length; i++) if (candidates.has(parts.slice(0, i).join('/') + '/')) return;
        if (!f.onlyIgnored) candidates.set(d + '/', true);
      });
    }
    const list = Array.from(candidates.keys()).sort();
    let out = '';
    list.forEach((c) => {
      out += (f.dry ? 'Would remove ' : 'Removing ') + c + '\n';
      if (!f.dry) {
        if (c.endsWith('/')) {
          const dir = c.slice(0, -1);
          Array.from(repo.work.keys()).forEach((k) => { if (k.startsWith(dir + '/')) repo.work.delete(k); });
          Array.from(repo.dirs).forEach((d) => { if (d === dir || d.startsWith(dir + '/')) repo.dirs.delete(d); });
        } else { repo.work.delete(c); C.removeEmptyParents(repo, c); }
      }
    });
    if (!f.quiet || f.dry) ctx.print(out);
  };

  /* ---------------- 배관 명령 ---------------- */
  function serializeObject(repo, h) {
    const o = repo.get(h);
    if (!o) return null;
    if (o.type === 'blob') return o.content;
    if (o.type === 'commit') {
      let s = `tree ${o.tree}\n`;
      o.parents.forEach((pp) => { s += `parent ${pp}\n`; });
      return s + `author ${G.fmtIdent(o.author)}\ncommitter ${G.fmtIdent(o.committer)}\n\n${o.message}`;
    }
    if (o.type === 'tag') return `object ${o.object}\ntype ${o.objType}\ntag ${o.tag}\ntagger ${G.fmtIdent(o.tagger)}\n\n${o.message}`;
    if (o.type === 'tree') return o.entries.map((e) => `${e.mode} ${e.name}\0`).join('') + '\0'.repeat(20 * o.entries.length);
    return '';
  }
  function byteLen(s) { return sha1.utf8(s).length; }

  function treeListing(repo, treeHash) {
    const t = repo.get(treeHash);
    return t && t.type === 'tree' ? t.entries : [];
  }
  function modeStr(m) { return m === '40000' ? '040000' : m; }

  COMMANDS['rev-parse'] = function (ctx, args) {
    const repo = ctx.repo;
    const p = parseArgs(args, {
      flags: { '--show-toplevel': 'top', '--git-dir': 'gitdir', '--absolute-git-dir': 'absgit', '--is-inside-work-tree': 'inside', '--is-bare-repository': 'bare', '--abbrev-ref': 'abbrevRef', '--verify': 'verify', '-q': 'quiet', '--quiet': 'quiet', '--symbolic-full-name': 'symFull', '--show-prefix': 'prefix', '--show-cdup': 'cdup', '--git-common-dir': 'common', '--is-inside-git-dir': 'insideGit', '--symbolic': 'symbolic', '--revs-only': 'revsOnly', '--no-flags': 'noFlags' },
      optional: { '--short': 'short' },
    }, 'rev-parse');
    if (!repo && !p.f.insideGit) throw die('not a git repository (or any of the parent directories): .git');
    let out = '';
    if (p.f.top) out += worktreePath(ctx, repo) + '\n';
    if (p.f.gitdir) out += '.git\n';
    if (p.f.common) out += '.git\n';
    if (p.f.absgit) out += worktreePath(ctx, repo) + '/.git\n';
    if (p.f.inside) out += (repo.bare ? 'false' : 'true') + '\n';
    if (p.f.bare) out += (repo.bare ? 'true' : 'false') + '\n';
    if (p.f.prefix) out += '\n';
    if (p.f.cdup) out += '\n';
    if (p.f.insideGit) out += 'false\n';
    const shortLen = p.o.short ? (parseInt(p.o.short[0], 10) || 7) : null;
    p.rest.forEach((spec) => {
      let h = repo.resolve(spec);
      if (!h) {
        if (p.f.verify) throw die('Needed a single revision', 128);
        ctx.print(out + spec + '\n'); out = '';
        throw die(`ambiguous argument '${spec}': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'`);
      }
      if (p.f.abbrevRef) {
        if (spec === 'HEAD' || spec === '@') out += (repo.head.ref ? repo.currentBranch() : 'HEAD') + '\n';
        else if (/@\{(u|upstream)\}$/.test(spec)) {
          const b = spec.replace(/@\{.*\}$/, '') || repo.currentBranch();
          out += (repo.upstreamName(b) || '') + '\n';
        } else {
          const refs = ['refs/heads/' + spec, 'refs/tags/' + spec, 'refs/remotes/' + spec];
          out += (refs.some((r) => repo.refs.has(r)) ? spec : h) + '\n';
        }
        return;
      }
      if (p.f.symFull) {
        const full = ['refs/' + spec, 'refs/heads/' + spec, 'refs/tags/' + spec, 'refs/remotes/' + spec].find((r) => repo.refs.has(r));
        if (spec === 'HEAD' && repo.head.ref) out += repo.head.ref + '\n'; else if (full) out += full + '\n';
        return;
      }
      if (shortLen !== null) { out += repo.shortHash(h, shortLen) + '\n'; return; }
      out += h + '\n';
    });
    if (p.f.verify && !p.rest.length) throw die('Needed a single revision', 128);
    ctx.print(out);
  };

  COMMANDS['cat-file'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '-t': 't', '-p': 'p', '-s': 's', '-e': 'e' } }, 'cat-file');
    let spec, kind = null;
    if (p.f.t || p.f.p || p.f.s || p.f.e) spec = p.rest[0];
    else { kind = p.rest[0]; spec = p.rest[1]; }
    if (!spec) throw fail('usage: git cat-file (-t | -s | -e | -p | <type> | --textconv | --filters) [--path=<path>] <object>', 129);
    const h = repo.resolve(spec);
    const o = h && repo.get(h);
    if (!o) throw die(`Not a valid object name ${spec}`);
    if (p.f.e) return;
    if (p.f.t) { ctx.print(o.type + '\n'); return; }
    if (p.f.s) { ctx.print((o.type === 'tree' ? o.entries.reduce((a, e) => a + `${e.mode} ${e.name}\0`.length + 20, 0) : byteLen(serializeObject(repo, h))) + '\n'); return; }
    if (p.f.p || kind) {
      if (o.type === 'tree') { ctx.print(o.entries.map((e) => `${modeStr(e.mode)} ${e.mode === '40000' ? 'tree' : 'blob'} ${e.hash}\t${e.name}`).join('\n') + '\n'); return; }
      ctx.print(serializeObject(repo, h));
    }
  };

  function resolveTreeish(repo, spec) {
    const h = repo.resolve(spec);
    if (!h) return null;
    const o = repo.get(h);
    if (!o) return null;
    if (o.type === 'tree') return h;
    const c = repo.peelToCommit(h);
    return c ? repo.commitObj(c).tree : null;
  }

  COMMANDS['ls-tree'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '-r': 'r', '-t': 't', '-d': 'd', '--name-only': 'nameOnly', '--name-status': 'nameOnly', '-l': 'long', '--long': 'long', '--full-name': 'full' } }, 'ls-tree');
    const spec = p.rest[0];
    if (!spec) throw fail('usage: git ls-tree [<options>] <tree-ish> [<path>...]', 129);
    const tree = resolveTreeish(repo, spec);
    if (!tree) throw die(`Not a valid object name ${spec}`);
    const filt = p.rest.slice(1).concat(p.dd).map((s) => s.replace(/\/$/, ''));
    const lines = [];
    const walk = (th, prefix) => {
      treeListing(repo, th).forEach((e) => {
        const path = prefix + e.name;
        const isTree = e.mode === '40000';
        if (filt.length && !filt.some((f2) => path === f2 || path.startsWith(f2 + '/') || f2.startsWith(path + '/'))) return;
        const show = () => {
          const size = p.f.long ? (isTree ? '       -' : String(byteLen(repo.blobContent(e.hash))).padStart(8)) + '\t' : '\t';
          if (p.f.nameOnly) lines.push(path);
          else lines.push(`${modeStr(e.mode)} ${isTree ? 'tree' : 'blob'} ${e.hash}${p.f.long ? ' ' : ''}${size}${path}`.replace(/\t\t/, '\t'));
        };
        if (isTree) {
          if (p.f.r) { if (p.f.t || p.f.d) show(); walk(e.hash, path + '/'); } else if (!filt.length || filt.some((f2) => path === f2 || f2.startsWith(path + '/') ? false : true) || true) {
            if (filt.length && filt.some((f2) => f2.startsWith(path + '/'))) walk(e.hash, path + '/'); else show();
          }
        } else if (!p.f.d) show();
      });
    };
    walk(tree, '');
    ctx.print(lines.length ? lines.join('\n') + '\n' : '');
  };

  COMMANDS['ls-files'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '-s': 'stage', '--stage': 'stage', '-u': 'unmerged', '--unmerged': 'unmerged', '-m': 'modified', '--modified': 'modified', '-o': 'others', '--others': 'others', '-d': 'deleted', '--deleted': 'deleted', '-c': 'cached', '--cached': 'cached', '--exclude-standard': 'exstd', '-i': 'ignored', '--ignored': 'ignored', '--error-unmatch': 'errUnmatch', '-z': 'z', '--full-name': 'full' } }, 'ls-files');
    const specs = p.rest.concat(p.dd);
    const matcher = specs.length ? pathspecMatcher(specs) : () => true;
    const lines = [];
    const showCached = p.f.cached || (!p.f.modified && !p.f.others && !p.f.deleted && !p.f.unmerged && !p.f.ignored) || p.f.stage;
    const rules = repo.ignoreRules();
    if (p.f.unmerged) {
      Array.from(repo.unmerged.keys()).sort().forEach((pth) => {
        if (!matcher(pth)) return;
        const st = repo.unmerged.get(pth);
        [1, 2, 3].forEach((s) => { if (st[s]) lines.push(`${st[s].mode} ${st[s].hash} ${s}\t${pth}`); });
      });
    } else if (showCached) {
      const all = new Set(repo.index.keys());
      repo.unmerged.forEach((_, k) => all.add(k));
      Array.from(all).sort().forEach((pth) => {
        if (!matcher(pth)) return;
        if (repo.unmerged.has(pth)) {
          const st = repo.unmerged.get(pth);
          if (p.f.stage) [1, 2, 3].forEach((s) => { if (st[s]) lines.push(`${st[s].mode} ${st[s].hash} ${s}\t${pth}`); });
          else lines.push(pth);
          return;
        }
        const e = repo.index.get(pth);
        lines.push(p.f.stage ? `${e.mode} ${e.hash} 0\t${pth}` : pth);
      });
    }
    if (p.f.modified || p.f.deleted) {
      Array.from(repo.index.keys()).sort().forEach((pth) => {
        if (!matcher(pth)) return;
        const w = repo.work.get(pth);
        if (w === undefined) { if (p.f.deleted || p.f.modified) lines.push(pth); return; }
        if (p.f.modified && sha1.hashObject('blob', w) !== repo.index.get(pth).hash) lines.push(pth);
      });
    }
    if (p.f.others) {
      Array.from(repo.work.keys()).filter((pth) => !repo.index.has(pth) && !repo.unmerged.has(pth)).sort().forEach((pth) => {
        if (!matcher(pth)) return;
        if (p.f.exstd && repo.isIgnored(pth, rules)) return;
        lines.push(pth);
      });
    }
    if (p.f.ignored && p.f.others) { /* -o -i */ }
    if (p.f.errUnmatch) {
      const tracked = new Set(repo.index.keys());
      specs.forEach((s) => { if (!Array.from(tracked).some((t) => pathspecMatcher([s])(t))) throw fail(`error: pathspec '${s}' did not match any file(s) known to git\nDid you forget to 'git add'?`, 1); });
    }
    ctx.print(lines.length ? lines.join('\n') + '\n' : '');
  };

  COMMANDS['show-ref'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '--heads': 'heads', '--tags': 'tags', '--verify': 'verify', '-s': 'hash', '--hash': 'hash', '--head': 'head', '-d': 'deref', '--dereference': 'deref', '-q': 'quiet', '--quiet': 'quiet', '--exists': 'exists' } }, 'show-ref');
    let list = repo.listRefs('refs/');
    if (p.f.heads) list = list.filter(([n]) => n.startsWith('refs/heads/'));
    if (p.f.tags) list = list.filter(([n]) => n.startsWith('refs/tags/'));
    if (p.f.verify) {
      const want = p.rest[0];
      const hit = list.find(([n]) => n === want);
      if (!hit) { if (p.f.quiet) throw fail('', 1); throw die(`'${want}' - not a valid ref`); }
      if (!p.f.quiet) ctx.print(`${p.f.hash ? '' : hit[1] + ' '}${p.f.hash ? hit[1] : hit[0]}\n`);
      return;
    }
    if (p.rest.length) list = list.filter(([n]) => p.rest.some((pt) => n === pt || n.endsWith('/' + pt)));
    let out = '';
    if (p.f.head && repo.headCommit()) out += `${repo.headCommit()} HEAD\n`;
    list.forEach(([n, h]) => {
      out += p.f.hash ? h + '\n' : `${h} ${n}\n`;
      if (p.f.deref) { const o = repo.get(h); if (o && o.type === 'tag') out += `${repo.peelAny(h)} ${n}^{}\n`; }
    });
    if (!list.length && !out) throw fail('', 1);
    if (!p.f.quiet) ctx.print(out);
  };

  COMMANDS['for-each-ref'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: {}, opts: { '--format': 'format', '--sort': 'sort', '--count': 'count', '--points-at': 'pointsAt', '--contains': 'contains' } }, 'for-each-ref');
    let list = repo.listRefs('refs/');
    if (p.rest.length) list = list.filter(([n]) => p.rest.some((pt) => n === pt || n.startsWith(pt.replace(/\/?$/, '/')) || globMatch(pt, n)));
    if (p.o.contains) { const h = repo.resolveCommit(p.o.contains[0]); list = list.filter(([, th]) => repo.isAncestor(h, repo.peelToCommit(th) || th)); }
    if (p.o.pointsAt) { const h = repo.resolve(p.o.pointsAt[0]); list = list.filter(([, th]) => th === h || repo.peelToCommit(th) === h); }
    if (p.o.sort) list = sortRefs(ctx, repo, list, p.o.sort);
    if (p.o.count) list = list.slice(0, parseInt(p.o.count[0], 10));
    const fmt = p.o.format ? p.o.format[0] : '%(objectname) %(objecttype)\t%(refname)';
    ctx.print(list.map(([n, h]) => refFormat(ctx, repo, fmt, n, h)).join('\n') + (list.length ? '\n' : ''));
  };

  COMMANDS['merge-base'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '--is-ancestor': 'isAnc', '--all': 'all', '-a': 'all', '--octopus': 'octopus', '--fork-point': 'fork' } }, 'merge-base');
    const [a, b] = p.rest;
    if (!a || !b) throw fail('usage: git merge-base [-a | --all] <commit> <commit>...', 129);
    const ha = repo.resolveCommit(a), hb = repo.resolveCommit(b);
    if (!ha) throw die(`Not a valid object name ${a}`);
    if (!hb) throw die(`Not a valid object name ${b}`);
    if (p.f.isAnc) { if (!repo.isAncestor(ha, hb)) throw fail('', 1); return; }
    const bases = repo.mergeBases(ha, hb);
    if (!bases.length) throw fail('', 1);
    ctx.print((p.f.all ? bases : [bases[0]]).join('\n') + '\n');
  };

  COMMANDS['symbolic-ref'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '--short': 'short', '-q': 'quiet', '--quiet': 'quiet' }, opts: { '-m': 'msg' } }, 'symbolic-ref');
    const name = p.rest[0] || 'HEAD';
    if (p.rest.length > 1 && name === 'HEAD') {
      repo.head = { ref: p.rest[1] };
      return;
    }
    if (name !== 'HEAD') {
      const t = repo.symrefs && repo.symrefs.get(name);
      if (!t) throw die(`ref ${name} is not a symbolic ref`);
      ctx.print((p.f.short ? t.replace(/^refs\/(heads|remotes)\//, '') : t) + '\n');
      return;
    }
    if (!repo.head.ref) { if (p.f.quiet) throw fail('', 1); throw die('ref HEAD is not a symbolic ref'); }
    ctx.print((p.f.short ? repo.currentBranch() : repo.head.ref) + '\n');
  };

  COMMANDS['update-ref'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '-d': 'del', '--no-deref': 'nodef' }, opts: { '-m': 'msg' } }, 'update-ref');
    const [name, val] = p.rest;
    if (!name) throw fail('usage: git update-ref [<options>] -d <refname> [<old-oid>]\n   or: git update-ref [<options>]    <refname> <new-oid> [<old-oid>]', 129);
    if (p.f.del) { repo.deleteRef(name); repo.reflogs.delete(name); return; }
    const h = repo.resolve(val);
    if (!h) throw die(`${val}: not a valid SHA1`);
    const ident = identOf(ctx);
    if (name === 'HEAD') { if (repo.head.ref) repo.updateRef(repo.head.ref, h, (p.o.msg && p.o.msg[0]) || '', ident); else repo.moveDetachedHead(h, (p.o.msg && p.o.msg[0]) || '', ident); return; }
    repo.updateRef(name, h, (p.o.msg && p.o.msg[0]) || '', ident);
  };

  COMMANDS['write-tree'] = function (ctx) {
    const repo = C.requireRepo(ctx);
    ctx.print(C.writeTreeFromIndex(ctx, repo) + '\n');
  };

  COMMANDS['hash-object'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '-w': 'write', '--stdin': 'stdin' }, opts: { '-t': 'type' } }, 'hash-object');
    const file = p.rest[0];
    const content = file ? repo.work.get(file) : '';
    if (content === undefined) throw die(`could not open '${file}' for reading: No such file or directory`);
    const type = p.o.type ? p.o.type[0] : 'blob';
    const h = sha1.hashObject(type, content);
    if (p.f.write && type === 'blob') repo.putBlob(content);
    ctx.print(h + '\n');
  };

  COMMANDS['commit-tree'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: {}, opts: { '-p': 'parent', '-m': 'message' } }, 'commit-tree');
    const tree = resolveTreeish(repo, p.rest[0]);
    if (!tree) throw die(`Not a valid object name ${p.rest[0]}`);
    const parents = (p.o.parent || []).map((x) => repo.resolveCommit(x));
    const ident = identOf(ctx);
    const h = repo.putCommit({ tree, parents, author: ident, committer: ident, message: (p.o.message ? p.o.message.join('\n\n') : '') + '\n' });
    ctx.print(h + '\n');
  };

  COMMANDS['count-objects'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const v = args.includes('-v');
    const n = repo.objects.size;
    if (v) ctx.print(`count: ${n}\nsize: ${Math.max(1, Math.ceil(n / 4))}\nin-pack: 0\npacks: 0\nsize-pack: 0\nprune-packable: 0\ngarbage: 0\nsize-garbage: 0\n`);
    else ctx.print(`${n} objects, ${Math.max(1, Math.ceil(n / 4))} kilobytes\n`);
  };

  COMMANDS.gc = function (ctx) { C.requireRepo(ctx); };
  COMMANDS.prune = function (ctx) { C.requireRepo(ctx); };
  COMMANDS.repack = function (ctx) { C.requireRepo(ctx); };

  COMMANDS['name-rev'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '--name-only': 'nameOnly', '--tags': 'tags' } }, 'name-rev');
    const out = p.rest.map((spec) => {
      const h = repo.resolveCommit(spec);
      if (!h) throw die(`Could not get sha1 for ${spec}. Skipping.`);
      let name = 'undefined';
      const exactTag = repo.listRefs('refs/tags/').find(([, th]) => repo.peelToCommit(th) === h);
      if (exactTag) {
        const annotated = repo.get(exactTag[1]).type === 'tag';
        return p.f.nameOnly ? `${exactTag[0].slice(5)}${annotated ? '^0' : ''}` : `${spec} ${exactTag[0].slice(5)}${annotated ? '^0' : ''}`;
      }
      const heads = repo.listRefs(p.f.tags ? 'refs/tags/' : 'refs/').filter(([n]) => !p.f.tags ? /^refs\/(heads|tags)\//.test(n) : true);
      let best = null;
      heads.forEach(([n, th]) => {
        const tip = repo.peelToCommit(th);
        // 첫 부모를 따라가며 거리 계산
        let cur = tip; let d = 0;
        while (cur) { if (cur === h) { if (!best || d < best.d) best = { n: n.replace(/^refs\/(heads|tags)\//, (m, k) => (k === 'tags' ? 'tags/' : '')), d, tag: n.startsWith('refs/tags/') }; break; } cur = repo.parents(cur)[0]; d++; }
      });
      if (best) name = best.d ? `${best.n}~${best.d}` : best.n;
      return p.f.nameOnly ? name : `${spec} ${name}`;
    });
    ctx.print(out.join('\n') + '\n');
  };

  COMMANDS.fsck = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '--lost-found': 'lost', '--unreachable': 'unreachable', '--no-reflogs': 'noReflogs', '--full': 'full', '--no-dangling': 'noDangling', '--root': 'root', '--strict': 'strict' } }, 'fsck');
    // 도달 가능 집합: ref, HEAD, 인덱스
    const reach = new Set();
    const mark = (h) => {
      if (!h || reach.has(h)) return;
      const o = repo.get(h);
      if (!o) return;
      reach.add(h);
      if (o.type === 'commit') { mark(o.tree); o.parents.forEach(mark); } else if (o.type === 'tree') o.entries.forEach((e) => mark(e.hash)); else if (o.type === 'tag') mark(o.object);
    };
    repo.refs.forEach((h) => mark(h));
    if (repo.headCommit()) mark(repo.headCommit());
    repo.index.forEach((e) => mark(e.hash));
    repo.unmerged.forEach((st) => [1, 2, 3].forEach((s) => { if (st[s]) mark(st[s].hash); }));
    if (!p.f.noReflogs) { /* reflog 는 dangling 판정에 영향을 주지 않는다 (실제 git 과 동일) */ }
    // 다른 오브젝트가 참조하는 것
    const used = new Set();
    repo.objects.forEach((o) => {
      if (o.type === 'commit') { used.add(o.tree); o.parents.forEach((x) => used.add(x)); } else if (o.type === 'tree') o.entries.forEach((e) => used.add(e.hash)); else if (o.type === 'tag') used.add(o.object);
    });
    const lines = [];
    Array.from(repo.objects.keys()).sort().forEach((h) => {
      if (reach.has(h)) return;
      const o = repo.get(h);
      const dangling = !used.has(h);
      if (dangling && !p.f.noDangling) lines.push(`dangling ${o.type} ${h}`);
      else if (!dangling && p.f.unreachable) lines.push(`unreachable ${o.type} ${h}`);
    });
    ctx.print(lines.length ? lines.join('\n') + '\n' : '');
  };

  G.refs = { doSwitch, restoreToPaths, setUpstream, unsetUpstream, refFormat, sortRefs, globMatch, worktreePath, cfgBool, identOf, describeHead, validBranchName, resolveTreeish, serializeObject };
})();
