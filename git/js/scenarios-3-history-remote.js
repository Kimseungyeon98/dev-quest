/* 시나리오 3: 히스토리 정리 + 원격·협업 */
(function () {
  'use strict';
  const GP = globalThis.GP;
  const F = GP.F;
  const add = GP.add;
  const URL = GP.REMOTE_URL;

  /* rebase -i 의 todo 를 명령 목록대로 바꾸는 입력 도우미 (위에서부터 오래된 순) */
  const todo = (cmds) => (pl) => {
    const picks = pl.initial.split('\n').filter((l) => /^pick /.test(l));
    return picks.map((l, i) => `${cmds[i] || 'pick'} ${l.split(' ')[1]} ${l.split(' ').slice(2).join(' ')}`).join('\n') + '\n';
  };

  /* ================= 히스토리 정리 ================= */
  add({
    id: 'history-01', cat: 'history', level: 3, title: '지저분한 최근 커밋 3개를 하나로 (squash)', icon: '🧵',
    tags: ['rebase -i', 'squash', 'fixup', '커밋 합치기', 'wip 정리', 'interactive rebase'],
    story: 'PR 을 올리기 전인데 로컬에 "wip1", "wip2", "wip3" 커밋이 쌓였어요. 아직 push 하지 않았습니다.\n\n> "리뷰어가 보기 좋게 \'장바구니 기능 추가\' 커밋 하나로 정리해서 올려줘."',
    why: '`git rebase -i HEAD~3` 은 최근 3개 커밋을 편집하는 인터랙티브 모드예요. 첫 줄은 `pick`(또는 `reword`), 나머지는 `squash`/`fixup` 으로 바꾸면 하나로 합쳐집니다. **push 하기 전** 로컬 커밋에만 사용하세요!',
    setup: GP.repoOps(5).concat([['commit', 'wip1', { 'src/Cart.java': 'class Cart {}\n' }], ['commit', 'wip2', { 'src/Cart.java': 'class Cart { int n; }\n' }], ['commit', 'wip3', { 'src/CartTest.java': 'class CartTest {}\n' }]]),
    goals: [
      ['최근 3개가 1개로 합쳐져야 해요 (총 6개)', (e) => e.count() === 6],
      ['커밋 메시지에 wip 가 남지 않아야 해요', (e) => !e.subjects().some((s) => /wip/.test(s))],
      ['세 커밋의 내용(파일)이 모두 포함되어야 해요', (e) => /int n/.test(e.committedFile('src/Cart.java') || '') && e.inCommit('src/CartTest.java')],
      ['rebase 가 끝난 상태여야 해요', (e) => !e.state('rebase')],
    ],
    hints: ['`git rebase -i HEAD~3` 을 실행하면 편집기가 열려요. (시뮬레이터에서는 편집 창이 나타나요)', '첫 줄은 `reword`(메시지도 고칠 수 있음), 둘째·셋째 줄의 `pick` 은 `fixup` 으로 바꾸세요.', '저장하면 새 커밋 메시지를 입력하는 창이 열려요.'],
    solution: { cmds: [{ cmd: 'git rebase -i HEAD~3', inputs: [todo(['reword', 'fixup', 'fixup']), '장바구니 기능 추가\n'] }], explain: '`squash` 는 메시지를 합쳐서 편집하게 하고, `fixup` 은 앞 커밋 메시지를 그대로 쓰고 이 커밋 메시지는 버려요.' },
  });

  add({
    id: 'history-02', cat: 'history', level: 3, title: '몇 개 전 커밋 메시지 오타 고치기 (reword)', icon: '🖊️',
    tags: ['rebase -i', 'reword', '커밋 메시지 수정', '과거 커밋 수정', '오타'],
    story: '3개 전 커밋 메시지가 "결재 모듈 추가" 라고 되어 있어요. (결제가 맞아요!) push 전입니다.\n\n> "이왕이면 지금 고쳐. 다른 커밋은 건드리지 말고."',
    why: '`amend` 는 마지막 커밋만 고칠 수 있어요. 더 과거 커밋 메시지는 `git rebase -i` 에서 해당 줄을 `reword` 로 바꾸면 됩니다. 그 이후 커밋들은 해시가 모두 새로 만들어져요.',
    setup: GP.repoOps(4).concat([['commit', '결재 모듈 추가', { 'src/PaymentService.java': F.pay }], ['commit', '주문 총액에 부가세 반영', { 'src/OrderService.java': F.orderVat }], ['commit', 'README 실행 방법 추가', { 'README.md': F.readme2 }]]),
    goals: [
      ['오타 메시지가 "결제 모듈 추가"로 바뀌어야 해요', (e) => e.subjects().includes('결제 모듈 추가') && !e.subjects().includes('결재 모듈 추가')],
      ['커밋 개수는 그대로 7개여야 해요', (e) => e.count() === 7],
      ['다른 커밋 메시지는 그대로여야 해요', (e) => e.subject() === 'README 실행 방법 추가' && e.subject('HEAD~1') === '주문 총액에 부가세 반영'],
    ],
    hints: ['`git rebase -i HEAD~3` 에서 가장 위(오래된) 줄이 오타 커밋이에요.', '그 줄만 `reword` 로 바꾸세요.'],
    solution: { cmds: [{ cmd: 'git rebase -i HEAD~3', inputs: [todo(['reword']), '결제 모듈 추가\n'] }], explain: 'reword 이후 커밋들은 자동으로 다시 쌓여서(해시 변경) 내용은 같아요.' },
  });

  add({
    id: 'history-03', cat: 'history', level: 3, title: '실수로 들어간 디버그 커밋 빼기 (drop)', icon: '🗡️',
    tags: ['rebase -i', 'drop', '커밋 삭제', '디버그 코드', '과거 커밋 제거'],
    story: '중간에 "디버그 출력 추가" 커밋이 끼어 있어요. 다른 두 커밋은 제대로 된 거예요. push 전입니다.\n\n> "그 디버그 커밋만 이력에서 빼 줘. 나머지는 그대로."',
    why: '`rebase -i` 에서 줄을 `drop` 으로 바꾸거나 줄 자체를 지우면 그 커밋이 이력에서 빠져요. 서로 독립적인 변경이라면 충돌 없이 깔끔하게 제거됩니다.',
    setup: GP.repoOps(5).concat([['commit', '장바구니 기능 추가', { 'src/Cart.java': 'class Cart {}\n' }], ['commit', '디버그 출력 추가', { 'src/Debug.java': 'class Debug { void p() { System.out.println("x"); } }\n' }], ['commit', '쿠폰 기능 추가', { 'src/Coupon.java': 'class Coupon {}\n' }]]),
    goals: [
      ['디버그 커밋이 이력에서 사라져야 해요', (e) => !e.subjects().includes('디버그 출력 추가')],
      ['다른 두 커밋은 남아 있어야 해요 (총 7개)', (e) => e.count() === 7 && e.subjects().includes('장바구니 기능 추가') && e.subjects().includes('쿠폰 기능 추가')],
      ['Debug.java 가 사라져야 해요', (e) => !e.inCommit('src/Debug.java') && e.file('src/Debug.java') === undefined],
    ],
    hints: ['`git rebase -i HEAD~3`', '두 번째 줄(디버그)을 `drop` 으로 바꾸세요.'],
    solution: { cmds: [{ cmd: 'git rebase -i HEAD~3', inputs: [todo(['pick', 'drop', 'pick'])] }], explain: 'drop 한 커밋의 변경에 기대는 뒤 커밋이 있으면 충돌이 날 수 있어요.' },
  });

  add({
    id: 'history-04', cat: 'history', level: 4, title: '--fixup 과 autosquash 로 깔끔하게', icon: '🔧',
    tags: ['fixup', 'autosquash', 'commit --fixup', '리뷰 반영', 'rebase --autosquash'],
    story: '리뷰어가 "쿠폰 기능"의 버그를 지적했어요. 고친 내용을 `git commit --fixup` 으로 이미 커밋해 뒀어요.\n\n> "그 fixup 커밋이 \'쿠폰 기능 추가\' 커밋 안으로 자동으로 합쳐지게 정리해줘."',
    why: '`git commit --fixup <커밋>` 은 `fixup! 제목` 커밋을 만들어요. 나중에 `git rebase -i --autosquash` 를 쓰면 git 이 해당 커밋 바로 뒤로 옮겨 자동으로 `fixup` 처리합니다. 리뷰 반영 이력을 깔끔하게 만드는 팁이에요.',
    setup: GP.repoOps(5).concat([['commit', '쿠폰 기능 추가', { 'src/Coupon.java': 'class Coupon { int rate = 5; }\n' }], ['commit', '문서 업데이트', { 'README.md': F.readme2 }], ['write', 'src/Coupon.java', 'class Coupon { int rate = 10; }\n'], 'git commit -aq --fixup HEAD~1']),
    goals: [
      ['fixup! 커밋이 이력에 남아있으면 안 돼요', (e) => !e.subjects().some((s) => /^fixup!/.test(s))],
      ['커밋은 7개여야 해요 (fixup 이 흡수됨)', (e) => e.count() === 7],
      ['쿠폰 커밋 안에 수정 내용(rate = 10)이 들어 있어야 해요', (e) => { const c = e.subjects().indexOf('쿠폰 기능 추가'); return c >= 0 && /rate = 10/.test(e.committedFile('src/Coupon.java', 'HEAD~' + c) || ''); }],
    ],
    hints: ['`git log --oneline` 으로 fixup 커밋을 확인하세요.', '`git rebase -i --autosquash HEAD~3` : 목록이 이미 정렬되어 있으니 저장만 하세요.'],
    solution: { cmds: ['git log --oneline', { cmd: 'git rebase -i --autosquash HEAD~3', inputs: [(pl) => pl.initial] }], explain: '`git config rebase.autosquash true` 를 켜 두면 -i 때마다 자동 정렬돼요.' },
  });

  add({
    id: 'history-05', cat: 'history', level: 4, title: '큰 커밋을 둘로 쪼개기', icon: '🔪',
    tags: ['rebase -i', 'edit', '커밋 분리', 'split commit', 'reset HEAD^', '커밋 나누기'],
    story: '"로그인·로그 기능" 커밋 하나에 서로 상관없는 파일 두 개가 섞여 있어요. 아직 push 전이에요.\n\n> "리뷰하기 힘드니 \'로그인 기능\' 과 \'로그 기능\' 두 커밋으로 나눠줘."',
    why: '`rebase -i` 에서 해당 커밋을 `edit` 로 표시하면 그 커밋에서 멈춰요. 이때 `git reset HEAD^` 로 커밋을 풀고 파일별로 나눠 다시 커밋한 뒤 `git rebase --continue` 로 마무리합니다.',
    setup: GP.repoOps(5).concat([['commit', '로그인·로그 기능', { 'src/Login.java': 'class Login {}\n', 'src/Logger.java': 'class Logger {}\n' }], ['commit', 'README 실행 방법 추가', { 'README.md': F.readme2 }]]),
    goals: [
      ['"로그인 기능" 커밋이 Login.java 만 포함해야 해요', (e) => { const i = e.subjects().indexOf('로그인 기능'); return i >= 0 && e.inCommit('src/Login.java', 'HEAD~' + i) && !e.inCommit('src/Logger.java', 'HEAD~' + i); }],
      ['"로그 기능" 커밋이 있어야 해요 (총 8개)', (e) => e.subjects().includes('로그 기능') && e.count() === 8],
      ['마지막 README 커밋이 유지되어야 해요', (e) => e.subject() === 'README 실행 방법 추가'],
      ['rebase 가 끝난 상태여야 해요', (e) => !e.state('rebase') && e.fullyClean()],
    ],
    hints: ['`git rebase -i HEAD~2` 에서 합칠 커밋을 `edit` 로 바꿔요.', '멈추면 `git reset HEAD^` 로 커밋을 풀고, 파일별로 `git add` + `git commit` 하세요.', '마지막에 `git rebase --continue`'],
    solution: { cmds: [{ cmd: 'git rebase -i HEAD~2', inputs: [todo(['edit'])], allowFail: true }, 'git reset HEAD^', 'git add src/Login.java', 'git commit -m "로그인 기능"', 'git add src/Logger.java', 'git commit -m "로그 기능"', 'git rebase --continue'], explain: '`edit` 는 "여기서 멈춰서 커밋을 마음대로 만져라"는 뜻이에요. 멈춘 상태에서는 git commit --amend 도 가능합니다.' },
  });

  add({
    id: 'history-06', cat: 'history', level: 2, title: '개인 이메일로 커밋해 버렸어요', icon: '📧',
    tags: ['author', 'user.email', 'amend --reset-author', '작성자 수정', 'config'],
    story: '이 저장소는 회사 프로젝트인데, 이 폴더에만 개인 이메일(`me@gmail.com`)이 설정돼 있었어요. 방금 커밋이 그 이메일로 남았습니다. push 전이에요.\n\n> "회사 이메일(kim.dev@acme.co.kr)로 커밋 작성자를 바로잡고, 앞으로도 이 저장소는 회사 이메일을 쓰게 해."',
    why: '커밋의 작성자 정보는 그 시점의 `user.name/email` 설정으로 박혀요. 저장소별 설정(`git config user.email`)을 고치고, 마지막 커밋은 `git commit --amend --reset-author` 로 현재 설정에 맞춰 다시 만들 수 있어요.',
    setup: GP.repoOps(5).concat(['git config user.email me@gmail.com', ['commit', '배송 정보 추가', { 'src/Delivery.java': 'class Delivery {}\n' }]]),
    goals: [
      ['마지막 커밋 작성자 이메일이 회사 이메일이어야 해요', (e) => e.authorOf('HEAD') === 'kim.dev@acme.co.kr'],
      ['이 저장소의 user.email 설정이 회사 이메일이어야 해요', (e) => e.config('user.email') === 'kim.dev@acme.co.kr' || e.config('user.email') === undefined],
      ['커밋 개수는 그대로 6개', (e) => e.count() === 6],
    ],
    hints: ['`git config user.email` 로 현재 값을 확인해요.', '`git config user.email kim.dev@acme.co.kr` 로 바꾸고 `git commit --amend --reset-author --no-edit`'],
    solution: { cmds: ['git config user.email', 'git config user.email kim.dev@acme.co.kr', 'git commit --amend --reset-author --no-edit'], explain: '`git config --unset user.email` 로 저장소 설정을 지우면 전역 설정이 다시 쓰여요.' },
  });

  add({
    id: 'history-07', cat: 'history', level: 3, title: '최신 main 위로 내 브랜치 옮기기 (rebase)', icon: '🏗️',
    tags: ['rebase', '최신 main', '선형 이력', 'rebase main', '브랜치 업데이트'],
    story: '`feature/export` 를 만든 사이에 main 에 새 커밋이 2개 생겼어요.\n\n> "merge 커밋이 생기지 않게, 내 브랜치 커밋들을 최신 main 위로 옮겨서(rebase) 일직선 이력으로 만들어 줘."',
    why: '`git rebase main` 은 내 브랜치의 커밋을 잠시 떼어 두었다가 main 의 최신 커밋 뒤에 다시 붙여요(해시는 바뀜). 이력이 한 줄로 깔끔해져 리뷰와 `bisect` 가 쉬워집니다.',
    setup: GP.repoOps(5).concat(['git switch -q -c feature/export', ['commit', '엑셀 내보내기', { 'src/Export.java': 'class Export {}\n' }], ['commit', '내보내기 옵션', { 'src/Export.java': 'class Export { int o; }\n' }], 'git switch -q main', ['commit', '주문 총액에 부가세 반영', { 'src/OrderService.java': F.orderVat }], ['commit', 'README 실행 방법 추가', { 'README.md': F.readme2 }], 'git switch -q feature/export']),
    goals: [
      ['main 의 최신 커밋이 feature/export 의 조상이어야 해요', (e) => e.isAncestor('main', 'feature/export')],
      ['merge 커밋 없이 일직선(총 9개)이어야 해요', (e) => e.count('feature/export') === 9 && e.firstParentSubjects('feature/export').length === 9],
      ['rebase 가 끝나 있어야 해요', (e) => !e.state('rebase')],
    ],
    hints: ['rebase 할 브랜치(feature/export) 위에서 실행해요.', '`git rebase main`'],
    solution: { cmds: ['git rebase main', 'git log --oneline --graph'], explain: '이미 push 한 브랜치를 rebase 하면 force push 가 필요해져요. 공유 브랜치는 merge 를 쓰는 게 안전해요.' },
  });

  add({
    id: 'history-08', cat: 'history', level: 4, title: 'rebase 중 충돌 해결하기', icon: '🧨',
    tags: ['rebase conflict', 'rebase --continue', '충돌', 'rebase 충돌', 'continue'],
    story: '`feature/discount` 를 최신 main 위로 rebase 했더니 충돌이 났어요. 같은 줄을 서로 고쳤거든요.\n\n> "부가세(1.1)와 할인(-1000)을 둘 다 반영한 코드로 해결하고 rebase 를 끝내줘."',
    why: 'rebase 중 충돌은 커밋을 하나씩 다시 적용하다가 발생해요. 해결 → `git add` → `git rebase --continue` 를 반복하면 됩니다. 꼬이면 `--abort`(처음으로) 나 `--skip`(이 커밋 건너뜀) 도 있어요. (merge 와 달리 `--ours` 는 "main 쪽"이에요.)',
    setup: GP.repoOps(5).concat(['git switch -q -c feature/discount', ['commit', '할인 적용', { 'src/OrderService.java': THEIRS() }], 'git switch -q main', ['commit', '부가세 적용', { 'src/OrderService.java': F.orderVat }], 'git switch -q feature/discount']),
    goals: [
      ['rebase 가 끝나 있어야 해요', (e) => !e.state('rebase')],
      ['main 위에 일직선으로 쌓여야 해요 (7개)', (e) => e.count('feature/discount') === 7 && e.isAncestor('main', 'feature/discount') && e.parents('feature/discount') === 1],
      ['충돌 표시 없이 부가세와 할인이 모두 반영되어야 해요', (e) => { const c = e.committedFile('src/OrderService.java', 'feature/discount') || '<<<<<<<'; return !/<<<<<<<|>>>>>>>/.test(c) && /1\.1/.test(c) && /discount/.test(c); }],
    ],
    hints: ['`git rebase main` → 충돌 → `git status` 확인.', '충돌 파일 편집 → `git add` → `git rebase --continue` (편집기는 열리지 않아요).'],
    solution: { cmds: [{ cmd: 'git rebase main', allowFail: true }, ['write', 'src/OrderService.java', RESOLVED()], 'git add src/OrderService.java', 'git rebase --continue'], explain: 'rebase 중 상단에 보이는 `HEAD` 는 main 쪽(받는 쪽), 내 커밋 쪽은 아래에 표시돼요. merge 와 방향이 반대라 헷갈리기 쉬워요.' },
  });

  add({
    id: 'history-09', cat: 'history', level: 2, title: 'rebase 중에 길을 잃었어요 (abort)', icon: '🧭',
    tags: ['rebase --abort', 'rebase 취소', 'rebase 포기', '처음으로', 'abort'],
    story: 'rebase 도중 충돌이 나서 `git status` 를 보니 처음 보는 안내가 가득해요. 오늘은 충돌을 풀 시간이 없어요.\n\n> "rebase 시작하기 전 상태로 안전하게 되돌려 놔."',
    why: '`git rebase --abort` 는 rebase 를 시작하기 전의 브랜치/작업 폴더 상태로 완전히 되돌려요. 일이 꼬였다고 느껴지면 일단 abort 하고 다시 생각하세요.',
    setup: GP.repoOps(5).concat(['git switch -q -c feature/discount', ['commit', '할인 적용', { 'src/OrderService.java': THEIRS() }], 'git switch -q main', ['commit', '부가세 적용', { 'src/OrderService.java': F.orderVat }], 'git switch -q feature/discount', ['try', 'git rebase main']]),
    goals: [
      ['rebase 진행 상태가 아니어야 해요', (e) => !e.state('rebase')],
      ['feature/discount 브랜치 위에 있어야 해요', (e) => e.branch() === 'feature/discount'],
      ['원래 커밋(할인 적용)이 그대로 있고 작업 폴더가 깨끗해야 해요', (e) => e.subject() === '할인 적용' && e.fullyClean()],
    ],
    hints: ['`git status` 의 안내를 읽어 보세요: `(use "git rebase --abort" ...)`'],
    solution: { cmds: ['git status', 'git rebase --abort'], explain: '`--skip` 은 "충돌 난 이 커밋을 버리고 다음으로" 이므로 신중하게 써야 해요.' },
  });

  add({
    id: 'history-10', cat: 'history', level: 3, title: '비밀 정보(.env)를 커밋했어요 (push 전)', icon: '🔐',
    tags: ['.env', '비밀번호 커밋', '시크릿', 'rm --cached', 'amend', '민감 정보'],
    story: '방금 커밋에 DB 비밀번호가 담긴 `.env` 파일이 같이 들어갔어요. 다행히 push 는 하기 전이에요.\n\n> "커밋에서 .env 를 빼고(파일은 내 PC 에 남겨), 앞으로 실수로 안 올라가게 .gitignore 에도 추가해."',
    why: '아직 push 전이면 `git rm --cached` + `git commit --amend` 로 마지막 커밋에서 파일을 빼서 이력에 남지 않게 할 수 있어요. **이미 push 했다면** 비밀번호를 즉시 변경(폐기)해야 합니다. 이력에서 지워도 이미 유출된 것으로 봐야 해요.',
    setup: GP.repoOps(5).concat([['commit', '데이터베이스 설정 추가', { 'src/Db.java': 'class Db {}\n', '.env': 'DB_PASSWORD=super-secret\n' }]]),
    goals: [
      ['마지막 커밋에 .env 가 없어야 해요', (e) => !e.inCommit('.env')],
      ['내 PC 에는 .env 파일이 그대로 있어야 해요', (e) => e.file('.env') !== undefined],
      ['.gitignore 가 .env 를 무시하도록 커밋되어 있어야 해요', (e) => /\.env/.test(e.committedFile('.gitignore') || '')],
      ['커밋은 늘어나지 않아야 해요 (6개), 작업 폴더 깨끗', (e) => e.count() === 6 && e.fullyClean()],
    ],
    hints: ['`git rm --cached .env` 로 추적만 끊어요.', '`.gitignore` 에 `.env` 를 추가하고 add 한 뒤, `git commit --amend --no-edit` 로 마지막 커밋에 합쳐요.'],
    solution: { cmds: ['git rm --cached .env', ['write', '.gitignore', '.env\n'], 'git add .gitignore', 'git commit --amend --no-edit'], explain: '이미 공유된 이력에서 파일을 지우려면 `git filter-repo` 같은 도구와 force push 가 필요해요. 하지만 비밀번호 변경이 먼저입니다.' },
  });

  function THEIRS() { return F.order.replace('return price * qty;', 'return price * qty - 1000; // discount'); }
  function RESOLVED() { return F.order.replace('return price * qty;', 'return (int) (price * qty * 1.1) - 1000; // discount'); }

  /* ================= 원격·협업 ================= */
  add({
    id: 'remote-01', cat: 'remote', level: 2, title: 'clone 부터 첫 기여까지', icon: '📥',
    tags: ['clone', 'push -u', '첫 기여', '원격 저장소', '브랜치 push', 'set-upstream'],
    start: 'home',
    story: '팀 GitHub 저장소(`' + URL + '`)에 처음 기여해요. 아직 내 PC 에는 아무것도 없어요.\n\n> "저장소를 내려받아서 `feature/readme-typo` 브랜치에서 README 오타를 고치고, 그 브랜치를 원격에 올려. 바로 main 에 올리지 마!"',
    why: '`git clone` 은 저장소 전체와 이력을 내려받고 `origin` 이라는 이름의 원격을 자동으로 등록해요. 새 브랜치를 처음 올릴 땐 `git push -u origin <브랜치>` 로 "추적(upstream)" 관계까지 설정해 두면 이후엔 `git push` / `git pull` 만으로 충분합니다.',
    setup: GP.remoteOps(5, []).concat([['fn', (lab) => lab.startAtHome()]]),
    goals: [
      ['저장소를 clone 했어요 (origin 원격 설정)', (e) => !!e.repo && e.config('remote.origin.url') === URL],
      ['feature/readme-typo 브랜치에 커밋이 있어야 해요', (e) => e.hasBranch('feature/readme-typo') && e.count('feature/readme-typo') === 6],
      ['원격에 feature/readme-typo 가 올라가 있어야 해요', (e) => e.remoteHas('feature/readme-typo')],
      ['upstream 이 설정되어 있어야 해요', (e) => e.upstream('feature/readme-typo') === 'origin/feature/readme-typo'],
      ['원격 main 은 건드리지 않아야 해요', (e) => e.remoteSubjects('main').length === 5],
    ],
    hints: ['지금 위치는 홈(~)이에요. `git clone <URL>` 로 내려받고 `cd order-system` 으로 들어가세요.', '`git switch -c feature/readme-typo` → 수정 → 커밋', '`git push -u origin feature/readme-typo`'],
    solution: { cmds: ['git clone ' + URL, 'cd order-system', 'git switch -c feature/readme-typo', ['write', 'README.md', F.readme.replace('사내', '사내용')], 'git commit -am "README 오타 수정"', 'git push -u origin feature/readme-typo'], explain: '`-u`(= --set-upstream)는 처음 한 번만 필요해요.' },
  });

  add({
    id: 'remote-02', cat: 'remote', level: 3, title: 'push 가 거절됐어요 (rejected)', icon: '🚫',
    tags: ['push rejected', 'non-fast-forward', 'fetch first', 'pull --rebase', 'push 거절', '원격에 새 커밋'],
    story: '로컬에서 커밋하고 `git push` 했더니 **rejected** 가 뜨네요. 그 사이 팀원 minji 가 먼저 push 했나 봐요.\n\n> "원격의 변경을 먼저 받아서 내 커밋을 그 위에 얹고(rebase), 다시 push 해. merge 커밋은 만들지 말고!"',
    why: '원격 브랜치가 내가 모르는 커밋을 갖고 있으면 push 가 거절돼요(fast-forward 가 아니기 때문). `git pull --rebase` 로 원격 변경을 받은 뒤 내 커밋을 그 위에 다시 쌓으면 이력이 일직선으로 유지돼요.',
    setup: GP.remoteOps(5).concat([['aCommit', 'minji', '공지 배너 추가', { 'src/Banner.java': 'class Banner {}\n' }], ['as', 'minji', 'git push -q'], ['commit', '주문 목록 정렬', { 'src/OrderList.java': 'class OrderList {}\n' }]]),
    goals: [
      ['원격 main 에 minji 의 커밋과 내 커밋이 모두 있어야 해요', (e) => e.remoteSubjects('main').includes('공지 배너 추가') && e.remoteSubjects('main').includes('주문 목록 정렬')],
      ['merge 커밋 없이 일직선이어야 해요 (총 7개)', (e) => e.count('main') === 7 && e.firstParentSubjects('main').length === 7],
      ['로컬과 원격이 일치해야 해요', (e) => e.synced('main')],
    ],
    hints: ['`git push` 를 먼저 해서 거절 메시지를 읽어 보세요.', '`git pull --rebase` → `git push`'],
    solution: { cmds: [{ cmd: 'git push', allowFail: true }, 'git pull --rebase', 'git push'], explain: '`git config pull.rebase true` 를 설정하면 매번 --rebase 를 안 써도 돼요.' },
  });

  add({
    id: 'remote-03', cat: 'remote', level: 3, title: 'pull 이 "divergent branches" 라며 안 돼요', icon: '🧬',
    tags: ['divergent branches', 'pull', 'pull.rebase', 'Need to specify how to reconcile', 'pull 오류', 'merge or rebase'],
    story: '`git pull` 을 했더니 이런 메시지가 나와요: **Need to specify how to reconcile divergent branches.**\n\n> "우리 팀 규칙은 pull 할 땐 merge 로 합치는 거야. 이 저장소 기본 설정을 merge 방식으로 정하고, 받아서 push 까지 끝내."',
    why: '로컬과 원격이 서로 다른 커밋을 가졌을 때, git 은 합치는 방식(merge/rebase/ff-only)을 명시하라고 요구해요. `git config pull.rebase false`(merge) / `true`(rebase) / `pull.ff only` 로 기본값을 정해 둘 수 있어요.',
    setup: GP.remoteOps(5).concat([['aCommit', 'minji', '공지 배너 추가', { 'src/Banner.java': 'class Banner {}\n' }], ['as', 'minji', 'git push -q'], ['commit', '주문 목록 정렬', { 'src/OrderList.java': 'class OrderList {}\n' }]]),
    goals: [
      ['pull.rebase 가 false(merge 방식)로 설정되어 있어야 해요', (e) => e.config('pull.rebase') === 'false' || e.sim.globalConfig.get('pull.rebase') === 'false'],
      ['merge 커밋이 만들어져야 해요', (e) => e.parents('main') === 2],
      ['원격에 반영(push)되어야 해요', (e) => e.synced('main')],
    ],
    hints: ['`git pull` 의 힌트에 설정 명령이 나와 있어요.', '`git config pull.rebase false` 후 다시 `git pull`, 그리고 `git push`'],
    solution: { cmds: [{ cmd: 'git pull', allowFail: true }, 'git config pull.rebase false', 'git pull --no-edit', 'git push'], explain: '전역으로 정하려면 `git config --global pull.rebase false`.' },
  });

  add({
    id: 'remote-04', cat: 'remote', level: 2, title: 'fetch 로 먼저 살펴보고 합치기', icon: '🔭',
    tags: ['fetch', 'origin/main', 'log HEAD..origin', 'pull vs fetch', '원격 변경 확인', 'diff origin'],
    story: 'minji 가 push 했다고 하네요. 그런데 무엇이 바뀌었는지 확인도 안 하고 `pull` 하기는 불안해요.\n\n> "fetch 로 가져와서 어떤 커밋이 새로 들어왔는지 먼저 보고, 그다음에 합쳐."',
    why: '`git fetch` 는 원격의 변경을 **받아오기만** 하고 내 브랜치는 건드리지 않아요. `git log HEAD..origin/main` 으로 새 커밋만 볼 수 있죠. `pull` 은 fetch + merge(또는 rebase) 를 한 번에 하는 명령이에요.',
    setup: GP.remoteOps(5).concat([['aCommit', 'minji', '공지 배너 추가', { 'src/Banner.java': 'class Banner {}\n' }], ['aCommit', 'minji', '배너 닫기 버튼', { 'src/Banner.java': 'class Banner { void close() {} }\n' }], ['as', 'minji', 'git push -q']]),
    goals: [
      ['`git fetch` 를 실행했어요', (e) => e.ranMatch(/^git fetch/)],
      ['새 커밋만 `git log HEAD..origin/main` 으로 확인했어요', (e) => e.ranMatch(/^git log.*(HEAD\.\.origin\/main|main\.\.origin\/main)/)],
      ['로컬 main 이 origin/main 과 같아졌어요', (e) => e.synced('main') && e.count('main') === 7],
    ],
    hints: ['`git fetch` 다음 `git log --oneline HEAD..origin/main`', '확인 후 `git merge origin/main` (또는 `git pull`)'],
    solution: { cmds: ['git fetch', 'git log --oneline HEAD..origin/main', 'git diff --stat HEAD origin/main', 'git merge origin/main'], explain: '`HEAD..origin/main` = "origin/main 에는 있고 HEAD 에는 없는 커밋".' },
  });

  add({
    id: 'remote-05', cat: 'remote', level: 3, title: '내 브랜치 이력을 고친 뒤 안전하게 force push', icon: '🪂',
    tags: ['force push', '--force-with-lease', 'push -f', 'amend 후 push', 'rebase 후 push'],
    story: '이미 push 한 내 `feature/search` 의 마지막 커밋 메시지를 `--amend` 로 고쳤어요. 이제 일반 push 는 거절돼요.\n\n> "내 개인 브랜치니까 덮어써도 돼. 근데 `--force` 말고 더 안전한 방법으로!"',
    why: '`--force` 는 원격이 어떻든 무조건 덮어써서 팀원의 커밋을 날릴 수 있어요. `--force-with-lease` 는 "내가 마지막으로 본 원격 상태와 같을 때만" 덮어써서 훨씬 안전합니다. 공유 브랜치(main 등)엔 둘 다 쓰지 마세요.',
    setup: GP.remoteOps(5).concat(['git switch -q -c feature/search', ['commit', '검색 api 추가', { 'src/Search.java': 'class Search {}\n' }], 'git push -q -u origin feature/search', 'git commit -q --amend -m "검색 API 추가"']),
    goals: [
      ['원격 feature/search 의 마지막 커밋이 수정된 메시지여야 해요', (e) => e.remoteSubjects('feature/search')[0] === '검색 API 추가'],
      ['로컬과 원격이 일치해야 해요', (e) => e.synced('feature/search')],
      ['`--force-with-lease` 를 사용했어요', (e) => e.ranMatch(/^git push.*--force-with-lease/)],
    ],
    hints: ['먼저 `git push` 를 해서 거절되는 것을 확인해 보세요.', '`git push --force-with-lease`'],
    solution: { cmds: [{ cmd: 'git push', allowFail: true }, 'git push --force-with-lease'], explain: 'lease 는 "내 origin/feature/search 정보가 최신일 때만"이라는 안전장치예요. 먼저 fetch 로 최신을 확인하는 습관이 중요해요.' },
  });

  add({
    id: 'remote-06', cat: 'remote', level: 2, title: '원격에서 사라진 브랜치 정리 (prune)', icon: '🍂',
    tags: ['fetch --prune', 'remote prune', '삭제된 원격 브랜치', 'stale', 'branch -r'],
    story: '`git branch -r` 을 보니 이미 삭제된 `origin/feature/old` 같은 브랜치 이름이 아직 보여요. 로컬에도 같은 이름의 지난 브랜치가 남아 있고요.\n\n> "원격에서 지워진 건 로컬 목록에서도 정리해. 로컬 브랜치도 이미 합쳐졌으니 지우고!"',
    why: '원격에서 브랜치가 삭제돼도 내 PC 의 `origin/…` 추적 브랜치는 자동으로 사라지지 않아요. `git fetch --prune`(또는 `git remote prune origin`) 으로 정리하고, 로컬 브랜치는 `git branch -d` 로 지웁니다.',
    setup: GP.remoteOps(5).concat(['git switch -q -c feature/old', ['commit', '구 기능', { 'src/Old.java': 'class Old {}\n' }], 'git push -q -u origin feature/old', 'git switch -q main', 'git merge -q feature/old', 'git push -q', ['as', 'minji', 'git fetch -q'], ['as', 'minji', 'git push -q origin --delete feature/old']]),
    goals: [
      ['origin/feature/old 추적 정보가 정리되어야 해요', (e) => !e.hasRemoteRef('origin/feature/old')],
      ['로컬 feature/old 도 삭제되어야 해요', (e) => !e.hasBranch('feature/old')],
      ['`--prune` 또는 `remote prune` 을 사용했어요', (e) => e.ranMatch(/^git fetch.*(--prune|-p)\b/) || e.ranMatch(/^git remote prune/)],
    ],
    hints: ['`git branch -r` 로 현재 목록을 보세요.', '`git fetch --prune` 후 `git branch -d feature/old`'],
    solution: { cmds: ['git branch -r', 'git fetch --prune', 'git branch -d feature/old'], explain: '`git config fetch.prune true` 로 fetch 때마다 자동 정리할 수 있어요.' },
  });

  add({
    id: 'remote-07', cat: 'remote', level: 2, title: '팀원 브랜치를 받아서 리뷰하기', icon: '👩‍💻',
    tags: ['switch', '원격 브랜치 체크아웃', 'tracking', '리뷰', 'origin/feature', 'checkout remote branch'],
    story: 'minji 가 `feature/coupon` 브랜치를 push 했다고 리뷰를 부탁해요. 내 PC 에는 아직 그 브랜치가 없어요.\n\n> "그 브랜치를 받아서 로컬에서 직접 확인해 봐. 나중에 minji 가 추가 push 하면 pull 로 받을 수 있게 연결도 되어 있어야 해."',
    why: '원격에 있는 브랜치는 `git fetch` 후 `git switch <이름>` 만 하면 같은 이름의 로컬 브랜치가 만들어지고 자동으로 추적(upstream)이 설정돼요. (`git checkout -b <이름> origin/<이름>` 과 같음)',
    setup: GP.remoteOps(5).concat([['as', 'minji', 'git switch -q -c feature/coupon'], ['aCommit', 'minji', '쿠폰 적용 로직', { 'src/Coupon.java': 'class Coupon {}\n' }], ['as', 'minji', 'git push -q -u origin feature/coupon']]),
    goals: [
      ['feature/coupon 브랜치에 있어야 해요', (e) => e.branch() === 'feature/coupon'],
      ['minji 의 커밋이 보여야 해요', (e) => e.subject() === '쿠폰 적용 로직'],
      ['origin/feature/coupon 을 추적해야 해요', (e) => e.upstream('feature/coupon') === 'origin/feature/coupon'],
    ],
    hints: ['먼저 `git fetch` 로 원격 정보를 갱신하고 `git branch -r` 로 확인해요.', '`git switch feature/coupon`'],
    solution: { cmds: ['git fetch', 'git branch -r', 'git switch feature/coupon'], explain: '`git switch` 가 원격 브랜치 이름을 자동으로 찾아 추적 브랜치를 만들어 주는 기능을 DWIM 이라고 불러요.' },
  });

  add({
    id: 'remote-08', cat: 'remote', level: 4, title: '보호된 main 에 push 하다 막혔어요', icon: '🔒',
    tags: ['protected branch', 'GH006', 'pull request', 'remote rejected', 'main 보호', 'push 거절'],
    story: '실수로 `main` 에 직접 커밋하고 push 했더니 **protected branch hook declined** 로 막혔어요. (우리 팀 main 은 PR 로만 반영 가능)\n\n> "그 커밋을 `feature/fix-typo` 브랜치로 push 해서 PR 을 올릴 수 있게 해. 로컬 main 은 원격 main 과 똑같이 되돌려놔."',
    why: '보호된 브랜치는 직접 push 가 막혀요. 로컬 커밋은 새 브랜치로 이름표를 붙여 두고(`git branch`), main 은 `git reset --hard origin/main` 으로 원격과 맞춘 뒤, 새 브랜치를 push 해서 PR 을 만드는 게 정석 흐름입니다.',
    setup: [['remote', URL]].concat(GP.repoOps(5)).concat(['git remote add origin ' + URL, 'git push -q -u origin main', ['fn', (lab) => { lab.remotes[URL].protectedBranches = new Set(['main']); }], ['commit', 'README 오타 수정', { 'README.md': F.readme.replace('백엔드', '백엔드 시스템') }], ['try', 'git push']]),
    goals: [
      ['원격에 feature/fix-typo 브랜치가 올라가 있어야 해요', (e) => e.remoteHas('feature/fix-typo') && e.remoteSubjects('feature/fix-typo')[0] === 'README 오타 수정'],
      ['로컬 main 이 원격 main 과 같아야 해요 (커밋 5개)', (e) => e.count('main') === 5 && e.sameCommit('main', 'origin/main')],
      ['원격 main 은 변하지 않아야 해요', (e) => e.remoteSubjects('main').length === 5],
    ],
    hints: ['지금 main 위의 커밋에 `git branch feature/fix-typo` 로 이름표부터 붙이세요.', '`git reset --hard origin/main` 으로 main 을 되돌린 뒤 `git push -u origin feature/fix-typo`'],
    solution: { cmds: ['git branch feature/fix-typo', 'git reset --hard origin/main', 'git push -u origin feature/fix-typo'], explain: '이후 GitHub 에서 feature/fix-typo → main 으로 Pull Request 를 만들면 돼요.' },
  });

  add({
    id: 'remote-09', cat: 'remote', level: 1, title: '"has no upstream branch" 오류', icon: '🔗',
    tags: ['upstream', 'push -u', 'set-upstream', 'no upstream branch', 'push 처음', '--set-upstream'],
    story: '새로 만든 `feature/invoice` 브랜치를 `git push` 했더니 이런 오류가 나요: **The current branch feature/invoice has no upstream branch.**\n\n> "오류 메시지에 해결 명령이 그대로 나와 있잖아. 읽어 보고 올려."',
    why: '새 브랜치는 원격에 짝이 없어서 `git push` 만으로는 어디로 올릴지 몰라요. `git push -u origin <브랜치>` 로 원격에 만들고 추적 관계를 연결하면 이후부터는 `git push` / `git pull` 이 바로 동작합니다.',
    setup: GP.remoteOps(5).concat(['git switch -q -c feature/invoice', ['commit', '청구서 기능', { 'src/Invoice.java': 'class Invoice {}\n' }]]),
    goals: [
      ['원격에 feature/invoice 가 있어야 해요', (e) => e.remoteHas('feature/invoice')],
      ['upstream 이 연결되어 있어야 해요', (e) => e.upstream('feature/invoice') === 'origin/feature/invoice'],
    ],
    hints: ['오류 메시지를 끝까지 읽어 보세요. 명령이 적혀 있어요.', '`git push --set-upstream origin feature/invoice` (줄여서 `-u`)'],
    solution: { cmds: [{ cmd: 'git push', allowFail: true }, 'git push --set-upstream origin feature/invoice'], explain: '`git config --global push.autoSetupRemote true` 로 자동화할 수도 있어요.' },
  });

  add({
    id: 'remote-10', cat: 'remote', level: 3, title: '저장소 주소가 바뀌었어요 (remote set-url)', icon: '🚚',
    tags: ['remote set-url', '저장소 이전', 'URL 변경', 'push --tags', '원격 주소', 'remote -v'],
    story: '회사 정책으로 저장소가 `acme/order-system` 에서 `acme-platform/order-system` 으로 이전됐어요. 새 저장소는 비어 있습니다.\n\n> "내 로컬의 origin 주소를 새 주소로 바꾸고, main 과 태그(v1.0)까지 전부 올려."',
    why: '`git remote set-url origin <새주소>` 로 원격 주소만 바꾸면 이력은 그대로 유지돼요. 새 저장소에는 브랜치와 태그를 각각 push 해야 합니다(`git push --tags` 또는 `git push origin v1.0`).',
    setup: [['remote', URL], ['remote', 'git@github.com:acme-platform/order-system.git']].concat(GP.repoOps(5)).concat(['git remote add origin ' + URL, 'git push -q -u origin main', 'git tag -a v1.0 -m "1.0 릴리즈"', 'git push -q origin v1.0']),
    goals: [
      ['origin 주소가 새 주소여야 해요', (e) => e.config('remote.origin.url') === 'git@github.com:acme-platform/order-system.git'],
      ['새 저장소에 main 이 올라가야 해요', (e) => e.remoteHas('main', 'git@github.com:acme-platform/order-system.git')],
      ['새 저장소에 v1.0 태그가 올라가야 해요', (e) => e.remoteTag('v1.0', 'git@github.com:acme-platform/order-system.git')],
    ],
    hints: ['`git remote -v` 로 현재 주소를 보세요.', '`git remote set-url origin <새주소>` 후 `git push -u origin main` 과 `git push origin --tags`'],
    solution: { cmds: ['git remote -v', 'git remote set-url origin git@github.com:acme-platform/order-system.git', 'git push -u origin main', 'git push origin --tags'], explain: '태그는 `git push` 로 자동으로 올라가지 않아요.' },
  });

  add({
    id: 'remote-11', cat: 'remote', level: 4, title: '포크한 저장소를 원본과 동기화', icon: '🍴',
    tags: ['fork', 'upstream', 'remote add', '동기화', 'fetch upstream', '포크 동기화'],
    story: '오픈소스 저장소를 fork 해서 `origin` 으로 쓰고 있어요. 원본(upstream)에는 그사이 새 커밋이 들어갔습니다.\n\n> "원본을 `upstream` 이라는 이름으로 등록해서 최신 변경을 가져와 내 main 에 반영하고, 내 fork(origin)에도 올려."',
    why: 'fork 는 원본과 별개의 저장소라 자동으로 따라가지 않아요. 원본을 두 번째 원격(`upstream`)으로 추가하고 `git fetch upstream` → `git merge upstream/main`(또는 rebase) → `git push origin main` 의 흐름으로 동기화합니다.',
    setup: [['remote', 'git@github.com:kim-dev/order-system.git'], ['remote', URL]].concat(GP.repoOps(5)).concat(['git remote add origin git@github.com:kim-dev/order-system.git', 'git push -q -u origin main',
      ['fn', (lab) => { const up = lab.sim.net.get(URL); const me = lab.repo(); G_copy(me, up, lab); }]]),
    goals: [
      ['upstream 원격이 등록되어 있어야 해요', (e) => e.config('remote.upstream.url') === URL],
      ['내 main 에 원본의 새 커밋이 들어와야 해요', (e) => e.subjects('main').includes('원본: 보안 패치')],
      ['내 fork(origin)에도 반영되어야 해요', (e) => e.synced('main') && e.remoteSubjects('main', 'git@github.com:kim-dev/order-system.git').includes('원본: 보안 패치')],
    ],
    hints: ['`git remote add upstream <원본 URL>`', '`git fetch upstream` → `git merge upstream/main` → `git push origin main`'],
    solution: { cmds: ['git remote add upstream ' + URL, 'git fetch upstream', 'git merge upstream/main', 'git push origin main'], explain: '내 main 에 커밋이 없다면 fast-forward 로 깔끔하게 합쳐져요.' },
  });

  add({
    id: 'remote-12', cat: 'remote', level: 2, title: '릴리즈 태그 만들고 올리기', icon: '🏷️',
    tags: ['tag', 'annotated tag', 'push tags', '릴리즈', 'v1.0.0', 'git tag -a'],
    story: '이번 배포 버전은 `v1.0.0` 이에요.\n\n> "현재 main 에 설명이 있는 태그(annotated)를 달고 원격에도 올려. 나중에 누가 만들었는지 알 수 있게!"',
    why: '`git tag v1` 은 단순 라벨(lightweight)이고, `git tag -a v1 -m "설명"` 은 작성자·날짜·메시지가 담긴 **주석 태그**예요. 릴리즈에는 주석 태그를 권장합니다. 태그는 `git push origin <태그명>` 으로 따로 올려야 해요.',
    setup: GP.remoteOps(8),
    goals: [
      ['v1.0.0 주석 태그가 있어야 해요', (e) => e.annotatedTag('v1.0.0')],
      ['태그가 현재 main 의 마지막 커밋을 가리켜야 해요', (e) => e.tagTarget('v1.0.0') === e.hash('main')],
      ['원격에도 태그가 올라가야 해요', (e) => e.remoteTag('v1.0.0')],
    ],
    hints: ['`git tag -a v1.0.0 -m "메시지"`', '`git push origin v1.0.0`'],
    solution: { cmds: ['git tag -a v1.0.0 -m "첫 정식 릴리즈"', 'git push origin v1.0.0'], explain: '`git show v1.0.0` 으로 태그 정보를 볼 수 있어요.' },
  });

  /* fork 시나리오: 내 fork 의 이력을 원본 저장소에 복사한 뒤 원본에 커밋 1개 추가 */
  function G_copy(me, up, lab) {
    me.objects.forEach((o, h) => { if (!up.objects.has(h)) up.objects.set(h, o); });
    up.refs.set('refs/heads/main', me.readRef('refs/heads/main'));
    // 원본에 새 커밋
    const U = globalThis.GitEngine.util;
    void U;
    const tmp = lab.sim.addActor('upstream-maint', { name: 'Maintainer', email: 'maint@oss.org' });
    void tmp;
    const dir = lab.sim.actors.get('upstream-maint').dir;
    const ctx = new (U.Ctx)(lab.sim, null, { session: lab.sim.actorSession('upstream-maint'), actor: tmp });
    ctx.session = lab.sim.actorSession('upstream-maint');
    ctx.cloneDir = dir;
    globalThis.GitEngine.commands.clone(ctx, ['-q', URL, 'maint']);
    dir.files.set('src/Security.java', 'class Security {}\n');
    lab.tick(600); lab.sim.runAs('upstream-maint', 'git add -A');
    lab.tick(600); lab.sim.runAs('upstream-maint', 'git commit -q -m "원본: 보안 패치"');
    lab.tick(600); lab.sim.runAs('upstream-maint', 'git push -q');
  }
})();
