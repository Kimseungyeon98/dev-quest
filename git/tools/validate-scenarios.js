/* 모든 시나리오: setup 직후에는 목표 미달성, solution 실행 후에는 목표 모두 달성인지 검증 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const eng = ['sha1', 'diff', 'repo', 'git-util', 'git-core', 'git-graph', 'git-log', 'git-refs', 'git-merge', 'git-bisect', 'git-remote', 'shell', 'git-main'];
globalThis.GitEngine = {};
eng.forEach((f) => require(path.join(root, 'js', 'engine', f + '.js')));
require(path.join(root, 'js', 'lab.js'));
require(path.join(root, 'js', 'scenarios-common.js'));
const files = fs.readdirSync(path.join(root, 'js')).filter((f) => /^scenarios-\d+.*\.js$/.test(f)).sort();
files.forEach((f) => require(path.join(root, 'js', f)));
const GP = globalThis.GP;
const only = process.argv[2];

async function main() {
  let bad = 0;
  const seen = new Set();
  for (const s of GP.scenarios) {
    if (only && !s.id.startsWith(only)) continue;
    if (seen.has(s.id)) { console.log(`✗ ${s.id}: id 중복`); bad++; }
    seen.add(s.id);
    const errs = [];
    let lab;
    try {
      lab = new GP.Lab({ color: false });
      lab.setup(s.setup);
    } catch (e) { console.log(`✗ ${s.id} ${s.title}: setup 오류\n   ${String(e.message).split('\n').join('\n   ')}`); bad++; continue; }
    // 초기 목표
    let e0 = lab.env();
    const init = s.goals.map((g) => { try { return !!g[1](e0); } catch (e) { return false; } });
    if (init.every(Boolean)) errs.push('setup 직후 모든 목표가 이미 달성되어 있음');
    // 솔루션
    const answers = [];
    for (const step of s.solution.cmds) {
      if (Array.isArray(step)) { try { lab.setup([step]); } catch (e) { errs.push(`솔루션 op 오류: ${e.message}`); } continue; }
      const cmd = typeof step === 'string' ? step : step.cmd;
      const inputs = (typeof step === 'object' && step.inputs) || [];
      let k = 0;
      try {
        const res = await lab.runInteractive(cmd, async (kind, payload) => {
          const v = inputs[k++];
          if (v === undefined) { errs.push(`입력 요구(${kind}) 에 대한 inputs 부족: ${cmd}`); return null; }
          return typeof v === 'function' ? v(payload) : v;
        });
        if (res.code !== 0 && !(typeof step === 'object' && step.allowFail)) errs.push(`솔루션 명령 실패(exit ${res.code}): ${cmd}\n      ${(res.text || '').trim().split('\n').slice(0, 4).join('\n      ')}`);
      } catch (e) { errs.push(`솔루션 예외: ${cmd}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); }
    }
    const e1 = lab.env();
    s.goals.forEach((g, i) => { let ok = false; try { ok = !!g[1](e1); } catch (e) { errs.push(`목표 평가 오류 "${g[0]}": ${e.message}`); } if (!ok) errs.push(`목표 미달성: ${g[0]}`); });
    if (errs.length) { console.log(`✗ ${s.id} ${s.title}\n   - ${errs.join('\n   - ')}`); bad++; } else console.log(`✓ ${s.id} ${s.title}`);
  }
  console.log(`\n${GP.scenarios.length}개 중 문제 ${bad}개`);
  process.exit(bad ? 1 : 0);
}
main();
