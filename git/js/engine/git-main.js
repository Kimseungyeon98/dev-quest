/* git 디스패처: 전역 옵션, alias, 알 수 없는 명령어 제안 */
(function () {
  'use strict';
  const G = (globalThis.GitEngine = globalThis.GitEngine || {});
  const { GitError } = G;
  const U = G.util;

  const USAGE = `usage: git [-v | --version] [-h | --help] [-C <path>] [-c <name>=<value>]
           [--exec-path[=<path>]] [--html-path] [--man-path] [--info-path]
           [-p | --paginate | -P | --no-pager] [--no-replace-objects] [--bare]
           [--git-dir=<path>] [--work-tree=<path>] [--namespace=<name>]
           [--config-env=<name>=<envvar>] <command> [<args>]

These are common Git commands used in various situations:

start a working area (see also: git help tutorial)
   clone     Clone a repository into a new directory
   init      Create an empty Git repository or reinitialize an existing one

work on the current change (see also: git help everyday)
   add       Add file contents to the index
   mv        Move or rename a file, a directory, or a symlink
   restore   Restore working tree files
   rm        Remove files from the working tree and from the index

examine the history and state (see also: git help revisions)
   bisect    Use binary search to find the commit that introduced a bug
   diff      Show changes between commits, commit and working tree, etc
   grep      Print lines matching a pattern
   log       Show commit logs
   show      Show various types of objects
   status    Show the working tree status

grow, mark and tweak your common history
   branch    List, create, or delete branches
   commit    Record changes to the repository
   merge     Join two or more development histories together
   rebase    Reapply commits on top of another base tip
   reset     Reset current HEAD to the specified state
   switch    Switch branches
   tag       Create, list, delete or verify a tag object signed with GPG

collaborate (see also: git help workflows)
   fetch     Download objects and refs from another repository
   pull      Fetch from and integrate with another repository or a local branch
   push      Update remote refs along with associated objects

'git help -a' and 'git help -g' list available subcommands and some
concept guides. See 'git help <command>' or 'git help <concept>'
to read about a specific subcommand or concept.
See 'git help git' for an overview of the system.
`;

  /* Damerau-Levenshtein (전치는 비용 1) */
  function distance(a, b) {
    const d = [];
    for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }

  function similarCommands(name) {
    const names = Object.keys(G.commands).filter((n) => !n.startsWith('_'));
    let best = [];
    let bestD = 99;
    names.forEach((n) => {
      let dd = distance(name, n);
      if (n.startsWith(name) && name.length >= 2) dd = Math.min(dd, 1);
      if (dd < bestD) { bestD = dd; best = [n]; } else if (dd === bestD) best.push(n);
    });
    if (bestD > 3 || bestD >= Math.max(3, name.length)) return [];
    return best.sort();
  }

  function splitAlias(value) {
    const out = [];
    let cur = '', q = null;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (q) { if (ch === q) q = null; else cur += ch; continue; }
      if (ch === '"' || ch === "'") { q = ch; continue; }
      if (ch === ' ' || ch === '\t') { if (cur) { out.push(cur); cur = ''; } continue; }
      cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }

  G.runGit = function runGit(ctx, argv) {
    let i = 0;
    const overrides = [];
    while (i < argv.length && argv[i].startsWith('-')) {
      const a = argv[i];
      if (a === '-c') { overrides.push(argv[i + 1] || ''); i += 2; continue; }
      if (a === '--version' || a === '-v') { ctx.print(`git version ${ctx.sim.gitVersion}.windows.1\n`.replace('.windows.1', ctx.sim.gitSuffix || '')); return; }
      if (a === '--help' || a === '-h') { ctx.print(USAGE); return; }
      if (['--no-pager', '-P', '--no-optional-locks', '-p', '--paginate', '--bare', '--no-replace-objects'].includes(a)) { i++; continue; }
      if (a === '-C') { i += 2; continue; }
      throw new GitError(`unknown option: ${a}\n${USAGE.split('\n').slice(0, 6).join('\n')}`, 129);
    }
    overrides.forEach((kv) => {
      const eq = kv.indexOf('=');
      if (eq > 0 && ctx.repo) ctx.repo.config.set(kv.slice(0, eq).toLowerCase(), kv.slice(eq + 1));
    });
    let cmd = argv[i];
    let args = argv.slice(i + 1);
    if (!cmd) { ctx.print(USAGE); throw new GitError('', 1); }
    if (cmd === 'version') { ctx.print(`git version ${ctx.sim.gitVersion}${ctx.sim.gitSuffix || ''}\n`); return; }
    // alias
    const seen = new Set();
    while (!G.commands[cmd]) {
      const al = ctx.cfg('alias.' + cmd);
      if (al === undefined || seen.has(cmd)) break;
      seen.add(cmd);
      if (al.startsWith('!')) {
        const r = ctx.sim.execWith(ctx.session, al.slice(1) + (args.length ? ' ' + args.join(' ') : ''), {});
        r.out.forEach((o) => ctx.out.push(o));
        if (r.code !== 0) throw new GitError('', r.code);
        return;
      }
      const parts = splitAlias(al);
      cmd = parts[0];
      args = parts.slice(1).concat(args);
    }
    const handler = G.commands[cmd];
    if (!handler) {
      const sim = similarCommands(cmd);
      let msg = `git: '${cmd}' is not a git command. See 'git --help'.`;
      if (sim.length) msg += `\n\nThe most similar command${sim.length > 1 ? 's are' : ' is'}\n` + sim.map((s) => '\t' + s).join('\n');
      throw new GitError(msg, 1);
    }
    ctx.cmdName = cmd;
    if (args.length === 1 && args[0] === '-h' && !['stash', 'branch', 'log', 'checkout', 'switch', 'tag'].includes('x')) {
      // 대부분의 명령어는 -h 로 usage 를 보여준다 (여기서는 간단히 안내)
    }
    handler(ctx, args);
  };

  G.commands.help = function (ctx, args) {
    if (!args.length || args[0] === '-a' || args[0] === '-g') { ctx.print(USAGE); return; }
    const name = args.filter((a) => !a.startsWith('-'))[0];
    if (!G.commands[name] && !['gitignore', 'revisions', 'workflows', 'everyday', 'tutorial'].includes(name)) {
      throw new GitError(`git: '${name}' is not a git command. See 'git --help'.`, 1);
    }
    ctx.print(`'git ${name}' 의 전체 매뉴얼(man page)은 이 시뮬레이터에서 보여주지 않아요.\n각 시나리오의 "왜 배우나요?" 개념 노트와 힌트를 참고하세요. (실제 터미널에서는 git help ${name} 또는 git ${name} --help)\n`);
  };

  G.similarCommands = similarCommands;
  G.GIT_USAGE = USAGE;
})();
