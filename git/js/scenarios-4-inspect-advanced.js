/* 시나리오 4: 조사·디버깅 + 고급·실전 + 추가 */
(function () {
  'use strict';
  const GP = globalThis.GP;
  const F = GP.F;
  const add = GP.add;
  const URL = GP.REMOTE_URL;

  /* 버그 추적용: 10개 커밋, 7번째부터 src/Buggy.java 가 생김 */
  const BUG_MSGS = ['주문 목록 조회 추가', '검색 필터 추가', '페이징 처리', '정렬 옵션 추가', '엑셀 내보내기', '알림 메일 발송', '쿠폰 적용 개선', '관리자 화면 개선', '로그 포맷 정리', '배포 스크립트 수정'];
  function bugOps() {
    const ops = ['git init -q'];
    BUG_MSGS.forEach((m, i) => {
      const files = { ['src/Feature' + (i + 1) + '.java']: `class Feature${i + 1} {}\n` };
      if (i + 1 === 7) files['src/Buggy.java'] = 'class Buggy { int x = 1 / 0; }\n';
      ops.push(['commit', m, files]);
    });
    return ops;
  }

  /* ================= 조사·디버깅 ================= */
  add({
    id: 'inspect-01', cat: 'inspect', level: 2, title: '이 줄은 누가 바꿨지? (blame)', icon: '🕵️',
    tags: ['blame', '누가 수정', '작성자 찾기', 'git blame', '책임', 'line history'],
    story: '운영에서 `OrderService.total()` 의 계산이 이상해요. `return` 줄이 최근에 바뀐 것 같아요.\n\n> "그 줄을 마지막으로 수정한 커밋이 뭔지 찾아서, 그 커밋에 `culprit` 태그를 달아줘. 탓하려는 건 아니고, 의도를 물어보려는 거야!"',
    why: '`git blame <파일>` 은 각 줄을 마지막으로 바꾼 커밋·작성자·날짜를 보여줘요. `-L 3,3` 으로 특정 줄만 볼 수 있습니다. 찾은 커밋은 `git show <해시>` 로 그 변경의 전체 맥락(왜 바꿨는지)을 확인하세요.',
    setup: GP.repoOps(2).concat([
      ['commit', 'OrderService 주석 추가', { 'src/OrderService.java': '// 주문 서비스\n' + F.order }],
      'git add -A', // no-op
    ]).slice(0, -1).concat([
      ['write', 'src/OrderService.java', '// 주문 서비스\n' + F.order.replace('return price * qty;', 'return price * qty - 500;')], 'git add -A', 'git commit -q --author="Park Jun <jun@acme.co.kr>" -m "총액 계산에 할인 반영"',
      ['write', 'src/OrderService.java', '// 주문 서비스\n' + F.order.replace('return price * qty;', 'return price * qty - 500;').replace('public int total(int price, int qty) {', 'public int total(int price, int qty) { // 총액')], 'git add -A', 'git commit -q --author="Lee Minji <minji@acme.co.kr>" -m "메서드 주석 추가"',
    ]),
    goals: [
      ['`git blame` 으로 줄별 작성자를 봤어요', (e) => e.ranMatch(/^git blame/)],
      ['"총액 계산에 할인 반영" 커밋에 culprit 태그를 달았어요', (e) => e.hasTag('culprit') && e.tagTarget('culprit') === e.hash('HEAD~1')],
    ],
    hints: ['`git blame src/OrderService.java` 에서 `return` 줄 앞의 해시를 보세요.', '`-L 4,4` 처럼 줄 번호를 주면 그 줄만 나와요. 주석 한 줄이 추가돼 줄 번호가 밀린 점에 주의!', '`git tag culprit <해시>`'],
    solution: { cmds: ['git blame src/OrderService.java', 'git tag culprit HEAD~1'], explain: '들여쓰기·주석 같은 단순 정리 커밋에 가려질 때는 `git blame -w`(공백 무시) 나 `git log -L` 이 도움돼요.' },
  });

  add({
    id: 'inspect-02', cat: 'inspect', level: 4, title: '언제부터 버그가 생겼지? (git bisect)', icon: '🧬',
    tags: ['bisect', '이분 탐색', '버그 시작 커밋', 'git bisect good bad', '회귀', 'regression'],
    story: '요즘 서비스가 에러를 뱉어요. 알고 보니 `src/Buggy.java` 가 있는 시점부터 문제예요(이 파일이 있으면 버그!). 최근 10개 커밋 중 어디서 생겼을까요? 처음 커밋(`HEAD~9`)은 정상이었어요.\n\n> "하나씩 다 볼 필요 없어. 이분 탐색(bisect)으로 범인 커밋을 찾아서 `culprit` 태그를 달아줘. 끝나면 bisect 를 정리하고 main 으로 돌아와야 해!"',
    why: '`git bisect` 는 정상(good)과 비정상(bad) 커밋 사이를 절반씩 나눠서 검사하게 해줘요. 커밋이 1000개여도 10번 안에 범인을 찾습니다. 각 단계에서 "버그가 있는가?"만 판단하고 `git bisect good/bad` 를 알려주면 돼요. 끝나면 꼭 `git bisect reset`!',
    setup: bugOps(),
    goals: [
      ['bisect 를 시작해서 good/bad 를 표시했어요', (e) => e.ranMatch(/^git bisect start/) && e.ranMatch(/^git bisect good/) && e.ranMatch(/^git bisect bad/)],
      ['"쿠폰 적용 개선" 커밋에 culprit 태그를 달았어요', (e) => e.hasTag('culprit') && e.tagTarget('culprit') === e.hash('HEAD~3')],
      ['bisect 를 끝내고(reset) main 브랜치로 돌아왔어요', (e) => !e.state('bisect') && e.branch() === 'main'],
    ],
    hints: ['`git bisect start` → `git bisect bad` (지금 커밋) → `git bisect good HEAD~9`', '각 단계에서 `ls src` 로 Buggy.java 가 있는지 보고 있으면 `git bisect bad`, 없으면 `git bisect good`.', '"first bad commit" 이 나오면 `git bisect reset` 후 `git tag culprit <해시>`'],
    solution: { cmds: ['git bisect start', 'git bisect bad', 'git bisect good HEAD~9', 'git bisect good', 'git bisect bad', 'git bisect good', 'git bisect reset', 'git tag culprit HEAD~3'], explain: '이 시뮬레이터 결과는 실제 git 과 같은 방식으로 중간 커밋을 고릅니다(10개면 약 3~4번).' },
  });

  add({
    id: 'inspect-03', cat: 'inspect', level: 5, title: 'bisect 를 자동으로 돌리기 (bisect run)', icon: '🤖',
    tags: ['bisect run', '자동 이분 탐색', '테스트 스크립트', '회귀 자동', 'exit code'],
    story: '위와 같은 상황인데 이번엔 사람이 일일이 판단하지 않고 **명령어의 종료 코드**로 판정하게 하고 싶어요. `src/Buggy.java` 가 **없으면** 성공(0), 있으면 실패(1)로 보는 검사 명령을 쓰면 돼요.\n\n> "자동으로 범인을 찾고, 끝나면 정리한 뒤 `culprit` 태그를 달아줘."',
    why: '`git bisect run <명령>` 은 명령의 종료 코드로 good(0)/bad(1~127, 125 제외)를 자동 판정하며 끝까지 진행해요. 단위 테스트 스크립트와 조합하면 회귀 버그 추적이 완전 자동화됩니다.',
    setup: bugOps(),
    goals: [
      ['`git bisect run` 을 사용했어요', (e) => e.ranMatch(/^git bisect run/)],
      ['culprit 태그가 올바른 커밋에 있어야 해요', (e) => e.hasTag('culprit') && e.tagTarget('culprit') === e.hash('HEAD~3')],
      ['bisect 를 정리하고 main 으로 돌아왔어요', (e) => !e.state('bisect') && e.branch() === 'main'],
    ],
    hints: ['`git bisect start HEAD HEAD~9` : bad 와 good 을 한 번에 지정.', '`git bisect run sh -c "test ! -f src/Buggy.java"`', '끝나면 `git bisect reset`'],
    solution: { cmds: ['git bisect start HEAD HEAD~9', 'git bisect run sh -c "test ! -f src/Buggy.java"', 'git bisect reset', 'git tag culprit HEAD~3'], explain: '종료 코드 125 는 "이 커밋은 테스트 불가(skip)" 의미예요.' },
  });

  add({
    id: 'inspect-04', cat: 'inspect', level: 3, title: '이 문자열은 언제 들어왔지? (log -S)', icon: '🔎',
    tags: ['log -S', 'pickaxe', '문자열 검색', '코드 추가 시점', 'log -G', '상수 도입'],
    story: '코드에 `1.1` 이라는 매직 넘버(부가세율)가 있는데 언제부터 있었는지, 왜 넣었는지 아무도 몰라요.\n\n> "그 값이 처음 코드에 들어온 커밋을 찾아서 `vat-added` 태그를 달아줘."',
    why: '`git log -S"문자열"` 은 해당 문자열의 **등장 횟수가 바뀐** 커밋만 골라줘요(추가/삭제 시점 추적). 메시지 검색(--grep)과 달리 코드 내용을 기준으로 해요. 정규식은 `-G`.',
    setup: GP.repoOps(8),
    goals: [
      ['`git log -S` 로 검색했어요', (e) => e.ranMatch(/^git log.* -S/)],
      ['"주문 총액에 부가세 반영" 커밋에 vat-added 태그를 달았어요', (e) => e.hasTag('vat-added') && e.tagTarget('vat-added') === e.hash('HEAD~2')],
    ],
    hints: ['`git log -S"1.1" --oneline`', '찾은 커밋 해시 또는 `HEAD~N` 으로 `git tag vat-added <커밋>`'],
    solution: { cmds: ['git log -S"1.1" --oneline', 'git tag vat-added HEAD~2'], explain: '`git log -p -S"문자열"` 로 실제 변경 내용까지 함께 볼 수 있어요.' },
  });

  add({
    id: 'inspect-05', cat: 'inspect', level: 2, title: '내 브랜치에만 있는 것 / 둘의 차이 보기', icon: '📏',
    tags: ['log a..b', 'diff a...b', '브랜치 비교', '범위 지정', 'three dots', '두 점'],
    story: '`feature/report` 를 merge 하기 전에 점검하려고 해요.\n\n> "(1) feature/report 에는 있고 main 에는 없는 커밋 목록, (2) 갈라진 시점부터 feature 가 바꾼 파일 통계를 확인해서 알려줘."',
    why: '`git log main..feature` 는 "feature 에는 있고 main 에는 없는 커밋". `git diff main...feature` (점 3개) 는 두 브랜치가 **갈라진 지점부터** feature 가 바꾼 내용만 보여줘요. (main 이 그동안 바뀐 것은 제외)',
    setup: GP.repoOps(5).concat(['git switch -q -c feature/report', ['commit', '리포트 기본', { 'src/Report.java': 'class Report {}\n' }], ['commit', '리포트 필터', { 'src/Report.java': 'class Report { int f; }\n' }], ['commit', '리포트 엑셀', { 'src/ReportExcel.java': 'class ReportExcel {}\n' }], 'git switch -q main', ['commit', '공지 추가', { 'README.md': F.readme2 }]]),
    goals: [
      ['(1) main..feature/report 로 커밋 목록을 봤어요', (e) => e.ranMatch(/^git log.*main\.\.feature\/report/)],
      ['(2) main...feature/report 로 변경 통계를 봤어요', (e) => e.ranMatch(/^git diff.*main\.\.\.feature\/report/)],
    ],
    hints: ['`git log --oneline main..feature/report`', '`git diff --stat main...feature/report`'],
    solution: { cmds: ['git log --oneline main..feature/report', 'git diff --stat main...feature/report'], explain: '`git log main...feature` (3개) 는 양쪽에만 있는 커밋을 모두 보여줘요 (`--left-right` 와 함께 쓰면 편해요).' },
  });

  add({
    id: 'inspect-06', cat: 'inspect', level: 3, title: '이 수정은 어느 릴리즈부터 들어갔지?', icon: '📦',
    tags: ['tag --contains', 'branch --contains', 'describe', '릴리즈 확인', '포함 여부', 'which release'],
    story: '고객이 "결제 상한 버그가 고쳐졌나요?" 하고 물어봐요. 수정 커밋은 `결제 금액 상한 검증 추가` 입니다. 릴리즈는 v1.0, v1.1, v1.2 세 번 있었어요.\n\n> "그 수정이 어느 릴리즈 태그부터 들어갔는지 알아봐. 두 가지 방법(--contains 와 describe)으로 확인해 봐."',
    why: '`git tag --contains <커밋>` 은 그 커밋을 포함하는 태그를, `git branch --contains` 는 포함하는 브랜치를 알려줘요. `git describe --tags <커밋>` 은 그 커밋에서 가장 가까운 **이전** 태그와의 거리를 알려줍니다.',
    setup: GP.repoOps(3).concat(['git tag v1.0', ['commit', '재고 조회 기능 추가', { 'src/StockService.java': F.stock }], ['commit', '결제 모듈 추가', { 'src/PaymentService.java': F.pay }], 'git tag v1.1', ['commit', '결제 금액 상한 검증 추가', { 'src/PaymentService.java': F.payFix }], 'git tag v1.2', ['commit', 'README 실행 방법 추가', { 'README.md': F.readme2 }]]),
    goals: [
      ['`git tag --contains` 로 포함 릴리즈를 확인했어요', (e) => e.ranMatch(/^git tag.*--contains/)],
      ['`git describe` 도 사용했어요', (e) => e.ranMatch(/^git describe/)],
    ],
    hints: ['수정 커밋은 `HEAD~1` 이에요. `git tag --contains HEAD~1`', '`git describe --tags HEAD~1`'],
    solution: { cmds: ['git tag --contains HEAD~1', 'git describe --tags HEAD~1', 'git describe --tags'], explain: '`git describe` 결과 `v1.2-1-gabc1234` 는 "v1.2 이후 1커밋 더, 현재 커밋 abc1234" 라는 뜻이에요.' },
  });

  add({
    id: 'inspect-07', cat: 'inspect', level: 2, title: '릴리즈 노트 재료 모으기 (shortlog, 범위 로그)', icon: '📰',
    tags: ['shortlog', 'release notes', '릴리즈 노트', 'log v1..v2', '기여자', '작성자별'],
    story: 'v1.0 부터 v1.1 사이에 어떤 변경이 있었는지 릴리즈 노트를 써야 해요.\n\n> "(1) v1.0..v1.1 사이 커밋 목록, (2) 기여자별 커밋 수를 뽑아 줘."',
    why: '`git log <태그1>..<태그2>` 로 두 릴리즈 사이의 커밋을 볼 수 있고, `git shortlog -sn` 은 기여자별 커밋 수를 정렬해서 보여줘요. (`-s` 요약, `-n` 많은 순)',
    setup: GP.repoOps(2).concat(['git tag v1.0', ['commit', '재고 조회 기능 추가', { 'src/StockService.java': F.stock }], 'git commit -q --allow-empty --author="Lee Minji <minji@acme.co.kr>" -m "검색 기능 추가"', 'git commit -q --allow-empty --author="Park Jun <jun@acme.co.kr>" -m "배치 작업 추가"', 'git commit -q --allow-empty --author="Lee Minji <minji@acme.co.kr>" -m "알림 기능 추가"', 'git tag v1.1']),
    goals: [
      ['`git log v1.0..v1.1` 로 범위 로그를 봤어요', (e) => e.ranMatch(/^git log.*v1\.0\.\.v1\.1/)],
      ['`git shortlog` 로 기여자별 통계를 봤어요', (e) => e.ranMatch(/^git shortlog/)],
    ],
    hints: ['`git log --oneline v1.0..v1.1`', '`git shortlog -sn v1.0..v1.1`'],
    solution: { cmds: ['git log --oneline v1.0..v1.1', 'git shortlog -sn v1.0..v1.1'], explain: '`git log --no-merges --pretty="- %s (%an)"` 처럼 형식을 지정하면 바로 문서에 붙여 넣을 수 있어요.' },
  });

  /* ================= 고급·실전 ================= */
  add({
    id: 'adv-01', cat: 'advanced', level: 3, title: '커밋 하나만 골라서 가져오기 (cherry-pick)', icon: '🍒',
    tags: ['cherry-pick', '핫픽스', '특정 커밋만', '릴리즈 브랜치', '커밋 복사'],
    story: '`develop` 에는 쿠폰 UI, **결제 금액 상한 검증(긴급 수정)**, 배너 기능이 순서대로 들어가 있어요. 운영(main)에는 긴급 수정만 필요합니다.\n\n> "나머지 기능은 아직 나가면 안 돼. 긴급 수정 커밋만 main 으로 가져와."',
    why: '`git cherry-pick <커밋>` 은 다른 브랜치의 특정 커밋 하나를 현재 브랜치에 **복사**해 새 커밋으로 만들어요(해시는 달라짐). 핫픽스를 운영 브랜치에 반영할 때 흔히 써요.',
    setup: GP.repoOps(5).concat(['git switch -q -c develop', ['commit', '쿠폰 UI', { 'src/CouponUi.java': 'class CouponUi {}\n' }], ['commit', '결제 금액 상한 검증 (긴급)', { 'src/PaymentService.java': F.payFix }], ['commit', '배너 기능', { 'src/Banner.java': 'class Banner {}\n' }], 'git switch -q main']),
    goals: [
      ['main 에 긴급 수정만 추가되어야 해요 (총 6개)', (e) => e.count('main') === 6 && e.subject('main') === '결제 금액 상한 검증 (긴급)'],
      ['결제 상한 수정 내용이 main 에 있어야 해요', (e) => e.committedFile('src/PaymentService.java', 'main') === F.payFix],
      ['쿠폰 UI·배너는 main 에 없어야 해요', (e) => !e.inCommit('src/CouponUi.java', 'main') && !e.inCommit('src/Banner.java', 'main')],
    ],
    hints: ['`git log --oneline develop` 로 긴급 수정 커밋의 해시를 확인해요.', 'main 에서 `git cherry-pick <해시>` (또는 `develop~1`)'],
    solution: { cmds: ['git log --oneline develop', 'git cherry-pick develop~1'], explain: '`-x` 옵션을 주면 메시지에 원본 커밋 해시가 기록돼서 추적하기 좋아요.' },
  });

  add({
    id: 'adv-02', cat: 'advanced', level: 4, title: 'cherry-pick 중 충돌이 났어요', icon: '🍒💥',
    tags: ['cherry-pick conflict', 'cherry-pick --continue', 'cherry-pick --abort', '충돌', '핫픽스 충돌'],
    story: '`develop` 의 "VAT 반올림 수정" 커밋을 main 에 가져오려는데 충돌이 났어요. main 은 같은 줄에 배송비 로직을 이미 넣었거든요.\n\n> "반올림 수정과 배송비가 둘 다 반영되게 직접 정리하고 cherry-pick 을 마무리해."',
    why: 'cherry-pick 도 충돌할 수 있어요. 해결 → `git add` → `git cherry-pick --continue`. 포기하려면 `--abort`. 충돌 상태에서는 `git status` 가 안내문을 보여줘요.',
    setup: GP.repoOps(5).concat([
      'git switch -q -c develop', ['commit', 'VAT 적용', { 'src/OrderService.java': F.orderVat }], ['commit', 'VAT 반올림 수정', { 'src/OrderService.java': F.orderVat.replace('(int) (price * qty * 1.1)', 'Math.round(price * qty * 1.1f)') }],
      'git switch -q main', ['commit', '배송비 추가', { 'src/OrderService.java': F.order.replace('return price * qty;', 'return price * qty + 3000;') }],
    ]),
    goals: [
      ['cherry-pick 이 끝나 있어야 해요', (e) => !e.state('cherryPick')],
      ['main 마지막 커밋이 "VAT 반올림 수정" 이어야 해요', (e) => e.subject('main') === 'VAT 반올림 수정' && e.count('main') === 7],
      ['충돌 표시 없이 반올림과 배송비가 모두 반영되어야 해요', (e) => { const c = e.committedFile('src/OrderService.java', 'main') || '<<<<<<<'; return !/<<<<<<<|>>>>>>>/.test(c) && /Math\.round/.test(c) && /3000/.test(c); }],
    ],
    hints: ['`git cherry-pick develop` → 충돌 → `git status`', '파일을 편집해 두 변경을 합친 뒤 `git add` → `git cherry-pick --continue`'],
    solution: { cmds: [{ cmd: 'git cherry-pick develop', allowFail: true }, ['write', 'src/OrderService.java', F.order.replace('return price * qty;', 'return Math.round(price * qty * 1.1f) + 3000;')], 'git add src/OrderService.java', 'git cherry-pick --continue'], explain: 'cherry-pick 은 "그 커밋이 만든 변경(diff)"만 가져오므로, 앞선 커밋(VAT 적용)이 없으면 문맥이 달라 충돌이 나기 쉬워요.' },
  });

  add({
    id: 'adv-03', cat: 'advanced', level: 5, title: '브랜치를 엉뚱한 곳에서 땄어요 (rebase --onto)', icon: '🌳',
    tags: ['rebase --onto', '브랜치 옮기기', '잘못된 base', 'feature 에서 feature', '이식'],
    story: '`feature/b` 를 만들 때 main 이 아니라 아직 리뷰 중인 `feature/a` 에서 따 버렸어요. 그래서 b 를 PR 로 올리면 a 의 커밋까지 따라 들어가요.\n\n> "b 의 고유한 커밋 2개만 main 위로 옮겨 줘. a 의 커밋은 b 에서 빠져야 해."',
    why: '`git rebase --onto <새기준> <옛기준> <브랜치>` 는 "옛기준 이후의 내 커밋들만 떼어 새기준 위에 붙여라"는 뜻이에요. 브랜치의 뿌리를 통째로 옮길 때 강력합니다.',
    setup: GP.repoOps(5).concat([
      'git switch -q -c feature/a', ['commit', 'A: 검색 기본', { 'src/SearchA.java': 'class SearchA {}\n' }], ['commit', 'A: 검색 필터', { 'src/SearchA.java': 'class SearchA { int f; }\n' }],
      'git switch -q -c feature/b', ['commit', 'B: 알림 기본', { 'src/NotifyB.java': 'class NotifyB {}\n' }], ['commit', 'B: 알림 템플릿', { 'src/NotifyB.java': 'class NotifyB { int t; }\n' }],
    ]),
    goals: [
      ['feature/b 가 main 위에 있어야 해요 (총 7개)', (e) => e.count('feature/b') === 7 && e.isAncestor('main', 'feature/b')],
      ['feature/b 에 A 의 커밋이 없어야 해요', (e) => !e.subjects('feature/b').some((s) => /^A:/.test(s))],
      ['B 의 커밋 2개는 유지되어야 해요', (e) => e.subjects('feature/b').filter((s) => /^B:/.test(s)).length === 2],
      ['feature/a 는 그대로여야 해요', (e) => e.count('feature/a') === 7],
    ],
    hints: ['`git log --oneline --graph --all` 로 구조를 확인하세요.', '`git rebase --onto main feature/a feature/b`'],
    solution: { cmds: ['git log --oneline --graph --all', 'git rebase --onto main feature/a feature/b', 'git log --oneline --graph --all'], explain: '인자 3개: --onto <갈 곳> <어디부터 떼어올지(제외)> <옮길 브랜치>.' },
  });

  add({
    id: 'adv-04', cat: 'advanced', level: 4, title: 'detached HEAD 에서 작업해 버렸어요', icon: '👻',
    tags: ['detached HEAD', 'checkout tag', '커밋 구출', 'reflog', 'branch 로 저장', '길 잃은 커밋'],
    story: 'v1.0 태그가 정상 동작하는지 보려고 `git switch --detach v1.0` 으로 이동했다가, 거기서 파일을 고치고 커밋을 2개나 만들었어요. 그러고는 main 으로 돌아와 버렸습니다. 경고가 떴지만 무시했네요...\n\n> "그 커밋 2개를 `rescue` 라는 브랜치로 살려내."',
    why: 'detached HEAD 에서 만든 커밋은 어떤 브랜치에도 속하지 않아서, 다른 곳으로 이동하면 reflog 에만 남아요. `git reflog` 로 마지막 위치를 찾아 `git branch rescue <해시>` 하면 살릴 수 있습니다. 애초에 `git switch -c` 로 브랜치를 만들고 작업하세요.',
    setup: GP.repoOps(5).concat(['git tag v1.0', ['commit', '다음 기능 개발', { 'src/Next.java': 'class Next {}\n' }], 'git switch -q --detach v1.0', ['commit', '임시 패치 1', { 'src/Patch.java': 'class Patch {}\n' }], ['commit', '임시 패치 2', { 'src/Patch.java': 'class Patch { int v; }\n' }], 'git switch -q main']),
    goals: [
      ['rescue 브랜치가 있어야 해요', (e) => e.hasBranch('rescue')],
      ['임시 패치 커밋 2개가 rescue 에 있어야 해요 (v1.0 위에 2개 = 7개)', (e) => e.hasBranch('rescue') && e.count('rescue') === 7 && e.subject('rescue') === '임시 패치 2'],
      ['`git reflog` 를 사용했어요', (e) => e.ranMatch(/^git reflog/)],
    ],
    hints: ['`git reflog` 의 `commit: 임시 패치 2` 줄을 찾으세요.', '`git branch rescue HEAD@{1}`  (또는 해당 해시)'],
    solution: { cmds: ['git reflog', 'git branch rescue HEAD@{1}'], explain: 'reflog 는 보통 90일 동안 유지돼요. 그 안에 구조해야 합니다.' },
  });

  add({
    id: 'adv-05', cat: 'advanced', level: 3, title: '새 파일까지 임시 보관 (stash -u)', icon: '📦',
    tags: ['stash -u', 'include-untracked', '새 파일 stash', 'stash list', 'stash pop', 'untracked'],
    story: '쿠폰 기능을 만들며 기존 파일 수정과 **새 파일(`Coupon.java`)** 을 만들어 두었어요. 지금 급하게 다른 브랜치(`hotfix/login`)를 확인해야 해요.\n\n> "그냥 stash 하면 새 파일이 남아서 브랜치 이동에 방해돼. 새 파일까지 같이 치웠다가, 돌아오면 모두 복구해."',
    why: '기본 `git stash` 는 **추적 중인 파일**의 변경만 보관해요. 새로 만든 untracked 파일도 함께 보관하려면 `git stash -u` (`--include-untracked`) 를 사용하세요.',
    setup: GP.repoOps(5).concat(['git branch hotfix/login', ['write', 'src/OrderService.java', F.orderVat], ['write', 'src/Coupon.java', 'class Coupon {}\n']]),
    goals: [
      ['`git stash -u` 를 사용했어요', (e) => e.ranMatch(/^git stash( push)? .*(-u|--include-untracked)/)],
      ['hotfix/login 브랜치를 다녀왔어요 (switch/checkout 기록)', (e) => e.ranMatch(/^git (switch|checkout) hotfix\/login/)],
      ['작업이 모두 복구되어야 해요 (수정 + 새 파일)', (e) => e.file('src/OrderService.java') === F.orderVat && e.file('src/Coupon.java') !== undefined],
      ['원래 브랜치(main)로 돌아오고 stash 는 비어 있어야 해요', (e) => e.branch() === 'main' && e.stashCount() === 0],
    ],
    hints: ['`git stash -u`', '`git switch hotfix/login` → `git switch main` → `git stash pop`'],
    solution: { cmds: ['git stash -u', 'git status', 'git switch hotfix/login', 'git switch main', 'git stash pop'], explain: '`-a`(--all) 는 .gitignore 된 파일까지 포함해요.' },
  });

  add({
    id: 'adv-06', cat: 'advanced', level: 4, title: 'stash pop 이 충돌났어요', icon: '🥵',
    tags: ['stash pop conflict', 'stash drop', '충돌', 'stash apply', 'stash 충돌'],
    story: '보관해 둔 stash 를 `git stash pop` 했더니 충돌이에요. 그 사이 main 에 같은 줄을 수정한 커밋이 들어왔거든요.\n\n> "충돌 해결해서 두 변경을 모두 살리고, 다 끝났으면 stash 를 정리해."',
    why: 'stash 충돌 시 `pop` 은 성공하지 못했다고 보고 **stash 를 지우지 않고 남겨 둬요**("The stash entry is kept"). 충돌을 해결한 뒤 `git stash drop` 으로 직접 지워야 합니다.',
    setup: GP.repoOps(5).concat([['write', 'src/OrderService.java', F.order.replace('return price * qty;', 'return price * qty - 500; // stash')], 'git stash', ['commit', '부가세 적용', { 'src/OrderService.java': F.orderVat }], ['try', 'git stash pop']]),
    goals: [
      ['충돌 파일에 표시가 없어야 해요', (e) => e.conflicts().length === 0 && !/<<<<<<<|>>>>>>>/.test(e.file('src/OrderService.java') || '<<<<<<<')],
      ['부가세(1.1)와 stash 변경(500)이 모두 반영되어야 해요', (e) => /1\.1/.test(e.file('src/OrderService.java') || '') && /500/.test(e.file('src/OrderService.java') || '')],
      ['stash 가 비워져야 해요', (e) => e.stashCount() === 0],
    ],
    hints: ['`git status` 로 충돌 파일을 확인하고 편집하세요.', '해결 후 `git add src/OrderService.java` → `git stash drop`'],
    solution: { cmds: ['git status', ['write', 'src/OrderService.java', F.order.replace('return price * qty;', 'return (int) (price * qty * 1.1) - 500; // stash')], 'git add src/OrderService.java', 'git stash drop'], explain: '`git stash apply` 는 항상 stash 를 남겨두므로 충돌 걱정이 있을 땐 apply → 확인 → drop 이 안전해요.' },
  });

  add({
    id: 'adv-07', cat: 'advanced', level: 4, title: 'rebase 를 잘못했어요! 되돌리기', icon: '⏮️',
    tags: ['ORIG_HEAD', 'rebase 되돌리기', 'reflog', 'rebase 후회', 'reset --hard ORIG_HEAD'],
    story: '`feature/x` 를 main 위로 rebase 해 버렸는데, 결과를 보니 원래 이력이 훨씬 나았어요(아직 push 안 함).\n\n> "rebase 이전 상태로 정확히 돌려놔."',
    why: 'rebase 도 HEAD 를 크게 옮기는 작업이라 시작 직전 위치가 `ORIG_HEAD` 에 저장돼요. 끝난 직후라면 `git reset --hard ORIG_HEAD`, 시간이 지났다면 `git reflog` 에서 `rebase (start)` 직전 항목을 찾아 reset 하세요.',
    setup: GP.repoOps(5).concat(['git switch -q -c feature/x', ['commit', 'X 기능 1', { 'src/X.java': 'class X {}\n' }], ['commit', 'X 기능 2', { 'src/X.java': 'class X { int n; }\n' }], ['fn', (lab) => { lab.mark = lab.repo().resolveCommit('HEAD'); }], 'git switch -q main', ['commit', '공지 추가', { 'README.md': F.readme2 }], 'git switch -q feature/x', 'git rebase -q main']),
    goals: [
      ['feature/x 가 rebase 이전 커밋(원래 해시)으로 돌아와야 해요', (e) => e.hash('HEAD') === e.lab.mark],
      ['feature/x 브랜치 위에 있고 작업 폴더가 깨끗해야 해요', (e) => e.branch() === 'feature/x' && e.fullyClean()],
    ],
    hints: ['`git reflog` 에서 `rebase (start)` 바로 아래 줄이 rebase 직전 상태예요.', '`git reset --hard ORIG_HEAD`'],
    solution: { cmds: ['git reflog', 'git reset --hard ORIG_HEAD'], explain: '`ORIG_HEAD` 는 다음 위험한 명령이 실행되면 덮어써지니, 복구는 빨리 하세요.' },
  });

  add({
    id: 'adv-08', cat: 'advanced', level: 5, title: 'stash 를 drop 해 버렸어요 (fsck 로 구조)', icon: '🧯',
    tags: ['fsck', 'dangling commit', 'stash drop 복구', 'lost-found', '삭제된 stash', 'unreachable'],
    story: '중요한 작업을 stash 해 두었는데 실수로 `git stash drop` 을 쳐 버렸어요! `git stash list` 는 비어 있어요.\n\n> "stash 도 결국 커밋 객체야. 아직 지워지지 않고 떠다니는(dangling) 커밋을 찾아서 작업을 되살려."',
    why: '`git fsck --unreachable`(또는 `--lost-found`) 는 어떤 ref 에서도 가리키지 않는 "떠다니는 객체"를 찾아줘요. 드롭된 stash 는 `WIP on ...` 메시지의 커밋으로 남아 있어, 해시로 `git stash apply <해시>` 하면 복구돼요.',
    setup: GP.repoOps(5).concat([['write', 'src/OrderService.java', F.orderVat.replace('1.1', '1.1 + 0 /* important */')], 'git stash', 'git stash drop']),
    goals: [
      ['`git fsck` 로 떠다니는 커밋을 찾아봤어요', (e) => e.ranMatch(/^git fsck/)],
      ['중요한 작업(important)이 작업 폴더에 복구되어야 해요', (e) => /important/.test(e.file('src/OrderService.java') || '')],
    ],
    hints: ['`git fsck --unreachable | grep commit` 으로 후보를 찾아요.', '`git show <해시>` 로 내용을 확인하고 `git stash apply <해시>`'],
    solution: { cmds: ['git fsck --unreachable', ['fn', (lab) => { const r = lab.repo(); let found = null; r.objects.forEach((o, h) => { if (o.type === 'commit' && /^WIP on/.test(o.message) && o.parents.length >= 2) found = h; }); lab.must(lab.runUser('git stash apply ' + found.slice(0, 10)), 'stash apply'); }]], explain: 'drop 직후에는 출력된 해시(Dropped refs/stash@{0} (해시))를 바로 쓸 수 있어요. 시간이 지나면 gc 가 지울 수 있습니다.' },
  });

  /* ================= 추가 기본/되돌리기/원격 ================= */
  add({
    id: 'basic-11', cat: 'basic', level: 1, title: '"Author identity unknown" 오류', icon: '🪪',
    tags: ['user.name', 'user.email', 'Author identity unknown', 'config', '커밋 안됨', '처음 설정', '신원'],
    story: '새 PC 라서 git 설정이 비어 있어요. 커밋을 하려니 이런 오류가 나요: **Please tell me who you are.**\n\n> "이 저장소에서 쓸 이름(Kim Dev)과 회사 이메일(kim.dev@acme.co.kr)을 설정하고 첫 커밋을 완료해."',
    why: '커밋에는 작성자(이름·이메일)가 박혀요. `git config user.name/email` 로 설정하면 이 저장소에만, `--global` 을 붙이면 모든 저장소에 적용됩니다. 회사/개인 프로젝트를 구분해서 쓰려면 저장소별 설정이 좋아요.',
    setup: [['write', 'README.md', F.readme], ['write', 'src/OrderService.java', F.order], 'git init -q', 'git add .', ['fn', (lab) => { lab.sim.globalConfig.delete('user.name'); lab.sim.globalConfig.delete('user.email'); }]],
    goals: [
      ['커밋이 만들어져야 해요', (e) => e.count() === 1],
      ['작성자 이메일이 kim.dev@acme.co.kr 이어야 해요', (e) => e.authorOf('HEAD') === 'kim.dev@acme.co.kr'],
      ['작성자 이름이 Kim Dev 이어야 해요', (e) => e.commitObj('HEAD').author.name === 'Kim Dev'],
    ],
    hints: ['먼저 `git commit -m "첫 커밋"` 으로 오류를 확인해 보세요.', '`git config user.name "Kim Dev"` 와 `git config user.email kim.dev@acme.co.kr`'],
    solution: { cmds: [{ cmd: 'git commit -m "첫 커밋"', allowFail: true }, 'git config user.name "Kim Dev"', 'git config user.email kim.dev@acme.co.kr', 'git commit -m "첫 커밋"'], explain: '설정 확인은 `git config --list --show-origin`(실제 git) 또는 `git config user.email`.' },
  });

  add({
    id: 'undo-11', cat: 'undo', level: 3, title: '최근 커밋 여러 개를 한꺼번에 revert', icon: '⏪',
    tags: ['revert range', 'revert HEAD~3..HEAD', '여러 커밋 취소', '롤백', '범위 revert'],
    story: '이미 공유된 main 에 어제 들어간 커밋 3개가 전부 잘못된 방향이었어요. reset 은 쓸 수 없어요.\n\n> "history 는 건드리지 말고, 그 3개를 되돌리는 revert 커밋으로 처리해줘."',
    why: '`git revert HEAD~3..HEAD` 처럼 범위를 주면 범위 안의 커밋을 **최신 것부터** 차례로 되돌려요. 각각 revert 커밋이 생기며, `-n` 을 주면 커밋 없이 한 번에 합쳐서 직접 커밋할 수도 있어요.',
    setup: GP.repoOps(5).concat([['commit', '실험 1: 캐시', { 'src/Cache.java': 'class Cache {}\n' }], ['commit', '실험 2: 큐', { 'src/Queue.java': 'class Queue {}\n' }], ['commit', '실험 3: 샤딩', { 'src/Shard.java': 'class Shard {}\n' }]]),
    goals: [
      ['실험 파일 3개가 모두 사라져야 해요', (e) => !e.inCommit('src/Cache.java') && !e.inCommit('src/Queue.java') && !e.inCommit('src/Shard.java')],
      ['원래 커밋은 남고 Revert 커밋 3개가 추가되어야 해요 (총 11개)', (e) => e.count() === 11 && e.subjects().filter((s) => /^Revert/.test(s)).length === 3],
      ['작업 폴더가 깨끗해야 해요', (e) => e.fullyClean()],
    ],
    hints: ['`git revert HEAD~3..HEAD` (메시지 편집 없이 하려면 `--no-edit`)'],
    solution: { cmds: ['git revert --no-edit HEAD~3..HEAD'], explain: '`HEAD~3..HEAD` 는 "HEAD~3 는 제외하고 HEAD 까지"이므로 3개 커밋이에요.' },
  });

  add({
    id: 'remote-13', cat: 'remote', level: 1, title: '빈 원격 저장소에 첫 push', icon: '🆕',
    tags: ['remote add', 'push -u', '새 저장소', '빈 저장소', 'origin', '처음 올리기'],
    story: '로컬에서만 작업하던 프로젝트를 GitHub 에 올리기로 했어요. 팀장님이 빈 저장소(`' + URL + '`)를 만들어 줬습니다.\n\n> "원격 주소를 origin 으로 연결하고 main 브랜치를 올려. 앞으로 push/pull 이 바로 되도록 추적 설정까지!"',
    why: '`git remote add origin <URL>` 로 원격에 별명(origin)을 붙이고, `git push -u origin main` 으로 처음 올리면서 추적 관계도 설정해요. 이후엔 `git push` / `git pull` 만으로 충분합니다.',
    setup: [['remote', URL]].concat(GP.repoOps(6)),
    goals: [
      ['origin 원격이 연결되어 있어야 해요', (e) => e.config('remote.origin.url') === URL],
      ['원격에 main 이 올라가 있어야 해요 (6커밋)', (e) => e.remoteSubjects('main').length === 6],
      ['추적 관계(upstream)가 설정되어야 해요', (e) => e.upstream('main') === 'origin/main'],
    ],
    hints: ['`git remote add origin ' + URL + '`', '`git push -u origin main`'],
    solution: { cmds: ['git remote add origin ' + URL, 'git remote -v', 'git push -u origin main'], explain: '`git branch -M main` 은 기본 브랜치 이름을 main 으로 통일할 때 써요.' },
  });
})();
