/* git 명령어 구현 (4-1): merge 와 3-way 트리 병합 · 병합 공용 도우미
 * 다음 파일들(git-pick.js · git-rebase.js · git-stash.js)이 G.merge 로 이 도우미를 써요. */
(function () {
  'use strict';
  const G = (globalThis.GitEngine = globalThis.GitEngine || {});
  const { Diff, sha1, GitError, ZERO, EMPTY_TREE, cleanupMessage, pathspecMatcher } = G;
  const U = G.util;
  const C = G.core;
  const R = G.refs;
  const { die, fail, parseArgs, plural } = U;
  const COMMANDS = G.commands;

  /* ====================================================================
   *  3-way 트리 병합
   * ==================================================================== */
  function eqEntry(a, b) { return (!a && !b) || (!!a && !!b && a.hash === b.hash && a.mode === b.mode); }
  function contentOfEntry(repo, e) { return repo.blobContent(e.hash); }
  function isBin(s) { return s.indexOf('\0') >= 0; }

  function mergeTrees(ctx, repo, base, ours, theirs, labels, opts) {
    opts = opts || {};
    const b2 = new Map(base), o2 = new Map(ours), t2 = new Map(theirs);
    const msgs = new Map();
    const addMsg = (p, l) => { if (!msgs.has(p)) msgs.set(p, []); msgs.get(p).push(l); };
    const result = new Map();
    const conflicts = new Map();

    /* rename 처리: 한쪽이 base 의 p 를 q 로 옮겼고 다른 쪽이 p 를 수정했다면 q 에서 합친다 */
    const renOurs = new Map(), renTheirs = new Map();
    U.diffMaps(repo, base, ours, { renames: true }).filter((c) => c.status === 'R').forEach((c) => renOurs.set(c.oldPath, c.path));
    U.diffMaps(repo, base, theirs, { renames: true }).filter((c) => c.status === 'R').forEach((c) => renTheirs.set(c.oldPath, c.path));
    const moveRename = (p, q, sideMap, otherMap) => {
      // sideMap 은 이미 q 를 가지고 있다. otherMap 의 p 를 q 로 옮긴다
      if (otherMap.has(q)) return false;
      const bp = b2.get(p);
      if (!bp) return false;
      if (otherMap.has(p)) { otherMap.set(q, otherMap.get(p)); otherMap.delete(p); b2.set(q, bp); b2.delete(p); return true; }
      return false;
    };
    renOurs.forEach((q, p) => {
      if (renTheirs.has(p)) {
        if (renTheirs.get(p) === q) { b2.set(q, b2.get(p)); b2.delete(p); t2.set(q, t2.get(q)); }
        return;
      }
      const tp = t2.get(p);
      if (tp && !eqEntry(tp, base.get(p))) { if (moveRename(p, q, o2, t2)) { /* ok */ } } else if (!tp) {
        // 상대가 지움 + 내가 이름 변경 → rename/delete
        addMsg(q, `CONFLICT (rename/delete): ${p} renamed to ${q} in ${labels.ours}, but deleted in ${labels.theirs}.`);
        conflicts.set(q, { type: 'rename/delete', stages: { 1: base.get(p), 2: o2.get(q) }, work: contentOfEntry(repo, o2.get(q)) });
        o2.delete(q); b2.delete(p);
      }
    });
    renTheirs.forEach((q, p) => {
      if (renOurs.has(p)) return;
      const op = o2.get(p);
      if (op && !eqEntry(op, base.get(p))) { moveRename(p, q, t2, o2); } else if (!op) {
        addMsg(q, `CONFLICT (rename/delete): ${p} renamed to ${q} in ${labels.theirs}, but deleted in ${labels.ours}.`);
        conflicts.set(q, { type: 'rename/delete', stages: { 1: base.get(p), 3: t2.get(q) }, work: contentOfEntry(repo, t2.get(q)) });
        t2.delete(q); b2.delete(p);
      }
    });

    const all = new Set();
    [b2, o2, t2].forEach((m) => m.forEach((_, k) => all.add(k)));
    Array.from(all).sort().forEach((path) => {
      if (conflicts.has(path)) return;
      const b = b2.get(path), o = o2.get(path), t = t2.get(path);
      if (eqEntry(o, t)) { if (o) result.set(path, o); return; }
      if (eqEntry(b, o)) { if (t) result.set(path, t); return; }
      if (eqEntry(b, t)) { if (o) result.set(path, o); return; }
      if (o && t) {
        const bc = b ? contentOfEntry(repo, b) : '', oc = contentOfEntry(repo, o), tc = contentOfEntry(repo, t);
        const mode = o.mode === t.mode ? o.mode : (b && o.mode === b.mode ? t.mode : o.mode);
        if (isBin(bc) || isBin(oc) || isBin(tc)) {
          if (opts.favor) { result.set(path, opts.favor === 'ours' ? o : t); return; }
          addMsg(path, `warning: Cannot merge binary files: ${path} (${labels.ours} vs. ${labels.theirs})`);
          addMsg(path, `CONFLICT (content): Merge conflict in ${path}`);
          conflicts.set(path, { type: 'content', stages: { 1: b, 2: o, 3: t }, work: oc });
          return;
        }
        addMsg(path, `Auto-merging ${path}`);
        const m = Diff.mergeText(bc, oc, tc, { ours: labels.ours, theirs: labels.theirs, favor: opts.favor });
        if (m.conflicts === 0) result.set(path, { hash: repo.putBlob(m.text), mode });
        else {
          addMsg(path, b ? `CONFLICT (content): Merge conflict in ${path}` : `CONFLICT (add/add): Merge conflict in ${path}`);
          conflicts.set(path, { type: b ? 'content' : 'add/add', stages: { 1: b, 2: o, 3: t }, work: m.text });
        }
        return;
      }
      if (!o && t) {
        if (opts.favor === 'theirs') { result.set(path, t); return; }
        if (opts.favor === 'ours') return;
        addMsg(path, `CONFLICT (modify/delete): ${path} deleted in ${labels.ours} and modified in ${labels.theirs}.  Version ${labels.theirs} of ${path} left in tree.`);
        conflicts.set(path, { type: 'modify/delete', stages: { 1: b, 3: t }, work: contentOfEntry(repo, t) });
        return;
      }
      if (o && !t) {
        if (opts.favor === 'ours') { result.set(path, o); return; }
        if (opts.favor === 'theirs') return;
        addMsg(path, `CONFLICT (modify/delete): ${path} deleted in ${labels.theirs} and modified in ${labels.ours}.  Version ${labels.ours} of ${path} left in tree.`);
        conflicts.set(path, { type: 'modify/delete', stages: { 1: b, 2: o }, work: contentOfEntry(repo, o) });
      }
    });
    const lines = [];
    Array.from(msgs.keys()).sort().forEach((p) => msgs.get(p).forEach((l) => lines.push(l)));
    return { result, conflicts, messages: lines };
  }

  /* 병합 결과가 덮어쓸 로컬 변경 점검 */
  function checkOverwrite(repo, res, headFlat) {
    const touched = new Set();
    res.result.forEach((_, p) => touched.add(p));
    res.conflicts.forEach((_, p) => touched.add(p));
    headFlat.forEach((_, p) => touched.add(p));
    const conflictsOut = [], untracked = [];
    Array.from(touched).sort().forEach((p) => {
      const isConflict = res.conflicts.has(p);
      const h = headFlat.get(p);
      const n = res.result.get(p);
      if (!isConflict && eqEntry(h, n)) return;
      const i = repo.index.get(p), w = repo.work.get(p);
      if (!h && !i && !repo.unmerged.has(p)) {
        if (w !== undefined) {
          const nh = n ? n.hash : null;
          if (!nh || sha1.hashObject('blob', w) !== nh) untracked.push(p);
        }
        return;
      }
      const idxDirty = !eqEntry(h, i);
      const workDirty = i ? (w === undefined || sha1.hashObject('blob', w) !== i.hash) : (w !== undefined);
      if (idxDirty || workDirty) conflictsOut.push(p);
    });
    return { conflicts: conflictsOut, untrackedOverwrite: untracked };
  }

  function applyResult(repo, res, headFlat) {
    const touched = new Set();
    res.result.forEach((_, p) => touched.add(p));
    res.conflicts.forEach((_, p) => touched.add(p));
    headFlat.forEach((_, p) => touched.add(p));
    touched.forEach((p) => {
      if (res.conflicts.has(p)) {
        const c = res.conflicts.get(p);
        repo.index.delete(p);
        const st = {};
        [1, 2, 3].forEach((s) => { if (c.stages[s]) st[s] = { hash: c.stages[s].hash, mode: c.stages[s].mode }; });
        repo.unmerged.set(p, st);
        if (c.work === null || c.work === undefined) repo.work.delete(p); else repo.work.set(p, c.work);
        return;
      }
      const h = headFlat.get(p), n = res.result.get(p);
      if (eqEntry(h, n)) return;
      if (n) { repo.index.set(p, { hash: n.hash, mode: n.mode }); repo.work.set(p, repo.blobContent(n.hash)); } else { repo.index.delete(p); repo.work.delete(p); C.removeEmptyParents(repo, p); }
    });
  }

  function overwriteError(r) {
    let msg = '';
    if (r.conflicts.length) msg += `error: Your local changes to the following files would be overwritten by merge:\n${r.conflicts.map((p) => '\t' + p).join('\n')}\nPlease commit your changes or stash them before you merge.\n`;
    if (r.untrackedOverwrite.length) msg += `error: The following untracked working tree files would be overwritten by merge:\n${r.untrackedOverwrite.map((p) => '\t' + p).join('\n')}\nPlease move or remove them before you merge.\n`;
    return msg + 'Aborting';
  }

  function localDirtySnapshot(repo) {
    const head = repo.headFlat();
    const snap = new Map();
    const paths = new Set();
    repo.work.forEach((_, p) => paths.add(p));
    repo.index.forEach((_, p) => paths.add(p));
    head.forEach((_, p) => paths.add(p));
    paths.forEach((p) => {
      const h = head.get(p), w = repo.work.get(p), i = repo.index.get(p);
      if (!i && !h) return; // 추적되지 않는 파일은 그대로 둔다
      const hc = h ? repo.blobContent(h.hash) : undefined;
      if (w !== hc) snap.set(p, w);
    });
    return snap;
  }
  function restoreLocalDirty(repo, snap) {
    if (!snap) return;
    snap.forEach((content, p) => { if (content === undefined) repo.work.delete(p); else repo.work.set(p, content); });
  }

  function newCommit(ctx, repo, o) {
    const committer = ctx.ident('committer');
    const author = o.author || { name: committer.name, email: committer.email, ts: committer.ts, tz: committer.tz };
    const hash = repo.putCommit({ tree: o.tree, parents: o.parents, author, committer, message: o.message });
    if (repo.head.ref) repo.updateRef(repo.head.ref, hash, o.reflog, committer);
    else repo.moveDetachedHead(hash, o.reflog, committer);
    return hash;
  }

  function statBetween(ctx, repo, aFlat, bFlat) {
    const changes = U.diffMaps(repo, aFlat, bFlat);
    if (!changes.length) return '';
    return U.diffStatText(repo, changes) + U.summaryLines(repo, changes);
  }

  function clearSeqState(repo) {
    delete repo.state.merge; delete repo.state.cherryPick; delete repo.state.revert; delete repo.state.squashMsg;
  }

  /* ====================================================================
   *  merge
   * ==================================================================== */
  function defaultMergeMessage(ctx, repo, specs, hashes) {
    const names = specs.map((s, i) => {
      if (repo.refs.has('refs/heads/' + s)) return { kind: 'branch', n: s };
      if (repo.refs.has('refs/remotes/' + s)) return { kind: 'remote', n: s };
      if (repo.refs.has('refs/tags/' + s)) return { kind: 'tag', n: s };
      return { kind: 'commit', n: hashes[i] };
    });
    const parts = [];
    ['branch', 'remote', 'tag', 'commit'].forEach((k) => {
      const list = names.filter((x) => x.kind === k).map((x) => `'${x.n}'`);
      if (!list.length) return;
      const word = { branch: list.length > 1 ? 'branches' : 'branch', remote: list.length > 1 ? 'remote-tracking branches' : 'remote-tracking branch', tag: list.length > 1 ? 'tags' : 'tag', commit: list.length > 1 ? 'commits' : 'commit' }[k];
      const joined = list.length > 1 ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : list[0];
      parts.push(`${word} ${joined}`);
    });
    let msg = 'Merge ' + parts.join('; ');
    const cur = repo.currentBranch();
    if (cur && cur !== 'master' && cur !== 'main') msg += ` into ${cur}`;
    return msg + '\n';
  }

  function conflictMsgTail(res) {
    const paths = Array.from(res.conflicts.keys()).sort();
    return paths.length ? '\n# Conflicts:\n' + paths.map((p) => '#\t' + p).join('\n') + '\n' : '';
  }

  COMMANDS.merge = function (ctx, args) {
    const repo = C.requireWorktree(ctx);
    const p = parseArgs(args, {
      flags: {
        '--abort': 'abort', '--continue': 'cont', '--quit': 'quit', '--no-ff': 'noff', '--ff': 'ff', '--ff-only': 'ffonly', '--squash': 'squash', '--no-squash': 'noSquash', '--no-commit': 'nocommit', '--commit': 'commit',
        '--no-edit': 'noedit', '-e': 'edit', '--edit': 'edit', '-q': 'quiet', '--quiet': 'quiet', '--no-stat': 'nostat', '-n': 'nostat', '--stat': 'stat', '--allow-unrelated-histories': 'unrelated', '--no-verify': 'noverify', '-v': 'verbose', '--autostash': 'autostash',
      },
      opts: { '-m': 'message', '--message': 'message', '-s': 'strategy', '--strategy': 'strategy', '-X': 'xopt', '--strategy-option': 'xopt', '-F': 'file', '--file': 'file' },
    }, 'merge');
    const f = p.f;
    if (f.abort) {
      const st = repo.state.merge;
      if (!st) throw die('There is no merge to abort (MERGE_HEAD missing).');
      const head = repo.headFlat();
      C.hardResetTo(repo, head);
      restoreLocalDirty(repo, st.local);
      clearSeqState(repo);
      return;
    }
    if (f.quit) { clearSeqState(repo); return; }
    if (f.cont) {
      if (!repo.state.merge) throw die('There is no merge in progress (MERGE_HEAD missing).');
      if (p.rest.length) throw die('--continue expects no arguments');
      return COMMANDS.commit(ctx, []);
    }
    if (repo.state.merge) {
      throw new GitError("fatal: You have not concluded your merge (MERGE_HEAD exists).\nPlease, commit your changes before you merge.", 128);
    }
    if (repo.state.cherryPick) throw new GitError("fatal: You have not concluded your cherry-pick (CHERRY_PICK_HEAD exists).\nPlease, commit your changes before you merge.", 128);
    if (repo.unmerged.size) {
      throw new GitError("error: Merging is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.", 128);
    }
    let specs = p.rest.slice();
    if (!specs.length) {
      const br = repo.currentBranch();
      const up = br && repo.upstreamRef(br);
      if (!up) throw die(br ? 'No remote for the current branch.' : 'No remote for the current branch.');
      if (!repo.refs.has(up)) throw die('No remote-tracking branch for the current branch.');
      specs = [up.replace(/^refs\/remotes\//, '')];
    }
    const hashes = [];
    for (const s of specs) {
      const h = repo.resolveCommit(s);
      if (!h) throw fail(`merge: ${s} - not something we can merge`, 1);
      hashes.push(h);
    }
    const head = repo.headCommit();
    const ident = R.identOf(ctx);
    const favor = (p.o.xopt || []).includes('ours') ? 'ours' : ((p.o.xopt || []).includes('theirs') ? 'theirs' : (p.o.strategy && p.o.strategy.includes('ours') ? 'strategy-ours' : null));
    if (!head) {
      // unborn: 그냥 체크아웃처럼 이동
      const flat = repo.commitFlat(hashes[0]);
      C.hardResetTo(repo, flat);
      repo.updateRef(repo.head.ref, hashes[0], `merge ${specs[0]}: Fast-forward`, ident);
      ctx.print('Fast-forward\n');
      return;
    }
    // 이미 포함된 대상 제거
    const live = [], liveSpecs = [];
    hashes.forEach((h, i) => {
      if (repo.isAncestor(h, head)) return;
      // 다른 병합 대상의 조상이거나 중복이면 제외 (git 의 reduce_parents)
      if (hashes.some((o, j) => j !== i && o !== h && repo.isAncestor(h, o))) return;
      if (live.includes(h)) return;
      live.push(h); liveSpecs.push(specs[i]);
    });
    if (!live.length) { if (!f.quiet) ctx.print('Already up to date.\n'); return; }
    const headFlat = repo.headFlat();

    /* 빨리감기 */
    const canFF = live.length === 1 && repo.isAncestor(head, live[0]);
    if (canFF && !f.noff && !f.squash) {
      const target = live[0];
      const tFlat = repo.commitFlat(target);
      const r = C.switchTree(ctx, repo, tFlat, {});
      if (r.conflicts.length || r.untrackedOverwrite.length) throw fail(overwriteError(r), 1);
      repo.special.ORIG_HEAD = head;
      const ffMsg = `${ctx.pullMode ? 'pull' : 'merge ' + liveSpecs[0]}: Fast-forward`;
      if (repo.head.ref) repo.updateRef(repo.head.ref, target, ffMsg, ident); else repo.moveDetachedHead(target, ffMsg, ident);
      if (!f.quiet) {
        ctx.print(`Updating ${repo.shortHash(head, 7)}..${repo.shortHash(target, 7)}\nFast-forward\n`);
        if (!f.nostat) ctx.print(statBetween(ctx, repo, headFlat, tFlat));
      }
      return;
    }
    if (f.ffonly) throw die('Not possible to fast-forward, aborting.');

    /* 실제 병합 (여러 head 는 순차 병합) */
    repo.special.ORIG_HEAD = head;
    let curFlat = headFlat;
    let allMsgs = [];
    let lastRes = null;
    let mergedResult = null;
    const labelOurs = 'HEAD';
    for (let k = 0; k < live.length; k++) {
      const target = live[k];
      const bases = repo.mergeBases(head, target);
      let baseFlat;
      if (!bases.length) {
        if (!f.unrelated) throw die('refusing to merge unrelated histories');
        baseFlat = new Map();
      } else baseFlat = repo.commitFlat(bases[0]);
      if (f.strategy === undefined && false) void 0;
      const res = mergeTrees(ctx, repo, baseFlat, curFlat, repo.commitFlat(target), { ours: labelOurs, theirs: liveSpecs[k] }, { favor: favor === 'strategy-ours' ? 'ours' : favor });
      if (favor === 'strategy-ours') { res.result.clear(); curFlat.forEach((e, pth) => res.result.set(pth, e)); res.conflicts.clear(); res.messages.length = 0; }
      allMsgs = allMsgs.concat(res.messages);
      lastRes = res;
      if (res.conflicts.size) {
        if (live.length > 1) {
          ctx.print('Automated merge did not work.\nShould not be doing an octopus.\n');
          throw fail('Merge with strategy octopus failed.', 2);
        }
        break;
      }
      mergedResult = new Map(res.result);
      curFlat = mergedResult;
    }
    const res = lastRes;
    const ov = checkOverwrite(repo, res, headFlat);
    if (ov.conflicts.length || ov.untrackedOverwrite.length) throw fail(overwriteError(ov), 1);
    const localSnap = localDirtySnapshot(repo);
    applyResult(repo, res, headFlat);
    if (allMsgs.length) ctx.print(allMsgs.join('\n') + '\n');
    let msg = p.o.message ? cleanupMessage(p.o.message.join('\n\n'), false) : defaultMergeMessage(ctx, repo, liveSpecs, live);
    if (f.squash) {
      if (res.conflicts.size) {
        repo.state.squashMsg = msg + conflictMsgTail(res);
        ctx.print('Squash commit -- not updating HEAD\nAutomatic merge failed; fix conflicts and then commit the result.\n');
        throw fail('', 1);
      }
      repo.state.squashMsg = 'Squashed commit of the following:\n\n' + repo.revWalk(live, [head], { order: 'date' }).map((h) => { const c = repo.commitObj(h); return `commit ${h}\nAuthor: ${c.author.name} <${c.author.email}>\nDate:   ${U.formatDate(c.author.ts, c.author.tz, 'default', ctx.now)}\n\n${U.indentMessage(c.message)}`; }).join('\n') + '\n';
      ctx.print('Squash commit -- not updating HEAD\nAutomatic merge went well; stopped before committing as requested\n');
      return;
    }
    if (res.conflicts.size) {
      repo.state.merge = { heads: live.slice(), msg: msg + conflictMsgTail(res), local: localSnap, specs: liveSpecs };
      ctx.print('Automatic merge failed; fix conflicts and then commit the result.\n');
      throw fail('', 1);
    }
    if (f.nocommit) {
      repo.state.merge = { heads: live.slice(), msg, local: localSnap, specs: liveSpecs };
      ctx.print('Automatic merge went well; stopped before committing as requested\n');
      return;
    }
    if (f.edit) msg = cleanupMessage(ctx.input('editor', { kind: 'MERGE_MSG', initial: C.commitTemplate(ctx, repo, msg, {}) }), true);
    const tree = repo.flatToTree(repo.indexFlat());
    const strategyName = live.length > 1 ? 'octopus' : 'ort';
    const hash = newCommit(ctx, repo, { tree, parents: [head].concat(live), message: msg, reflog: `${ctx.pullMode ? 'pull' : 'merge ' + liveSpecs.join(' ')}: Merge made by the '${strategyName}' strategy.` });
    if (!f.quiet) {
      ctx.print(`Merge made by the '${strategyName}' strategy.\n`);
      if (!f.nostat) ctx.print(statBetween(ctx, repo, headFlat, repo.commitFlat(hash)));
    }
  };

  G.merge = Object.assign(G.merge || {}, { mergeTrees, checkOverwrite, applyResult, newCommit, eqEntry, overwriteError, clearSeqState, conflictMsgTail, recreateConflict: null });
})();
