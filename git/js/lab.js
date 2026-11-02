/* Lab: 시나리오 환경(시뮬레이터 + 팀원 + 원격)을 만들고 목표를 판정한다 */
(function () {
  'use strict';
  const G = globalThis.GitEngine;
  const U = G.util;

  const ME = { name: 'Kim Dev', email: 'kim.dev@acme.co.kr' };
  const PEOPLE = {
    minji: { name: 'Lee Minji', email: 'minji@acme.co.kr' },
    jun: { name: 'Park Jun', email: 'jun@acme.co.kr' },
    sora: { name: 'Choi Sora', email: 'sora@acme.co.kr' },
  };
  const BASE_CLOCK = Date.UTC(2025, 2, 3, 0, 0, 0) / 1000; // 2025-03-03 09:00 KST

  class Lab {
    constructor(opts) {
      opts = opts || {};
      this.sim = new G.Sim({ clock: BASE_CLOCK, tz: '+0900', color: opts.color !== false, homePath: '/home/kim', username: 'kim', hostname: 'dev-laptop', defaultBranch: 'main' });
      this.sim.globalConfig.set('user.name', ME.name);
      this.sim.globalConfig.set('user.email', ME.email);
      this.sim.globalConfig.set('init.defaultbranch', 'main');
      this.sim.globalConfig.set('core.editor', 'vim');
      this.project = opts.project || 'project';
      this.sim.mkdirHome(this.project);
      this.sim.cwd = this.project;
      this.actors = {};
      this.remotes = {};
      this.cmdLog = [];
      this.step = 600;
    }

    /* ---- 구성 요소 ---- */
    /* 현재 위치(cwd)의 폴더. 홈(~)이면 저장소를 가진 폴더가 하나뿐일 때 그것을 쓴다 */
    dir() {
      if (this.sim.cwd !== '~') return this.sim.home.get(this.sim.cwd) || null;
      const withRepo = Array.from(this.sim.home.values()).filter((d) => d.repo);
      return withRepo.length === 1 ? withRepo[0] : (this.sim.home.get(this.project) || null);
    }
    repo() { const d = this.dir(); return d ? d.repo : null; }
    /* 프로젝트 폴더 없이 홈에서 시작 (clone 연습용) */
    startAtHome() { this.sim.home.delete(this.project); this.sim.cwd = '~'; }
    addActor(key) {
      const who = PEOPLE[key];
      if (!who) throw new Error('unknown person ' + key);
      if (!this.actors[key]) { this.sim.addActor(key, who); this.actors[key] = true; }
      return this.sim.actors.get(key);
    }
    createRemote(url, opts) {
      const r = this.sim.createRemote(url, opts);
      this.remotes[url] = r;
      return r;
    }
    actorRepo(key) { const a = this.sim.actors.get(key); return a ? a.dir.repo : null; }
    tick(sec) { this.sim.clock += sec; }

    /* ---- 실행 ---- */
    runUser(line) {
      this.tick(this.step);
      return this.sim.exec(line);
    }
    /* 사용자가 직접 입력한 명령 기록 (목표 판정에 사용) */
    record(line) { this.cmdLog.push(line.trim().replace(/\s+/g, ' ')); }
    runActor(key, line) {
      this.addActor(key);
      this.tick(this.step);
      return this.sim.runAs(key, line);
    }
    must(res, line) {
      if (res.code !== 0) throw new Error(`setup 실패: ${line}\n${res.text}`);
      return res;
    }
    write(path, content) { this.dir().files.set(path, content); }
    /* 항상 프로젝트 폴더를 대상으로 하는 setup 용 (cwd 와 무관) */
    actorWrite(key, path, content) { this.addActor(key); this.sim.actors.get(key).dir.files.set(path, content); }

    cloneFor(key, url) {
      this.addActor(key);
      const a = this.sim.actors.get(key);
      const session = this.sim.actorSession(key);
      const ctx = new U.Ctx(this.sim, null, { session, actor: a });
      ctx.session = session;
      ctx.cloneDir = a.dir;
      G.commands.clone(ctx, ['-q', url, a.dir.name]);
    }

    /* setup 연산 목록 실행 */
    setup(ops) {
      ops.forEach((op) => {
        if (typeof op === 'string') { this.must(this.runUser(op), op); return; }
        const kind = op[0];
        if (kind === 'write') this.write(op[1], op[2]);
        else if (kind === 'commit') {
          // ['commit', msg, {file: content, ...}]
          const files = op[2] || {};
          Object.keys(files).forEach((f) => { if (files[f] === null) this.dir().files.delete(f); else this.write(f, files[f]); });
          this.must(this.runUser('git add -A'), 'git add -A');
          this.must(this.runUser(`git commit -q -m ${JSON.stringify(op[1])}`), 'git commit');
        } else if (kind === 'try') this.runUser(op[1]);
        else if (kind === 'asTry') this.runActor(op[1], op[2]);
        else if (kind === 'as') this.must(this.runActor(op[1], op[2]), op[2]);
        else if (kind === 'aWrite') this.actorWrite(op[1], op[2], op[3]);
        else if (kind === 'aCommit') {
          const files = op[3] || {};
          Object.keys(files).forEach((f) => { if (files[f] === null) this.sim.actors.get(op[1]).dir.files.delete(f); else this.actorWrite(op[1], f, files[f]); });
          this.must(this.runActor(op[1], 'git add -A'), 'git add -A');
          this.must(this.runActor(op[1], `git commit -q -m ${JSON.stringify(op[2])}`), 'git commit');
        } else if (kind === 'remote') this.createRemote(op[1], op[2]);
        else if (kind === 'clone') this.cloneFor(op[1], op[2]);
        else if (kind === 'tick') this.tick(op[1]);
        else if (kind === 'fn') op[1](this);
        else throw new Error('unknown setup op ' + kind);
      });
      return this;
    }

    /* 편집기/프롬프트가 필요한 명령을 UI 콜백으로 처리 */
    async runInteractive(line, ask) {
      const answers = [];
      this.record(line);
      this.tick(this.step);
      for (let guard = 0; guard < 50; guard++) {
        let idx = 0;
        this.sim.inputProvider = (kind, payload) => (idx < answers.length ? answers[idx++] : undefined);
        try {
          const r = this.sim.exec(line);
          this.sim.inputProvider = null;
          return r;
        } catch (e) {
          this.sim.inputProvider = null;
          if (e instanceof U.NeedInput) {
            const a = await ask(e.kind, e.payload);
            if (a === null || a === undefined) return { out: [{ s: 'err', t: '(입력이 취소되어 명령이 중단되었어요)\n' }], code: 1, text: '(입력 취소)\n', stdout: '', stderr: '' };
            answers.push(a);
            continue;
          }
          throw e;
        }
      }
      throw new Error('too many interactive inputs');
    }

    /* 프롬프트 정보 */
    promptInfo() {
      const cwd = this.sim.cwd === '~' ? '~' : '~/' + this.sim.cwd;
      const repo = this.repo();
      let branch = '';
      if (this.sim.cwd !== '~' && repo) {
        const st = repo.state;
        let label = repo.head.ref ? repo.currentBranch() : repo.shortHash(repo.headCommit() || '0000000', 7);
        if (!repo.head.ref) label = '@' + label;
        let tag = '';
        if (st.rebase) tag = `|REBASE ${st.rebase.done.length}/${st.rebase.total}`;
        else if (st.merge) tag = '|MERGING';
        else if (st.cherryPick) tag = '|CHERRY-PICKING';
        else if (st.revert) tag = '|REVERTING';
        else if (st.bisect) tag = '|BISECTING';
        branch = label + tag;
      }
      return { cwd, branch };
    }

    /* ---- 목표 판정용 도우미 ---- */
    env() { return new Env(this); }
  }

  class Env {
    constructor(lab) { this.lab = lab; }
    get repo() { return this.lab.repo(); }
    get sim() { return this.lab.sim; }
    ranMatch(re) { return this.lab.cmdLog.some((c) => re.test(c)); }
    branch() { return this.repo.currentBranch(); }
    detached() { return this.repo.isDetached(); }
    hasBranch(n) { return this.repo.refs.has('refs/heads/' + n); }
    hasTag(n) { return this.repo.refs.has('refs/tags/' + n); }
    annotatedTag(n) { const h = this.repo.readRef('refs/tags/' + n); return !!h && this.repo.get(h).type === 'tag'; }
    tagTarget(n) { const h = this.repo.readRef('refs/tags/' + n); return h ? this.repo.peelToCommit(h) : null; }
    hasRemoteRef(name) { return this.repo.refs.has('refs/remotes/' + name); }
    hash(rev) { return this.repo.resolveCommit(rev); }
    sameCommit(a, b) { const x = this.hash(a), y = this.hash(b); return !!x && x === y; }
    /* HEAD(또는 rev) 에서 도달 가능한 커밋 제목 (최신 순) */
    subjects(rev, opts) {
      const h = this.hash(rev || 'HEAD');
      if (!h) return [];
      return this.repo.revWalk([h], [], Object.assign({ order: 'date' }, opts || {})).map((x) => U.subjectOf(this.repo.commitObj(x).message));
    }
    firstParentSubjects(rev) { return this.subjects(rev, { firstParent: true }); }
    count(rev) { return this.subjects(rev).length; }
    subject(rev) { const h = this.hash(rev || 'HEAD'); return h ? U.subjectOf(this.repo.commitObj(h).message) : null; }
    commitObj(rev) { const h = this.hash(rev || 'HEAD'); return h ? this.repo.commitObj(h) : null; }
    parents(rev) { const c = this.commitObj(rev); return c ? c.parents.length : 0; }
    isAncestor(a, b) { const x = this.hash(a), y = this.hash(b); return !!x && !!y && this.repo.isAncestor(x, y); }
    file(path) { return this.repo.work.get(path); }
    committedFile(path, rev) { const h = this.hash(rev || 'HEAD'); if (!h) return undefined; const e = this.repo.commitFlat(h).get(path); return e ? this.repo.blobContent(e.hash) : undefined; }
    inCommit(path, rev) { return this.committedFile(path, rev) !== undefined; }
    tracked(path) { return this.repo.index.has(path); }
    status() { return U.computeStatus(this.repo, {}); }
    clean() { const st = this.status(); return !st.staged.length && !st.unstaged.length && !st.unmerged.length; }
    fullyClean() { const st = this.status(); return !st.staged.length && !st.unstaged.length && !st.unmerged.length && !st.untracked.length; }
    staged() { return this.status().staged.map((c) => c.path); }
    unstaged() { return this.status().unstaged.map((c) => c.path); }
    untracked() { return this.status().untracked.slice(); }
    conflicts() { return Array.from(this.repo.unmerged.keys()); }
    inProgress() { const s = this.repo.state; return !!(s.merge || s.rebase || s.cherryPick || s.revert || s.bisect); }
    state(k) { return !!this.repo.state[k]; }
    stashCount() { return this.repo.readReflog('refs/stash').length; }
    reflogHas(re) { return this.repo.readReflog('HEAD').some((e) => re.test(e.msg)); }
    config(k) { return this.repo.config.get(k); }
    upstream(b) { return this.repo.upstreamName(b || this.branch()); }
    remoteRepo(url) { return url ? this.sim.net.get(url) : Object.values(this.lab.remotes)[0]; }
    remoteHash(branch, url) { const r = this.remoteRepo(url); return r ? r.readRef('refs/heads/' + branch) : null; }
    remoteHas(branch, url) { return !!this.remoteHash(branch, url); }
    remoteSubjects(branch, url) {
      const r = this.remoteRepo(url);
      const h = r && r.readRef('refs/heads/' + branch);
      if (!h) return [];
      return r.revWalk([h], [], { order: 'date' }).map((x) => U.subjectOf(r.commitObj(x).message));
    }
    remoteTag(n, url) { const r = this.remoteRepo(url); return !!(r && r.refs.has('refs/tags/' + n)); }
    /* 로컬 브랜치 tip == 원격 tip */
    synced(branch) { const b = branch || this.branch(); const l = this.repo.readRef('refs/heads/' + b); return !!l && l === this.remoteHash(b); }
    aheadBehind(branch) {
      const b = branch || this.branch();
      const up = this.repo.upstreamRef(b);
      const l = this.repo.readRef('refs/heads/' + b), u = up && this.repo.readRef(up);
      if (!l || !u) return null;
      return U.aheadBehind(this.repo, l, u);
    }
    /* 어느 커밋이든 메시지가 re 와 일치하는 것이 있는지 */
    anyCommit(re, rev) { return this.subjects(rev || 'HEAD').some((s) => re.test(s)); }
    reachableFromAnyRef(hash) { return this.repo.reachableFromAllRefs().has(hash); }
    allSubjects() {
      const seen = new Set();
      this.repo.allTips().forEach((t) => this.repo.ancestors(t).forEach((x) => seen.add(x)));
      return Array.from(seen).map((x) => U.subjectOf(this.repo.commitObj(x).message));
    }
    authorOf(rev) { const c = this.commitObj(rev); return c ? c.author.email : null; }
  }

  globalThis.GP = globalThis.GP || {};
  globalThis.GP.Lab = Lab;
  globalThis.GP.PEOPLE = PEOPLE;
  globalThis.GP.ME = ME;
})();
