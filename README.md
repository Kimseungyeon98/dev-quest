# 🎮 Dev Quest

게임처럼 직접 입력하면서 개발 명령어를 익히는 학습 사이트 모음입니다. 빌드 과정 없이 `index.html` 을 열면 바로 동작해요.

| 과목 | 폴더 | 내용 |
|---|---|---|
| 🐧 Linux Quest | [`linux/`](linux/) | 가상 터미널로 배우는 서버 명령어 |
| 🗄️ SQL Quest | [`sql/`](sql/) | SQLite WASM 으로 배우는 실무 SQL |
| ⎇ Git Quest | [`git/`](git/) | 상황별 시나리오로 배우는 Git |
| 🧩 Algorithm Quest | [`algo/`](algo/) | Java 로 푸는 코딩테스트 알고리즘 |

과목은 서로 섞이지 않고 각자의 영역에서 공부해요. 루트의 `index.html` 은 과목 목록과 **종합 티어**를 보여 주는 허브예요.

## 백엔드 (Spring Boot)

계정과 진행도 저장을 위해 [`backend/`](backend/) 에 Spring Boot 4 · Java 21 · PostgreSQL 백엔드가 있어요. 학습 사이트 파일(HTML·JS·CSS)은 빌드할 때 jar 안으로 복사돼서 백엔드가 같은 주소에서 함께 서빙해요.

```bash
docker compose -f backend/compose.yaml up -d   # 로컬 PostgreSQL
cd backend && ./gradlew bootRun                 # http://localhost:8080/
```

- DB 접속 정보는 `PGHOST` · `PGPORT` · `PGDATABASE` · `PGUSER` · `PGPASSWORD` 환경 변수로 받아요 (Railway PostgreSQL 이 넣어 주는 이름 그대로, 기본값은 `compose.yaml` 과 같아요). 로컬 Docker DB 는 PC 에 설치된 PostgreSQL 과 겹치지 않도록 **5433** 포트를 써요.
- 스키마는 Flyway 마이그레이션([`backend/src/main/resources/db/migration`](backend/src/main/resources/db/migration))만 바꿔요.
- 테스트는 `./gradlew test` 예요. Testcontainers 로 PostgreSQL 을 띄우므로 Docker 가 필요해요. Docker 가 없으면 떠 있는 DB 로 돌릴 수 있어요:
  ```bash
  DEVQUEST_TEST_EXTERNAL_DB=true SPRING_DATASOURCE_URL=jdbc:postgresql://localhost:5432/devquest_test ./gradlew test
  ```
- 프론트만 고칠 때는 아래 `serve.js` 로 빌드 없이 바로 확인할 수 있어요. (로그인 없이 열리고, 상단 바의 계정 표시는 숨겨져요)

### 로그인

- 백엔드로 열면 로그인해야 사이트를 볼 수 있어요. 로그인 화면은 [`login/`](login/) 이에요.
- 아이디(영문·숫자·_ 4~20자, 대소문자 구분 없음)와 비밀번호(8~64자, 영문+숫자)로 가입해요. 비밀번호는 bcrypt 로 저장해요.
- 로그인 상태는 DB 세션(Spring Session JDBC)이라 재배포해도 유지돼요. 아무것도 안 하면 8시간 뒤 로그아웃돼요.
- "로그인 유지"를 고르면 30일 동안 자동 로그인돼요. 토큰은 DB 에 저장하고 쓸 때마다 바뀌며, 이미 쓴 토큰이 다시 오면 도용으로 보고 그 계정의 자동 로그인을 모두 끊어요.
- 같은 아이디+IP 로 15분 안에 5번 틀리면 15분 동안 로그인을 막고, 같은 IP 에서 1시간에 10번까지 가입할 수 있어요 (`devquest.limits.*`).
- API: `POST /api/auth/signup` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/me`. POST 는 `XSRF-TOKEN` 쿠키 값을 `X-XSRF-TOKEN` 헤더로 보내야 해요 (프론트는 `DevQuest.api()` 가 알아서 해요).
- 배포할 때 `REMEMBER_ME_KEY` 환경 변수에 임의의 긴 문자열을 넣어 두면 좋아요.

### 진행도 API

과목 앱이 저장하던 JSON 을 과목별로 그대로 계정에 저장해요. `version` 으로 여러 기기의 동시 저장을 막아요(낙관적 잠금).

| 요청 | 설명 |
|---|---|
| `GET /api/progress` | `{ courses: { algo: { data, version, updatedAt }, ... } }` — 저장한 과목만 |
| `GET /api/progress/{과목}` | `{ data, version, updatedAt }` — 저장한 적 없으면 `data: null, version: 0` |
| `PUT /api/progress/{과목}` | 본문 `{ data, version }` (version 은 마지막으로 받은 값, 처음이면 0) → 새 `{ data, version, updatedAt }` |

- 다른 기기에서 먼저 저장해서 version 이 다르면 `409` 와 함께 최신 기록을 `current` 로 돌려줘요. 프론트는 두 기록을 합쳐서 `current.version` 으로 다시 저장하면 돼요.
- 과목은 퀘스트 카탈로그([`shared/quests.json`](shared/quests.json))에 있는 과목만 받고, 과목 하나는 최대 512KB 예요(`devquest.progress.max-bytes`).

### 랭킹과 닉네임

- 허브 아래쪽 **🏆 랭킹**에서 전체 랭킹과 과목별 랭킹을 볼 수 있어요. XP 가 높은 순이고, 같으면 그 XP 에 먼저 도달한 사람이 위예요. 상위 50명과 내 순위(목록 밖이어도)를 보여 줘요.
- XP 는 서버가 계산해요. 진행도를 저장할 때 퀘스트 카탈로그로 완료한 퀘스트의 난이도 XP 를 더해 `course_scores` 에 저장하고, 카탈로그에 없는 퀘스트 id 는 세지 않아요(최대 XP 를 넘을 수 없어요). 서버를 켤 때 모든 진행도로 점수를 다시 계산해서, 퀘스트를 추가·삭제해도 맞춰져요.
- 랭킹에는 **닉네임**만 보이고 로그인 아이디는 보이지 않아요. 가입하면 `모험가1234` 같은 기본 닉네임이 붙고, 상단 바나 허브의 닉네임을 눌러 바꿀 수 있어요 (한글·영문·숫자·_ 2~12자, 대소문자 구분 없이 하나만).
- API: `GET /api/ranking?course=all|linux|sql|git|algo&limit=50` · `PUT /api/me/nickname` `{ nickname }` · `GET /api/me` → `{ username, nickname, defaultNickname }`

### 퀘스트 카탈로그 (`shared/quests.json`)

서버가 XP 를 계산할 수 있도록 과목별 퀘스트 id·난이도와 XP 규칙을 담은 자동 생성 파일이에요. 허브와 같은 방법(`courses.js` 의 `scripts` → `items`)으로 만들고, XP 규칙은 `shared/dq.js` 에서 가져와요. **퀘스트를 추가·수정·삭제하면 다시 만들어 커밋해 주세요.** CI 가 최신인지 확인해요.

```bash
node shared/tools/build-quest-catalog.js
```

### 프론트 동기화 (`DevQuest.sync`)

과목 앱은 예전처럼 `localStorage`(과목의 `storageKey`)를 읽고 쓰고, [`shared/dq.js`](shared/dq.js) 의 동기화 모듈이 그 값을 계정과 맞춰요.

- 과목 페이지는 `DevQuest.afterSync('js/app.js')` 로 앱을 시작해요. 서버 진행도를 `localStorage` 에 먼저 써 둔 뒤에 앱이 돌아요.
- 앱은 저장 직후 `DevQuest.sync.changed('과목')` 을 불러요. 1.2초 동안 모았다가 `PUT` 하고, 페이지를 바로 떠나면 `keepalive` 요청으로 보내요. 그래도 못 보낸 기록은 다음에 페이지를 열 때 올려요.
- 다른 기기에서 먼저 저장했으면(409) 두 기록을 합쳐요: 목록은 합집합, 객체는 키별로, 나머지 값은 이 기기 값을 따라요. 화면 아래에 "합쳤어요" 안내와 새로고침 버튼이 떠요.
- 로그인 기능 전에 이 브라우저에 쌓인 진행도는 **처음 로그인한 계정**에 합쳐요.
- 로그아웃하면 남은 기록을 보내고 이 브라우저의 진행도를 지워요. 같은 브라우저에서 다른 계정으로 로그인해도 기록이 섞이지 않아요.
- 상단 바의 ☁️ 는 저장 완료, ⏳ 는 저장 중, ⚠️ 는 저장 실패예요.
- 백엔드 없이(파일·`serve.js`) 열면 예전처럼 이 브라우저에만 저장해요.

## Railway 배포

저장소 루트의 [`Dockerfile`](Dockerfile) 과 [`railway.json`](railway.json) 으로 배포해요. 이미지 하나에 백엔드와 학습 사이트가 같이 들어가고, 서버를 켤 때 Flyway 가 DB 테이블을 만들어요. CI 의 `docker` job 이 같은 이미지를 빌드해 Railway 처럼 띄워 보고 헬스체크까지 확인해요.

### DB 스키마

dev-quest 는 모든 테이블을 PostgreSQL 의 **`devquest` 스키마**에 만들어요(`DB_SCHEMA` 로 바꿀 수 있어요). 그래서 다른 앱과 같은 Postgres·같은 DB 를 써도 `public` 스키마의 테이블(`users`, `flyway_schema_history` 등)과 겹치지 않고, 서로의 마이그레이션 기록도 따로 관리돼요.

### 이미 있는 Railway 프로젝트에 추가하기 (Postgres 공유)

다른 앱(예: luck-lounge)과 Postgres 가 올라가 있는 프로젝트에 서비스로 추가하면 돼요.

1. 그 프로젝트에서 **+ New** (또는 **Create**) → **GitHub Repo** → `dev-quest` 를 골라요. 저장소의 `railway.json` 대로 Dockerfile 빌드·헬스체크가 설정돼요.
2. 새로 생긴 dev-quest 서비스의 **Variables** 에 두 개를 넣어요.

   | 이름 | 값 |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Postgres 서비스 이름이 다르면 그 이름. **Add Reference** 로 골라도 돼요) |
   | `REMEMBER_ME_KEY` | 임의의 긴 문자열 (아래 명령으로 만들어요) |

   ```powershell
   [Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
   ```
3. dev-quest 서비스의 **Settings** → **Networking** → **Generate Domain** 으로 주소를 만들어요.
4. 배포가 끝나면 주소로 들어가 회원가입해요. 첫 실행 때 `devquest` 스키마와 테이블이 저절로 만들어지고, 다른 앱의 테이블은 건드리지 않아요.

같은 프로젝트의 서비스들은 사용량(크레딧)을 함께 써요. 메모리가 부족하면 Railway 사용량 화면에서 서비스별 메모리를 확인해 주세요.

### 새 프로젝트로 배포하기

1. [railway.com](https://railway.com) 에 GitHub 계정으로 로그인 → **New Project** → **Deploy from GitHub repo** → `dev-quest` 저장소를 골라요.
   (Railway GitHub 앱이 저장소에 접근하도록 허용해야 목록에 보여요)
2. 같은 프로젝트에서 **+ New** (또는 **Create**) → **Database** → **PostgreSQL** 을 추가해요.
3. 앱 서비스(dev-quest)의 **Variables** 에 두 개를 넣어요.

   | 이름 | 값 |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Postgres 서비스 이름이 다르면 그 이름으로. **Add Reference** 로 골라도 돼요) |
   | `REMEMBER_ME_KEY` | 임의의 긴 문자열 (아래 명령으로 만들어요) |

   ```powershell
   [Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
   ```
4. 앱 서비스의 **Settings** → **Networking** → **Generate Domain** 으로 `https://…up.railway.app` 주소를 만들어요.
5. 배포가 끝나면(헬스체크 `/actuator/health` 통과) 주소로 들어가 회원가입해요.

### 그다음부터

- `main` 에 푸시하면 Railway 가 자동으로 다시 빌드·배포해요. DB 스키마 변경은 Flyway 마이그레이션 파일만 추가하면 배포 때 적용돼요.
- 로그는 앱 서비스의 **Deployments** → 배포 → **View Logs** 에서 봐요.
- `PORT` 는 Railway 가 넣어 줘요. 나머지 설정(`devquest.limits.*` 등)은 환경 변수로 바꿀 수 있어요 (예: `DEVQUEST_LIMITS_SIGNUPS_PER_HOUR=20`).

## Algorithm Quest 실행하기

Algorithm Quest 는 브라우저 안의 JVM([CheerpJ](https://cheerpj.com/))으로 **진짜 Java 17** 코드를 컴파일하고 채점해요. CheerpJ 는 `file://` 주소에서 동작하지 않아서 웹 서버로 열어야 하고, 처음 열 때 Java 실행기를 내려받느라 인터넷 연결이 필요해요.

```bash
node algo/tools/serve.js
```

그다음 http://localhost:8000/ 을 열면 돼요 (GitHub Pages 같은 정적 호스팅에서도 그대로 동작해요). 서버는 기본으로 이 컴퓨터에서만 열려요. 같은 네트워크의 다른 기기에서 열려면 `HOST=0.0.0.0 node algo/tools/serve.js` 로 실행해요.

- 문제 형식은 프로그래머스처럼 `class Solution` 의 `solution(...)` 메서드를 구현하는 방식이에요.
- "코드 실행"은 입출력 예만, "제출 후 채점하기"는 숨겨진 정확성 테스트와 큰 입력의 효율성 테스트까지 채점해요.
- 컴파일러는 페이지를 열 때 한 번 띄워 두고 계속 재사용해요(상주 컴파일러). 그래서 처음 준비만 오래 걸리고, 그다음부터 실행 한 번은 1초 안팎이에요. 상주 컴파일러와 공용 채점 코드(`JudgeCore`)는 브라우저 저장소에 남아서, 다시 방문하면 준비 시간도 짧아져요.
- 채점할 때는 반복문·메서드·블록 람다 시작 부분에 시간 검사를 끼워 넣어서, 무한 루프나 너무 느린 풀이를 케이스당 제한 시간(기본 3초)에 끊어요. 그래도 끝나지 않으면(식 람다만 쓴 무한 스트림 등) 멈춘 것으로 보고 새로고침을 안내해요.
- 채점용 코드가 쓰는 클래스 이름(`Judge`, `JudgeCore`, `__J`, `__T`)과 `System.exit()` 는 쓸 수 없어서, 컴파일 전에 안내해요.
- 문제는 [`algo/js/problems.js`](algo/js/problems.js) 에 있어요. 문제를 추가·수정한 뒤에는 퀘스트 카탈로그를 다시 만들고(`node shared/tools/build-quest-catalog.js`), 로컬 JDK 17 이상으로 검증해 주세요. JS 참조 풀이와 자바 모범 답안이 같은 답을 내는지, 모범 답안이 모든 테스트를 통과하는지 확인해요.
  ```bash
  node algo/tools/validate-problems.js
  ```

## 자동 검증 (CI)

푸시와 PR 마다 GitHub Actions([`.github/workflows/validate.yml`](.github/workflows/validate.yml))가 JS 문법 검사, 퀘스트 카탈로그가 최신인지, Git Quest 시나리오 검증(`node git/tools/validate-scenarios.js`), Algorithm Quest 문제 검증(JDK 17), 백엔드 테스트(JDK 21 + Testcontainers), 배포 이미지 빌드·실행 확인(Docker)을 돌려요.

## 점수와 티어

모든 과목이 같은 규칙을 써요 (규칙은 [`shared/dq.js`](shared/dq.js) 한 곳에 있어요).

- 퀘스트마다 난이도에 따라 XP 가 달라요: 초급 100 · 중급 150 · 고급 250
- 레벨은 XP 가 쌓일수록 오르고, 레벨이 높을수록 다음 레벨까지 필요한 XP 가 늘어요.
- **티어**는 "전체 XP 중 내가 얻은 비율"로 정해요: 🌱 새싹 → 🥉 브론즈(5%) → 🥈 실버(20%) → 🥇 골드(40%) → 💠 플래티넘(60%) → 💎 다이아(80%) → 👑 마스터(97%)
- 허브는 모든 과목을 합친 종합 티어와 과목별 티어/난이도별 진행을 보여 줘요.

## 새 과목 추가하기

1. 새 폴더(예: `docker/`)를 만들고 `index.html` 에 공용 상단 바를 넣어 주세요.
   ```html
   <link rel="stylesheet" href="../shared/dq.css" />
   <header id="dqbar"></header>
   <script src="../courses.js"></script>
   <script src="../shared/dq.js"></script>
   ```
   앱 코드에서는 `const bar = DevQuest.mountBar('docker')` 로 바를 만들고, 진행이 바뀔 때마다 `bar.update(DevQuest.stats(items, doneIds))` 를 호출해요.
   앱 스크립트는 `<script>DevQuest.afterSync('js/app.js');</script>` 로 불러오고, 진행도를 `localStorage` 에 저장한 직후 `DevQuest.sync.changed('docker')` 를 불러 주세요. (`items` 는 `[{id, difficulty}]`, `difficulty` 는 `'easy'|'medium'|'hard'` 또는 1~5)
2. [`courses.js`](courses.js) 에 항목을 하나 추가해요. `doneField` 에는 진행 기록에서 완료 목록이 든 필드 이름을 적어요(랭킹 계산용). 백엔드가 서빙하도록 [`backend/build.gradle.kts`](backend/build.gradle.kts) 의 `siteIncludes` 에 폴더를 추가하고, 퀘스트 카탈로그를 다시 만들어요(`node shared/tools/build-quest-catalog.js`). 이름·아이콘·소개는 여기서만 정하므로 허브와 과목 화면의 제목이 항상 같아요.
   - `storageKey` 와 `doneIds(saved)` : 앱이 저장한 진행 기록에서 완료한 퀘스트 id 를 꺼내는 방법
   - `scripts()` 와 `items()` : 허브가 데이터 파일만 불러와 퀘스트 목록을 직접 만드는 방법 (전체 문제 수를 손으로 적지 않아요)

## 기록

세 프로젝트(`linux-terminal-game`, `sql-query-lab`, `git-playbook`)의 파일을 각 폴더로 복사해서 하나의 저장소로 합쳤어요. 기존 저장소의 커밋 기록은 가져오지 않았고, 이 저장소의 이력은 합친 시점의 `first commit` 부터 시작해요. 이전 이력은 원래 폴더에서 확인할 수 있어요.
