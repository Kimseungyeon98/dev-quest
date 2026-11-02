/* git 명령어 구현 (5): remote / clone / fetch / pull / push / ls-remote */
(function () {
  'use strict';
  const G = (globalThis.GitEngine = globalThis.GitEngine || {});
  const { GitError, ZERO } = G;
  const U = G.util;
  const C = G.core;
  const R = G.refs;
  const { die, fail, parseArgs, plural } = U;
  const COMMANDS = G.commands;

  /* ---------------- 원격 접근 ---------------- */
  function fromLabel(url) {
    let u = url.replace(/\/+$/, '').replace(/\.git$/, '');
    u = u.replace(/^[a-z]+:\/\/(?:[^@/]+@)?/, (m) => (/^https?:\/\//.test(m) ? m.replace(/\/\/[^@/]+@/, '//') : ''));
    u = u.replace(/^[^@/]+@([^:/]+):/, '$1:');
    return u;
  }
  function remoteUrl(repo, name) { return repo.config.get(`remote.${name}.url`); }
  function remoteNames(repo) {
    const set = new Set();
    repo.config.forEach((_, k) => { const m = k.match(/^remote\.([^.]+)\.url$/); if (m) set.add(m[1]); });
    return Array.from(set).sort();
  }
  function openRemote(ctx, url) {
    const r = ctx.sim.net.get(url);
    if (!r) {
      let hint = `fatal: '${url}' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.`;
      if (/^(git@|ssh:\/\/)/.test(url)) {
        const host = (url.match(/@([^:/]+)/) || [])[1] || 'host';
        hint = `ssh: Could not resolve hostname ${host}: Name or service not known\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.`;
      } else if (/^https?:\/\//.test(url)) hint = `fatal: repository '${url}' not found`;
      throw new GitError(hint, 128);
    }
    return r;
  }
  function copyObjects(from, to) {
    from.objects.forEach((o, h) => { if (!to.objects.has(h)) to.objects.set(h, o); });
  }

  /* 원격 브랜치 이름 → 로컬 원격추적 ref */
  function trackingRef(remote, branch) { return `refs/remotes/${remote}/${branch}`; }

  /* ---------------- fetch ---------------- */
  const SUMMARY_W = 17;
  function fmtRefLine(flag, summary, name, dest, w, suffix) {
    return ` ${flag} ${summary.padEnd(SUMMARY_W)} ${name.padEnd(w)} -> ${dest}${suffix || ''}\n`;
  }

  /* 반환: { lines: [{...}], changed } */
  function fetchFrom(ctx, repo, remoteName, opts) {
    opts = opts || {};
    const url = remoteUrl(repo, remoteName);
    const rr = openRemote(ctx, url);
    copyObjects(rr, repo);
    const ident = R.identOf(ctx);
    const rows = [];
    // 대상 브랜치 선택
    let want = rr.branches();
    const explicit = opts.refspecs && opts.refspecs.length ? opts.refspecs : null;
    const dests = new Map(); // remoteBranch → localRef
    if (explicit) {
      want = [];
      explicit.forEach((rs) => {
        const force = rs.startsWith('+');
        const spec = rs.replace(/^\+/, '');
        const [src, dst] = spec.split(':');
        const h = rr.readRef('refs/heads/' + src) || rr.readRef('refs/tags/' + src) || rr.readRef(src);
        if (!h) throw die(`couldn't find remote ref ${src}`);
        want.push([src, h]);
        dests.set(src, { ref: dst ? (dst.startsWith('refs/') ? dst : 'refs/heads/' + dst) : null, force });
      });
    }
    const fetchHeadParts = [];
    const nameW = Math.max(10, ...want.map(([n]) => n.length));
    want.forEach(([bn, h]) => {
      const dest = dests.has(bn) ? dests.get(bn).ref : trackingRef(remoteName, bn);
      fetchHeadParts.push({ bn, h });
      if (!dest) return;
      const old = repo.readRef(dest);
      const destLabel = dest.replace(/^refs\/(remotes|heads|tags)\//, '');
      if (!old) {
        repo.updateRef(dest, h, `fetch ${remoteName}: storing head`, ident);
        rows.push({ flag: '*', summary: '[new branch]', name: bn, dest: destLabel });
      } else if (old !== h) {
        const ff = repo.isAncestor(old, h);
        if (ff) {
          repo.updateRef(dest, h, `fetch ${remoteName}: fast-forward`, ident);
          rows.push({ flag: ' ', summary: `${repo.shortHash(old, 7)}..${repo.shortHash(h, 7)}`, name: bn, dest: destLabel });
        } else {
          repo.updateRef(dest, h, `fetch ${remoteName}: forced-update`, ident);
          rows.push({ flag: '+', summary: `${repo.shortHash(old, 7)}...${repo.shortHash(h, 7)}`, name: bn, dest: destLabel, suffix: '  (forced update)' });
        }
      }
    });
    // 태그
    if (!explicit || opts.tags) {
      rr.listRefs('refs/tags/').forEach(([n, h]) => {
        const tn = n.slice(10);
        if (repo.refs.has(n)) return;
        if (!opts.tags) {
          // 가져온 커밋에서 도달 가능한 태그만 자동 추적
          const c = rr.peelToCommit(h);
          const reachable = rr.branches().some(([, bh]) => rr.isAncestor(c, bh));
          if (!reachable) return;
        }
        repo.refs.set(n, h);
        rows.push({ flag: '*', summary: '[new tag]', name: tn, dest: tn });
      });
    }
    // prune
    if (opts.prune && !explicit) {
      repo.listRefs(`refs/remotes/${remoteName}/`).forEach(([n]) => {
        const bn = n.slice(`refs/remotes/${remoteName}/`.length);
        if (!rr.refs.has('refs/heads/' + bn)) {
          repo.deleteRef(n); repo.reflogs.delete(n);
          rows.push({ flag: '-', summary: '[deleted]', name: '(none)', dest: remoteName + '/' + bn });
        }
      });
    }
    // origin/HEAD 심볼릭 (없으면 만든다)
    if (!repo.symrefs.has(`refs/remotes/${remoteName}/HEAD`)) { /* clone 때만 설정 */ }
    // FETCH_HEAD
    const cur = repo.currentBranch();
    const mergeRef = cur && repo.config.get(`branch.${cur}.remote`) === remoteName ? repo.config.get(`branch.${cur}.merge`) : null;
    let fh = null;
    if (explicit) fh = fetchHeadParts[0] && fetchHeadParts[0].h;
    else if (mergeRef) { const hit = fetchHeadParts.find((x) => 'refs/heads/' + x.bn === mergeRef); fh = hit ? hit.h : null; }
    repo.special.FETCH_HEAD = fh || (fetchHeadParts[0] && fetchHeadParts[0].h);
    let text = '';
    if (rows.length && !opts.quiet) {
      const w = Math.max(10, ...rows.map((r) => r.name.length));
      text = `From ${fromLabel(url)}\n` + rows.map((r) => fmtRefLine(r.flag, r.summary, r.name, r.dest, w, r.suffix)).join('');
    }
    if (text) ctx.eprint(text);
    return { rows, mergeHash: fh, mergeBranch: mergeRef ? mergeRef.replace(/^refs\/heads\//, '') : (explicit ? want[0][0] : null), url, fetchHeadParts };
  }

  COMMANDS.fetch = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '--all': 'all', '-p': 'prune', '--prune': 'prune', '-t': 'tags', '--tags': 'tags', '-q': 'quiet', '--quiet': 'quiet', '-v': 'verbose', '--no-tags': 'noTags', '--force': 'force', '-f': 'force', '--unshallow': 'unshallow', '--dry-run': 'dry' } }, 'fetch');
    const names = remoteNames(repo);
    let targets;
    if (p.f.all) targets = names;
    else if (p.rest[0] && names.includes(p.rest[0])) targets = [p.rest[0]];
    else if (p.rest[0] && !names.includes(p.rest[0])) {
      // URL 이거나 없는 이름
      if (ctx.sim.net.has(p.rest[0])) throw fail('error: URL 로 직접 fetch 하는 것은 이 시뮬레이터에서 지원하지 않아요. 먼저 git remote add 를 쓰세요.', 1);
      throw die(`'${p.rest[0]}' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.`);
    } else {
      const cur = repo.currentBranch();
      const up = cur && repo.config.get(`branch.${cur}.remote`);
      targets = [up && up !== '.' ? up : (names.includes('origin') ? 'origin' : names[0])];
      if (!targets[0]) throw die('No remote repository specified.  Please, specify either a URL or a\nremote name from which new revisions should be fetched.');
    }
    targets.forEach((t) => {
      fetchFrom(ctx, repo, t, { prune: p.f.prune || R.cfgBool(ctx.cfg('fetch.prune'), false), tags: p.f.tags, quiet: p.f.quiet, refspecs: p.f.all ? null : p.rest.slice(1) });
    });
  };

  /* ---------------- pull ---------------- */
  const DIVERGENT_HINT = `hint: You have divergent branches and need to specify how to reconcile them.
hint: You can do so by running one of the following commands sometime before
hint: your next pull:
hint:
hint:   git config pull.rebase false  # merge
hint:   git config pull.rebase true   # rebase
hint:   git config pull.ff only       # fast-forward only
hint:
hint: You can replace "git config" with "git config --global" to set a default
hint: preference for all repositories. You can also pass --rebase, --no-rebase,
hint: or --ff-only on the command line to override the configured default per
hint: invocation.
fatal: Need to specify how to reconcile divergent branches.`;

  COMMANDS.pull = function (ctx, args) {
    const repo = C.requireWorktree(ctx);
    const p = parseArgs(args, { flags: { '--rebase': 'rebase', '-r': 'rebase', '--no-rebase': 'noRebase', '--ff-only': 'ffonly', '--ff': 'ff', '--no-ff': 'noff', '-q': 'quiet', '--quiet': 'quiet', '--autostash': 'autostash', '--no-edit': 'noedit', '--prune': 'prune', '-p': 'prune', '--tags': 'tags', '--squash': 'squash', '--no-commit': 'nocommit', '-v': 'verbose', '--stat': 'stat', '--no-stat': 'nostat', '-n': 'nostat' } }, 'pull');
    const f = p.f;
    const cur = repo.currentBranch();
    const names = remoteNames(repo);
    let remote = p.rest[0];
    let branch = p.rest[1];
    if (!remote) {
      remote = cur && repo.config.get(`branch.${cur}.remote`);
      if (!cur) throw new GitError('You are not currently on a branch.\nPlease specify which branch you want to merge with.\nSee git-pull(1) for details.\n\n    git pull <remote> <branch>\n', 1);
      if (!remote) {
        const rn = names.includes('origin') ? 'origin' : names[0];
        if (rn) fetchFrom(ctx, repo, rn, { quiet: f.quiet });
        const rb = f.rebase || ctx.cfg('pull.rebase') === 'true';
        throw new GitError(`There is no tracking information for the current branch.\nPlease specify which branch you want to ${rb ? 'rebase against' : 'merge with'}.\nSee git-pull(1) for details.\n\n    git pull <remote> <branch>\n\nIf you wish to set tracking information for this branch you can do so with:\n\n    git branch --set-upstream-to=${rn || 'origin'}/<branch> ${cur}\n\n`, 1);
      }
    }
    if (!names.includes(remote)) throw die(`'${remote}' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.`);
    const upstreamMerge = cur && repo.config.get(`branch.${cur}.remote`) === remote ? repo.config.get(`branch.${cur}.merge`) : null;
    if (!branch && !upstreamMerge) {
      throw new GitError(`You asked to pull from the remote '${remote}', but did not specify\na branch. Because this is not the default configured remote\nfor your current branch, you must specify a branch on the command line.`, 1);
    }
    const res = fetchFrom(ctx, repo, remote, { prune: f.prune, tags: f.tags, quiet: f.quiet, refspecs: branch ? [branch] : null });
    let target = res.mergeHash;
    if (!target) {
      const b = branch || upstreamMerge.replace(/^refs\/heads\//, '');
      throw new GitError(`Your configuration specifies to merge with the ref 'refs/heads/${b}'\nfrom the remote, but no such ref was fetched.`, 1);
    }
    const head = repo.headCommit();
    const mode = f.rebase ? 'rebase' : f.noRebase ? 'merge' : (ctx.cfg('pull.rebase') === 'true' ? 'rebase' : (ctx.cfg('pull.rebase') === 'false' ? 'merge' : null));
    const ffOnly = f.ffonly || ctx.cfg('pull.ff') === 'only';
    if (!head) {
      C.hardResetTo(repo, repo.commitFlat(target));
      repo.updateRef(repo.head.ref, target, 'pull: initial', R.identOf(ctx));
      return;
    }
    if (repo.isAncestor(target, head)) { if (!f.quiet) ctx.print('Already up to date.\n'); return; }
    const canFF = repo.isAncestor(head, target);
    const label = branch || upstreamMerge.replace(/^refs\/heads\//, '');
    if (!canFF && !mode && !ffOnly && !f.noRebase) throw new GitError(DIVERGENT_HINT, 128);
    if (!canFF && ffOnly) throw die('Not possible to fast-forward, aborting.');
    if (canFF && mode !== 'rebase' || (canFF && mode === 'rebase')) {
      // 빨리감기는 merge/rebase 모두 동일하게 처리
      const flat = repo.commitFlat(target);
      const r = C.switchTree(ctx, repo, flat, {});
      if (r.conflicts.length || r.untrackedOverwrite.length) {
        const msg = C.switchErrorMessage(r, 'merge');
        throw fail(msg, 1);
      }
      repo.special.ORIG_HEAD = head;
      const ident = R.identOf(ctx);
      if (repo.head.ref) repo.updateRef(repo.head.ref, target, 'pull: Fast-forward', ident); else repo.moveDetachedHead(target, 'pull: Fast-forward', ident);
      if (!f.quiet) {
        const changes = U.diffMaps(repo, repo.commitFlat(head), flat);
        ctx.print(`Updating ${repo.shortHash(head, 7)}..${repo.shortHash(target, 7)}\nFast-forward\n`);
        if (changes.length) ctx.print(U.diffStatText(repo, changes) + U.summaryLines(repo, changes));
      }
      return;
    }
    if (mode === 'rebase') {
      const st = U.computeStatus(repo, {});
      if (st.unstaged.length && !f.autostash) throw new GitError('error: cannot pull with rebase: You have unstaged changes.\nerror: Please commit or stash them.', 1);
      if (st.staged.length && !f.autostash) throw new GitError('error: cannot pull with rebase: Your index contains uncommitted changes.\nerror: Please commit or stash them.', 1);
      return COMMANDS.rebase(ctx, [target].concat(f.quiet ? ['-q'] : []));
    }
    // merge
    const nameOfCur = cur;
    let msg = `Merge branch '${label}' of ${fromLabel(res.url)}`;
    if (nameOfCur && nameOfCur !== 'master' && nameOfCur !== 'main') msg += ` into ${nameOfCur}`;
    ctx.pullMode = true;
    try {
      return COMMANDS.merge(ctx, [target, '-m', msg].concat(f.noff ? ['--no-ff'] : []).concat(f.quiet ? ['-q'] : []));
    } finally { ctx.pullMode = false; }
  };

  /* ---------------- push ---------------- */
  const PUSH_HINT_FETCH_FIRST = `hint: Updates were rejected because the remote contains work that you do not
hint: have locally. This is usually caused by another repository pushing to
hint: the same ref. If you want to integrate the remote changes, use
hint: 'git pull' before pushing again.
hint: See the 'Note about fast-forwards' in 'git push --help' for details.`;
  const PUSH_HINT_BEHIND_CURRENT = `hint: Updates were rejected because the tip of your current branch is behind
hint: its remote counterpart. If you want to integrate the remote changes,
hint: use 'git pull' before pushing again.
hint: See the 'Note about fast-forwards' in 'git push --help' for details.`;
  const PUSH_HINT_BEHIND_OTHER = `hint: Updates were rejected because a pushed branch tip is behind its remote
hint: counterpart. If you want to integrate the remote changes, use 'git pull'
hint: before pushing again.
hint: See the 'Note about fast-forwards' in 'git push --help' for details.`;

  COMMANDS.push = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, {
      flags: { '-u': 'setUp', '--set-upstream': 'setUp', '-f': 'force', '--force': 'force', '--force-with-lease': 'lease', '-d': 'delete', '--delete': 'delete', '--tags': 'tags', '--all': 'all', '--branches': 'all', '-n': 'dry', '--dry-run': 'dry', '-q': 'quiet', '--quiet': 'quiet', '--follow-tags': 'followTags', '--no-verify': 'noverify', '-v': 'verbose', '--mirror': 'mirror', '--atomic': 'atomic' },
      optional: { '--force-with-lease': 'leaseOpt' },
    }, 'push');
    const f = p.f;
    const names = remoteNames(repo);
    const cur = repo.currentBranch();
    let remote = p.rest[0];
    let specs = p.rest.slice(1);
    if (remote && !names.includes(remote)) {
      if (ctx.sim.net.has(remote)) { /* URL 직접 */ } else throw die(`'${remote}' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.`);
    }
    if (!remote) {
      remote = (cur && repo.config.get(`branch.${cur}.remote`)) || (names.includes('origin') ? 'origin' : names[0]);
      if (!remote || remote === '.') throw die('No configured push destination.\nEither specify the URL from the command-line or configure a remote repository using\n\n    git remote add <name> <url>\n\nand then push using the remote name\n\n    git push <name>\n');
    }
    const url = names.includes(remote) ? remoteUrl(repo, remote) : remote;
    const rr = openRemote(ctx, url);
    const remoteLabel = names.includes(remote) ? remote : null;
    const ident = R.identOf(ctx);

    // 푸시 대상 목록 만들기
    const jobs = []; // { src: hash|null, dstRef, label, force, delete, srcName, isCurrent }
    if (f.all) {
      repo.branches().forEach(([n, h]) => jobs.push({ src: h, dstRef: 'refs/heads/' + n, srcName: n, label: n, force: f.force, isCurrent: n === cur }));
    } else if (f.tags && !specs.length) {
      repo.listRefs('refs/tags/').forEach(([n, h]) => jobs.push({ src: h, dstRef: n, srcName: n.slice(10), label: n.slice(10), force: f.force, tag: true }));
    } else if (!specs.length) {
      if (!cur) throw new GitError(`fatal: You are not currently on a branch.\nTo push the history leading to the current (detached HEAD)\nstate now, use\n\n    git push ${remote} HEAD:<name-of-remote-branch>\n`, 128);
      const up = repo.upstreamRef(cur);
      const upRemote = repo.config.get(`branch.${cur}.remote`);
      const autoSetup = R.cfgBool(ctx.cfg('push.autosetupremote'), false);
      if (!up && !f.setUp && !autoSetup) {
        if (p.rest[0]) {
          // git push origin  (refspec 없음) → push.default=simple: 현재 브랜치를 같은 이름으로
        } else {
          throw new GitError(`fatal: The current branch ${cur} has no upstream branch.\nTo push the current branch and set the remote as upstream, use\n\n    git push --set-upstream ${remote} ${cur}\n\nTo have this happen automatically for branches without a tracking\nupstream, see 'push.autoSetupRemote' in 'git help config'.\n\n`, 128);
        }
      }
      const dstName = up && upRemote === remote ? repo.config.get(`branch.${cur}.merge`).replace(/^refs\/heads\//, '') : cur;
      if (up && upRemote === remote && dstName !== cur && !p.rest[0]) {
        throw new GitError(`fatal: The upstream branch of your current branch does not match\nthe name of your current branch.  To push to the upstream branch\non the remote, use\n\n    git push ${remote} HEAD:${dstName}\n\nTo push to the branch of the same name on the remote, use\n\n    git push ${remote} HEAD\n\nTo choose either option permanently, see push.default in 'git help config'.\n`, 128);
      }
      jobs.push({ src: repo.headCommit(), dstRef: 'refs/heads/' + dstName, srcName: cur, label: cur, force: f.force, isCurrent: true, autoUp: !up });
    } else {
      specs.forEach((sp0) => {
        let force = f.force;
        let sp = sp0;
        if (sp.startsWith('+')) { force = true; sp = sp.slice(1); }
        if (f.delete) { jobs.push({ src: null, dstRef: 'refs/heads/' + sp, srcName: sp, label: sp, delete: true, force }); return; }
        const colon = sp.indexOf(':');
        let srcSpec = colon >= 0 ? sp.slice(0, colon) : sp;
        let dst = colon >= 0 ? sp.slice(colon + 1) : null;
        if (colon >= 0 && srcSpec === '') { jobs.push({ src: null, dstRef: dst.startsWith('refs/') ? dst : 'refs/heads/' + dst, srcName: dst, label: dst, delete: true, force }); return; }
        let src = srcSpec === 'HEAD' ? repo.headCommit() : null;
        let isTag = false;
        if (srcSpec !== 'HEAD') {
          if (repo.refs.has('refs/heads/' + srcSpec)) src = repo.readRef('refs/heads/' + srcSpec);
          else if (repo.refs.has('refs/tags/' + srcSpec)) { src = repo.readRef('refs/tags/' + srcSpec); isTag = true; } else src = repo.resolve(srcSpec);
        }
        if (!src) throw new GitError(`error: src refspec ${srcSpec} does not match any\nerror: failed to push some refs to '${url}'`, 1);
        let dstRef;
        if (dst) dstRef = dst.startsWith('refs/') ? dst : (isTag && !repo.refs.has('refs/heads/' + dst) ? 'refs/tags/' + dst : 'refs/heads/' + dst);
        else dstRef = srcSpec === 'HEAD' ? 'refs/heads/' + (cur || srcSpec) : (isTag ? 'refs/tags/' + srcSpec : 'refs/heads/' + srcSpec);
        jobs.push({ src, dstRef, srcName: srcSpec, label: dst || srcSpec, force, tag: isTag || dstRef.startsWith('refs/tags/'), isCurrent: srcSpec === cur || srcSpec === 'HEAD' });
      });
    }
    if (f.followTags) {
      repo.listRefs('refs/tags/').forEach(([n, h]) => { const o = repo.get(h); if (o.type === 'tag' && !rr.refs.has(n) && jobs.some((j) => j.src && repo.isAncestor(repo.peelToCommit(h), j.src))) jobs.push({ src: h, dstRef: n, srcName: n.slice(10), label: n.slice(10), tag: true }); });
    }

    // 실행
    const rows = [];
    let rejected = false;
    let upToDateAll = true;
    const lines = [];
    const protectedSet = rr.protectedBranches || new Set();
    jobs.forEach((job) => {
      const dstName = job.dstRef.replace(/^refs\/(heads|tags)\//, '');
      const old = rr.readRef(job.dstRef);
      const isBranchRef = job.dstRef.startsWith('refs/heads/');
      if (job.delete) {
        if (!old) { lines.push(`error: unable to delete '${dstName}': remote ref does not exist\n`); rejected = true; upToDateAll = false; return; }
        if (isBranchRef && protectedSet.has(dstName)) {
          rows.push({ raw: ` ! [remote rejected] ${dstName} (protected branch hook declined)\n`, rejectedRemote: dstName });
          rejected = true; upToDateAll = false; return;
        }
        if (f.dry) { rows.push({ flag: '-', summary: '[deleted]', label: dstName }); upToDateAll = false; return; }
        rr.deleteRef(job.dstRef);
        if (isBranchRef && remoteLabel) { repo.deleteRef(trackingRef(remoteLabel, dstName)); repo.reflogs.delete(trackingRef(remoteLabel, dstName)); }
        rows.push({ flag: '-', summary: '[deleted]', label: dstName });
        upToDateAll = false;
        return;
      }
      if (old === job.src) { return; }
      upToDateAll = false;
      const srcCommit = repo.peelToCommit(job.src);
      const oldKnown = old && repo.has(old);
      let ff = true;
      if (old && !job.tag) ff = oldKnown && srcCommit && repo.isAncestor(repo.peelToCommit(old), srcCommit);
      if (job.tag && old) { rows.push({ flag: '!', summary: '[rejected]', label: `${job.srcName} -> ${dstName}`, reason: 'already exists' }); rejected = true; return; }
      let forced = false;
      if (old && !ff) {
        let allow = job.force;
        if (f.lease && !job.force) {
          const trk = remoteLabel ? repo.readRef(trackingRef(remoteLabel, dstName)) : null;
          if (trk && trk === old) allow = true;
          else { rows.push({ flag: '!', summary: '[rejected]', label: `${job.srcName} -> ${dstName}`, reason: 'stale info' }); rejected = true; return; }
        }
        if (!allow) {
          const reason = oldKnown ? 'non-fast-forward' : 'fetch first';
          rows.push({ flag: '!', summary: '[rejected]', label: `${job.srcName} -> ${dstName}`, reason, hint: reason, current: job.dstRef === repo.head.ref });
          rejected = true; return;
        }
        forced = true;
      }
      if (f.lease && !job.force && old && ff) {
        const trk = remoteLabel ? repo.readRef(trackingRef(remoteLabel, dstName)) : null;
        if (trk && trk !== old) { rows.push({ flag: '!', summary: '[rejected]', label: `${job.srcName} -> ${dstName}`, reason: 'stale info' }); rejected = true; return; }
      }
      if (isBranchRef && protectedSet.has(dstName)) {
        const why = forced ? 'non-fast-forward' : null;
        void why;
        lines.push(`remote: error: GH006: Protected branch update failed for ${job.dstRef}.\nremote: error: Changes must be made through a pull request.\n`);
        rows.push({ raw: ` ! [remote rejected] ${job.srcName} -> ${dstName} (protected branch hook declined)\n` });
        rejected = true; return;
      }
      if (f.dry) { rows.push({ flag: old ? ' ' : '*', summary: old ? `${repo.shortHash(old, 7)}..${repo.shortHash(job.src, 7)}` : (job.tag ? '[new tag]' : '[new branch]'), label: `${job.srcName} -> ${dstName}` }); return; }
      copyObjects(repo, rr);
      rr.refs.set(job.dstRef, job.src);
      if (isBranchRef) rr.logRef && rr.logRef(job.dstRef, old || ZERO, job.src, 'push', ident);
      if (isBranchRef && remoteLabel) {
        const trk = trackingRef(remoteLabel, dstName);
        repo.updateRef(trk, job.src, 'update by push', ident);
      }
      if (!old) rows.push({ flag: '*', summary: job.tag ? '[new tag]' : '[new branch]', label: `${job.srcName} -> ${dstName}` });
      else if (forced) rows.push({ flag: '+', summary: `${repo.shortHash(old, 7)}...${repo.shortHash(job.src, 7)}`, label: `${job.srcName} -> ${dstName}`, suffix: ' (forced update)' });
      else rows.push({ flag: ' ', summary: `${repo.shortHash(old, 7)}..${repo.shortHash(job.src, 7)}`, label: `${job.srcName} -> ${dstName}` });
    });

    // upstream 설정
    if (!rejected || rows.some((r) => r.flag === '*' || r.flag === ' ')) {
      if ((f.setUp || jobs.some((j) => j.autoUp && R.cfgBool(ctx.cfg('push.autosetupremote'), false))) && remoteLabel) {
        jobs.forEach((j) => {
          if (j.delete || j.tag || !j.dstRef.startsWith('refs/heads/')) return;
          const local = j.srcName === 'HEAD' ? cur : j.srcName;
          if (!local || !repo.refs.has('refs/heads/' + local)) return;
          const dn = j.dstRef.slice(11);
          if (rows.some((r) => r.label && r.label.endsWith('-> ' + dn) && r.flag === '!')) return;
          if (!rr.refs.has(j.dstRef)) return;
          repo.config.set(`branch.${local}.remote`, remoteLabel);
          repo.config.set(`branch.${local}.merge`, j.dstRef);
          if (!f.quiet) ctx.print(`branch '${local}' set up to track '${remoteLabel}/${dn}'.\n`);
        });
      }
    }

    let errText = '';
    if (lines.length) errText += lines.filter((l) => l.startsWith('remote:')).join('');
    if (rows.length) {
      errText += `To ${url}\n`;
      rows.forEach((r) => {
        if (r.raw) { errText += r.raw; return; }
        if (r.reason) errText += ` ${r.flag} ${r.summary.padEnd(SUMMARY_W)} ${r.label} (${r.reason})\n`;
        else errText += ` ${r.flag} ${r.summary.padEnd(SUMMARY_W)} ${r.label}${r.suffix || ''}\n`;
      });
    }
    lines.filter((l) => !l.startsWith('remote:')).forEach((l) => { errText += l; });
    if (rejected) {
      errText += `error: failed to push some refs to '${url}'\n`;
      const hintRow = rows.find((r) => r.hint);
      if (hintRow) errText += (hintRow.hint === 'fetch first' ? PUSH_HINT_FETCH_FIRST : (hintRow.current ? PUSH_HINT_BEHIND_CURRENT : PUSH_HINT_BEHIND_OTHER)) + '\n';
      if (rows.some((r) => r.reason === 'already exists')) errText += 'hint: Updates were rejected because the tag already exists in the remote.\n';
    } else if (upToDateAll && !rows.length) errText += 'Everything up-to-date\n';
    if (errText && !f.quiet) ctx.eprint(errText);
    if (rejected) throw fail('', 1);
  };

  /* ---------------- clone ---------------- */
  COMMANDS.clone = function (ctx, args) {
    const sim = ctx.sim;
    const p = parseArgs(args, { flags: { '-q': 'quiet', '--quiet': 'quiet', '--bare': 'bare', '--no-checkout': 'nocheckout', '--single-branch': 'single', '--mirror': 'mirror', '-v': 'verbose' }, opts: { '-b': 'branch', '--branch': 'branch', '--depth': 'depth', '-o': 'origin', '--origin': 'origin', '-c': 'config' } }, 'clone');
    const url = p.rest[0];
    if (!url) throw fail('fatal: You must specify a repository to clone.\n\nusage: git clone [<options>] [--] <repo> [<dir>]', 129);
    if (sim.cwd !== '~' && !ctx.cloneDir) throw die('시뮬레이터에서는 홈(~) 에서만 clone 할 수 있어요. cd .. 로 먼저 홈으로 나가세요.');
    const rr = openRemote(ctx, url);
    let target = p.rest[1] || url.replace(/\/+$/, '').replace(/\.git$/, '').split(/[/:]/).pop();
    if (!ctx.cloneDir && sim.home.has(target) && sim.home.get(target).files.size) throw die(`destination path '${target}' already exists and is not an empty directory.`);
    const originName = p.o.origin ? p.o.origin[0] : 'origin';
    const dir = ctx.cloneDir || sim.mkdirHome(target);
    const { Repo } = G;
    const repo = new Repo({ name: dir.name });
    repo.work = dir.files; repo.dirs = dir.dirs;
    repo.config.set('core.repositoryformatversion', '0'); repo.config.set('core.filemode', 'true'); repo.config.set('core.bare', 'false'); repo.config.set('core.logallrefupdates', 'true');
    repo.config.set(`remote.${originName}.url`, url);
    repo.config.set(`remote.${originName}.fetch`, `+refs/heads/*:refs/remotes/${originName}/*`);
    dir.repo = repo;
    copyObjects(rr, repo);
    const ident = R.identOf(ctx);
    if (!p.f.quiet) ctx.eprint(`Cloning into '${target}'...\n`);
    rr.branches().forEach(([n, h]) => repo.refs.set(trackingRef(originName, n), h));
    rr.listRefs('refs/tags/').forEach(([n, h]) => repo.refs.set(n, h));
    const remoteHead = rr.head.ref ? rr.head.ref.replace(/^refs\/heads\//, '') : null;
    const want = p.o.branch ? p.o.branch[0] : remoteHead;
    if (!rr.branches().length) {
      if (!p.f.quiet) ctx.eprint('warning: You appear to have cloned an empty repository.\n');
      repo.head = { ref: 'refs/heads/' + (remoteHead || 'main') };
      return;
    }
    if (remoteHead && rr.readRef('refs/heads/' + remoteHead)) repo.symrefs.set(`refs/remotes/${originName}/HEAD`, trackingRef(originName, remoteHead));
    if (want && rr.readRef('refs/heads/' + want)) {
      const h = rr.readRef('refs/heads/' + want);
      repo.refs.set('refs/heads/' + want, h);
      repo.head = { ref: 'refs/heads/' + want };
      repo.config.set(`branch.${want}.remote`, originName);
      repo.config.set(`branch.${want}.merge`, 'refs/heads/' + want);
      repo.logRef('refs/heads/' + want, ZERO, h, `clone: from ${url}`, ident);
      repo.logRef('HEAD', ZERO, h, `clone: from ${url}`, ident);
      if (!p.f.nocheckout) C.hardResetTo(repo, repo.commitFlat(h));
    } else if (p.o.branch) {
      throw die(`Remote branch ${want} not found in upstream ${originName}`);
    }
    if (!p.f.quiet && false) ctx.eprint('done.\n');
  };

  /* ---------------- remote ---------------- */
  COMMANDS.remote = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const sub = args[0];
    const names = remoteNames(repo);
    if (!sub || sub === '-v' || sub === '--verbose') {
      if (sub) ctx.print(names.map((n) => `${n}\t${remoteUrl(repo, n)} (fetch)\n${n}\t${remoteUrl(repo, n)} (push)\n`).join(''));
      else ctx.print(names.map((n) => n + '\n').join(''));
      return;
    }
    const rest = args.slice(1);
    if (sub === 'add') {
      const p = parseArgs(rest, { flags: { '-f': 'fetch', '--tags': 'tags' }, opts: { '-t': 'track', '-m': 'master' } }, 'remote add');
      const [name, url] = p.rest;
      if (!name || !url) throw fail('usage: git remote add [<options>] <name> <url>', 129);
      if (names.includes(name)) throw fail(`error: remote ${name} already exists.`, 3);
      repo.config.set(`remote.${name}.url`, url);
      repo.config.set(`remote.${name}.fetch`, `+refs/heads/*:refs/remotes/${name}/*`);
      if (p.f.fetch) fetchFrom(ctx, repo, name, {});
      return;
    }
    if (sub === 'remove' || sub === 'rm') {
      const name = rest[0];
      if (!names.includes(name)) throw fail(`error: No such remote: '${name}'`, 2);
      repo.listRefs(`refs/remotes/${name}/`).forEach(([n]) => { repo.deleteRef(n); repo.reflogs.delete(n); });
      repo.symrefs.forEach((_, k) => { if (k.startsWith(`refs/remotes/${name}/`)) repo.symrefs.delete(k); });
      Array.from(repo.config.keys()).forEach((k) => {
        if (k.startsWith(`remote.${name}.`)) repo.config.delete(k);
        const m = k.match(/^branch\.(.+)\.remote$/);
        if (m && repo.config.get(k) === name) { repo.config.delete(k); repo.config.delete(`branch.${m[1]}.merge`); }
      });
      return;
    }
    if (sub === 'rename') {
      const [from, to] = rest;
      if (!names.includes(from)) throw fail(`error: No such remote: '${from}'`, 2);
      if (names.includes(to)) throw fail(`error: remote ${to} already exists.`, 3);
      repo.config.set(`remote.${to}.url`, repo.config.get(`remote.${from}.url`));
      repo.config.set(`remote.${to}.fetch`, `+refs/heads/*:refs/remotes/${to}/*`);
      repo.config.delete(`remote.${from}.url`); repo.config.delete(`remote.${from}.fetch`);
      repo.listRefs(`refs/remotes/${from}/`).forEach(([n, h]) => {
        const nn = n.replace(`refs/remotes/${from}/`, `refs/remotes/${to}/`);
        repo.refs.set(nn, h); repo.deleteRef(n);
        if (repo.reflogs.has(n)) { repo.reflogs.set(nn, repo.reflogs.get(n)); repo.reflogs.delete(n); }
      });
      repo.symrefs.forEach((v, k) => { if (k.startsWith(`refs/remotes/${from}/`)) { repo.symrefs.delete(k); repo.symrefs.set(k.replace(`/${from}/`, `/${to}/`), v.replace(`/${from}/`, `/${to}/`)); } });
      Array.from(repo.config.keys()).forEach((k) => { if (/^branch\..+\.remote$/.test(k) && repo.config.get(k) === from) repo.config.set(k, to); });
      return;
    }
    if (sub === 'set-url') {
      const p = parseArgs(rest, { flags: { '--push': 'push', '--add': 'add', '--delete': 'del' } }, 'remote set-url');
      const [name, url] = p.rest;
      if (!names.includes(name)) throw fail(`error: No such remote '${name}'`, 2);
      repo.config.set(`remote.${name}.url`, url);
      return;
    }
    if (sub === 'get-url') {
      const name = rest[0];
      if (!names.includes(name)) throw fail(`error: No such remote '${name}'`, 2);
      ctx.print(remoteUrl(repo, name) + '\n');
      return;
    }
    if (sub === 'prune') {
      const name = rest.filter((a) => !a.startsWith('-'))[0];
      const dry = rest.includes('-n') || rest.includes('--dry-run');
      if (!names.includes(name)) throw fail(`error: No such remote: '${name}'`, 2);
      const rr = openRemote(ctx, remoteUrl(repo, name));
      const stale = repo.listRefs(`refs/remotes/${name}/`).filter(([n]) => !rr.refs.has('refs/heads/' + n.slice(`refs/remotes/${name}/`.length)));
      if (!stale.length) return;
      let out = `Pruning ${name}\nURL: ${remoteUrl(repo, name)}\n`;
      stale.forEach(([n]) => { out += ` * [${dry ? 'would prune' : 'pruned'}] ${n.slice(13)}\n`; if (!dry) { repo.deleteRef(n); repo.reflogs.delete(n); } });
      ctx.print(out);
      return;
    }
    if (sub === 'update') { names.forEach((n) => fetchFrom(ctx, repo, n, {})); return; }
    if (sub === 'show') {
      const name = rest.filter((a) => !a.startsWith('-'))[0];
      if (!name) { ctx.print(names.map((n) => n + '\n').join('')); return; }
      if (!names.includes(name)) throw fail(`fatal: '${name}' does not appear to be a git repository\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.`, 128);
      const url = remoteUrl(repo, name);
      const rr = openRemote(ctx, url);
      const rBranches = rr.branches().map(([n]) => n);
      const tracked = repo.listRefs(`refs/remotes/${name}/`).map(([n]) => n.slice(`refs/remotes/${name}/`.length));
      const staleOnes = tracked.filter((b) => !rBranches.includes(b));
      const entries = rBranches.map((b) => [b, tracked.includes(b) ? 'tracked' : 'new (next fetch will store in remotes/' + name + ')']).concat(staleOnes.map((b) => [`refs/remotes/${name}/${b}`, 'stale (use \'git remote prune\' to remove)'])).sort((a, b) => (a[0] < b[0] ? -1 : 1));
      const w = Math.max(...entries.map((e) => e[0].length));
      let out = `* remote ${name}\n  Fetch URL: ${url}\n  Push  URL: ${url}\n  HEAD branch: ${rr.head.ref ? rr.head.ref.replace(/^refs\/heads\//, '') : '(unknown)'}\n`;
      out += `  Remote branch${entries.length > 1 ? 'es' : ''}:\n` + entries.map((e) => `    ${e[0].padEnd(w)} ${e[1]}`).join('\n') + '\n';
      const pulls = repo.branches().filter(([b]) => repo.config.get(`branch.${b}.remote`) === name);
      if (pulls.length) {
        const bw = Math.max(...pulls.map(([b]) => b.length));
        out += `  Local branch${pulls.length > 1 ? 'es' : ''} configured for 'git pull':\n` + pulls.map(([b]) => `    ${b.padEnd(bw)} merges with remote ${repo.config.get(`branch.${b}.merge`).replace(/^refs\/heads\//, '')}`).join('\n') + '\n';
      }
      const pushes = repo.branches().filter(([b]) => rr.refs.has('refs/heads/' + b));
      if (pushes.length) {
        const bw2 = Math.max(...pushes.map(([b]) => b.length));
        out += `  Local ref${pushes.length > 1 ? 's' : ''} configured for 'git push':\n` + pushes.map(([b, h]) => {
          const rh = rr.readRef('refs/heads/' + b);
          const st = rh === h ? 'up to date' : (repo.has(rh) && repo.isAncestor(rh, h) ? 'fast-forwardable' : 'local out of date');
          return `    ${b.padEnd(bw2)} pushes to ${b.padEnd(bw2)} (${st})`;
        }).join('\n') + '\n';
      }
      ctx.print(out);
      return;
    }
    throw fail(`error: Unknown subcommand: ${sub}\nusage: git remote [-v | --verbose]\n   or: git remote add [-t <branch>] [-m <master>] [-f] [--tags | --no-tags] [--mirror=<fetch|push>] <name> <url>\n   or: git remote rename [--[no-]progress] <old> <new>\n   or: git remote remove <name>\n   or: git remote set-head <name> (-a | --auto | -d | --delete | <branch>)\n   or: git remote [-v | --verbose] show [-n] <name>\n   or: git remote prune [-n | --dry-run] <name>\n   or: git remote [-v | --verbose] update [-p | --prune] [(<group> | <remote>)...]\n   or: git remote set-branches [--add] <name> <branch>...\n   or: git remote get-url [--push] [--all] <name>\n   or: git remote set-url [--push] <name> <newurl> [<oldurl>]\n   or: git remote set-url --add <name> <newurl>\n   or: git remote set-url --delete <name> <url>`, 129);
  };

  COMMANDS['ls-remote'] = function (ctx, args) {
    const repo = ctx.repo;
    const p = parseArgs(args, { flags: { '--heads': 'heads', '--tags': 'tags', '-q': 'quiet' } }, 'ls-remote');
    let target = p.rest[0];
    if (!target) target = repo && (repo.config.get(`branch.${repo.currentBranch()}.remote`) || 'origin');
    const url = repo && repo.config.get(`remote.${target}.url`) || target;
    const rr = openRemote(ctx, url);
    let out = '';
    if (!p.f.heads && !p.f.tags && rr.headCommit()) out += `${rr.headCommit()}\tHEAD\n`;
    rr.listRefs('refs/').forEach(([n, h]) => {
      if (p.f.heads && !n.startsWith('refs/heads/')) return;
      if (p.f.tags && !n.startsWith('refs/tags/')) return;
      out += `${h}\t${n}\n`;
      const o = rr.get(h);
      if (o && o.type === 'tag') out += `${rr.peelAny(h)}\t${n}^{}\n`;
    });
    ctx.print(out);
  };

  G.remote = { fetchFrom, fromLabel, openRemote, copyObjects };
})();
