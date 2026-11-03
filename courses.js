/* 과목 목록 — 허브와 각 과목 화면이 함께 읽는 단일 원본이에요.
 * 이름·아이콘·한 줄 소개를 여기서만 정하므로 모든 화면의 제목이 항상 같아요.
 * - storageKey / doneIds(saved): 그 과목 앱이 저장한 진행 기록에서 "완료한 퀘스트 id 목록"을 꺼낸다
 * - scripts / items(): 허브가 과목의 데이터 파일만 불러와 퀘스트 목록({id, difficulty})을 직접 만든다.
 *   (퀘스트를 추가해도 이 파일의 숫자를 고칠 필요가 없어요) */
(function () {
  'use strict';

  window.DEV_QUEST_COURSES = [
    {
      id: 'linux', path: 'linux/', icon: '🐧', name: 'Linux Quest', tagline: '가상 터미널로 배우는 서버 명령어',
      desc: '파일 다루기부터 파이프, 프로세스, Docker, vi 까지 서버 운영 생존기.',
      accent: '#3fb950',
      storageKey: 'linuxQuestProgress_v1',
      doneIds: (saved) => saved.completed || [],
      scripts: () => ['linux/js/missions.js'],
      // 미션 정의는 가상 파일시스템 헬퍼가 필요하지만, 목록만 만들 땐 빈 헬퍼로 충분해요.
      items: () => {
        const noop = () => ({});
        return window.LINUX_MISSIONS_FACTORY({ D: noop, F: noop, HOME_PATH: [], getNodeFromHome: noop, arraysEqual: noop })
          .map((m) => ({ id: m.id, difficulty: m.difficulty }));
      },
    },
    {
      id: 'sql', path: 'sql/', icon: '🗄️', name: 'SQL Quest', tagline: '실무 쿼리로 배우는 SQL',
      desc: '진짜 SQLite 엔진으로 JOIN, 집계, 윈도우 함수, 인덱스 튜닝까지.',
      accent: '#58a6ff',
      storageKey: 'sqlQueryLabProgress_v1',
      doneIds: (saved) => saved.solved || [],
      scripts: () => ['sql/js/data.js'],
      items: () => window.SQL_LAB_DATA.PROBLEMS.map((p) => ({ id: p.id, difficulty: p.difficulty })),
    },
    {
      id: 'git', path: 'git/', icon: '⎇', name: 'Git Quest', tagline: '실전 시나리오로 배우는 Git',
      desc: '커밋, 브랜치, 충돌 해결, 되돌리기, rebase, 원격 협업을 상황별로.',
      accent: '#f05033',
      storageKey: 'gitplaybook:v1',
      doneIds: (saved) => Object.keys(saved.done || {}).filter((k) => saved.done[k]),
      // 시나리오 파일 목록은 git/js/scenario-files.js 하나만 관리해요.
      scripts: () => ['git/js/scenario-files.js'],
      scriptsAfter: () => window.GIT_PLAYBOOK_SCENARIO_FILES.map((f) => 'git/js/' + f),
      items: () => window.GP.scenarios.map((s) => ({ id: s.id, difficulty: s.level })),
    },
    {
      id: 'algo', path: 'algo/', icon: '🧩', name: 'Algorithm Quest', tagline: 'Java 로 푸는 코딩테스트 알고리즘',
      desc: '브라우저 안의 진짜 Java 17 로 해시, 스택, 그리디, 이분 탐색, BFS, DP, 다익스트라까지.',
      accent: '#a371f7',
      storageKey: 'algoQuestProgress_v1',
      doneIds: (saved) => saved.solved || [],
      scripts: () => ['algo/js/problems.js'],
      items: () => window.ALGO_DATA.PROBLEMS.map((p) => ({ id: p.id, difficulty: p.difficulty })),
    },
  ];
})();
