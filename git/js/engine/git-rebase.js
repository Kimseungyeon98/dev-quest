/* git 명령어 구현 (4-3): rebase (대화형 rebase · autosquash 포함) */
(function () {
  'use strict';
  const G = (globalThis.GitEngine = globalThis.GitEngine || {});
  const { Diff, sha1, GitError, ZERO, EMPTY_TREE, cleanupMessage, pathspecMatcher } = G;
  const U = G.util;
  const C = G.core;
  const R = G.refs;
  const { die, fail, parseArgs, plural } = U;
  const COMMANDS = G.commands;
  const { newCommit, applyOne } = G.merge;

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

})();
