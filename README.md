# 🎮 Dev Quest

게임처럼 직접 입력하면서 개발 명령어를 익히는 학습 사이트 모음입니다. 빌드 과정 없이 `index.html` 을 열면 바로 동작해요.

| 과목 | 폴더 | 내용 |
|---|---|---|
| 🐧 Linux Quest | [`linux/`](linux/) | 가상 터미널로 배우는 서버 명령어 |
| 🗄️ SQL Quest | [`sql/`](sql/) | SQLite WASM 으로 배우는 실무 SQL |
| ⎇ Git Quest | [`git/`](git/) | 상황별 시나리오로 배우는 Git |
| 🧩 Algorithm Quest | [`algo/`](algo/) | Java 로 푸는 코딩테스트 알고리즘 |

과목은 서로 섞이지 않고 각자의 영역에서 공부해요. 루트의 `index.html` 은 허브예요.

- **이어서 할 퀘스트**: 가장 최근에 진행한 과목에서 마지막으로 연 퀘스트(이미 끝냈으면 다음 안 끝낸 퀘스트)를 보여 주고, [이어하기]로 그 퀘스트를 바로 열어요. 기록이 없으면 첫 퀘스트를 추천해요.
- **내 상태**: 종합 티어·레벨, 다음 티어까지 남은 XP, 총 XP·완료 수
- **과목 4개**: 과목별 진행률, **랭킹** 미니 목록, 점수 규칙
- 과목 화면은 주소 끝의 `#퀘스트id` 로 그 퀘스트를 바로 열어요 (예: `sql/index.html#agg-customer-order-count`).
- 과목 화면에서 정답을 맞힌 **바로 다음에 Enter 나 Tab** 을 누르면 다음 퀘스트로 넘어가요 (그 전에 다른 키를 누르면 원래대로 입력돼요). `DevQuest.nextButton()` / `DevQuest.armNext()` 가 처리해요.
- 아이콘은 이모지 대신 `shared/dq.js` 의 선 아이콘(`DevQuest.icon('bulb')`, HTML 은 `<span data-icon="bulb"></span>`)을 써요. 시나리오 설명·축하 문구 속 이모지는 콘텐츠라 그대로 둬요.

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

### 비밀번호 변경 · 복구

이메일을 받지 않아서, 비밀번호를 잊었을 때는 **복구 코드**로 되찾아요.

- **복구 코드**: 가입하면 `ABCD-EFGH-JKMN-PQRS` 모양의 16자리 코드를 한 번만 보여 줘요 (복사·파일로 저장). 서버에는 bcrypt 해시만 저장해요. 로그인 화면의 "비밀번호를 잊었어요"에서 아이디 + 복구 코드로 새 비밀번호를 정하면 바로 로그인되고, 쓴 코드는 새 코드로 바뀌어요. 복구 기능 전에 가입한 계정은 "내 계정"에서 만들 수 있어요(아바타의 주황 점이 알려 줘요).
- **내 계정**(상단 바의 닉네임 클릭): 닉네임, 비밀번호 바꾸기(다른 기기의 로그인·자동 로그인은 끊기고 이 기기는 그대로), 복구 코드 새로 만들기(비밀번호 확인).
- **회원 탈퇴**(내 계정 맨 아래): 비밀번호와 "탈퇴합니다" 확인 문구를 넣으면 계정·진행도·랭킹 점수가 지워지고(DB 연쇄 삭제) 모든 기기에서 로그아웃돼요. 같은 아이디로 다시 가입할 수 있어요. `DELETE /api/me` `{ password }`
- 복구·비밀번호 확인도 로그인처럼 15분 안에 5번 틀리면 잠시 막혀요.
- **관리자 임시 비밀번호**: 복구 코드도 잃어버린 사람을 위해, `ADMIN_TOKEN` 환경 변수(24자 이상)를 넣으면 관리자 API 가 켜져요. 비워 두면 꺼져 있어요(404).
  ```bash
  curl -X POST https://<주소>/api/admin/users/<아이디>/reset-password -H "X-Admin-Token: <ADMIN_TOKEN>"
  ```
  임시 비밀번호를 돌려주고 그 계정의 모든 로그인을 끊어요. 로그인한 뒤 "내 계정"에서 비밀번호를 바꾸라고 알려 주세요.
- API: `PUT /api/me/password` `{ currentPassword, newPassword }` · `POST /api/me/recovery-code` `{ password }` · `POST /api/auth/recover` `{ username, recoveryCode, newPassword, rememberMe }`

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

- 허브의 **랭킹** 카드에 전체 상위 5명과 내 순위가 보이고, [전체 랭킹 보기]를 누르면 전체·과목별 탭과 상위 50명 표가 펼쳐져요. XP 가 높은 순이고, 같으면 그 XP 에 먼저 도달한 사람이 위예요.
- **누적 · 이번 주** 전환: 이번 주 랭킹은 이번 주 월요일 0시(한국 시간, `DEVQUEST_TIMEZONE`)부터 새로 끝낸 퀘스트의 XP 만 더해요 (전체·과목별 모두). 매주 월요일에 새로 시작해서 늦게 시작한 사람도 1등을 노릴 수 있어요. 고른 기간은 브라우저에 기억해요.
- XP 는 서버가 계산해요. 진행도를 저장할 때 퀘스트 카탈로그로 완료한 퀘스트의 난이도 XP 를 더해 `course_scores` 에 저장하고, 카탈로그에 없는 퀘스트 id 는 세지 않아요(최대 XP 를 넘을 수 없어요). 서버를 켤 때 모든 진행도로 점수를 다시 계산해서, 퀘스트를 추가·삭제해도 맞춰져요.
- 랭킹에는 **닉네임**만 보이고 로그인 아이디는 보이지 않아요. 가입하면 `모험가1234` 같은 기본 닉네임이 붙고, 상단 바나 허브의 닉네임을 눌러 바꿀 수 있어요 (한글·영문·숫자·_ 2~12자, 대소문자 구분 없이 하나만).
- API: `GET /api/ranking?course=all|linux|sql|git|algo&period=all|week&limit=50` (응답의 `weekStart` = 이번 주 월요일) · `PUT /api/me/nickname` `{ nickname }` · `GET /api/me` → `{ username, nickname, defaultNickname }`

### 랭킹 부정 방지

진행도는 브라우저가 보내는 기록이라 마음먹고 고치면 완전히 막을 수는 없어요. 대신 사람이 풀 수 없는 속도의 기록을 찾아서 **랭킹에서만** 빼고(진행도·스트릭은 그대로) 관리자가 확인해요. 기준은 `application.yml` 의 `devquest.ranking.*` 에서 바꿔요.

- **한꺼번에 들어온 기록**: 한 번 저장에 새로 끝낸 퀘스트가 5개를 넘으면 완료 시각을 믿지 않아요 (`live = false`). 누적 점수에는 들어가지만 주간 랭킹·스트릭에는 안 들어가요.
- **너무 빠른 완료**: 10분 동안 20개를 넘게 끝내면 자동으로 **확인 중(review)** 이 되어 랭킹에서 빠져요.
- **새 계정의 급격한 XP**: 가입 24시간 안에 전체 XP 의 절반 이상을 모아도 확인 중이 돼요.
- 본인에게는 허브 랭킹에 "확인하는 동안 랭킹에서 잠시 빠져 있어요" 안내가 보여요.
- 관리자(`ADMIN_TOKEN` 필요):
  ```bash
  # 확인을 기다리는·숨긴 계정 목록 (이유·XP·최근 하루 완료 수)
  curl https://주소/api/admin/ranking/review -H "X-Admin-Token: $ADMIN_TOKEN"
  # status: ok(되돌리기) · trusted(되돌리고 다시는 자동으로 빼지 않기) · hidden(숨기기)
  curl -X PUT https://주소/api/admin/users/아이디/ranking -H "X-Admin-Token: $ADMIN_TOKEN" \
    -H "Content-Type: application/json" -d '{"status":"trusted"}'
  ```

### 완료 기록 · 연속 학습일

- 진행도를 저장할 때 서버가 이전 기록과 비교해 **새로 끝낸 퀘스트를 완료 시각과 함께** `quest_completions` 에 남기고, 진행 기록에서 빠진 퀘스트는 지워요 (과목 앱은 그대로).
- 이 기능 전에 끝낸 퀘스트는 시각을 추정해서(Git 은 앱이 저장한 시각, 나머지는 진행도 저장 시각) `live = false` 로 채워요. 연속 학습일·주간 랭킹에서는 빠져요.
- 허브의 **내 상태**에 연속 학습일(오늘 아직이면 어제까지 이어진 날 수, 최고 기록), 이번 주 월~일 7칸, 이번 주 XP 가 보여요. 하루·한 주는 `devquest.timezone`(기본 `Asia/Seoul`) 기준이고, 한 주는 월요일부터예요.
- API: `GET /api/me/activity` → `{ streak, bestStreak, activeToday, totalDays, today, week: { start, xp, done, days: [{ date, done, xp }] } }`

### 오답 노트

틀렸거나 힌트·정답을 본 퀘스트가 허브의 **오답 노트**에 모여요. [다시 풀기]로 열어(`과목/index.html?review=1#퀘스트`) 다시 맞히면 노트에서 **졸업**하고, 다시 틀리거나 힌트를 보면 노트로 돌아와요. × 로 직접 뺄 수도 있어요.

| 과목 | 틀린 시도로 세는 것 | 힌트 | 정답 보기 |
|---|---|---|---|
| Linux | 오류가 난 명령 (미션을 열 때마다 한 번) | 힌트 | — |
| SQL | 결과가 틀린 쿼리 · SQL 오류 · 틀린 단답 (인덱스 만들기처럼 결과가 없는 실행은 빼요) | 힌트 | — |
| Git | — | 힌트 | 정답 예시 · 자동 풀이 |
| Algorithm | "제출 후 채점하기"의 오답 · 컴파일 오류 (예제 실행은 연습이라 빼요) | 힌트 | 모범 답안 |

- 과목 화면은 `DevQuest.review.wrong / hint / answer / correct(과목, 퀘스트)` 로 알려 주고, 서버(`quest_reviews` 표)가 모아요.
- API: `POST /api/review/events` `{ course, quest, type, review }` · `GET /api/review` · `DELETE /api/review/{과목}/{퀘스트}`

### 퀘스트 카탈로그 (`shared/quests.json`)

과목별 퀘스트 id·난이도·제목(순서대로)과 XP 규칙을 담은 자동 생성 파일(약 20KB)이에요. 서버는 이 파일로 XP 를 계산하고, **허브는 과목 데이터 파일(모두 합쳐 약 380KB) 대신 이 파일 하나만 받아서** 퀘스트 목록·이어하기·진행률을 그려요. `courses.js` 의 `scripts` → `items` 로 만들고, XP 규칙은 `shared/dq.js` 에서 가져와요. **퀘스트를 추가·수정·삭제하면 다시 만들어 커밋해 주세요.** CI 가 최신인지 확인해요.

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

### 보안 헤더 (CSP)

모든 응답에 보안 헤더를 붙여요 ([`SecurityHeaders`](backend/src/main/java/com/devquest/web/SecurityHeaders.java)).

- **Content-Security-Policy**: 이 사이트와 허용한 CDN 의 스크립트만 실행돼요. HTML 안에 직접 쓴 스크립트(인라인)도 막혀서, 누군가 닉네임 같은 글자에 스크립트를 끼워 넣어도 실행되지 않아요.
  - 그래서 **HTML 에 `<script>…</script>` 나 `onclick="…"` 를 쓰면 안 돼요.** 스크립트는 파일로 두고 `<script src>` 로 불러요 (허브는 `hub.js`, 과목 시작은 `shared/start.js` 의 `data-app`). 백엔드 테스트가 HTML 을 검사해요.
  - Algorithm Quest(`/algo/`)만 CheerpJ(브라우저 Java)와 CodeMirror CDN 때문에 정책을 넓혀요.
  - 새 외부 주소(CDN·폰트 등)를 쓰려면 `SecurityHeaders` 에 추가해야 해요. e2e 테스트(`security.spec.js`)가 모든 화면에서 정책 위반이 없는지 확인해요.
- Referrer-Policy · Permissions-Policy · Cross-Origin-Opener-Policy, 그리고 Spring Security 기본 헤더(nosniff · X-Frame-Options · HTTPS 의 HSTS).

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

### 잠들었다 깨어날 때 (Serverless)

Railway Serverless 를 켜 두면 한동안 요청이 없을 때 서버가 잠들고, 다음 요청에 다시 켜져요. 그 사이 기다림을 줄이고 안내해요.

- **빨리 켜지기**: 이미지를 빌드할 때 jar 를 풀고 한 번 미리 띄워서 클래스 데이터 공유(CDS) 아카이브(`/app/app.jsa`)를 만들어 둬요. 로컬에서 재 보면 서버 시작이 약 4.5초 → 2.5초로 줄어요. CI 가 아카이브가 실제로 쓰이는지 확인해요.
- **화면은 바로**: 서비스 워커([`sw.js`](sw.js))가 학습 사이트 파일을 캐시해 둬요. 평소에는 항상 네트워크에서 받고(최신), 서버가 3초 넘게 답이 없으면 캐시해 둔 화면을 먼저 보여 줘요. API 는 캐시하지 않아요.
- **"서버를 깨우는 중" 안내**: API 응답이 1.5초 넘게 늦으면 화면 위쪽에 안내가 뜨고, 응답이 오면 내려가요. 깨어나는 동안 앞단이 502·503·504 를 주면 최대 1분 동안 잠시 뒤 다시 시도해요.

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

## 브라우저 테스트 (e2e)

[`e2e/`](e2e/) 의 Playwright 테스트가 진짜 서버를 상대로 로그인·회원가입·복구, 진행도 동기화(로그인 전 기록 옮기기·충돌 합치기), 허브(이어하기·랭킹), 과목 화면(정답 뒤 Enter·Tab, 선 아이콘)을 확인해요. 바깥 네트워크는 막고, Algorithm Quest 의 Java 실행기(CheerpJ)는 가짜(`e2e/fixtures/stub-cheerpj.js`)로 바꿔서 돌려요.

```bash
# 1) 서버 띄우기 (테스트가 계정을 많이 만들어서 가입 제한을 풀어요)
cd backend && ./gradlew bootJar && java -jar build/libs/dev-quest-0.0.1.jar --devquest.limits.signups-per-hour=100000
# 2) 다른 터미널에서
cd e2e && npm ci && npx playwright install chromium && npx playwright test
```

서버 주소가 다르면 `E2E_BASE_URL=http://localhost:8080` 처럼 알려 주세요.

## 자동 검증 (CI)

푸시와 PR 마다 GitHub Actions([`.github/workflows/validate.yml`](.github/workflows/validate.yml))가 JS 문법 검사, 퀘스트 카탈로그가 최신인지, Git Quest 시나리오 검증(`node git/tools/validate-scenarios.js`), Algorithm Quest 문제 검증(JDK 17), 백엔드 테스트(JDK 21 + Testcontainers), 배포 이미지 빌드·실행 확인(Docker), 브라우저 테스트(Playwright)를 돌려요.

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
