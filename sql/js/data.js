(function (root) {
  'use strict';

  /* ============================================================
   * 시드 기반 난수 (도메인 샘플 데이터 생성용 - 브라우저/Node 공용)
   * ========================================================== */
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(rand, arr) { return arr[Math.floor(rand() * arr.length)]; }
  function int(rand, min, max) { return min + Math.floor(rand() * (max - min + 1)); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function esc(s) { return String(s).replace(/'/g, "''"); }
  function randomDate(rand, yearStart, monthStart, monthEnd) {
    const m = int(rand, monthStart, monthEnd);
    const d = int(rand, 1, 28);
    return `${yearStart}-${pad2(m)}-${pad2(d)}`;
  }

  /* ============================================================
   * 도메인 1: 이커머스 (customers / products / orders / order_items)
   * ========================================================== */
  function buildEcommerceSchema() {
    const rand = mulberry32(1001);
    const surnames = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임'];
    const givens = ['민준', '서연', '도윤', '하은', '시우', '수아', '주원', '지훈', '은서', '예준', '지안', '하준', '소율', '현우', '다은'];
    const cities = ['서울', '부산', '대구', '인천', '대전', '광주', '수원'];
    const grades = ['BRONZE', 'SILVER', 'GOLD', 'VIP'];
    const categories = ['의류', '전자기기', '도서', '식품', '생활용품'];
    const productNames = {
      의류: ['맨투맨', '청바지', '코트', '운동화', '니트'],
      전자기기: ['무선이어폰', '블루투스스피커', '보조배터리', '키보드', '모니터'],
      도서: ['소설 세트', '자기계발서', 'IT 전문서', '만화책', '에세이'],
      식품: ['원두커피', '그래놀라', '견과류세트', '라면박스', '수제청'],
      생활용품: ['디퓨저', '수건세트', '텀블러', '캔들', '정리함'],
    };
    const statuses = ['결제완료', '배송중', '배송완료', '취소'];

    let ddl = `
      CREATE TABLE customers (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        city TEXT NOT NULL,
        grade TEXT NOT NULL,
        signup_date TEXT NOT NULL
      );
      CREATE TABLE products (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price INTEGER NOT NULL
      );
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customers(id),
        order_date TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE order_items (
        id INTEGER PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id),
        product_id INTEGER NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL,
        unit_price INTEGER NOT NULL
      );
    `;

    const custRows = [];
    const CUST_N = 40;
    for (let i = 1; i <= CUST_N; i++) {
      const name = pick(rand, surnames) + pick(rand, givens);
      custRows.push(`(${i}, '${esc(name)}', 'user${i}@example.com', '${pick(rand, cities)}', '${pick(rand, grades)}', '${randomDate(rand, 2023, 1, 12)}')`);
    }
    ddl += `INSERT INTO customers (id,name,email,city,grade,signup_date) VALUES ${custRows.join(',')};\n`;

    const prodRows = [];
    let pid = 1;
    const prodIndex = [];
    categories.forEach((cat) => {
      productNames[cat].forEach((pname) => {
        const price = int(rand, 8, 120) * 1000;
        prodRows.push(`(${pid}, '${esc(pname)}', '${cat}', ${price})`);
        prodIndex.push(pid);
        pid++;
      });
    });
    ddl += `INSERT INTO products (id,name,category,price) VALUES ${prodRows.join(',')};\n`;

    const orderRows = [];
    const itemRows = [];
    let oid = 1, itemId = 1;
    const ORDER_N = 130;
    // 일부 고객(31~40)은 의도적으로 주문이 없도록 비워둠 ("주문 안 한 고객" 문제용)
    for (let i = 1; i <= ORDER_N; i++) {
      const custId = int(rand, 1, 30);
      const date = randomDate(rand, 2024, 1, 9);
      const status = pick(rand, statuses);
      orderRows.push(`(${oid}, ${custId}, '${date}', '${status}')`);
      const itemCount = int(rand, 1, 3);
      const usedProducts = new Set();
      for (let k = 0; k < itemCount; k++) {
        let prodChoice = pick(rand, prodIndex);
        if (usedProducts.has(prodChoice)) continue;
        usedProducts.add(prodChoice);
        const qty = int(rand, 1, 4);
        const prodPriceMatch = prodRows[prodChoice - 1];
        const priceGuess = Number(prodPriceMatch.slice(prodPriceMatch.lastIndexOf(',') + 1, prodPriceMatch.length - 1));
        itemRows.push(`(${itemId}, ${oid}, ${prodChoice}, ${qty}, ${priceGuess})`);
        itemId++;
      }
      oid++;
    }
    ddl += `INSERT INTO orders (id,customer_id,order_date,status) VALUES ${orderRows.join(',')};\n`;
    ddl += `INSERT INTO order_items (id,order_id,product_id,quantity,unit_price) VALUES ${itemRows.join(',')};\n`;

    return {
      label: '이커머스 (고객/상품/주문)',
      ddl,
      tables: [
        { name: 'customers', note: '고객', columns: [['id', 'INTEGER PK'], ['name', 'TEXT'], ['email', 'TEXT'], ['city', 'TEXT'], ['grade', "TEXT ('BRONZE'/'SILVER'/'GOLD'/'VIP')"], ['signup_date', "TEXT ('YYYY-MM-DD')"]] },
        { name: 'products', note: '상품', columns: [['id', 'INTEGER PK'], ['name', 'TEXT'], ['category', 'TEXT'], ['price', 'INTEGER']] },
        { name: 'orders', note: '주문', columns: [['id', 'INTEGER PK'], ['customer_id', 'INTEGER FK → customers.id'], ['order_date', "TEXT ('YYYY-MM-DD')"], ['status', "TEXT ('결제완료'/'배송중'/'배송완료'/'취소')"]] },
        { name: 'order_items', note: '주문상세(주문-상품 N:M)', columns: [['id', 'INTEGER PK'], ['order_id', 'INTEGER FK → orders.id'], ['product_id', 'INTEGER FK → products.id'], ['quantity', 'INTEGER'], ['unit_price', 'INTEGER']] },
      ],
      relations: ['orders.customer_id → customers.id', 'order_items.order_id → orders.id', 'order_items.product_id → products.id'],
    };
  }

  /* ============================================================
   * 도메인 2: 커뮤니티 (users / posts / comments)
   * ========================================================== */
  function buildCommunitySchema() {
    const rand = mulberry32(2002);
    const adjectives = ['조용한', '빠른', '행복한', '졸린', '용감한', '배고픈', '차분한', '엉뚱한'];
    const nouns = ['여우', '올빼미', '고양이', '펭귄', '라이언', '다람쥐', '수달', '코알라'];
    const categories = ['자유', '질문', '후기', '공지', '잡담'];
    const titleSamples = [
      '오늘 배포하다가 겪은 일', '신입 개발자 1년차 회고', '이 라이브러리 써보신 분?', '점심 메뉴 추천 받습니다',
      '사이드 프로젝트 같이 하실 분', '주니어가 겪는 흔한 실수', '재택근무 꿀팁 공유', '이직 고민 상담 부탁드려요',
      '좋은 책 추천해주세요', '버그 잡다가 밤샜습니다', '이번 주 스터디 공지', '연봉 협상 경험담',
    ];

    let ddl = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL,
        joined_at TEXT NOT NULL,
        is_banned INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        view_count INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE comments (
        id INTEGER PRIMARY KEY,
        post_id INTEGER NOT NULL REFERENCES posts(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        parent_comment_id INTEGER REFERENCES comments(id),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `;

    const USER_N = 30;
    const userRows = [];
    for (let i = 1; i <= USER_N; i++) {
      const name = `${pick(rand, adjectives)}${pick(rand, nouns)}${int(rand, 1, 99)}`;
      const banned = i > 27 ? 1 : 0; // 마지막 3명은 밴 처리 (LEFT JOIN/필터 문제용)
      userRows.push(`(${i}, '${esc(name)}', '${randomDate(rand, 2023, 1, 12)}', ${banned})`);
    }
    ddl += `INSERT INTO users (id,username,joined_at,is_banned) VALUES ${userRows.join(',')};\n`;

    const POST_N = 60;
    const postRows = [];
    for (let i = 1; i <= POST_N; i++) {
      const userId = int(rand, 1, USER_N - 5); // 일부 유저는 글 없이 댓글만 다는 경우도 자연히 발생
      const title = pick(rand, titleSamples) + ' ' + i;
      postRows.push(`(${i}, ${userId}, '${esc(title)}', '${pick(rand, categories)}', ${int(rand, 0, 5000)}, '${randomDate(rand, 2024, 1, 9)}')`);
    }
    ddl += `INSERT INTO posts (id,user_id,title,category,view_count,created_at) VALUES ${postRows.join(',')};\n`;

    const COMMENT_N = 150;
    const commentRows = [];
    const commentIdsByPost = {};
    for (let i = 1; i <= COMMENT_N; i++) {
      const postId = int(rand, 1, POST_N);
      const userId = int(rand, 1, USER_N);
      let parent = 'NULL';
      const existing = commentIdsByPost[postId];
      if (existing && existing.length > 0 && rand() < 0.3) {
        parent = String(pick(rand, existing));
      }
      commentRows.push(`(${i}, ${postId}, ${userId}, ${parent}, '댓글 내용 ${i}', '${randomDate(rand, 2024, 1, 9)}')`);
      (commentIdsByPost[postId] = commentIdsByPost[postId] || []).push(i);
    }
    ddl += `INSERT INTO comments (id,post_id,user_id,parent_comment_id,content,created_at) VALUES ${commentRows.join(',')};\n`;

    return {
      label: '커뮤니티 (유저/게시글/댓글)',
      ddl,
      tables: [
        { name: 'users', note: '회원', columns: [['id', 'INTEGER PK'], ['username', 'TEXT'], ['joined_at', 'TEXT'], ['is_banned', 'INTEGER (0/1)']] },
        { name: 'posts', note: '게시글', columns: [['id', 'INTEGER PK'], ['user_id', 'INTEGER FK → users.id'], ['title', 'TEXT'], ['category', 'TEXT'], ['view_count', 'INTEGER'], ['created_at', 'TEXT']] },
        { name: 'comments', note: '댓글(대댓글 포함)', columns: [['id', 'INTEGER PK'], ['post_id', 'INTEGER FK → posts.id'], ['user_id', 'INTEGER FK → users.id'], ['parent_comment_id', 'INTEGER NULL, FK → comments.id (대댓글)'], ['content', 'TEXT'], ['created_at', 'TEXT']] },
      ],
      relations: ['posts.user_id → users.id', 'comments.post_id → posts.id', 'comments.user_id → users.id', 'comments.parent_comment_id → comments.id (자기참조)'],
    };
  }

  /* ============================================================
   * 도메인 3: 인사/조직 (departments / employees)
   * ========================================================== */
  function buildHrSchema() {
    const rand = mulberry32(3003);
    const surnames = ['김', '이', '박', '최', '정', '강', '조', '윤'];
    const givens = ['지현', '성민', '유진', '재훈', '수빈', '동현', '예린', '승우', '나윤', '태양'];
    const depts = [
      { name: '개발팀', budget: 500000000 },
      { name: '디자인팀', budget: 200000000 },
      { name: '마케팅팀', budget: 300000000 },
      { name: '영업팀', budget: 350000000 },
      { name: '인사팀', budget: 150000000 },
      { name: '재무팀', budget: 180000000 },
    ];
    const positions = ['사원', '대리', '과장', '차장', '팀장'];

    let ddl = `
      CREATE TABLE departments (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        budget INTEGER NOT NULL
      );
      CREATE TABLE employees (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        department_id INTEGER NOT NULL REFERENCES departments(id),
        manager_id INTEGER REFERENCES employees(id),
        position TEXT NOT NULL,
        hire_date TEXT NOT NULL,
        salary INTEGER NOT NULL
      );
    `;

    const deptRows = depts.map((d, i) => `(${i + 1}, '${d.name}', ${d.budget})`);
    ddl += `INSERT INTO departments (id,name,budget) VALUES ${deptRows.join(',')};\n`;

    const empRows = [];
    let eid = 1;
    const teamLeadIdByDept = {};
    // 팀장(매니저 없음) 먼저 배치
    for (let d = 1; d <= depts.length; d++) {
      const name = pick(rand, surnames) + pick(rand, givens);
      const salary = int(rand, 70, 95) * 100000;
      empRows.push(`(${eid}, '${esc(name)}', ${d}, NULL, '팀장', '${randomDate(rand, 2018, 1, 12)}', ${salary})`);
      teamLeadIdByDept[d] = eid;
      eid++;
    }
    const EMP_N = 45;
    for (; eid <= EMP_N; eid++) {
      const d = int(rand, 1, depts.length);
      const name = pick(rand, surnames) + pick(rand, givens);
      const pos = pick(rand, positions.slice(0, 4));
      const salary = int(rand, 35, 68) * 100000;
      empRows.push(`(${eid}, '${esc(name)}', ${d}, ${teamLeadIdByDept[d]}, '${pos}', '${randomDate(rand, 2020, 1, 12)}', ${salary})`);
    }
    ddl += `INSERT INTO employees (id,name,department_id,manager_id,position,hire_date,salary) VALUES ${empRows.join(',')};\n`;

    return {
      label: '인사/조직 (부서/직원)',
      ddl,
      tables: [
        { name: 'departments', note: '부서', columns: [['id', 'INTEGER PK'], ['name', 'TEXT'], ['budget', 'INTEGER']] },
        { name: 'employees', note: '직원', columns: [['id', 'INTEGER PK'], ['name', 'TEXT'], ['department_id', 'INTEGER FK → departments.id'], ['manager_id', 'INTEGER NULL, FK → employees.id (자기참조)'], ['position', "TEXT ('사원'~'팀장')"], ['hire_date', 'TEXT'], ['salary', 'INTEGER (월급)']] },
      ],
      relations: ['employees.department_id → departments.id', 'employees.manager_id → employees.id (자기참조, 팀장은 NULL)'],
    };
  }

  /* ============================================================
   * 도메인 4: SaaS 구독/결제 (accounts / plans / subscriptions / invoices)
   * ========================================================== */
  function buildSaasSchema() {
    const rand = mulberry32(4004);
    const companyWords1 = ['테크', '클라우드', '데이터', '핀', '그린', '스마트', '넥스트', '바이오'];
    const companyWords2 = ['노바', '웨이브', '브릿지', '랩스', '로직스', '팩토리', '시스템즈', '파트너스'];
    const industries = ['IT', '핀테크', '헬스케어', '이커머스', '제조', '교육'];
    const plans = [
      { name: 'Basic', price: 29000 },
      { name: 'Pro', price: 79000 },
      { name: 'Enterprise', price: 199000 },
    ];

    let ddl = `
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY,
        company_name TEXT NOT NULL,
        industry TEXT NOT NULL,
        signup_date TEXT NOT NULL
      );
      CREATE TABLE plans (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        monthly_price INTEGER NOT NULL
      );
      CREATE TABLE subscriptions (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        plan_id INTEGER NOT NULL REFERENCES plans(id),
        start_date TEXT NOT NULL,
        end_date TEXT
      );
      CREATE TABLE invoices (
        id INTEGER PRIMARY KEY,
        subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
        billing_month TEXT NOT NULL,
        amount INTEGER NOT NULL,
        paid_at TEXT
      );
    `;

    const ACC_N = 25;
    const accRows = [];
    for (let i = 1; i <= ACC_N; i++) {
      const name = pick(rand, companyWords1) + pick(rand, companyWords2);
      accRows.push(`(${i}, '${esc(name)}', '${pick(rand, industries)}', '${randomDate(rand, 2023, 1, 10)}')`);
    }
    ddl += `INSERT INTO accounts (id,company_name,industry,signup_date) VALUES ${accRows.join(',')};\n`;
    ddl += `INSERT INTO plans (id,name,monthly_price) VALUES ${plans.map((p, i) => `(${i + 1}, '${p.name}', ${p.price})`).join(',')};\n`;

    const subRows = [];
    const subMeta = [];
    let sid = 1;
    for (let a = 1; a <= ACC_N; a++) {
      const planId = int(rand, 1, 3);
      const start = randomDate(rand, 2023, 1, 6);
      const ended = rand() < 0.25; // 25%는 이미 해지
      const end = ended ? `'${randomDate(rand, 2024, 1, 8)}'` : 'NULL';
      subRows.push(`(${sid}, ${a}, ${planId}, '${start}', ${end})`);
      subMeta.push({ id: sid, planId, ended });
      sid++;
    }
    ddl += `INSERT INTO subscriptions (id,account_id,plan_id,start_date,end_date) VALUES ${subRows.join(',')};\n`;

    const invRows = [];
    let iid = 1;
    subMeta.forEach((s) => {
      const monthCount = int(rand, 3, 9);
      for (let m = 1; m <= monthCount; m++) {
        const billingMonth = `2024-${pad2(m)}`;
        const price = plans[s.planId - 1].price;
        const unpaid = rand() < 0.12;
        const paidAt = unpaid ? 'NULL' : `'2024-${pad2(m)}-${pad2(int(rand, 1, 10))}'`;
        invRows.push(`(${iid}, ${s.id}, '${billingMonth}', ${price}, ${paidAt})`);
        iid++;
      }
    });
    ddl += `INSERT INTO invoices (id,subscription_id,billing_month,amount,paid_at) VALUES ${invRows.join(',')};\n`;

    return {
      label: 'SaaS 구독/결제 (계정/플랜/구독/청구서)',
      ddl,
      tables: [
        { name: 'accounts', note: '고객사(계정)', columns: [['id', 'INTEGER PK'], ['company_name', 'TEXT'], ['industry', 'TEXT'], ['signup_date', 'TEXT']] },
        { name: 'plans', note: '요금제', columns: [['id', 'INTEGER PK'], ['name', "TEXT ('Basic'/'Pro'/'Enterprise')"], ['monthly_price', 'INTEGER']] },
        { name: 'subscriptions', note: '구독', columns: [['id', 'INTEGER PK'], ['account_id', 'INTEGER FK → accounts.id'], ['plan_id', 'INTEGER FK → plans.id'], ['start_date', 'TEXT'], ['end_date', 'TEXT NULL (NULL=현재 활성 구독)']] },
        { name: 'invoices', note: '월별 청구서', columns: [['id', 'INTEGER PK'], ['subscription_id', 'INTEGER FK → subscriptions.id'], ['billing_month', "TEXT ('YYYY-MM')"], ['amount', 'INTEGER'], ['paid_at', 'TEXT NULL (NULL=미납)']] },
      ],
      relations: ['subscriptions.account_id → accounts.id', 'subscriptions.plan_id → plans.id', 'invoices.subscription_id → subscriptions.id'],
    };
  }

  /* ============================================================
   * 도메인 5: 회의실 예약 (rooms / reservations)
   * ========================================================== */
  function buildBookingSchema() {
    const rand = mulberry32(5005);
    const roomNames = ['한라', '백두', '지리', '설악', '소백', '태백', '덕유', '오대'];
    const purposes = ['주간회의', '면접', '스프린트 리뷰', '고객미팅', '워크샵', '1:1 미팅'];
    const names = ['김하늘', '이도현', '박서아', '최준서', '정유나', '강민호', '조은비', '윤태호'];

    let ddl = `
      CREATE TABLE rooms (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        capacity INTEGER NOT NULL,
        location TEXT NOT NULL
      );
      CREATE TABLE reservations (
        id INTEGER PRIMARY KEY,
        room_id INTEGER NOT NULL REFERENCES rooms(id),
        user_name TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        purpose TEXT
      );
    `;

    const roomRows = roomNames.map((n, i) => `(${i + 1}, '${n}회의실', ${pick(rand, [4, 6, 8, 10, 12])}, '${pick(rand, ['본관 3층', '본관 5층', '별관 2층'])}')`);
    ddl += `INSERT INTO rooms (id,name,capacity,location) VALUES ${roomRows.join(',')};\n`;

    const resRows = [];
    let rid = 1;
    for (let d = 1; d <= 15; d++) {
      const date = `2024-06-${pad2(d)}`;
      const slots = int(rand, 2, 5);
      for (let s = 0; s < slots; s++) {
        const roomId = int(rand, 1, roomNames.length - 1); // 마지막 회의실은 의도적으로 한 번도 예약되지 않도록 비워둠
        const startHour = int(rand, 9, 17);
        const duration = pick(rand, [1, 1, 2]);
        const startTime = `${date} ${pad2(startHour)}:00`;
        const endTime = `${date} ${pad2(startHour + duration)}:00`;
        resRows.push(`(${rid}, ${roomId}, '${pick(rand, names)}', '${startTime}', '${endTime}', '${pick(rand, purposes)}')`);
        rid++;
      }
    }
    ddl += `INSERT INTO reservations (id,room_id,user_name,start_time,end_time,purpose) VALUES ${resRows.join(',')};\n`;

    return {
      label: '회의실 예약 (회의실/예약내역)',
      ddl,
      tables: [
        { name: 'rooms', note: '회의실', columns: [['id', 'INTEGER PK'], ['name', 'TEXT'], ['capacity', 'INTEGER'], ['location', 'TEXT']] },
        { name: 'reservations', note: '예약내역', columns: [['id', 'INTEGER PK'], ['room_id', 'INTEGER FK → rooms.id'], ['user_name', 'TEXT'], ['start_time', "TEXT ('YYYY-MM-DD HH:MM')"], ['end_time', 'TEXT'], ['purpose', 'TEXT']] },
      ],
      relations: ['reservations.room_id → rooms.id'],
    };
  }

  /* ============================================================
   * 도메인 6: 성능 튜닝 전용 (customers / products / orders - 대용량)
   * ========================================================== */
  function buildPerfShopSchema() {
    const rand = mulberry32(6006);
    const surnames = ['김', '이', '박', '최', '정'];
    const givens = ['민수', '지영', '현우', '소망', '재윤'];
    const grades = ['BRONZE', 'SILVER', 'GOLD', 'VIP'];
    const categories = ['의류', '전자기기', '도서', '식품'];
    const statuses = ['결제완료', '배송중', '배송완료', '취소'];

    let ddl = `
      CREATE TABLE customers (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        grade TEXT NOT NULL
      );
      CREATE TABLE products (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price INTEGER NOT NULL
      );
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY,
        customer_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        order_date TEXT NOT NULL,
        status TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        amount INTEGER NOT NULL
      );
    `;

    const CUST_N = 200;
    const custRows = [];
    for (let i = 1; i <= CUST_N; i++) {
      custRows.push(`(${i}, '${pick(rand, surnames)}${pick(rand, givens)}${i}', '${pick(rand, grades)}')`);
    }
    ddl += `INSERT INTO customers (id,name,grade) VALUES ${custRows.join(',')};\n`;

    const PROD_N = 30;
    const prodRows = [];
    for (let i = 1; i <= PROD_N; i++) {
      prodRows.push(`(${i}, '상품${i}', '${pick(rand, categories)}', ${int(rand, 5, 100) * 1000})`);
    }
    ddl += `INSERT INTO products (id,name,category,price) VALUES ${prodRows.join(',')};\n`;

    const ORDER_N = 3000;
    const orderRows = [];
    for (let i = 1; i <= ORDER_N; i++) {
      const custId = int(rand, 1, CUST_N);
      const prodId = int(rand, 1, PROD_N);
      const date = randomDate(rand, 2024, 1, 9);
      const status = pick(rand, statuses);
      const qty = int(rand, 1, 5);
      const amount = qty * int(rand, 5, 80) * 1000;
      orderRows.push(`(${i},${custId},${prodId},'${date}','${status}',${qty},${amount})`);
    }
    ddl += `INSERT INTO orders (id,customer_id,product_id,order_date,status,quantity,amount) VALUES ${orderRows.slice(0, 500).join(',')};\n`;
    for (let i = 500; i < orderRows.length; i += 500) {
      ddl += `INSERT INTO orders (id,customer_id,product_id,order_date,status,quantity,amount) VALUES ${orderRows.slice(i, i + 500).join(',')};\n`;
    }

    return {
      label: '성능 튜닝 전용 샘플 (주문 3,000건)',
      ddl,
      tables: [
        { name: 'customers', note: '고객 (200명)', columns: [['id', 'INTEGER PK'], ['name', 'TEXT'], ['grade', 'TEXT']] },
        { name: 'products', note: '상품 (30종)', columns: [['id', 'INTEGER PK'], ['name', 'TEXT'], ['category', 'TEXT'], ['price', 'INTEGER']] },
        { name: 'orders', note: '주문 (3,000건, 인덱스 없음)', columns: [['id', 'INTEGER PK'], ['customer_id', 'INTEGER (인덱스 없음)'], ['product_id', 'INTEGER'], ['order_date', 'TEXT'], ['status', 'TEXT'], ['quantity', 'INTEGER'], ['amount', 'INTEGER']] },
      ],
      relations: ['orders.customer_id → customers.id', 'orders.product_id → products.id', '(실무 DB는 보통 수백만 건이지만, 연습용으로 3,000건으로 축소했습니다. 인덱스 유무에 따른 실행계획 차이는 건수와 무관하게 동일한 원리로 나타납니다.)'],
    };
  }

  const SCHEMAS = {
    ecommerce: buildEcommerceSchema(),
    community: buildCommunitySchema(),
    hr_payroll: buildHrSchema(),
    saas_billing: buildSaasSchema(),
    booking: buildBookingSchema(),
    perf_shop: buildPerfShopSchema(),
  };

  const CATEGORIES = [
    { id: 'basics', label: '기본 조회', icon: '🔍' },
    { id: 'join', label: 'JOIN', icon: '🔗' },
    { id: 'aggregate', label: 'GROUP BY / 집계', icon: '📊' },
    { id: 'subquery', label: '서브쿼리', icon: '🧩' },
    { id: 'window', label: '윈도우 함수', icon: '🪟' },
    { id: 'transform', label: '실무형 가공 (CASE/날짜/문자열)', icon: '🛠️' },
    { id: 'perf', label: '인덱스 & 성능 튜닝', icon: '⚡' },
  ];

  const DIFFICULTY_META = {
    easy: { label: '초급', stars: '★☆☆' },
    medium: { label: '중급', stars: '★★☆' },
    hard: { label: '고급', stars: '★★★' },
  };

  const PROBLEMS = [];
  /* ============================================================
   * 1. 기본 조회
   * ========================================================== */
  PROBLEMS.push(
    {
      id: 'basics-vip', category: 'basics', difficulty: 'easy', schemaId: 'ecommerce', type: 'query',
      title: 'VIP 등급 고객 조회',
      scenario: 'PM: "이번에 VIP 등급 고객한테 감사 쿠폰 보낼 건데, 이름이랑 이메일 리스트 좀 뽑아주세요. 가입일 오래된 순으로요."',
      hints: ['WHERE grade = \'VIP\'', 'ORDER BY signup_date 로 오래된 순(오름차순) 정렬하세요.'],
      concept: 'WHERE로 조건에 맞는 행만 걸러내고 ORDER BY로 정렬하는 건 실무에서 가장 많이 쓰는 조회 패턴입니다. 등급/상태 같은 분류 컬럼으로 필터링하는 건 운영팀 요청의 8할을 차지해요.',
      pattern: 'WHERE + ORDER BY',
      solutionSql: "SELECT name, email FROM customers WHERE grade = 'VIP' ORDER BY signup_date ASC",
      orderMatters: true,
      starterSql: '-- customers 테이블에서 VIP 등급 고객의 name, email을 가입일 오름차순으로 조회하세요\nSELECT\n',
    },
    {
      id: 'basics-recent-users', category: 'basics', difficulty: 'easy', schemaId: 'community', type: 'query',
      title: '최근 가입한 회원 10명',
      scenario: '운영자: "최근에 누가 새로 가입했는지 확인하고 싶어요. 가장 최근 가입자부터 10명만 보여주세요."',
      hints: ['ORDER BY joined_at DESC', 'LIMIT 10'],
      concept: 'LIMIT은 "일단 몇 개만 빨리 보고 싶다"는 요청에 대응하는 가장 쉬운 방법입니다. 대시보드나 관리자 페이지의 "최근 N개" 위젯은 거의 다 이 패턴이에요.',
      pattern: 'ORDER BY + LIMIT',
      solutionSql: 'SELECT id, username, joined_at FROM users ORDER BY joined_at DESC LIMIT 10',
      orderMatters: true,
      starterSql: '-- users 테이블에서 최근 가입한 10명을 조회하세요\nSELECT\n',
    },
    {
      id: 'basics-unpaid-invoices', category: 'basics', difficulty: 'easy', schemaId: 'saas_billing', type: 'query',
      title: '미납 청구서 찾기',
      scenario: '재무팀: "이번 달 미납 청구서 목록이 필요해요. billing_month가 2024-05인 것 중에 아직 결제 안 된 것만요."',
      hints: ["WHERE billing_month = '2024-05'", 'paid_at이 NULL인 행을 찾으려면 paid_at IS NULL 을 씁니다. (= NULL 은 동작하지 않아요!)'],
      concept: 'SQL에서 NULL은 "값이 없음"을 뜻해서 = 로 비교할 수 없습니다. 반드시 IS NULL / IS NOT NULL 을 써야 해요. 이건 신입/중급 개발자가 가장 자주 놓치는 함정 중 하나입니다.',
      pattern: 'IS NULL',
      solutionSql: "SELECT id, subscription_id, amount FROM invoices WHERE billing_month = '2024-05' AND paid_at IS NULL",
      orderMatters: false,
      starterSql: "-- 2024-05 청구서 중 미납(paid_at이 NULL)인 건을 조회하세요\nSELECT\n",
    },
    {
      id: 'basics-low-stock', category: 'basics', difficulty: 'easy', schemaId: 'perf_shop', type: 'query',
      title: '특정 카테고리 고가 상품',
      scenario: 'MD: "전자기기 카테고리 중에서 5만원 넘는 상품만 가격 높은 순으로 보여주세요."',
      hints: ["WHERE category = '전자기기' AND price > 50000", 'ORDER BY price DESC'],
      concept: '여러 조건을 AND로 묶어 필터링하는 패턴입니다. 조건이 늘어날수록 인덱스 설계(어떤 컬럼에 인덱스를 걸지)가 중요해지는데, 이건 7번 카테고리에서 다룹니다.',
      pattern: 'WHERE AND + ORDER BY',
      solutionSql: "SELECT name, category, price FROM products WHERE category = '전자기기' AND price > 50000 ORDER BY price DESC",
      orderMatters: true,
      starterSql: '-- products 테이블에서 전자기기 중 5만원 초과 상품을 가격 높은 순으로 조회하세요\nSELECT\n',
    },
    {
      id: 'basics-room-schedule', category: 'basics', difficulty: 'easy', schemaId: 'booking', type: 'query',
      title: '특정 회의실 예약 내역',
      scenario: '총무팀: "한라회의실(room_id=1) 예약 내역을 시간순으로 전부 보여주세요."',
      hints: ['WHERE room_id = 1', 'ORDER BY start_time'],
      concept: '단일 테이블 필터링도, 나중에 JOIN을 배우고 나면 "room_id 대신 회의실 이름으로 바로 필터링"하는 식으로 자연스럽게 확장됩니다.',
      pattern: 'WHERE + ORDER BY',
      solutionSql: 'SELECT user_name, start_time, end_time, purpose FROM reservations WHERE room_id = 1 ORDER BY start_time',
      orderMatters: true,
      starterSql: '-- room_id가 1인 예약 내역을 시간순으로 조회하세요\nSELECT\n',
    }
  );

  /* ============================================================
   * 2. JOIN
   * ========================================================== */
  PROBLEMS.push(
    {
      id: 'join-order-customer', category: 'join', difficulty: 'easy', schemaId: 'ecommerce', type: 'query',
      title: '주문에 고객 이름 붙이기',
      scenario: 'CS팀: "주문 목록에 고객 이름이 안 보여서 매번 customer_id로 다시 찾아봐야 해요. 주문번호, 고객이름, 주문일, 상태를 한 번에 보여주세요."',
      hints: ['orders와 customers를 customer_id = id 조건으로 INNER JOIN 하세요.'],
      concept: '정규화된 테이블은 ID로만 연결돼 있어서, 사람이 읽을 수 있는 정보(이름 등)를 붙이려면 JOIN이 필수입니다. 실무 쿼리의 절반 이상이 이 패턴이에요.',
      pattern: 'INNER JOIN',
      solutionSql: 'SELECT o.id AS order_id, c.name AS customer_name, o.order_date, o.status FROM orders o JOIN customers c ON o.customer_id = c.id',
      orderMatters: false,
      starterSql: '-- orders와 customers를 조인해서 주문id, 고객이름, 주문일, 상태를 조회하세요\nSELECT\n',
    },
    {
      id: 'join-category-revenue', category: 'join', difficulty: 'medium', schemaId: 'ecommerce', type: 'query',
      title: '카테고리별 판매 매출',
      scenario: '마케팅팀: "카테고리별로 지금까지 얼마나 팔렸는지 매출(수량×단가 합) 좀 뽑아주세요."',
      hints: ['products와 order_items를 product_id로 JOIN 하세요.', 'SUM(quantity * unit_price)로 매출을 계산하고 category로 GROUP BY 하세요.'],
      concept: '3개 이상 테이블을 넘나드는 매출 집계는 "주문상세(order_items)에서 금액을 계산하고, 상품(products)에서 카테고리를 가져온다"는 식으로 JOIN과 GROUP BY를 함께 씁니다.',
      pattern: 'JOIN + GROUP BY',
      solutionSql: 'SELECT p.category, SUM(oi.quantity * oi.unit_price) AS revenue FROM order_items oi JOIN products p ON oi.product_id = p.id GROUP BY p.category ORDER BY revenue DESC',
      orderMatters: true,
      starterSql: '-- order_items와 products를 조인해서 카테고리별 매출(SUM(quantity*unit_price))을 매출 높은 순으로 조회하세요\nSELECT\n',
    },
    {
      id: 'join-posts-author-left', category: 'join', difficulty: 'medium', schemaId: 'community', type: 'query',
      title: '게시글 + 작성자 (탈퇴자 포함)',
      scenario: '운영자: "게시글 목록에 작성자 닉네임을 붙여서 보여주세요. 밴 당한 유저가 쓴 글도 빠지면 안 돼요 — 누락 없이 전부 보여야 해요."',
      hints: ['INNER JOIN 대신 LEFT JOIN을 쓰면 posts 쪽 행이 하나도 빠지지 않습니다.', 'posts LEFT JOIN users ON posts.user_id = users.id'],
      concept: 'INNER JOIN은 양쪽에 다 있는 행만 남기지만, LEFT JOIN은 왼쪽(기준) 테이블의 행을 모두 보존합니다. "연결된 데이터가 없어도 원본은 빠지면 안 되는" 요구사항엔 항상 LEFT JOIN을 써야 해요.',
      pattern: 'LEFT JOIN',
      solutionSql: 'SELECT p.id, p.title, u.username FROM posts p LEFT JOIN users u ON p.user_id = u.id',
      orderMatters: false,
      starterSql: '-- posts를 기준으로 users를 LEFT JOIN해서 게시글id, 제목, 작성자명을 조회하세요\nSELECT\n',
    },
    {
      id: 'join-manager-selfjoin', category: 'join', difficulty: 'hard', schemaId: 'hr_payroll', type: 'query',
      title: '직원과 매니저 이름 함께 보기',
      scenario: '인사팀: "조직도 자료용으로, 직원 이름이랑 그 직원의 매니저 이름을 나란히 보여주는 표가 필요해요. 매니저가 없는 팀장급은 매니저 칸이 비어있어도 돼요."',
      hints: ['employees 테이블을 자기 자신과 조인합니다 (self join).', 'employees e LEFT JOIN employees m ON e.manager_id = m.id', '팀장은 manager_id가 NULL이라 LEFT JOIN이 필요해요.'],
      concept: '같은 테이블을 서로 다른 별칭(alias)으로 두 번 조인하는 걸 self join이라고 합니다. 조직도, 카테고리 트리, 댓글-대댓글처럼 "같은 종류의 데이터가 서로를 참조"할 때 쓰는 대표 패턴이에요.',
      pattern: 'Self JOIN (LEFT)',
      solutionSql: 'SELECT e.name AS employee, m.name AS manager FROM employees e LEFT JOIN employees m ON e.manager_id = m.id',
      orderMatters: false,
      starterSql: '-- employees를 자기 자신과 LEFT JOIN해서 직원명, 매니저명을 조회하세요 (매니저 없으면 NULL)\nSELECT\n',
    },
    {
      id: 'join-anti-no-reservation', category: 'join', difficulty: 'hard', schemaId: 'booking', type: 'query',
      title: '6월에 한 번도 예약 안 된 회의실',
      scenario: '총무팀: "회의실 활용도 보고서를 써야 하는데, 6월 한 달 동안 아예 예약이 없었던 회의실이 있는지 확인해주세요."',
      hints: ['rooms를 기준으로 reservations를 LEFT JOIN 하세요.', '조인 후 reservations 쪽 컬럼(예: r.id)이 NULL인 행만 WHERE로 걸러내면, "매칭되는 예약이 없는" 회의실만 남습니다.'],
      concept: '이 패턴을 안티 조인(anti-join)이라고 부릅니다. "A에는 있는데 B에는 연결된 게 없는 것"을 찾을 때 LEFT JOIN + WHERE 우측컬럼 IS NULL 조합을 씁니다. NOT EXISTS로도 같은 결과를 낼 수 있어요(서브쿼리 카테고리에서 다룹니다).',
      pattern: 'LEFT JOIN 안티조인',
      solutionSql: 'SELECT rm.id, rm.name FROM rooms rm LEFT JOIN reservations rv ON rm.id = rv.room_id WHERE rv.id IS NULL',
      orderMatters: false,
      starterSql: '-- rooms를 기준으로 reservations가 하나도 없는 회의실을 LEFT JOIN + IS NULL로 찾으세요\nSELECT\n',
    }
  );

  /* ============================================================
   * 3. GROUP BY / 집계
   * ========================================================== */
  PROBLEMS.push(
    {
      id: 'agg-customer-order-count', category: 'aggregate', difficulty: 'medium', schemaId: 'ecommerce', type: 'query',
      title: '주문 5건 이상인 단골 고객',
      scenario: 'CRM팀: "단골 고객 등급 산정 때문에, 주문을 5건 이상 한 고객의 id와 주문 건수를 뽑아주세요."',
      hints: ['customer_id로 GROUP BY 하고 COUNT(*)로 건수를 셉니다.', 'GROUP BY 결과에 조건을 걸 땐 WHERE가 아니라 HAVING을 씁니다.'],
      concept: 'WHERE는 그룹으로 묶기 "전" 각 행을 거르고, HAVING은 그룹으로 묶은 "후" 집계 결과를 거릅니다. "COUNT(*) >= 5" 같은 조건은 집계 결과이므로 반드시 HAVING에 써야 해요.',
      pattern: 'GROUP BY + HAVING',
      solutionSql: 'SELECT customer_id, COUNT(*) AS order_count FROM orders GROUP BY customer_id HAVING COUNT(*) >= 5 ORDER BY order_count DESC',
      orderMatters: true,
      starterSql: '-- customer_id별 주문건수를 구하고, 5건 이상인 고객만 주문건수 내림차순으로 조회하세요\nSELECT\n',
    },
    {
      id: 'agg-category-avg-price', category: 'aggregate', difficulty: 'easy', schemaId: 'ecommerce', type: 'query',
      title: '카테고리별 평균 가격',
      scenario: 'MD: "카테고리별로 평균 상품 가격이 얼마나 되는지 궁금해요. 비싼 카테고리 순으로 보여주세요."',
      hints: ['category로 GROUP BY 하고 AVG(price)를 사용하세요.'],
      concept: 'AVG, SUM, COUNT, MAX, MIN은 가장 기본적인 집계함수입니다. GROUP BY 없이 쓰면 "전체"에 대한 하나의 값, GROUP BY와 함께 쓰면 "그룹별" 값이 나옵니다.',
      pattern: 'GROUP BY + AVG',
      solutionSql: 'SELECT category, AVG(price) AS avg_price FROM products GROUP BY category ORDER BY avg_price DESC',
      orderMatters: true,
      starterSql: '-- products를 카테고리별로 묶어 평균가격을 비싼 순으로 조회하세요\nSELECT\n',
    },
    {
      id: 'agg-top-commented-posts', category: 'aggregate', difficulty: 'medium', schemaId: 'community', type: 'query',
      title: '댓글 많은 게시글 TOP 5',
      scenario: '운영자: "요즘 핫한 글이 뭔지 보려고요. 댓글 많은 순으로 게시글 제목이랑 댓글 수 TOP 5 뽑아주세요. 댓글 수가 같으면 게시글 id가 작은 순으로 해주세요."',
      hints: ['posts와 comments를 JOIN한 뒤 post_id(또는 posts.id)로 GROUP BY 하세요.', 'COUNT(comments.id)로 댓글 수를 세고, ORDER BY 댓글수 DESC, 게시글 id ASC 로 정렬한 뒤 LIMIT 5.', '댓글 수가 같은 글이 여러 개일 때는 보조 정렬 기준이 없으면 결과가 매번 달라질 수 있어서, 실무에서도 ORDER BY 뒤에 id 같은 보조 기준을 꼭 붙입니다.'],
      concept: 'JOIN과 GROUP BY를 함께 쓸 때는 "무엇을 기준으로 묶을지"를 먼저 정하고, SELECT절의 집계되지 않은 컬럼은 전부 GROUP BY에 포함돼야 합니다 (SQLite는 관대하지만 MySQL strict mode/PostgreSQL은 에러를 냅니다).',
      pattern: 'JOIN + GROUP BY + LIMIT',
      solutionSql: 'SELECT p.title, COUNT(c.id) AS comment_count FROM posts p JOIN comments c ON c.post_id = p.id GROUP BY p.id, p.title ORDER BY comment_count DESC, p.id ASC LIMIT 5',
      orderMatters: true,
      starterSql: '-- posts와 comments를 조인해서 게시글 제목, 댓글 수를 조회하세요 (댓글 많은 순, 같으면 id 작은 순, 상위 5개)\nSELECT\n',
    },
    {
      id: 'agg-dept-avg-salary', category: 'aggregate', difficulty: 'medium', schemaId: 'hr_payroll', type: 'query',
      title: '부서별 평균 급여, 예산과 함께',
      scenario: '재무팀: "부서별 평균 급여를 부서 예산이랑 같이 보고 싶어요. 부서명, 평균급여, 예산 순서로요."',
      hints: ['employees를 department_id로 GROUP BY 하고, departments와 JOIN해서 이름/예산을 가져오세요.'],
      concept: '집계(GROUP BY)와 JOIN을 같이 쓸 때, GROUP BY는 보통 "숫자를 집계할 테이블" 기준으로 걸고 JOIN은 "이름표를 붙일 테이블"을 연결하는 용도로 생각하면 헷갈리지 않습니다.',
      pattern: 'JOIN + GROUP BY',
      solutionSql: 'SELECT d.name AS department, AVG(e.salary) AS avg_salary, d.budget FROM employees e JOIN departments d ON e.department_id = d.id GROUP BY d.id, d.name, d.budget ORDER BY avg_salary DESC',
      orderMatters: true,
      starterSql: '-- employees와 departments를 조인해서 부서별 평균급여와 예산을 평균급여 높은 순으로 조회하세요\nSELECT\n',
    },
    {
      id: 'agg-monthly-revenue', category: 'aggregate', difficulty: 'medium', schemaId: 'saas_billing', type: 'query',
      title: '월별 결제 완료 매출',
      scenario: 'CFO: "월별로 실제로 결제된(미납 제외) 매출 합계를 월 순서대로 보여주세요."',
      hints: ['WHERE paid_at IS NOT NULL 로 미납 건을 제외하세요.', 'billing_month로 GROUP BY 하고 SUM(amount).'],
      concept: '집계 전에 WHERE로 "제외할 행"을 먼저 걸러내는 것도 매우 흔한 패턴입니다. "실제로 돈이 들어온 것만" 같은 비즈니스 조건은 집계 이전에 WHERE로 처리하세요.',
      pattern: 'WHERE + GROUP BY + SUM',
      solutionSql: "SELECT billing_month, SUM(amount) AS revenue FROM invoices WHERE paid_at IS NOT NULL GROUP BY billing_month ORDER BY billing_month",
      orderMatters: true,
      starterSql: '-- 결제완료(paid_at NOT NULL)된 청구서만 월별로 합산해서 월 순서대로 조회하세요\nSELECT\n',
    },
    {
      id: 'agg-room-usage-hours', category: 'aggregate', difficulty: 'hard', schemaId: 'booking', type: 'query',
      title: '회의실별 총 예약 시간',
      scenario: '총무팀: "회의실별로 6월 한 달 동안 총 몇 시간 예약됐는지 집계해주세요. 많이 쓴 순서로요."',
      hints: ["시간 차이는 날짜함수로 계산합니다: (julianday(end_time) - julianday(start_time)) * 24 가 시간(hour) 차이예요.", 'rooms와 reservations를 JOIN하고 room 기준으로 GROUP BY, SUM으로 합산하세요.'],
      concept: 'SQLite는 날짜/시간을 텍스트로 저장하지만 julianday() 함수로 날짜 간 차이를 숫자(일 단위)로 계산할 수 있습니다. MySQL이라면 TIMESTAMPDIFF(HOUR, start, end), PostgreSQL이라면 EXTRACT(EPOCH FROM (end-start))/3600 처럼 DB마다 문법이 다르다는 것도 알아두세요.',
      pattern: '날짜 연산 + GROUP BY',
      solutionSql: "SELECT rm.name, SUM((julianday(rv.end_time) - julianday(rv.start_time)) * 24) AS total_hours FROM reservations rv JOIN rooms rm ON rv.room_id = rm.id GROUP BY rm.id, rm.name ORDER BY total_hours DESC",
      orderMatters: true,
      starterSql: '-- 회의실별 총 예약시간을 julianday() 함수로 계산해서 많이 쓴 순으로 조회하세요\nSELECT\n',
    }
  );

  /* ============================================================
   * 4. 서브쿼리
   * ========================================================== */
  PROBLEMS.push(
    {
      id: 'sub-above-avg-price', category: 'subquery', difficulty: 'medium', schemaId: 'ecommerce', type: 'query',
      title: '평균보다 비싼 상품',
      scenario: 'MD: "전체 평균 가격보다 비싼 상품만 추려주세요."',
      hints: ['먼저 (SELECT AVG(price) FROM products)로 평균을 구하고, 그 값을 WHERE price > (...) 처럼 스칼라 서브쿼리로 넣으세요.'],
      concept: '서브쿼리가 딱 하나의 값(스칼라)을 반환할 때는 =, >, < 같은 비교 연산자와 바로 함께 쓸 수 있습니다. "평균보다 큰", "최댓값과 같은" 같은 비교에 자주 등장해요.',
      pattern: '스칼라 서브쿼리',
      solutionSql: 'SELECT name, price FROM products WHERE price > (SELECT AVG(price) FROM products) ORDER BY price DESC',
      orderMatters: true,
      starterSql: '-- 전체 평균가격보다 비싼 상품을 가격 높은 순으로 조회하세요\nSELECT\n',
    },
    {
      id: 'sub-customers-no-order', category: 'subquery', difficulty: 'medium', schemaId: 'ecommerce', type: 'query',
      title: '한 번도 주문 안 한 고객',
      scenario: 'CRM팀: "휴면 고객 타겟팅을 위해, 가입했지만 한 번도 주문한 적 없는 고객 목록이 필요해요."',
      hints: ['customer_id NOT IN (SELECT customer_id FROM orders) 를 사용하세요.', 'orders.customer_id에 NULL이 있으면 NOT IN이 이상하게 동작하니 주의하세요 (이 테이블엔 NULL이 없어서 괜찮습니다).'],
      concept: 'NOT IN은 간단하지만 서브쿼리 결과에 NULL이 하나라도 섞이면 전체 결과가 예상과 다르게 비어버리는 유명한 함정이 있습니다. 실무에서는 더 안전한 NOT EXISTS를 선호하는 경우가 많아요 (다음 문제에서 비교해봅니다).',
      pattern: 'NOT IN 서브쿼리',
      solutionSql: 'SELECT id, name FROM customers WHERE id NOT IN (SELECT customer_id FROM orders)',
      orderMatters: false,
      starterSql: '-- orders에 한 번도 등장하지 않은 customer_id를 가진 고객을 조회하세요 (NOT IN)\nSELECT\n',
    },
    {
      id: 'sub-not-exists-vs-notin', category: 'subquery', difficulty: 'hard', schemaId: 'ecommerce', type: 'query',
      title: 'NOT EXISTS로 다시 작성하기',
      scenario: '시니어 개발자: "방금 짠 NOT IN 쿼리, NULL 들어오면 위험하다고 했죠? NOT EXISTS로 같은 결과가 나오게 바꿔보세요."',
      hints: ['NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id) 형태의 상관 서브쿼리를 사용하세요.'],
      concept: 'NOT EXISTS는 "행이 하나라도 있는지"만 확인하기 때문에 NULL 문제에서 자유롭고, 대부분의 DB 옵티마이저가 NOT IN보다 더 효율적으로 처리합니다. 실무에서는 "없는 것 찾기"엔 NOT EXISTS를 기본으로 쓰는 걸 추천해요.',
      pattern: 'NOT EXISTS (상관 서브쿼리)',
      solutionSql: 'SELECT id, name FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)',
      orderMatters: false,
      requirePatterns: [/NOT\s+EXISTS/i],
      starterSql: '-- NOT EXISTS 상관 서브쿼리로 주문 이력이 없는 고객을 조회하세요\nSELECT\n',
    },
    {
      id: 'sub-salary-above-dept-avg', category: 'subquery', difficulty: 'hard', schemaId: 'hr_payroll', type: 'query',
      title: '부서 평균보다 급여 높은 직원',
      scenario: '인사팀: "각자 소속 부서 평균 급여보다 더 받는 직원들이 누군지 알고 싶어요."',
      hints: ['상관 서브쿼리: 바깥 쿼리의 e.department_id를 안쪽 서브쿼리에서 참조합니다.', 'WHERE e.salary > (SELECT AVG(salary) FROM employees e2 WHERE e2.department_id = e.department_id)'],
      concept: '상관 서브쿼리(correlated subquery)는 바깥쪽 행마다 안쪽 쿼리가 다시 실행되는 구조라, "각자의 기준"이 필요한 비교(부서 평균, 본인 카테고리 평균 등)에 적합합니다. 다만 데이터가 많아지면 느려질 수 있어서 7번 카테고리에서 JOIN으로 리팩터링하는 법을 다룹니다.',
      pattern: '상관 서브쿼리',
      solutionSql: 'SELECT e.name, e.department_id, e.salary FROM employees e WHERE e.salary > (SELECT AVG(e2.salary) FROM employees e2 WHERE e2.department_id = e.department_id)',
      orderMatters: false,
      starterSql: '-- 각 직원의 급여가 소속 부서 평균급여보다 높은 직원을 상관 서브쿼리로 조회하세요\nSELECT\n',
    },
    {
      id: 'sub-available-rooms', category: 'subquery', difficulty: 'hard', schemaId: 'booking', type: 'query',
      title: '특정 시간에 예약 가능한 회의실',
      scenario: '직원: "2024-06-10 10:00~11:00에 비어있는 회의실이 어디 있는지 찾아주세요."',
      hints: ['NOT EXISTS로, 그 시간대에 겹치는 예약이 없는 회의실만 찾습니다.', '시간이 겹치는 조건: r.start_time < \'2024-06-10 11:00\' AND r.end_time > \'2024-06-10 10:00\''],
      concept: '"겹치는 시간대"를 찾는 조건은 단순히 start/end가 정확히 일치하는 게 아니라 "A의 시작이 B의 끝보다 이르고, A의 끝이 B의 시작보다 늦다"는 구간 겹침 공식을 씁니다. 예약 시스템, 캘린더 기능에서 거의 항상 등장하는 패턴이에요.',
      pattern: 'NOT EXISTS + 구간 겹침',
      solutionSql: "SELECT id, name FROM rooms rm WHERE NOT EXISTS (SELECT 1 FROM reservations r WHERE r.room_id = rm.id AND r.start_time < '2024-06-10 11:00' AND r.end_time > '2024-06-10 10:00')",
      orderMatters: false,
      starterSql: '-- 2024-06-10 10:00~11:00에 예약이 겹치지 않는 회의실을 NOT EXISTS로 조회하세요\nSELECT\n',
    }
  );

  /* ============================================================
   * 5. 윈도우 함수
   * ========================================================== */
  PROBLEMS.push(
    {
      id: 'win-row-number-per-customer', category: 'window', difficulty: 'medium', schemaId: 'ecommerce', type: 'query',
      title: '고객별 주문에 순번 매기기',
      scenario: '개발팀: "고객별로 주문 순서(1번째 주문, 2번째 주문...)를 매긴 컬럼이 필요해요. 주문일 기준으로요."',
      hints: ['ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date) 를 사용하세요.'],
      concept: 'PARTITION BY는 GROUP BY와 비슷하게 "그룹을 나누지만", 그룹별로 한 줄로 합쳐버리지 않고 원래 행을 그대로 유지한 채 그룹 안에서 순번/순위 등을 매긴다는 게 핵심 차이입니다.',
      pattern: 'ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)',
      solutionSql: 'SELECT customer_id, id AS order_id, order_date, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY order_date) AS order_seq FROM orders',
      orderMatters: false,
      starterSql: '-- 고객별로 주문일 순서대로 순번을 매기세요 (ROW_NUMBER)\nSELECT\n',
    },
    {
      id: 'win-rank-salary-in-dept', category: 'window', difficulty: 'medium', schemaId: 'hr_payroll', type: 'query',
      title: '부서 내 급여 순위',
      scenario: '인사팀: "부서마다 급여 1등이 누군지, 전체 직원에 대해 순위를 매겨서 보여주세요."',
      hints: ['RANK() OVER (PARTITION BY department_id ORDER BY salary DESC) 를 사용하세요.'],
      concept: 'RANK()는 동점자에게 같은 순위를 주고 다음 순위를 건너뜁니다(1,1,3). 동점자에게 같은 순위를 주되 다음 순위를 건너뛰지 않으려면 DENSE_RANK()(1,1,2)를 씁니다. 실무에서 둘을 혼동해서 버그가 나는 경우가 꽤 있어요.',
      pattern: 'RANK() OVER (PARTITION BY ...)',
      solutionSql: 'SELECT name, department_id, salary, RANK() OVER (PARTITION BY department_id ORDER BY salary DESC) AS salary_rank FROM employees',
      orderMatters: false,
      starterSql: '-- 부서별로 급여 순위를 매기세요 (RANK, 급여 높은 사람이 1등)\nSELECT\n',
    },
    {
      id: 'win-running-total', category: 'window', difficulty: 'hard', schemaId: 'saas_billing', type: 'query',
      title: '월별 누적 매출',
      scenario: 'CFO: "월별 매출을 누적으로(이번 달까지 합산) 보여주는 표를 만들어주세요."',
      hints: ['먼저 월별 매출을 GROUP BY로 구한 다음, 그 결과에 SUM(...) OVER (ORDER BY billing_month) 를 씌우세요.', '서브쿼리(또는 CTE)로 월별 매출을 먼저 만들고 바깥에서 윈도우 함수를 적용하는 2단계 구조입니다.'],
      concept: '집계(GROUP BY)와 윈도우 함수는 같은 SELECT 레벨에서 바로 섞이지 않는 경우가 많아서, "먼저 집계 → 그 결과에 윈도우 함수"처럼 서브쿼리로 단계를 나누는 게 실무에서 아주 흔한 패턴입니다.',
      pattern: 'SUM() OVER (ORDER BY ...) — 누적합',
      solutionSql: "SELECT billing_month, revenue, SUM(revenue) OVER (ORDER BY billing_month) AS running_total FROM (SELECT billing_month, SUM(amount) AS revenue FROM invoices WHERE paid_at IS NOT NULL GROUP BY billing_month) t",
      orderMatters: true,
      starterSql: '-- 월별 매출(결제완료분만)을 구한 뒤, 그 결과에 누적합을 구하는 SUM() OVER를 적용하세요\nSELECT\n',
    },
    {
      id: 'win-top-n-per-category', category: 'window', difficulty: 'hard', schemaId: 'community', type: 'query',
      title: '카테고리별 조회수 TOP 2',
      scenario: '콘텐츠팀: "카테고리마다 조회수 가장 높은 글 2개씩만 모아서 보여주세요."',
      hints: ['먼저 RANK() OVER (PARTITION BY category ORDER BY view_count DESC)로 순위를 매기고, 바깥 쿼리에서 그 순위가 2 이하인 것만 걸러내세요.', '윈도우 함수 결과는 WHERE에서 바로 못 쓰니, 서브쿼리로 감싸고 바깥에서 WHERE rnk <= 2 처럼 걸러야 합니다.'],
      concept: '"그룹별 상위 N개"는 윈도우 함수가 가장 빛을 발하는 문제입니다. LIMIT은 전체에서 N개만 뽑지만, PARTITION BY + RANK는 "그룹마다" N개씩 뽑을 수 있어요. 랭킹 게시판, 카테고리별 베스트 상품 같은 기능에 필수입니다.',
      pattern: 'RANK() + 서브쿼리로 그룹별 TOP N',
      solutionSql: 'SELECT category, title, view_count FROM (SELECT category, title, view_count, RANK() OVER (PARTITION BY category ORDER BY view_count DESC) AS rnk FROM posts) t WHERE rnk <= 2',
      orderMatters: false,
      starterSql: '-- 카테고리별 조회수 순위를 매긴 뒤, 순위가 2 이하인 게시글만 조회하세요\nSELECT\n',
    }
  );

  /* ============================================================
   * 6. 실무형 가공 (CASE / 날짜 / 문자열)
   * ========================================================== */
  PROBLEMS.push(
    {
      id: 'tr-status-label', category: 'transform', difficulty: 'easy', schemaId: 'ecommerce', type: 'query',
      title: '주문 상태를 요약 라벨로 변환',
      scenario: '프론트 개발자: "status 값 그대로 말고, \'취소\'는 \'취소됨\', 나머지는 전부 \'처리중\'으로 묶어서 내려주실 수 있나요? 프론트에서 분기 처리를 줄이고 싶어요."',
      hints: ['CASE WHEN status = \'취소\' THEN \'취소됨\' ELSE \'처리중\' END 형태를 사용하세요.'],
      concept: 'CASE WHEN은 SQL에서 쓰는 if/else입니다. 복잡한 분기 로직을 애플리케이션 코드 대신 쿼리에서 미리 처리해두면, 프론트/API 레이어가 훨씬 단순해지는 경우가 많아요.',
      pattern: 'CASE WHEN',
      solutionSql: "SELECT id, status, CASE WHEN status = '취소' THEN '취소됨' ELSE '처리중' END AS status_label FROM orders",
      orderMatters: false,
      starterSql: "-- status가 '취소'면 '취소됨', 아니면 '처리중'으로 라벨링하세요 (CASE WHEN)\nSELECT\n",
    },
    {
      id: 'tr-tenure-years', category: 'transform', difficulty: 'medium', schemaId: 'hr_payroll', type: 'query',
      title: '근속 연수 계산',
      scenario: '인사팀: "2024-12-31 기준으로 각 직원의 근속 연수가 몇 년인지 계산해주세요."',
      hints: ["(julianday('2024-12-31') - julianday(hire_date)) / 365 로 대략적인 연수를 구할 수 있습니다.", 'CAST(... AS INTEGER)로 정수로 내림할 수 있어요.'],
      concept: 'SQLite의 날짜 함수는 비교적 단순하지만(julianday, strftime 정도), MySQL은 DATEDIFF/TIMESTAMPDIFF, PostgreSQL은 AGE() 함수처럼 DB마다 제공하는 날짜 함수가 다릅니다. 개념(기준일-시작일)은 동일하니 문법만 그때그때 찾아보면 돼요.',
      pattern: '날짜 계산 함수',
      solutionSql: "SELECT name, hire_date, CAST((julianday('2024-12-31') - julianday(hire_date)) / 365 AS INTEGER) AS tenure_years FROM employees ORDER BY tenure_years DESC",
      orderMatters: true,
      starterSql: "-- 2024-12-31 기준 근속연수를 정수로 계산해서 오래 근무한 순으로 조회하세요\nSELECT\n",
    },
    {
      id: 'tr-email-domain', category: 'transform', difficulty: 'medium', schemaId: 'ecommerce', type: 'query',
      title: '이메일 도메인별 고객 수',
      scenario: '마케팅팀: "고객들이 어떤 이메일 서비스를 많이 쓰는지 궁금해요. @ 뒤의 도메인별로 인원수를 세어주세요."',
      hints: ["SUBSTR(email, INSTR(email, '@') + 1) 로 '@' 뒤 부분을 잘라낼 수 있습니다.", '그 결과로 GROUP BY 하고 COUNT(*)를 구하세요.'],
      concept: '문자열 함수(SUBSTR, INSTR 등)로 원시 데이터를 가공해서 집계하는 건 실무 리포트 쿼리에서 자주 나옵니다. 다만 이런 가공을 WHERE 조건에 걸면 인덱스를 못 타는 경우가 많다는 것도 7번 카테고리에서 다뤄요.',
      pattern: '문자열 함수 + GROUP BY',
      solutionSql: "SELECT SUBSTR(email, INSTR(email, '@') + 1) AS domain, COUNT(*) AS cnt FROM customers GROUP BY domain ORDER BY cnt DESC",
      orderMatters: true,
      starterSql: "-- 이메일의 '@' 뒤 도메인별로 고객 수를 세어 많은 순으로 조회하세요\nSELECT\n",
    },
    {
      id: 'tr-time-of-day', category: 'transform', difficulty: 'medium', schemaId: 'booking', type: 'query',
      title: '예약 시간대를 오전/오후/저녁으로 구간화',
      scenario: '총무팀: "예약이 오전/오후/저녁 중 언제 몰리는지 보고 싶어요. 시간대별로 라벨 붙여서 건수를 세어주세요."',
      hints: ["시작 시각의 '시'만 뽑으려면 CAST(SUBSTR(start_time, 12, 2) AS INTEGER) 를 사용하세요 (예: '2024-06-10 14:00'에서 14).", 'CASE WHEN으로 9~11시=오전, 12~17시=오후, 18시 이후=저녁으로 구간화하세요.'],
      concept: 'CASE WHEN과 문자열/날짜 함수를 조합하면 "구간화(버킷팅)"를 쿼리 레벨에서 바로 할 수 있습니다. 통계·리포트성 쿼리에서 자주 쓰는 조합이에요.',
      pattern: 'CASE WHEN + 문자열 함수',
      solutionSql: "SELECT CASE WHEN CAST(SUBSTR(start_time, 12, 2) AS INTEGER) < 12 THEN '오전' WHEN CAST(SUBSTR(start_time, 12, 2) AS INTEGER) < 18 THEN '오후' ELSE '저녁' END AS time_slot, COUNT(*) AS cnt FROM reservations GROUP BY time_slot",
      orderMatters: false,
      starterSql: '-- 예약 시작시각을 오전(~11시)/오후(~17시)/저녁(18시~)으로 구간화해서 건수를 세어보세요\nSELECT\n',
    }
  );

  /* ============================================================
   * 7. 인덱스 & 성능 튜닝 (perf_shop 도메인, 주문 3,000건)
   * ========================================================== */
  PROBLEMS.push(
    {
      id: 'perf-read-scan', category: 'perf', difficulty: 'easy', schemaId: 'perf_shop', type: 'short-answer',
      title: '실행계획 읽기: 어디를 훑고 있나요?',
      scenario: 'DBA: "운영 DB에서 이 쿼리가 느리다는 리포트가 올라왔어요. EXPLAIN QUERY PLAN 결과부터 읽는 연습을 해봐요."\n\n대상 쿼리: SELECT * FROM orders WHERE customer_id = 77',
      hints: ['아래 표시된 실행계획에서 "SCAN 테이블명" 형태의 문구를 찾아보세요.', 'SCAN은 인덱스를 못 타고 테이블 전체를 처음부터 끝까지 훑는다는 뜻입니다.'],
      concept: 'EXPLAIN QUERY PLAN의 핵심은 딱 두 단어입니다 — SCAN(전체를 다 훑음, 느릴 수 있음)과 SEARCH(인덱스로 바로 찾아감, 빠름). 쿼리가 느리다는 신고가 오면 가장 먼저 이 둘 중 뭐가 찍히는지부터 봅니다.',
      pattern: 'EXPLAIN QUERY PLAN',
      targetQuery: 'SELECT * FROM orders WHERE customer_id = 77',
      question: '위 실행계획에서 SCAN(전체 스캔)되고 있는 테이블 이름은 무엇인가요?',
      acceptedAnswers: ['orders'],
    },
    {
      id: 'perf-add-index', category: 'perf', difficulty: 'medium', schemaId: 'perf_shop', type: 'query',
      title: 'SCAN을 SEARCH로 바꾸기',
      scenario: 'DBA: "customer_id로 주문 조회하는 API가 트래픽이 많은데 매번 3,000건을 다 훑고 있어요. 인덱스부터 만들어주세요."\n\n최적화 대상 쿼리: SELECT * FROM orders WHERE customer_id = 77',
      hints: ['CREATE INDEX idx_orders_customer ON orders(customer_id); 를 입력하고 실행해보세요.', '실행 후 아래 "실행계획" 패널이 SEARCH로 바뀌는지 확인하세요.'],
      concept: 'WHERE에 자주 쓰이는 컬럼에 인덱스를 만들면, DB가 그 컬럼 값으로 바로 찾아갈 수 있는 별도의 정렬된 자료구조(보통 B-Tree)를 갖게 됩니다. 그게 SCAN이 SEARCH로 바뀌는 이유예요.',
      pattern: 'CREATE INDEX',
      skipResultCheck: true,
      targetQuery: 'SELECT * FROM orders WHERE customer_id = 77',
      requirePlanIncludes: ['SEARCH'],
      requirePlanExcludes: ['SCAN orders'],
      starterSql: '-- orders.customer_id에 인덱스를 만드세요 (CREATE INDEX)\n',
      _testSql: 'CREATE INDEX idx_orders_customer ON orders(customer_id);',
    },
    {
      id: 'perf-composite-index', category: 'perf', difficulty: 'hard', schemaId: 'perf_shop', type: 'query',
      title: '정렬까지 커버하는 복합 인덱스',
      scenario: 'DBA: "방금 인덱스 만든 쿼리에 ORDER BY까지 붙었더니 다시 느려졌어요. 정렬까지 인덱스로 처리되게 해주세요."\n\n최적화 대상 쿼리: SELECT * FROM orders WHERE customer_id = 77 ORDER BY order_date',
      hints: ['단일 컬럼 인덱스만 있으면 정렬은 별도로 "TEMP B-TREE"를 만들어서 처리합니다 (느림).', 'CREATE INDEX idx_orders_cust_date ON orders(customer_id, order_date); 처럼 조건 컬럼과 정렬 컬럼을 함께 묶은 복합 인덱스를 만들어보세요.', '복합 인덱스는 컬럼 순서가 중요합니다 — WHERE에 쓰는 컬럼을 앞에, ORDER BY 컬럼을 뒤에 둡니다.'],
      concept: '복합(다중 컬럼) 인덱스는 "왼쪽부터 순서대로" 쓰입니다. (customer_id, order_date) 인덱스는 customer_id로 좁히면서 그 안에서 이미 order_date 순으로 정렬돼 있기 때문에, 별도 정렬(TEMP B-TREE) 없이 바로 순서대로 읽을 수 있어요. 이걸 "커버링"한다고 표현합니다.',
      pattern: '복합 인덱스 (정렬 커버)',
      skipResultCheck: true,
      targetQuery: 'SELECT * FROM orders WHERE customer_id = 77 ORDER BY order_date',
      requirePlanIncludes: ['SEARCH'],
      requirePlanExcludes: ['SCAN orders', 'TEMP B-TREE'],
      starterSql: '-- customer_id와 order_date를 함께 묶은 복합 인덱스를 만드세요 (CREATE INDEX)\n',
      _testSql: 'CREATE INDEX idx_orders_cust_date ON orders(customer_id, order_date);',
    },
    {
      id: 'perf-indexed-by', category: 'perf', difficulty: 'hard', schemaId: 'perf_shop', type: 'query',
      title: '특정 인덱스를 강제로 지정하기 (힌트)',
      scenario: 'DBA: "orders.status에는 이미 idx_orders_status 인덱스가 있어요. MySQL이었으면 FORCE INDEX(idx_orders_status) 처럼 힌트를 줬을 텐데, SQLite에서는 INDEXED BY 절로 특정 인덱스를 콕 집어 쓰게 강제할 수 있어요. status=\'취소\'인 주문을 idx_orders_status를 명시해서 조회해보세요."',
      hints: ["SELECT * FROM orders INDEXED BY idx_orders_status WHERE status = '취소' 형태로 작성하세요.", 'INDEXED BY 뒤에는 반드시 실제로 존재하는 인덱스 이름을 써야 합니다.'],
      concept: '실무 DB(MySQL: USE/FORCE/IGNORE INDEX, Oracle: /*+ INDEX(...) */, SQL Server: WITH (INDEX(...)))는 옵티마이저가 고른 실행계획이 마음에 안 들 때 특정 인덱스를 쓰도록 강제하는 힌트 문법을 제공합니다. SQLite의 INDEXED BY도 같은 역할이에요. 다만 힌트는 "내가 DB보다 더 잘 안다"고 선언하는 거라, 데이터가 바뀌면 오히려 역효과가 날 수 있어 신중하게 써야 합니다.',
      pattern: 'INDEXED BY (힌트)',
      setupSql: 'CREATE INDEX idx_orders_status ON orders(status);',
      solutionSql: "SELECT * FROM orders INDEXED BY idx_orders_status WHERE status = '취소'",
      orderMatters: false,
      requirePlanIncludes: ['idx_orders_status'],
      starterSql: "-- idx_orders_status 인덱스를 INDEXED BY로 명시해서 status='취소' 주문을 조회하세요\nSELECT\n",
    },
    {
      id: 'perf-like-no-index', category: 'perf', difficulty: 'medium', schemaId: 'perf_shop', type: 'short-answer',
      title: 'LIKE 검색은 왜 인덱스를 못 탈까',
      scenario: 'DBA: "name 컬럼에 인덱스를 만들어놨는데도 LIKE \'%5\' 검색이 여전히 느리다고 하네요. 왜 그런지 실행계획으로 확인해봐요."\n\n대상 쿼리: SELECT * FROM customers WHERE name LIKE \'%5\'',
      hints: ['인덱스는 "사전처럼" 앞글자부터 순서대로 찾아갑니다. 검색어 앞에 %가 붙으면 어디서부터 찾아야 할지 알 수 없어요.', "반대로 LIKE '김%'처럼 뒤에만 %가 붙으면 인덱스를 탈 수 있습니다."],
      concept: "LIKE '%패턴' (앞에 와일드카드)은 인덱스가 있어도 활용하지 못하고 SCAN으로 떨어집니다. 반면 LIKE '패턴%'(뒤에만 와일드카드)는 인덱스를 탈 수 있어요. 검색 기능을 인덱스로 빠르게 만들고 싶다면 전문검색(Full-Text Search)이나 별도 검색엔진(Elasticsearch 등)을 쓰는 이유가 바로 이것 때문입니다.",
      pattern: 'LIKE와 인덱스',
      setupSql: 'CREATE INDEX idx_customers_name ON customers(name);',
      targetQuery: "SELECT * FROM customers WHERE name LIKE '%5'",
      question: '인덱스가 있는데도 이 쿼리의 실행계획에 찍히는 단어는 SCAN일까요, SEARCH일까요?',
      acceptedAnswers: ['scan', 'SCAN'],
    },
    {
      id: 'perf-correlated-to-join', category: 'perf', difficulty: 'hard', schemaId: 'perf_shop', type: 'query',
      title: '상관 서브쿼리를 JOIN으로 리팩터링',
      scenario: '시니어 개발자: "APM에 이 쿼리가 평균 400ms 넘게 걸린다고 떴어요. 주문마다 서브쿼리가 다시 도는 구조라 그래요. 결과는 그대로 두고 JOIN으로 다시 짜볼까요?"\n\n느린 원본 쿼리:\nSELECT o.id, o.customer_id, o.amount\nFROM orders o\nWHERE o.amount > (\n  SELECT AVG(o2.amount) FROM orders o2 WHERE o2.customer_id = o.customer_id\n)',
      hints: ['먼저 고객별 평균금액을 구하는 서브쿼리를 "파생 테이블"로 만드세요: (SELECT customer_id, AVG(amount) AS avg_amt FROM orders GROUP BY customer_id)', '그 파생 테이블을 orders와 customer_id로 JOIN한 뒤, WHERE o.amount > avg_amt 로 비교하세요.'],
      concept: '상관 서브쿼리는 바깥 쿼리의 행 수만큼(여기선 3,000번!) 안쪽 쿼리가 반복 실행될 수 있습니다. 반면 "고객별 평균"을 미리 한 번만 계산한 파생 테이블과 JOIN하면, DB가 훨씬 적은 작업으로 같은 결과를 낼 수 있어요. 결과가 같다면 이렇게 반복 실행 구조를 한 번의 집계로 바꾸는 게 튜닝의 핵심입니다.',
      pattern: '상관 서브쿼리 → JOIN(파생 테이블) 리팩터링',
      solutionSql: 'SELECT o.id, o.customer_id, o.amount FROM orders o JOIN (SELECT customer_id, AVG(amount) AS avg_amt FROM orders GROUP BY customer_id) a ON a.customer_id = o.customer_id WHERE o.amount > a.avg_amt',
      orderMatters: false,
      starterSql: '-- 고객별 평균 주문금액보다 큰 주문을, 상관 서브쿼리 없이 JOIN(파생 테이블)으로 조회하세요\nSELECT\n',
    },
    {
      id: 'perf-or-to-union', category: 'perf', difficulty: 'hard', schemaId: 'perf_shop', type: 'query',
      title: 'OR 조건을 UNION으로 쪼개서 인덱스 활용하기',
      scenario: 'DBA: "customer_id에도 status에도 각각 인덱스가 있는데, OR로 묶은 쿼리는 여전히 풀스캔이에요. 두 조건을 UNION으로 쪼개서 각자 인덱스를 타게 만들어볼까요?"\n\n최적화 대상(원본) 쿼리: SELECT * FROM orders WHERE customer_id = 77 OR status = \'취소\'',
      hints: ['customer_id=77인 결과와 status=\'취소\'인 결과를 각각 SELECT로 조회하고 UNION으로 합치세요.', 'UNION(ALL 없이)은 자동으로 중복을 제거하므로, 두 조건에 동시에 해당하는 주문이 두 번 나오지 않습니다.'],
      concept: '하나의 인덱스는 보통 하나의 조건을 효율적으로 처리합니다. 서로 다른 컬럼에 OR로 묶인 조건은 옵티마이저가 어느 한쪽 인덱스도 제대로 못 타고 풀스캔으로 빠지는 경우가 많아요. 이럴 땐 조건별로 쿼리를 나눠서 UNION으로 합치면 각각 자기 인덱스를 탈 수 있습니다.',
      pattern: 'OR → UNION (인덱스 활용)',
      setupSql: 'CREATE INDEX idx_orders_customer2 ON orders(customer_id); CREATE INDEX idx_orders_status2 ON orders(status);',
      solutionSql: "SELECT * FROM orders WHERE customer_id = 77 UNION SELECT * FROM orders WHERE status = '취소'",
      orderMatters: false,
      requirePlanIncludes: ['SEARCH'],
      starterSql: "-- customer_id=77 결과와 status='취소' 결과를 각각 조회해서 UNION으로 합치세요\nSELECT\n",
    }
  );

  const DATA = { SCHEMAS, CATEGORIES, PROBLEMS, DIFFICULTY_META };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DATA;
  } else {
    root.SQL_LAB_DATA = DATA;
  }
})(typeof window !== 'undefined' ? window : globalThis);
