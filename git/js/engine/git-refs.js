/* git 명령어 구현 (3-1): branch / tag 와 참조 공용 도우미 (업스트림·참조 정렬·포맷 등)
 * 다음 파일들(git-checkout.js · git-plumbing.js · git-merge.js · git-remote.js …)이 G.refs 로 이 도우미를 써요. */
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

  G.refs = Object.assign(G.refs || {}, { setUpstream, unsetUpstream, refFormat, sortRefs, globMatch, worktreePath, cfgBool, identOf, describeHead, validBranchName, HINT_DETACHED, branchFromStart });
})();
