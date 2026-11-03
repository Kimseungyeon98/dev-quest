/* git 명령어 구현 (4): merge / cherry-pick / revert / rebase / stash */
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

  /* ====================================================================
   *  cherry-pick / revert (sequencer)
   * ==================================================================== */
  const PICK_HINT = (verb) => `hint: After resolving the conflicts, mark them with\nhint: "git add/rm <pathspec>", then run\nhint: "git ${verb} --continue".\nhint: You can instead skip this commit with "git ${verb} --skip".\nhint: To abort and get back to the state before "git ${verb}",\nhint: run "git ${verb} --abort".\nhint: Disable this message with "git config advice.mergeConflict false"\n`;

  function pickPrintSummary(ctx, repo, hash, c, committerIdent) {
    ctx.print(C.commitHeaderLine(ctx, repo, hash, {}));
    if (c.author.name !== committerIdent.name || c.author.email !== committerIdent.email) ctx.print(` Author: ${c.author.name} <${c.author.email}>\n`);
    ctx.print(` Date: ${U.formatDate(c.author.ts, c.author.tz, 'default', ctx.now)}\n`);
    if (c.parents.length < 2) ctx.print(C.commitStatText(ctx, repo, hash));
  }

  /* 한 커밋을 현재 인덱스/작업트리에 적용. 반환 { conflict, empty, tree, res, message } */
  function applyOne(ctx, repo, hash, o) {
    const c = repo.commitObj(hash);
    let parentIdx = o.mainline ? o.mainline - 1 : 0;
    if (c.parents.length > 1 && !o.mainline) throw die(`${o.verb === 'revert' ? 'commit' : 'commit'} ${hash} is a merge but no -m option was given.`);
    const parent = c.parents[parentIdx];
    const parentFlat = parent ? repo.commitFlat(parent) : new Map();
    const commitFlat = repo.commitFlat(hash);
    const headFlat = repo.headFlat();
    const sub = U.subjectOf(c.message);
    const short = repo.shortHash(hash, 7);
    let base, theirs, labels;
    if (o.verb === 'revert') { base = commitFlat; theirs = parentFlat; labels = { ours: 'HEAD', theirs: `parent of ${short} (${sub})` }; } else { base = parentFlat; theirs = commitFlat; labels = { ours: o.oursLabel || 'HEAD', theirs: `${short} (${sub})` }; }
    const res = mergeTrees(ctx, repo, base, headFlat, theirs, labels, { favor: o.favor });
    const ov = checkOverwrite(repo, res, headFlat);
    if (ov.conflicts.length || ov.untrackedOverwrite.length) {
      const verbWord = o.verb === 'revert' ? 'revert' : 'cherry-pick';
      const e = (ov.conflicts.length ? `error: Your local changes would be overwritten by ${verbWord}.\n` : `error: The following untracked working tree files would be overwritten by merge:\n${ov.untrackedOverwrite.map((x) => '\t' + x).join('\n')}\nPlease move or remove them before you merge.\n`);
      throw fail(e + `hint: commit your changes or stash them to proceed.\nfatal: ${verbWord} failed`, 128);
    }
    applyResult(repo, res, headFlat);
    if (res.messages.length) ctx.print(res.messages.join('\n') + '\n');
    let message = c.message;
    if (o.verb === 'revert') {
      const isRevertRevert = /^Revert "/.test(sub);
      const newSub = isRevertRevert ? `Revert "${sub}"` : `Revert "${sub}"`;
      const fullLine = isRevertRevert && /^Revert "(.*)"$/.test(sub) ? `Reapply "${sub.match(/^Revert "(.*)"$/)[1]}"` : newSub;
      message = `${fullLine}\n\nThis reverts commit ${hash}.\n`;
      if (c.parents.length > 1) message = message.replace(/\.\n$/, `, reversing\nchanges made to ${c.parents[parentIdx]}.\n`);
    } else if (o.x) {
      const body = c.message.replace(/\n+$/, '');
      const hasTrailer = /\n\n([A-Za-z-]+: .*\n?)+$/.test(c.message) && body.split('\n\n').length > 1 && /^[A-Za-z-]+: /.test(body.split('\n\n').pop());
      message = body + (hasTrailer ? '\n' : '\n\n') + `(cherry picked from commit ${hash})\n`;
    }
    return { conflict: res.conflicts.size > 0, res, message, c, labels };
  }

  function seqRun(ctx, repo, verb, queue, opts) {
    // queue: 남은 커밋 해시 배열. 하나씩 적용하면서 충돌이면 멈춘다.
    const committerIdent = ctx.ident('committer');
    while (queue.length) {
      const hash = queue[0];
      const preHead = repo.headCommit();
      const out = applyOne(ctx, repo, hash, { verb, mainline: opts.mainline, x: opts.x, favor: opts.favor });
      const stateKey = verb === 'revert' ? 'revert' : 'cherryPick';
      const author = verb === 'revert' ? null : out.c.author;
      if (out.conflict) {
        queue.shift();
        repo.state[stateKey] = { head: hash, msg: out.message + conflictMsgTail(out.res), author, todo: queue.slice(), origHead: opts.origHead, opts, noCommit: opts.noCommit };
        const sub = U.subjectOf(out.c.message);
        ctx.eprint(`error: could not ${verb === 'revert' ? 'revert' : 'apply'} ${repo.shortHash(hash, 7)}... ${sub}\n`);
        if (U.trackingMessage && R.cfgBool(ctx.cfg('advice.mergeconflict'), true)) ctx.eprint(PICK_HINT(verb === 'revert' ? 'revert' : 'cherry-pick'));
        throw fail('', 1);
      }
      const tree = repo.flatToTree(repo.indexFlat());
      const headTree = preHead ? repo.commitObj(preHead).tree : EMPTY_TREE;
      if (opts.noCommit) { queue.shift(); continue; }
      if (tree === headTree && opts.dropEmpty && !opts.allowEmpty) { queue.shift(); continue; }
      if (tree === headTree && !opts.allowEmpty && !opts.keepRedundant) {
        queue.shift();
        repo.state[stateKey] = { head: hash, msg: out.message, author, todo: queue.slice(), origHead: opts.origHead, opts, empty: true };
        ctx.print(U.statusLong(ctx, {}).text);
        ctx.eprint(`The previous ${verb === 'revert' ? 'revert' : 'cherry-pick'} is now empty, possibly due to conflict resolution.\nIf you wish to commit it anyway, use:\n\n    git commit --allow-empty\n\nOtherwise, please use 'git ${verb === 'revert' ? 'revert' : 'cherry-pick'} --skip'\n`);
        throw fail('', 1);
      }
      let message = out.message;
      if (opts.edit) message = cleanupMessage(ctx.input('editor', { kind: 'COMMIT_EDITMSG', initial: C.commitTemplate(ctx, repo, message, {}) }), true);
      const newHash = newCommit(ctx, repo, { tree, parents: [preHead], author: author || undefined, message, reflog: `${verb === 'revert' ? 'revert' : 'cherry-pick'}: ${U.subjectOf(message)}` });
      const nc = repo.commitObj(newHash);
      if (!opts.quiet) pickPrintSummary(ctx, repo, newHash, nc, committerIdent);
      queue.shift();
    }
    clearSeqState(repo);
  }

  function seqCommand(verb) {
    return function (ctx, args) {
      const repo = C.requireWorktree(ctx);
      const key = verb === 'revert' ? 'revert' : 'cherryPick';
      const p = parseArgs(args, {
        flags: { '--continue': 'cont', '--abort': 'abort', '--skip': 'skip', '--quit': 'quit', '-n': 'noCommit', '--no-commit': 'noCommit', '-x': 'x', '-e': 'edit', '--edit': 'edit', '--no-edit': 'noedit', '--allow-empty': 'allowEmpty', '--keep-redundant-commits': 'keepRedundant', '--ff': 'ff', '-s': 'signoff', '--signoff': 'signoff', '--allow-empty-message': 'allowEmptyMsg', '-q': 'quiet' },
        opts: { '-m': 'mainline', '--mainline': 'mainline', '-X': 'xopt', '--strategy-option': 'xopt', '--strategy': 'strategy' },
      }, verb === 'revert' ? 'revert' : 'cherry-pick');
      const f = p.f;
      const st = repo.state[key];
      const ident = R.identOf(ctx);
      if (f.quit) { delete repo.state[key]; return; }
      if (f.abort) {
        if (!st) throw new GitError(`error: no cherry-pick or revert in progress\nfatal: ${verb === 'revert' ? 'revert' : 'cherry-pick'} failed`, 128);
        const orig = st.origHead || repo.headCommit();
        const flat = orig ? repo.commitFlat(orig) : new Map();
        C.hardResetTo(repo, flat);
        if (orig && orig !== repo.headCommit()) {
          if (repo.head.ref) repo.updateRef(repo.head.ref, orig, `${verb === 'revert' ? 'revert' : 'cherry-pick'}: abort`, ident); else repo.moveDetachedHead(orig, 'reset: moving to ' + orig, ident);
        }
        delete repo.state[key];
        return;
      }
      if (f.skip) {
        if (!st) throw new GitError(`error: no cherry-pick or revert in progress\nfatal: ${verb === 'revert' ? 'revert' : 'cherry-pick'} failed`, 128);
        const flat = repo.headFlat();
        C.hardResetTo(repo, flat);
        const queue = (st.todo || []).slice();
        delete repo.state[key];
        const opts = Object.assign({}, st.opts || {}, { dropEmpty: true });
        opts.origHead = st.origHead;
        return seqRun(ctx, repo, verb, queue, opts);
      }
      if (f.cont) {
        if (!st) throw new GitError(`error: no cherry-pick or revert in progress\nfatal: ${verb === 'revert' ? 'revert' : 'cherry-pick'} failed`, 128);
        if (repo.unmerged.size) {
          ctx.print(Array.from(repo.unmerged.keys()).sort().map((x) => `${x}: needs merge\n`).join(''));
          throw new GitError(`error: Committing is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.\nfatal: ${verb === 'revert' ? 'revert' : 'cherry-pick'} failed`, 128);
        }
        const tree = repo.flatToTree(repo.indexFlat());
        const headCommit = repo.headCommit();
        const headTree = headCommit ? repo.commitObj(headCommit).tree : EMPTY_TREE;
        const opts = st.opts || {};
        if (tree !== headTree || opts.allowEmpty || st.empty) {
          let message = cleanupMessage(st.msg, true);
          if (f.edit || (opts.edit && !f.noedit)) message = cleanupMessage(ctx.input('editor', { kind: 'COMMIT_EDITMSG', initial: C.commitTemplate(ctx, repo, st.msg, {}) }), true);
          const nh = newCommit(ctx, repo, { tree, parents: [headCommit], author: st.author || undefined, message, reflog: `${verb === 'revert' ? 'revert' : 'cherry-pick'}: ${U.subjectOf(message)}` });
          pickPrintSummary(ctx, repo, nh, repo.commitObj(nh), ctx.ident('committer'));
        }
        const queue = (st.todo || []).slice();
        delete repo.state[key];
        opts.origHead = st.origHead;
        return seqRun(ctx, repo, verb, queue, opts);
      }
      if (st) {
        throw new GitError(`error: ${verb === 'revert' ? 'revert' : 'cherry-pick'} is already in progress\nhint: try "git ${verb === 'revert' ? 'revert' : 'cherry-pick'} (--continue | --skip | --abort | --quit)"\nfatal: ${verb === 'revert' ? 'revert' : 'cherry-pick'} failed`, 128);
      }
      if (repo.state.merge) throw new GitError(`error: ${verb === 'revert' ? 'revert' : 'cherry-pick'} failed: You have not concluded your merge (MERGE_HEAD exists).\nfatal: ${verb === 'revert' ? 'revert' : 'cherry-pick'} failed`, 128);
      if (!p.rest.length) throw fail(`usage: git ${verb === 'revert' ? 'revert' : 'cherry-pick'} [--edit] [-n] [-m <parent-number>] [-s] [-x] <commit>...\n   or: git ${verb === 'revert' ? 'revert' : 'cherry-pick'} (--continue | --skip | --abort | --quit)`, 129);
      if (repo.unmerged.size) throw new GitError(`error: ${verb === 'revert' ? 'revert' : 'cherry-pick'} failed: ...\nfatal: ${verb === 'revert' ? 'revert' : 'cherry-pick'} failed`, 128);
      // 대상 커밋 목록
      const queue = [];
      p.rest.forEach((spec) => {
        const range = spec.match(/^(.*)\.\.(.*)$/);
        if (range && !spec.includes('...')) {
          const lo = repo.resolveCommit(range[1] || 'HEAD'), hi = repo.resolveCommit(range[2] || 'HEAD');
          if (!lo || !hi) throw die(`bad revision '${spec}'`);
          repo.revWalk([hi], [lo], { order: 'topo', reverse: verb !== 'revert' }).forEach((h) => queue.push(h));
          return;
        }
        const h = repo.resolveCommit(spec);
        if (!h) throw die(`bad revision '${spec}'`);
        queue.push(h);
      });
      const origHead = repo.headCommit();
      if (!origHead) throw die('You do not have a valid HEAD');
      const favor = (p.o.xopt || []).includes('ours') ? 'ours' : ((p.o.xopt || []).includes('theirs') ? 'theirs' : null);
      const opts = { x: f.x, noCommit: f.noCommit, edit: f.edit && !f.noedit, allowEmpty: f.allowEmpty, keepRedundant: f.keepRedundant, mainline: p.o.mainline ? parseInt(p.o.mainline[0], 10) : 0, origHead, favor, quiet: f.quiet };
      // 빨리감기: 현재 HEAD 가 대상의 부모이고 --ff 인 경우
      if (verb !== 'revert' && f.ff && queue.length === 1 && repo.parents(queue[0])[0] === origHead) {
        const t = queue[0];
        const r = C.switchTree(ctx, repo, repo.commitFlat(t), {});
        if (r.conflicts.length) throw fail(C.switchErrorMessage(r, 'merge'), 1);
        if (repo.head.ref) repo.updateRef(repo.head.ref, t, `cherry-pick: fast-forward`, ident); else repo.moveDetachedHead(t, 'cherry-pick: fast-forward', ident);
        return;
      }
      // 변경이 없는 선행 상태에서 -n 는 인덱스에 남겨둔다
      if (!opts.noCommit && verb !== 'revert' && false) void 0;
      seqRun(ctx, repo, verb, queue, opts);
      if (f.noCommit && verb === 'revert') { /* 변경이 인덱스에 남는다 */ }
    };
  }
  COMMANDS['cherry-pick'] = seqCommand('cherry-pick');
  COMMANDS.revert = seqCommand('revert');

  /* ====================================================================
   *  rebase
   * ==================================================================== */
  function patchIdOf(repo, hash) {
    const c = repo.commitObj(hash);
    const aFlat = c.parents[0] ? repo.commitFlat(c.parents[0]) : new Map();
    const changes = U.diffMaps(repo, aFlat, repo.commitFlat(hash), { renames: false });
    let s = '';
    changes.forEach((ch) => {
      const a = ch.a ? repo.blobContent(ch.a.hash) : '', b = ch.b ? repo.blobContent(ch.b.hash) : '';
      const al = Diff.splitLines(a), bl = Diff.splitLines(b);
      s += ch.path + '\n';
      Diff.diffBlocks(al, bl).forEach((bk) => { al.slice(bk.a0, bk.a1).forEach((l) => { s += '-' + l; }); bl.slice(bk.b0, bk.b1).forEach((l) => { s += '+' + l; }); });
    });
    return sha1.hashObject('blob', s);
  }

  const TODO_HELP = `#
# Commands:
# p, pick <commit> = use commit
# r, reword <commit> = use commit, but edit the commit message
# e, edit <commit> = use commit, but stop for amending
# s, squash <commit> = use commit, but meld into previous commit
# f, fixup [-C | -c] <commit> = like "squash" but keep only the previous
#                    commit's log message, unless -C is used, in which case
#                    keep only this commit's message; -c is same as -C but
#                    opens the editor
# x, exec <command> = run command (the rest of the line) using shell
# b, break = stop here (continue rebase later with 'git rebase --continue')
# d, drop <commit> = remove commit
# l, label <label> = label current HEAD with a name
# t, reset <label> = reset HEAD to a label
# m, merge [-C <commit> | -c <commit>] <label> [# <oneline>]
#         create a merge commit using the original merge commit's
#         message (or the oneline, if no original merge commit was
#         specified); use -c <commit> to reword the commit message
# u, update-ref <ref> = track a placeholder for the <ref> to be updated
#                       to this position in the new commits. The <ref> is
#                       updated at the end of the rebase
#
# These lines can be re-ordered; they are executed from top to bottom.
#
# If you remove a line here THAT COMMIT WILL BE LOST.
#
# However, if you remove everything, the rebase will be aborted.
#
`;
  const CMD_ALIASES = { p: 'pick', pick: 'pick', r: 'reword', reword: 'reword', e: 'edit', edit: 'edit', s: 'squash', squash: 'squash', f: 'fixup', fixup: 'fixup', d: 'drop', drop: 'drop', x: 'exec', exec: 'exec', b: 'break', break: 'break' };

  function startRebase(ctx, repo, rb) {
    // rb: { onto, ontoSpec, upstream, headName, origHead, todo, interactive, exec }
    const ident = R.identOf(ctx);
    repo.special.ORIG_HEAD = rb.origHead;
    // HEAD 를 onto 로 분리
    const flat = repo.commitFlat(rb.onto);
    const r = C.switchTree(ctx, repo, flat, {});
    if (r.conflicts.length || r.untrackedOverwrite.length) throw fail(C.switchErrorMessage(r, 'checkout'), 1);
    repo.setHead({ hash: rb.onto }, `rebase (start): checkout ${rb.ontoSpec}`, ident);
    repo.state.rebase = { interactive: true, onto: rb.onto, ontoSpec: rb.ontoSpec, headName: rb.headName, origHead: rb.origHead, todo: rb.todo.slice(), done: [], total: rb.todo.length, conflict: false, quiet: rb.quiet };
    return rebaseContinueLoop(ctx, repo);
  }

  function finishRebase(ctx, repo) {
    const rb = repo.state.rebase;
    const ident = R.identOf(ctx);
    const newTip = repo.headCommit();
    if (rb.headName && rb.headName.startsWith('refs/')) {
      const old = repo.readRef(rb.headName);
      repo.refs.set(rb.headName, newTip);
      repo.logRef(rb.headName, old || ZERO, newTip, `rebase (finish): ${rb.headName} onto ${rb.onto}`, ident);
      repo.head = { ref: rb.headName };
      repo.logRef('HEAD', newTip, newTip, `rebase (finish): returning to ${rb.headName}`, ident);
    }
    repo.special.ORIG_HEAD = rb.origHead;
    delete repo.state.rebase;
    if (!rb.quiet) ctx.eprint(`\r\x1b[KSuccessfully rebased and updated ${rb.headName}.\n`);
  }

  function pickIntoRebase(ctx, repo, rb, entry) {
    const hash = entry.hash;
    const preHead = repo.headCommit();
    const c = repo.commitObj(hash);
    const out = applyOne(ctx, repo, hash, { verb: 'pick', oursLabel: 'HEAD' });
    rb.currentAuthor = c.author;
    rb.currentMsg = c.message;
    rb.preHead = preHead;
    rb.currentCmd = entry;
    if (out.conflict) {
      rb.conflict = true;
      ctx.eprint(`error: could not apply ${repo.shortHash(hash, 7)}... ${U.subjectOf(c.message)}\n`);
      if (R.cfgBool(ctx.cfg('advice.mergeconflict'), true)) ctx.eprint(`hint: Resolve all conflicts manually, mark them as resolved with\nhint: "git add/rm <conflicted_files>", then run "git rebase --continue".\nhint: You can instead skip this commit: run "git rebase --skip".\nhint: To abort and get back to the state before "git rebase", run "git rebase --abort".\nhint: Disable this message with "git config advice.mergeConflict false"\n`);
      ctx.eprint(`Could not apply ${repo.shortHash(hash, 7)}... ${U.subjectOf(c.message)}\n`);
      throw fail('', 1);
    }
    return { out, c, preHead };
  }

  function rebaseContinueLoop(ctx, repo) {
    const rb = repo.state.rebase;
    const ident = R.identOf(ctx);
    while (rb.todo.length) {
      const entry = rb.todo.shift();
      rb.done.push(entry);
      const idx = rb.done.length;
      if (!rb.quiet && (entry.cmd === 'pick' || entry.cmd === 'reword' || entry.cmd === 'edit' || entry.cmd === 'squash' || entry.cmd === 'fixup')) ctx.eprint(`Rebasing (${idx}/${rb.total})` + (rb.todo.length > 0 ? '\r' : '\r'));
      if (entry.cmd === 'drop') continue;
      if (entry.cmd === 'exec') {
        ctx.eprint(`Executing: ${entry.text}\n`);
        const r = ctx.sim.exec ? ctx.sim.execInline && ctx.sim.execInline(ctx, entry.text) : null;
        if (r && r.code !== 0) {
          ctx.eprint(`warning: execution failed: ${entry.text}\nYou can fix the problem, and then run\n\n  git rebase --continue\n\n`);
          rb.conflict = false;
          throw fail('', 1);
        }
        continue;
      }
      if (entry.cmd === 'break') {
        ctx.eprint('Stopped at ' + repo.shortHash(repo.headCommit(), 7) + '\nYou can continue with \'git rebase --continue\'.\n');
        throw fail('', 1);
      }
      const { out, c, preHead } = pickIntoRebase(ctx, repo, rb, entry);
      const tree = repo.flatToTree(repo.indexFlat());
      const headTree = preHead ? repo.commitObj(preHead).tree : EMPTY_TREE;
      if (entry.cmd === 'squash' || entry.cmd === 'fixup') {
        // 직전 커밋에 합친다
        const prev = repo.commitObj(preHead);
        let message = prev.message;
        if (entry.cmd === 'squash') {
          const n = (rb.squashCount || 1) + 1;
          const first = rb.squashBase || prev.message;
          const combined = `# This is a combination of ${n} commits.\n# This is the 1st commit message:\n\n${first.replace(/\n+$/, '')}\n\n# This is the commit message #${n}:\n\n${c.message.replace(/\n+$/, '')}\n`;
          message = cleanupMessage(ctx.input('editor', { kind: 'COMMIT_EDITMSG', initial: C.commitTemplate(ctx, repo, combined, {}) }), true);
          rb.squashCount = n;
          rb.squashBase = message;
        }
        const committer = ctx.ident('committer');
        const nh = repo.putCommit({ tree, parents: prev.parents.slice(), author: prev.author, committer, message });
        repo.moveDetachedHead(nh, `rebase (${entry.cmd}): ${U.subjectOf(message)}`, committer);
        repo.index = repo.index; // no-op
      } else {
        rb.squashCount = 1; rb.squashBase = null;
        if (tree === headTree && !out.conflict && !rb.keepEmpty) {
          // 이미 반영된 변경: 건너뛴다
          continue;
        }
        let message = c.message;
        if (entry.cmd === 'reword') message = cleanupMessage(ctx.input('editor', { kind: 'COMMIT_EDITMSG', initial: C.commitTemplate(ctx, repo, c.message, {}) }), true);
        newCommit(ctx, repo, { tree, parents: [preHead], author: c.author, message, reflog: `rebase (${entry.cmd === 'reword' ? 'reword' : 'pick'}): ${U.subjectOf(message)}` });
        rb.squashBase = message;
      }
      if (entry.cmd === 'edit') {
        rb.stoppedEdit = true; rb.conflict = false;
        ctx.eprint(`Stopped at ${repo.shortHash(entry.hash, 7)}... ${entry.subject}\nYou can amend the commit now, with\n\n  git commit --amend \n\nOnce you are satisfied with your changes, run\n\n  git rebase --continue\n`);
        throw fail('', 1);
      }
    }
    void ident;
    finishRebase(ctx, repo);
  }

  function buildTodo(repo, commits) {
    return commits.map((h) => ({ cmd: 'pick', hash: h, subject: U.subjectOf(repo.commitObj(h).message) }));
  }

  COMMANDS.rebase = function (ctx, args) {
    const repo = C.requireWorktree(ctx);
    const p = parseArgs(args, {
      flags: { '--continue': 'cont', '--abort': 'abort', '--skip': 'skip', '--quit': 'quit', '-i': 'interactive', '--interactive': 'interactive', '--root': 'root', '-q': 'quiet', '--quiet': 'quiet', '--autosquash': 'autosquash', '--no-autosquash': 'noAutosquash', '--autostash': 'autostash', '--no-ff': 'noff', '-f': 'noff', '--force-rebase': 'noff', '-m': 'merge', '--merge': 'merge', '--apply': 'apply', '--keep-base': 'keepBase', '--edit-todo': 'editTodo', '--show-current-patch': 'showPatch', '--reapply-cherry-picks': 'reapply', '--no-verify': 'noverify', '-r': 'rebaseMerges', '--rebase-merges': 'rebaseMerges', '--fork-point': 'forkPoint', '--no-fork-point': 'noForkPoint', '-v': 'verbose', '-n': 'nostat', '--no-stat': 'nostat', '--stat': 'stat' },
      opts: { '--onto': 'onto', '-x': 'exec', '--exec': 'exec', '--empty': 'empty', '-s': 'strategy', '-X': 'xopt' },
    }, 'rebase');
    const f = p.f;
    const ident = R.identOf(ctx);
    const rb = repo.state.rebase;
    if (f.abort) {
      if (!rb) throw die('no rebase in progress');
      const flat = repo.commitFlat(rb.origHead);
      C.hardResetTo(repo, flat);
      if (rb.headName && rb.headName.startsWith('refs/')) {
        repo.head = { ref: rb.headName };
        repo.logRef('HEAD', repo.headCommit(), rb.origHead, `rebase (abort): returning to ${rb.headName}`, ident);
        repo.refs.set(rb.headName, rb.origHead);
      } else repo.moveDetachedHead(rb.origHead, 'rebase (abort): returning to ' + rb.headName, ident);
      delete repo.state.rebase;
      return;
    }
    if (f.quit) { if (!rb) throw die('no rebase in progress'); delete repo.state.rebase; return; }
    if (f.skip) {
      if (!rb) throw die('no rebase in progress');
      C.hardResetTo(repo, repo.headFlat());
      rb.conflict = false; rb.stoppedEdit = false;
      return rebaseContinueLoop(ctx, repo);
    }
    if (f.editTodo) {
      if (!rb) throw die('no rebase in progress');
      const text = rb.todo.map((e) => `${e.cmd} ${repo.shortHash(e.hash, 7)} ${e.subject}`).join('\n') + '\n' + TODO_HELP;
      const edited = ctx.input('editor', { kind: 'git-rebase-todo', initial: text });
      rb.todo = parseTodo(repo, edited);
      rb.total = rb.done.length + rb.todo.length;
      return;
    }
    if (f.cont) {
      if (!rb) throw die('no rebase in progress');
      if (repo.unmerged.size) {
        ctx.print(Array.from(repo.unmerged.keys()).sort().map((x) => `${x}: needs merge\n`).join('') + 'You must edit all merge conflicts and then\nmark them as resolved using git add\n');
        throw fail('', 1);
      }
      const head = repo.headCommit();
      if (rb.stoppedEdit) {
        // edit 멈춤: 작업이 있으면 amend 되어 있을 것. 남은 변경은 커밋한다
        const tree = repo.flatToTree(repo.indexFlat());
        const headTree = repo.commitObj(head).tree;
        if (tree !== headTree) {
          const prev = repo.commitObj(head);
          const nh = repo.putCommit({ tree, parents: prev.parents.slice(), author: prev.author, committer: ctx.ident('committer'), message: prev.message });
          repo.moveDetachedHead(nh, `rebase (continue): ${U.subjectOf(prev.message)}`, ident);
        }
        rb.stoppedEdit = false;
      } else if (rb.conflict || rb.currentCmd) {
        const tree = repo.flatToTree(repo.indexFlat());
        const headTree = head ? repo.commitObj(head).tree : EMPTY_TREE;
        if (head === rb.preHead && rb.conflict) {
          if (tree === headTree) {
            throw new GitError("No changes - did you forget to use 'git add'?\nIf there is nothing left to stage, chances are that something else\nalready introduced the same changes; you might want to skip this patch.", 1);
          }
          let message = rb.currentMsg;
          const cmd = rb.currentCmd;
          if (cmd && cmd.cmd === 'reword') message = cleanupMessage(ctx.input('editor', { kind: 'COMMIT_EDITMSG', initial: C.commitTemplate(ctx, repo, rb.currentMsg, {}) }), true);
          if (cmd && (cmd.cmd === 'squash' || cmd.cmd === 'fixup')) {
            const prev = repo.commitObj(head);
            const nh = repo.putCommit({ tree, parents: prev.parents.slice(), author: prev.author, committer: ctx.ident('committer'), message: cmd.cmd === 'fixup' ? prev.message : prev.message + '\n' + rb.currentMsg });
            repo.moveDetachedHead(nh, `rebase (continue): ${U.subjectOf(prev.message)}`, ident);
          } else newCommit(ctx, repo, { tree, parents: [head], author: rb.currentAuthor, message, reflog: `rebase (continue): ${U.subjectOf(message)}` });
        }
        rb.conflict = false;
      }
      return rebaseContinueLoop(ctx, repo);
    }
    if (rb) throw new GitError("fatal: It seems that there is already a rebase-merge directory, and\nI wonder if you are in the middle of another rebase.  If that is the\ncase, please try\n\tgit rebase (--continue | --abort | --skip)\nIf that is not the case, please\n\trm -fr \".git/rebase-merge\"\nand run me again.  I am stopping in case you still have something\nvaluable there.", 128);
    if (repo.state.merge || repo.state.cherryPick || repo.state.revert) throw new GitError('fatal: cannot rebase: You have unstaged changes.', 128);

    /* 시작 */
    const cur = repo.currentBranch();
    let upstreamSpec = p.rest[0];
    let branchSpec = p.rest[1];
    if (f.root) {
      branchSpec = p.rest[0];
      upstreamSpec = null;
    } else if (!upstreamSpec) {
      const up = cur && repo.upstreamRef(cur);
      if (!up) {
        throw new GitError(`There is no tracking information for the current branch.\nPlease specify which branch you want to rebase against.\nSee git-rebase(1) for details.\n\n    git rebase '<branch>'\n\nIf you wish to set tracking information for this branch you can do so with:\n\n    git branch --set-upstream-to=<remote>/<branch> ${cur || 'HEAD'}\n`, 1);
      }
      upstreamSpec = up.replace(/^refs\/remotes\//, '');
    }
    let upstream = null;
    if (upstreamSpec) {
      upstream = repo.resolveCommit(upstreamSpec);
      if (!upstream) throw die(`invalid upstream '${upstreamSpec}'`);
    }
    // 대상 브랜치로 전환
    if (branchSpec) {
      const target = repo.resolveCommit(branchSpec);
      if (!target) throw die(`invalid branch '${branchSpec}'`);
      if (repo.refs.has('refs/heads/' + branchSpec) && repo.head.ref !== 'refs/heads/' + branchSpec) {
        R.doSwitch(ctx, repo, { target: { ref: 'refs/heads/' + branchSpec }, targetCommit: target, label: branchSpec, quiet: true });
      }
    }
    const headName = repo.head.ref || null;
    const origHead = repo.headCommit();
    if (!origHead) throw die("Needed a single revision\nInvalid base");
    let ontoSpec = p.o.onto ? p.o.onto[0] : upstreamSpec;
    let onto = p.o.onto ? repo.resolveCommit(p.o.onto[0]) : upstream;
    if (f.keepBase && upstream) { onto = repo.mergeBases(upstream, origHead)[0]; ontoSpec = repo.shortHash(onto, 7); }
    if (!onto && !f.root) throw die(`Does not point to a valid commit '${p.o.onto ? p.o.onto[0] : upstreamSpec}'`);
    // 로컬 변경 점검
    const dirty = C.localChangeLines(repo);
    const stashed = false;
    void stashed;
    if (dirty.length && !f.autostash && !R.cfgBool(ctx.cfg('rebase.autostash'), false)) {
      const st = U.computeStatus(repo, {});
      if (st.unstaged.length || st.unmerged.length) throw new GitError('error: cannot rebase: You have unstaged changes.\nerror: Please commit or stash them.', 1);
      if (st.staged.length) throw new GitError('error: cannot rebase: Your index contains uncommitted changes.\nerror: Please commit or stash them.', 1);
    }
    if (f.root) onto = p.o.onto ? onto : null;
    // 재생할 커밋
    const excludeTip = f.root ? (onto ? [onto] : []) : [upstream];
    let commits = repo.revWalk([origHead], excludeTip, { order: 'topo', reverse: true });
    if (f.root && p.o.onto) commits = repo.revWalk([origHead], [], { order: 'topo', reverse: true });
    commits = commits.filter((h) => repo.parents(h).length <= 1 || f.rebaseMerges);
    // upstream 에 이미 같은 패치가 있으면 건너뜀
    if (!f.reapply && upstream) {
      const upOnly = repo.revWalk([upstream], [origHead], { order: 'date' });
      const ids = new Set(upOnly.map((h) => patchIdOf(repo, h)));
      commits = commits.filter((h) => !ids.has(patchIdOf(repo, h)));
    }
    const interactive = !!f.interactive || (p.o.exec && p.o.exec.length > 0 && false);
    // 이미 최신인지 확인
    if (!f.root && !interactive && !f.noff) {
      if (repo.isAncestor(onto, origHead) && !p.o.onto) {
        // 모든 커밋이 onto 위에 선형으로 있음
        const lin = repo.revWalk([origHead], [onto], { order: 'topo', reverse: true });
        const baseOfFirst = lin.length ? repo.parents(lin[0])[0] : onto;
        if (baseOfFirst === onto || !lin.length) {
          if (!f.quiet) ctx.print(`Current branch ${cur || 'HEAD'} is up to date.\n`);
          return;
        }
      }
      if (repo.isAncestor(origHead, onto)) {
        // 빨리감기
        const r = C.switchTree(ctx, repo, repo.commitFlat(onto), {});
        if (r.conflicts.length || r.untrackedOverwrite.length) throw fail(C.switchErrorMessage(r, 'checkout'), 1);
        repo.special.ORIG_HEAD = origHead;
        repo.setHead({ hash: onto }, `rebase (start): checkout ${ontoSpec}`, ident);
        if (headName) {
          repo.refs.set(headName, onto);
          repo.logRef(headName, origHead, onto, `rebase (finish): ${headName} onto ${onto}`, ident);
          repo.head = { ref: headName };
          repo.logRef('HEAD', onto, onto, `rebase (finish): returning to ${headName}`, ident);
        }
        if (!f.quiet) ctx.eprint(`\r\x1b[KSuccessfully rebased and updated ${headName || 'detached HEAD'}.\n`);
        return;
      }
    }
    if (!commits.length && !interactive) {
      // 재생할 커밋이 없다 → onto 로 이동
      commits = [];
    }
    let todo = buildTodo(repo, commits);
    if (f.autosquash || (interactive && R.cfgBool(ctx.cfg('rebase.autosquash'), false) && !f.noAutosquash)) todo = autosquash(repo, todo);
    if (p.o.exec) {
      const withExec = [];
      todo.forEach((e) => { withExec.push(e); p.o.exec.forEach((cmdText) => withExec.push({ cmd: 'exec', text: cmdText, hash: e.hash, subject: cmdText })); });
      todo = withExec;
    }
    if (interactive) {
      const lines = todo.map((e) => (e.cmd === 'exec' ? `exec ${e.text}` : `${e.cmd} ${repo.shortHash(e.hash, 7)} ${e.subject}`));
      const rangeLine = `# Rebase ${repo.shortHash(upstream || onto, 7)}..${repo.shortHash(origHead, 7)} onto ${repo.shortHash(onto, 7)} (${plural(todo.length, 'command')})\n`;
      const text = (lines.length ? lines.join('\n') + '\n' : '') + '\n' + rangeLine + TODO_HELP;
      const edited = ctx.input('editor', { kind: 'git-rebase-todo', initial: text });
      todo = parseTodo(repo, edited);
      if (!todo.length) { ctx.eprint('Nothing to do\n'); throw fail('', 1); }
    }
    if (!onto) throw die('--root 는 --onto 와 함께 사용하세요 (시뮬레이터 제한)');
    return startRebase(ctx, repo, { onto, ontoSpec, upstream, headName, origHead, todo, interactive, quiet: f.quiet });
  };

  function autosquash(repo, todo) {
    const out = todo.slice();
    const subjects = out.map((e) => e.subject);
    const result = [];
    const moved = new Set();
    out.forEach((e, i) => {
      if (moved.has(i)) return;
      result.push(e);
      for (let j = i + 1; j < out.length; j++) {
        const m = out[j].subject.match(/^(fixup|squash)! (.*)$/);
        if (!m || moved.has(j)) continue;
        if (subjects[i] === m[2] || subjects[i].startsWith(m[2])) { result.push(Object.assign({}, out[j], { cmd: m[1] })); moved.add(j); }
      }
    });
    return result;
  }

  function parseTodo(repo, text) {
    const todo = [];
    text.split('\n').forEach((raw) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return;
      const m = line.match(/^(\S+)\s*(.*)$/);
      const cmd = CMD_ALIASES[m[1]];
      if (!cmd) throw fail(`error: invalid command '${m[1]}'\nerror: invalid line ${todo.length + 1}: ${line}`, 1);
      if (cmd === 'exec') { todo.push({ cmd, text: m[2], hash: null, subject: m[2] }); return; }
      if (cmd === 'break') { todo.push({ cmd, hash: null, subject: '' }); return; }
      const h = repo.resolveCommit(m[2].split(/\s+/)[0]);
      if (!h) throw fail(`error: could not parse '${m[2].split(/\s+/)[0]}'`, 1);
      todo.push({ cmd, hash: h, subject: U.subjectOf(repo.commitObj(h).message) });
    });
    return todo;
  }

  /* ====================================================================
   *  stash
   * ==================================================================== */
  function stashEntries(repo) {
    return repo.readReflog('refs/stash').slice().reverse();
  }
  function stashLabel(repo, n) { return `refs/stash@{${n}}`; }
  function branchLabelForStash(repo) { return repo.head.ref ? repo.currentBranch() : '(no branch)'; }

  function resolveStashSpec(repo, spec) {
    const entries = stashEntries(repo);
    let n = 0;
    const hasSpec = spec !== undefined && spec !== null && spec !== '';
    if (hasSpec && /^[0-9a-f]{7,40}$/.test(spec)) {
      const full = repo.expandHash(spec);
      const c = full && full !== 'ambiguous' ? repo.commitObj(full) : null;
      if (c && c.parents.length >= 2) return { n: -1, hash: full, label: spec };
    }
    if (hasSpec) {
      const m = spec.match(/^(?:stash@\{)?(\d+)\}?$/) || spec.match(/^refs\/stash@\{(\d+)\}$/);
      if (!m) return { err: `error: ${spec} is not a valid reference`, bad: true };
      n = parseInt(m[1], 10);
      if (n >= entries.length) return { err: `error: ${spec} is not a valid reference`, bad: true };
    }
    if (!entries.length) return { err: 'No stash entries found.' };
    return { n, hash: entries[n].new, label: hasSpec ? spec : stashLabel(repo, n) };
  }

  function stashDrop(ctx, repo, n) {
    const log = repo.readReflog('refs/stash');
    const idx = log.length - 1 - n;
    const dropped = log[idx].new;
    log.splice(idx, 1);
    if (log.length) repo.refs.set('refs/stash', log[log.length - 1].new);
    else { repo.refs.delete('refs/stash'); repo.reflogs.delete('refs/stash'); }
    return dropped;
  }

  function stashPush(ctx, repo, o) {
    const headC = repo.headCommit();
    if (!headC) throw die('You do not have the initial commit yet');
    const ident = R.identOf(ctx);
    const matcher = o.paths && o.paths.length ? pathspecMatcher(o.paths) : () => true;
    const headFlat = repo.headFlat();
    // 변경 확인
    const trackedChanged = [];
    const allTracked = new Set(Array.from(repo.index.keys()).concat(Array.from(headFlat.keys())));
    allTracked.forEach((pth) => {
      if (!matcher(pth)) return;
      const h = headFlat.get(pth), i = repo.index.get(pth), w = repo.work.get(pth);
      const idxChanged = !eqEntry(h, i);
      const workChanged = i ? (w === undefined || sha1.hashObject('blob', w) !== i.hash) : false;
      if (idxChanged || workChanged) trackedChanged.push(pth);
    });
    const rules = repo.ignoreRules();
    const untracked = o.includeUntracked || o.all ? Array.from(repo.work.keys()).filter((pth) => !repo.index.has(pth) && !headFlat.has(pth) && matcher(pth) && (o.all || !repo.isIgnored(pth, rules))).sort() : [];
    if (!trackedChanged.length && !untracked.length) { ctx.print('No local changes to save\n'); return false; }
    if (repo.unmerged.size) throw new GitError('error: could not write index', 1);
    const label = branchLabelForStash(repo);
    const headLine = `${label}: ${repo.shortHash(headC, 7)} ${U.subjectOf(repo.commitObj(headC).message)}`;
    const committer = ident;
    const mk = (tree, parents, message) => repo.putCommit({ tree, parents, author: committer, committer, message });
    // 인덱스 커밋
    const idxFlat = new Map();
    // 경로 제한 시: 해당 경로만 인덱스 상태, 나머지는 HEAD
    const idxSource = repo.indexFlat();
    const base = new Map(headFlat);
    if (o.paths && o.paths.length) { idxSource.forEach((e, pth) => { if (matcher(pth)) base.set(pth, e); }); Array.from(base.keys()).forEach((pth) => { if (matcher(pth) && !idxSource.has(pth)) base.delete(pth); }); base.forEach((e, pth) => idxFlat.set(pth, e)); } else idxSource.forEach((e, pth) => idxFlat.set(pth, e));
    const iTree = repo.flatToTree(idxFlat);
    const iCommit = mk(iTree, [headC], `index on ${headLine}\n`);
    // 워킹 커밋: 추적 중인 파일의 작업트리 상태
    const wFlat = new Map(o.paths && o.paths.length ? headFlat : new Map());
    if (!(o.paths && o.paths.length)) {
      idxSource.forEach((e, pth) => {
        const w = repo.work.get(pth);
        if (w === undefined) return; // 삭제됨
        wFlat.set(pth, { hash: repo.putBlob(w), mode: e.mode });
      });
    } else {
      idxSource.forEach((e, pth) => {
        if (!matcher(pth)) return;
        const w = repo.work.get(pth);
        if (w === undefined) wFlat.delete(pth); else wFlat.set(pth, { hash: repo.putBlob(w), mode: e.mode });
      });
    }
    const wTree = repo.flatToTree(wFlat);
    const parents = [headC, iCommit];
    if (untracked.length) {
      const uFlat = new Map();
      untracked.forEach((pth) => uFlat.set(pth, { hash: repo.putBlob(repo.work.get(pth)), mode: '100644' }));
      const uCommit = mk(repo.flatToTree(uFlat), [], `untracked files on ${headLine}\n`);
      parents.push(uCommit);
    }
    const msg = o.message ? `On ${label}: ${o.message}\n` : `WIP on ${headLine}\n`;
    const wCommit = mk(wTree, parents, msg.replace(/\n$/, ''));
    const old = repo.readRef('refs/stash');
    repo.refs.set('refs/stash', wCommit);
    repo.logRef('refs/stash', old || ZERO, wCommit, msg.replace(/\n$/, ''), ident);
    // 작업트리 되돌리기
    if (o.keepIndex) {
      // 인덱스 상태로 작업트리를 맞춘다
      repo.index.forEach((e, pth) => { if (matcher(pth)) repo.work.set(pth, repo.blobContent(e.hash)); });
    } else if (o.paths && o.paths.length) {
      trackedChanged.forEach((pth) => {
        const h = headFlat.get(pth);
        if (h) { repo.index.set(pth, { hash: h.hash, mode: h.mode }); repo.work.set(pth, repo.blobContent(h.hash)); } else { repo.index.delete(pth); repo.work.delete(pth); C.removeEmptyParents(repo, pth); }
      });
    } else C.hardResetTo(repo, headFlat);
    untracked.forEach((pth) => { repo.work.delete(pth); C.removeEmptyParents(repo, pth); });
    if (!o.quiet) ctx.print(`Saved working directory and index state ${msg.replace(/\n$/, '')}\n`);
    return true;
  }

  function stashApply(ctx, repo, hash, o) {
    const w = repo.commitObj(hash);
    const baseC = w.parents[0];
    const iCommit = w.parents[1];
    const uCommit = w.parents[2];
    const baseFlat = repo.commitFlat(baseC);
    const headFlat = repo.headFlat();
    const theirs = repo.commitFlat(hash);
    const res = mergeTrees(ctx, repo, baseFlat, headFlat, theirs, { ours: 'Updated upstream', theirs: 'Stashed changes' });
    const ov = checkOverwrite(repo, res, headFlat);
    if (ov.conflicts.length || ov.untrackedOverwrite.length) {
      ctx.eprint(overwriteError(ov) + '\n');
      return { ok: false, overwrite: true };
    }
    // 스태시된 untracked 파일 충돌 점검
    if (uCommit) {
      const uf = repo.commitFlat(uCommit);
      for (const [pth] of uf) {
        if (repo.work.has(pth)) { ctx.eprint(`${pth} already exists, no checkout\nerror: could not restore untracked files from stash\n`); return { ok: false, overwrite: true }; }
      }
    }
    // 인덱스는 HEAD 상태를 유지한 채 작업트리에 반영
    const savedIndex = new Map(repo.index);
    applyResult(repo, res, headFlat);
    // applyResult 는 인덱스도 바꿨으므로 인덱스를 되돌리고 새로 추가된 파일만 스테이징한다
    const conflicted = new Set(res.conflicts.keys());
    if (!o.index) {
      const unmergedSave = new Map(repo.unmerged);
      repo.index = savedIndex;
      repo.unmerged = unmergedSave;
      res.conflicts.forEach((_, pth) => repo.index.delete(pth));
      res.result.forEach((e, pth) => {
        if (conflicted.has(pth)) return;
        if (!headFlat.has(pth) && !eqEntry(headFlat.get(pth), e)) repo.index.set(pth, { hash: e.hash, mode: e.mode });
      });
    } else if (iCommit) {
      const iFlat = repo.commitFlat(iCommit);
      const unmergedSave = new Map(repo.unmerged);
      repo.index = savedIndex;
      repo.unmerged = unmergedSave;
      iFlat.forEach((e, pth) => { if (!eqEntry(baseFlat.get(pth), e) && !conflicted.has(pth)) repo.index.set(pth, { hash: e.hash, mode: e.mode }); });
      baseFlat.forEach((e, pth) => { if (!iFlat.has(pth) && !conflicted.has(pth)) repo.index.delete(pth); });
    }
    if (uCommit) repo.commitFlat(uCommit).forEach((e, pth) => { repo.work.set(pth, repo.blobContent(e.hash)); });
    if (res.messages.length) ctx.print(res.messages.join('\n') + '\n');
    return { ok: !res.conflicts.size, conflict: res.conflicts.size > 0, noop: !res.conflicts.size && eqEntrySet(res.result, headFlat) && !res.messages.length };
  }
  function eqEntrySet(a, b) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (!eqEntry(v, b.get(k))) return false;
    return true;
  }

  COMMANDS.stash = function (ctx, args) {
    const repo = C.requireWorktree(ctx);
    let sub = args[0];
    let rest = args.slice(1);
    const known = ['push', 'save', 'list', 'show', 'pop', 'apply', 'drop', 'clear', 'branch', 'create', 'store'];
    if (!sub || sub.startsWith('-')) { sub = 'push'; rest = args.slice(); } else if (!known.includes(sub)) {
      throw fail(`error: unknown subcommand: ${sub}\nusage: git stash list [<log-options>]\n   or: git stash show [-u | --include-untracked | --only-untracked] [<diff-options>] [<stash>]\n   or: git stash drop [-q | --quiet] [<stash>]\n   or: git stash pop [--index] [-q | --quiet] [<stash>]\n   or: git stash apply [--index] [-q | --quiet] [<stash>]\n   or: git stash branch <branchname> [<stash>]\n   or: git stash [push [-p | --patch] [-S | --staged] [-k | --[no-]keep-index] [-q | --quiet]\n          [-u | --include-untracked] [-a | --all] [(-m | --message) <message>]\n          [--pathspec-from-file=<file> [--pathspec-file-nul]]\n          [--] [<pathspec>...]]\n   or: git stash save [-p | --patch] [-S | --staged] [-k | --[no-]keep-index] [-q | --quiet]\n          [-u | --include-untracked] [-a | --all] [<message>]`, 129);
    }
    if (sub === 'push' || sub === 'save') {
      const p = parseArgs(rest, { flags: { '-u': 'u', '--include-untracked': 'u', '-a': 'all', '--all': 'all', '-k': 'keep', '--keep-index': 'keep', '--no-keep-index': 'noKeep', '-q': 'quiet', '--quiet': 'quiet', '-p': 'patch', '--patch': 'patch', '-S': 'staged', '--staged': 'staged' }, opts: { '-m': 'message', '--message': 'message' } }, 'stash');
      if (p.f.patch) throw fail('error: stash -p 는 이 시뮬레이터에서 지원하지 않아요.', 1);
      let message = p.o.message ? p.o.message[0] : null;
      let paths = p.dd.slice();
      if (sub === 'save') { if (p.rest.length) message = p.rest.join(' '); } else paths = paths.concat(p.rest);
      stashPush(ctx, repo, { includeUntracked: p.f.u, all: p.f.all, keepIndex: p.f.keep, message, paths, quiet: p.f.quiet });
      return;
    }
    if (sub === 'list') {
      const entries = stashEntries(repo);
      ctx.print(entries.map((e, i) => `stash@{${i}}: ${e.msg}\n`).join(''));
      return;
    }
    if (sub === 'clear') { repo.refs.delete('refs/stash'); repo.reflogs.delete('refs/stash'); return; }
    const p = parseArgs(rest, { flags: { '--index': 'index', '-q': 'quiet', '--quiet': 'quiet', '-p': 'patch', '--patch': 'patch', '--stat': 'stat', '--name-only': 'nameOnly', '--name-status': 'nameStatus', '-u': 'u', '--include-untracked': 'u', '--only-untracked': 'onlyU', '--numstat': 'numstat', '--shortstat': 'shortstat', '--no-color': 'noColor' } }, 'stash');
    if (sub === 'branch') {
      const name = p.rest[0];
      if (!name) throw fail('error: No branch name specified', 1);
      const r = resolveStashSpec(repo, p.rest[1]);
      if (r.err) throw fail(r.err, 1);
      const w = repo.commitObj(r.hash);
      R.doSwitch(ctx, repo, { target: { ref: 'refs/heads/' + name }, targetCommit: w.parents[0], label: name, create: true, quiet: false, createMsg: 'branch: Created from ' + repo.shortHash(w.parents[0], 7) });
      const ar = stashApply(ctx, repo, r.hash, { index: p.f.index });
      ctx.print(U.statusLong(ctx, {}).text);
      if (ar.ok) { const dropped = stashDrop(ctx, repo, r.n); ctx.print(`Dropped ${r.label} (${dropped})\n`); } else { ctx.print('The stash entry is kept in case you need it again.\n'); throw fail('', 1); }
      return;
    }
    const r = resolveStashSpec(repo, p.rest[0]);
    if (r.err) throw fail(r.err, 1);
    if (sub === 'show') {
      const w = repo.commitObj(r.hash);
      const aFlat = repo.commitFlat(w.parents[0]);
      const bFlat = repo.commitFlat(r.hash);
      const changes = U.diffMaps(repo, aFlat, bFlat);
      let out = '';
      if (p.f.nameOnly) out = changes.map((c) => c.path).join('\n') + (changes.length ? '\n' : '');
      else if (p.f.nameStatus) out = changes.map((c) => `${c.status}\t${c.path}`).join('\n') + (changes.length ? '\n' : '');
      else if (p.f.patch) out = U.colorizePatch(ctx, changes.map((c) => U.renderPatch(repo, c, {})).join(''));
      else out = changes.length ? U.diffStatText(repo, changes) + (R.cfgBool(undefined, true) ? '' : '') : '';
      ctx.print(out);
      return;
    }
    if (sub === 'drop') {
      const dropped = stashDrop(ctx, repo, r.n);
      if (!p.f.quiet) ctx.print(`Dropped ${r.label} (${dropped})\n`);
      return;
    }
    if (sub === 'apply' || sub === 'pop') {
      const ar = stashApply(ctx, repo, r.hash, { index: p.f.index });
      if (!p.f.quiet) {
        if (ar.noop) ctx.print('Already up to date.\n');
        ctx.print(U.statusLong(ctx, {}).text);
      }
      if (sub === 'pop') {
        if (ar.ok) { if (r.n >= 0) { const dropped = stashDrop(ctx, repo, r.n); if (!p.f.quiet) ctx.print(`Dropped ${r.label} (${dropped})\n`); } } else { ctx.print('The stash entry is kept in case you need it again.\n'); throw fail('', 1); }
      } else if (!ar.ok) throw fail('', 1);
      return;
    }
    if (sub === 'create') { ctx.print(r.hash + '\n'); return; }
  };

  G.merge = { mergeTrees, checkOverwrite, applyResult, newCommit, recreateConflict: null };
})();
