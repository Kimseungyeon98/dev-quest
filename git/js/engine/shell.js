/* 가상 머신(Sim) + 셸: 홈 디렉터리, 작업 폴더, 파일 명령어, 파이프/리다이렉션, 팀원 세션 */
(function () {
  'use strict';
  const G = (globalThis.GitEngine = globalThis.GitEngine || {});
  const { Repo, GitError } = G;
  const U = G.util;

  class Dir {
    constructor(name) {
      this.name = name;
      this.files = new Map();
      this.dirs = new Set();
      this.repo = null;
    }
  }

  /* ---------------- 토크나이저 ---------------- */
  function tokenize(line) {
    const tokens = [];
    let cur = '';
    let quoted = false;
    let has = false;
    const push = () => { if (has) tokens.push({ text: cur, quoted }); cur = ''; quoted = false; has = false; };
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        has = true; quoted = true;
        i++;
        while (i < line.length && line[i] !== '"') {
          if (line[i] === '\\' && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) { cur += line[i + 1]; i += 2; continue; }
          cur += line[i]; i++;
        }
        if (i >= line.length) return { error: "unexpected EOF while looking for matching `\"'" };
        continue;
      }
      if (ch === "'") {
        has = true; quoted = true;
        i++;
        while (i < line.length && line[i] !== "'") { cur += line[i]; i++; }
        if (i >= line.length) return { error: "unexpected EOF while looking for matching `''" };
        continue;
      }
      if (ch === '\\' && i + 1 < line.length) { has = true; cur += line[i + 1]; i++; quoted = true; continue; }
      if (ch === ' ' || ch === '\t') { push(); continue; }
      if (ch === '#' && !has) break;
      if (ch === '&' && line[i + 1] === '&') { push(); tokens.push({ op: '&&' }); i++; continue; }
      if (ch === '|' && line[i + 1] === '|') { push(); tokens.push({ op: '||' }); i++; continue; }
      if (ch === '|') { push(); tokens.push({ op: '|' }); continue; }
      if (ch === ';') { push(); tokens.push({ op: ';' }); continue; }
      if (ch === '>' ) {
        // 2>&1 / 2> 처리
        if (!has && cur === '' && tokens.length && false) { /* no-op */ }
        push();
        if (line[i + 1] === '>') { tokens.push({ op: '>>' }); i++; } else tokens.push({ op: '>' });
        continue;
      }
      if (ch === '2' && line[i + 1] === '>' && !has) {
        if (line.slice(i, i + 4) === '2>&1') { tokens.push({ op: '2>&1' }); i += 3; continue; }
        push();
        tokens.push({ op: '2>' }); i++;
        continue;
      }
      has = true;
      cur += ch;
    }
    push();
    return { tokens };
  }

  function globToRe(g) {
    let re = '^';
    for (let i = 0; i < g.length; i++) {
      const c = g[i];
      if (c === '*') re += '[^/]*';
      else if (c === '?') re += '[^/]';
      else if (c === '[') { const j = g.indexOf(']', i); if (j < 0) re += '\\['; else { re += g.slice(i, j + 1).replace('[!', '[^'); i = j; } }
      else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(re + '$');
  }

  /* ---------------- Sim ---------------- */
  class Sim {
    constructor(opts) {
      opts = opts || {};
      this.clock = opts.clock || 1741564800 - 9 * 3600 + 9 * 3600; // 2025-03-10 00:00:00 UTC
      this.tz = opts.tz || '+0900';
      this.color = !!opts.color;
      this.tty = opts.tty !== false;
      this.username = opts.username || 'dev';
      this.hostname = opts.hostname || 'laptop';
      this.homePath = opts.homePath || '/home/dev';
      this.globalConfig = new Map();
      this.net = new Map();
      this.home = new Map();
      this.cwd = '~';
      this.inputProvider = null;
      this.actors = new Map();
      this.history = [];
      this.gitVersion = opts.gitVersion || '2.45.1';
      if (opts.defaultBranch) this.globalConfig.set('init.defaultbranch', opts.defaultBranch);
    }

    /* ---- 디렉터리 / 저장소 ---- */
    curDir() { return this.cwd === '~' ? null : this.home.get(this.cwd) || null; }
    dirPath(dir) { return `${this.homePath}/${dir.name}`; }
    mkdirHome(name) {
      if (!this.home.has(name)) this.home.set(name, new Dir(name));
      return this.home.get(name);
    }
    initRepo(target, opts) {
      let dir;
      if (target) {
        if (this.cwd !== '~') throw U.die('시뮬레이터에서는 홈(~)에서만 새 폴더를 만들며 git init <폴더> 를 할 수 있어요');
        dir = this.mkdirHome(target);
      } else {
        dir = this.curDir();
        if (!dir) throw U.die('먼저 폴더를 만들고 들어가세요 (예: mkdir myproject && cd myproject)');
      }
      const reinit = !!dir.repo;
      if (!reinit) {
        const repo = new Repo({ bare: opts.bare, name: dir.name });
        repo.head = { ref: 'refs/heads/' + (opts.branch || 'main') };
        repo.work = dir.files;
        repo.dirs = dir.dirs;
        repo.config.set('core.repositoryformatversion', '0');
        repo.config.set('core.filemode', 'true');
        repo.config.set('core.bare', opts.bare ? 'true' : 'false');
        repo.config.set('core.logallrefupdates', 'true');
        dir.repo = repo;
      }
      return { reinit, path: this.dirPath(dir), dir };
    }
    registerRemote(url, repo) { this.net.set(url, repo); return repo; }
    /* 시나리오용: 빈 원격 저장소(bare)를 만든다 */
    createRemote(url, opts) {
      opts = opts || {};
      const repo = new Repo({ bare: true, name: url });
      repo.head = { ref: 'refs/heads/' + (opts.branch || 'main') };
      repo.config.set('core.bare', 'true');
      if (opts.protectedBranches) repo.protectedBranches = new Set(opts.protectedBranches);
      this.net.set(url, repo);
      return repo;
    }

    /* ---- 세션 ---- */
    userSession() {
      const self = this;
      return {
        kind: 'user', name: 'user', globalConfig: this.globalConfig,
        get dir() { return self.curDir(); },
        get cwdLabel() { return self.cwd; },
      };
    }
    actorSession(name) {
      const a = this.actors.get(name);
      if (!a) throw new Error('unknown actor ' + name);
      return { kind: 'actor', name, globalConfig: a.config, dir: a.dir, cwdLabel: a.dir.name, actor: a };
    }
    addActor(name, identity) {
      const dir = new Dir(name);
      const config = new Map();
      config.set('user.name', identity.name);
      config.set('user.email', identity.email);
      this.actors.set(name, { dir, config, name });
      return this.actors.get(name);
    }
    runAs(name, line) { return this.execWith(this.actorSession(name), line); }

    /* ---- 상태 스냅샷 (대화형 입력 재실행용) ---- */
    allRepos() {
      const list = [];
      this.home.forEach((d) => { if (d.repo) list.push(d.repo); });
      this.net.forEach((r) => list.push(r));
      this.actors.forEach((a) => { if (a.dir.repo) list.push(a.dir.repo); });
      return list;
    }
    snapshot() {
      const clone = (x) => JSON.parse(JSON.stringify(x === undefined ? null : x));
      const repoSnap = (r) => ({
        r, refs: new Map(r.refs), head: Object.assign({}, r.head), reflogs: new Map(Array.from(r.reflogs, ([k, v]) => [k, v.slice()])),
        index: new Map(Array.from(r.index, ([k, v]) => [k, Object.assign({}, v)])), unmerged: new Map(Array.from(r.unmerged, ([k, v]) => [k, Object.assign({}, v)])),
        work: new Map(r.work), dirs: new Set(r.dirs), config: new Map(r.config), state: clone(r.state), special: Object.assign({}, r.special), symrefs: new Map(r.symrefs),
        objSize: r.objects.size, objKeys: null,
      });
      const dirSnap = [];
      this.home.forEach((d) => dirSnap.push({ d, files: new Map(d.files), dirs: new Set(d.dirs) }));
      this.actors.forEach((a) => dirSnap.push({ d: a.dir, files: new Map(a.dir.files), dirs: new Set(a.dir.dirs) }));
      return {
        repos: this.allRepos().map(repoSnap), dirs: dirSnap, clock: this.clock, cwd: this.cwd,
        globalConfig: new Map(this.globalConfig), home: new Map(this.home),
        actorCfg: Array.from(this.actors, ([k, a]) => [k, new Map(a.config)]),
      };
    }
    restore(s) {
      s.repos.forEach((x) => {
        const r = x.r;
        r.refs = x.refs; r.head = x.head; r.reflogs = x.reflogs; r.index = x.index; r.unmerged = x.unmerged;
        r.config = x.config; r.state = x.state || {}; r.special = x.special; r.symrefs = x.symrefs;
      });
      s.dirs.forEach((x) => { x.d.files.clear(); x.files.forEach((v, k) => x.d.files.set(k, v)); x.d.dirs.clear(); x.dirs.forEach((v) => x.d.dirs.add(v)); });
      this.clock = s.clock; this.cwd = s.cwd; this.globalConfig = s.globalConfig; this.home = s.home;
      s.actorCfg.forEach(([k, cfg]) => { const a = this.actors.get(k); if (a) a.config = cfg; });
    }

    /* ---- 실행 ---- */
    exec(line, opts) {
      const snap = this.snapshot();
      try {
        return this.execWith(this.userSession(), line, opts);
      } catch (e) {
        if (e instanceof U.NeedInput) { this.restore(snap); }
        throw e;
      }
    }

    /* git commit --date / -F 같은 곳에서 쓰는 보조 함수 */
    parseDate(s) {
      const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?\s*(Z|[+-]\d{4})?$/);
      if (!m) return null;
      const tz = m[7] && m[7] !== 'Z' ? m[7] : (m[7] === 'Z' ? '+0000' : this.tz);
      const sign = tz[0] === '-' ? -1 : 1;
      const off = sign * (parseInt(tz.slice(1, 3), 10) * 3600 + parseInt(tz.slice(3, 5), 10) * 60);
      const ts = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) / 1000 - off;
      return { ts, tz };
    }
    readFileForGit(ctx, path) {
      const dir = ctx.session && ctx.session.dir;
      const key = this.normPath(path);
      if (!dir || !dir.files.has(key)) throw U.die(`could not read log file '${path}': No such file or directory`);
      return dir.files.get(key);
    }

    /* git 내부에서 셸 한 줄을 돌린다 (rebase --exec, bisect run). 출력은 ctx 로 전달 */
    execInline(ctx, line) {
      const r = this.execWith(ctx.session, line);
      r.out.forEach((o) => ctx.out.push(o));
      return r;
    }

    execWith(session, line, opts) {
      opts = opts || {};
      const parsed = tokenize(line);
      const result = { out: [], code: 0 };
      if (parsed.error) { result.out.push({ s: 'err', t: `bash: ${parsed.error}\n` }); result.code = 2; return finish(result); }
      const toks = parsed.tokens;
      // 명령 시퀀스로 분해
      const seqs = [];
      let cur = { pipeline: [[]], sep: null };
      toks.forEach((t) => {
        if (t.op === '&&' || t.op === '||' || t.op === ';') { seqs.push(cur); cur = { pipeline: [[]], sep: t.op }; }
        else if (t.op === '|') cur.pipeline.push([]);
        else cur.pipeline[cur.pipeline.length - 1].push(t);
      });
      seqs.push(cur);
      let lastCode = 0;
      let skip = false;
      let first = true;
      for (const sq of seqs) {
        if (!first) {
          if (sq.sep === '&&' && lastCode !== 0) { skip = true; } else if (sq.sep === '||' && lastCode === 0) { skip = true; } else skip = false;
        }
        first = false;
        if (skip) continue;
        const r = this.runPipeline(session, sq.pipeline, opts);
        r.out.forEach((o) => result.out.push(o));
        lastCode = r.code;
      }
      result.code = lastCode;
      return finish(result);
      function finish(res) {
        res.stdout = res.out.filter((o) => o.s === 'out').map((o) => o.t).join('');
        res.stderr = res.out.filter((o) => o.s === 'err').map((o) => o.t).join('');
        res.text = res.out.map((o) => o.t).join('');
        return res;
      }
    }

    runPipeline(session, stages, opts) {
      let stdin = null;
      const out = [];
      let code = 0;
      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i];
        const isLast = i === stages.length - 1;
        // 리다이렉션 파싱
        const argvToks = [];
        let redirOut = null, redirErr = null, mergeErr = false;
        for (let k = 0; k < stage.length; k++) {
          const t = stage[k];
          if (t.op === '>' || t.op === '>>') { redirOut = { path: (stage[k + 1] || {}).text, append: t.op === '>>' }; k++; }
          else if (t.op === '2>') { redirErr = { path: (stage[k + 1] || {}).text }; k++; }
          else if (t.op === '2>&1') mergeErr = true;
          else argvToks.push(t);
        }
        if (!argvToks.length) { continue; }
        const piped = !isLast || !!redirOut;
        const r = this.runCommand(session, argvToks, stdin, { noColor: piped, tty: !piped });
        code = r.code;
        let outText = r.stdout;
        if (mergeErr) outText += r.stderr;
        // 파이프 진행: 다음 단계 stdin
        if (!isLast) {
          stdin = outText;
          if (!mergeErr) r.errOut.forEach((o) => out.push(o));
          continue;
        }
        if (redirOut) {
          const dir = session.dir;
          if (!dir) { out.push({ s: 'err', t: 'bash: 홈(~)에서는 파일을 만들 수 없어요. 폴더로 이동하세요\n' }); code = 1; }
          else {
            const err = this.writeFile(dir, redirOut.path, outText, redirOut.append);
            if (err) { out.push({ s: 'err', t: err }); code = 1; }
          }
          if (!mergeErr) r.errOut.forEach((o) => out.push(o));
        } else if (mergeErr) {
          r.out.forEach((o) => out.push({ s: 'out', t: o.t }));
        } else {
          r.out.forEach((o) => out.push(o));
        }
        if (redirErr && redirErr.path === '/dev/null') {
          for (let q = out.length - 1; q >= 0; q--) if (out[q].s === 'err') out.splice(q, 1);
        }
      }
      return { out, code };
    }

    expandArgs(session, toks) {
      const dir = session.dir;
      const res = [];
      toks.forEach((t) => {
        if (!t.quoted && /[*?[]/.test(t.text) && dir) {
          const re = globToRe(t.text);
          const names = new Set();
          dir.files.forEach((_, p) => {
            // 최상위 이름 또는 경로 전체 매칭
            if (re.test(p)) names.add(p);
            const top = p.split('/')[0];
            if (!t.text.includes('/') && re.test(top) && p.includes('/')) names.add(top);
          });
          if (names.size) { Array.from(names).sort().forEach((n) => res.push(n)); return; }
        }
        res.push(t.text);
      });
      return res;
    }

    runCommand(session, toks, stdin, flags) {
      const argv = this.expandArgs(session, toks);
      const name = argv[0];
      const args = argv.slice(1);
      const out = [];
      let code = 0;
      const emit = (s, t) => { if (t) out.push({ s, t }); };
      const sim = this;
      try {
        // alias 는 git 내부에서 처리. 셸 alias 는 지원하지 않음
        if (name === 'git') {
          const repo = session.dir ? session.dir.repo : null;
          const ctx = new U.Ctx(sim, repo, { noColor: flags.noColor, actor: session.actor, session });
          ctx.session = session;
          ctx.stdin = stdin;
          ctx.homeDir = session.dir;
          try {
            G.runGit(ctx, args);
          } catch (e) {
            if (e instanceof GitError) {
              ctx.out.forEach((o) => out.push(o));
              ctx.out = [];
              if (e.gitMessage) emit('err', e.gitMessage.endsWith('\n') ? e.gitMessage : e.gitMessage + '\n');
              code = e.code;
            } else throw e;
          }
          ctx.out.forEach((o) => out.push(o));
        } else {
          const r = this.builtin(session, name, args, stdin, flags);
          r.out.forEach((o) => out.push(o));
          code = r.code;
        }
      } catch (e) {
        if (e instanceof U.NeedInput) throw e;
        throw e;
      }
      return {
        out, code,
        stdout: out.filter((o) => o.s === 'out').map((o) => o.t).join(''),
        stderr: out.filter((o) => o.s === 'err').map((o) => o.t).join(''),
        errOut: out.filter((o) => o.s === 'err'),
      };
    }

    /* ---------------- 파일 시스템 헬퍼 ---------------- */
    normPath(p) {
      const parts = [];
      p.replace(/^\.\//, '').split('/').forEach((seg) => {
        if (seg === '' || seg === '.') return;
        if (seg === '..') parts.pop(); else parts.push(seg);
      });
      return parts.join('/');
    }
    dirExists(dir, path) {
      if (path === '' || path === '.') return true;
      if (dir.dirs.has(path)) return true;
      for (const k of dir.files.keys()) if (k.startsWith(path + '/')) return true;
      return false;
    }
    writeFile(dir, rawPath, text, append) {
      const path = this.normPath(rawPath);
      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      if (parent && !this.dirExists(dir, parent)) return `bash: ${rawPath}: No such file or directory\n`;
      if (this.dirExists(dir, path) && !dir.files.has(path)) return `bash: ${rawPath}: Is a directory\n`;
      if (append && dir.files.has(path)) dir.files.set(path, dir.files.get(path) + text);
      else dir.files.set(path, text);
      return '';
    }

    builtin(session, name, args, stdin, flags) {
      const out = [];
      const emit = (s, t) => { if (t) out.push({ s, t }); };
      let code = 0;
      const dir = session.dir;
      const needDir = () => {
        if (!dir) { emit('err', `bash: ${name}: 홈(~)에서는 사용할 수 없어요. 먼저 폴더로 이동하세요 (cd 폴더이름)\n`); code = 1; return false; }
        return true;
      };
      switch (name) {
        case 'echo': {
          let nl = true, interp = false;
          const a = args.slice();
          while (a.length && /^-[neE]+$/.test(a[0])) { if (a[0].includes('n')) nl = false; if (a[0].includes('e')) interp = true; a.shift(); }
          let text = a.join(' ');
          if (interp) text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
          emit('out', text + (nl ? '\n' : ''));
          break;
        }
        case 'printf': {
          const fmt = args[0] || '';
          let i = 1;
          let text = fmt.replace(/%s/g, () => (args[i++] || '')).replace(/\\n/g, '\n').replace(/\\t/g, '\t');
          emit('out', text);
          break;
        }
        case 'pwd': emit('out', (session.cwdLabel === '~' ? this.homePath : `${this.homePath}/${session.cwdLabel}`) + '\n'); break;
        case 'clear': emit('out', '\x1b[clear]'); break;
        case 'true': break;
        case 'false': code = 1; break;
        case 'whoami': emit('out', this.username + '\n'); break;
        case 'date': emit('out', U.formatDate(this.clock, this.tz, 'default', this.clock) + '\n'); break;
        case 'hostname': emit('out', this.hostname + '\n'); break;
        case 'sleep': break;
        case 'exit': emit('out', '(이 웹 터미널은 닫을 수 없어요)\n'); break;
        case 'cd': {
          const target = args[0] || '~';
          if (session.kind === 'actor') { emit('err', 'bash: cd: 사용할 수 없습니다\n'); code = 1; break; }
          if (target === '~' || target === '..' && this.cwd !== '~' || target === '/' || target === '~/') { this.cwd = '~'; break; }
          const t = target.replace(/^~\//, '').replace(/^\.\//, '').replace(/\/$/, '');
          if (this.cwd === '~' && this.home.has(t)) { this.cwd = t; break; }
          if (this.cwd !== '~' && t === '.') break;
          if (this.cwd !== '~' && dir && this.dirExists(dir, this.normPath(t))) {
            emit('err', `bash: cd: ${target}: 이 시뮬레이터는 저장소 최상위 폴더에서만 작업해요 (하위 폴더로 이동하지 않고 경로로 접근하세요: 예 ${t}/파일)\n`);
            code = 1; break;
          }
          emit('err', `bash: cd: ${target}: No such file or directory\n`);
          code = 1;
          break;
        }
        case 'ls': {
          const flagsL = args.filter((a) => a.startsWith('-')).join('');
          const paths = args.filter((a) => !a.startsWith('-'));
          const showAll = flagsL.includes('a');
          const long = flagsL.includes('l');
          let entries;
          if (!dir) {
            entries = Array.from(this.home.keys()).sort().map((n) => ({ name: n, isDir: true }));
          } else {
            const base = paths[0] ? this.normPath(paths[0]) : '';
            if (base && !this.dirExists(dir, base)) {
              if (dir.files.has(base)) { emit('out', base + '\n'); break; }
              emit('err', `ls: cannot access '${paths[0]}': No such file or directory\n`); code = 2; break;
            }
            const set = new Map();
            dir.files.forEach((_, p) => {
              if (base && !p.startsWith(base + '/')) return;
              const rel = base ? p.slice(base.length + 1) : p;
              const first = rel.split('/')[0];
              set.set(first, rel.includes('/'));
            });
            dir.dirs.forEach((d) => {
              if (base && !d.startsWith(base + '/')) return;
              const rel = base ? d.slice(base.length + 1) : d;
              if (rel && !set.has(rel.split('/')[0])) set.set(rel.split('/')[0], true);
            });
            entries = Array.from(set, ([n, d]) => ({ name: n, isDir: d })).filter((e) => showAll || !e.name.startsWith('.'));
            if (showAll && !base && dir.repo && !dir.repo.bare) entries.push({ name: '.git', isDir: true });
            entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
            if (showAll) entries = [{ name: '.', isDir: true }, { name: '..', isDir: true }].concat(entries);
          }
          if (long) {
            const lines = entries.map((e) => {
              const size = dir && !e.isDir ? U.contentOf({ blobContent: () => '' }, { content: dir.files.get(e.name) || '' }).length : 4096;
              return `${e.isDir ? 'drwxr-xr-x' : '-rw-r--r--'} 1 ${this.username} ${this.username} ${String(size).padStart(5)} Mar 10 09:00 ${e.name}${e.isDir ? '/' : ''}`;
            });
            emit('out', `total ${entries.length}\n` + lines.join('\n') + (lines.length ? '\n' : ''));
          } else if (entries.length) {
            if (flags.tty && session.kind === 'user') {
              emit('out', entries.map((e) => (e.isDir ? `\x1b[1;34m${e.name}\x1b[m` : e.name)).join('  ') + '\n');
            } else emit('out', entries.map((e) => e.name).join('\n') + '\n');
          }
          break;
        }
        case 'cat': {
          if (!args.length && stdin !== null) { emit('out', stdin); break; }
          if (!needDir()) break;
          args.forEach((a) => {
            const p = this.normPath(a);
            if (dir.files.has(p)) emit('out', dir.files.get(p));
            else if (this.dirExists(dir, p)) { emit('err', `cat: ${a}: Is a directory\n`); code = 1; }
            else { emit('err', `cat: ${a}: No such file or directory\n`); code = 1; }
          });
          break;
        }
        case 'head': case 'tail': {
          let n = 10;
          const rest = [];
          for (let i = 0; i < args.length; i++) {
            if (args[i] === '-n') { n = parseInt(args[++i], 10); } else if (/^-\d+$/.test(args[i])) n = parseInt(args[i].slice(1), 10); else rest.push(args[i]);
          }
          let text = stdin;
          if (rest.length) {
            if (!needDir()) break;
            const p = this.normPath(rest[0]);
            if (!dir.files.has(p)) { emit('err', `${name}: cannot open '${rest[0]}' for reading: No such file or directory\n`); code = 1; break; }
            text = dir.files.get(p);
          }
          const lines = (text || '').split('\n');
          if (lines[lines.length - 1] === '') lines.pop();
          emit('out', (name === 'head' ? lines.slice(0, n) : lines.slice(-n)).join('\n') + (lines.length ? '\n' : ''));
          break;
        }
        case 'wc': {
          const text = args.filter((a) => !a.startsWith('-')).length ? (dir && dir.files.get(this.normPath(args.filter((a) => !a.startsWith('-'))[0])) || '') : (stdin || '');
          const n = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
          emit('out', args.includes('-l') ? `${n}\n` : `${n}\n`);
          break;
        }
        case 'grep': {
          const flagsG = args.filter((a) => a.startsWith('-')).join('');
          const rest = args.filter((a) => !a.startsWith('-'));
          const pat = rest[0];
          let text = stdin;
          if (rest.length > 1) {
            if (!needDir()) break;
            const p = this.normPath(rest[1]);
            if (!dir.files.has(p)) { emit('err', `grep: ${rest[1]}: No such file or directory\n`); code = 2; break; }
            text = dir.files.get(p);
          }
          const re = new RegExp(pat, flagsG.includes('i') ? 'i' : '');
          const lines = (text || '').split('\n').filter((l, i, arr) => !(i === arr.length - 1 && l === ''));
          const m = lines.filter((l) => (flagsG.includes('v') ? !re.test(l) : re.test(l)));
          emit('out', flagsG.includes('c') ? `${m.length}\n` : m.join('\n') + (m.length ? '\n' : ''));
          if (!m.length) code = 1;
          break;
        }
        case 'true': break;
        case 'false': code = 1; break;
        case 'exit': code = parseInt(args[0] || '0', 10) || 0; break;
        case 'sh': case 'bash': {
          const ci = args.indexOf('-c');
          if (ci < 0 || !args[ci + 1]) { emit('err', `${name}: 시뮬레이터에서는 -c "명령" 형태만 지원해요\n`); code = 2; break; }
          const r = this.execWith(session, args[ci + 1]);
          r.out.forEach((o) => out.push(o));
          code = r.code;
          break;
        }
        case 'test': case '[': {
          let a = args.slice();
          if (name === '[' && a[a.length - 1] === ']') a.pop();
          let neg = false;
          if (a[0] === '!') { neg = true; a = a.slice(1); }
          let ok;
          const d = session.dir;
          const has = (f) => !!d && d.files.has(this.normPath(f));
          if (a[0] === '-f' || a[0] === '-e') ok = has(a[1]);
          else if (a[0] === '-d') ok = !!d && this.dirExists(d, this.normPath(a[1]));
          else if (a[0] === '-s') ok = has(a[1]) && d.files.get(this.normPath(a[1])).length > 0;
          else if (a[1] === '=' || a[1] === '==') ok = a[0] === a[2];
          else if (a[1] === '!=') ok = a[0] !== a[2];
          else if (a[0] === '-z') ok = !a[1];
          else if (a[0] === '-n') ok = !!a[1];
          else ok = !!a[0];
          code = (ok !== neg) ? 0 : 1;
          break;
        }
        case 'sed': {
          // sed [-i] 's/a/b/[g]' file  /  sed [-i] '/pat/d' file
          if (!needDir()) break;
          const inplace = args.includes('-i');
          const rest = args.filter((a) => a !== '-i' && a !== '-E' && a !== '-n');
          const script = rest[0], fileArg = rest[1];
          const pth = fileArg ? this.normPath(fileArg) : null;
          if (pth && !dir.files.has(pth)) { emit('err', `sed: can't read ${fileArg}: No such file or directory\n`); code = 2; break; }
          const text = pth ? dir.files.get(pth) : (stdin || '');
          let lines = text.split('\n');
          const trail = text.endsWith('\n');
          if (trail) lines.pop();
          const sm = script && script.match(/^s(.)(.*?)\1(.*?)\1([gI]*)$/);
          const dm = script && script.match(/^\/(.*)\/d$/);
          if (sm) {
            const re = new RegExp(sm[2], sm[4].includes('g') ? 'g' : '');
            lines = lines.map((l) => l.replace(re, sm[3].replace(/&/g, '$&')));
          } else if (dm) {
            const re = new RegExp(dm[1]);
            lines = lines.filter((l) => !re.test(l));
          } else { emit('err', `sed: -e expression #1, char 1: unknown command\n`); code = 1; break; }
          const result = lines.join('\n') + (lines.length && trail ? '\n' : '');
          if (inplace && pth) dir.files.set(pth, result); else emit('out', result);
          break;
        }
        case 'sort': { const lines = (stdin || '').split('\n').filter(Boolean).sort(); emit('out', lines.join('\n') + (lines.length ? '\n' : '')); break; }
        case 'touch': {
          if (!needDir()) break;
          args.forEach((a) => {
            const p = this.normPath(a);
            const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
            if (parent && !this.dirExists(dir, parent)) { emit('err', `touch: cannot touch '${a}': No such file or directory\n`); code = 1; return; }
            if (!dir.files.has(p)) dir.files.set(p, '');
          });
          break;
        }
        case 'mkdir': {
          if (!needDir() && dir === null) {
            // 홈에서는 폴더 생성 허용
            const names = args.filter((a) => !a.startsWith('-'));
            code = 0; out.length = 0;
            names.forEach((n) => {
              if (this.home.has(n)) { emit('err', `mkdir: cannot create directory '${n}': File exists\n`); code = 1; }
              else this.mkdirHome(n);
            });
            break;
          }
          if (!dir) break;
          const parents = args.includes('-p');
          args.filter((a) => !a.startsWith('-')).forEach((a) => {
            const p = this.normPath(a);
            const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
            if (this.dirExists(dir, p)) { if (!parents) { emit('err', `mkdir: cannot create directory '${a}': File exists\n`); code = 1; } return; }
            if (parent && !this.dirExists(dir, parent) && !parents) { emit('err', `mkdir: cannot create directory '${a}': No such file or directory\n`); code = 1; return; }
            if (dir.files.has(p)) { emit('err', `mkdir: cannot create directory '${a}': File exists\n`); code = 1; return; }
            dir.dirs.add(p);
          });
          break;
        }
        case 'rm': {
          if (!dir) { emit('err', 'rm: 홈(~)에서는 폴더 삭제를 지원하지 않아요\n'); code = 1; break; }
          const fl = args.filter((a) => a.startsWith('-')).join('');
          const rec = fl.includes('r') || fl.includes('R');
          const force = fl.includes('f');
          args.filter((a) => !a.startsWith('-')).forEach((a) => {
            const p = this.normPath(a);
            if (a === '.git' || a === '.git/') {
              if (rec && dir.repo) { dir.repo = null; return; }
            }
            if (dir.files.has(p)) { dir.files.delete(p); return; }
            if (this.dirExists(dir, p)) {
              if (!rec) { emit('err', `rm: cannot remove '${a}': Is a directory\n`); code = 1; return; }
              Array.from(dir.files.keys()).forEach((k) => { if (k.startsWith(p + '/')) dir.files.delete(k); });
              Array.from(dir.dirs).forEach((d) => { if (d === p || d.startsWith(p + '/')) dir.dirs.delete(d); });
              return;
            }
            if (!force) { emit('err', `rm: cannot remove '${a}': No such file or directory\n`); code = 1; }
          });
          break;
        }
        case 'mv': case 'cp': {
          if (!needDir()) break;
          const fl = args.filter((a) => a.startsWith('-')).join('');
          const names = args.filter((a) => !a.startsWith('-'));
          if (names.length < 2) { emit('err', `${name}: missing file operand\n`); code = 1; break; }
          const dst = this.normPath(names[names.length - 1]);
          names.slice(0, -1).forEach((src0) => {
            const src = this.normPath(src0);
            const files = Array.from(dir.files.keys()).filter((k) => k === src || (k.startsWith(src + '/') && (fl.includes('r') || name === 'mv')));
            if (!files.length) { emit('err', `${name}: cannot stat '${src0}': No such file or directory\n`); code = 1; return; }
            const dstIsDir = this.dirExists(dir, dst) && !dir.files.has(dst);
            files.forEach((f) => {
              let target;
              if (names.length === 2 && !dstIsDir) target = f === src ? dst : dst + f.slice(src.length);
              else target = dst + '/' + src.split('/').pop() + f.slice(src.length);
              dir.files.set(target, dir.files.get(f));
              if (name === 'mv') dir.files.delete(f);
            });
          });
          break;
        }
        case 'nano': case 'vi': case 'vim': case 'edit': case 'code': {
          if (!needDir()) break;
          const target = args.filter((a) => !a.startsWith('-'))[0];
          if (!target) { emit('err', `${name}: 파일 이름이 필요해요\n`); code = 1; break; }
          const p = this.normPath(target);
          const current = dir.files.has(p) ? dir.files.get(p) : '';
          const ctx = { input: (kind, payload) => { throw new U.NeedInput(kind, payload); } };
          void ctx;
          let ret;
          if (this.inputProvider) ret = this.inputProvider('file', { path: p, content: current, isNew: !dir.files.has(p) });
          if (ret === undefined || ret === null) {
            const pending = this.pendingInputs || [];
            if (pending.length) ret = pending.shift();
            else throw new U.NeedInput('file', { path: p, content: current, isNew: !dir.files.has(p) }, 0);
          }
          const err = this.writeFile(dir, p, ret, false);
          if (err) { emit('err', err); code = 1; }
          break;
        }
        case 'help': emit('out', HELP_TEXT); break;
        case 'history': emit('out', this.history.map((h, i) => `${String(i + 1).padStart(5)}  ${h}`).join('\n') + '\n'); break;
        case 'less': case 'more': case 'cat-': emit('out', stdin || ''); break;
        case 'which': emit('out', '/usr/bin/' + (args[0] || '') + '\n'); break;
        case 'tree': {
          if (!needDir()) break;
          const lines = ['.'];
          const walk = (prefix, base) => {
            const ents = new Map();
            dir.files.forEach((_, p) => {
              if (base && !p.startsWith(base + '/')) return;
              const rel = base ? p.slice(base.length + 1) : p;
              const first = rel.split('/')[0];
              ents.set(first, rel.includes('/'));
            });
            const names = Array.from(ents.keys()).sort();
            names.forEach((n, i) => {
              const last = i === names.length - 1;
              lines.push(prefix + (last ? '└── ' : '├── ') + n);
              if (ents.get(n)) walk(prefix + (last ? '    ' : '│   '), base ? base + '/' + n : n);
            });
          };
          walk('', '');
          emit('out', lines.join('\n') + '\n');
          break;
        }
        default:
          emit('err', `bash: ${name}: command not found\n`);
          code = 127;
      }
      return { out, code };
    }
  }

  const HELP_TEXT = [
    '이 터미널에서 쓸 수 있는 명령어',
    '  git ...                        진짜 git 명령어 (status, add, commit, branch, merge, rebase, stash, push ...)',
    '  ls / cat / echo / touch / mkdir / rm / mv / cp / pwd / cd',
    '  echo "내용" > 파일              파일 만들기/덮어쓰기   (>> 는 이어쓰기)',
    '  nano 파일 (또는 vi, edit)       파일 편집기 열기 — 충돌 해결할 때 사용',
    '  clear                          화면 지우기',
    '  help                           이 도움말',
    '',
  ].join('\n');

  G.Sim = Sim;
  G.Dir = Dir;
  G.tokenizeShell = tokenize;
})();
