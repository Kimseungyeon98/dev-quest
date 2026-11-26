/* git 명령어 구현 (4-4): stash */
(function () {
  'use strict';
  const G = (globalThis.GitEngine = globalThis.GitEngine || {});
  const { Diff, sha1, GitError, ZERO, EMPTY_TREE, cleanupMessage, pathspecMatcher } = G;
  const U = G.util;
  const C = G.core;
  const R = G.refs;
  const { die, fail, parseArgs, plural } = U;
  const COMMANDS = G.commands;
  const { applyResult, checkOverwrite, eqEntry, mergeTrees, overwriteError } = G.merge;

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

})();
