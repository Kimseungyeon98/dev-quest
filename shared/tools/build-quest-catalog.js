/* 퀘스트 카탈로그 만들기: node shared/tools/build-quest-catalog.js [--check]
 * 과목별 퀘스트 id·난이도·제목(순서대로)과 XP 규칙을 shared/quests.json 으로 뽑아요.
 *  - 서버(랭킹)는 이 파일로 XP 를 계산하고
 *  - 허브는 과목 데이터 파일(수백 KB) 대신 이 파일 하나만 받아서 퀘스트 목록을 그려요
 * courses.js 의 scripts → items 로 목록을 만들고, XP 규칙은 shared/dq.js 에서 가져와요.
 * 퀘스트를 추가·수정하면 다시 실행해 주세요. --check 는 파일이 최신인지 확인만 해요 (CI 용). */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const out = path.join(root, 'shared', 'quests.json');
globalThis.window = globalThis;
// 브라우저의 <script> 처럼 전역에서 실행해요 (require 로 부르면 일부 파일이 module.exports 로만 내보내요)
const load = (rel) => vm.runInThisContext(fs.readFileSync(path.join(root, rel), 'utf8'), { filename: rel });

load('courses.js');
load('shared/dq.js');
const DQ = globalThis.DevQuest;

const catalog = {
  note: '자동 생성 파일이에요. 직접 고치지 말고 node shared/tools/build-quest-catalog.js 로 다시 만드세요.',
  xp: Object.fromEntries(DQ.DIFF_KEYS.map((k) => [k, DQ.DIFFICULTY[k].xp])),
  courses: {},
};
for (const c of globalThis.DEV_QUEST_COURSES) {
  c.scripts().forEach(load);
  if (c.scriptsAfter) c.scriptsAfter().forEach(load);
  if (!c.doneField) throw new Error(`courses.js 의 ${c.id} 에 doneField 가 없어요`);
  const quests = {};
  const titles = {};
  for (const it of c.items()) {
    if (quests[it.id]) throw new Error(`${c.id} 에 같은 퀘스트 id 가 두 번 있어요: ${it.id}`);
    quests[it.id] = DQ.diffKey(it.difficulty);
    titles[it.id] = it.title || '';
  }
  catalog.courses[c.id] = { name: c.name, icon: c.icon, doneField: c.doneField, quests, titles };
}

const text = JSON.stringify(catalog, null, 1) + '\n';
if (process.argv.includes('--check')) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (current !== text) {
    console.error('shared/quests.json 이 최신이 아니에요. node shared/tools/build-quest-catalog.js 를 실행해서 커밋해 주세요.');
    process.exit(1);
  }
  console.log('shared/quests.json 최신 ✓');
} else {
  fs.writeFileSync(out, text);
  const summary = Object.entries(catalog.courses).map(([id, c]) => `${id} ${Object.keys(c.quests).length}개`).join(', ');
  console.log(`shared/quests.json 저장 (${summary})`);
}
