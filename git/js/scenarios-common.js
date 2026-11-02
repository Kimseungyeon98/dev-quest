/* 시나리오 공통 도우미: 카테고리, 샘플 프로젝트 파일, 이력 생성 */
(function () {
  'use strict';
  const GP = (globalThis.GP = globalThis.GP || {});

  GP.categories = [
    { id: 'basic', icon: '🌱', name: '기본기', desc: '저장소 만들기부터 커밋, 로그 보기까지' },
    { id: 'branch', icon: '🌿', name: '브랜치', desc: '가지 치기, 옮기기, 정리하기' },
    { id: 'merge', icon: '🔀', name: '병합·충돌', desc: 'merge 와 conflict 해결' },
    { id: 'undo', icon: '⏪', name: '되돌리기·복구', desc: '실수했을 때 살아나는 법' },
    { id: 'history', icon: '✂️', name: '히스토리 정리', desc: 'rebase, amend 로 깔끔하게' },
    { id: 'remote', icon: '🌐', name: '원격·협업', desc: 'push 거절, pull, 팀 작업' },
    { id: 'inspect', icon: '🔍', name: '조사·디버깅', desc: '누가·언제·왜 바꿨는지 찾기' },
    { id: 'advanced', icon: '🧰', name: '고급·실전', desc: 'cherry-pick, stash, 핫픽스' },
  ];

  GP.scenarios = [];
  GP.REMOTE_URL = 'git@github.com:acme/order-system.git';

  /* ---- 샘플 프로젝트 (SI 스타일 주문 관리 시스템) ---- */
  const F = {
    readme: '# 주문 관리 시스템\n\n사내 주문 처리용 백엔드입니다.\n',
    readme2: '# 주문 관리 시스템\n\n사내 주문 처리용 백엔드입니다.\n\n## 실행 방법\n\n`./gradlew bootRun`\n',
    yml: 'server:\n  port: 8080\nspring:\n  datasource:\n    url: jdbc:mysql://localhost:3306/shop\n',
    ignore: '*.log\nbuild/\n',
    order: 'public class OrderService {\n    public int total(int price, int qty) {\n        return price * qty;\n    }\n}\n',
    orderVat: 'public class OrderService {\n    public int total(int price, int qty) {\n        return (int) (price * qty * 1.1);\n    }\n}\n',
    ctrl: 'public class OrderController {\n    private final OrderService service = new OrderService();\n\n    public int order(int price, int qty) {\n        return service.total(price, qty);\n    }\n}\n',
    stock: 'public class StockService {\n    public int remain(String sku) {\n        return 100;\n    }\n}\n',
    pay: 'public class PaymentService {\n    public boolean pay(int amount) {\n        return amount > 0;\n    }\n}\n',
    payFix: 'public class PaymentService {\n    public boolean pay(int amount) {\n        return amount > 0 && amount < 10000000;\n    }\n}\n',
  };
  GP.F = F;

  /* 기본 이력 8개 */
  const HIST = [
    ['프로젝트 초기 설정', { 'README.md': F.readme, 'config/application.yml': F.yml }],
    ['주문 서비스 추가', { 'src/OrderService.java': F.order }],
    ['주문 컨트롤러 추가', { 'src/OrderController.java': F.ctrl }],
    ['재고 조회 기능 추가', { 'src/StockService.java': F.stock }],
    ['결제 모듈 추가', { 'src/PaymentService.java': F.pay }],
    ['주문 총액에 부가세 반영', { 'src/OrderService.java': F.orderVat }],
    ['README 실행 방법 추가', { 'README.md': F.readme2 }],
    ['결제 금액 상한 검증 추가', { 'src/PaymentService.java': F.payFix }],
  ];
  GP.HIST = HIST;

  /* 저장소 생성 + n개 커밋 */
  GP.repoOps = function (n) {
    const ops = ['git init -q'];
    HIST.slice(0, n === undefined ? HIST.length : n).forEach(([m, f]) => ops.push(['commit', m, f]));
    return ops;
  };

  /* 원격 + 로컬 저장소 + 팀원 clone */
  GP.remoteOps = function (n, people) {
    const ops = [['remote', GP.REMOTE_URL]].concat(GP.repoOps(n));
    ops.push('git remote add origin ' + GP.REMOTE_URL);
    ops.push('git push -q -u origin main');
    (people || ['minji']).forEach((p) => ops.push(['clone', p, GP.REMOTE_URL]));
    return ops;
  };

  /* 시나리오 등록 */
  GP.add = function (s) {
    s.hints = s.hints || [];
    s.tags = s.tags || [];
    GP.scenarios.push(s);
    return s;
  };

  /* 자주 쓰는 목표 */
  GP.G = {
    clean: ['작업 디렉터리가 깨끗해야 해요 (커밋되지 않은 변경 없음)', (e) => e.clean()],
  };
})();
