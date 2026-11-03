/* 모든 문제 검증 (로컬 JDK 17 이상 필요): node algo/tools/validate-problems.js [문제 id 접두사]
 *  1) JS 참조 풀이(ref)가 예제 기댓값과 같은지
 *  2) 시간 검사를 끼워 넣은 자바 모범 답안이 컴파일되고, 예제·정확성·효율성 테스트를 모두 통과하는지
 *  3) 시작 코드(starterCode)가 컴파일되는지 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
require(path.join(root, 'js', 'judge.js'));
require(path.join(root, 'js', 'problems.js'));
const AJ = globalThis.AlgoJudge;
const { CATEGORIES, PROBLEMS } = globalThis.ALGO_DATA;
const only = process.argv[2];

function compileAndRun(dir, p, solutionSrc, cases) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const ins = AJ.instrument(solutionSrc);
  fs.writeFileSync(path.join(dir, 'Solution.java'), ins.code);
  fs.writeFileSync(path.join(dir, 'Judge.java'), AJ.judgeSource(p));
  try {
    execFileSync('javac', ['--release', '17', '-encoding', 'UTF-8', '-nowarn', '-d', dir, path.join(dir, 'Solution.java'), path.join(dir, 'Judge.java')], { stdio: 'pipe' });
  } catch (e) {
    const out = String(e.stderr || e.stdout || e.message).replace(new RegExp(dir.replace(/\\/g, '\\\\').replace(/[.*+?^${}()|[\]]/g, '\\$&') + '[\\\\/]', 'g'), '');
    return { compileError: AJ.cleanCompilerOutput(out, solutionSrc, ins.inserts, p) };
  }
  if (!cases) return {};
  const token = 'v' + Date.now();
  fs.writeFileSync(path.join(dir, 'input.json'), AJ.judgeInput(cases, token));
  execFileSync('java', ['-Xss64m', '-cp', dir, 'Judge', path.join(dir, 'input.json'), path.join(dir, 'result.json')], { stdio: 'pipe' });
  const res = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  if (res.token !== token) throw new Error('token 불일치');
  return { graded: AJ.grade(cases, res.results) };
}

let bad = 0;
const seen = new Set();
const catIds = new Set(CATEGORIES.map((c) => c.id));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'algo-validate-'));
for (const p of PROBLEMS) {
  if (only && !p.id.startsWith(only)) continue;
  const errs = [];
  if (seen.has(p.id)) errs.push('id 중복');
  seen.add(p.id);
  if (!catIds.has(p.category)) errs.push(`알 수 없는 분류: ${p.category}`);
  if (!['easy', 'medium', 'hard'].includes(p.difficulty)) errs.push(`알 수 없는 난이도: ${p.difficulty}`);
  p.examples.forEach((e, i) => {
    const got = p.ref(...JSON.parse(JSON.stringify(e.args)));
    if (!AJ.sameValue(got, e.expected)) errs.push(`예제 ${i + 1}: ref = ${AJ.formatValue(got)}, expected = ${AJ.formatValue(e.expected)}`);
  });
  let timing = '';
  try {
    const cases = AJ.buildCases(p, 'submit');
    const r = compileAndRun(path.join(tmp, p.id), p, p.solution, cases);
    if (r.compileError) errs.push('모범 답안 컴파일 오류:\n      ' + r.compileError.split('\n').join('\n      '));
    else {
      r.graded.filter((g) => !g.pass).forEach((g) => errs.push(`${g.label} ${g.status}: 기대 ${AJ.formatValue(g.expected, 80)}, 실제 ${AJ.formatValue(g.actual, 80)} ${g.err || ''}`));
      const slow = r.graded.reduce((m, g) => Math.max(m, g.ms), 0);
      timing = ` (가장 느린 케이스 ${slow.toFixed(1)}ms)`;
    }
    const s = compileAndRun(path.join(tmp, p.id + '-starter'), p, AJ.starterCode(p), null);
    if (s.compileError) errs.push('시작 코드 컴파일 오류:\n      ' + s.compileError.split('\n').join('\n      '));
  } catch (e) {
    errs.push('실행 오류: ' + (e.stderr ? String(e.stderr) : e.message));
  }
  if (errs.length) { bad++; console.log(`✗ ${p.id} ${p.title}\n   - ${errs.join('\n   - ')}`); } else console.log(`✓ ${p.id} ${p.title}${timing}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${PROBLEMS.length}개 중 문제 ${bad}개`);
process.exit(bad ? 1 : 0);
