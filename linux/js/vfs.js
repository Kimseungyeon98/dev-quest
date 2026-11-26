/* Linux Quest 엔진 (1/3): 가상 파일시스템 — 노드 만들기·경로 해석·토큰 나누기·권한 표.
 * 화면과 상관없는 순수 함수라 window.LinuxEngine 으로 내보내요 (commands.js · shell.js · script.js 가 써요). */
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

  /* 따옴표 밖에 있는 연산자에서만 문자열을 나눈다. 결과는 [조각, 연산자, 조각, ...] 순서 (긴 연산자부터 맞춘다)
     예: grep -E 'a|b' file | wc -l → ["grep -E 'a|b' file ", "|", " wc -l"] */
  function splitUnquoted(s, ops) {
    const sorted = ops.slice().sort((a, b) => b.length - a.length);
    const out = [];
    let cur = '';
    let quote = null;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
      const op = sorted.find((o) => s.startsWith(o, i));
      if (op) { out.push(cur, op); cur = ''; i += op.length - 1; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
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

  window.LinuxEngine = Object.assign(window.LinuxEngine || {}, { HOME_PATH, D, F, buildRoot, cloneTree, arraysEqual, getNode, resolvePath, getNodeFromHome, tokenize, splitUnquoted, wildcardToRegex, displayPath, PERM_TABLE, applySymbolicChmod });
})();
