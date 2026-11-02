/* Repo: git 저장소 모델 (오브젝트 / refs / reflog / 인덱스 / 작업 트리) */
(function () {
  'use strict';
  const G = (globalThis.GitEngine = globalThis.GitEngine || {});
  const sha1 = G.sha1;

  const ZERO = '0'.repeat(40);
  const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

  class GitError extends Error {
    constructor(msg, code) { super(msg); this.gitMessage = msg; this.code = code === undefined ? 128 : code; }
  }

  function fmtIdent(i) { return `${i.name} <${i.email}> ${i.ts} ${i.tz}`; }

  /* 커밋 메시지 정리 (cleanup=whitespace | strip) */
  function cleanupMessage(text, stripComments) {
    let lines = text.split('\n').map((l) => l.replace(/[ \t\r]+$/, ''));
    if (stripComments) lines = lines.filter((l) => !l.startsWith('#'));
    const out = [];
    let blank = false;
    lines.forEach((l) => {
      if (l === '') { blank = true; return; }
      if (blank && out.length) out.push('');
      blank = false;
      out.push(l);
    });
    return out.length ? out.join('\n') + '\n' : '';
  }

  class Repo {
    constructor(opts) {
      opts = opts || {};
      this.bare = !!opts.bare;
      this.name = opts.name || 'repo';
      this.objects = new Map();
      this.refs = new Map();
      this.head = { ref: 'refs/heads/main' };
      this.reflogs = new Map();
      this.index = new Map();
      this.unmerged = new Map();
      this.work = new Map();
      this.dirs = new Set();
      this.config = new Map();
      this.state = {};
      this.symrefs = new Map(); // refs/remotes/origin/HEAD → refs/remotes/origin/main
      this.special = {}; // ORIG_HEAD, FETCH_HEAD, ...
    }

    /* ---------------- 오브젝트 ---------------- */
    putBlob(content) {
      const h = sha1.hashObject('blob', content);
      if (!this.objects.has(h)) this.objects.set(h, { type: 'blob', content });
      return h;
    }
    putTree(entries) {
      const sorted = entries.slice().sort((a, b) => {
        const ka = a.mode === '40000' ? a.name + '/' : a.name;
        const kb = b.mode === '40000' ? b.name + '/' : b.name;
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
      const parts = [];
      sorted.forEach((e) => {
        parts.push(sha1.utf8(`${e.mode} ${e.name}\0`));
        parts.push(sha1.hexToBytes(e.hash));
      });
      const h = sha1.hashObjectBytes('tree', sha1.concat(...parts));
      if (!this.objects.has(h)) this.objects.set(h, { type: 'tree', entries: sorted });
      return h;
    }
    flatToTree(flat) {
      const root = { files: [], dirs: new Map() };
      flat.forEach((e, p) => {
        const parts = p.split('/');
        let node = root;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { files: [], dirs: new Map() });
          node = node.dirs.get(parts[i]);
        }
        node.files.push({ mode: e.mode || '100644', name: parts[parts.length - 1], hash: e.hash });
      });
      const build = (node) => {
        const entries = node.files.slice();
        node.dirs.forEach((child, name) => entries.push({ mode: '40000', name, hash: build(child) }));
        return this.putTree(entries);
      };
      return build(root);
    }
    treeToFlat(treeHash) {
      const t = this.objects.get(treeHash);
      if (!t || t.type !== 'tree') return new Map();
      if (t._flat) return t._flat;
      const flat = new Map();
      const walk = (h, prefix) => {
        const tree = this.objects.get(h);
        tree.entries.forEach((e) => {
          if (e.mode === '40000') walk(e.hash, prefix + e.name + '/');
          else flat.set(prefix + e.name, { hash: e.hash, mode: e.mode });
        });
      };
      walk(treeHash, '');
      t._flat = flat;
      return flat;
    }
    putCommit(c) {
      let s = `tree ${c.tree}\n`;
      c.parents.forEach((p) => { s += `parent ${p}\n`; });
      s += `author ${fmtIdent(c.author)}\ncommitter ${fmtIdent(c.committer)}\n\n${c.message}`;
      const h = sha1.hashObject('commit', s);
      if (!this.objects.has(h)) {
        this.objects.set(h, { type: 'commit', tree: c.tree, parents: c.parents.slice(), author: c.author, committer: c.committer, message: c.message });
      }
      return h;
    }
    putTag(t) {
      const s = `object ${t.object}\ntype ${t.objType}\ntag ${t.tag}\ntagger ${fmtIdent(t.tagger)}\n\n${t.message}`;
      const h = sha1.hashObject('tag', s);
      if (!this.objects.has(h)) this.objects.set(h, { type: 'tag', object: t.object, objType: t.objType, tag: t.tag, tagger: t.tagger, message: t.message });
      return h;
    }
    get(h) { return this.objects.get(h); }
    has(h) { return this.objects.has(h); }
    commitObj(h) {
      const o = this.objects.get(h);
      return o && o.type === 'commit' ? o : null;
    }
    commitFlat(h) {
      const c = this.commitObj(h);
      return c ? this.treeToFlat(c.tree) : new Map();
    }
    blobContent(h) {
      const o = this.objects.get(h);
      return o && o.type === 'blob' ? o.content : '';
    }
    /* 태그 오브젝트를 벗겨서 커밋 해시를 얻는다 */
    peelToCommit(h) {
      let cur = h;
      for (let i = 0; i < 10 && cur; i++) {
        const o = this.objects.get(cur);
        if (!o) return null;
        if (o.type === 'commit') return cur;
        if (o.type === 'tag') cur = o.object; else return null;
      }
      return null;
    }
    shortHash(h, len) {
      len = len || 7;
      if (!h) return '';
      let n = len;
      while (n < 40) {
        const p = h.slice(0, n);
        let clash = false;
        for (const k of this.objects.keys()) { if (k !== h && k.startsWith(p)) { clash = true; break; } }
        if (!clash) break;
        n++;
      }
      return h.slice(0, n);
    }
    expandHash(prefix) {
      if (!/^[0-9a-f]{4,40}$/.test(prefix)) return null;
      if (prefix.length === 40) return this.objects.has(prefix) ? prefix : null;
      const found = [];
      for (const k of this.objects.keys()) if (k.startsWith(prefix)) found.push(k);
      if (found.length === 1) return found[0];
      if (found.length > 1) return 'ambiguous';
      return null;
    }

    /* ---------------- refs ---------------- */
    readRef(name) { return this.refs.get(name); }
    writeRef(name, hash) { this.refs.set(name, hash); }
    deleteRef(name) { this.refs.delete(name); }
    listRefs(prefix) {
      const out = [];
      this.refs.forEach((h, n) => { if (!prefix || n.startsWith(prefix)) out.push([n, h]); });
      out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      return out;
    }
    branches() { return this.listRefs('refs/heads/').map(([n, h]) => [n.slice(11), h]); }
    isDetached() { return !this.head.ref; }
    currentBranch() { return this.head.ref ? this.head.ref.replace(/^refs\/heads\//, '') : null; }
    headCommit() {
      if (this.head.ref) return this.refs.get(this.head.ref) || null;
      return this.head.hash || null;
    }
    isUnborn() { return !!this.head.ref && !this.refs.has(this.head.ref); }
    headFlat() { const h = this.headCommit(); return h ? this.commitFlat(h) : new Map(); }

    /* ---------------- reflog ---------------- */
    logRef(refname, oldH, newH, msg, ident) {
      if (!this.reflogs.has(refname)) this.reflogs.set(refname, []);
      this.reflogs.get(refname).push({ old: oldH || ZERO, new: newH || ZERO, name: ident.name, email: ident.email, ts: ident.ts, tz: ident.tz, msg });
    }
    readReflog(refname) { return this.reflogs.get(refname) || []; }
    reflogEnabled(refname) {
      return refname === 'HEAD' || refname.startsWith('refs/heads/') || refname.startsWith('refs/remotes/') || refname === 'refs/stash';
    }
    /* 브랜치(또는 임의 ref)를 이동시키고 reflog 를 남긴다. HEAD 가 그 브랜치를 가리키면 HEAD reflog 도 남긴다 */
    updateRef(refname, newH, msg, ident, opts) {
      opts = opts || {};
      const oldH = this.refs.get(refname) || ZERO;
      this.refs.set(refname, newH);
      if (!this.bare && this.reflogEnabled(refname) && !opts.noLog) this.logRef(refname, oldH, newH, msg, ident);
      if (!this.bare && this.head.ref === refname && !opts.noHeadLog) this.logRef('HEAD', oldH, newH, msg, ident);
    }
    /* detached HEAD 이동 */
    moveDetachedHead(newH, msg, ident) {
      const oldH = this.headCommit() || ZERO;
      this.head = { hash: newH };
      if (!this.bare) this.logRef('HEAD', oldH, newH, msg, ident);
    }
    /* HEAD 가 가리키는 대상을 바꾼다 (checkout / switch) */
    setHead(target, msg, ident) {
      const oldH = this.headCommit() || ZERO;
      this.head = target;
      const newH = this.headCommit() || ZERO;
      if (!this.bare) this.logRef('HEAD', oldH, newH, msg, ident);
    }

    /* ---------------- 히스토리 ---------------- */
    parents(h) { const c = this.commitObj(h); return c ? c.parents : []; }
    ancestors(h) {
      const seen = new Set();
      const stack = [h];
      while (stack.length) {
        const x = stack.pop();
        if (!x || seen.has(x)) continue;
        seen.add(x);
        this.parents(x).forEach((p) => stack.push(p));
      }
      return seen;
    }
    isAncestor(anc, desc) {
      if (anc === desc) return true;
      const seen = new Set();
      const stack = [desc];
      while (stack.length) {
        const x = stack.pop();
        if (seen.has(x)) continue;
        seen.add(x);
        if (x === anc) return true;
        this.parents(x).forEach((p) => stack.push(p));
      }
      return false;
    }
    mergeBases(a, b) {
      const aAnc = this.ancestors(a);
      const cands = [];
      const seen = new Set();
      const queue = [b];
      while (queue.length) {
        const x = queue.shift();
        if (seen.has(x)) continue;
        seen.add(x);
        if (aAnc.has(x)) { cands.push(x); continue; }
        this.parents(x).forEach((p) => queue.push(p));
      }
      // 다른 후보의 조상인 후보 제거
      return cands.filter((c) => !cands.some((o) => o !== c && this.isAncestor(c, o)));
    }
    /* 모든 ref / HEAD 에서 도달 가능한 커밋 */
    allTips(opts) {
      opts = opts || {};
      const tips = [];
      this.refs.forEach((h, n) => {
        if (n === 'refs/stash') return;
        if (opts.branchesOnly && !n.startsWith('refs/heads/')) return;
        const c = this.peelToCommit(h);
        if (c) tips.push(c);
      });
      const hc = this.headCommit();
      if (hc && !opts.branchesOnly) tips.push(hc);
      return Array.from(new Set(tips));
    }
    reachableFromAllRefs() {
      const set = new Set();
      this.allTips().forEach((t) => this.ancestors(t).forEach((x) => set.add(x)));
      return set;
    }

    /* git 의 revision 순회 순서 재현. include/exclude 는 커밋 해시 배열 */
    revWalk(include, exclude, opts) {
      opts = opts || {};
      const excl = new Set();
      (exclude || []).forEach((e) => this.ancestors(e).forEach((x) => excl.add(x)));
      // 후보 집합
      const inSet = new Set();
      const collect = (h) => {
        const stack = [h];
        while (stack.length) {
          const x = stack.pop();
          if (inSet.has(x) || excl.has(x)) continue;
          inSet.add(x);
          const ps = this.parents(x);
          if (opts.firstParent) { if (ps.length) stack.push(ps[0]); } else ps.forEach((p) => stack.push(p));
        }
      };
      include.forEach(collect);

      const date = (h) => this.commitObj(h).committer.ts;
      // 날짜순 우선순위 큐(동률은 삽입 순서) 로 전체 순서 계산
      const dateOrder = () => {
        let counter = 0;
        const queue = [];
        const seen = new Set();
        const push = (h) => {
          if (!inSet.has(h) || seen.has(h)) return;
          seen.add(h);
          queue.push({ h, d: date(h), n: counter++ });
        };
        include.forEach(push);
        const out = [];
        while (queue.length) {
          let bi = 0;
          for (let i = 1; i < queue.length; i++) {
            if (queue[i].d > queue[bi].d || (queue[i].d === queue[bi].d && queue[i].n < queue[bi].n)) bi = i;
          }
          const cur = queue.splice(bi, 1)[0];
          out.push(cur.h);
          const ps = this.parents(cur.h);
          if (opts.firstParent) { if (ps.length) push(ps[0]); } else ps.forEach(push);
        }
        return out;
      };
      let list = dateOrder();
      if (opts.order === 'topo' || opts.order === 'date-order') {
        const indeg = new Map();
        list.forEach((h) => indeg.set(h, 1));
        list.forEach((h) => {
          const ps = opts.firstParent ? this.parents(h).slice(0, 1) : this.parents(h);
          ps.forEach((p) => { if (indeg.get(p)) indeg.set(p, indeg.get(p) + 1); });
        });
        const queue = [];
        list.forEach((h) => { if (indeg.get(h) === 1) queue.push(h); });
        const out = [];
        const lifo = opts.order === 'topo';
        if (lifo) queue.reverse();
        let ctr = 0;
        const orderOf = new Map();
        queue.forEach((h) => orderOf.set(h, ctr++));
        while (queue.length) {
          let pick;
          if (lifo) pick = queue.pop();
          else {
            let bi = 0;
            for (let i = 1; i < queue.length; i++) {
              const a = queue[i], b = queue[bi];
              if (date(a) > date(b) || (date(a) === date(b) && orderOf.get(a) < orderOf.get(b))) bi = i;
            }
            pick = queue.splice(bi, 1)[0];
          }
          const ps = opts.firstParent ? this.parents(pick).slice(0, 1) : this.parents(pick);
          ps.forEach((p) => {
            if (!indeg.get(p)) return;
            indeg.set(p, indeg.get(p) - 1);
            if (indeg.get(p) === 1) { queue.push(p); orderOf.set(p, ctr++); }
          });
          indeg.set(pick, 0);
          out.push(pick);
        }
        list = out;
      }
      if (opts.reverse) list = list.slice().reverse();
      return list;
    }

    /* ---------------- 리비전 해석 ---------------- */
    reflogLookup(refname, n) {
      const log = this.readReflog(refname);
      const e = log[log.length - 1 - n];
      return e ? e.new : null;
    }
    resolveBase(name) {
      if (name === '@' || name === 'HEAD' || name === '') return this.headCommit();
      const sp = this.special[name];
      if (['ORIG_HEAD', 'MERGE_HEAD', 'FETCH_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD'].includes(name)) {
        if (name === 'MERGE_HEAD') return (this.state.merge && this.state.merge.heads && this.state.merge.heads[0]) || null;
        if (name === 'CHERRY_PICK_HEAD') return (this.state.cherryPick && this.state.cherryPick.head) || null;
        if (name === 'REVERT_HEAD') return (this.state.revert && this.state.revert.head) || null;
        return sp || null;
      }
      // reflog 접근: x@{n}
      let m = name.match(/^(.*)@\{(.+)\}$/);
      if (m) {
        const base = m[1];
        const sel = m[2];
        let refname;
        if (base === '' || base === 'HEAD') refname = 'HEAD';
        else {
          const cand = ['refs/' + base, 'refs/heads/' + base, 'refs/remotes/' + base, base];
          refname = cand.find((c) => this.refs.has(c)) || null;
          if (base === 'stash') refname = 'refs/stash';
        }
        if (/^\d+$/.test(sel)) {
          if (!refname) return null;
          return this.reflogLookup(refname, parseInt(sel, 10));
        }
        if (/^-\d+$/.test(sel) && refname === 'HEAD') {
          // 직전에 있던 브랜치: checkout 기록에서 찾는다
          const log = this.readReflog('HEAD');
          let count = 0;
          const want = -parseInt(sel, 10);
          for (let i = log.length - 1; i >= 0; i--) {
            const mm = log[i].msg.match(/^checkout: moving from (.+) to (.+)$/);
            if (mm) { count++; if (count === want) return this.resolveBase(mm[1]); }
          }
          return null;
        }
        if (sel === 'u' || sel === 'upstream') {
          const br = refname ? refname.replace(/^refs\/heads\//, '') : this.currentBranch();
          const up = this.upstreamRef(br);
          return up ? this.refs.get(up) || null : null;
        }
        return null;
      }
      // 일반 ref
      const cands = [name, 'refs/' + name, 'refs/tags/' + name, 'refs/heads/' + name, 'refs/remotes/' + name, 'refs/remotes/' + name + '/HEAD'];
      for (const c of cands) {
        if (this.refs.has(c)) return this.refs.get(c);
        if (this.symrefs && this.symrefs.has(c)) return this.refs.get(this.symrefs.get(c)) || null;
      }
      // 해시 접두사
      const ex = this.expandHash(name);
      if (ex && ex !== 'ambiguous') return ex;
      return null;
    }
    /* "A~2^2" 같은 표현을 해석. 태그는 그대로(오브젝트) 반환하고 연산이 있을 때는 커밋으로 벗긴다 */
    resolve(spec) {
      if (!spec) return null;
      const m = spec.match(/^([^~^]*(?:@\{[^}]*\})?)((?:[~^](?:\d+|\{[^}]*\})?)*)$/);
      if (!m) return null;
      let cur = this.resolveBase(m[1]);
      if (!cur) return null;
      const ops = m[2].match(/[~^](?:\d+|\{[^}]*\})?/g) || [];
      for (const op of ops) {
        if (op[0] === '^' && op[1] === '{') {
          const kind = op.slice(2, -1);
          if (kind === '' ) { const o = this.objects.get(cur); cur = o && o.type === 'tag' ? this.peelAny(cur) : cur; }
          else if (kind === 'commit') { cur = this.peelToCommit(cur); }
          else if (kind === 'tree') { const c = this.peelToCommit(cur); cur = c ? this.commitObj(c).tree : null; }
          if (!cur) return null;
          continue;
        }
        const c = this.peelToCommit(cur);
        if (!c) return null;
        const n = op.length > 1 ? parseInt(op.slice(1), 10) : 1;
        if (op[0] === '~') {
          cur = c;
          for (let i = 0; i < n; i++) {
            const ps = this.parents(cur);
            if (!ps.length) return null;
            cur = ps[0];
          }
        } else if (n === 0) cur = c;
        else {
          const ps = this.parents(c);
          if (n > ps.length) return null;
          cur = ps[n - 1];
        }
      }
      return cur;
    }
    peelAny(h) {
      let cur = h;
      for (let i = 0; i < 10; i++) {
        const o = this.objects.get(cur);
        if (o && o.type === 'tag') cur = o.object; else return cur;
      }
      return cur;
    }
    resolveCommit(spec) {
      const h = this.resolve(spec);
      return h ? this.peelToCommit(h) : null;
    }

    /* ---------------- 설정 / 업스트림 ---------------- */
    getConfig(key) { return this.config.get(key); }
    setConfig(key, val) { this.config.set(key, val); }
    upstreamRef(branch) {
      const remote = this.config.get(`branch.${branch}.remote`);
      const merge = this.config.get(`branch.${branch}.merge`);
      if (!remote || !merge) return null;
      if (remote === '.') return merge;
      const rn = merge.replace(/^refs\/heads\//, '');
      return `refs/remotes/${remote}/${rn}`;
    }
    upstreamName(branch) {
      const ref = this.upstreamRef(branch);
      return ref ? ref.replace(/^refs\/remotes\//, '') : null;
    }

    /* ---------------- 인덱스 / 작업 트리 ---------------- */
    indexFlat() {
      const m = new Map();
      this.index.forEach((e, p) => m.set(p, { hash: e.hash, mode: e.mode }));
      return m;
    }
    setIndexFromFlat(flat) {
      this.index = new Map();
      flat.forEach((e, p) => this.index.set(p, { hash: e.hash, mode: e.mode || '100644' }));
    }
    writeWork(path, content) { this.work.set(path, content); }
    hashOfWork(path) {
      const c = this.work.get(path);
      return c === undefined ? null : sha1.hashObject('blob', c);
    }
    /* 작업 트리 파일을 인덱스에 스테이징 (blob 저장) */
    stagePath(path) {
      const c = this.work.get(path);
      if (c === undefined) { this.index.delete(path); return; }
      const h = this.putBlob(c);
      const old = this.index.get(path);
      this.index.set(path, { hash: h, mode: old ? old.mode : '100644' });
    }

    /* ---------------- .gitignore ---------------- */
    ignoreRules() {
      const rules = [];
      this.work.forEach((content, path) => {
        const base = path.split('/').pop();
        if (base !== '.gitignore') return;
        const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
        content.split('\n').forEach((raw) => {
          let line = raw.replace(/\r$/, '');
          if (!line || line.startsWith('#')) return;
          line = line.replace(/(?<!\\)\s+$/, '');
          if (!line) return;
          let neg = false;
          if (line.startsWith('!')) { neg = true; line = line.slice(1); }
          let dirOnly = false;
          if (line.endsWith('/')) { dirOnly = true; line = line.slice(0, -1); }
          let anchored = false;
          if (line.startsWith('/')) { anchored = true; line = line.slice(1); }
          else if (line.includes('/')) anchored = true;
          rules.push({ dir, pattern: line, neg, dirOnly, anchored, re: globToRegex(line) });
        });
      });
      return rules;
    }
    /* path 가 무시 대상인지 (추적 중이 아닐 때만 의미 있음) */
    isIgnored(path, rules) {
      rules = rules || this.ignoreRules();
      const parts = path.split('/');
      let ignored = false;
      // 상위 디렉터리부터 검사: 상위가 무시되면 하위도 무시
      for (let i = 1; i <= parts.length; i++) {
        const sub = parts.slice(0, i).join('/');
        const isDir = i < parts.length;
        let res = null;
        rules.forEach((r) => {
          if (!sub.startsWith(r.dir)) return;
          if (r.dirOnly && !isDir) return;
          const rel = sub.slice(r.dir.length);
          let match;
          if (r.anchored) match = r.re.test(rel);
          else match = r.re.test(rel.split('/').pop());
          if (match) res = !r.neg;
        });
        if (res === true) return true;
        if (res === false) ignored = false;
      }
      return ignored;
    }
  }

  function globToRegex(glob) {
    let re = '^';
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i];
      if (c === '*') {
        if (glob[i + 1] === '*') {
          i++;
          if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
        } else re += '[^/]*';
      } else if (c === '?') re += '[^/]';
      else if (c === '[') {
        const j = glob.indexOf(']', i + 1);
        if (j < 0) re += '\\[';
        else { re += '[' + glob.slice(i + 1, j).replace(/^!/, '^') + ']'; i = j; }
      } else if (c === '\\') { i++; re += (glob[i] || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
      else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(re + '$');
  }

  /* pathspec 매칭: 파일/디렉터리 접두어 또는 글롭 */
  function pathspecMatcher(specs) {
    const list = specs.map((s) => {
      let spec = s.replace(/^\.\//, '');
      if (spec === '.' || spec === '') return { all: true };
      if (/[*?[]/.test(spec)) {
        let re = '^';
        for (let i = 0; i < spec.length; i++) {
          const c = spec[i];
          if (c === '*') re += '.*';
          else if (c === '?') re += '.';
          else if (c === '[') { const j = spec.indexOf(']', i); if (j < 0) re += '\\['; else { re += spec.slice(i, j + 1); i = j; } }
          else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }
        return { re: new RegExp(re + '$') };
      }
      return { prefix: spec.replace(/\/$/, '') };
    });
    return function (path) {
      return list.some((s) => {
        if (s.all) return true;
        if (s.re) return s.re.test(path) || s.re.test(path.split('/').pop());
        return path === s.prefix || path.startsWith(s.prefix + '/');
      });
    };
  }

  G.Repo = Repo;
  G.GitError = GitError;
  G.ZERO = ZERO;
  G.EMPTY_TREE = EMPTY_TREE;
  G.fmtIdent = fmtIdent;
  G.cleanupMessage = cleanupMessage;
  G.pathspecMatcher = pathspecMatcher;
})();
