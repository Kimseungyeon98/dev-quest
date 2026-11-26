/* git 명령어 구현 (3-3): 배관 명령 — rev-parse / cat-file / ls-tree / ls-files / show-ref / for-each-ref / update-ref … */
(function () {
  'use strict';
  const G = (globalThis.GitEngine = globalThis.GitEngine || {});
  const { Diff, sha1, GitError, ZERO, cleanupMessage, pathspecMatcher } = G;
  const U = G.util;
  const C = G.core;
  const { die, fail, parseArgs, plural } = U;
  const COMMANDS = G.commands;
  const { cfgBool, describeHead, globMatch, identOf, refFormat, setUpstream, sortRefs, unsetUpstream, validBranchName, worktreePath, doSwitch, restoreToPaths } = G.refs;

  function serializeObject(repo, h) {
    const o = repo.get(h);
    if (!o) return null;
    if (o.type === 'blob') return o.content;
    if (o.type === 'commit') {
      let s = `tree ${o.tree}\n`;
      o.parents.forEach((pp) => { s += `parent ${pp}\n`; });
      return s + `author ${G.fmtIdent(o.author)}\ncommitter ${G.fmtIdent(o.committer)}\n\n${o.message}`;
    }
    if (o.type === 'tag') return `object ${o.object}\ntype ${o.objType}\ntag ${o.tag}\ntagger ${G.fmtIdent(o.tagger)}\n\n${o.message}`;
    if (o.type === 'tree') return o.entries.map((e) => `${e.mode} ${e.name}\0`).join('') + '\0'.repeat(20 * o.entries.length);
    return '';
  }
  function byteLen(s) { return sha1.utf8(s).length; }

  function treeListing(repo, treeHash) {
    const t = repo.get(treeHash);
    return t && t.type === 'tree' ? t.entries : [];
  }
  function modeStr(m) { return m === '40000' ? '040000' : m; }

  COMMANDS['rev-parse'] = function (ctx, args) {
    const repo = ctx.repo;
    const p = parseArgs(args, {
      flags: { '--show-toplevel': 'top', '--git-dir': 'gitdir', '--absolute-git-dir': 'absgit', '--is-inside-work-tree': 'inside', '--is-bare-repository': 'bare', '--abbrev-ref': 'abbrevRef', '--verify': 'verify', '-q': 'quiet', '--quiet': 'quiet', '--symbolic-full-name': 'symFull', '--show-prefix': 'prefix', '--show-cdup': 'cdup', '--git-common-dir': 'common', '--is-inside-git-dir': 'insideGit', '--symbolic': 'symbolic', '--revs-only': 'revsOnly', '--no-flags': 'noFlags' },
      optional: { '--short': 'short' },
    }, 'rev-parse');
    if (!repo && !p.f.insideGit) throw die('not a git repository (or any of the parent directories): .git');
    let out = '';
    if (p.f.top) out += worktreePath(ctx, repo) + '\n';
    if (p.f.gitdir) out += '.git\n';
    if (p.f.common) out += '.git\n';
    if (p.f.absgit) out += worktreePath(ctx, repo) + '/.git\n';
    if (p.f.inside) out += (repo.bare ? 'false' : 'true') + '\n';
    if (p.f.bare) out += (repo.bare ? 'true' : 'false') + '\n';
    if (p.f.prefix) out += '\n';
    if (p.f.cdup) out += '\n';
    if (p.f.insideGit) out += 'false\n';
    const shortLen = p.o.short ? (parseInt(p.o.short[0], 10) || 7) : null;
    p.rest.forEach((spec) => {
      let h = repo.resolve(spec);
      if (!h) {
        if (p.f.verify) throw die('Needed a single revision', 128);
        ctx.print(out + spec + '\n'); out = '';
        throw die(`ambiguous argument '${spec}': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]'`);
      }
      if (p.f.abbrevRef) {
        if (spec === 'HEAD' || spec === '@') out += (repo.head.ref ? repo.currentBranch() : 'HEAD') + '\n';
        else if (/@\{(u|upstream)\}$/.test(spec)) {
          const b = spec.replace(/@\{.*\}$/, '') || repo.currentBranch();
          out += (repo.upstreamName(b) || '') + '\n';
        } else {
          const refs = ['refs/heads/' + spec, 'refs/tags/' + spec, 'refs/remotes/' + spec];
          out += (refs.some((r) => repo.refs.has(r)) ? spec : h) + '\n';
        }
        return;
      }
      if (p.f.symFull) {
        const full = ['refs/' + spec, 'refs/heads/' + spec, 'refs/tags/' + spec, 'refs/remotes/' + spec].find((r) => repo.refs.has(r));
        if (spec === 'HEAD' && repo.head.ref) out += repo.head.ref + '\n'; else if (full) out += full + '\n';
        return;
      }
      if (shortLen !== null) { out += repo.shortHash(h, shortLen) + '\n'; return; }
      out += h + '\n';
    });
    if (p.f.verify && !p.rest.length) throw die('Needed a single revision', 128);
    ctx.print(out);
  };

  COMMANDS['cat-file'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '-t': 't', '-p': 'p', '-s': 's', '-e': 'e' } }, 'cat-file');
    let spec, kind = null;
    if (p.f.t || p.f.p || p.f.s || p.f.e) spec = p.rest[0];
    else { kind = p.rest[0]; spec = p.rest[1]; }
    if (!spec) throw fail('usage: git cat-file (-t | -s | -e | -p | <type> | --textconv | --filters) [--path=<path>] <object>', 129);
    const h = repo.resolve(spec);
    const o = h && repo.get(h);
    if (!o) throw die(`Not a valid object name ${spec}`);
    if (p.f.e) return;
    if (p.f.t) { ctx.print(o.type + '\n'); return; }
    if (p.f.s) { ctx.print((o.type === 'tree' ? o.entries.reduce((a, e) => a + `${e.mode} ${e.name}\0`.length + 20, 0) : byteLen(serializeObject(repo, h))) + '\n'); return; }
    if (p.f.p || kind) {
      if (o.type === 'tree') { ctx.print(o.entries.map((e) => `${modeStr(e.mode)} ${e.mode === '40000' ? 'tree' : 'blob'} ${e.hash}\t${e.name}`).join('\n') + '\n'); return; }
      ctx.print(serializeObject(repo, h));
    }
  };

  function resolveTreeish(repo, spec) {
    const h = repo.resolve(spec);
    if (!h) return null;
    const o = repo.get(h);
    if (!o) return null;
    if (o.type === 'tree') return h;
    const c = repo.peelToCommit(h);
    return c ? repo.commitObj(c).tree : null;
  }

  COMMANDS['ls-tree'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '-r': 'r', '-t': 't', '-d': 'd', '--name-only': 'nameOnly', '--name-status': 'nameOnly', '-l': 'long', '--long': 'long', '--full-name': 'full' } }, 'ls-tree');
    const spec = p.rest[0];
    if (!spec) throw fail('usage: git ls-tree [<options>] <tree-ish> [<path>...]', 129);
    const tree = resolveTreeish(repo, spec);
    if (!tree) throw die(`Not a valid object name ${spec}`);
    const filt = p.rest.slice(1).concat(p.dd).map((s) => s.replace(/\/$/, ''));
    const lines = [];
    const walk = (th, prefix) => {
      treeListing(repo, th).forEach((e) => {
        const path = prefix + e.name;
        const isTree = e.mode === '40000';
        if (filt.length && !filt.some((f2) => path === f2 || path.startsWith(f2 + '/') || f2.startsWith(path + '/'))) return;
        const show = () => {
          const size = p.f.long ? (isTree ? '       -' : String(byteLen(repo.blobContent(e.hash))).padStart(8)) + '\t' : '\t';
          if (p.f.nameOnly) lines.push(path);
          else lines.push(`${modeStr(e.mode)} ${isTree ? 'tree' : 'blob'} ${e.hash}${p.f.long ? ' ' : ''}${size}${path}`.replace(/\t\t/, '\t'));
        };
        if (isTree) {
          if (p.f.r) { if (p.f.t || p.f.d) show(); walk(e.hash, path + '/'); } else if (!filt.length || filt.some((f2) => path === f2 || f2.startsWith(path + '/') ? false : true) || true) {
            if (filt.length && filt.some((f2) => f2.startsWith(path + '/'))) walk(e.hash, path + '/'); else show();
          }
        } else if (!p.f.d) show();
      });
    };
    walk(tree, '');
    ctx.print(lines.length ? lines.join('\n') + '\n' : '');
  };

  COMMANDS['ls-files'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '-s': 'stage', '--stage': 'stage', '-u': 'unmerged', '--unmerged': 'unmerged', '-m': 'modified', '--modified': 'modified', '-o': 'others', '--others': 'others', '-d': 'deleted', '--deleted': 'deleted', '-c': 'cached', '--cached': 'cached', '--exclude-standard': 'exstd', '-i': 'ignored', '--ignored': 'ignored', '--error-unmatch': 'errUnmatch', '-z': 'z', '--full-name': 'full' } }, 'ls-files');
    const specs = p.rest.concat(p.dd);
    const matcher = specs.length ? pathspecMatcher(specs) : () => true;
    const lines = [];
    const showCached = p.f.cached || (!p.f.modified && !p.f.others && !p.f.deleted && !p.f.unmerged && !p.f.ignored) || p.f.stage;
    const rules = repo.ignoreRules();
    if (p.f.unmerged) {
      Array.from(repo.unmerged.keys()).sort().forEach((pth) => {
        if (!matcher(pth)) return;
        const st = repo.unmerged.get(pth);
        [1, 2, 3].forEach((s) => { if (st[s]) lines.push(`${st[s].mode} ${st[s].hash} ${s}\t${pth}`); });
      });
    } else if (showCached) {
      const all = new Set(repo.index.keys());
      repo.unmerged.forEach((_, k) => all.add(k));
      Array.from(all).sort().forEach((pth) => {
        if (!matcher(pth)) return;
        if (repo.unmerged.has(pth)) {
          const st = repo.unmerged.get(pth);
          if (p.f.stage) [1, 2, 3].forEach((s) => { if (st[s]) lines.push(`${st[s].mode} ${st[s].hash} ${s}\t${pth}`); });
          else lines.push(pth);
          return;
        }
        const e = repo.index.get(pth);
        lines.push(p.f.stage ? `${e.mode} ${e.hash} 0\t${pth}` : pth);
      });
    }
    if (p.f.modified || p.f.deleted) {
      Array.from(repo.index.keys()).sort().forEach((pth) => {
        if (!matcher(pth)) return;
        const w = repo.work.get(pth);
        if (w === undefined) { if (p.f.deleted || p.f.modified) lines.push(pth); return; }
        if (p.f.modified && sha1.hashObject('blob', w) !== repo.index.get(pth).hash) lines.push(pth);
      });
    }
    if (p.f.others) {
      Array.from(repo.work.keys()).filter((pth) => !repo.index.has(pth) && !repo.unmerged.has(pth)).sort().forEach((pth) => {
        if (!matcher(pth)) return;
        if (p.f.exstd && repo.isIgnored(pth, rules)) return;
        lines.push(pth);
      });
    }
    if (p.f.ignored && p.f.others) { /* -o -i */ }
    if (p.f.errUnmatch) {
      const tracked = new Set(repo.index.keys());
      specs.forEach((s) => { if (!Array.from(tracked).some((t) => pathspecMatcher([s])(t))) throw fail(`error: pathspec '${s}' did not match any file(s) known to git\nDid you forget to 'git add'?`, 1); });
    }
    ctx.print(lines.length ? lines.join('\n') + '\n' : '');
  };

  COMMANDS['show-ref'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '--heads': 'heads', '--tags': 'tags', '--verify': 'verify', '-s': 'hash', '--hash': 'hash', '--head': 'head', '-d': 'deref', '--dereference': 'deref', '-q': 'quiet', '--quiet': 'quiet', '--exists': 'exists' } }, 'show-ref');
    let list = repo.listRefs('refs/');
    if (p.f.heads) list = list.filter(([n]) => n.startsWith('refs/heads/'));
    if (p.f.tags) list = list.filter(([n]) => n.startsWith('refs/tags/'));
    if (p.f.verify) {
      const want = p.rest[0];
      const hit = list.find(([n]) => n === want);
      if (!hit) { if (p.f.quiet) throw fail('', 1); throw die(`'${want}' - not a valid ref`); }
      if (!p.f.quiet) ctx.print(`${p.f.hash ? '' : hit[1] + ' '}${p.f.hash ? hit[1] : hit[0]}\n`);
      return;
    }
    if (p.rest.length) list = list.filter(([n]) => p.rest.some((pt) => n === pt || n.endsWith('/' + pt)));
    let out = '';
    if (p.f.head && repo.headCommit()) out += `${repo.headCommit()} HEAD\n`;
    list.forEach(([n, h]) => {
      out += p.f.hash ? h + '\n' : `${h} ${n}\n`;
      if (p.f.deref) { const o = repo.get(h); if (o && o.type === 'tag') out += `${repo.peelAny(h)} ${n}^{}\n`; }
    });
    if (!list.length && !out) throw fail('', 1);
    if (!p.f.quiet) ctx.print(out);
  };

  COMMANDS['for-each-ref'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: {}, opts: { '--format': 'format', '--sort': 'sort', '--count': 'count', '--points-at': 'pointsAt', '--contains': 'contains' } }, 'for-each-ref');
    let list = repo.listRefs('refs/');
    if (p.rest.length) list = list.filter(([n]) => p.rest.some((pt) => n === pt || n.startsWith(pt.replace(/\/?$/, '/')) || globMatch(pt, n)));
    if (p.o.contains) { const h = repo.resolveCommit(p.o.contains[0]); list = list.filter(([, th]) => repo.isAncestor(h, repo.peelToCommit(th) || th)); }
    if (p.o.pointsAt) { const h = repo.resolve(p.o.pointsAt[0]); list = list.filter(([, th]) => th === h || repo.peelToCommit(th) === h); }
    if (p.o.sort) list = sortRefs(ctx, repo, list, p.o.sort);
    if (p.o.count) list = list.slice(0, parseInt(p.o.count[0], 10));
    const fmt = p.o.format ? p.o.format[0] : '%(objectname) %(objecttype)\t%(refname)';
    ctx.print(list.map(([n, h]) => refFormat(ctx, repo, fmt, n, h)).join('\n') + (list.length ? '\n' : ''));
  };

  COMMANDS['merge-base'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '--is-ancestor': 'isAnc', '--all': 'all', '-a': 'all', '--octopus': 'octopus', '--fork-point': 'fork' } }, 'merge-base');
    const [a, b] = p.rest;
    if (!a || !b) throw fail('usage: git merge-base [-a | --all] <commit> <commit>...', 129);
    const ha = repo.resolveCommit(a), hb = repo.resolveCommit(b);
    if (!ha) throw die(`Not a valid object name ${a}`);
    if (!hb) throw die(`Not a valid object name ${b}`);
    if (p.f.isAnc) { if (!repo.isAncestor(ha, hb)) throw fail('', 1); return; }
    const bases = repo.mergeBases(ha, hb);
    if (!bases.length) throw fail('', 1);
    ctx.print((p.f.all ? bases : [bases[0]]).join('\n') + '\n');
  };

  COMMANDS['symbolic-ref'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '--short': 'short', '-q': 'quiet', '--quiet': 'quiet' }, opts: { '-m': 'msg' } }, 'symbolic-ref');
    const name = p.rest[0] || 'HEAD';
    if (p.rest.length > 1 && name === 'HEAD') {
      repo.head = { ref: p.rest[1] };
      return;
    }
    if (name !== 'HEAD') {
      const t = repo.symrefs && repo.symrefs.get(name);
      if (!t) throw die(`ref ${name} is not a symbolic ref`);
      ctx.print((p.f.short ? t.replace(/^refs\/(heads|remotes)\//, '') : t) + '\n');
      return;
    }
    if (!repo.head.ref) { if (p.f.quiet) throw fail('', 1); throw die('ref HEAD is not a symbolic ref'); }
    ctx.print((p.f.short ? repo.currentBranch() : repo.head.ref) + '\n');
  };

  COMMANDS['update-ref'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '-d': 'del', '--no-deref': 'nodef' }, opts: { '-m': 'msg' } }, 'update-ref');
    const [name, val] = p.rest;
    if (!name) throw fail('usage: git update-ref [<options>] -d <refname> [<old-oid>]\n   or: git update-ref [<options>]    <refname> <new-oid> [<old-oid>]', 129);
    if (p.f.del) { repo.deleteRef(name); repo.reflogs.delete(name); return; }
    const h = repo.resolve(val);
    if (!h) throw die(`${val}: not a valid SHA1`);
    const ident = identOf(ctx);
    if (name === 'HEAD') { if (repo.head.ref) repo.updateRef(repo.head.ref, h, (p.o.msg && p.o.msg[0]) || '', ident); else repo.moveDetachedHead(h, (p.o.msg && p.o.msg[0]) || '', ident); return; }
    repo.updateRef(name, h, (p.o.msg && p.o.msg[0]) || '', ident);
  };

  COMMANDS['write-tree'] = function (ctx) {
    const repo = C.requireRepo(ctx);
    ctx.print(C.writeTreeFromIndex(ctx, repo) + '\n');
  };

  COMMANDS['hash-object'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '-w': 'write', '--stdin': 'stdin' }, opts: { '-t': 'type' } }, 'hash-object');
    const file = p.rest[0];
    const content = file ? repo.work.get(file) : '';
    if (content === undefined) throw die(`could not open '${file}' for reading: No such file or directory`);
    const type = p.o.type ? p.o.type[0] : 'blob';
    const h = sha1.hashObject(type, content);
    if (p.f.write && type === 'blob') repo.putBlob(content);
    ctx.print(h + '\n');
  };

  COMMANDS['commit-tree'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: {}, opts: { '-p': 'parent', '-m': 'message' } }, 'commit-tree');
    const tree = resolveTreeish(repo, p.rest[0]);
    if (!tree) throw die(`Not a valid object name ${p.rest[0]}`);
    const parents = (p.o.parent || []).map((x) => repo.resolveCommit(x));
    const ident = identOf(ctx);
    const h = repo.putCommit({ tree, parents, author: ident, committer: ident, message: (p.o.message ? p.o.message.join('\n\n') : '') + '\n' });
    ctx.print(h + '\n');
  };

  COMMANDS['count-objects'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const v = args.includes('-v');
    const n = repo.objects.size;
    if (v) ctx.print(`count: ${n}\nsize: ${Math.max(1, Math.ceil(n / 4))}\nin-pack: 0\npacks: 0\nsize-pack: 0\nprune-packable: 0\ngarbage: 0\nsize-garbage: 0\n`);
    else ctx.print(`${n} objects, ${Math.max(1, Math.ceil(n / 4))} kilobytes\n`);
  };

  COMMANDS.gc = function (ctx) { C.requireRepo(ctx); };
  COMMANDS.prune = function (ctx) { C.requireRepo(ctx); };
  COMMANDS.repack = function (ctx) { C.requireRepo(ctx); };

  COMMANDS['name-rev'] = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '--name-only': 'nameOnly', '--tags': 'tags' } }, 'name-rev');
    const out = p.rest.map((spec) => {
      const h = repo.resolveCommit(spec);
      if (!h) throw die(`Could not get sha1 for ${spec}. Skipping.`);
      let name = 'undefined';
      const exactTag = repo.listRefs('refs/tags/').find(([, th]) => repo.peelToCommit(th) === h);
      if (exactTag) {
        const annotated = repo.get(exactTag[1]).type === 'tag';
        return p.f.nameOnly ? `${exactTag[0].slice(5)}${annotated ? '^0' : ''}` : `${spec} ${exactTag[0].slice(5)}${annotated ? '^0' : ''}`;
      }
      const heads = repo.listRefs(p.f.tags ? 'refs/tags/' : 'refs/').filter(([n]) => !p.f.tags ? /^refs\/(heads|tags)\//.test(n) : true);
      let best = null;
      heads.forEach(([n, th]) => {
        const tip = repo.peelToCommit(th);
        // 첫 부모를 따라가며 거리 계산
        let cur = tip; let d = 0;
        while (cur) { if (cur === h) { if (!best || d < best.d) best = { n: n.replace(/^refs\/(heads|tags)\//, (m, k) => (k === 'tags' ? 'tags/' : '')), d, tag: n.startsWith('refs/tags/') }; break; } cur = repo.parents(cur)[0]; d++; }
      });
      if (best) name = best.d ? `${best.n}~${best.d}` : best.n;
      return p.f.nameOnly ? name : `${spec} ${name}`;
    });
    ctx.print(out.join('\n') + '\n');
  };

  COMMANDS.fsck = function (ctx, args) {
    const repo = C.requireRepo(ctx);
    const p = parseArgs(args, { flags: { '--lost-found': 'lost', '--unreachable': 'unreachable', '--no-reflogs': 'noReflogs', '--full': 'full', '--no-dangling': 'noDangling', '--root': 'root', '--strict': 'strict' } }, 'fsck');
    // 도달 가능 집합: ref, HEAD, 인덱스
    const reach = new Set();
    const mark = (h) => {
      if (!h || reach.has(h)) return;
      const o = repo.get(h);
      if (!o) return;
      reach.add(h);
      if (o.type === 'commit') { mark(o.tree); o.parents.forEach(mark); } else if (o.type === 'tree') o.entries.forEach((e) => mark(e.hash)); else if (o.type === 'tag') mark(o.object);
    };
    repo.refs.forEach((h) => mark(h));
    if (repo.headCommit()) mark(repo.headCommit());
    repo.index.forEach((e) => mark(e.hash));
    repo.unmerged.forEach((st) => [1, 2, 3].forEach((s) => { if (st[s]) mark(st[s].hash); }));
    if (!p.f.noReflogs) { /* reflog 는 dangling 판정에 영향을 주지 않는다 (실제 git 과 동일) */ }
    // 다른 오브젝트가 참조하는 것
    const used = new Set();
    repo.objects.forEach((o) => {
      if (o.type === 'commit') { used.add(o.tree); o.parents.forEach((x) => used.add(x)); } else if (o.type === 'tree') o.entries.forEach((e) => used.add(e.hash)); else if (o.type === 'tag') used.add(o.object);
    });
    const lines = [];
    Array.from(repo.objects.keys()).sort().forEach((h) => {
      if (reach.has(h)) return;
      const o = repo.get(h);
      const dangling = !used.has(h);
      if (dangling && !p.f.noDangling) lines.push(`dangling ${o.type} ${h}`);
      else if (!dangling && p.f.unreachable) lines.push(`unreachable ${o.type} ${h}`);
    });
    ctx.print(lines.length ? lines.join('\n') + '\n' : '');
  };

  G.refs = Object.assign(G.refs || {}, { resolveTreeish, serializeObject });
})();
