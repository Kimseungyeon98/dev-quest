# 🎮 Dev Quest

게임처럼 직접 입력하면서 개발 명령어를 익히는 학습 사이트 모음입니다. 빌드 과정 없이 `index.html` 을 열면 바로 동작해요.

| 과목 | 폴더 | 내용 |
|---|---|---|
| 🐧 Linux Quest | [`linux/`](linux/) | 가상 터미널로 배우는 서버 명령어 |
| 🗄️ SQL Quest | [`sql/`](sql/) | SQLite WASM 으로 배우는 실무 SQL |
| ⎇ Git Quest | [`git/`](git/) | 상황별 시나리오로 배우는 Git |
| 🧩 Algorithm Quest | [`algo/`](algo/) | Java 로 푸는 코딩테스트 알고리즘 |

과목은 서로 섞이지 않고 각자의 영역에서 공부해요. 루트의 `index.html` 은 과목 목록과 **종합 티어**를 보여 주는 허브예요.

## Algorithm Quest 실행하기

Algorithm Quest 는 브라우저 안의 JVM([CheerpJ](https://cheerpj.com/))으로 **진짜 Java 17** 코드를 컴파일하고 채점해요. CheerpJ 는 `file://` 주소에서 동작하지 않아서 웹 서버로 열어야 하고, 처음 열 때 Java 실행기를 내려받느라 인터넷 연결이 필요해요.

```bash
node algo/tools/serve.js
```

그다음 http://localhost:8000/ 을 열면 돼요 (GitHub Pages 같은 정적 호스팅에서도 그대로 동작해요).

- 문제 형식은 프로그래머스처럼 `class Solution` 의 `solution(...)` 메서드를 구현하는 방식이에요.
- "코드 실행"은 입출력 예만, "제출 후 채점하기"는 숨겨진 정확성 테스트와 큰 입력의 효율성 테스트까지 채점해요.
- 채점할 때는 반복문과 메서드 시작 부분에 시간 검사를 끼워 넣어서, 무한 루프나 너무 느린 풀이를 케이스당 제한 시간(기본 3초)에 끊어요.
- 문제는 [`algo/js/problems.js`](algo/js/problems.js) 에 있어요. 문제를 추가·수정한 뒤에는 로컬 JDK 17 이상으로 검증해 주세요. JS 참조 풀이와 자바 모범 답안이 같은 답을 내는지, 모범 답안이 모든 테스트를 통과하는지 확인해요.
  ```bash
  node algo/tools/validate-problems.js
  ```

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
   앱 코드에서는 `const bar = DevQuest.mountBar('docker')` 로 바를 만들고, 진행이 바뀔 때마다 `bar.update(DevQuest.stats(items, doneIds))` 를 호출해요. (`items` 는 `[{id, difficulty}]`, `difficulty` 는 `'easy'|'medium'|'hard'` 또는 1~5)
2. [`courses.js`](courses.js) 에 항목을 하나 추가해요. 이름·아이콘·소개는 여기서만 정하므로 허브와 과목 화면의 제목이 항상 같아요.
   - `storageKey` 와 `doneIds(saved)` : 앱이 저장한 진행 기록에서 완료한 퀘스트 id 를 꺼내는 방법
   - `scripts()` 와 `items()` : 허브가 데이터 파일만 불러와 퀘스트 목록을 직접 만드는 방법 (전체 문제 수를 손으로 적지 않아요)

## 기록

세 프로젝트(`linux-terminal-game`, `sql-query-lab`, `git-playbook`)의 파일을 각 폴더로 복사해서 하나의 저장소로 합쳤어요. 기존 저장소의 커밋 기록은 가져오지 않았고, 이 저장소의 이력은 합친 시점의 `first commit` 부터 시작해요. 이전 이력은 원래 폴더에서 확인할 수 있어요.
