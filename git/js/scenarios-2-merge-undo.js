/* 시나리오 2: 병합·충돌 + 되돌리기·복구 */
(function () {
  'use strict';
  const GP = globalThis.GP;
  const F = GP.F;
  const add = GP.add;

  const THEIRS_DISCOUNT = F.order.replace('return price * qty;', 'return price * qty - 1000; // discount');
  const RESOLVED = F.order.replace('return price * qty;', 'return (int) (price * qty * 1.1) - 1000; // discount');

  /* main 과 feat/discount 가 같은 줄을 서로 다르게 고친 상태 (병합 전) */
  function conflictBase(startOn) {
    return GP.repoOps(5).concat([
      'git switch -q -c feat/discount', ['commit', '할인 적용', { 'src/OrderService.java': THEIRS_DISCOUNT }],
      'git switch -q main', ['commit', '부가세 적용', { 'src/OrderService.java': F.orderVat }],
    ]).concat(startOn === 'feat' ? ['git switch -q feat/discount'] : []);
  }

  /* ================= 병합·충돌 ================= */
  add({
    id: 'merge-01', cat: 'merge', level: 1, title: '브랜치를 합치기 (merge 커밋 남기기)', icon: '🔀',
    tags: ['merge', 'no-ff', 'fast-forward', '병합', '브랜치 합치기', 'merge commit'],
    story: '`feature/search` 작업이 끝났어요. main 은 그동안 변한 게 없습니다.\n\n> "합칠 때 \'이 기능이 여기서 합쳐졌다\'는 흔적이 남도록 merge 커밋을 만들어서 main 에 합쳐줘."',
    why: 'main 이 그대로일 땐 `git merge` 가 포인터만 앞으로 옮기는 **fast-forward** 가 됩니다(합친 흔적 없음). `--no-ff` 를 주면 항상 merge 커밋이 생겨서, 나중에 "기능 단위"로 이력을 보기 쉬워요.',
    setup: GP.repoOps(5).concat(['git switch -q -c feature/search', ['commit', '검색 API 추가', { 'src/Search.java': 'class Search {}\n' }], ['commit', '검색 결과 정렬', { 'src/Search.java': 'class Search { void sort() {} }\n' }]]),
    goals: [
      ['main 브랜치에 있어야 해요', (e) => e.branch() === 'main'],
      ['main 의 마지막 커밋이 merge 커밋(부모 2개)이어야 해요', (e) => e.parents('main') === 2],
      ['검색 기능 커밋들이 main 에 포함되어야 해요', (e) => e.subjects('main').includes('검색 결과 정렬')],
    ],
    hints: ['합치는 쪽(받는 쪽) 브랜치인 main 으로 먼저 이동해야 해요.', '`git merge --no-ff feature/search` 를 쓰세요. 메시지는 `-m` 으로 줄 수 있어요.'],
    solution: { cmds: ['git switch main', 'git merge --no-ff feature/search -m "Merge feature/search"'], explain: '`--no-ff` 없이 합치면 단순히 main 이 앞으로 이동(fast-forward)해서 병합 커밋이 만들어지지 않아요.' },
  });

  add({
    id: 'merge-02', cat: 'merge', level: 3, title: '충돌(Conflict) 해결하기', icon: '💥',
    tags: ['conflict', '충돌', 'merge conflict', '<<<<<<<', '충돌 해결', 'resolve'],
    story: '`feat/discount` 를 main 에 합치려는데 이런 메시지가 떴어요: **CONFLICT**.\n\n> "같은 줄을 둘이 다르게 고쳤네. 부가세(1.1)도, 할인(-1000)도 둘 다 반영된 코드로 직접 정리해서 merge 를 끝내줘."',
    why: '충돌은 git 이 두 변경 중 무엇을 택할지 몰라서 "사람이 정해 달라"고 멈춘 상태예요. 파일의 `<<<<<<<`, `=======`, `>>>>>>>` 표시를 정리하고, `git add` 로 "해결했다"고 알린 뒤 커밋하면 끝납니다.',
    setup: conflictBase('main'),
    goals: [
      ['병합이 완료되어야 해요 (merge 진행 중이 아님)', (e) => !e.state('merge')],
      ['merge 커밋(부모 2개)이 만들어져야 해요', (e) => e.parents('HEAD') === 2],
      ['충돌 표시(<<<<<<<)가 남아있으면 안 돼요', (e) => !/<<<<<<<|>>>>>>>/.test(e.committedFile('src/OrderService.java') || '<<<<<<<')],
      ['부가세(1.1)와 할인(discount)이 모두 반영되어야 해요', (e) => /1\.1/.test(e.committedFile('src/OrderService.java') || '') && /discount/.test(e.committedFile('src/OrderService.java') || '')],
    ],
    hints: ['`git merge feat/discount` 를 실행하면 충돌이 나요. `git status` 로 충돌 파일을 확인하세요.', '충돌 파일을 열어(`nano src/OrderService.java`) 표시를 지우고 두 변경을 합친 한 줄로 만드세요.', '수정 후 `git add <파일>` → `git commit` (편집기에서 메시지를 저장).'],
    solution: { cmds: [{ cmd: 'git merge feat/discount', allowFail: true }, 'git status', ['write', 'src/OrderService.java', RESOLVED], 'git add src/OrderService.java', 'git commit --no-edit'], explain: '충돌 해결 후에는 반드시 `git add` 로 해결 표시를 해야 커밋할 수 있어요.' },
  });

  add({
    id: 'merge-03', cat: 'merge', level: 3, title: '파일마다 한쪽 버전을 고르기 (--ours / --theirs)', icon: '⚖️',
    tags: ['ours', 'theirs', 'checkout --ours', '충돌', '한쪽 선택', '버전 선택'],
    story: '병합 중에 파일 2개가 충돌했어요: `config/application.yml`, `src/OrderService.java`.\n\n> "yml 은 우리(main) 설정이 맞아. OrderService 는 feature 쪽 버전을 그대로 써. 하나하나 고치지 말고 한 방에 정리해."',
    why: '충돌 중에는 `git checkout --ours <파일>`(내 브랜치 버전) 또는 `--theirs <파일>`(합치려는 브랜치 버전) 로 한쪽 전체를 선택할 수 있어요. 직접 편집하는 것보다 빠르고 실수가 적습니다.',
    setup: GP.repoOps(5).concat([
      'git switch -q -c feat/tuning',
      ['commit', '튜닝 반영', { 'config/application.yml': F.yml.replace('8080', '8081'), 'src/OrderService.java': THEIRS_DISCOUNT }],
      'git switch -q main',
      ['commit', '운영 포트 변경', { 'config/application.yml': F.yml.replace('8080', '9090'), 'src/OrderService.java': F.orderVat }],
      ['try', 'git merge feat/tuning'],
    ]),
    goals: [
      ['병합이 완료되어야 해요', (e) => !e.state('merge') && e.parents('HEAD') === 2],
      ['application.yml 은 main 쪽 값(9090)이어야 해요', (e) => /9090/.test(e.committedFile('config/application.yml') || '') && !/<<<</.test(e.committedFile('config/application.yml') || '')],
      ['OrderService 는 feature 쪽 버전이어야 해요', (e) => e.committedFile('src/OrderService.java') === THEIRS_DISCOUNT],
    ],
    hints: ['`git status` 로 "both modified" 파일을 확인하세요.', '`git checkout --ours config/application.yml` / `git checkout --theirs src/OrderService.java`', '선택 후 `git add` → `git commit`.'],
    solution: { cmds: ['git status', 'git checkout --ours config/application.yml', 'git checkout --theirs src/OrderService.java', 'git add config/application.yml src/OrderService.java', 'git commit --no-edit'], explain: '병합 중 `--ours` 는 "지금 내가 서 있는 브랜치", `--theirs` 는 "합치려고 가져온 브랜치"예요. (rebase 중에는 반대가 되니 주의!)' },
  });

  add({
    id: 'merge-04', cat: 'merge', level: 2, title: '병합 도중 도망치기 (merge --abort)', icon: '🏳️',
    tags: ['merge --abort', '병합 취소', '충돌 포기', '원래대로', 'abort'],
    story: '병합 중 충돌이 터졌는데 지금은 해결할 시간이 없어요.\n\n> "일단 병합 시도 전 상태로 되돌려놔. 충돌 표시가 파일에 남아있으면 안 돼!"',
    why: '`git merge --abort` 는 병합을 시작하기 전 상태로 안전하게 돌려줘요. 충돌 파일에 섞인 표시도 모두 정리됩니다.',
    setup: conflictBase('main').concat([['try', 'git merge feat/discount']]),
    goals: [
      ['병합 진행 상태가 아니어야 해요', (e) => !e.state('merge')],
      ['작업 폴더가 깨끗해야 해요', (e) => e.fullyClean()],
      ['충돌 표시가 파일에 없어야 해요', (e) => !/<<<<<<</.test(e.file('src/OrderService.java') || '<<<<<<<')],
      ['main 은 병합 전 상태(부가세 커밋)여야 해요', (e) => e.subject('main') === '부가세 적용' && e.parents('main') === 1],
    ],
    hints: ['`git status` 에 힌트가 나와 있어요: `(use "git merge --abort" ...)`'],
    solution: { cmds: ['git status', 'git merge --abort'], explain: '병합 도중에 `reset --hard` 로 해결할 수도 있지만 `--abort` 가 의도가 분명하고 안전해요.' },
  });

  add({
    id: 'merge-05', cat: 'merge', level: 2, title: '방금 한 merge 취소하기 (push 전)', icon: '↩️',
    tags: ['ORIG_HEAD', 'reset --hard', 'merge 취소', '병합 되돌리기', 'reflog'],
    story: 'feature 브랜치를 main 에 merge 했는데, 알고 보니 아직 합치면 안 되는 브랜치였어요. 다행히 push 는 하지 않았어요.\n\n> "merge 했던 거 없던 일로 해줘. feature 브랜치는 지우지 말고."',
    why: '`merge`, `reset`, `rebase` 같이 HEAD 를 크게 움직이는 명령은 직전 위치를 `ORIG_HEAD` 에 기록해요. 그래서 `git reset --hard ORIG_HEAD` 로 곧바로 되돌릴 수 있습니다. (push 전에만 사용하세요)',
    setup: GP.repoOps(5).concat(['git switch -q -c feature/beta', ['commit', '베타 기능', { 'src/Beta.java': 'class Beta {}\n' }], 'git switch -q main', ['commit', '문서 수정', { 'README.md': F.readme2 }], 'git merge -q feature/beta -m "Merge feature/beta"']),
    goals: [
      ['main 에 merge 커밋이 없어야 해요', (e) => e.parents('main') === 1 && e.subject('main') === '문서 수정'],
      ['feature/beta 브랜치는 남아 있어야 해요', (e) => e.hasBranch('feature/beta')],
      ['작업 폴더가 깨끗해야 해요', (e) => e.fullyClean()],
    ],
    hints: ['merge 직전 위치는 `ORIG_HEAD` 라는 이름으로 저장돼 있어요.', '`git reset --hard ORIG_HEAD`'],
    solution: { cmds: ['git log --oneline --graph', 'git reset --hard ORIG_HEAD'], explain: 'push 한 뒤라면 history 를 고치지 말고 `git revert -m 1 <merge커밋>` 을 쓰세요.' },
  });

  add({
    id: 'merge-06', cat: 'merge', level: 2, title: '지저분한 커밋을 하나로 합쳐서 가져오기 (squash merge)', icon: '🗜️',
    tags: ['squash', 'merge --squash', '커밋 합치기', '한 커밋으로', 'WIP'],
    story: '`feature/report` 는 "wip", "fix", "다시 fix" 같은 커밋이 4개나 쌓였어요.\n\n> "main 에는 \'리포트 기능 추가\' 커밋 딱 1개로 깔끔하게 들어가게 해줘. 브랜치 이력 자체는 안 합쳐도 돼."',
    why: '`git merge --squash` 는 브랜치의 변경 내용만 가져와 스테이징하고, 커밋은 직접 새로 만들게 해요. 결과적으로 main 에는 커밋 1개만 생기고 merge 커밋(부모 2개)은 만들어지지 않습니다.',
    setup: GP.repoOps(5).concat([
      'git switch -q -c feature/report',
      ['commit', 'wip', { 'src/Report.java': 'class Report {}\n' }], ['commit', 'fix', { 'src/Report.java': 'class Report { int a; }\n' }],
      ['commit', '다시 fix', { 'src/Report.java': 'class Report { int a; int b; }\n', 'src/ReportTest.java': 'class ReportTest {}\n' }], ['commit', 'wip2', { 'src/Report.java': 'class Report { int a; int b; int c; }\n' }],
      'git switch -q main',
    ]),
    goals: [
      ['main 에 커밋이 정확히 1개만 추가되어야 해요 (총 6개)', (e) => e.count('main') === 6],
      ['추가된 커밋은 merge 커밋(부모 2개)이 아니어야 해요', (e) => e.parents('main') === 1],
      ['리포트 코드 전체가 main 에 들어와야 해요', (e) => /int c;/.test(e.committedFile('src/Report.java', 'main') || '') && e.inCommit('src/ReportTest.java', 'main')],
      ['main 브랜치에 있고 작업 폴더가 깨끗해야 해요', (e) => e.branch() === 'main' && e.fullyClean()],
    ],
    hints: ['`git merge --squash feature/report` 는 커밋하지 않고 변경만 가져와요.', '그다음 직접 `git commit -m "리포트 기능 추가"` 를 하세요.'],
    solution: { cmds: ['git merge --squash feature/report', 'git commit -m "리포트 기능 추가"'], explain: 'squash 후에는 원래 브랜치와 git 상 연결이 없으니, 그 브랜치는 `-D` 로 지워야 할 수 있어요.' },
  });

  add({
    id: 'merge-07', cat: 'merge', level: 3, title: '한쪽은 삭제, 한쪽은 수정한 충돌', icon: '🗑️',
    tags: ['modify/delete', '삭제 수정 충돌', 'conflict', 'deleted by us', '파일 삭제 충돌'],
    story: '병합하려는데 이런 충돌이에요: `src/StockService.java` — main 에서는 삭제했고, feature 에서는 수정했어요.\n\n> "재고 기능은 결국 필요해졌어. feature 에서 고친 버전으로 파일을 살려서 병합을 끝내줘."',
    why: '이런 충돌(modify/delete)은 `git status` 에 `deleted by us` 같은 문구로 나와요. 파일을 살리려면 `git add <파일>`, 삭제를 유지하려면 `git rm <파일>` 로 결정을 알려주면 됩니다.',
    setup: GP.repoOps(5).concat([
      'git switch -q -c feat/stock', ['commit', '재고 수량 로직 개선', { 'src/StockService.java': F.stock.replace('100', 'Math.max(0, 100)') }],
      'git switch -q main', 'git rm -q src/StockService.java', 'git commit -q -m "미사용 재고 서비스 삭제"', ['try', 'git merge feat/stock'],
    ]),
    goals: [
      ['병합이 완료되어야 해요', (e) => !e.state('merge') && e.parents('HEAD') === 2],
      ['StockService.java 가 feature 쪽 수정본으로 살아있어야 해요', (e) => /Math\.max/.test(e.committedFile('src/StockService.java') || '')],
    ],
    hints: ['`git status` 에서 `deleted by us` 를 확인하세요.', '파일을 살리려면 `git add src/StockService.java`'],
    solution: { cmds: ['git status', 'git add src/StockService.java', 'git commit --no-edit'], explain: '삭제를 유지하고 싶다면 `git rm src/StockService.java` 후 커밋하면 돼요.' },
  });

  add({
    id: 'merge-08', cat: 'merge', level: 3, title: '충돌 시 우리 쪽을 우선해서 자동 병합 (-X ours)', icon: '🛡️',
    tags: ['-X ours', 'strategy-option', '충돌 자동', '전략', 'ours', 'theirs'],
    story: '`feat/discount` 와 main 이 같은 줄에서 충돌할 거예요. 그런데 이번엔 정책이 명확해요.\n\n> "충돌이 나는 부분은 무조건 main(우리) 코드를 우선하고, 충돌 안 나는 feature 의 변경은 그대로 가져와. 수동 편집 없이 한 번에!"',
    why: '`git merge -X ours` 는 **충돌이 나는 조각에 한해서** 내 쪽을 선택해요. 충돌 안 나는 상대 변경은 그대로 합쳐집니다. 반면 `-s ours` (전략) 는 상대 변경을 통째로 버리니 혼동 주의!',
    setup: GP.repoOps(5).concat([
      'git switch -q -c feat/discount', ['commit', '할인 적용 + 설정 추가', { 'src/OrderService.java': THEIRS_DISCOUNT, 'config/discount.yml': 'rate: 5\n' }],
      'git switch -q main', ['commit', '부가세 적용', { 'src/OrderService.java': F.orderVat }],
    ]),
    goals: [
      ['충돌 없이 병합이 완료되어야 해요', (e) => !e.state('merge') && e.parents('HEAD') === 2],
      ['충돌 구간은 main 코드(1.1)가 남아야 해요', (e) => e.committedFile('src/OrderService.java') === F.orderVat],
      ['충돌 안 나는 feature 의 새 파일은 포함되어야 해요', (e) => e.inCommit('config/discount.yml')],
    ],
    hints: ['`git merge -X ours feat/discount`', '결과를 `git show --stat` 으로 확인해 보세요.'],
    solution: { cmds: ['git merge -X ours feat/discount -m "Merge feat/discount (충돌은 main 우선)"'], explain: '자동으로 해결된 만큼 결과 검토가 중요해요. 자동 선택이 틀릴 수도 있습니다.' },
  });

  /* ================= 되돌리기·복구 ================= */
  add({
    id: 'undo-01', cat: 'undo', level: 1, title: '수정한 파일 되돌리기', icon: '🧽',
    tags: ['restore', 'checkout --', '변경 취소', '수정 되돌리기', '원래대로', 'discard'],
    story: '디버깅하느라 `OrderService.java` 에 `System.out.println` 을 잔뜩 넣었어요. 같이 고친 `PaymentService.java` 는 진짜 수정이니 남겨야 해요.\n\n> "디버그용으로 어질러진 OrderService 만 원래대로 되돌려."',
    why: '`git restore <파일>` 은 아직 커밋/스테이징 안 한 변경을 **버리고** 마지막 커밋 상태로 되돌려요. 되돌아간 변경은 복구할 수 없으니 신중하게!',
    setup: GP.repoOps(5).concat([['write', 'src/OrderService.java', F.order.replace('return', 'System.out.println("debug");\n        return')], ['write', 'src/PaymentService.java', F.pay.replace('amount > 0', 'amount > 0 && amount != 13')]]),
    goals: [
      ['OrderService 가 마지막 커밋 상태여야 해요', (e) => e.file('src/OrderService.java') === F.order],
      ['PaymentService 의 수정은 남아 있어야 해요', (e) => /amount != 13/.test(e.file('src/PaymentService.java') || '')],
    ],
    hints: ['`git restore <파일>` (예전엔 `git checkout -- <파일>`)'],
    solution: { cmds: ['git status', 'git restore src/OrderService.java'], explain: '여러 파일을 한꺼번에 버리려면 `git restore .` 이지만, 정말 필요한지 상태를 먼저 확인하세요.' },
  });

  add({
    id: 'undo-02', cat: 'undo', level: 1, title: 'git add 취소하기', icon: '📤',
    tags: ['restore --staged', 'reset', 'unstage', '스테이징 취소', 'add 취소'],
    story: '`git add .` 를 했더니 로컬 설정 `config/application.yml` 까지 스테이징돼 버렸어요.\n\n> "yml 은 커밋 대상에서 빼. 하지만 수정한 내용은 지우면 안 돼!"',
    why: '`git restore --staged <파일>` 은 스테이징만 취소하고 작업 폴더의 내용은 그대로 둬요. (옛 방식: `git reset HEAD <파일>`)',
    setup: GP.repoOps(5).concat([['write', 'config/application.yml', F.yml + '    password: local-secret\n'], ['write', 'src/OrderService.java', F.orderVat], 'git add .']),
    goals: [
      ['yml 은 스테이징에서 빠져야 해요', (e) => !e.staged().includes('config/application.yml')],
      ['yml 의 수정 내용은 작업 폴더에 남아 있어야 해요', (e) => /local-secret/.test(e.file('config/application.yml') || '') && e.unstaged().includes('config/application.yml')],
      ['OrderService 는 계속 스테이징되어 있어야 해요', (e) => e.staged().includes('src/OrderService.java')],
    ],
    hints: ['`git restore --staged <파일>`'],
    solution: { cmds: ['git status', 'git restore --staged config/application.yml'], explain: '`git reset <파일>` 도 같은 효과예요.' },
  });

  add({
    id: 'undo-03', cat: 'undo', level: 2, title: '커밋을 취소하고 변경은 남기기 (reset --soft)', icon: '🪄',
    tags: ['reset --soft', 'reset --mixed', '커밋 취소', '마지막 커밋 취소', 'HEAD~1', 'uncommit'],
    story: '방금 "주문 기능" 커밋에 파일 3개를 한꺼번에 넣었는데, 둘로 나누는 게 좋겠어요. 아직 push 전이에요.\n\n> "커밋을 취소하고, 파일들은 스테이징된 채로 놔줘. 내가 다시 나눠서 커밋할게."',
    why: '`reset` 은 브랜치를 과거로 옮기는 명령이에요. `--soft` 는 변경을 **스테이징된 채로** 남기고, 기본값(`--mixed`)은 스테이징도 풀고, `--hard` 는 변경까지 모두 버립니다.',
    setup: GP.repoOps(5).concat([['commit', '주문 기능 추가', { 'src/Coupon.java': 'class Coupon {}\n', 'src/Cart.java': 'class Cart {}\n', 'src/OrderService.java': F.orderVat }]]),
    goals: [
      ['마지막 커밋이 취소되어야 해요 (5개로)', (e) => e.count() === 5],
      ['변경 파일 3개가 스테이징된 상태여야 해요', (e) => e.staged().length === 3],
      ['파일 내용은 사라지지 않아야 해요', (e) => e.file('src/Coupon.java') !== undefined && e.file('src/Cart.java') !== undefined],
    ],
    hints: ['`git reset --soft HEAD~1` : HEAD 를 한 칸 뒤로.'],
    solution: { cmds: ['git reset --soft HEAD~1', 'git status'], explain: '기본 `git reset HEAD~1` 은 스테이징까지 풀어 "Untracked/Modified" 상태로 만들어요.' },
  });

  add({
    id: 'undo-04', cat: 'undo', level: 2, title: '마지막 커밋과 변경을 통째로 버리기', icon: '💣',
    tags: ['reset --hard', '커밋 버리기', '완전 삭제', '실험 폐기', 'hard'],
    story: '실험적으로 만든 커밋 2개가 쓸모없다고 결론이 났어요. push 는 하지 않았어요.\n\n> "그 실험은 접자. 마지막 2개 커밋을 흔적 없이 지워줘."',
    why: '`git reset --hard HEAD~N` 은 N개의 커밋과 그 변경을 작업 폴더에서까지 모두 버려요. 위험하지만, 로컬 전용 커밋이면 가장 빠른 정리 방법입니다. (실수했다면 reflog 로 복구 가능!)',
    setup: GP.repoOps(5).concat([['commit', '실험: 캐시 도입', { 'src/Cache.java': 'class Cache {}\n' }], ['commit', '실험: 캐시 적용', { 'src/OrderService.java': F.orderVat.replace('price', 'cache(price)') }]]),
    goals: [
      ['커밋 5개로 돌아가야 해요', (e) => e.count() === 5],
      ['실험 파일이 작업 폴더에서도 사라져야 해요', (e) => e.file('src/Cache.java') === undefined && e.fullyClean()],
    ],
    hints: ['`git reset --hard HEAD~2`'],
    solution: { cmds: ['git log --oneline', 'git reset --hard HEAD~2'], explain: 'HEAD~2 = 현재에서 2번째 조상. 헷갈리면 `git log --oneline` 으로 목표 커밋을 보고 해시를 써도 돼요.' },
  });

  add({
    id: 'undo-05', cat: 'undo', level: 3, title: 'reset --hard 로 날려 버린 커밋 살리기 (reflog)', icon: '🛟',
    tags: ['reflog', 'reset --hard 복구', '커밋 복구', '날린 커밋', 'HEAD@{1}', '구조'],
    story: '큰일 났어요. 커밋 3개를 만들어 놓고 `git reset --hard HEAD~3` 을 잘못 쳤어요! 작업이 전부 사라진 것처럼 보여요.\n\n> "침착해. git 은 그렇게 쉽게 잊지 않아. 날린 커밋을 되살려 봐."',
    why: '`git reflog` 는 HEAD 가 움직인 모든 기록을 보관해요(기본 90일). 브랜치에서 사라진 커밋도 reflog 에서 해시를 찾아 `reset --hard` 나 `branch` 로 되살릴 수 있어요.',
    setup: GP.repoOps(5).concat([['commit', '장바구니 기능', { 'src/Cart.java': 'class Cart {}\n' }], ['commit', '쿠폰 기능', { 'src/Coupon.java': 'class Coupon {}\n' }], ['commit', '배송비 계산', { 'src/Shipping.java': 'class Shipping {}\n' }], 'git reset --hard HEAD~3']),
    goals: [
      ['커밋 8개가 모두 복구되어야 해요', (e) => e.count() === 8],
      ['사라졌던 파일들이 돌아와야 해요', (e) => e.file('src/Cart.java') !== undefined && e.file('src/Shipping.java') !== undefined],
      ['`git reflog` 로 기록을 확인했어요', (e) => e.ranMatch(/^git reflog/)],
    ],
    hints: ['`git reflog` 를 실행해 보세요. reset 직전 위치가 `HEAD@{1}` 로 보일 거예요.', '`git reset --hard HEAD@{1}`'],
    solution: { cmds: ['git reflog', 'git reset --hard HEAD@{1}'], explain: 'reflog 는 "내 로컬 저장소"에만 있어요. clone 직후엔 비어있고, 서버에서는 볼 수 없습니다.' },
  });

  add({
    id: 'undo-06', cat: 'undo', level: 3, title: '이미 push 한 커밋 안전하게 되돌리기 (revert)', icon: '🔙',
    tags: ['revert', 'push 후 되돌리기', '운영 장애', '롤백', '커밋 되돌리기', 'git revert'],
    story: '방금 push 한 "결제 로직 변경" 때문에 결제가 전부 실패해요! 이미 팀원 minji 가 이 커밋을 pull 해 갔을 수도 있어요.\n\n> "history 를 고치면 팀이 꼬여. 그 커밋을 취소하는 새 커밋을 만들어서 push 해줘!"',
    why: '이미 공유된 커밋은 `reset` + `force push` 로 지우면 팀원 저장소가 꼬여요. `git revert` 는 "그 커밋의 반대 변경"을 새 커밋으로 추가해서 이력은 보존하고 효과만 취소합니다.',
    setup: GP.remoteOps(7).concat([['commit', '결제 로직 변경', { 'src/PaymentService.java': F.pay.replace('amount > 0', 'false') }], 'git push -q']),
    goals: [
      ['결제 로직이 원래대로 복구되어야 해요', (e) => e.committedFile('src/PaymentService.java') === F.pay],
      ['원래 커밋은 지우지 않고 Revert 커밋이 추가되어야 해요 (이력 보존)', (e) => e.subjects().includes('결제 로직 변경') && /^Revert/.test(e.subject())],
      ['원격(origin/main)에도 반영되어야 해요', (e) => e.synced('main')],
    ],
    hints: ['`git revert HEAD` 로 마지막 커밋의 반대 커밋을 만들 수 있어요.', '그 뒤 `git push` 하세요.'],
    solution: { cmds: ['git revert HEAD --no-edit', 'git push'], explain: 'revert 는 안전하지만 history 가 길어져요. 이게 "공유된 이력은 고치지 않는다"는 원칙을 지키는 방법이에요.' },
  });

  add({
    id: 'undo-07', cat: 'undo', level: 3, title: '지워버린 브랜치 되살리기', icon: '🧟',
    tags: ['branch -D 복구', '삭제한 브랜치', 'reflog', 'branch 복구', '브랜치 삭제 취소'],
    story: '`feature/payment` 브랜치를 merge 도 안 하고 `git branch -D` 로 지워 버렸어요. 그 안에는 소중한 커밋 2개가 있었어요!\n\n> "그 브랜치 다시 만들어 줘. 커밋도 그대로!"',
    why: '브랜치를 지워도 커밋 객체는 한동안 남아 있어요. `git reflog` 에서 마지막 위치를 찾아 `git branch <이름> <해시>` 로 이름표를 다시 붙이면 복구됩니다.',
    setup: GP.repoOps(5).concat(['git switch -q -c feature/payment', ['commit', '카드 결제 연동', { 'src/CardPay.java': 'class CardPay {}\n' }], ['commit', '결제 영수증', { 'src/Receipt.java': 'class Receipt {}\n' }], 'git switch -q main', 'git branch -D feature/payment']),
    goals: [
      ['feature/payment 브랜치가 다시 있어야 해요', (e) => e.hasBranch('feature/payment')],
      ['커밋 2개가 그대로 있어야 해요', (e) => e.hasBranch('feature/payment') && e.count('feature/payment') === 7],
    ],
    hints: ['`git reflog` 에서 `commit: 결제 영수증` 같은 줄을 찾아 해시를 확인하세요.', '`git branch feature/payment <해시>` 또는 `HEAD@{1}` 같은 표현을 써도 돼요.'],
    solution: { cmds: ['git reflog', 'git branch feature/payment HEAD@{1}'], explain: 'reflog 가 없다면 `git fsck --lost-found` 로 "dangling commit" 을 찾을 수도 있어요.' },
  });

  add({
    id: 'undo-08', cat: 'undo', level: 3, title: '예전에 지운 파일 되살리기', icon: '🗃️',
    tags: ['restore --source', 'checkout 파일', '삭제된 파일 복구', '과거 버전', '파일 되돌리기'],
    story: '3커밋 전에 지운 `PaymentService.java` 가 사실 필요했다는 걸 깨달았어요.\n\n> "그 파일을 삭제되기 전 내용 그대로 다시 가져와서 커밋해 줘."',
    why: '`git restore --source=<커밋> -- <파일>` 은 과거 어느 시점의 파일을 현재 작업 폴더로 꺼내와요. 삭제 커밋의 **바로 이전** 커밋을 지정해야 파일이 존재합니다. (예전 문법: `git checkout <커밋> -- <파일>`)',
    setup: GP.repoOps(5).concat([['commit', '결제 서비스 정리 (삭제)', { 'src/PaymentService.java': null }], ['commit', 'README 수정', { 'README.md': F.readme2 }], ['commit', '컨트롤러 수정', { 'src/OrderController.java': F.ctrl + '// v2\n' }]]),
    goals: [
      ['PaymentService.java 가 원래 내용으로 커밋되어 있어야 해요', (e) => e.committedFile('src/PaymentService.java') === F.pay],
      ['새 커밋 1개가 추가되어야 해요 (총 9개)', (e) => e.count() === 9],
      ['작업 폴더가 깨끗해야 해요', (e) => e.fullyClean()],
    ],
    hints: ['`git log --oneline -- src/PaymentService.java` 로 파일의 이력을 찾아 삭제 커밋을 확인해요.', '삭제 커밋의 부모(바로 앞) 시점에서 가져오세요: `git restore --source=HEAD~3 src/PaymentService.java`'],
    solution: { cmds: ['git log --oneline -- src/PaymentService.java', 'git restore --source=HEAD~3 src/PaymentService.java', 'git add src/PaymentService.java', 'git commit -m "삭제했던 결제 서비스 복구"'], explain: '`git log -- 파일` 은 지워진 파일의 이력도 보여줘요.' },
  });

  add({
    id: 'undo-09', cat: 'undo', level: 2, title: '추적 안 되는 파일 정리 (git clean)', icon: '🧺',
    tags: ['clean', '-fd', 'untracked', '임시 파일 삭제', '정리', 'dry-run'],
    story: '빌드 테스트를 돌렸더니 `tmp/` 폴더와 `notes.txt`, `debug.out` 같은 임시 파일이 널려 있어요.\n\n> "저장소를 깔끔하게 만들어. 지우기 전에 뭐가 지워질지 먼저 보여줘 (-n)!"',
    why: '`git clean` 은 추적되지 않는 파일을 **영구 삭제**해요. 반드시 `-n`(dry-run) 으로 미리 확인하고, 폴더까지 지우려면 `-d`, 실제 삭제는 `-f` 가 필요합니다.',
    setup: GP.repoOps(5).concat([['write', 'tmp/cache.bin', 'x'], ['write', 'notes.txt', 'memo'], ['write', 'debug.out', 'log']]),
    goals: [
      ['미리보기(-n)를 먼저 실행했어요', (e) => e.ranMatch(/^git clean .*-[a-z]*n/) || e.ranMatch(/^git clean .*--dry-run/)],
      ['추적되지 않는 파일이 모두 정리되어야 해요', (e) => e.untracked().length === 0],
      ['추적 중인 파일은 그대로여야 해요', (e) => e.file('README.md') !== undefined && e.fullyClean()],
    ],
    hints: ['`git clean -nd` 로 먼저 보기만 하세요.', '`git clean -fd` 로 삭제합니다.'],
    solution: { cmds: ['git clean -nd', 'git clean -fd'], explain: '`.gitignore` 에 있는 파일까지 지우려면 `-x` 를 쓰지만 아주 신중해야 해요.' },
  });

  add({
    id: 'undo-10', cat: 'undo', level: 4, title: 'push 한 merge 커밋 되돌리기 (revert -m 1)', icon: '🧯',
    tags: ['revert -m', 'merge revert', '머지 되돌리기', '병합 커밋 취소', 'mainline'],
    story: '`feature/beta` 를 main 에 merge 하고 push 했는데 베타 기능이 아직 불안정해요. 이미 공유된 상태라 reset 은 안 돼요.\n\n> "merge 커밋을 되돌리는 revert 커밋을 만들어서 push 해줘."',
    why: 'merge 커밋은 부모가 2개라서 revert 시 **어느 쪽 부모를 기준(mainline)으로 할지** 알려줘야 해요. 보통 main 쪽인 `-m 1` 을 씁니다. 나중에 같은 브랜치를 다시 합치려면 revert 를 revert 해야 하는 점도 기억하세요.',
    setup: GP.remoteOps(5).concat(['git switch -q -c feature/beta', ['commit', '베타 기능', { 'src/Beta.java': 'class Beta {}\n' }], 'git switch -q main', 'git merge -q --no-ff feature/beta -m "Merge feature/beta"', 'git push -q']),
    goals: [
      ['베타 파일이 main 에서 사라져야 해요', (e) => !e.inCommit('src/Beta.java', 'main')],
      ['merge 커밋은 이력에 남아 있고, Revert 커밋이 추가되어야 해요', (e) => e.subjects().includes('Merge feature/beta') && /^Revert/.test(e.subject())],
      ['원격에도 반영되어야 해요', (e) => e.synced('main')],
    ],
    hints: ['`git revert -m 1 HEAD` : 1번 부모(main 쪽)를 기준으로 되돌려요.'],
    solution: { cmds: ['git revert -m 1 HEAD --no-edit', 'git push'], explain: '`-m 1` 이 없으면 "is a merge but no -m option was given" 오류가 나요.' },
  });
})();
