# 🎮 Dev Quest

게임처럼 직접 입력하면서 개발 명령어를 익히는 학습 사이트 모음입니다. 빌드 과정 없이 `index.html` 을 열면 바로 동작해요.

| 과목 | 폴더 | 내용 |
|---|---|---|
| 🐧 Linux Quest | [`linux/`](linux/) | 가상 터미널로 배우는 리눅스 명령어 (미션 67개) |
| 🗄️ Query Lab | [`sql/`](sql/) | SQLite WASM 으로 배우는 실무 SQL (문제 36개) |
| ⎇ Git Playbook | [`git/`](git/) | 상황별 시나리오로 배우는 Git (시나리오 73개) |

루트의 `index.html` 은 과목 목록과 진행도를 보여 주는 허브예요.

## 새 과목 추가하기

1. 새 폴더(예: `docker/`)에 `index.html` 을 만들고, 상단 바에 허브 링크를 넣어 주세요.
   ```html
   <a href="../index.html" class="hub-link" title="Dev Quest 홈" aria-label="Dev Quest 홈으로">⌂</a>
   ```
2. [`courses.js`](courses.js) 에 항목을 하나 추가합니다. `storageKey` 는 다른 과목과 겹치지 않게 정해 주세요.
3. 기존 과목에 문제를 추가하면 `courses.js` 의 `total` 도 같이 올려 주세요.

## 기록

각 과목의 기존 저장소 커밋 기록은 `git subtree` 로 그대로 가져왔어요 (`git log -- linux/` 등으로 확인).
