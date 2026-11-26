/* git 명령어 구현 (3-2): 작업 트리 이동 — checkout / switch / restore / reset / clean */
(function () {
  'use strict';
  const G = (globalThis.GitEngine = globalThis.GitEngine || {});
  const { Diff, sha1, GitError, ZERO, cleanupMessage, pathspecMatcher } = G;
  const U = G.util;
  const C = G.core;
  const { die, fail, parseArgs, plural } = U;
  const COMMANDS = G.commands;
  const { HINT_DETACHED, branchFromStart, cfgBool, describeHead, globMatch, identOf, setUpstream, validBranchName } = G.refs;

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

  G.refs = Object.assign(G.refs || {}, { doSwitch, restoreToPaths });
})();
