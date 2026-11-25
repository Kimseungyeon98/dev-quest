/* 과목 목록 — 허브와 각 과목 화면이 함께 읽는 단일 원본이에요.
 * 이름·아이콘·한 줄 소개를 여기서만 정하므로 모든 화면의 제목이 항상 같아요.
 * - storageKey / doneIds(saved): 그 과목 앱이 저장한 진행 기록에서 "완료한 퀘스트 id 목록"을 꺼낸다
 * - doneField: 진행 기록에서 완료 목록이 든 필드 이름 (배열이면 id 목록, 객체면 값이 있는 키). 서버 랭킹이 이 값으로 계산해요
 * - lastId(saved, items): 그 과목에서 마지막으로 열었던 퀘스트 id (허브의 "이어하기"가 써요, 없으면 null)
 * - short / iconPath: 허브에 쓰는 짧은 이름과 선 아이콘(24×24 SVG path)
 * 과목 화면은 주소 끝의 #퀘스트id 로 그 퀘스트를 바로 열어요
 * - scripts / items(): 허브가 과목의 데이터 파일만 불러와 퀘스트 목록({id, difficulty})을 직접 만든다.
 *   (퀘스트를 추가해도 이 파일의 숫자를 고칠 필요가 없어요) */
(function () {
  'use strict';

  window.DEV_QUEST_COURSES = [
    {
      id: 'linux', path: 'linux/', icon: '🐧', name: 'Linux Quest', short: 'Linux',
      iconPath: 'M3.5 5.5h17v13h-17z M7.5 10l3 2.5-3 2.5 M13 15h4', tagline: '가상 터미널로 배우는 서버 명령어',
      desc: '파일 다루기부터 파이프, 프로세스, Docker, vi 까지 서버 운영 생존기.',
      accent: '#3fb950',
      storageKey: 'linuxQuestProgress_v1',
      doneField: 'completed', // 진행 기록에서 완료한 퀘스트가 든 필드 (서버 랭킹 계산도 이 값을 써요)
      doneIds: (saved) => saved.completed || [],
      lastId: (saved, items) => (items[saved.currentIndex] ? items[saved.currentIndex].id : null),
      scripts: () => ['linux/js/missions.js'],
      // 미션 정의는 가상 파일시스템 헬퍼가 필요하지만, 목록만 만들 땐 빈 헬퍼로 충분해요.
      items: () => {
        const noop = () => ({});
        return window.LINUX_MISSIONS_FACTORY({ D: noop, F: noop, HOME_PATH: [], getNodeFromHome: noop, arraysEqual: noop })
          .map((m) => ({ id: m.id, difficulty: m.difficulty, title: m.title }));
      },
    },
    {
      id: 'sql', path: 'sql/', icon: '🗄️', name: 'SQL Quest', short: 'SQL',
      iconPath: 'M4.5 6.5c0-1.7 3.4-3 7.5-3s7.5 1.3 7.5 3-3.4 3-7.5 3-7.5-1.3-7.5-3z M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11 M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3', tagline: '실무 쿼리로 배우는 SQL',
      desc: '진짜 SQLite 엔진으로 JOIN, 집계, 윈도우 함수, 인덱스 튜닝까지.',
      accent: '#58a6ff',
      storageKey: 'sqlQueryLabProgress_v1',
      doneField: 'solved',
      doneIds: (saved) => saved.solved || [],
      lastId: (saved) => saved.lastProblemId || null,
      scripts: () => ['sql/js/data.js'],
      items: () => window.SQL_LAB_DATA.PROBLEMS.map((p) => ({ id: p.id, difficulty: p.difficulty, title: p.title })),
    },
    {
      id: 'git', path: 'git/', icon: '⎇', name: 'Git Quest', short: 'Git',
      iconPath: 'M6 3.5v10 M8.5 16a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0 M20.5 7a2.5 2.5 0 1 1-5 0a2.5 2.5 0 1 1 5 0 M18 9.5c0 4-4 5-10.5 5.5', tagline: '실전 시나리오로 배우는 Git',
      desc: '커밋, 브랜치, 충돌 해결, 되돌리기, rebase, 원격 협업을 상황별로.',
      accent: '#f05033',
      storageKey: 'gitplaybook:v1',
      doneField: 'done', // { 퀘스트 id: 완료 정보 } 객체 — 값이 있는 키가 완료
      doneIds: (saved) => Object.keys(saved.done || {}).filter((k) => saved.done[k]),
      lastId: () => null, // Git Quest 는 마지막 시나리오를 따로 저장하지 않아요 (안 끝낸 첫 시나리오부터)
      // 시나리오 파일 목록은 git/js/scenario-files.js 하나만 관리해요.
      scripts: () => ['git/js/scenario-files.js'],
      scriptsAfter: () => window.GIT_PLAYBOOK_SCENARIO_FILES.map((f) => 'git/js/' + f),
      items: () => window.GP.scenarios.map((s) => ({ id: s.id, difficulty: s.level, title: s.title })),
    },
    {
      id: 'algo', path: 'algo/', icon: '🧩', name: 'Algorithm Quest', short: 'Algorithm',
      iconPath: 'M8.5 4c-2 0-3 1-3 3v2c0 1.5-1 2.5-2 3 1 .5 2 1.5 2 3v2c0 2 1 3 3 3 M15.5 4c2 0 3 1 3 3v2c0 1.5 1 2.5 2 3-1 .5-2 1.5-2 3v2c0 2-1 3-3 3', tagline: 'Java 로 푸는 코딩테스트 알고리즘',
      desc: '브라우저 안의 진짜 Java 17 로 해시, 스택, 그리디, 이분 탐색, BFS, DP, 다익스트라까지.',
      accent: '#a371f7',
      storageKey: 'algoQuestProgress_v1',
      doneField: 'solved',
      doneIds: (saved) => saved.solved || [],
      lastId: (saved) => saved.lastId || null,
      scripts: () => ['algo/js/problems.js'],
      items: () => window.ALGO_DATA.PROBLEMS.map((p) => ({ id: p.id, difficulty: p.difficulty, title: p.title })),
    },
  ];
})();
