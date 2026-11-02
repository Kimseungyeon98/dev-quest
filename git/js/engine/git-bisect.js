/* git bisect */
(function () {
  'use strict';
  const G = (globalThis.GitEngine = globalThis.GitEngine || {});
  const U = G.util;
  const C = G.core;
  const R = G.refs;
  const { die, fail } = U;
  const COMMANDS = G.commands;

  function sq(s) { return "'" + s.replace(/'/g, "'\\''").replace(/!/g, "'\\!'") + "'"; }
  function estimateSteps(all) {
    if (all < 3) return 0;
    const n = Math.floor(Math.log2(all));
    const e = 1 << n;
    const x = all - e;
    return e < 3 * x ? n : n - 1;
  }

  function statusLine(b) {
    const goods = b.goods.length;
    if (!b.bad && !goods) return 'status: waiting for both good and bad commits';
    if (!b.bad) return `status: waiting for bad commit, ${goods} good commit${goods === 1 ? '' : 's'} known`;
    if (!goods) return 'status: waiting for good commit(s), bad commit known';
    return null;
  }

  function showFirstBad(ctx, repo, h, b) {
    const c = repo.commitObj(h);
    const deco = repo.headCommit() === h ? ' (HEAD)' : '';
    let out = `${h} is the first bad commit\ncommit ${h}${deco}\nAuthor: ${c.author.name} <${c.author.email}>\nDate:   ${U.formatDate(c.author.ts, c.author.tz, 'default', ctx.now)}\n\n${U.indentMessage(c.message)}\n`;
    const aFlat = c.parents[0] ? repo.commitFlat(c.parents[0]) : new Map();
    const changes = U.diffMaps(repo, aFlat, repo.commitFlat(h));
    if (changes.length) out += U.diffStatText(repo, changes) + U.summaryLines(repo, changes);
    ctx.print(out);
    b.log.push(`# first bad commit: [${h}] ${U.subjectOf(c.message)}`);
  }

  /* 다음 후보로 이동. 반환: 'found' | 'next' | 'waiting' */
  function bisectStep(ctx, repo, b) {
    const st = statusLine(b);
    if (st) { ctx.print(st + '\n'); return 'waiting'; }
    const cand = repo.revWalk([b.bad], b.goods, { order: 'date' });
    if (cand.length === 1 && cand[0] === b.bad) { showFirstBad(ctx, repo, b.bad, b); return 'found'; }
    const candSet = new Set(cand);
    const all = cand.length;
    const reaches = new Map();
    cand.slice().reverse().forEach((h) => {
      // 오래된 것부터: reaches = 1 + 후보 안의 조상 수
      const anc = new Set();
      const stack = [h];
      while (stack.length) { const x = stack.pop(); if (anc.has(x) || !candSet.has(x)) continue; anc.add(x); repo.parents(x).forEach((pp) => stack.push(pp)); }
      reaches.set(h, anc.size);
    });
    let best = null, bestDist = -1;
    cand.slice().reverse().forEach((h) => {
      if (b.skips.includes(h)) return;
      const r = reaches.get(h);
      const dist = Math.min(r, all - r);
      if (dist > bestDist) { best = h; bestDist = dist; }
    });
    if (!best) best = cand[cand.length - 1];
    const r = reaches.get(best);
    const nr = all - r - 1;
    const steps = estimateSteps(all);
    const flat = repo.commitFlat(best);
    const res = C.switchTree(ctx, repo, flat, {});
    if (res.conflicts.length || res.untrackedOverwrite.length) throw fail(C.switchErrorMessage(res, 'checkout'), 1);
    repo.setHead({ hash: best }, `checkout: moving from ${b.curLabel || 'HEAD'} to ${best}`, R.identOf(ctx));
    b.curLabel = best;
    ctx.print(`Bisecting: ${nr} revision${nr === 1 ? '' : 's'} left to test after this (roughly ${steps} step${steps === 1 ? '' : 's'})\n[${best}] ${U.subjectOf(repo.commitObj(best).message)}\n`);
    return 'next';
  }

  function mark(ctx, repo, kind, specs) {
    const b = repo.state.bisect;
    if (!b) throw fail('You need to start by "git bisect start"\n\nDo you want me to do it for you [Y/n]? ', 1);
    const rev = specs.length ? specs : ['HEAD'];
    rev.forEach((spec) => {
      const h = repo.resolveCommit(spec);
      if (!h) throw die(`Bad rev input: ${spec}`);
      const sub = U.subjectOf(repo.commitObj(h).message);
      if (kind === 'bad') {
        if (statusLine(b) && b.log[b.log.length - 1] !== undefined) { /* ok */ }
        b.log.push(`# bad: [${h}] ${sub}`);
        b.log.push(`git bisect bad ${h}`);
        b.bad = h;
      } else if (kind === 'good') {
        b.log.push(`# good: [${h}] ${sub}`);
        b.log.push(`git bisect good ${h}`);
        b.goods.push(h);
      } else if (kind === 'skip') {
        b.log.push(`# skip: [${h}] ${sub}`);
        b.log.push(`git bisect skip ${h}`);
        b.skips.push(h);
      }
      const st = statusLine(b);
      if (st) b.log.push(`# ${st}`);
    });
    return bisectStep(ctx, repo, b);
  }

  COMMANDS.bisect = function (ctx, args) {
    const repo = C.requireWorktree(ctx);
    const sub = args[0];
    const rest = args.slice(1);
    const names = { new: 'bad', old: 'good' };
    if (!sub) throw fail('usage: git bisect [help|start|bad|good|new|old|terms|skip|next|reset|visualize|view|replay|log|run]', 129);
    if (sub === 'start') {
      if (repo.state.bisect) { /* 재시작 */ }
      const specs = rest.filter((a) => !a.startsWith('-'));
      const b = { startBranch: repo.currentBranch(), startHead: repo.headCommit(), bad: null, goods: [], skips: [], log: [], curLabel: repo.currentBranch() || repo.headCommit() };
      repo.state.bisect = b;
      b.log.push('git bisect start');
      const first = specs.slice(0, 1), more = specs.slice(1);
      if (specs.length) {
        const badH = repo.resolveCommit(first[0]);
        if (!badH) throw die(`Bad rev input: ${first[0]}`);
        b.bad = badH;
        more.forEach((m) => { const h = repo.resolveCommit(m); if (!h) throw die(`Bad rev input: ${m}`); b.goods.push(h); });
        b.log = [`# bad: [${b.bad}] ${U.subjectOf(repo.commitObj(b.bad).message)}`];
        b.goods.forEach((g) => { b.log.push(`# good: [${g}] ${U.subjectOf(repo.commitObj(g).message)}`); });
        b.log.push('git bisect start ' + specs.map((s) => sq(s)).join(' '));
        if (statusLine(b)) b.log.push(`# ${statusLine(b)}`);
      } else b.log.push('# status: waiting for both good and bad commits');
      bisectStep(ctx, repo, b);
      return;
    }
    if (sub === 'bad' || sub === 'good' || sub === 'new' || sub === 'old' || sub === 'skip') {
      const kind = names[sub] || sub;
      mark(ctx, repo, kind, rest);
      return;
    }
    if (sub === 'log') {
      const b = repo.state.bisect;
      if (!b) throw fail('We are not bisecting.', 1);
      ctx.print(b.log.join('\n') + '\n');
      return;
    }
    if (sub === 'reset') {
      const b = repo.state.bisect;
      if (!b) { ctx.print('We are not bisecting.\n'); return; }
      const target = rest[0] || b.startBranch || b.startHead;
      delete repo.state.bisect;
      if (!target) return;
      const isBranch = repo.refs.has('refs/heads/' + target);
      const h = isBranch ? repo.readRef('refs/heads/' + target) : repo.resolveCommit(target);
      R.doSwitch(ctx, repo, { target: isBranch ? { ref: 'refs/heads/' + target } : { hash: h }, targetCommit: h, label: target, force: false });
      return;
    }
    if (sub === 'run') {
      const b = repo.state.bisect;
      if (!b) throw fail('You need to start by "git bisect start"', 1);
      if (!rest.length) throw fail('bisect run failed: no command provided.', 1);
      const cmdLine = rest.map((a) => (/[\s"'!*?]/.test(a) ? '"' + a.replace(/"/g, '\\"') + '"' : a)).join(' ');
      const quoted = rest.map(sq).join(' ');
      for (let guard = 0; guard < 100; guard++) {
        ctx.print(`running ${quoted}\n`);
        const r = ctx.sim.execInline ? ctx.sim.execInline(ctx, cmdLine) : { code: 0 };
        let outcome;
        if (r.code === 0) outcome = 'good'; else if (r.code === 125) outcome = 'skip'; else if (r.code >= 1 && r.code < 128) outcome = 'bad'; else throw fail(`bisect run failed: exit code ${r.code} from ${quoted} is < 0 or >= 128`, r.code);
        const res = mark(ctx, repo, outcome, []);
        if (res === 'found') { ctx.print('bisect found first bad commit\n'); return; }
      }
      return;
    }
    throw fail(`error: Unknown subcommand: ${sub}`, 129);
  };
})();
