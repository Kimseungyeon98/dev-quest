/* Linux Quest 엔진 (2/3): 명령어 구현 (ls · cd · grep · ps · docker …) 과 COMMANDS 표.
 * 명령 하나 = function (args, ctx) → { output: [줄…] } 또는 { error }. 새 명령은 여기에 함수를 만들고 COMMANDS 에 넣어요. */
(function () {
  'use strict';

  const { D, F, PERM_TABLE, applySymbolicChmod, cloneTree, getNode, resolvePath, wildcardToRegex } = window.LinuxEngine;

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

  window.LinuxEngine = Object.assign(window.LinuxEngine || {}, { COMMANDS, MAN_PAGES });
})();
