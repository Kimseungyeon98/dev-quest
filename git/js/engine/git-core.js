/* git 명령어 구현 (1): 인프라 + init/config/add/rm/mv/commit/status/diff/show */
(function () {
  'use strict';
  const G = (globalThis.GitEngine = globalThis.GitEngine || {});
  const { Diff, sha1, GitError, ZERO, EMPTY_TREE, cleanupMessage, pathspecMatcher } = G;
  const U = G.util;
  const { die, fail, parseArgs, plural } = U;

  const COMMANDS = {};
  G.commands = COMMANDS;

  /* ---------------- 공통 헬퍼 ---------------- */
  function requireRepo(ctx) {
    if (!ctx.repo) throw die('not a git repository (or any of the parent directories): .git');
    return ctx.repo;
  }
  function requireWorktree(ctx) {
    const repo = requireRepo(ctx);
    if (repo.bare) throw die('this operation must be run in a work tree');
    return repo;
  }

  function subjectLine(repo, hash) {
    const c = repo.commitObj(hash);
    return c ? U.subjectOf(c.message) : '';
  }

  /* 인덱스로부터 트리 생성 (충돌 중이면 에러) */
  function writeTreeFromIndex(ctx, repo) {
    if (repo.unmerged.size) {
      ctx.print(Array.from(repo.unmerged.keys()).sort().map((pth) => `U\t${pth}\n`).join(''));
      throw fail(`error: Committing is not possible because you have unmerged files.\nhint: Fix them up in the work tree, and then use 'git add/rm <file>'\nhint: as appropriate to mark resolution and make a commit.\nfatal: Exiting because of an unresolved conflict.`, 128);
    }
    return repo.flatToTree(repo.indexFlat());
  }

  function removeEmptyParents(repo, path) {
    // 작업 트리에 디렉터리 개념이 없으므로 명시적으로 만든 빈 디렉터리 집합만 정리
    const parts = path.split('/');
    for (let k = parts.length - 1; k >= 1; k--) {
      const dir = parts.slice(0, k).join('/');
      const has = Array.from(repo.work.keys()).some((p) => p.startsWith(dir + '/'));
      if (!has) repo.dirs.delete(dir);
    }
  }

  /* 인덱스+작업트리를 target(flat)에 정확히 맞춘다 (reset --hard 용). 추적되지 않는 파일은 유지 */
  function hardResetTo(repo, targetFlat) {
    const oldIndexPaths = new Set(repo.index.keys());
    repo.unmerged.forEach((_, p) => oldIndexPaths.add(p));
    oldIndexPaths.forEach((p) => {
      if (!targetFlat.has(p)) { repo.work.delete(p); removeEmptyParents(repo, p); }
    });
    repo.index = new Map();
    repo.unmerged = new Map();
    targetFlat.forEach((e, p) => {
      repo.index.set(p, { hash: e.hash, mode: e.mode });
      repo.work.set(p, repo.blobContent(e.hash));
    });
  }

  /*
   * checkout 용 2-way 병합: HEAD(현재) → target. 로컬 변경이 덮어써지면 에러.
   * 반환: { conflicts: [...], untracked: [...] } 에러가 없으면 인덱스/작업트리를 실제로 갱신한다.
   */
  function switchTree(ctx, repo, targetFlat, opts) {
    opts = opts || {};
    const H = repo.headFlat();
    const rules = repo.ignoreRules();
    const paths = new Set();
    H.forEach((_, p) => paths.add(p));
    targetFlat.forEach((_, p) => paths.add(p));
    const conflicts = [];
    const untrackedOverwrite = [];
    const plan = [];
    Array.from(paths).sort().forEach((p) => {
      const h = H.get(p), t = targetFlat.get(p), i = repo.index.get(p);
      const w = repo.work.get(p);
      if ((h && t && h.hash === t.hash) || (!h && !t)) return;
      if (repo.unmerged.has(p)) { if (!opts.force) conflicts.push(p); plan.push({ p, t }); return; }
      if (opts.force) { plan.push({ p, t }); return; }
      // 인덱스는 HEAD 와 같아야 하고, 작업 트리는 인덱스와 같아야 한다
      const idxSameAsHead = (!h && !i) || (h && i && h.hash === i.hash);
      if (!h && !i) {
        // 추적되지 않는 파일이 target 에서 새로 생기는 경우
        if (w !== undefined) {
          if (t && sha1.hashObject('blob', w) === t.hash) { plan.push({ p, t }); return; }
          if (t && !repo.isIgnored(p, rules)) untrackedOverwrite.push(p);
          else if (t) untrackedOverwrite.push(p);
        }
        plan.push({ p, t });
        return;
      }
      const workSameAsIndex = (w === undefined && !i) || (w !== undefined && i && sha1.hashObject('blob', w) === i.hash);
      if (!idxSameAsHead || !workSameAsIndex) { conflicts.push(p); return; }
      plan.push({ p, t });
    });
    if (conflicts.length || untrackedOverwrite.length) return { conflicts, untrackedOverwrite };
    plan.forEach(({ p, t }) => {
      if (t) { repo.index.set(p, { hash: t.hash, mode: t.mode }); repo.work.set(p, repo.blobContent(t.hash)); }
      else { repo.index.delete(p); repo.work.delete(p); removeEmptyParents(repo, p); }
      repo.unmerged.delete(p);
    });
    return { conflicts: [], untrackedOverwrite: [] };
  }

  function switchErrorMessage(r, kind) {
    let msg = '';
    const verb = kind === 'merge' ? 'merge' : 'checkout';
    const tail = kind === 'merge' ? 'merge' : 'switch branches';
    if (r.conflicts.length) {
      msg += `error: Your local changes to the following files would be overwritten by ${verb}:\n` + r.conflicts.map((p) => '\t' + p).join('\n') + `\nPlease commit your changes or stash them before you ${tail}.\n`;
    }
    if (r.untrackedOverwrite.length) {
      msg += `error: The following untracked working tree files would be overwritten by ${verb}:\n` + r.untrackedOverwrite.map((p) => '\t' + p).join('\n') + `\nPlease move or remove them before you ${tail}.\n`;
    }
    return msg + 'Aborting';
  }

  /* checkout 후 "M\tfile" 목록 */
  function localChangeLines(repo) {
    const T = repo.headFlat();
    const lines = [];
    const paths = new Set();
    repo.index.forEach((_, p) => paths.add(p));
    T.forEach((_, p) => paths.add(p));
    Array.from(paths).sort().forEach((p) => {
      const t = T.get(p), i = repo.index.get(p), w = repo.work.get(p);
      if (!i) { if (t) lines.push('D\t' + p); return; }
      if (!t) { lines.push('A\t' + p); return; }
      if (w === undefined) { lines.push('D\t' + p); return; }
      if (i.hash !== t.hash || sha1.hashObject('blob', w) !== t.hash) lines.push('M\t' + p);
    });
    return lines;
  }

  function commitHeaderLine(ctx, repo, hash, opts) {
    // "[main abc1234] subject"
    opts = opts || {};
    const c = repo.commitObj(hash);
    let where;
    if (repo.isDetached()) where = 'detached HEAD';
    else where = repo.currentBranch();
    const root = opts.root ? ' (root-commit)' : '';
    return `[${where}${root} ${repo.shortHash(hash, 7)}] ${U.subjectOf(c.message)}\n`;
  }

  function commitStatText(ctx, repo, hash) {
    const c = repo.commitObj(hash);
    const parent = c.parents[0];
    const aMap = parent ? repo.commitFlat(parent) : new Map();
    const bMap = repo.commitFlat(hash);
    const changes = U.diffMaps(repo, aMap, bMap);
    if (!changes.length) return '';
    let a = 0, d = 0;
    changes.forEach((ch) => { const n = U.changeCounts(repo, ch); a += n.added; d += n.deleted; });
    return Diff.summaryLine(changes.length, a, d) + '\n' + U.summaryLines(repo, changes);
  }

  /* 커밋 생성 + HEAD/브랜치 갱신 */
  function makeCommit(ctx, repo, opts) {
    const committer = ctx.ident('committer');
    const author = opts.author || { name: committer.name, email: committer.email, ts: committer.ts, tz: committer.tz };
    const hash = repo.putCommit({ tree: opts.tree, parents: opts.parents, author, committer, message: opts.message });
    const msgLine = U.subjectOf(opts.message);
    const kind = opts.logKind || '';
    const text = `commit${kind ? ' ' + kind : ''}: ${msgLine}`;
    if (repo.head.ref) repo.updateRef(repo.head.ref, hash, text, committer);
    else repo.moveDetachedHead(hash, text, committer);
    return hash;
  }

  /* ---------------- git init ---------------- */
  COMMANDS.init = function (ctx, args) {
    const p = parseArgs(args, { flags: { '-q': 'quiet', '--quiet': 'quiet', '--bare': 'bare' }, opts: { '-b': 'branch', '--initial-branch': 'branch' } }, 'init');
    const sim = ctx.sim;
    const target = p.rest[0] || null;
    const branch = (p.o.branch && p.o.branch[0]) || ctx.cfg('init.defaultbranch') || 'master';
    const info = sim.initRepo(target, { bare: !!p.f.bare, branch });
    if (!p.f.quiet) {
      if (info.reinit) ctx.print(`Reinitialized existing Git repository in ${info.path}/.git/\n`);
      else ctx.print(`Initialized empty Git repository in ${info.path}/.git/\n`);
    }
  };

  /* ---------------- git config ---------------- */
  COMMANDS.config = function (ctx, args) {
    const p = parseArgs(args, {
      flags: { '--global': 'global', '--local': 'local', '--system': 'system', '--list': 'list', '-l': 'list', '--unset': 'unset', '--get': 'get', '--add': 'add', '--unset-all': 'unset' },
      opts: { '--get-regexp': 'getRegexp', '--get-all': 'getAll' },
    }, 'config');
    if (p.o.getRegexp) {
      const re = new RegExp(p.o.getRegexp[0], 'i');
      const lines = [];
      ctx.session.globalConfig.forEach((v, k) => { if (re.test(k)) lines.push(`${k} ${v}`); });
      if (ctx.repo) ctx.repo.config.forEach((v, k) => { if (re.test(k)) lines.push(`${k} ${v}`); });
      if (!lines.length) throw fail('', 1);
      ctx.print(lines.join('\n') + '\n');
      return;
    }
    if (p.o.getAll) {
      const k = p.o.getAll[0].toLowerCase();
      const v = ctx.cfg(k);
      if (v === undefined) throw fail('', 1);
      ctx.print(v + '\n');
      return;
    }
    const gcfg = ctx.session.globalConfig;
    const scope = p.f.global || p.f.system ? 'global' : 'local';
    const store = scope === 'global' ? gcfg : (ctx.repo ? ctx.repo.config : null);
    const keyNorm = (k) => {
      const parts = k.split('.');
      if (parts.length >= 3) return parts[0].toLowerCase() + '.' + parts.slice(1, -1).join('.') + '.' + parts[parts.length - 1].toLowerCase();
      return k.toLowerCase();
    };
    if (p.f.list) {
      const lines = [];
      if (!p.f.local) gcfg.forEach((v, k) => { if (!p.f.global || true) lines.push(`${k}=${v}`); });
      if (!p.f.global && ctx.repo) ctx.repo.config.forEach((v, k) => lines.push(`${k}=${v}`));
      ctx.print(lines.join('\n') + (lines.length ? '\n' : ''));
      return;
    }
    if (p.f.unset) {
      const k = keyNorm(p.rest[0] || '');
      if (!store) throw die('not in a git directory');
      if (!store.has(k)) throw fail('', 5);
      store.delete(k);
      return;
    }
    if (p.rest.length === 0) throw fail('usage: git config [<options>]', 129);
    const key = keyNorm(p.rest[0]);
    if (!key.includes('.')) throw fail(`error: key does not contain a section: ${p.rest[0]}`, 1);
    if (p.rest.length === 1 || p.f.get) {
      let v;
      if (p.f.global) v = gcfg.get(key);
      else if (p.f.local) v = ctx.repo ? ctx.repo.config.get(key) : undefined;
      else v = ctx.cfg(key);
      if (v === undefined) throw fail('', 1);
      ctx.print(v + '\n');
      return;
    }
    if (!store) throw die('--local can only be used inside a git repository');
    store.set(key, p.rest[1]);
  };

  /* ---------------- git add ---------------- */
  COMMANDS.add = function (ctx, args) {
    const repo = requireWorktree(ctx);
    const p = parseArgs(args, {
      flags: { '-A': 'all', '--all': 'all', '-u': 'update', '--update': 'update', '-f': 'force', '--force': 'force', '-n': 'dry', '--dry-run': 'dry', '-v': 'verbose', '--verbose': 'verbose', '-p': 'patch', '--patch': 'patch', '--no-all': 'noall', '-N': 'intent', '--intent-to-add': 'intent' },
    }, 'add', 'usage: git add [<options>] [--] <pathspec>...');
    const specs = p.rest.concat(p.dd);
    if (p.f.patch) return addPatch(ctx, repo, specs);
    if (!specs.length && !p.f.all && !p.f.update) {
      ctx.eprint("Nothing specified, nothing added.\nhint: Maybe you wanted to say 'git add .'?\nhint: Disable this message with \"git config advice.addEmptyPathspec false\"\n");
      return;
    }
    const matcher = specs.length ? pathspecMatcher(specs) : () => true;
    if (specs.length) {
      specs.forEach((s) => {
        const clean = s.replace(/^\.\//, '');
        if (clean === '.' || clean === '') return;
        const m = pathspecMatcher([s]);
        const exists = Array.from(repo.work.keys()).some(m) || Array.from(repo.index.keys()).some(m) || Array.from(repo.unmerged.keys()).some(m) || repo.dirs.has(clean.replace(/\/$/, ''));
        if (!exists) throw die(`pathspec '${s}' did not match any files`);
      });
    }
    const rules = repo.ignoreRules();
    const ignoredHit = [];
    const toAdd = [];
    repo.work.forEach((content, path) => {
      if (!matcher(path)) return;
      const tracked = repo.index.has(path) || repo.unmerged.has(path);
      if (p.f.update && !tracked) return;
      if (!tracked && !p.f.force && repo.isIgnored(path, rules)) {
        // 명시적으로 지정한 경우에만 경고
        if (specs.some((s) => !/^\.?\/?$/.test(s) && s !== '.' && pathspecMatcher([s])(path) && (s === path || path.startsWith(s.replace(/\/$/, '') + '/') || s === path))) ignoredHit.push(path);
        return;
      }
      toAdd.push(path);
    });
    const toRemove = [];
    repo.index.forEach((_, path) => {
      if (!matcher(path)) return;
      if (!repo.work.has(path)) toRemove.push(path);
    });
    repo.unmerged.forEach((_, path) => {
      if (!matcher(path)) return;
      if (!repo.work.has(path) && !toRemove.includes(path)) toRemove.push(path);
    });
    if (ignoredHit.length && !toAdd.length) {
      const uniq = Array.from(new Set(ignoredHit)).sort();
      // 디렉터리 이름으로 보고되는 경우는 단순화
      ctx.eprint('The following paths are ignored by one of your .gitignore files:\n' + uniq.join('\n') + '\nhint: Use -f if you really want to add them.\nhint: Disable this message with "git config advice.addIgnoredFile false"\n');
      throw fail('', 1);
    }
    toAdd.sort().forEach((path) => {
      if (p.f.dry) { ctx.print(`add '${path}'\n`); return; }
      const before = repo.index.get(path);
      repo.stagePath(path);
      repo.unmerged.delete(path);
      if (p.f.verbose && (!before || before.hash !== repo.index.get(path).hash)) ctx.print(`add '${path}'\n`);
    });
    toRemove.sort().forEach((path) => {
      if (p.f.dry) { ctx.print(`remove '${path}'\n`); return; }
      repo.index.delete(path);
      repo.unmerged.delete(path);
      if (p.f.verbose) ctx.print(`remove '${path}'\n`);
    });
  };

  /* git add -p : 헝크 단위 대화형 스테이징 */
  function addPatch(ctx, repo, specs) {
    const matcher = specs.length ? pathspecMatcher(specs) : () => true;
    const files = [];
    Array.from(repo.index.keys()).sort().forEach((path) => {
      if (!matcher(path)) return;
      const w = repo.work.get(path);
      const i = repo.index.get(path);
      if (w === undefined) return;
      if (sha1.hashObject('blob', w) !== i.hash) files.push(path);
    });
    if (!files.length) { ctx.print('No changes.\n'); return; }
    let quitAll = false;
    files.forEach((path) => {
      if (quitAll) return;
      const i = repo.index.get(path);
      const aLines = Diff.splitLines(repo.blobContent(i.hash));
      const bLines = Diff.splitLines(repo.work.get(path));
      const blocks = Diff.diffBlocks(aLines, bLines);
      // hunk 으로 묶기 (컨텍스트 3)
      const hunks = [];
      let k = 0;
      while (k < blocks.length) {
        let j = k;
        while (j + 1 < blocks.length && blocks[j + 1].a0 - blocks[j].a1 <= 6) j++;
        hunks.push(blocks.slice(k, j + 1));
        k = j + 1;
      }
      const decided = [];
      let acceptAll = false, skipRest = false;
      ctx.print(U.colorizePatch(ctx, `diff --git a/${path} b/${path}\nindex ${repo.shortHash(i.hash, 7)}..${repo.shortHash(sha1.hashObject('blob', repo.work.get(path)), 7)} 100644\n--- a/${path}\n+++ b/${path}\n`));
      hunks.forEach((hk, hi) => {
        if (quitAll || skipRest) { decided.push(false); return; }
        if (acceptAll) { decided.push(true); return; }
        const text = hunkText(aLines, bLines, hk, hunks, hi);
        ctx.print(U.colorizePatch(ctx, text));
        const q = `(${hi + 1}/${hunks.length}) Stage this hunk [y,n,q,a,d${hunks.length > 1 ? ',j,J,g,/' : ''},e,?]? `;
        for (;;) {
          const ans = (ctx.prompt(q) || '').trim().toLowerCase();
          if (ans === 'y') { decided.push(true); break; }
          if (ans === 'n') { decided.push(false); break; }
          if (ans === 'q') { decided.push(false); quitAll = true; break; }
          if (ans === 'a') { decided.push(true); acceptAll = true; break; }
          if (ans === 'd') { decided.push(false); skipRest = true; break; }
          ctx.print('y - stage this hunk\nn - do not stage this hunk\nq - quit; do not stage this hunk or any of the remaining ones\na - stage this hunk and all later hunks in the file\nd - do not stage this hunk or any of the later hunks in the file\n');
        }
      });
      // 선택된 헝크만 적용한 내용을 인덱스에 스테이징
      const out = [];
      let cursor = 0;
      hunks.forEach((hk, hi) => {
        hk.forEach((bl) => {
          for (; cursor < bl.a0; cursor++) out.push(aLines[cursor]);
          if (decided[hi]) { for (let q2 = bl.b0; q2 < bl.b1; q2++) out.push(bLines[q2]); }
          else { for (let q2 = bl.a0; q2 < bl.a1; q2++) out.push(aLines[q2]); }
          cursor = bl.a1;
        });
      });
      for (; cursor < aLines.length; cursor++) out.push(aLines[cursor]);
      const newContent = out.join('');
      const h = repo.putBlob(newContent);
      repo.index.set(path, { hash: h, mode: i.mode });
    });
  }

  function hunkText(aLines, bLines, hk, allHunks, idx) {
    const first = hk[0], last = hk[hk.length - 1];
    const ctxN = 3;
    const aStart = Math.max(first.a0 - ctxN, 0);
    const aEnd = Math.min(last.a1 + ctxN, aLines.length);
    let delta = 0;
    for (let q = 0; q < idx; q++) allHunks[q].forEach((bl) => { delta += (bl.b1 - bl.b0) - (bl.a1 - bl.a0); });
    const lines = [];
    let aCount = 0, bCount = 0, cursor = aStart;
    hk.forEach((bl) => {
      for (; cursor < bl.a0; cursor++) { lines.push(' ' + aLines[cursor]); aCount++; bCount++; }
      for (let q = bl.a0; q < bl.a1; q++) { lines.push('-' + aLines[q]); aCount++; }
      for (let q = bl.b0; q < bl.b1; q++) { lines.push('+' + bLines[q]); bCount++; }
      cursor = bl.a1;
    });
    for (; cursor < aEnd; cursor++) { lines.push(' ' + aLines[cursor]); aCount++; bCount++; }
    const rs = (s, n) => (n === 1 ? String(s) : `${s},${n}`);
    const oldStart = aCount === 0 ? aStart : aStart + 1;
    const bStart = aStart + delta;
    const newStart = bCount === 0 ? bStart : bStart + 1;
    let out = `@@ -${rs(oldStart, aCount)} +${rs(newStart, bCount)} @@\n`;
    lines.forEach((l) => { out += l.endsWith('\n') ? l : l + '\n\\ No newline at end of file\n'; });
    return out;
  }

  /* ---------------- git rm ---------------- */
  COMMANDS.rm = function (ctx, args) {
    const repo = requireWorktree(ctx);
    const p = parseArgs(args, { flags: { '--cached': 'cached', '-r': 'recursive', '-f': 'force', '--force': 'force', '-n': 'dry', '--dry-run': 'dry', '-q': 'quiet', '--quiet': 'quiet' } }, 'rm', 'usage: git rm [<options>] [--] [<file>...]');
    const specs = p.rest.concat(p.dd);
    if (!specs.length) throw fail('usage: git rm [<options>] [--] [<file>...]', 129);
    const H = repo.headFlat();
    const targets = [];
    specs.forEach((s) => {
      const m = pathspecMatcher([s]);
      const found = Array.from(repo.index.keys()).filter(m).sort();
      if (!found.length) throw die(`pathspec '${s}' did not match any files`);
      const isDir = found.some((f) => f !== s && f.startsWith(s.replace(/\/$/, '') + '/'));
      if (isDir && !p.f.recursive) throw die(`not removing '${s}' recursively without -r`);
      found.forEach((f) => { if (!targets.includes(f)) targets.push(f); });
    });
    targets.sort();
    if (!p.f.force) {
      const stagedChanged = [], localMod = [], both = [];
      targets.forEach((path) => {
        const i = repo.index.get(path), h = H.get(path), w = repo.work.get(path);
        const wHash = w === undefined ? null : sha1.hashObject('blob', w);
        const idxDiffHead = !h || h.hash !== i.hash;
        const workDiffIdx = w !== undefined && wHash !== i.hash;
        if (p.f.cached) {
          if (idxDiffHead && workDiffIdx) both.push(path);
          return;
        }
        if (idxDiffHead && workDiffIdx) both.push(path);
        else if (idxDiffHead) stagedChanged.push(path);
        else if (workDiffIdx) localMod.push(path);
      });
      const hintTail = p.f.cached ? '(use -f to force removal)' : '(use --cached to keep the file, or -f to force removal)';
      let msg = '';
      if (both.length) msg += `error: the following ${both.length === 1 ? 'file has' : 'files have'} staged content different from both the\nfile and the HEAD:\n` + both.map((x) => '    ' + x).join('\n') + `\n(use -f to force removal)\n`;
      if (stagedChanged.length) msg += `error: the following ${stagedChanged.length === 1 ? 'file has' : 'files have'} changes staged in the index:\n` + stagedChanged.map((x) => '    ' + x).join('\n') + `\n${hintTail}\n`;
      if (localMod.length) msg += `error: the following ${localMod.length === 1 ? 'file has' : 'files have'} local modifications:\n` + localMod.map((x) => '    ' + x).join('\n') + `\n${hintTail}\n`;
      if (msg) throw fail(msg.replace(/\n$/, ''), 1);
    }
    targets.forEach((path) => {
      if (!p.f.quiet) ctx.print(`rm '${path}'\n`);
      if (p.f.dry) return;
      repo.index.delete(path);
      if (!p.f.cached) { repo.work.delete(path); removeEmptyParents(repo, path); }
    });
  };

  /* ---------------- git mv ---------------- */
  COMMANDS.mv = function (ctx, args) {
    const repo = requireWorktree(ctx);
    const p = parseArgs(args, { flags: { '-f': 'force', '--force': 'force', '-n': 'dry', '--dry-run': 'dry', '-v': 'verbose' } }, 'mv', 'usage: git mv [<options>] <source>... <destination>');
    const names = p.rest.concat(p.dd);
    if (names.length < 2) throw fail('usage: git mv [<options>] <source>... <destination>', 129);
    const dst = names[names.length - 1];
    const srcs = names.slice(0, -1);
    const dstIsDir = Array.from(repo.work.keys()).some((k) => k.startsWith(dst.replace(/\/$/, '') + '/')) || repo.dirs.has(dst.replace(/\/$/, '')) || dst.endsWith('/');
    srcs.forEach((src) => {
      const srcFiles = Array.from(repo.index.keys()).filter((k) => k === src || k.startsWith(src.replace(/\/$/, '') + '/'));
      if (!srcFiles.length) {
        if (repo.work.has(src)) throw die(`not under version control, source=${src}, destination=${dst}`);
        throw die(`bad source, source=${src}, destination=${dst}`);
      }
      srcFiles.forEach((sf) => {
        let target;
        if (srcs.length === 1 && !dstIsDir) target = dst;
        else target = dst.replace(/\/$/, '') + '/' + (sf === src ? src.split('/').pop() : sf.slice(src.replace(/\/$/, '').length - src.split('/').pop().length));
        if (srcs.length === 1 && dstIsDir && sf !== src) target = dst.replace(/\/$/, '') + '/' + src.split('/').pop() + sf.slice(src.length);
        if (srcs.length === 1 && !dstIsDir && sf !== src) target = dst.replace(/\/$/, '') + sf.slice(src.replace(/\/$/, '').length);
        if (repo.work.has(target) && !p.f.force) throw die(`destination exists, source=${src}, destination=${target}`);
        if (p.f.dry || p.f.verbose) ctx.print(`Renaming ${sf} to ${target}\n`);
        if (p.f.dry) return;
        const e = repo.index.get(sf);
        const content = repo.work.get(sf);
        repo.index.delete(sf);
        repo.work.delete(sf);
        repo.index.set(target, e);
        if (content !== undefined) repo.work.set(target, content);
        removeEmptyParents(repo, sf);
      });
    });
  };

  /* ---------------- git commit ---------------- */
  function commitTemplate(ctx, repo, initial, opts) {
    const st = U.computeStatus(repo, {});
    let t = initial || '';
    t += '\n';
    t += `# Please enter the commit message for your changes. Lines starting\n# with '#' will be ignored, and an empty message aborts the commit.\n#\n`;
    if (repo.isDetached()) t += '# Not currently on any branch.\n';
    else t += `# On branch ${repo.currentBranch()}\n`;
    if (repo.isUnborn()) t += '#\n# Initial commit\n#\n';
    if (st.staged.length) {
      t += '# Changes to be committed:\n';
      st.staged.forEach((ch) => {
        const label = { A: 'new file:', M: 'modified:', D: 'deleted:', R: 'renamed:' }[ch.status];
        const name = ch.status === 'R' ? `${ch.oldPath} -> ${ch.path}` : ch.path;
        t += `#\t${label.padEnd(12)}${name}\n`;
      });
      t += '#\n';
    }
    if (st.unstaged.length) {
      t += '# Changes not staged for commit:\n';
      st.unstaged.forEach((ch) => { t += `#\t${(ch.status === 'D' ? 'deleted:' : 'modified:').padEnd(12)}${ch.path}\n`; });
      t += '#\n';
    }
    if (st.untracked.length) {
      t += '# Untracked files:\n';
      st.untracked.forEach((p) => { t += `#\t${p}\n`; });
      t += '#\n';
    }
    return t;
  }

  COMMANDS.commit = function (ctx, args) {
    const repo = requireWorktree(ctx);
    const p = parseArgs(args, {
      flags: { '-a': 'all', '--all': 'all', '--amend': 'amend', '--no-edit': 'noedit', '--allow-empty': 'allowEmpty', '--allow-empty-message': 'allowEmptyMsg', '-q': 'quiet', '--quiet': 'quiet', '--no-verify': 'noverify', '-n': 'noverify', '--reset-author': 'resetAuthor', '-e': 'edit', '--edit': 'edit', '-v': 'verbose', '-s': 'signoff', '--signoff': 'signoff' },
      opts: { '-m': 'message', '--message': 'message', '-F': 'file', '--file': 'file', '--author': 'author', '--date': 'date', '-C': 'reuse', '--reuse-message': 'reuse', '-c': 'reedit', '--fixup': 'fixup', '--squash': 'squash' },
    }, 'commit', 'usage: git commit [-a | --interactive | --patch] [-s] [-v] [-u<mode>] [--amend]\n                  [--dry-run] [(-c | -C | --fixup | --squash) <commit>]\n                  [-F <file> | -m <msg>] [--reset-author] [--allow-empty]\n                  [--allow-empty-message] [--no-verify] [-e] [--author=<author>]\n                  [--date=<date>] [--cleanup=<mode>] [--[no-]status]\n                  [-i | -o] [--pathspec-from-file=<file> [--pathspec-file-nul]]\n                  [(--trailer <token>[(=|:)<value>])...]\n                  [-S[<keyid>]] [--] [<pathspec>...]');
    const pathspecs = p.rest.concat(p.dd);
    const st0 = repo.state;
    const inMerge = !!st0.merge;
    const inCherry = !!st0.cherryPick;
    const inRevert = !!st0.revert;
    if (st0.rebase && st0.rebase.conflict && !inMerge) {
      // rebase 충돌 해결 중 직접 commit 하는 경우: 충돌 파일이 모두 해결되어야 한다
    }
    if (p.f.all) {
      Array.from(repo.index.keys()).forEach((path) => {
        if (repo.unmerged.has(path)) return;
        if (repo.work.has(path)) repo.stagePath(path); else repo.index.delete(path);
      });
    }
    if (pathspecs.length && !p.f.all) {
      // git commit <paths>: 해당 경로만 커밋(스테이징 포함)
      const m = pathspecMatcher(pathspecs);
      Array.from(repo.index.keys()).forEach((path) => {
        if (!m(path)) return;
        if (repo.work.has(path)) repo.stagePath(path); else repo.index.delete(path);
      });
    }
    if (repo.unmerged.size) writeTreeFromIndex(ctx, repo);

    const headHash = repo.headCommit();
    let amendCommit = null;
    if (p.f.amend) {
      if (!headHash) throw die('You have nothing to amend.');
      if (inMerge) throw die('You are in the middle of a merge -- cannot amend.');
      amendCommit = repo.commitObj(headHash);
    }
    const parentsBase = amendCommit ? amendCommit.parents.slice() : (headHash ? [headHash] : []);
    const treeHash = repo.flatToTree(repo.indexFlat());
    const parentTree = amendCommit ? (amendCommit.parents[0] ? repo.commitObj(amendCommit.parents[0]).tree : EMPTY_TREE) : (headHash ? repo.commitObj(headHash).tree : EMPTY_TREE);
    const unchanged = treeHash === parentTree && !inMerge;
    if (unchanged && !p.f.allowEmpty && !(p.f.amend) && !inCherry && !inRevert) {
      // 변경 사항이 없으면 status 출력과 함께 실패
      const r = U.statusLong(ctx, { forCommit: true });
      ctx.print(r.text);
      throw fail('', 1);
    }
    if (inCherry && unchanged && !p.f.allowEmpty) {
      ctx.print(U.statusLong(ctx, { forCommit: true }).text);
      throw fail('', 1);
    }

    // 메시지 결정
    let message = null;
    let editorInitial = '';
    let needEditor = false;
    if (p.o.message) {
      message = cleanupMessage(p.o.message.join('\n\n'), false);
    } else if (p.o.file) {
      const content = ctx.sim.readFileForGit ? ctx.sim.readFileForGit(ctx, p.o.file[0]) : '';
      message = cleanupMessage(content, false);
    } else if (p.o.reuse) {
      const rc = repo.resolveCommit(p.o.reuse[0]);
      if (!rc) throw die(`could not lookup commit ${p.o.reuse[0]}`);
      message = repo.commitObj(rc).message;
    } else if (p.o.fixup) {
      const rc = repo.resolveCommit(p.o.fixup[0]);
      if (!rc) throw die(`could not lookup commit ${p.o.fixup[0]}`);
      message = `fixup! ${U.subjectOf(repo.commitObj(rc).message)}\n`;
    } else if (p.o.squash) {
      const rc = repo.resolveCommit(p.o.squash[0]);
      if (!rc) throw die(`could not lookup commit ${p.o.squash[0]}`);
      message = `squash! ${U.subjectOf(repo.commitObj(rc).message)}\n`;
    } else if (amendCommit && p.f.noedit) {
      message = amendCommit.message;
    } else if (p.f.noedit && (inMerge || inCherry || inRevert)) {
      message = cleanupMessage((inMerge ? st0.merge.msg : inCherry ? st0.cherryPick.msg : st0.revert.msg), true);
    } else if (p.f.noedit && st0.squashMsg) {
      message = cleanupMessage(st0.squashMsg, true);
    } else {
      needEditor = true;
      if (amendCommit) editorInitial = amendCommit.message;
      else if (inMerge) editorInitial = st0.merge.msg;
      else if (inCherry) editorInitial = st0.cherryPick.msg;
      else if (inRevert) editorInitial = st0.revert.msg;
      else if (st0.squashMsg) editorInitial = st0.squashMsg;
    }
    if (p.f.edit && !needEditor) { needEditor = true; editorInitial = message; }
    if (needEditor) {
      const text = ctx.input('editor', { kind: 'COMMIT_EDITMSG', initial: commitTemplate(ctx, repo, editorInitial, {}) });
      message = cleanupMessage(text, true);
    }
    if (!message && !p.f.allowEmptyMsg) {
      ctx.eprint('Aborting commit due to empty commit message.\n');
      throw fail('', 1);
    }
    if (!message) message = '';

    const committer = ctx.ident('committer');
    let author = amendCommit && !p.f.resetAuthor ? amendCommit.author : { name: committer.name, email: committer.email, ts: committer.ts, tz: committer.tz };
    if (p.o.author) {
      const m = p.o.author[0].match(/^(.*?)\s*<(.*)>$/);
      if (!m) throw die(`--author '${p.o.author[0]}' is not 'Name <email>' and matches no existing author`);
      author = { name: m[1], email: m[2], ts: author.ts, tz: author.tz };
    }
    if (p.o.date) {
      const ts = ctx.sim.parseDate ? ctx.sim.parseDate(p.o.date[0]) : null;
      if (ts) author = Object.assign({}, author, { ts: ts.ts, tz: ts.tz });
    }
    if (inCherry && st0.cherryPick.author && !p.o.author) author = st0.cherryPick.author;
    if (inRevert) author = { name: committer.name, email: committer.email, ts: committer.ts, tz: committer.tz };
    if (st0.rebase && st0.rebase.currentAuthor && !p.o.author && !amendCommit) author = st0.rebase.currentAuthor;

    let parents = parentsBase;
    if (inMerge) parents = [headHash].concat(st0.merge.heads);
    const isRoot = parents.length === 0;
    let logKind = '';
    if (amendCommit) logKind = '(amend)';
    else if (isRoot) logKind = '(initial)';
    else if (inMerge) logKind = '(merge)';
    else if (inCherry) logKind = '(cherry-pick)';
    const hash = makeCommit(ctx, repo, { tree: treeHash, parents, author, message, logKind });
    // 진행 중 상태 정리
    delete repo.state.merge;
    delete repo.state.cherryPick;
    delete repo.state.revert;
    delete repo.state.squashMsg;
    if (!p.f.quiet) {
      ctx.print(commitHeaderLine(ctx, repo, hash, { root: isRoot }));
      const c = repo.commitObj(hash);
      if (amendCommit || p.o.date || p.o.reuse || inCherry || st0.rebase || author.ts !== committer.ts || author.tz !== committer.tz) {
        // git 은 author date 가 committer date 와 다르면 Date 줄을 보여준다
        const ident = `${author.name} <${author.email}>`;
        if (author.name !== committer.name || author.email !== committer.email) ctx.print(` Author: ${ident}\n`);
        ctx.print(` Date: ${U.formatDate(author.ts, author.tz, 'default', ctx.now)}\n`);
      } else if (author.name !== committer.name || author.email !== committer.email) {
        ctx.print(` Author: ${author.name} <${author.email}>\n`);
      }
      if (c.parents.length < 2) ctx.print(commitStatText(ctx, repo, hash));
    }
  };

  /* ---------------- git status ---------------- */
  COMMANDS.status = function (ctx, args) {
    const repo = requireWorktree(ctx);
    const p = parseArgs(args, {
      flags: { '-s': 'short', '--short': 'short', '-b': 'branch', '--branch': 'branch', '--porcelain': 'porcelain', '-uno': 'uno', '-uall': 'uall', '-unormal': 'unormal', '--ignored': 'ignored', '-v': 'verbose', '--long': 'long' },
      optional: { '--untracked-files': 'untracked' },
    }, 'status');
    const untrackedAll = !!p.f.uall || (p.o.untracked && p.o.untracked[0] === 'all');
    const noUntracked = !!p.f.uno || (p.o.untracked && p.o.untracked[0] === 'no');
    const pathspecs = p.rest.concat(p.dd);
    if (p.f.short || p.f.porcelain) {
      const saveColor = ctx.color;
      if (p.f.porcelain) ctx.color = false;
      let text = U.statusShort(ctx, { branch: p.f.branch, untrackedAll });
      if (noUntracked) text = text.split('\n').filter((l) => !l.startsWith('??') && !l.includes('\x1b[31m??')).join('\n');
      ctx.color = saveColor;
      ctx.print(text);
      return;
    }
    let r = U.statusLong(ctx, { untrackedAll });
    if (noUntracked) {
      const st = r.st;
      st.untracked = [];
    }
    void pathspecs;
    ctx.print(r.text);
  };

  /* ---------------- 공용: diff 출력 ---------------- */
  const DIFF_SPEC = {
    flags: {
      '--staged': 'staged', '--cached': 'staged', '--stat': 'stat', '--numstat': 'numstat', '--shortstat': 'shortstat', '--name-only': 'nameOnly', '--name-status': 'nameStatus',
      '--no-color': 'noColor', '--color': 'color', '-p': 'patch', '--patch': 'patch', '--quiet': 'quiet', '--exit-code': 'exitCode', '--summary': 'summary', '--no-renames': 'noRenames', '-M': 'renames', '--check': 'check', '-s': 'noPatch', '--no-patch': 'noPatch', '--raw': 'raw',
      '-w': 'ignoreWs', '--ignore-all-space': 'ignoreWs',
    },
    opts: { '-U': 'unified', '--unified': 'unified' },
  };

  function emitDiff(ctx, repo, changes, o, header) {
    const out = [];
    const ctxLines = o.unified ? parseInt(o.unified[0], 10) : 3;
    if (o.f.nameOnly) { changes.forEach((c) => out.push(c.path)); ctx.print(out.length ? out.join('\n') + '\n' : ''); return; }
    if (o.f.nameStatus) {
      changes.forEach((c) => out.push(c.status === 'R' ? `R${String(c.similarity).padStart(3, '0')}\t${c.oldPath}\t${c.path}` : `${c.status}\t${c.path}`));
      ctx.print(out.length ? out.join('\n') + '\n' : ''); return;
    }
    if (o.f.numstat) {
      changes.forEach((c) => { const n = U.changeCounts(repo, c); out.push(`${n.binary ? '-' : n.added}\t${n.binary ? '-' : n.deleted}\t${c.status === 'R' ? U.renameLabel(c.oldPath, c.path) : c.path}`); });
      ctx.print(out.length ? out.join('\n') + '\n' : ''); return;
    }
    if (o.f.shortstat) {
      let a = 0, d = 0;
      changes.forEach((c) => { const n = U.changeCounts(repo, c); a += n.added; d += n.deleted; });
      if (changes.length) ctx.print(Diff.summaryLine(changes.length, a, d) + '\n');
      return;
    }
    if (o.f.stat) {
      ctx.print(U.diffStatText(repo, changes) + (o.f.summary ? U.summaryLines(repo, changes) : ''));
      return;
    }
    if (o.f.noPatch) return;
    changes.forEach((c) => {
      const patch = U.renderPatch(repo, c, { context: ctxLines });
      ctx.print(U.colorizePatch(ctx, patch));
    });
    void header;
  }

  function filterByPaths(pathspecs) {
    if (!pathspecs.length) return null;
    return pathspecMatcher(pathspecs);
  }

  /* ---------------- git diff ---------------- */
  COMMANDS.diff = function (ctx, args) {
    const repo = requireRepo(ctx);
    const p = parseArgs(args, DIFF_SPEC, 'diff');
    const pre = p.rest.slice();
    const dd = p.dd;
    // 리비전과 경로 구분
    const revs = [];
    const paths = dd.slice();
    if (!dd.length) {
      while (pre.length) {
        const a = pre[0];
        if (a.includes('..') && repo.resolveCommit(a.split(/\.{2,3}/)[0] || 'HEAD') && repo.resolveCommit(a.split(/\.{2,3}/)[1] || 'HEAD')) { revs.push(pre.shift()); continue; }
        if (repo.resolve(a) && !(repo.work.has(a))) { revs.push(pre.shift()); continue; }
        break;
      }
      pre.forEach((x) => paths.push(x));
      if (revs.length === 0 && paths.length === 0) { /* 기본 */ }
    }
    if (!dd.length) {
      // 인자가 해석 불가: 경로도 리비전도 아닌 경우
      const bad = paths.find((x) => !repo.work.has(x) && !repo.index.has(x) && !Array.from(repo.work.keys()).some((k) => k.startsWith(x.replace(/\/$/, '') + '/')) && !Array.from(repo.index.keys()).some((k) => k.startsWith(x.replace(/\/$/, '') + '/')) && !/[*?]/.test(x) && !(repo.headFlat().has(x)));
      if (bad !== undefined) throw die(`ambiguous argument '${bad}': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'`);
    }
    const filter = filterByPaths(paths);
    const renames = !p.f.noRenames;
    let changes;
    let aMap, bMap;
    if (revs.length === 2 || (revs.length === 1 && /\.\./.test(revs[0]))) {
      let a, b;
      if (revs.length === 2) { a = repo.resolveCommit(revs[0]); b = repo.resolveCommit(revs[1]); }
      else {
        const three = revs[0].includes('...');
        const [l, r] = revs[0].split(/\.{2,3}/);
        a = repo.resolveCommit(l || 'HEAD'); b = repo.resolveCommit(r || 'HEAD');
        if (three) { const mb = repo.mergeBases(a, b); a = mb[0]; }
      }
      aMap = repo.commitFlat(a); bMap = repo.commitFlat(b);
    } else if (p.f.staged) {
      const base = revs[0] ? repo.resolveCommit(revs[0]) : repo.headCommit();
      aMap = base ? repo.commitFlat(base) : new Map();
      bMap = U.indexMap(repo);
    } else if (revs.length === 1) {
      const c = repo.resolveCommit(revs[0]);
      if (!c) throw die(`bad revision '${revs[0]}'`);
      aMap = repo.commitFlat(c);
      bMap = new Map();
      // 작업 트리: 추적되는 파일만 비교
      const idx = repo.index;
      repo.work.forEach((content, path) => { if (idx.has(path) || aMap.has(path)) bMap.set(path, { content, mode: (idx.get(path) || {}).mode || '100644' }); });
    } else {
      aMap = U.indexMap(repo);
      bMap = new Map();
      aMap.forEach((e, path) => {
        const w = repo.work.get(path);
        if (w !== undefined) bMap.set(path, { content: w, mode: e.mode });
      });
      // 충돌 파일은 별도로
      if (repo.unmerged.size) {
        Array.from(repo.unmerged.keys()).sort().forEach((path) => {
          if (filter && !filter(path)) return;
          const text = combinedDiffText(ctx, repo, path);
          if (text) ctx.print(U.colorizePatch(ctx, text)); else ctx.print(`* Unmerged path ${path}\n`);
        });
      }
    }
    changes = U.diffMaps(repo, aMap, bMap, { renames, filter: filter || undefined });
    if (p.f.ignoreWs) changes = changes.filter((c) => {
      const a = c.a ? U.contentOf(repo, c.a).replace(/\s+/g, '') : '';
      const b = c.b ? U.contentOf(repo, c.b).replace(/\s+/g, '') : '';
      return a !== b || c.status !== 'M';
    });
    if (p.f.quiet || p.f.exitCode) {
      if (changes.length && (p.f.quiet || p.f.exitCode)) { if (!p.f.quiet) emitDiff(ctx, repo, changes, p); throw fail('', 1); }
      return;
    }
    if (p.f.check) return;
    emitDiff(ctx, repo, changes, p);
  };

  /* 충돌 파일의 combined diff (2-parent) */
  function combinedDiffText(ctx, repo, path) {
    const st = repo.unmerged.get(path);
    const work = repo.work.get(path);
    if (work === undefined) return '';
    const ours = st[2] ? Diff.splitLines(repo.blobContent(st[2].hash)) : null;
    const theirs = st[3] ? Diff.splitLines(repo.blobContent(st[3].hash)) : null;
    if (!ours || !theirs) return '';
    const res = Diff.splitLines(work);
    const dO = Diff.diffBlocks(ours, res);
    const dT = Diff.diffBlocks(theirs, res);
    // 결과 줄 기준으로 부모별 상태 계산
    const lineO = res.map(() => true); // true: ours 에도 있음(변경 없음)
    const lineT = res.map(() => true);
    const removedO = new Map(); // 결과 위치 → 제거된 ours 줄들
    const removedT = new Map();
    dO.forEach((b) => { for (let k = b.b0; k < b.b1; k++) lineO[k] = false; if (b.a1 > b.a0) removedO.set(b.b0, (removedO.get(b.b0) || []).concat(ours.slice(b.a0, b.a1))); });
    dT.forEach((b) => { for (let k = b.b0; k < b.b1; k++) lineT[k] = false; if (b.a1 > b.a0) removedT.set(b.b0, (removedT.get(b.b0) || []).concat(theirs.slice(b.a0, b.a1))); });
    const rows = [];
    for (let k = 0; k <= res.length; k++) {
      (removedO.get(k) || []).forEach((l) => rows.push({ pre: '- ', text: l, res: false }));
      (removedT.get(k) || []).forEach((l) => rows.push({ pre: ' -', text: l, res: false }));
      if (k < res.length) rows.push({ pre: (lineO[k] ? ' ' : '+') + (lineT[k] ? ' ' : '+'), text: res[k], res: true });
    }
    // 변경이 있는 행 주변만 hunk 로 (컨텍스트 3)
    const changed = rows.map((r) => r.pre !== '  ');
    const keep = rows.map(() => false);
    changed.forEach((c, idx) => { if (c) for (let q = Math.max(0, idx - 3); q <= Math.min(rows.length - 1, idx + 3); q++) keep[q] = true; });
    let out = `diff --cc ${path}\nindex ${repo.shortHash(st[2].hash, 7)},${repo.shortHash(st[3].hash, 7)}..0000000\n--- a/${path}\n+++ b/${path}\n`;
    let i = 0;
    while (i < rows.length) {
      if (!keep[i]) { i++; continue; }
      let j = i;
      while (j < rows.length && keep[j]) j++;
      const seg = rows.slice(i, j);
      // 각 부모/결과의 시작 줄 번호와 길이 계산
      let oStart = 1, tStart = 1, rStart = 1;
      rows.slice(0, i).forEach((r) => { if (r.pre[0] !== '+' && r.res || (!r.res && r.pre[0] === '-')) oStart++; if (r.pre[1] !== '+' && r.res || (!r.res && r.pre[1] === '-')) tStart++; if (r.res) rStart++; });
      let oLen = 0, tLen = 0, rLen = 0;
      seg.forEach((r) => { if ((r.res && r.pre[0] !== '+') || (!r.res && r.pre[0] === '-')) oLen++; if ((r.res && r.pre[1] !== '+') || (!r.res && r.pre[1] === '-')) tLen++; if (r.res) rLen++; });
      out += `@@@ -${oStart},${oLen} -${tStart},${tLen} +${rStart},${rLen} @@@\n`;
      seg.forEach((r) => { out += r.pre + r.text.replace(/\n$/, '') + '\n'; });
      i = j;
    }
    return out;
  }

  G.core = {
    requireRepo, requireWorktree, subjectLine, writeTreeFromIndex, hardResetTo, switchTree, switchErrorMessage, localChangeLines,
    commitHeaderLine, commitStatText, makeCommit, removeEmptyParents, emitDiff, DIFF_SPEC, filterByPaths, combinedDiffText, commitTemplate,
  };
})();
