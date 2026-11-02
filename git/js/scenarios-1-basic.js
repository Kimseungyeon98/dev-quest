/* 시나리오 1: 기본기 + 브랜치 */
(function () {
  'use strict';
  const GP = globalThis.GP;
  const F = GP.F;
  const add = GP.add;

  /* ================= 기본기 ================= */
  add({
    id: 'basic-01', cat: 'basic', level: 1, title: '첫 저장소 만들기', icon: '🌱',
    tags: ['init', '저장소 생성', '처음', '시작', '첫 커밋', 'git init'],
    story: '입사 후 처음으로 맡은 사내 도구 프로젝트예요. 팀장님이 말합니다.\n\n> "폴더에 파일은 만들어 뒀는데 아직 git 으로 관리를 안 하고 있어. 저장소를 만들고 지금 파일 전부를 첫 커밋으로 남겨 줘."',
    why: '`git init` 은 폴더를 저장소로 바꿔 주는 첫 단추예요. 이후 모든 이력은 `.git` 폴더에 쌓입니다. 커밋은 "스냅샷"이라서, 먼저 `git add` 로 담을 파일을 고른 뒤(스테이징) `git commit` 으로 확정해요.',
    setup: [['write', 'README.md', F.readme], ['write', 'src/OrderService.java', F.order], ['write', 'config/application.yml', F.yml]],
    goals: [
      ['git 저장소가 만들어져야 해요', (e) => !!e.repo],
      ['커밋이 1개 만들어져야 해요', (e) => e.count() === 1],
      ['모든 파일이 커밋되어 작업 폴더가 깨끗해야 해요', (e) => e.fullyClean()],
    ],
    hints: ['저장소를 만드는 명령은 `git init` 이에요.', '`git add .` 은 현재 폴더의 모든 변경을 스테이징해요.', '`git commit -m "메시지"` 로 커밋하세요.'],
    solution: { cmds: ['git init', 'git add .', 'git commit -m "프로젝트 초기 설정"'], explain: '`init` → `add .` → `commit -m` 이 가장 기본 흐름이에요.' },
  });

  add({
    id: 'basic-02', cat: 'basic', level: 1, title: '상태 확인하고 커밋하기', icon: '📝',
    tags: ['status', 'add', 'commit', '스테이징', '변경 확인'],
    story: '오늘 작업을 마쳤어요. OrderService 를 고치고, 새로 PaymentService 파일을 추가했습니다.\n\n> "퇴근 전에 오늘 작업 한 커밋으로 남겨 두자. 뭐가 바뀌었는지 먼저 확인하고!"',
    why: '`git status` 는 지금 무엇이 바뀌었는지(수정/새 파일/스테이징됨)를 알려주는 가장 자주 쓰는 명령이에요. 커밋 전에 습관처럼 확인하면 실수가 줄어요.',
    setup: GP.repoOps(4).concat([['write', 'src/OrderService.java', F.orderVat], ['write', 'src/PaymentService.java', F.pay]]),
    goals: [
      ['커밋이 1개 더 늘어야 해요 (총 5개)', (e) => e.count() === 5],
      ['PaymentService.java 가 커밋에 포함되어야 해요', (e) => e.inCommit('src/PaymentService.java')],
      ['OrderService.java 의 수정이 커밋되어야 해요', (e) => e.committedFile('src/OrderService.java') === F.orderVat],
      ['작업 폴더가 깨끗해야 해요', (e) => e.fullyClean()],
    ],
    hints: ['먼저 `git status` 로 상태를 확인해 보세요.', '새 파일(Untracked)도 `git add` 를 해야 커밋에 들어가요.'],
    solution: { cmds: ['git status', 'git add .', 'git commit -m "결제 모듈 및 주문 서비스 수정"'], explain: '새 파일은 add 하기 전까지 Untracked 상태라 커밋에 포함되지 않아요.' },
  });

  add({
    id: 'basic-03', cat: 'basic', level: 2, title: '일부 파일만 골라서 커밋', icon: '🎯',
    tags: ['add', '선택 커밋', '일부 파일', '커밋 분리', '스테이징'],
    story: '할인 로직(OrderService)을 완성했는데, 로컬 테스트용으로 `application.yml` 의 DB 비밀번호도 바꿔 둔 상태예요.\n\n> "yml 은 절대 올리면 안 돼! 할인 로직만 커밋해."',
    why: '`git add .` 는 편하지만 올리면 안 되는 변경까지 섞일 수 있어요. 파일 단위로 `git add <파일>` 하면 원하는 변경만 커밋에 담을 수 있습니다.',
    setup: GP.repoOps(6).concat([
      ['write', 'src/OrderService.java', 'public class OrderService {\n    public int total(int price, int qty) {\n        int sum = (int) (price * qty * 1.1);\n        return sum >= 100000 ? sum - 5000 : sum; // discount\n    }\n}\n'],
      ['write', 'config/application.yml', 'server:\n  port: 8080\nspring:\n  datasource:\n    url: jdbc:mysql://localhost:3306/shop\n    password: my-local-pass\n'],
    ]),
    goals: [
      ['할인 로직 커밋이 1개 추가되어야 해요 (총 7개)', (e) => e.count() === 7],
      ['커밋된 OrderService 에 discount 변경이 있어야 해요', (e) => /discount/.test(e.committedFile('src/OrderService.java') || '')],
      ['application.yml 은 커밋되면 안 돼요', (e) => e.committedFile('config/application.yml') === F.yml],
      ['application.yml 변경은 로컬에 그대로 남아 있어야 해요', (e) => e.unstaged().includes('config/application.yml')],
    ],
    hints: ['`git add .` 대신 파일 이름을 지정해 보세요.', '`git status` 로 스테이징된 것과 아닌 것을 확인하세요.'],
    solution: { cmds: ['git add src/OrderService.java', 'git status', 'git commit -m "주문 할인 로직 추가"'], explain: '필요한 파일만 add 하면 나머지는 Modified 상태로 남아요.' },
  });

  add({
    id: 'basic-04', cat: 'basic', level: 1, title: '무엇이 바뀌었는지 diff 로 보기', icon: '👀',
    tags: ['diff', '변경 내용', 'staged', 'cached', '리뷰 전 확인'],
    story: '코드 리뷰 요청 전에 내 변경을 한 번 훑어보려고 해요. 수정한 파일 하나는 이미 `git add` 했고, 다른 하나는 아직이에요.\n\n> "스테이징한 변경과 아직 안 한 변경, 둘 다 눈으로 확인하고 커밋해."',
    why: '`git diff` 는 "아직 스테이징 안 한" 변경을, `git diff --staged` 는 "스테이징한(커밋될)" 변경을 보여줘요. 커밋 직전에 둘 다 보는 습관이 사고를 막아 줍니다.',
    setup: GP.repoOps(6).concat([
      ['write', 'src/OrderService.java', F.orderVat.replace('1.1', '1.10')],
      'git add src/OrderService.java',
      ['write', 'src/PaymentService.java', F.pay.replace('amount > 0', 'amount > 100')],
    ]),
    goals: [
      ['`git diff` 로 아직 스테이징하지 않은 변경을 봤어요', (e) => e.ranMatch(/^git diff(?!.*--(staged|cached))/)],
      ['`git diff --staged` 로 스테이징된 변경을 봤어요', (e) => e.ranMatch(/^git diff.*--(staged|cached)/)],
      ['변경 사항을 커밋했어요 (작업 폴더 깨끗)', (e) => e.fullyClean() && e.count() === 7],
    ],
    hints: ['옵션 없는 `git diff` 와 `git diff --staged` 는 보여주는 대상이 달라요.', '둘 다 본 뒤 `git add -A` 후 커밋하세요.'],
    solution: { cmds: ['git diff', 'git diff --staged', 'git add -A', 'git commit -m "금액 검증 보강"'], explain: 'diff = 워킹 트리 vs 스테이지, diff --staged = 스테이지 vs 마지막 커밋.' },
  });

  add({
    id: 'basic-05', cat: 'basic', level: 2, title: '.gitignore 와 이미 올라간 파일', icon: '🙈',
    tags: ['gitignore', '로그 파일', '빌드 산출물', 'rm --cached', '추적 해제', '제외'],
    story: '실수로 `app.log` 와 `build/` 결과물까지 커밋해 버렸어요.\n\n> "로그랑 빌드 폴더는 저장소에 있으면 안 돼. 이제부터 무시되게 하고, 이미 올라간 건 저장소에서만 빼 줘. 내 PC 의 파일은 지우지 말고!"',
    why: '`.gitignore` 는 "아직 추적하지 않는 파일"에만 효과가 있어요. 이미 커밋된 파일은 `git rm --cached` 로 추적만 해제해야 합니다(파일 자체는 남음).',
    setup: GP.repoOps(4).concat([['commit', '임시 저장 (로그, 빌드 포함)', { 'app.log': 'INFO started\n', 'build/Main.class': 'binary', 'src/Util.java': 'public class Util {}\n' }]]),
    goals: [
      ['app.log 가 더 이상 추적되지 않아야 해요', (e) => !e.tracked('app.log')],
      ['build 폴더가 더 이상 추적되지 않아야 해요', (e) => !e.tracked('build/Main.class')],
      ['내 PC 의 app.log 파일은 그대로 있어야 해요', (e) => e.file('app.log') !== undefined && e.file('build/Main.class') !== undefined],
      ['.gitignore 가 커밋되어 있고 *.log 와 build 를 제외해야 해요', (e) => /\*\.log/.test(e.committedFile('.gitignore') || '') && /build/.test(e.committedFile('.gitignore') || '')],
      ['작업 폴더가 깨끗해야 해요 (무시되어 보이지 않음)', (e) => e.fullyClean()],
    ],
    hints: ['`.gitignore` 파일에 `*.log` 와 `build/` 를 적으세요 (nano .gitignore 나 echo).', '이미 추적 중인 파일은 `git rm -r --cached <경로>` 로 추적만 끊어요.', '.gitignore 도 add 해서 함께 커밋하세요.'],
    solution: { cmds: [['write', '.gitignore', '*.log\nbuild/\n'], 'git rm -r --cached app.log build', 'git add .gitignore', 'git commit -m "로그와 빌드 산출물 추적 해제, .gitignore 추가"'], explain: '`--cached` 가 있으면 저장소(인덱스)에서만 빼고 작업 폴더의 파일은 남겨요.' },
  });

  add({
    id: 'basic-06', cat: 'basic', level: 2, title: '파일 이름 바꾸기와 삭제', icon: '🏷️',
    tags: ['mv', 'rm', '이름 변경', '파일 삭제', 'rename'],
    story: '클래스 이름을 `OrderService` → `OrderManager` 로 바꾸기로 했고, 안 쓰는 `StockService` 는 삭제합니다.\n\n> "이름 바꾼 이력이 끊기지 않게 git 이 알도록 해줘."',
    why: '`git mv` 는 이름 변경을 스테이징까지 한 번에 해줘요. git 은 내용이 비슷하면 "이름 변경"으로 인식해서 이력을 이어 보여줍니다. `git rm` 도 삭제를 바로 스테이징해요.',
    setup: GP.repoOps(5),
    goals: [
      ['OrderManager.java 가 커밋에 있고 OrderService.java 는 없어야 해요', (e) => e.inCommit('src/OrderManager.java') && !e.inCommit('src/OrderService.java')],
      ['StockService.java 가 삭제된 채로 커밋되어야 해요', (e) => !e.inCommit('src/StockService.java')],
      ['커밋이 추가되고 작업 폴더가 깨끗해야 해요', (e) => e.count() === 6 && e.fullyClean()],
    ],
    hints: ['`git mv 옛이름 새이름`', '`git rm 파일` 은 삭제를 스테이징까지 해줘요.'],
    solution: { cmds: ['git mv src/OrderService.java src/OrderManager.java', 'git rm src/StockService.java', 'git status', 'git commit -m "OrderService 를 OrderManager 로 변경, 미사용 StockService 삭제"'], explain: 'status 에서 `renamed:` 로 보이면 git 이 이름 변경으로 인식한 거예요.' },
  });

  add({
    id: 'basic-07', cat: 'basic', level: 1, title: '방금 커밋 메시지가 엉망이에요', icon: '✏️',
    tags: ['amend', '커밋 메시지 수정', '마지막 커밋', '오타', 'commit --amend'],
    story: '급하게 `git commit -m "asdf"` 라고 해 버렸어요. 아직 push 는 안 했어요.\n\n> "메시지가 asdf 가 뭐야... 커밋은 그대로 두고 메시지만 제대로 고쳐 줘."',
    why: '`git commit --amend -m` 은 마지막 커밋을 새 커밋으로 "교체"해요. push 하기 전 로컬 커밋이라면 안전하게 쓸 수 있습니다. (이미 push 한 커밋이면 팀에 영향을 주니 주의!)',
    setup: GP.repoOps(4).concat([['commit', 'asdf', { 'src/PaymentService.java': F.pay.replace('amount > 0', 'amount > 0 /* ok */') }]]),
    goals: [
      ['마지막 커밋 메시지가 asdf 가 아니어야 해요', (e) => e.subject() !== 'asdf' && e.subject().length >= 4],
      ['커밋 개수는 그대로 5개여야 해요 (새 커밋을 늘리면 안 돼요)', (e) => e.count() === 5],
      ['변경 내용(PaymentService)은 유지되어야 해요', (e) => /ok/.test(e.committedFile('src/PaymentService.java') || '')],
    ],
    hints: ['`git commit --amend` 를 쓰면 마지막 커밋을 고칠 수 있어요.', '`-m "새 메시지"` 를 붙이면 편집기 없이 바로 바뀌어요.'],
    solution: { cmds: ['git commit --amend -m "결제 승인 조건 보강"'], explain: 'amend 는 커밋 해시가 바뀝니다. 그래서 이미 공유한 커밋에는 쓰지 않는 게 원칙이에요.' },
  });

  add({
    id: 'basic-08', cat: 'basic', level: 2, title: '커밋에 파일을 빠뜨렸어요', icon: '🧩',
    tags: ['amend', '파일 누락', 'no-edit', '커밋 추가', '빠뜨림'],
    story: '"결제 연동" 커밋을 했는데, 테스트 파일(`PaymentServiceTest.java`)을 add 하는 걸 깜빡했어요. 아직 push 전이에요.\n\n> "같은 커밋에 테스트도 들어가 있어야 리뷰가 쉬워. 새 커밋 말고 기존 커밋에 합쳐."',
    why: '`git add` 로 빠진 파일을 스테이징한 뒤 `git commit --amend --no-edit` 하면 메시지는 그대로 두고 내용만 보강할 수 있어요.',
    setup: GP.repoOps(4).concat([['commit', '결제 연동 (API + 테스트)', { 'src/PaymentService.java': F.payFix }], ['write', 'src/PaymentServiceTest.java', 'public class PaymentServiceTest {}\n']]),
    goals: [
      ['테스트 파일이 마지막 커밋에 포함되어야 해요', (e) => e.inCommit('src/PaymentServiceTest.java')],
      ['커밋 메시지는 그대로여야 해요', (e) => e.subject() === '결제 연동 (API + 테스트)'],
      ['커밋 개수는 그대로 5개여야 해요', (e) => e.count() === 5],
      ['작업 폴더가 깨끗해야 해요', (e) => e.fullyClean()],
    ],
    hints: ['먼저 빠진 파일을 `git add` 하세요.', '`git commit --amend --no-edit` 은 메시지를 그대로 둔 채 커밋을 갱신해요.'],
    solution: { cmds: ['git add src/PaymentServiceTest.java', 'git commit --amend --no-edit'], explain: '`--no-edit` 덕분에 편집기가 열리지 않아요.' },
  });

  add({
    id: 'basic-09', cat: 'basic', level: 2, title: '로그를 원하는 방식으로 보기', icon: '📜',
    tags: ['log', 'oneline', 'grep', 'author', '로그 필터', '최근 커밋', '파일 이력'],
    story: '팀장님이 현황을 물어봅니다.\n\n> "(1) 최근 커밋 3개만 한 줄씩 보여주고, (2) 커밋 메시지에 `결제` 가 들어간 것만 찾고, (3) README.md 가 바뀐 커밋만 확인해 봐."',
    why: '`git log` 는 옵션으로 보고 싶은 것만 걸러 낼 수 있어요: `--oneline`(한 줄), `-n`(개수), `--grep`(메시지 검색), `-- 경로`(파일 이력), `--author`, `--since`.',
    setup: GP.repoOps(8),
    goals: [
      ['(1) 최근 3개를 한 줄씩 봤어요', (e) => e.ranMatch(/^git log/) && e.ranMatch(/^git log(?=.*--oneline)(?=.*(-3\b|-n ?3\b|--max-count=3))/)],
      ['(2) 메시지에서 "결제" 를 검색했어요', (e) => e.ranMatch(/^git log.*--grep[= ]['"]?결제/)],
      ['(3) README.md 이력만 봤어요', (e) => e.ranMatch(/^git log.*-- README\.md/)],
    ],
    hints: ['`git log --oneline -3`', '`git log --grep="결제"`', '경로로 제한하려면 `git log -- README.md` (`--` 뒤가 파일 경로).'],
    solution: { cmds: ['git log --oneline -3', 'git log --grep="결제" --oneline', 'git log --oneline -- README.md'], explain: '`--` 는 "여기부터는 파일 경로"라는 표시예요. 브랜치 이름과 헷갈리지 않게 해줍니다.' },
  });

  add({
    id: 'basic-10', cat: 'basic', level: 1, title: '자주 쓰는 명령 별칭(alias) 만들기', icon: '⚡',
    tags: ['alias', 'config', '별칭', '단축', 'global'],
    story: '`git log --oneline --graph --all` 을 매번 치기 귀찮아요.\n\n> "`git st` 는 status, `git lg` 는 로그 그래프로 줄여 쓰게 설정해 두자. 모든 프로젝트에서 쓰게 --global 로!"',
    why: '`git config --global alias.<이름> "<명령>"` 으로 자주 쓰는 명령을 짧게 줄일 수 있어요. 설정은 홈 디렉터리의 `.gitconfig` 에 저장돼 모든 저장소에 적용됩니다.',
    setup: GP.repoOps(5),
    goals: [
      ['alias.st 가 status 로 설정', (e) => /^status/.test(e.sim.globalConfig.get('alias.st') || '')],
      ['alias.lg 가 log --oneline --graph 를 포함', (e) => /log.*--oneline.*--graph|log.*--graph.*--oneline/.test(e.sim.globalConfig.get('alias.lg') || '')],
      ['`git st` 와 `git lg` 를 실제로 사용했어요', (e) => e.ranMatch(/^git st$/) && e.ranMatch(/^git lg/)],
    ],
    hints: ['`git config --global alias.st status`', '공백이 있는 값은 따옴표로 감싸요: `alias.lg "log --oneline --graph --all"`'],
    solution: { cmds: ['git config --global alias.st status', 'git config --global alias.lg "log --oneline --graph --all"', 'git st', 'git lg'], explain: '별칭은 `.gitconfig` 의 [alias] 항목으로 저장돼요.' },
  });

  /* ================= 브랜치 ================= */
  add({
    id: 'branch-01', cat: 'branch', level: 1, title: '작업하다 보니 main 이었어요', icon: '🌿',
    tags: ['switch -c', 'branch', '브랜치 생성', 'main에서 작업', '새 브랜치로 이동'],
    story: '할인 기능을 만들려고 코드를 수정하다가 깨달았어요. 지금 `main` 브랜치예요! 아직 커밋은 안 했어요.\n\n> "main 에 바로 커밋하면 안 되지. `feature/discount` 브랜치를 만들어서 거기에 커밋해."',
    why: '수정 중인 변경은 브랜치를 바꿔도 따라옵니다. `git switch -c <새브랜치>` 는 현재 위치에서 새 브랜치를 만들고 바로 이동해서, 커밋 전 작업을 그대로 옮길 수 있어요.',
    setup: GP.repoOps(5).concat([['write', 'src/OrderService.java', F.order.replace('price * qty', 'price * qty - 1000')]]),
    goals: [
      ['feature/discount 브랜치가 있어야 해요', (e) => e.hasBranch('feature/discount')],
      ['지금 feature/discount 브랜치에 있어야 해요', (e) => e.branch() === 'feature/discount'],
      ['변경이 feature/discount 에 커밋되어야 해요', (e) => e.count('feature/discount') === 6 && /1000/.test(e.committedFile('src/OrderService.java') || '')],
      ['main 은 그대로 5개 커밋이어야 해요', (e) => e.count('main') === 5],
    ],
    hints: ['`git switch -c feature/discount` 로 만들면서 이동하세요.', '수정 내용은 따라오니 그 자리에서 add / commit 하면 됩니다.'],
    solution: { cmds: ['git switch -c feature/discount', 'git commit -am "주문 할인 적용"'], explain: '`checkout -b` 도 같은 일을 하지만 `switch -c` 가 더 직관적이에요.' },
  });

  add({
    id: 'branch-02', cat: 'branch', level: 2, title: '머지 끝난 브랜치 청소', icon: '🧹',
    tags: ['branch -d', 'branch -D', '브랜치 삭제', '정리', 'merged', '--merged'],
    story: '브랜치가 어느새 쌓였어요: `feat/login`, `feat/report`, `feat/export`.\n\n> "이미 main 에 합쳐진 건 지워서 정리하자. 아직 안 합쳐진 건 건드리면 안 돼!"',
    why: '`git branch --merged` 로 이미 합쳐진 브랜치를 확인하고 `git branch -d` 로 안전하게 삭제해요. `-d` 는 합쳐지지 않은 브랜치면 거부하고, `-D` 는 강제로 지웁니다(작업 유실 주의).',
    setup: GP.repoOps(4).concat([
      'git switch -q -c feat/login', ['commit', '로그인 화면', { 'src/Login.java': 'class Login {}\n' }], 'git switch -q main', 'git merge -q feat/login',
      'git switch -q -c feat/report', ['commit', '리포트 초안', { 'src/Report.java': 'class Report {}\n' }], 'git switch -q main',
      'git switch -q -c feat/export', ['commit', '엑셀 내보내기', { 'src/Export.java': 'class Export {}\n' }], 'git switch -q main', 'git merge -q feat/export',
    ]),
    goals: [
      ['합쳐진 feat/login 이 삭제되어야 해요', (e) => !e.hasBranch('feat/login')],
      ['합쳐진 feat/export 가 삭제되어야 해요', (e) => !e.hasBranch('feat/export')],
      ['아직 합쳐지지 않은 feat/report 는 남아 있어야 해요', (e) => e.hasBranch('feat/report')],
    ],
    hints: ['`git branch --merged` 로 합쳐진 브랜치를 확인하세요.', '`-d` 는 안전 삭제, `-D` 는 강제 삭제예요. 여기선 -d 면 충분해요.'],
    solution: { cmds: ['git branch --merged', 'git branch -d feat/login feat/export', 'git branch'], explain: 'feat/report 를 `-d` 로 지우려 하면 "not fully merged" 로 거부돼요. 그게 안전장치입니다.' },
  });

  add({
    id: 'branch-03', cat: 'branch', level: 3, title: 'main 에 바로 커밋해 버렸어요 (push 전)', icon: '🚑',
    tags: ['reset', 'branch', 'main에 커밋', '커밋 옮기기', '실수', 'reset --hard', '브랜치로 이동'],
    story: '로그인 개선 작업 2개를 `main` 에 그대로 커밋해 버렸어요. 다행히 아직 push 전이에요.\n\n> "그 커밋 2개를 `feature/login` 브랜치로 옮기고, main 은 원래대로 돌려놔."',
    why: '커밋 자체는 "가리키는 라벨(브랜치)"과 별개예요. 새 브랜치로 라벨을 먼저 붙여 두고(`git branch`), main 을 `reset --hard` 로 되돌리면 커밋은 사라지지 않고 새 브랜치에 남습니다.',
    setup: GP.repoOps(5).concat([['commit', '로그인 검증 로직 추가', { 'src/Login.java': 'class Login { boolean ok() { return true; } }\n' }], ['commit', '로그인 실패 횟수 제한', { 'src/Login.java': 'class Login { boolean ok() { return true; } int max = 5; }\n' }]]),
    goals: [
      ['feature/login 에 커밋 2개가 있어야 해요', (e) => e.hasBranch('feature/login') && e.count('feature/login') === 7],
      ['main 은 원래 5개 커밋으로 돌아가야 해요', (e) => e.count('main') === 5],
      ['작업 폴더가 깨끗해야 해요', (e) => e.fullyClean()],
    ],
    hints: ['먼저 지금 커밋들에 `git branch feature/login` 으로 이름표를 붙여요.', '그다음 main 을 `git reset --hard HEAD~2` 로 2칸 되돌리세요. (커밋은 feature/login 이 붙들고 있어서 안 사라져요)'],
    solution: { cmds: ['git branch feature/login', 'git reset --hard HEAD~2', 'git log --oneline --all'], explain: 'reset --hard 는 위험하지만, 커밋을 가리키는 다른 브랜치가 있으면 데이터는 안전해요.' },
  });

  add({
    id: 'branch-04', cat: 'branch', level: 1, title: '브랜치 이름 오타 고치기', icon: '🔤',
    tags: ['branch -m', '이름 변경', '오타', 'rename branch'],
    story: '`featrue/search` 라고 브랜치를 만들어 버렸어요. (feature 오타)\n\n> "브랜치 이름이 이상하면 PR 에서 눈에 띄잖아. 이름만 `feature/search` 로 고쳐 줘."',
    why: '`git branch -m <옛이름> <새이름>` 으로 브랜치 이름을 바꿀 수 있어요. 현재 브랜치라면 `git branch -m <새이름>` 만 써도 됩니다. 이미 원격에 올렸다면 원격 쪽 이름은 따로 정리해야 해요.',
    setup: GP.repoOps(5).concat(['git switch -q -c featrue/search', ['commit', '검색 기능 초안', { 'src/Search.java': 'class Search {}\n' }]]),
    goals: [
      ['feature/search 브랜치가 있어야 해요', (e) => e.hasBranch('feature/search')],
      ['오타 브랜치는 없어져야 해요', (e) => !e.hasBranch('featrue/search')],
      ['커밋은 그대로 보존되어야 해요 (6개)', (e) => e.count('feature/search') === 6],
    ],
    hints: ['`git branch -m 옛이름 새이름`'],
    solution: { cmds: ['git branch -m featrue/search feature/search'], explain: '브랜치는 커밋을 가리키는 포인터라 이름을 바꿔도 커밋은 그대로예요.' },
  });

  add({
    id: 'branch-05', cat: 'branch', level: 3, title: '작업 중인데 긴급 수정 요청! (stash)', icon: '🚨',
    tags: ['stash', 'stash pop', '긴급 수정', '작업 중 브랜치 이동', 'hotfix', '임시 저장'],
    story: '`feature/coupon` 브랜치에서 쿠폰 기능을 반쯤 만든 상태예요 (커밋 안 한 수정이 있음). 그때 연락이 옵니다.\n\n> "운영에서 결제 금액 검증이 빠져서 난리야! main 에 결제 상한 검증 바로 넣어줘. 하던 작업은 날리지 말고!"',
    why: '`git stash` 는 커밋하지 않은 변경을 임시 보관함에 넣고 작업 폴더를 깨끗하게 만들어 줘요. 급한 일을 처리한 뒤 `git stash pop` 으로 꺼내면 이어서 작업할 수 있습니다.',
    setup: GP.repoOps(7).concat(['git switch -q -c feature/coupon', ['write', 'src/OrderService.java', F.orderVat.replace('1.1', '1.1 - 500 /* coupon wip */')]]),
    goals: [
      ['main 에 긴급 수정 커밋이 추가되어야 해요 (총 8개)', (e) => e.count('main') === 8 && /amount < 10000000/.test(e.committedFile('src/PaymentService.java', 'main') || '')],
      ['작업하던 쿠폰 변경은 사라지지 않고 작업 폴더에 남아야 해요', (e) => /coupon wip/.test(e.file('src/OrderService.java') || '')],
      ['다시 feature/coupon 브랜치에 있어야 해요', (e) => e.branch() === 'feature/coupon'],
      ['stash 는 비워져 있어야 해요 (다 꺼냄)', (e) => e.stashCount() === 0],
    ],
    hints: ['`git stash` 로 지금 작업을 치워 두세요.', '`git switch main` → 수정 → 커밋 → `git switch feature/coupon` → `git stash pop`'],
    solution: { cmds: ['git stash push -m "쿠폰 작업 중"', 'git switch main', ['write', 'src/PaymentService.java', F.payFix], 'git commit -am "긴급: 결제 금액 상한 검증 추가"', 'git switch feature/coupon', 'git stash pop'], explain: 'stash 는 브랜치와 무관한 임시 보관함이에요. pop 하면 꺼내면서 삭제하고, apply 는 꺼내되 보관함에 남겨요.' },
  });
})();
