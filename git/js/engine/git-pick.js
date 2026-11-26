/* git 명령어 구현 (4-2): cherry-pick / revert (sequencer) */
(function () {
  'use strict';
  const G = (globalThis.GitEngine = globalThis.GitEngine || {});
  const { Diff, sha1, GitError, ZERO, EMPTY_TREE, cleanupMessage, pathspecMatcher } = G;
  const U = G.util;
  const C = G.core;
  const R = G.refs;
  const { die, fail, parseArgs, plural } = U;
  const COMMANDS = G.commands;
  const { applyResult, checkOverwrite, clearSeqState, conflictMsgTail, mergeTrees, newCommit } = G.merge;

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

  G.merge = Object.assign(G.merge || {}, { applyOne });
})();
