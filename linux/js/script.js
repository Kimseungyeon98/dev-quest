(function () {
  'use strict';

  /* ============================================================
   * 가상 파일시스템 헬퍼
   * ========================================================== */
  const HOME_PATH = ['home', 'user'];

  function D(children, perm) {
    return { type: 'dir', perm: perm || 'rwxr-xr-x', children: children || {} };
  }
  function F(content, perm) {
    return { type: 'file', content: content || '', perm: perm || 'rw-r--r--' };
  }
  function buildRoot(homeChildren) {
    return D({ home: D({ user: D(homeChildren) }) });
  }
  function cloneTree(node) {
    return JSON.parse(JSON.stringify(node));
  }
  function arraysEqual(a, b) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  function getNode(root, segs) {
    let node = root;
    for (const s of segs) {
      if (!node || node.type !== 'dir' || !node.children[s]) return null;
      node = node.children[s];
    }
    return node;
  }

  function resolvePath(cwd, inputPath) {
    if (!inputPath || inputPath === '.') return cwd.slice();
    let segs;
    let rest = inputPath;
    if (rest.startsWith('~')) {
      segs = HOME_PATH.slice();
      rest = rest.slice(1);
      if (rest.startsWith('/')) rest = rest.slice(1);
    } else if (rest.startsWith('/')) {
      segs = [];
      rest = rest.slice(1);
    } else {
      segs = cwd.slice();
    }
    if (rest === '') return segs;
    const parts = rest.split('/').filter((p) => p !== '');
    for (const part of parts) {
      if (part === '.') continue;
      else if (part === '..') { if (segs.length > 0) segs.pop(); }
      else segs.push(part);
    }
    return segs;
  }

  function getNodeFromHome(ctx, relPath) {
    const segs = HOME_PATH.concat(relPath.split('/').filter(Boolean));
    return getNode(ctx.root, segs);
  }

  function tokenize(s) {
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    const tokens = [];
    let m;
    while ((m = re.exec(s))) {
      tokens.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
    }
    return tokens;
  }

  function wildcardToRegex(p) {
    const esc = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + esc + '$');
  }

  function displayPath(cwd) {
    if (cwd.length >= HOME_PATH.length && arraysEqual(cwd.slice(0, HOME_PATH.length), HOME_PATH)) {
      const rest = cwd.slice(HOME_PATH.length);
      return '~' + (rest.length ? '/' + rest.join('/') : '');
    }
    return '/' + cwd.join('/');
  }

  const PERM_TABLE = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];

  function applySymbolicChmod(perm, modeStr) {
    const clauses = modeStr.split(',');
    let chars = perm.split('');
    for (const clause of clauses) {
      const m = clause.match(/^([ugoa]*)([+-])([rwx]+)$/);
      if (!m) return null;
      let who = m[1] || 'a';
      const sign = m[2];
      const bits = m[3];
      const targets = [];
      if (who.includes('u') || who.includes('a')) targets.push(0);
      if (who.includes('g') || who.includes('a')) targets.push(3);
      if (who.includes('o') || who.includes('a')) targets.push(6);
      for (const base of targets) {
        for (const b of bits) {
          const idx = base + (b === 'r' ? 0 : b === 'w' ? 1 : 2);
          chars[idx] = sign === '+' ? b : '-';
        }
      }
    }
    return chars.join('');
  }

  /* ============================================================
   * 명령어 구현
   * ========================================================== */
  function pwdCmd(args, ctx) {
    return { output: ['/' + ctx.cwd.join('/')] };
  }

  function lsCmd(args, ctx) {
    const flagStr = args.filter((a) => a.startsWith('-')).join('');
    const showAll = flagStr.includes('a');
    const longFmt = flagStr.includes('l');
    const targets = args.filter((a) => !a.startsWith('-'));
    const targetPath = targets[0] || '.';
    const segs = resolvePath(ctx.cwd, targetPath);
    const node = getNode(ctx.root, segs);
    if (!node) return { error: `ls: cannot access '${targetPath}': No such file or directory` };
    if (node.type === 'file') return { output: [targetPath] };
    let names = Object.keys(node.children);
    if (!showAll) names = names.filter((n) => !n.startsWith('.'));
    names.sort((a, b) => a.localeCompare(b));
    if (names.length === 0) return { output: [] };
    if (longFmt) {
      return {
        output: names.map((n) => {
          const c = node.children[n];
          const typeChar = c.type === 'dir' ? 'd' : '-';
          return `${typeChar}${c.perm}  ${n}`;
        }),
      };
    }
    return { output: names };
  }

  function cdCmd(args, ctx) {
    const target = args[0] || '~';
    const segs = resolvePath(ctx.cwd, target);
    const node = getNode(ctx.root, segs);
    if (!node) return { error: `cd: no such file or directory: ${target}` };
    if (node.type !== 'dir') return { error: `cd: not a directory: ${target}` };
    ctx.cwd = segs;
    return { output: [] };
  }

  function catCmd(args, ctx, stdin) {
    if (args.length === 0) {
      if (stdin) return { output: stdin };
      return { error: 'cat: missing operand' };
    }
    let lines = [];
    for (const a of args) {
      const segs = resolvePath(ctx.cwd, a);
      const node = getNode(ctx.root, segs);
      if (!node) return { error: `cat: ${a}: No such file or directory` };
      if (node.type === 'dir') return { error: `cat: ${a}: Is a directory` };
      lines = lines.concat(node.content.split('\n'));
    }
    return { output: lines };
  }

  function echoCmd(args) {
    return { output: [args.join(' ')] };
  }

  function mkdirCmd(args, ctx) {
    if (args.length === 0) return { error: 'mkdir: missing operand' };
    const flagP = args.includes('-p');
    const targets = args.filter((a) => a !== '-p');
    for (const t of targets) {
      const segs = resolvePath(ctx.cwd, t);
      const name = segs.pop();
      if (!name) return { error: `mkdir: cannot create directory '${t}'` };
      let parent;
      if (flagP) {
        parent = ctx.root;
        for (const s of segs) {
          if (!parent.children[s]) parent.children[s] = D({});
          if (parent.children[s].type !== 'dir') return { error: `mkdir: cannot create directory '${t}': Not a directory` };
          parent = parent.children[s];
        }
      } else {
        parent = getNode(ctx.root, segs);
        if (!parent || parent.type !== 'dir') return { error: `mkdir: cannot create directory '${t}': No such file or directory` };
      }
      if (parent.children[name]) return { error: `mkdir: cannot create directory '${t}': File exists` };
      parent.children[name] = D({});
    }
    return { output: [] };
  }

  function touchCmd(args, ctx) {
    if (args.length === 0) return { error: 'touch: missing operand' };
    for (const t of args) {
      const segs = resolvePath(ctx.cwd, t);
      const name = segs.pop();
      if (!name) return { error: `touch: cannot touch '${t}'` };
      const parent = getNode(ctx.root, segs);
      if (!parent || parent.type !== 'dir') return { error: `touch: cannot touch '${t}': No such file or directory` };
      if (!parent.children[name]) parent.children[name] = F('');
    }
    return { output: [] };
  }

  function rmCmd(args, ctx) {
    const recursive = args.includes('-r') || args.includes('-R') || args.includes('-rf') || args.includes('-fr');
    const force = args.includes('-f') || args.includes('-rf') || args.includes('-fr');
    const targets = args.filter((a) => !a.startsWith('-'));
    if (targets.length === 0) return { error: 'rm: missing operand' };
    for (const t of targets) {
      const segs = resolvePath(ctx.cwd, t);
      const name = segs.pop();
      const parent = getNode(ctx.root, segs);
      if (!parent || !parent.children[name]) {
        if (force) continue;
        return { error: `rm: cannot remove '${t}': No such file or directory` };
      }
      const node = parent.children[name];
      if (node.type === 'dir' && !recursive) return { error: `rm: cannot remove '${t}': Is a directory` };
      delete parent.children[name];
    }
    return { output: [] };
  }

  function cpCmd(args, ctx) {
    const recursive = args.includes('-r') || args.includes('-R');
    const targets = args.filter((a) => !a.startsWith('-'));
    if (targets.length < 2) return { error: 'cp: missing file operand' };
    const src = targets[0];
    const destArg = targets[1];
    const srcSegs = resolvePath(ctx.cwd, src);
    const srcNode = getNode(ctx.root, srcSegs);
    if (!srcNode) return { error: `cp: cannot stat '${src}': No such file or directory` };
    if (srcNode.type === 'dir' && !recursive) return { error: `cp: -r not specified; omitting directory '${src}'` };
    const destSegs = resolvePath(ctx.cwd, destArg);
    const destNode = getNode(ctx.root, destSegs);
    let finalParentSegs, finalName;
    if (destNode && destNode.type === 'dir') {
      finalParentSegs = destSegs;
      finalName = srcSegs[srcSegs.length - 1];
    } else {
      finalParentSegs = destSegs.slice(0, -1);
      finalName = destSegs[destSegs.length - 1];
    }
    const parent = getNode(ctx.root, finalParentSegs);
    if (!parent || parent.type !== 'dir') return { error: `cp: cannot create '${destArg}': No such file or directory` };
    parent.children[finalName] = cloneTree(srcNode);
    return { output: [] };
  }

  function mvCmd(args, ctx) {
    const targets = args.filter((a) => !a.startsWith('-'));
    if (targets.length < 2) return { error: 'mv: missing file operand' };
    const src = targets[0];
    const destArg = targets[1];
    const srcSegs = resolvePath(ctx.cwd, src);
    const srcName = srcSegs[srcSegs.length - 1];
    const srcParent = getNode(ctx.root, srcSegs.slice(0, -1));
    if (!srcParent || !srcParent.children[srcName]) return { error: `mv: cannot stat '${src}': No such file or directory` };
    const srcNode = srcParent.children[srcName];
    const destSegs = resolvePath(ctx.cwd, destArg);
    const destNode = getNode(ctx.root, destSegs);
    let finalParentSegs, finalName;
    if (destNode && destNode.type === 'dir') {
      finalParentSegs = destSegs;
      finalName = srcName;
    } else {
      finalParentSegs = destSegs.slice(0, -1);
      finalName = destSegs[destSegs.length - 1];
    }
    const parent = getNode(ctx.root, finalParentSegs);
    if (!parent || parent.type !== 'dir') return { error: `mv: cannot move to '${destArg}': No such file or directory` };
    delete srcParent.children[srcName];
    parent.children[finalName] = srcNode;
    return { output: [] };
  }

  function grepCmd(args, ctx, stdin) {
    const flags = args.filter((a) => a.startsWith('-'));
    const rest = args.filter((a) => !a.startsWith('-'));
    const caseInsensitive = flags.includes('-i');
    const recursive = flags.includes('-r') || flags.includes('-R');
    const pattern = rest[0];
    if (!pattern) return { error: 'grep: missing pattern' };
    const test = caseInsensitive
      ? (l) => l.toLowerCase().includes(pattern.toLowerCase())
      : (l) => l.includes(pattern);

    if (recursive) {
      const startArg = rest[1] || '.';
      const startSegs = resolvePath(ctx.cwd, startArg);
      const startNode = getNode(ctx.root, startSegs);
      if (!startNode) return { error: `grep: ${startArg}: No such file or directory` };
      const output = [];
      (function walk(node, displaySegs) {
        if (node.type === 'dir') {
          for (const name of Object.keys(node.children)) walk(node.children[name], displaySegs.concat([name]));
        } else {
          node.content.split('\n').forEach((line) => {
            if (test(line)) output.push(`${displaySegs.join('/')}: ${line}`);
          });
        }
      })(startNode, [startArg.replace(/\/$/, '')]);
      return { output };
    }

    let lines;
    if (rest.length > 1) {
      const fname = rest[1];
      const segs = resolvePath(ctx.cwd, fname);
      const node = getNode(ctx.root, segs);
      if (!node) return { error: `grep: ${fname}: No such file or directory` };
      if (node.type === 'dir') return { error: `grep: ${fname}: Is a directory` };
      lines = node.content.split('\n');
    } else if (stdin) {
      lines = stdin;
    } else {
      return { error: 'grep: 파일이나 파이프 입력이 필요합니다' };
    }
    return { output: lines.filter(test) };
  }

  function findCmd(args, ctx) {
    let startArg = '.';
    let namePattern = null;
    let typeFilter = null;
    let i = 0;
    if (args[i] && !args[i].startsWith('-')) { startArg = args[i]; i++; }
    while (i < args.length) {
      if (args[i] === '-name') { namePattern = args[i + 1]; i += 2; }
      else if (args[i] === '-type') { typeFilter = args[i + 1]; i += 2; }
      else i++;
    }
    if (!namePattern && !typeFilter) return { error: 'find: -name 또는 -type 옵션이 필요합니다 (예: find . -name "file.txt", find . -type d)' };
    const startSegs = resolvePath(ctx.cwd, startArg);
    const startNode = getNode(ctx.root, startSegs);
    if (!startNode) return { error: `find: '${startArg}': No such file or directory` };
    const regex = namePattern ? wildcardToRegex(namePattern) : null;
    const results = [];
    (function walk(node, displaySegs) {
      if (node.type !== 'dir') return;
      for (const name of Object.keys(node.children)) {
        const child = node.children[name];
        const newDisplay = displaySegs.concat([name]);
        const nameMatches = regex ? regex.test(name) : true;
        const typeMatches = typeFilter ? (typeFilter === 'd' ? child.type === 'dir' : child.type === 'file') : true;
        if (nameMatches && typeMatches) results.push(newDisplay.join('/'));
        walk(child, newDisplay);
      }
    })(startNode, [startArg.replace(/\/$/, '')]);
    return { output: results };
  }

  function chmodCmd(args, ctx) {
    if (args.length < 2) return { error: 'chmod: missing operand' };
    const mode = args[0];
    const target = args[1];
    const segs = resolvePath(ctx.cwd, target);
    const node = getNode(ctx.root, segs);
    if (!node) return { error: `chmod: cannot access '${target}': No such file or directory` };
    let newPerm;
    if (/^[0-7]{3,4}$/.test(mode)) {
      const digits = mode.length === 4 ? mode.slice(1) : mode;
      newPerm = digits.split('').map((d) => PERM_TABLE[+d]).join('');
    } else {
      newPerm = applySymbolicChmod(node.perm, mode);
      if (!newPerm) return { error: `chmod: invalid mode: '${mode}'` };
    }
    node.perm = newPerm;
    return { output: [] };
  }

  function wcCmd(args, ctx, stdin) {
    const flags = args.filter((a) => a.startsWith('-'));
    const rest = args.filter((a) => !a.startsWith('-'));
    let content, name = null;
    if (rest.length > 0) {
      name = rest[0];
      const segs = resolvePath(ctx.cwd, name);
      const node = getNode(ctx.root, segs);
      if (!node) return { error: `wc: ${name}: No such file or directory` };
      if (node.type === 'dir') return { error: `wc: ${name}: Is a directory` };
      content = node.content;
    } else if (stdin) {
      content = stdin.join('\n');
    } else {
      return { error: 'wc: 파일이나 파이프 입력이 필요합니다' };
    }
    const lineCount = content === '' ? 0 : content.split('\n').length;
    const wordCount = content.trim() === '' ? 0 : content.trim().split(/\s+/).length;
    const charCount = content.length;
    let parts = [];
    if (flags.includes('-l')) parts.push(String(lineCount));
    else if (flags.includes('-w')) parts.push(String(wordCount));
    else if (flags.includes('-c')) parts.push(String(charCount));
    else parts.push(String(lineCount), String(wordCount), String(charCount));
    if (name) parts.push(name);
    return { output: [parts.join(' ')] };
  }

  function parseCountFlag(args, defaultN) {
    let n = defaultN;
    const rest = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-n') { n = parseInt(args[i + 1], 10) || defaultN; i++; }
      else if (/^-n\d+$/.test(args[i])) { n = parseInt(args[i].slice(2), 10); }
      else rest.push(args[i]);
    }
    return { n, rest };
  }

  function headCmd(args, ctx, stdin) {
    const { n, rest } = parseCountFlag(args, 10);
    let lines;
    if (rest.length > 0) {
      const segs = resolvePath(ctx.cwd, rest[0]);
      const node = getNode(ctx.root, segs);
      if (!node) return { error: `head: ${rest[0]}: No such file or directory` };
      if (node.type === 'dir') return { error: `head: ${rest[0]}: Is a directory` };
      lines = node.content.split('\n');
    } else if (stdin) {
      lines = stdin;
    } else {
      return { error: 'head: 파일이나 파이프 입력이 필요합니다' };
    }
    return { output: lines.slice(0, n) };
  }

  function tailCmd(args, ctx, stdin) {
    const { n, rest } = parseCountFlag(args, 10);
    let lines;
    if (rest.length > 0) {
      const segs = resolvePath(ctx.cwd, rest[0]);
      const node = getNode(ctx.root, segs);
      if (!node) return { error: `tail: ${rest[0]}: No such file or directory` };
      if (node.type === 'dir') return { error: `tail: ${rest[0]}: Is a directory` };
      lines = node.content.split('\n');
    } else if (stdin) {
      lines = stdin;
    } else {
      return { error: 'tail: 파일이나 파이프 입력이 필요합니다' };
    }
    return { output: lines.slice(-n) };
  }

  function sortCmd(args, ctx, stdin) {
    const reverse = args.includes('-r');
    const numeric = args.includes('-n');
    const rest = args.filter((a) => !a.startsWith('-'));
    let lines;
    if (rest.length > 0) {
      const segs = resolvePath(ctx.cwd, rest[0]);
      const node = getNode(ctx.root, segs);
      if (!node) return { error: `sort: ${rest[0]}: No such file or directory` };
      if (node.type === 'dir') return { error: `sort: ${rest[0]}: Is a directory` };
      lines = node.content.split('\n');
    } else if (stdin) {
      lines = stdin;
    } else {
      return { error: 'sort: 파일이나 파이프 입력이 필요합니다' };
    }
    const sorted = lines.slice().sort((a, b) => (numeric ? parseFloat(a) - parseFloat(b) : a.localeCompare(b)));
    if (reverse) sorted.reverse();
    return { output: sorted };
  }

  function uniqCmd(args, ctx, stdin) {
    const showCount = args.includes('-c');
    const rest = args.filter((a) => !a.startsWith('-'));
    let lines;
    if (rest.length > 0) {
      const segs = resolvePath(ctx.cwd, rest[0]);
      const node = getNode(ctx.root, segs);
      if (!node) return { error: `uniq: ${rest[0]}: No such file or directory` };
      if (node.type === 'dir') return { error: `uniq: ${rest[0]}: Is a directory` };
      lines = node.content.split('\n');
    } else if (stdin) {
      lines = stdin;
    } else {
      return { error: 'uniq: 파일이나 파이프 입력이 필요합니다' };
    }
    const output = [];
    const rawLast = [];
    for (const line of lines) {
      if (rawLast.length > 0 && rawLast[rawLast.length - 1] === line) {
        if (showCount) {
          const idx = output.length - 1;
          const m = output[idx].match(/^(\d+) (.*)$/);
          output[idx] = `${parseInt(m[1], 10) + 1} ${m[2]}`;
        }
        continue;
      }
      output.push(showCount ? `1 ${line}` : line);
      rawLast.push(line);
    }
    return { output };
  }

  /* ---------- 프로세스 / 네트워크 (가상 프로세스 목록 기반) ---------- */
  function psCmd(args, ctx) {
    const procs = ctx.processes || [];
    if (args.includes('aux')) {
      const header = 'USER       PID  %CPU %MEM COMMAND';
      const lines = procs.map((p) => `user    ${String(p.pid).padEnd(7)}${p.cpu.toFixed(1).padStart(4)} ${p.mem.toFixed(1).padStart(4)} ${p.name}`);
      return { output: [header, ...lines] };
    }
    const header = '  PID CMD';
    const lines = procs.map((p) => `${String(p.pid).padStart(5)} ${p.name}`);
    return { output: [header, ...lines] };
  }

  function killCmd(args, ctx) {
    const force = args.includes('-9') || args.includes('-KILL') || args.includes('-SIGKILL');
    const pidArgs = args.filter((a) => !a.startsWith('-'));
    if (pidArgs.length === 0) return { error: 'kill: usage: kill [-9] pid' };
    const procs = ctx.processes || [];
    for (const pidStr of pidArgs) {
      const pid = parseInt(pidStr, 10);
      const idx = procs.findIndex((p) => p.pid === pid);
      if (idx === -1) return { error: `kill: (${pid}): No such process` };
      const proc = procs[idx];
      if (proc.stubborn && !force) continue;
      procs.splice(idx, 1);
    }
    return { output: [] };
  }

  function netstatCmd(args, ctx) {
    const procs = (ctx.processes || []).filter((p) => p.port);
    if (procs.length === 0) return { output: ['(열려있는 포트가 없습니다)'] };
    const header = 'Proto  Local Address        PID/Program name';
    const lines = procs.map((p) => `tcp    0.0.0.0:${p.port}         ${p.pid}/${p.name}`);
    return { output: [header, ...lines] };
  }

  function lsofCmd(args, ctx) {
    const joined = args.join(' ');
    const m = joined.match(/:(\d+)/);
    if (!m) return { error: 'lsof: usage: lsof -i :PORT' };
    const port = parseInt(m[1], 10);
    const proc = (ctx.processes || []).find((p) => p.port === port);
    if (!proc) return { output: [] };
    const header = 'COMMAND     PID USER   TYPE   NAME';
    const line = `${proc.name.padEnd(10)} ${String(proc.pid).padEnd(6)} user  IPv4   *:${proc.port} (LISTEN)`;
    return { output: [header, line] };
  }

  function curlCmd(args, ctx) {
    const flags = args.filter((a) => a.startsWith('-'));
    const headOnly = flags.includes('-I') || flags.includes('-i');
    const urlArg = args.find((a) => !a.startsWith('-'));
    if (!urlArg) return { error: "curl: try 'curl --help' for more information" };
    const m = urlArg.match(/^https?:\/\/[^:/]+(?::(\d+))?/);
    const port = m && m[1] ? parseInt(m[1], 10) : 80;
    const proc = (ctx.processes || []).find((p) => p.port === port);
    if (!proc) return { error: `curl: (7) Failed to connect to port ${port}: Connection refused` };
    const status = proc.httpStatus || 200;
    if (headOnly) return { output: [`HTTP/1.1 ${status} ${status === 200 ? 'OK' : 'Error'}`, 'Content-Type: application/json'] };
    return { output: [proc.response || '{"status":"ok"}'] };
  }

  function sleepCmd() { return { output: [] }; }

  function nohupCmd(args, ctx, stdin) {
    const inner = args[0];
    if (!inner) return { error: 'nohup: missing operand' };
    const fn = COMMANDS[inner];
    if (!fn) return { error: `nohup: failed to run command '${inner}': No such file or directory` };
    return fn(args.slice(1), ctx, stdin) || {};
  }

  function jobsCmd(args, ctx) {
    const jobs = ctx.jobs || [];
    if (jobs.length === 0) return { output: ['표시할 백그라운드 작업이 없습니다.'] };
    return { output: jobs.map((j) => `[${j.id}]+  Running                 ${j.cmd} &`) };
  }

  /* ---------- 텍스트 처리 심화 ---------- */
  function sedCmd(args, ctx, stdin) {
    const script = args.find((a) => a.startsWith('s/'));
    if (!script) return { error: "sed: -e expression #1, char 0: no previous regular expression" };
    const m = script.match(/^s\/(.*)\/(.*)\/(g)?$/);
    if (!m) return { error: `sed: invalid script: ${script}` };
    const pattern = m[1];
    const replacement = m[2];
    const gflag = m[3];
    const rest = args.filter((a) => a !== script);
    let lines;
    if (rest.length > 0) {
      const segs = resolvePath(ctx.cwd, rest[0]);
      const node = getNode(ctx.root, segs);
      if (!node) return { error: `sed: can't read ${rest[0]}: No such file or directory` };
      if (node.type === 'dir') return { error: `sed: ${rest[0]}: Is a directory` };
      lines = node.content.split('\n');
    } else if (stdin) {
      lines = stdin;
    } else {
      return { error: 'sed: 파일이나 파이프 입력이 필요합니다' };
    }
    const output = lines.map((line) => (gflag ? line.split(pattern).join(replacement) : line.replace(pattern, replacement)));
    return { output };
  }

  function awkCmd(args, ctx, stdin) {
    let delim = null;
    const rest = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-F') { delim = args[i + 1]; i++; }
      else if (args[i].startsWith('-F') && args[i].length > 2) { delim = args[i].slice(2); }
      else rest.push(args[i]);
    }
    const script = rest.find((a) => a.includes('print'));
    if (!script) return { error: 'awk: syntax error' };
    const fm = script.match(/\$(\d+)/);
    const fieldNum = fm ? parseInt(fm[1], 10) : 0;
    const fileArgs = rest.filter((a) => a !== script);
    let lines;
    if (fileArgs.length > 0) {
      const segs = resolvePath(ctx.cwd, fileArgs[0]);
      const node = getNode(ctx.root, segs);
      if (!node) return { error: `awk: can't open file ${fileArgs[0]}` };
      if (node.type === 'dir') return { error: `awk: ${fileArgs[0]}: Is a directory` };
      lines = node.content.split('\n');
    } else if (stdin) {
      lines = stdin;
    } else {
      return { error: 'awk: 파일이나 파이프 입력이 필요합니다' };
    }
    const output = lines.map((line) => {
      if (fieldNum === 0) return line;
      const fields = delim ? line.split(delim) : line.trim().split(/\s+/);
      return fields[fieldNum - 1] !== undefined ? fields[fieldNum - 1] : '';
    });
    return { output };
  }

  function xargsCmd(args, ctx, stdin) {
    if (!stdin) return { error: 'xargs: 파이프 입력이 필요합니다' };
    const cmdName = args[0];
    if (!cmdName) return { error: 'xargs: 실행할 명령어가 필요합니다' };
    const fixedArgs = args.slice(1);
    const fn = COMMANDS[cmdName];
    if (!fn) return { error: `xargs: ${cmdName}: command not found` };
    let combined = [];
    for (const line of stdin) {
      if (!line) continue;
      const result = fn(fixedArgs.concat([line]), ctx, null) || {};
      if (result.error) return { error: result.error };
      combined = combined.concat(result.output || []);
    }
    return { output: combined };
  }

  /* ---------- 서비스 / 시스템 상태 (가상 서비스 목록·고정 테이블 기반) ---------- */
  function systemctlCmd(args, ctx) {
    const action = args[0];
    const svcName = args[1];
    const services = ctx.services || [];
    if (!action) return { error: 'systemctl: usage: systemctl [status|start|stop|restart] <service>' };
    if (!svcName) return { error: 'systemctl: 서비스 이름이 필요합니다' };
    const svc = services.find((s) => s.name === svcName);
    if (!svc) return { error: `Unit ${svcName}.service could not be found.` };
    if (action === 'status') {
      const statusLine = svc.status === 'active' ? 'active (running)' : svc.status === 'failed' ? 'failed (Result: exit-code)' : 'inactive (dead)';
      return { output: [`● ${svc.name}.service`, `   Active: ${statusLine}`] };
    }
    if (action === 'start' || action === 'restart') { svc.status = 'active'; return { output: [] }; }
    if (action === 'stop') { svc.status = 'inactive'; return { output: [] }; }
    if (action === 'enable') { return { output: [`Created symlink /etc/systemd/system/multi-user.target.wants/${svc.name}.service`] }; }
    return { error: `systemctl: unknown action '${action}'` };
  }

  function journalctlCmd(args, ctx) {
    const idx = args.indexOf('-u');
    const svcName = idx !== -1 ? args[idx + 1] : null;
    if (!svcName) return { error: 'journalctl: -u 옵션으로 서비스 이름을 지정해주세요 (예: journalctl -u nginx)' };
    const svc = (ctx.services || []).find((s) => s.name === svcName);
    if (!svc) return { output: ['-- No entries --'] };
    return { output: svc.logs && svc.logs.length ? svc.logs : ['-- No entries --'] };
  }

  function dfCmd(args, ctx) { return { output: ctx.diskOutput || [] }; }
  function duCmd(args, ctx) { return { output: ctx.duOutput || [] }; }
  function freeCmd(args, ctx) { return { output: ctx.memOutput || [] }; }

  /* ---------- Docker (가상 컨테이너 목록 기반) ---------- */
  function findContainer(ctx, name) {
    if (!name) return null;
    return (ctx.containers || []).find((c) => c.name === name || c.id.startsWith(name));
  }

  function dockerCmd(args, ctx) {
    const sub = args[0];
    const rest = args.slice(1);
    const containers = ctx.containers || [];
    if (!sub) return { error: "docker: 'docker --help' for more information" };

    if (sub === 'ps') {
      const showAll = rest.includes('-a');
      const list = showAll ? containers : containers.filter((c) => c.status === 'running');
      const header = 'CONTAINER ID   IMAGE           STATUS          PORTS                    NAMES';
      const lines = list.map((c) => {
        const statusText = c.status === 'running' ? 'Up' : 'Exited';
        return `${c.id.slice(0, 12).padEnd(14)} ${c.image.padEnd(15)} ${statusText.padEnd(15)} ${(c.ports || '').padEnd(24)} ${c.name}`;
      });
      return { output: [header, ...lines] };
    }
    if (sub === 'logs') {
      const name = rest.find((a) => !a.startsWith('-'));
      const c = findContainer(ctx, name);
      if (!c) return { error: `Error: No such container: ${name}` };
      return { output: c.logs && c.logs.length ? c.logs : [] };
    }
    if (sub === 'images') {
      const images = ctx.images || [];
      const header = 'REPOSITORY   TAG      IMAGE ID       SIZE';
      const lines = images.map((i) => `${i.repo.padEnd(12)} ${i.tag.padEnd(8)} ${i.id.padEnd(14)} ${i.size}`);
      return { output: [header, ...lines] };
    }
    if (sub === 'stop' || sub === 'start' || sub === 'restart') {
      const name = rest[0];
      const c = findContainer(ctx, name);
      if (!c) return { error: `Error response from daemon: No such container: ${name}` };
      c.status = sub === 'stop' ? 'exited' : 'running';
      return { output: [c.name] };
    }
    if (sub === 'rm') {
      const name = rest.find((a) => !a.startsWith('-'));
      const idx = containers.findIndex((c) => c.name === name || c.id.startsWith(name || ''));
      if (idx === -1) return { error: `Error: No such container: ${name}` };
      if (containers[idx].status === 'running') return { error: 'Error response from daemon: You cannot remove a running container. Stop the container before attempting removal or force remove' };
      containers.splice(idx, 1);
      return { output: [name] };
    }
    return { error: `docker: '${sub}' is not a docker command.` };
  }

  function whoamiCmd() { return { output: ['user'] }; }
  function clearCmd() { return { output: [], clear: true }; }

  const MAN_PAGES = {
    pwd: 'pwd - 현재 작업 디렉터리의 절대 경로를 출력합니다.',
    ls: 'ls [-a] [-l] [경로] - 디렉터리 내용을 나열합니다. -a: 숨김 파일 포함, -l: 상세 정보(권한) 포함',
    cd: 'cd [경로] - 지정한 경로로 이동합니다. 경로 생략 시 홈 디렉터리(~)로 이동',
    cat: 'cat 파일 [파일...] - 파일 내용을 화면에 출력합니다.',
    echo: 'echo 문자열 [> 또는 >> 파일] - 문자열을 출력하거나, 리다이렉션으로 파일에 씁니다.',
    mkdir: 'mkdir [-p] 디렉터리 - 새 디렉터리를 생성합니다.',
    touch: 'touch 파일 - 빈 파일을 생성합니다(이미 있으면 변화 없음).',
    rm: 'rm [-r] [-f] 대상 - 파일을 삭제합니다. -r: 디렉터리 재귀 삭제, -f: 에러 무시',
    cp: 'cp [-r] 원본 대상 - 파일이나(-r 옵션 시) 디렉터리를 복사합니다.',
    mv: 'mv 원본 대상 - 파일/디렉터리를 이동하거나 이름을 변경합니다.',
    grep: 'grep [-i] [-r] 패턴 [파일] - 파일에서 패턴이 포함된 줄을 찾습니다. -i: 대소문자 무시, -r: 폴더 전체 재귀 검색',
    find: 'find 경로 [-name 패턴] [-type f|d] - 경로 하위 전체에서 이름/종류가 일치하는 항목을 찾습니다.',
    chmod: 'chmod 모드 파일 - 파일 권한을 변경합니다. (예: chmod 755 file, chmod u+x file)',
    wc: 'wc [-l|-w|-c] 파일 - 파일의 줄 수/단어 수/문자 수를 셉니다.',
    head: 'head [-n N] 파일 - 파일의 앞부분 N줄(기본 10줄)을 출력합니다.',
    tail: 'tail [-n N] 파일 - 파일의 마지막 N줄(기본 10줄)을 출력합니다.',
    sort: 'sort [-r] [-n] 파일 - 줄을 정렬합니다. -r: 역순, -n: 숫자로 정렬',
    uniq: 'uniq [-c] 파일 - 바로 위 줄과 같은 중복 줄을 제거합니다. (보통 sort와 함께 사용) -c: 중복 횟수 표시',
    ps: 'ps aux - 실행 중인 프로세스를 CPU/메모리 사용률과 함께 표시합니다.',
    kill: 'kill [-9] PID - 프로세스를 종료합니다. -9(SIGKILL): 강제 종료',
    netstat: 'netstat -tlnp / ss -tlnp - 현재 열려있는(listen) 포트와 프로세스를 표시합니다.',
    lsof: 'lsof -i :포트 - 특정 포트를 점유 중인 프로세스를 찾습니다.',
    curl: 'curl [-I] URL - HTTP 요청을 보내 응답을 확인합니다. -I: 헤더(상태 코드)만 확인',
    sleep: 'sleep N - N초간 대기합니다. (백그라운드 실행 연습용 예제 명령어)',
    nohup: 'nohup 명령어 & - 세션이 끊겨도(SIGHUP) 죽지 않도록 명령을 실행합니다. 보통 &와 함께 씁니다.',
    jobs: 'jobs - &로 실행한 백그라운드 작업 목록을 표시합니다.',
    sed: "sed 's/찾을값/바꿀값/[g]' 파일 - 문자열을 치환해서 출력합니다.",
    awk: "awk [-F구분자] '{print $N}' 파일 - 구분자로 나눈 N번째 값만 추출합니다.",
    xargs: '명령1 | xargs 명령2 - 앞 명령의 출력 각각에 대해 명령2를 반복 실행합니다.',
    systemctl: 'systemctl [status|start|stop|restart] 서비스명 - systemd 서비스를 관리합니다.',
    journalctl: 'journalctl -u 서비스명 - 특정 서비스의 상세 로그를 확인합니다.',
    df: 'df -h - 디스크 파티션별 사용 용량을 확인합니다.',
    du: 'du -sh 경로 - 폴더별 사용 용량을 확인합니다.',
    free: 'free -m - 메모리 사용량을 확인합니다.',
    docker: 'docker [ps|logs|images|stop|start|restart|rm] ... - 도커 컨테이너를 관리합니다. (예: docker ps -a, docker logs 이름)',
    vi: 'vi 파일 / vim 파일 - vi 편집기로 파일을 엽니다. i(입력모드), Esc(정상모드), :wq(저장후종료), :q!(강제종료), dd(줄삭제), o(줄추가)',
    whoami: 'whoami - 현재 로그인한 사용자 이름을 출력합니다.',
    clear: 'clear - 터미널 화면을 지웁니다.',
    help: 'help - 사용 가능한 명령어 목록을 보여줍니다.',
    man: 'man 명령어 - 명령어에 대한 설명서를 봅니다.',
    history: 'history - 지금까지 입력한 명령어 기록을 보여줍니다.',
  };

  function helpCmd() {
    return { output: Object.values(MAN_PAGES) };
  }
  function manCmd(args) {
    const c = args[0];
    const d = MAN_PAGES[c];
    return { output: d ? [d] : [`해당 명령어에 대한 매뉴얼이 없습니다: ${c}`] };
  }
  function historyCmd(args, ctx) {
    return { output: ctx.history.map((h, i) => `${i + 1}  ${h}`) };
  }

  const COMMANDS = {
    pwd: pwdCmd, ls: lsCmd, cd: cdCmd, cat: catCmd, echo: echoCmd,
    mkdir: mkdirCmd, touch: touchCmd, rm: rmCmd, cp: cpCmd, mv: mvCmd,
    grep: grepCmd, find: findCmd, chmod: chmodCmd, wc: wcCmd,
    head: headCmd, tail: tailCmd, sort: sortCmd, uniq: uniqCmd,
    ps: psCmd, kill: killCmd, netstat: netstatCmd, ss: netstatCmd, lsof: lsofCmd,
    curl: curlCmd, sleep: sleepCmd, nohup: nohupCmd, jobs: jobsCmd,
    sed: sedCmd, awk: awkCmd, xargs: xargsCmd,
    systemctl: systemctlCmd, journalctl: journalctlCmd, df: dfCmd, du: duCmd, free: freeCmd,
    docker: dockerCmd,
    whoami: whoamiCmd, clear: clearCmd, help: helpCmd, man: manCmd, history: historyCmd,
  };

  /* ============================================================
   * 실행 엔진 (파이프 / 리다이렉션 지원)
   * ========================================================== */
  function writeToFile(ctx, filePath, content, append) {
    const segs = resolvePath(ctx.cwd, filePath);
    const name = segs.pop();
    const parent = getNode(ctx.root, segs);
    if (!parent || parent.type !== 'dir') return;
    let node = parent.children[name];
    if (!node) { node = F(''); parent.children[name] = node; }
    if (node.type === 'dir') return;
    node.content = append ? (node.content ? node.content + '\n' + content : content) : content;
  }

  function executePipeline(raw, ctx) {
    const stages = raw.split('|').map((s) => s.trim()).filter((s) => s.length > 0);
    let stdin = null;
    let finalOutput = [];
    let error = null;
    let clear = false;
    let lastCmdName = null;
    let lastArgs = [];

    for (let i = 0; i < stages.length; i++) {
      const isLast = i === stages.length - 1;
      let tokens = tokenize(stages[i]);
      let targetFile = null;
      let appendMode = false;
      if (isLast) {
        const gtIdx = tokens.findIndex((t) => t === '>' || t === '>>');
        if (gtIdx !== -1) {
          appendMode = tokens[gtIdx] === '>>';
          targetFile = tokens[gtIdx + 1];
          tokens = tokens.slice(0, gtIdx);
        }
      }
      if (tokens.length === 0) { error = 'syntax error near unexpected token'; break; }
      const cmdName = tokens[0];
      const cmdArgs = tokens.slice(1);
      lastCmdName = cmdName;
      lastArgs = cmdArgs;
      const fn = COMMANDS[cmdName];
      if (!fn) { error = `${cmdName}: command not found`; break; }
      const result = fn(cmdArgs, ctx, stdin) || {};
      if (result.error) { error = result.error; break; }
      if (result.clear) clear = true;
      finalOutput = result.output || [];
      stdin = finalOutput;
      if (isLast && targetFile) {
        writeToFile(ctx, targetFile, finalOutput.join('\n'), appendMode);
        finalOutput = [];
      }
    }

    return { output: finalOutput, error, clear, cmdName: lastCmdName, args: lastArgs, raw };
  }

  /* &&, ; 로 여러 명령을 한 줄에 이어붙이는 체이닝. &&는 앞 명령이 성공해야 다음을 실행, ;는 항상 다음을 실행.
     맨 끝에 단독 & 가 붙으면 백그라운드 작업(jobs)으로 등록한다. */
  function executeChain(raw, ctx) {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    ctx.history.push(trimmed);

    let execLine = trimmed;
    let background = false;
    if (execLine.endsWith('&') && !execLine.endsWith('&&')) {
      background = true;
      execLine = execLine.slice(0, -1).trim();
    }

    const parts = execLine.split(/(&&|;)/).map((s) => s.trim()).filter((s) => s.length > 0);
    const segments = [];
    let skipDueToError = false;
    let pendingSep = null;
    for (const part of parts) {
      if (part === '&&' || part === ';') { pendingSep = part; continue; }
      if (pendingSep === '&&' && skipDueToError) { pendingSep = null; continue; }
      const segResult = executePipeline(part, ctx);
      segments.push(segResult);
      skipDueToError = !!segResult.error;
      pendingSep = null;
    }

    let backgroundJob = null;
    if (background && segments.length > 0 && !skipDueToError) {
      ctx.jobs = ctx.jobs || [];
      backgroundJob = { id: ctx.jobs.length + 1, pid: 10000 + ctx.jobs.length, cmd: execLine };
      ctx.jobs.push(backgroundJob);
    }

    return { segments, raw: trimmed, backgroundJob };
  }

  /* ============================================================
   * 미션 데이터 (js/missions.js)
   * ========================================================== */
  const MISSIONS = window.LINUX_MISSIONS_FACTORY({ D, F, HOME_PATH, getNodeFromHome, arraysEqual });

  /* ============================================================
   * 게임 상태 / 저장
   * ========================================================== */
  const STORAGE_KEY = 'linuxQuestProgress_v1';
  // XP·레벨·티어 규칙은 ../shared/dq.js 의 공용 규칙을 써요 (과목 간 동일)
  const dqBar = window.DevQuest.mountBar('linux');
  const MISSION_ITEMS = MISSIONS.map((m) => ({ id: m.id, difficulty: m.difficulty }));

  const DIFFICULTY_META = {
    easy: { label: '초급', stars: '★☆☆', className: 'diff-easy' },
    medium: { label: '중급', stars: '★★☆', className: 'diff-medium' },
    hard: { label: '고급', stars: '★★★', className: 'diff-hard' },
  };

  const game = {
    ctx: null,
    currentIndex: 0,
    completed: new Set(),
    hintIndex: 0,
    historyPointer: 0,
  };

  let viState = null;

  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }
  function saveProgress() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      currentIndex: game.currentIndex,
      completed: Array.from(game.completed),
    }));
  }
  function isUnlocked(i) {
    return i === 0 || game.completed.has(MISSIONS[i - 1].id);
  }

  /* ============================================================
   * DOM 참조
   * ========================================================== */
  const el = {
    missionList: document.getElementById('missionList'),
    missionListDetails: document.getElementById('missionListDetails'),
    currentMissionLabel: document.getElementById('currentMissionLabel'),
    missionTitle: document.getElementById('missionTitle'),
    missionDesc: document.getElementById('missionDesc'),
    hintBtn: document.getElementById('hintBtn'),
    hintText: document.getElementById('hintText'),
    conceptBtn: document.getElementById('conceptBtn'),
    conceptText: document.getElementById('conceptText'),
    resetMissionBtn: document.getElementById('resetMissionBtn'),
    terminalOutput: document.getElementById('terminalOutput'),
    terminalInput: document.getElementById('terminalInput'),
    terminalInputLine: document.getElementById('terminalInputLine'),
    terminalWindow: document.getElementById('terminalWindow'),
    promptLabel: document.getElementById('promptLabel'),
    viBuffer: document.getElementById('viBuffer'),
    viStatusBar: document.getElementById('viStatusBar'),
    cheatSheetBtn: document.getElementById('cheatSheetBtn'),
    cheatSheetModal: document.getElementById('cheatSheetModal'),
    cheatSheetList: document.getElementById('cheatSheetList'),
    closeCheatSheet: document.getElementById('closeCheatSheet'),
  };

  function promptString() {
    return `user@linux-game:${displayPath(game.ctx.cwd)}$`;
  }

  function updatePromptLabel() {
    el.promptLabel.textContent = promptString();
  }

  function appendLine(text, className) {
    const div = document.createElement('div');
    div.className = 'line ' + className;
    div.textContent = text;
    el.terminalOutput.appendChild(div);
  }

  function appendPromptLine(raw) {
    const div = document.createElement('div');
    div.className = 'line prompt-line';
    const echoSpan = document.createElement('span');
    echoSpan.className = 'prompt-echo';
    echoSpan.textContent = 'user@linux-game:';
    const pathSpan = document.createElement('span');
    pathSpan.className = 'path-echo';
    pathSpan.textContent = displayPath(game.ctx.cwd);
    const dollarSpan = document.createElement('span');
    dollarSpan.className = 'prompt-echo';
    dollarSpan.textContent = '$ ';
    const cmdSpan = document.createElement('span');
    cmdSpan.className = 'cmd-text';
    cmdSpan.textContent = raw;
    div.appendChild(echoSpan);
    div.appendChild(pathSpan);
    div.appendChild(dollarSpan);
    div.appendChild(cmdSpan);
    el.terminalOutput.appendChild(div);
  }

  function scrollTerminalToBottom() {
    el.terminalOutput.scrollTop = el.terminalOutput.scrollHeight;
  }

  function spawnConfetti() {
    const emojis = ['🎉', '✨', '🐧', '⭐'];
    for (let i = 0; i < 14; i++) {
      const span = document.createElement('span');
      span.className = 'confetti';
      span.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      span.style.left = Math.random() * 100 + 'vw';
      span.style.animationDuration = 1.6 + Math.random() * 1.2 + 's';
      document.body.appendChild(span);
      setTimeout(() => span.remove(), 3000);
    }
  }

  function appendSuccessBanner(mission) {
    const wrap = document.createElement('div');
    wrap.className = 'success-banner';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = '✅ 미션 성공! ' + mission.title;
    const xp = document.createElement('div');
    xp.className = 'xp';
    xp.textContent = `+${window.DevQuest.diffMeta(mission.difficulty).xp} XP 획득`;
    wrap.appendChild(title);
    wrap.appendChild(xp);

    const nextIndex = game.currentIndex + 1;
    if (nextIndex < MISSIONS.length) {
      const btn = document.createElement('button');
      btn.textContent = '다음 퀘스트 ▶';
      btn.addEventListener('click', () => loadMission(nextIndex));
      wrap.appendChild(btn);
    } else {
      const done = document.createElement('div');
      done.className = 'title';
      done.style.marginTop = '6px';
      done.textContent = '🏆 모든 미션 클리어! 당신은 이제 리눅스 명령어를 다루는 SI 개발자입니다.';
      wrap.appendChild(done);
    }
    el.terminalOutput.appendChild(wrap);
    spawnConfetti();
  }

  function renderHeader() {
    dqBar.update(window.DevQuest.stats(MISSION_ITEMS, Array.from(game.completed)));
  }

  function renderSidebar() {
    // 다시 그려도 사용자가 펼쳐 둔 분류는 유지하고, 지금 미션이 속한 분류는 항상 펼친다
    const opened = new Set(Array.from(el.missionList.querySelectorAll('details.dq-cat[open]')).map((d) => d.dataset.cat));
    const first = el.missionList.children.length === 0;
    const currentCat = MISSIONS[game.currentIndex] && MISSIONS[game.currentIndex].category;
    const DQ = window.DevQuest;
    el.missionList.innerHTML = (window.LINUX_CATEGORIES || []).map((cat) => {
      const entries = MISSIONS.map((m, i) => ({ m, i })).filter((x) => x.m.category === cat.id);
      if (!entries.length) return '';
      const items = entries.map(({ m, i }) => DQ.itemHtml({
        id: m.id, title: m.title, difficulty: m.difficulty, done: game.completed.has(m.id), locked: !isUnlocked(i), active: i === game.currentIndex,
      })).join('');
      const done = entries.filter((x) => game.completed.has(x.m.id)).length;
      return DQ.catHtml({ id: cat.id, icon: cat.icon, label: cat.label, desc: cat.desc, done, total: entries.length }, items, cat.id === currentCat || (!first && opened.has(cat.id)));
    }).join('');
    const current = MISSIONS[game.currentIndex];
    if (current) el.currentMissionLabel.textContent = '· ' + current.title;
  }

  el.missionList.addEventListener('click', (e) => {
    const btn = e.target.closest('.dq-item');
    if (!btn || btn.classList.contains('locked')) return;
    loadMission(MISSIONS.findIndex((m) => m.id === btn.dataset.id));
    if (window.matchMedia('(max-width: 700px)').matches) el.missionListDetails.removeAttribute('open');
  });

  function renderMissionBrief(mission) {
    const diff = DIFFICULTY_META[mission.difficulty];
    el.missionTitle.innerHTML = '';
    const titleText = document.createElement('span');
    titleText.textContent = mission.title;
    const diffTag = document.createElement('span');
    diffTag.className = 'diff-tag ' + diff.className;
    diffTag.textContent = `${diff.stars} ${diff.label}`;
    el.missionTitle.appendChild(titleText);
    el.missionTitle.appendChild(diffTag);
    el.missionDesc.textContent = mission.desc;
    el.hintText.textContent = '';
    el.hintText.classList.add('hidden');
    game.hintIndex = 0;
    el.conceptText.textContent = '';
    el.conceptText.classList.add('hidden');
    el.conceptBtn.classList.toggle('hidden', !mission.concept);
  }

  function clearTerminalDOM() {
    el.terminalOutput.innerHTML = '';
  }

  function loadMission(index) {
    if (viState) closeViEditor(false, true);
    const mission = MISSIONS[index];
    game.currentIndex = index;
    game.ctx = {
      root: buildRoot(cloneTree(mission.fs || {})),
      cwd: HOME_PATH.slice(),
      history: [],
      processes: mission.processes ? cloneTree(mission.processes) : [],
      services: mission.services ? cloneTree(mission.services) : [],
      containers: mission.containers ? cloneTree(mission.containers) : [],
      images: mission.images ? cloneTree(mission.images) : [],
      jobs: [],
      diskOutput: mission.diskOutput || null,
      duOutput: mission.duOutput || null,
      memOutput: mission.memOutput || null,
    };
    game.historyPointer = 0;
    clearTerminalDOM();
    appendLine(`=== ${mission.title} ===`, 'system-line');
    appendLine('명령어를 입력하고 Enter를 눌러 미션을 해결하세요. (도움이 필요하면 "help" 입력)', 'system-line');
    renderMissionBrief(mission);
    updatePromptLabel();
    renderSidebar();
    saveProgress();
    el.terminalInput.focus();
  }

  function completeMission() {
    const mission = MISSIONS[game.currentIndex];
    if (game.completed.has(mission.id)) return;
    game.completed.add(mission.id);
    saveProgress();
    appendSuccessBanner(mission);
    renderHeader();
    renderSidebar();
  }

  function handleSubmit() {
    const raw = el.terminalInput.value;
    if (raw.trim() === '') return;
    if (/^(vi|vim)\s+\S+/.test(raw.trim())) {
      appendPromptLine(raw);
      game.ctx.history.push(raw.trim());
      el.terminalInput.value = '';
      updatePromptLabel();
      openViEditor(raw.trim());
      return;
    }
    appendPromptLine(raw);
    const chainResult = executeChain(raw, game.ctx);
    el.terminalInput.value = '';
    game.historyPointer = game.ctx.history.length;
    if (!chainResult) { updatePromptLabel(); return; }

    let allOutput = [];
    let hadError = false;
    let lastSeg = null;
    chainResult.segments.forEach((seg) => {
      if (seg.clear) clearTerminalDOM();
      if (seg.error) { appendLine(seg.error, 'error-line'); hadError = true; }
      else seg.output.forEach((line) => appendLine(line, 'output-line'));
      allOutput = allOutput.concat(seg.output || []);
      lastSeg = seg;
    });
    if (chainResult.backgroundJob) {
      appendLine(`[${chainResult.backgroundJob.id}] ${chainResult.backgroundJob.pid}`, 'system-line');
    }
    updatePromptLabel();

    checkMissionProgress({
      ctx: game.ctx,
      cmdName: lastSeg ? lastSeg.cmdName : null,
      args: lastSeg ? lastSeg.args : [],
      raw: chainResult.raw,
      output: lastSeg ? lastSeg.output : [],
      error: lastSeg ? lastSeg.error : null,
      allOutput,
      hadError,
      cmdNames: chainResult.segments.map((s) => s.cmdName),
    });
    scrollTerminalToBottom();
  }

  function checkMissionProgress(state) {
    const mission = MISSIONS[game.currentIndex];
    if (game.completed.has(mission.id)) return;
    let passed = false;
    try { passed = mission.check(state); } catch (e) { passed = false; }
    if (passed) completeMission();
  }

  /* ============================================================
   * vi / vim 미니 에디터 (모드 기반 실제 키 입력 처리)
   * ========================================================== */
  function writeFileAtSegs(ctx, segs, content) {
    const segsCopy = segs.slice();
    const name = segsCopy.pop();
    const parent = getNode(ctx.root, segsCopy);
    if (!parent || parent.type !== 'dir') return;
    if (!parent.children[name]) parent.children[name] = F('');
    if (parent.children[name].type === 'file') parent.children[name].content = content;
  }

  function openViEditor(raw) {
    const filePath = raw.trim().split(/\s+/)[1];
    const segs = resolvePath(game.ctx.cwd, filePath);
    const node = getNode(game.ctx.root, segs);
    const isNew = !node || node.type !== 'file';
    const content = node && node.type === 'file' ? node.content : '';
    viState = {
      lines: content.split('\n'),
      cursorRow: 0,
      cursorCol: 0,
      mode: 'normal',
      cmdBuffer: '',
      pendingKey: null,
      yank: null,
      dirty: false,
      isNew,
      filePath,
      segs,
      rawCmd: raw,
      lastMsg: null,
    };
    el.terminalOutput.classList.add('hidden');
    el.terminalInputLine.classList.add('hidden');
    el.viBuffer.classList.remove('hidden');
    el.viStatusBar.classList.remove('hidden');
    el.terminalInput.blur();
    document.addEventListener('keydown', onViKeyDown, true);
    renderVi();
  }

  function closeViEditor(saved, silent) {
    document.removeEventListener('keydown', onViKeyDown, true);
    const st = viState;
    if (saved && st) {
      writeFileAtSegs(game.ctx, st.segs, st.lines.join('\n'));
    }
    el.viBuffer.classList.add('hidden');
    el.viStatusBar.classList.add('hidden');
    el.terminalOutput.classList.remove('hidden');
    el.terminalInputLine.classList.remove('hidden');
    viState = null;
    if (silent || !st) return;
    if (saved) {
      appendLine(`"${st.filePath}" ${st.lines.length}L, ${st.lines.join('\n').length}C written`, 'output-line');
    }
    updatePromptLabel();
    checkMissionProgress({
      ctx: game.ctx,
      cmdName: 'vi',
      args: st.rawCmd.trim().split(/\s+/).slice(1),
      raw: st.rawCmd,
      output: [],
      error: null,
      allOutput: [],
      hadError: false,
      cmdNames: ['vi'],
      viSaved: saved,
    });
    scrollTerminalToBottom();
    el.terminalInput.focus();
  }

  function runViCommand(cmd) {
    const st = viState;
    const c = cmd.trim();
    if (c === 'w') {
      writeFileAtSegs(game.ctx, st.segs, st.lines.join('\n'));
      st.dirty = false;
      st.mode = 'normal';
      st.lastMsg = `"${st.filePath}" written`;
    } else if (c === 'q') {
      if (st.dirty) {
        st.mode = 'normal';
        st.lastMsg = 'E37: No write since last change (add ! to override)';
      } else {
        closeViEditor(false);
      }
    } else if (c === 'q!') {
      closeViEditor(false);
    } else if (c === 'wq' || c === 'x') {
      closeViEditor(true);
    } else {
      st.mode = 'normal';
      st.lastMsg = `E492: Not an editor command: ${c}`;
    }
  }

  function onViKeyDown(e) {
    if (!viState) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const allowedSpecial = ['Escape', 'Enter', 'Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (e.key.length > 1 && !allowedSpecial.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const st = viState;

    if (st.mode === 'insert') {
      if (e.key === 'Escape') {
        st.mode = 'normal';
        if (st.cursorCol > 0) st.cursorCol--;
      } else if (e.key === 'Enter') {
        const line = st.lines[st.cursorRow];
        const before = line.slice(0, st.cursorCol);
        const after = line.slice(st.cursorCol);
        st.lines.splice(st.cursorRow, 1, before, after);
        st.cursorRow++;
        st.cursorCol = 0;
        st.dirty = true;
      } else if (e.key === 'Backspace') {
        if (st.cursorCol > 0) {
          const line = st.lines[st.cursorRow];
          st.lines[st.cursorRow] = line.slice(0, st.cursorCol - 1) + line.slice(st.cursorCol);
          st.cursorCol--;
          st.dirty = true;
        } else if (st.cursorRow > 0) {
          const prevLen = st.lines[st.cursorRow - 1].length;
          st.lines[st.cursorRow - 1] += st.lines[st.cursorRow];
          st.lines.splice(st.cursorRow, 1);
          st.cursorRow--;
          st.cursorCol = prevLen;
          st.dirty = true;
        }
      } else if (e.key.length === 1) {
        const line = st.lines[st.cursorRow];
        st.lines[st.cursorRow] = line.slice(0, st.cursorCol) + e.key + line.slice(st.cursorCol);
        st.cursorCol++;
        st.dirty = true;
      }
      renderVi();
      return;
    }

    if (st.mode === 'command') {
      if (e.key === 'Escape') {
        st.mode = 'normal';
        st.cmdBuffer = '';
        renderVi();
      } else if (e.key === 'Enter') {
        const cmdToRun = st.cmdBuffer;
        st.cmdBuffer = '';
        runViCommand(cmdToRun);
        if (viState) renderVi();
      } else if (e.key === 'Backspace') {
        st.cmdBuffer = st.cmdBuffer.slice(0, -1);
        renderVi();
      } else if (e.key.length === 1) {
        st.cmdBuffer += e.key;
        renderVi();
      }
      return;
    }

    // normal mode
    const key = e.key;
    if (st.pendingKey) {
      const combo = st.pendingKey + key;
      st.pendingKey = null;
      if (combo === 'dd') {
        st.yank = st.lines[st.cursorRow];
        st.lines.splice(st.cursorRow, 1);
        if (st.lines.length === 0) st.lines = [''];
        if (st.cursorRow >= st.lines.length) st.cursorRow = st.lines.length - 1;
        st.cursorCol = 0;
        st.dirty = true;
      } else if (combo === 'yy') {
        st.yank = st.lines[st.cursorRow];
      } else if (combo === 'gg') {
        st.cursorRow = 0;
        st.cursorCol = 0;
      }
      renderVi();
      return;
    }
    if (key === 'd' || key === 'y' || key === 'g') { st.pendingKey = key; return; }

    if (key === 'i') { st.mode = 'insert'; }
    else if (key === 'a') { st.mode = 'insert'; st.cursorCol = Math.min(st.cursorCol + 1, st.lines[st.cursorRow].length); }
    else if (key === 'o') { st.lines.splice(st.cursorRow + 1, 0, ''); st.cursorRow++; st.cursorCol = 0; st.mode = 'insert'; st.dirty = true; }
    else if (key === 'O') { st.lines.splice(st.cursorRow, 0, ''); st.cursorCol = 0; st.mode = 'insert'; st.dirty = true; }
    else if (key === 'x') {
      const line = st.lines[st.cursorRow];
      if (st.cursorCol < line.length) {
        st.lines[st.cursorRow] = line.slice(0, st.cursorCol) + line.slice(st.cursorCol + 1);
        st.dirty = true;
      }
    } else if (key === 'p') {
      if (st.yank !== null) { st.lines.splice(st.cursorRow + 1, 0, st.yank); st.cursorRow++; st.dirty = true; }
    } else if (key === 'G') { st.cursorRow = st.lines.length - 1; st.cursorCol = 0; }
    else if (key === ':') { st.mode = 'command'; st.cmdBuffer = ''; }
    else if (key === 'h' || key === 'ArrowLeft') { st.cursorCol = Math.max(0, st.cursorCol - 1); }
    else if (key === 'l' || key === 'ArrowRight') { st.cursorCol = Math.min(st.lines[st.cursorRow].length, st.cursorCol + 1); }
    else if (key === 'j' || key === 'ArrowDown') { st.cursorRow = Math.min(st.lines.length - 1, st.cursorRow + 1); st.cursorCol = Math.min(st.cursorCol, st.lines[st.cursorRow].length); }
    else if (key === 'k' || key === 'ArrowUp') { st.cursorRow = Math.max(0, st.cursorRow - 1); st.cursorCol = Math.min(st.cursorCol, st.lines[st.cursorRow].length); }

    renderVi();
  }

  function renderVi() {
    if (!viState) return;
    const st = viState;
    el.viBuffer.innerHTML = '';
    st.lines.forEach((line, i) => {
      const lineDiv = document.createElement('div');
      lineDiv.className = 'vi-line';
      const numSpan = document.createElement('span');
      numSpan.className = 'vi-linenum';
      numSpan.textContent = String(i + 1).padStart(3, ' ');
      lineDiv.appendChild(numSpan);
      const textSpan = document.createElement('span');
      textSpan.className = 'vi-text';
      if (i === st.cursorRow) {
        const before = line.slice(0, st.cursorCol);
        const atChar = line.slice(st.cursorCol, st.cursorCol + 1) || ' ';
        const after = line.slice(st.cursorCol + 1);
        textSpan.appendChild(document.createTextNode(before));
        const cursorSpan = document.createElement('span');
        cursorSpan.className = 'vi-cursor';
        cursorSpan.textContent = atChar;
        textSpan.appendChild(cursorSpan);
        textSpan.appendChild(document.createTextNode(after));
      } else {
        textSpan.textContent = line;
      }
      lineDiv.appendChild(textSpan);
      el.viBuffer.appendChild(lineDiv);
    });
    const fillerCount = Math.max(0, 16 - st.lines.length);
    for (let i = 0; i < fillerCount; i++) {
      const d = document.createElement('div');
      d.className = 'vi-filler';
      d.textContent = '~';
      el.viBuffer.appendChild(d);
    }

    let statusText;
    if (st.mode === 'insert') statusText = '-- INSERT --';
    else if (st.mode === 'command') statusText = ':' + st.cmdBuffer;
    else if (st.lastMsg) { statusText = st.lastMsg; st.lastMsg = null; }
    else statusText = `"${st.filePath}"${st.isNew ? ' [New File]' : ''} ${st.lines.length}L${st.dirty ? ' [+]' : ''}`;
    el.viStatusBar.textContent = statusText;
  }

  function renderCheatSheet() {
    el.cheatSheetList.innerHTML = '';
    const seen = new Set();
    MISSIONS.forEach((m, i) => {
      if (!isUnlocked(i) && !game.completed.has(m.id)) return;
      m.commandsTaught.forEach((c) => {
        if (seen.has(c.cmd)) return;
        seen.add(c.cmd);
        const item = document.createElement('div');
        item.className = 'cheat-item';
        const cmd = document.createElement('div');
        cmd.className = 'cmd';
        cmd.textContent = c.cmd;
        const desc = document.createElement('div');
        desc.className = 'desc';
        desc.textContent = c.desc;
        item.appendChild(cmd);
        item.appendChild(desc);
        el.cheatSheetList.appendChild(item);
      });
    });
    if (seen.size === 0) {
      const empty = document.createElement('div');
      empty.className = 'desc';
      empty.textContent = '아직 배운 명령어가 없습니다. 첫 미션을 클리어해보세요!';
      el.cheatSheetList.appendChild(empty);
    }
  }

  /* ============================================================
   * 이벤트 바인딩
   * ========================================================== */
  el.terminalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (game.ctx.history.length === 0) return;
      game.historyPointer = Math.max(0, game.historyPointer - 1);
      el.terminalInput.value = game.ctx.history[game.historyPointer] || '';
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (game.ctx.history.length === 0) return;
      game.historyPointer = Math.min(game.ctx.history.length, game.historyPointer + 1);
      el.terminalInput.value = game.ctx.history[game.historyPointer] || '';
    }
  });

  el.terminalWindow.addEventListener('click', () => el.terminalInput.focus());

  el.hintBtn.addEventListener('click', () => {
    const mission = MISSIONS[game.currentIndex];
    el.hintText.textContent = '💡 ' + mission.hints[game.hintIndex];
    el.hintText.classList.remove('hidden');
    game.hintIndex = (game.hintIndex + 1) % mission.hints.length;
  });

  el.conceptBtn.addEventListener('click', () => {
    const mission = MISSIONS[game.currentIndex];
    if (!mission.concept) return;
    el.conceptText.textContent = '📚 ' + mission.concept;
    el.conceptText.classList.toggle('hidden');
  });

  el.resetMissionBtn.addEventListener('click', () => loadMission(game.currentIndex));

  el.cheatSheetBtn.addEventListener('click', () => {
    renderCheatSheet();
    el.cheatSheetModal.classList.remove('hidden');
  });
  el.closeCheatSheet.addEventListener('click', () => el.cheatSheetModal.classList.add('hidden'));
  el.cheatSheetModal.addEventListener('click', (e) => {
    if (e.target === el.cheatSheetModal) el.cheatSheetModal.classList.add('hidden');
  });

  /* ============================================================
   * 초기화
   * ========================================================== */
  function init() {
    const saved = loadProgress();
    if (saved) {
      game.completed = new Set(saved.completed || []);
      game.currentIndex = Math.min(saved.currentIndex || 0, MISSIONS.length - 1);
    }
    loadMission(game.currentIndex);
    renderHeader();
    if (window.matchMedia('(max-width: 700px)').matches) {
      el.missionListDetails.removeAttribute('open');
    }
  }

  init();
})();
