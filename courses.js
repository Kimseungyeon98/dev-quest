/* 허브에 표시할 과목 목록. 새 과목을 추가하려면 폴더를 만들고 여기에 항목 하나를 추가하세요.
 * - storageKey: 그 과목 앱이 진행 기록을 저장하는 localStorage 키
 * - total: 전체 문제 수 (문제를 추가하면 같이 올려 주세요)
 * - countDone(saved): 저장된 JSON 에서 완료한 문제 수를 센다 */
(function () {
  'use strict';

  window.DEV_QUEST_COURSES = [
    {
      id: 'linux', path: 'linux/', icon: '🐧', name: 'Linux Quest', tagline: '신입 서버 운영 담당자 생존기',
      desc: '가상 터미널에서 파일 다루기부터 파이프, 프로세스, Docker, vi 까지.',
      unit: '미션', total: 67, accent: '#3fb950',
      storageKey: 'linuxQuestProgress_v1',
      countDone: (saved) => (saved.completed || []).length,
    },
    {
      id: 'sql', path: 'sql/', icon: '🗄️', name: 'Query Lab', tagline: '실무 SQL 연습실',
      desc: '진짜 SQLite 엔진으로 JOIN, 집계, 윈도우 함수, 인덱스 튜닝까지.',
      unit: '문제', total: 36, accent: '#58a6ff',
      storageKey: 'sqlQueryLabProgress_v1',
      countDone: (saved) => (saved.solved || []).length,
    },
    {
      id: 'git', path: 'git/', icon: '⎇', name: 'Git Playbook', tagline: '상황별로 배우는 실전 Git',
      desc: '커밋, 브랜치, 충돌 해결, 되돌리기, rebase, 원격 협업을 시나리오로.',
      unit: '시나리오', total: 73, accent: '#f05033',
      storageKey: 'gitplaybook:v1',
      countDone: (saved) => Object.keys(saved.done || {}).filter((k) => saved.done[k]).length,
    },
  ];
})();
