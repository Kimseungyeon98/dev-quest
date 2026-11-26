/* Linux Quest 엔진 (3/3): 실행기 — 한 줄 명령을 ; && || 와 파이프(|)·리다이렉션(> >>)으로 나눠 COMMANDS 로 실행해요. */
(function () {
  'use strict';

  const { F, getNode, resolvePath, splitUnquoted, tokenize, COMMANDS } = window.LinuxEngine;

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
    const stages = splitUnquoted(raw, ['|']).filter((s) => s !== '|').map((s) => s.trim()).filter((s) => s.length > 0);
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

  /* &&, ||, ; 로 여러 명령을 한 줄에 이어붙이는 체이닝. &&는 앞 명령이 성공해야, ||는 앞 명령이 실패해야 다음을 실행하고,
     ;는 항상 다음을 실행. 따옴표 안의 연산자(예: awk '{print $1; print $2}')는 나누지 않는다.
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

    const parts = splitUnquoted(execLine, ['&&', '||', ';']).map((s) => s.trim()).filter((s) => s.length > 0);
    const segments = [];
    let failed = false;   // 마지막으로 실행한 명령의 실패 여부 (건너뛴 명령은 바꾸지 않는다)
    let pendingSep = null;
    for (const part of parts) {
      if (part === '&&' || part === '||' || part === ';') { pendingSep = part; continue; }
      if ((pendingSep === '&&' && failed) || (pendingSep === '||' && !failed)) { pendingSep = null; continue; }
      const segResult = executePipeline(part, ctx);
      segments.push(segResult);
      failed = !!segResult.error;
      pendingSep = null;
    }

    let backgroundJob = null;
    if (background && segments.length > 0 && !failed) {
      ctx.jobs = ctx.jobs || [];
      backgroundJob = { id: ctx.jobs.length + 1, pid: 10000 + ctx.jobs.length, cmd: execLine };
      ctx.jobs.push(backgroundJob);
    }

    return { segments, raw: trimmed, backgroundJob };
  }

  window.LinuxEngine = Object.assign(window.LinuxEngine || {}, { executeChain, executePipeline, writeToFile });
})();
