/* Algorithm Quest 문제 데이터.
 * 허브(루트 index.html)가 문제 수를 세기 위해 이 파일만 불러와요. 채점 코드(judge.js)와 화면 코드(app.js)는 분리했어요.
 *
 * 문제 항목
 *  - method: 구현할 메서드 시그니처 (Judge.java 와 시작 코드를 여기서 만들어요)
 *  - examples: 화면에 보여 주는 예제 ({ args, expected })
 *  - tests: 숨겨진 정확성 테스트 (인자 배열, 또는 시드 난수 R 을 받아 인자 배열을 돌려주는 함수). 기댓값은 ref 로 계산해요.
 *  - big: 효율성 테스트 ({ label, gen(R) }) — 큰 입력에서 시간 안에 끝나는지 봐요
 *  - ref: 기댓값을 계산하는 JS 참조 풀이,  solution: 자바 모범 답안 (tools/validate-problems.js 가 둘이 같은 답을 내는지 검사해요) */
(function (root) {
  'use strict';

  const CATEGORIES = [
    { id: 'impl', icon: '🧮', label: '구현·문자열', desc: '문제를 그대로 코드로 옮기는 힘' },
    { id: 'hash', icon: '#️⃣', label: '해시', desc: 'HashMap·HashSet 으로 O(1) 조회' },
    { id: 'stack', icon: '📚', label: '스택·큐·덱', desc: 'ArrayDeque 로 순서를 관리하기' },
    { id: 'greedy', icon: '🎯', label: '정렬·그리디', desc: '정렬 기준을 세우고 매 순간 최선을 고르기' },
    { id: 'search', icon: '🔍', label: '이분 탐색', desc: '정렬된 데이터와 "답을 정해 놓고" 찾기' },
    { id: 'window', icon: '👉', label: '투 포인터·누적합', desc: '구간을 O(n) 으로 훑기' },
    { id: 'graph', icon: '🕸️', label: '그래프 탐색 (BFS·DFS)', desc: '연결 요소, 최단 칸 수' },
    { id: 'dp', icon: '🧠', label: '동적 계획법 (DP)', desc: '작은 문제의 답을 저장해 큰 문제 풀기' },
    { id: 'adv', icon: '🚀', label: '힙·최단 경로·MST', desc: 'PriorityQueue, 다익스트라, 위상 정렬, 크루스칼' },
    { id: 'brute', icon: '🔁', label: '완전 탐색·백트래킹', desc: '모든 경우를 빠짐없이, 가지치기로 빠르게' },
  ];

  /* ---------- 참조 풀이용 작은 도우미 ---------- */
  class MinHeap {
    constructor(less) { this.a = []; this.less = less || ((x, y) => x < y); }
    get size() { return this.a.length; }
    push(v) {
      const a = this.a; a.push(v);
      let i = a.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (!this.less(a[i], a[p])) break; [a[i], a[p]] = [a[p], a[i]]; i = p; }
    }
    pop() {
      const a = this.a; const top = a[0]; const last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1; let m = i;
          if (l < a.length && this.less(a[l], a[m])) m = l;
          if (r < a.length && this.less(a[r], a[m])) m = r;
          if (m === i) break;
          [a[i], a[m]] = [a[m], a[i]]; i = m;
        }
      }
      return top;
    }
  }
  const range = (n) => Array.from({ length: n }, (_, i) => i);
  const LOWER = 'abcdefghijklmnopqrstuvwxyz';

  const PROBLEMS = [
    /* ================= 구현·문자열 ================= */
    {
      id: 'impl-reverse-words', category: 'impl', difficulty: 'easy', title: '로그 문장 뒤집기',
      desc: '서버 로그 분석기가 문장을 거꾸로 읽어야 해요. 문장 `s` 의 **단어 순서**를 뒤집은 문자열을 return 하세요.\n\n'
        + '단어는 공백으로 구분돼요. `s` 의 앞뒤에 공백이 있거나 단어 사이에 공백이 여러 개 있을 수 있지만, 결과에서는 단어 사이에 공백을 **하나만** 두고 앞뒤 공백은 없애야 해요.',
      constraints: ['1 ≤ `s` 의 길이 ≤ 200,000', '`s` 는 영어 소문자와 공백으로만 이루어져 있고, 단어가 하나 이상 있어요.'],
      method: { name: 'solution', ret: 'String', params: [{ type: 'String', name: 's' }] },
      examples: [
        { args: ['  hello   dev quest '], expected: 'quest dev hello' },
        { args: ['java'], expected: 'java' },
      ],
      tests: [['a b'], [' x '], ['one two three four'], ['   spaced     out   words  ']],
      big: [{
        label: '길이 약 200,000', gen: (R) => {
          let s = ' ';
          while (s.length < 199980) s += R.str(R.int(1, 8), LOWER) + ' '.repeat(R.int(1, 3));
          return [s];
        },
      }],
      ref: (s) => s.trim().split(/\s+/).reverse().join(' '),
      hints: [
        '`s.trim().split("\\\\s+")` 로 앞뒤 공백을 지우고 "공백 한 개 이상" 기준으로 나눌 수 있어요.',
        '문자열에 `+=` 를 반복하면 매번 새 문자열을 만들어서 O(n²) 이 돼요. `StringBuilder` 를 쓰세요.',
      ],
      concept: '자바의 `String` 은 불변(immutable)이라 `answer += word` 는 매번 전체를 복사해요. 결과가 길어질수록 느려지므로, 문자열을 여러 번 이어 붙일 때는 `StringBuilder.append()` 가 기본이에요.',
      solution: String.raw`import java.util.*;

class Solution {
    public String solution(String s) {
        String[] words = s.trim().split("\\s+");
        StringBuilder sb = new StringBuilder();
        for (int i = words.length - 1; i >= 0; i--) {
            sb.append(words[i]);
            if (i > 0) sb.append(' ');
        }
        return sb.toString();
    }
}
`,
      explain: '`trim()` + 정규식 `\\s+` 로 단어만 뽑고, 뒤에서부터 `StringBuilder` 에 붙여요. O(n).',
    },
    {
      id: 'impl-max-profit', category: 'impl', difficulty: 'easy', title: '서버 비용 최저가에 사서 팔기',
      desc: '클라우드 예약 인스턴스의 날짜별 가격 `prices` 가 주어져요. 어느 하루에 한 번 사고, 그 **이후** 어느 하루에 한 번 팔 때 얻을 수 있는 최대 이익을 return 하세요. 이익을 낼 수 없으면 0 을 return 해요.',
      constraints: ['1 ≤ `prices` 의 길이 ≤ 100,000', '1 ≤ `prices[i]` ≤ 10,000'],
      method: { name: 'solution', ret: 'int', params: [{ type: 'int[]', name: 'prices' }] },
      examples: [
        { args: [[7, 1, 5, 3, 6, 4]], expected: 5 },
        { args: [[7, 6, 4, 3, 1]], expected: 0 },
      ],
      tests: [[[5]], [[1, 2]], [[2, 1]], [[3, 3, 3]], [[2, 4, 1, 7]], (R) => [R.arr(50, 1, 100)], (R) => [R.arr(200, 1, 10000)]],
      big: [{ label: 'n = 100,000', gen: (R) => [R.arr(100000, 1, 10000)] }],
      ref: (prices) => { let min = Infinity, best = 0; for (const p of prices) { min = Math.min(min, p); best = Math.max(best, p - min); } return best; },
      hints: [
        '모든 (사는 날, 파는 날) 쌍을 보면 O(n²) 이라 n = 100,000 에서는 너무 느려요.',
        '왼쪽에서 오른쪽으로 가면서 "지금까지 본 최저가"만 기억하면, 오늘 팔 때의 최대 이익을 바로 알 수 있어요.',
      ],
      concept: '"지금까지의 최솟값"처럼 앞에서 계산한 값을 변수 하나에 들고 가면 이중 반복문을 단일 반복문으로 줄일 수 있어요. 코딩테스트에서 가장 자주 쓰는 최적화예요.',
      solution: String.raw`class Solution {
    public int solution(int[] prices) {
        int minPrice = Integer.MAX_VALUE, best = 0;
        for (int p : prices) {
            minPrice = Math.min(minPrice, p);
            best = Math.max(best, p - minPrice);
        }
        return best;
    }
}
`,
      explain: '한 번 훑으면서 최저가를 갱신하고, 오늘 가격 − 최저가로 최대 이익을 갱신해요. O(n).',
    },
    {
      id: 'impl-rotate', category: 'impl', difficulty: 'easy', title: '대시보드 위젯 90도 회전',
      desc: '대시보드의 위젯 배치를 나타내는 2차원 배열 `board` 를 **시계 방향으로 90도** 회전한 배열을 return 하세요. `board` 는 정사각형이 아닐 수도 있어요 (n × m 이면 결과는 m × n).',
      constraints: ['1 ≤ `board` 의 행/열 개수 ≤ 100', '-1,000 ≤ `board[i][j]` ≤ 1,000'],
      method: { name: 'solution', ret: 'int[][]', params: [{ type: 'int[][]', name: 'board' }] },
      examples: [
        { args: [[[1, 2, 3], [4, 5, 6]]], expected: [[4, 1], [5, 2], [6, 3]] },
        { args: [[[1, 2], [3, 4]]], expected: [[3, 1], [4, 2]] },
      ],
      tests: [[[[7]]], [[[1], [2], [3]]], [[[1, 2, 3, 4]]], (R) => [range(5).map(() => R.arr(7, -1000, 1000))], (R) => [range(100).map(() => R.arr(100, -1000, 1000))]],
      ref: (b) => { const n = b.length, m = b[0].length; const r = range(m).map(() => new Array(n)); for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) r[j][n - 1 - i] = b[i][j]; return r; },
      hints: [
        '결과 배열의 크기는 `new int[m][n]` 이에요 (행과 열이 바뀌어요).',
        '원래 `(i, j)` 칸은 회전 후 `(j, n - 1 - i)` 로 가요. 작은 예제로 손으로 확인해 보세요.',
      ],
      concept: '2차원 배열 문제는 "좌표가 어디로 가는가"를 식으로 세우는 게 핵심이에요. 회전·대칭·전치는 코딩테스트 구현 문제에 자주 섞여 나와요.',
      solution: String.raw`class Solution {
    public int[][] solution(int[][] board) {
        int n = board.length, m = board[0].length;
        int[][] answer = new int[m][n];
        for (int i = 0; i < n; i++)
            for (int j = 0; j < m; j++)
                answer[j][n - 1 - i] = board[i][j];
        return answer;
    }
}
`,
      explain: '`answer[j][n - 1 - i] = board[i][j]` 한 줄이 회전의 전부예요.',
    },
    {
      id: 'impl-spiral', category: 'impl', difficulty: 'medium', title: '달팽이 모양 좌석 배치',
      desc: '세미나실 n × n 좌석에 1 번부터 n² 번까지 번호를 붙여요. 왼쪽 위에서 시작해 **오른쪽 → 아래 → 왼쪽 → 위** 순서로, 벽이나 이미 번호가 붙은 칸을 만나면 시계 방향으로 꺾으며 채워요. 완성된 배치를 return 하세요.',
      constraints: ['1 ≤ `n` ≤ 100'],
      method: { name: 'solution', ret: 'int[][]', params: [{ type: 'int', name: 'n' }] },
      examples: [
        { args: [3], expected: [[1, 2, 3], [8, 9, 4], [7, 6, 5]] },
        { args: [1], expected: [[1]] },
      ],
      tests: [[2], [4], [5], [10], [100]],
      ref: (n) => {
        const a = range(n).map(() => new Array(n).fill(0)); const dr = [0, 1, 0, -1], dc = [1, 0, -1, 0];
        let r = 0, c = 0, d = 0;
        for (let v = 1; v <= n * n; v++) {
          a[r][c] = v;
          let nr = r + dr[d], nc = c + dc[d];
          if (nr < 0 || nr >= n || nc < 0 || nc >= n || a[nr][nc] !== 0) { d = (d + 1) % 4; nr = r + dr[d]; nc = c + dc[d]; }
          r = nr; c = nc;
        }
        return a;
      },
      hints: [
        '방향을 배열로 두세요: `int[] dr = {0, 1, 0, -1}, dc = {1, 0, -1, 0};`',
        '다음 칸이 범위를 벗어나거나 이미 채워졌으면 `d = (d + 1) % 4` 로 방향을 바꿔요.',
      ],
      concept: '방향 배열(dr, dc)은 격자 이동 문제의 기본 도구예요. if 문을 네 번 쓰는 대신 인덱스 하나로 방향을 바꿀 수 있어요.',
      solution: String.raw`class Solution {
    public int[][] solution(int n) {
        int[][] answer = new int[n][n];
        int[] dr = {0, 1, 0, -1}, dc = {1, 0, -1, 0};
        int r = 0, c = 0, d = 0;
        for (int v = 1; v <= n * n; v++) {
            answer[r][c] = v;
            int nr = r + dr[d], nc = c + dc[d];
            if (nr < 0 || nr >= n || nc < 0 || nc >= n || answer[nr][nc] != 0) {
                d = (d + 1) % 4;
                nr = r + dr[d];
                nc = c + dc[d];
            }
            r = nr;
            c = nc;
        }
        return answer;
    }
}
`,
      explain: '칸을 채운 뒤 다음 칸을 미리 보고, 막혀 있으면 방향을 꺾어요.',
    },

    /* ================= 해시 ================= */
    {
      id: 'hash-two-sum', category: 'hash', difficulty: 'easy', title: '합이 맞는 두 주문 찾기',
      desc: '정산 담당자가 금액 합이 정확히 `target` 이 되는 주문 두 개를 찾고 있어요. 주문 금액 배열 `nums` 에서 합이 `target` 인 두 원소의 인덱스 `[i, j]` (i < j) 를 return 하세요. 답은 **정확히 하나** 있어요.',
      constraints: ['2 ≤ `nums` 의 길이 ≤ 100,000', '-1,000,000,000 ≤ `nums[i]`, `target` ≤ 1,000,000,000', '같은 원소를 두 번 쓸 수 없어요.'],
      method: { name: 'solution', ret: 'int[]', params: [{ type: 'int[]', name: 'nums' }, { type: 'int', name: 'target' }] },
      examples: [
        { args: [[2, 7, 11, 15], 9], expected: [0, 1] },
        { args: [[3, 2, 4], 6], expected: [1, 2] },
        { args: [[3, 3], 6], expected: [0, 1] },
      ],
      tests: [[[1, 5], 6], [[-3, 4, 3, 90], 0], [[0, 4, 3, 0], 0], [[5, 75, 25], 100], [[1000000000, -999999993, 5], 7]],
      big: [{
        label: 'n = 100,000', gen: (R) => {
          const n = 100000;
          const nums = R.shuffle(range(2 * n).map((x) => x + 1)).slice(0, n).map((x) => x * 4);
          const i = R.int(0, n / 2), j = R.int(n / 2 + 1, n - 1);
          nums[i] = 4 * R.int(1, 100000) + 1; nums[j] = 4 * R.int(1, 100000) + 1;
          return [nums, nums[i] + nums[j]];
        },
      }],
      ref: (nums, target) => { const seen = new Map(); for (let i = 0; i < nums.length; i++) { if (seen.has(target - nums[i])) return [seen.get(target - nums[i]), i]; seen.set(nums[i], i); } return []; },
      hints: [
        '이중 반복문은 O(n²) — 100,000 개면 50억 번 비교라 시간 초과예요.',
        '`nums[i]` 를 볼 때 "짝꿍 `target - nums[i]` 를 이미 봤는가?"를 `HashMap<값, 인덱스>` 로 O(1) 에 확인하세요.',
      ],
      concept: '`HashMap` 의 `get/put/containsKey` 는 평균 O(1) 이에요. "앞에서 본 값 중에 ~가 있었나?"라는 질문이 보이면 해시를 떠올리세요.',
      solution: String.raw`import java.util.*;

class Solution {
    public int[] solution(int[] nums, int target) {
        Map<Integer, Integer> seen = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            Integer j = seen.get(target - nums[i]);
            if (j != null) return new int[]{j, i};
            seen.put(nums[i], i);
        }
        return new int[0];
    }
}
`,
      explain: '한 번 훑으면서 짝꿍이 이미 맵에 있는지 확인하고, 없으면 자신을 넣어요. O(n).',
    },
    {
      id: 'hash-anagram-groups', category: 'hash', difficulty: 'medium', title: '애너그램 태그 묶기',
      desc: '블로그 태그 중에서 글자 구성이 같은 것(애너그램)은 같은 그룹으로 묶으려고 해요. 예를 들어 `"eat"`, `"tea"`, `"ate"` 는 한 그룹이에요. 태그 배열 `words` 를 묶었을 때 **그룹의 개수**를 return 하세요.',
      constraints: ['1 ≤ `words` 의 길이 ≤ 100,000', '1 ≤ `words[i]` 의 길이 ≤ 10, 영어 소문자'],
      method: { name: 'solution', ret: 'int', params: [{ type: 'String[]', name: 'words' }] },
      examples: [
        { args: [['eat', 'tea', 'tan', 'ate', 'nat', 'bat']], expected: 3 },
        { args: [['a']], expected: 1 },
      ],
      tests: [[['ab', 'ba', 'ab']], [['abc', 'abd', 'bca', 'dab']], [['aa', 'a', 'aaa']], (R) => [range(300).map(() => R.str(R.int(1, 4), 'abc'))]],
      big: [{ label: 'n = 100,000', gen: (R) => [range(100000).map(() => R.str(R.int(1, 8), 'abcdef'))] }],
      ref: (words) => new Set(words.map((w) => w.split('').sort().join(''))).size,
      hints: [
        '두 단어가 애너그램인지는 글자를 **정렬**해 보면 알 수 있어요: `"tea"` → `"aet"`.',
        '정렬한 문자열을 `HashSet` 에 넣으면 서로 다른 그룹의 수가 곧 set 의 크기예요.',
      ],
      concept: '해시의 "키"를 잘 고르는 게 핵심이에요. 같은 그룹이면 같은 키가 나오도록 정규화(여기서는 정렬)하면 그룹 묶기가 O(n) 에 가까워져요.',
      solution: String.raw`import java.util.*;

class Solution {
    public int solution(String[] words) {
        Set<String> groups = new HashSet<>();
        for (String w : words) {
            char[] cs = w.toCharArray();
            Arrays.sort(cs);
            groups.add(new String(cs));
        }
        return groups.size();
    }
}
`,
      explain: '각 단어를 정렬한 문자열을 키로 삼아 HashSet 에 넣어요.',
    },
    {
      id: 'hash-subarray-sum', category: 'hash', difficulty: 'medium', title: '목표 트래픽 구간 세기',
      desc: '분 단위 트래픽 변화량 배열 `nums` 가 있어요. 합이 정확히 `k` 인 **연속 구간**의 개수를 return 하세요. 변화량은 음수일 수도 있어요.',
      constraints: ['1 ≤ `nums` 의 길이 ≤ 100,000', '-1,000 ≤ `nums[i]` ≤ 1,000', '-100,000,000 ≤ `k` ≤ 100,000,000', '답이 int 범위를 넘을 수 있어요.'],
      method: { name: 'solution', ret: 'long', params: [{ type: 'int[]', name: 'nums' }, { type: 'int', name: 'k' }] },
      examples: [
        { args: [[1, 1, 1], 2], expected: 2 },
        { args: [[1, 2, 3], 3], expected: 2 },
      ],
      tests: [[[0], 0], [[5], 3], [[1, -1, 0], 0], [[3, 4, 7, 2, -3, 1, 4, 2], 7], (R) => [R.arr(300, -5, 5), 3]],
      big: [
        { label: 'n = 100,000 (무작위)', gen: (R) => [R.arr(100000, -10, 10), 5] },
        { label: 'n = 100,000 (전부 0)', gen: () => [new Array(100000).fill(0), 0] },
      ],
      ref: (nums, k) => { const cnt = new Map([[0, 1]]); let sum = 0, ans = 0; for (const x of nums) { sum += x; ans += cnt.get(sum - k) || 0; cnt.set(sum, (cnt.get(sum) || 0) + 1); } return ans; },
      hints: [
        '누적합 `prefix[j] - prefix[i] = k` 인 (i < j) 쌍의 개수를 세는 문제로 바꿀 수 있어요.',
        '지금까지 나온 누적합의 등장 횟수를 `HashMap<Long, Integer>` 에 세어 두면, 현재 누적합 `sum` 에서 `sum - k` 가 몇 번 나왔는지 바로 알 수 있어요.',
        '전부 0 이고 k = 0 이면 구간 수가 약 50억 개예요 — 답은 `long` 으로!',
      ],
      concept: '"연속 구간의 합"은 누적합의 차이로 바꾸는 게 정석이에요. 음수가 섞여 있으면 투 포인터가 안 통하므로, 누적합 + 해시맵 조합을 써요.',
      solution: String.raw`import java.util.*;

class Solution {
    public long solution(int[] nums, int k) {
        Map<Long, Integer> count = new HashMap<>();
        count.put(0L, 1);
        long sum = 0, answer = 0;
        for (int x : nums) {
            sum += x;
            answer += count.getOrDefault(sum - k, 0);
            count.merge(sum, 1, Integer::sum);
        }
        return answer;
    }
}
`,
      explain: '누적합을 진행하면서 "sum - k 가 이전에 몇 번 나왔나"를 더해요. O(n).',
    },

    /* ================= 스택·큐·덱 ================= */
    {
      id: 'stack-brackets', category: 'stack', difficulty: 'easy', title: '설정 파일 괄호 검사',
      desc: 'JSON 비슷한 설정 파일에서 괄호만 뽑아 낸 문자열 `s` 가 있어요. `()`, `[]`, `{}` 가 올바르게 짝지어져 있으면 `true`, 아니면 `false` 를 return 하세요. 올바르다는 건 여는 괄호가 같은 종류의 닫는 괄호로, 올바른 순서로 닫힌다는 뜻이에요.',
      constraints: ['1 ≤ `s` 의 길이 ≤ 200,000', '`s` 는 `()[]{}` 로만 이루어져 있어요.'],
      method: { name: 'solution', ret: 'boolean', params: [{ type: 'String', name: 's' }] },
      examples: [
        { args: ['([]){}'], expected: true },
        { args: ['([)]'], expected: false },
        { args: ['(('], expected: false },
      ],
      tests: [[')'], ['()'], ['{[()()]}'], ['((())'], ['}{'], ['[](){}[]'], ['[[[]]]]']],
      big: [
        {
          label: '길이 200,000 (올바름)', gen: (R) => {
            const n = 200000, open = '([{', close = ')]}'; const st = []; let s = '';
            for (let i = 0; i < n; i++) {
              if (st.length === n - i || (st.length && R.next() < 0.5)) s += close[st.pop()];
              else { const t = R.int(0, 2); st.push(t); s += open[t]; }
            }
            return [s];
          },
        },
        { label: '길이 200,000 (마지막만 틀림)', gen: () => ['('.repeat(100000) + ')'.repeat(99999) + ']'] },
      ],
      ref: (s) => { const st = []; const pair = { ')': '(', ']': '[', '}': '{' }; for (const c of s) { if ('([{'.includes(c)) st.push(c); else if (st.pop() !== pair[c]) return false; } return st.length === 0; },
      hints: [
        '여는 괄호는 스택에 넣고, 닫는 괄호가 오면 스택 맨 위가 같은 종류인지 확인해요.',
        '자바에서는 `Stack` 대신 `Deque<Character> stack = new ArrayDeque<>();` 의 `push/pop/peek` 를 쓰는 게 권장돼요.',
        '`replace("()", "")` 를 반복하는 방식은 O(n²) 이라 긴 입력에서 느려요.',
      ],
      concept: '가장 최근에 열린 것이 가장 먼저 닫혀야 하는 구조(LIFO)는 스택이에요. 괄호, 실행 취소, 함수 호출 등이 모두 같은 원리예요.',
      solution: String.raw`import java.util.*;

class Solution {
    public boolean solution(String s) {
        Deque<Character> stack = new ArrayDeque<>();
        for (char c : s.toCharArray()) {
            if (c == '(' || c == '[' || c == '{') {
                stack.push(c);
            } else {
                if (stack.isEmpty()) return false;
                char open = stack.pop();
                if ((c == ')' && open != '(') || (c == ']' && open != '[') || (c == '}' && open != '{')) return false;
            }
        }
        return stack.isEmpty();
    }
}
`,
      explain: '닫는 괄호마다 스택 맨 위와 짝을 맞추고, 끝났을 때 스택이 비어 있어야 해요.',
    },
    {
      id: 'stack-next-greater', category: 'stack', difficulty: 'medium', title: '다음 고점 알림',
      desc: '주가 알림 서비스는 각 날짜마다 "오른쪽으로 가장 먼저 나오는 더 높은 가격"을 보여 줘요. 배열 `nums` 의 각 원소에 대해, 오른쪽에서 처음으로 나오는 **자신보다 큰 수**를 담은 배열을 return 하세요. 그런 수가 없으면 -1 이에요.',
      constraints: ['1 ≤ `nums` 의 길이 ≤ 100,000', '1 ≤ `nums[i]` ≤ 1,000,000'],
      method: { name: 'solution', ret: 'int[]', params: [{ type: 'int[]', name: 'nums' }] },
      examples: [
        { args: [[3, 5, 2, 7]], expected: [5, 7, 7, -1] },
        { args: [[9, 5, 4, 8]], expected: [-1, 8, 8, -1] },
      ],
      tests: [[[1]], [[2, 2, 2]], [[1, 2, 3, 4]], [[4, 3, 2, 1]], (R) => [R.arr(200, 1, 20)]],
      big: [
        { label: 'n = 100,000 (내림차순)', gen: () => [range(100000).map((i) => 1000000 - i)] },
        { label: 'n = 100,000 (무작위)', gen: (R) => [R.arr(100000, 1, 1000000)] },
      ],
      ref: (nums) => { const ans = new Array(nums.length).fill(-1); const st = []; nums.forEach((x, i) => { while (st.length && nums[st[st.length - 1]] < x) ans[st.pop()] = x; st.push(i); }); return ans; },
      hints: [
        '각 원소마다 오른쪽을 다 훑으면 내림차순 입력에서 O(n²) 이에요.',
        '"아직 답(더 큰 수)을 못 찾은 인덱스"를 스택에 쌓아 두세요. 새 수가 스택 맨 위 값보다 크면, 그 인덱스의 답이 바로 새 수예요.',
      ],
      concept: '단조 스택(monotonic stack): 스택 안의 값이 항상 내림차순이 되도록 유지하면 "다음 큰 수", "히스토그램 최대 직사각형" 같은 문제를 O(n) 에 풀 수 있어요. 각 인덱스는 한 번 들어가고 한 번 나오니까요.',
      solution: String.raw`import java.util.*;

class Solution {
    public int[] solution(int[] nums) {
        int n = nums.length;
        int[] answer = new int[n];
        Arrays.fill(answer, -1);
        Deque<Integer> stack = new ArrayDeque<>(); // 아직 답을 못 찾은 인덱스
        for (int i = 0; i < n; i++) {
            while (!stack.isEmpty() && nums[stack.peek()] < nums[i]) {
                answer[stack.pop()] = nums[i];
            }
            stack.push(i);
        }
        return answer;
    }
}
`,
      explain: '새 값이 들어올 때 자기보다 작은 스택 원소들의 답을 확정하고 꺼내요. 총 O(n).',
    },
    {
      id: 'stack-josephus', category: 'stack', difficulty: 'medium', title: '원형 테이블 발표 순서',
      desc: '1 번부터 `n` 번까지 개발자가 원형 테이블에 앉아 있어요. 1 번부터 세기 시작해 `k` 번째 사람이 발표하고 자리를 떠나요. 그다음 사람부터 다시 세어 `k` 번째 사람이 발표해요. 모두 발표할 때까지 반복할 때 **발표 순서**를 return 하세요.',
      constraints: ['1 ≤ `n` ≤ 1,000', '1 ≤ `k` ≤ 1,000'],
      method: { name: 'solution', ret: 'int[]', params: [{ type: 'int', name: 'n' }, { type: 'int', name: 'k' }] },
      examples: [
        { args: [7, 3], expected: [3, 6, 2, 7, 5, 1, 4] },
        { args: [3, 1], expected: [1, 2, 3] },
      ],
      tests: [[1, 1], [1, 5], [5, 2], [10, 10], [6, 7], [1000, 1000], [1000, 1]],
      ref: (n, k) => { const a = range(n).map((i) => i + 1); const out = []; let idx = 0; while (a.length) { idx = (idx + k - 1) % a.length; out.push(a.splice(idx, 1)[0]); } return out; },
      hints: [
        '큐에 1..n 을 넣고, 앞에서 k - 1 명을 꺼내 뒤에 다시 넣은 다음, k 번째를 꺼내면 그 사람이 발표자예요.',
        '자바 큐: `Deque<Integer> q = new ArrayDeque<>(); q.offer(x); q.poll();`',
      ],
      concept: '원형 구조는 "앞에서 꺼내 뒤에 넣는" 큐로 흉내 낼 수 있어요. 순서대로 처리되는 작업(프린터, 요청 대기열) 시뮬레이션의 기본기예요.',
      solution: String.raw`import java.util.*;

class Solution {
    public int[] solution(int n, int k) {
        Deque<Integer> queue = new ArrayDeque<>();
        for (int i = 1; i <= n; i++) queue.offer(i);
        int[] answer = new int[n];
        int idx = 0;
        while (!queue.isEmpty()) {
            for (int i = 0; i < k - 1; i++) queue.offer(queue.poll());
            answer[idx++] = queue.poll();
        }
        return answer;
    }
}
`,
      explain: 'k - 1 명을 뒤로 돌리고 k 번째를 꺼내는 걸 n 번 반복해요. O(n·k).',
    },
    {
      id: 'stack-sliding-max', category: 'stack', difficulty: 'hard', title: '구간별 최대 CPU 사용률',
      desc: '초 단위 CPU 사용률 `nums` 에서, 길이 `k` 인 구간을 한 칸씩 밀면서 각 구간의 **최댓값**을 구해 배열로 return 하세요. 결과의 길이는 `nums.length - k + 1` 이에요.',
      constraints: ['1 ≤ `k` ≤ `nums` 의 길이 ≤ 100,000', '-10,000 ≤ `nums[i]` ≤ 10,000'],
      method: { name: 'solution', ret: 'int[]', params: [{ type: 'int[]', name: 'nums' }, { type: 'int', name: 'k' }] },
      examples: [
        { args: [[1, 3, -1, -3, 5, 3, 6, 7], 3], expected: [3, 3, 5, 5, 6, 7] },
        { args: [[4, 2], 1], expected: [4, 2] },
      ],
      tests: [[[5], 1], [[1, 2, 3, 4, 5], 5], [[9, 8, 7, 6, 5], 2], [[2, 2, 2, 2], 3], (R) => [R.arr(300, -50, 50), 17]],
      big: [{ label: 'n = 100,000, k = 5,000', gen: (R) => [R.arr(100000, -10000, 10000), 5000] }],
      ref: (nums, k) => { const out = [], dq = []; let h = 0; for (let i = 0; i < nums.length; i++) { while (dq.length > h && dq[h] <= i - k) h++; while (dq.length > h && nums[dq[dq.length - 1]] <= nums[i]) dq.pop(); dq.push(i); if (i >= k - 1) out.push(nums[dq[h]]); } return out; },
      hints: [
        '구간마다 k 개를 다 보면 O(n·k) = 5억 번이에요.',
        '덱(Deque)에 인덱스를 넣되, 값이 **내림차순**이 되도록 뒤쪽의 작은 값들을 버리세요. 그러면 덱의 맨 앞이 항상 현재 구간의 최댓값이에요.',
        '맨 앞 인덱스가 구간을 벗어났으면(`<= i - k`) 앞에서 꺼내요.',
      ],
      concept: '단조 덱(monotonic deque)은 "이동하는 구간의 최댓값/최솟값"을 O(n) 에 구하는 도구예요. 덱은 양쪽 끝에서 넣고 뺄 수 있어서 `ArrayDeque` 의 `offerLast/pollFirst/peekLast` 를 함께 써요.',
      solution: String.raw`import java.util.*;

class Solution {
    public int[] solution(int[] nums, int k) {
        int n = nums.length;
        int[] answer = new int[n - k + 1];
        Deque<Integer> dq = new ArrayDeque<>(); // 값이 내림차순인 인덱스들
        for (int i = 0; i < n; i++) {
            while (!dq.isEmpty() && dq.peekFirst() <= i - k) dq.pollFirst();
            while (!dq.isEmpty() && nums[dq.peekLast()] <= nums[i]) dq.pollLast();
            dq.offerLast(i);
            if (i >= k - 1) answer[i - k + 1] = nums[dq.peekFirst()];
        }
        return answer;
    }
}
`,
      explain: '덱의 앞은 구간 밖 인덱스를, 뒤는 새 값보다 작은 값을 버려요. 각 인덱스가 한 번씩 들어가고 나와서 O(n).',
    },

    /* ================= 정렬·그리디 ================= */
    {
      id: 'greedy-largest-number', category: 'greedy', difficulty: 'medium', title: '가장 큰 버전 번호 만들기',
      desc: '숫자 조각 배열 `numbers` 를 원하는 순서로 이어 붙여 만들 수 있는 **가장 큰 수**를 문자열로 return 하세요. 예를 들어 `[6, 10, 2]` 로는 `"6102"`, `"6210"`, `"1062"` … 를 만들 수 있고 가장 큰 수는 `"6210"` 이에요.',
      constraints: ['1 ≤ `numbers` 의 길이 ≤ 10,000', '0 ≤ `numbers[i]` ≤ 1,000', '답이 매우 클 수 있어서 문자열로 return 해요.'],
      method: { name: 'solution', ret: 'String', params: [{ type: 'int[]', name: 'numbers' }] },
      examples: [
        { args: [[6, 10, 2]], expected: '6210' },
        { args: [[3, 30, 34, 5, 9]], expected: '9534330' },
      ],
      tests: [[[0, 0, 0]], [[0]], [[10, 2]], [[1000, 100, 10, 1]], [[121, 12]], [[0, 0, 1]], (R) => [R.arr(100, 0, 1000)]],
      big: [{ label: 'n = 10,000', gen: (R) => [R.arr(10000, 0, 1000)] }],
      limitMs: 6000, // 문자열을 이어 붙여 비교하는 정렬이라 브라우저 JVM 에서 느린 편이에요
      ref: (numbers) => { const a = numbers.map(String).sort((x, y) => ((y + x) < (x + y) ? -1 : (y + x) > (x + y) ? 1 : 0)); return a[0] === '0' ? '0' : a.join(''); },
      hints: [
        '그냥 내림차순 정렬하면 `[3, 30]` 에서 `"303"` 이 나와요. 정답은 `"330"` 이에요.',
        '두 조각 a, b 중 누가 앞에 와야 하는지는 `a + b` 와 `b + a` 를 비교하면 알 수 있어요: `Arrays.sort(arr, (a, b) -> (b + a).compareTo(a + b));`',
        '모두 0 이면 `"000"` 이 아니라 `"0"` 이에요.',
      ],
      concept: '그리디의 핵심은 "정렬 기준"을 찾는 거예요. 자바에서는 `Comparator` 람다로 임의의 기준을 줄 수 있어요. 기본형 `int[]` 는 Comparator 를 못 쓰니 `String[]`/`Integer[]` 로 바꿔서 정렬해요.',
      solution: String.raw`import java.util.*;

class Solution {
    public String solution(int[] numbers) {
        String[] arr = new String[numbers.length];
        for (int i = 0; i < numbers.length; i++) arr[i] = String.valueOf(numbers[i]);
        Arrays.sort(arr, (a, b) -> (b + a).compareTo(a + b));
        if (arr[0].equals("0")) return "0";
        StringBuilder sb = new StringBuilder();
        for (String s : arr) sb.append(s);
        return sb.toString();
    }
}
`,
      explain: '`b + a` 와 `a + b` 를 비교하는 Comparator 로 정렬하고, 맨 앞이 "0" 이면 전부 0 이에요.',
    },
    {
      id: 'greedy-meetings', category: 'greedy', difficulty: 'medium', title: '회의실 하나로 최대한 많이',
      desc: '회의실이 하나뿐이에요. 회의 목록 `meetings` 의 각 원소는 `[시작, 끝]` 이고, 한 회의가 끝나는 시각에 바로 다음 회의를 시작할 수 있어요. 겹치지 않게 진행할 수 있는 회의의 **최대 개수**를 return 하세요. 시작과 끝이 같은 회의도 있을 수 있어요.',
      constraints: ['1 ≤ `meetings` 의 길이 ≤ 100,000', '0 ≤ 시작 ≤ 끝 ≤ 1,000,000,000'],
      method: { name: 'solution', ret: 'int', params: [{ type: 'int[][]', name: 'meetings' }] },
      examples: [
        { args: [[[1, 4], [3, 5], [0, 6], [5, 7], [3, 8], [5, 9], [6, 10], [8, 11], [8, 12], [2, 13], [12, 14]]], expected: 4 },
        { args: [[[1, 2], [2, 2], [2, 3]]], expected: 3 },
      ],
      tests: [[[[0, 10]]], [[[1, 3], [2, 4], [3, 5]]], [[[5, 5], [5, 5], [1, 5]]], [[[0, 1000000000], [1, 2]]], (R) => [range(200).map(() => { const s = R.int(0, 100); return [s, s + R.int(0, 20)]; })]],
      big: [{ label: 'n = 100,000', gen: (R) => [range(100000).map(() => { const s = R.int(0, 999000000); return [s, s + R.int(0, 1000000)]; })] }],
      ref: (ms) => { const a = ms.slice().sort((x, y) => x[1] - y[1] || x[0] - y[0]); let cnt = 0, end = -Infinity; for (const [s, e] of a) if (s >= end) { cnt++; end = e; } return cnt; },
      hints: [
        '**끝나는 시각이 빠른 회의**부터 고르면 남은 시간이 가장 많이 남아요.',
        '끝나는 시각이 같으면 시작이 빠른 것부터 — `[2,2]` 같은 회의를 놓치지 않게 해요.',
        '2차원 배열 정렬: `Arrays.sort(meetings, (a, b) -> a[1] != b[1] ? Integer.compare(a[1], b[1]) : Integer.compare(a[0], b[0]));`',
      ],
      concept: '활동 선택 문제(Activity Selection)는 "끝나는 시각 기준 정렬"이 최적임이 증명된 대표 그리디예요. 비교할 때 `a[1] - b[1]` 처럼 빼면 큰 값에서 오버플로가 날 수 있으니 `Integer.compare` 를 쓰세요.',
      solution: String.raw`import java.util.*;

class Solution {
    public int solution(int[][] meetings) {
        Arrays.sort(meetings, (a, b) -> a[1] != b[1] ? Integer.compare(a[1], b[1]) : Integer.compare(a[0], b[0]));
        int count = 0;
        long end = Long.MIN_VALUE;
        for (int[] m : meetings) {
            if (m[0] >= end) {
                count++;
                end = m[1];
            }
        }
        return count;
    }
}
`,
      explain: '끝나는 시각(같으면 시작 시각) 순으로 정렬한 뒤, 이전 회의가 끝난 뒤 시작하는 회의를 차례로 골라요. O(n log n).',
    },
    {
      id: 'greedy-boats', category: 'greedy', difficulty: 'medium', title: '서버 랙에 장비 싣기',
      desc: '이삿짐 트럭의 각 칸에는 장비를 **최대 2개**까지, 무게 합이 `limit` 이하가 되도록 실을 수 있어요. 장비 무게 배열 `weights` 를 모두 싣는 데 필요한 **칸 수의 최솟값**을 return 하세요.',
      constraints: ['1 ≤ `weights` 의 길이 ≤ 50,000', '40 ≤ `weights[i]` ≤ 240', '`limit` 는 가장 무거운 장비보다 크거나 같아요 (≤ 240).'],
      method: { name: 'solution', ret: 'int', params: [{ type: 'int[]', name: 'weights' }, { type: 'int', name: 'limit' }] },
      examples: [
        { args: [[70, 50, 80, 50], 100], expected: 3 },
        { args: [[70, 80, 50], 100], expected: 3 },
      ],
      tests: [[[40], 40], [[40, 40], 80], [[100, 100, 100], 200], [[60, 60, 60], 100], (R) => [R.arr(300, 40, 240), 240]],
      big: [{ label: 'n = 50,000', gen: (R) => [R.arr(50000, 40, 240), 240] }],
      ref: (w, limit) => { const a = w.slice().sort((x, y) => x - y); let i = 0, j = a.length - 1, cnt = 0; while (i <= j) { if (a[i] + a[j] <= limit) i++; j--; cnt++; } return cnt; },
      hints: [
        '정렬한 뒤 **가장 무거운 장비**를 기준으로 생각해요. 가장 가벼운 장비와 같이 실을 수 있으면 같이, 아니면 혼자 실어요.',
        '양 끝에서 좁혀 오는 투 포인터 `i`, `j` 로 O(n) 에 셀 수 있어요.',
      ],
      concept: '"가장 무거운 것은 어차피 한 칸을 써야 하니, 그 칸에 태울 수 있는 가장 가벼운 짝을 붙인다" — 이런 교환 논증이 그리디가 맞다는 근거예요.',
      solution: String.raw`import java.util.*;

class Solution {
    public int solution(int[] weights, int limit) {
        Arrays.sort(weights);
        int i = 0, j = weights.length - 1, count = 0;
        while (i <= j) {
            if (weights[i] + weights[j] <= limit) i++;
            j--;
            count++;
        }
        return count;
    }
}
`,
      explain: '정렬 + 양 끝 투 포인터. 무거운 쪽은 항상 싣고, 가벼운 쪽은 함께 실을 수 있을 때만 움직여요.',
    },
    {
      id: 'greedy-min-rooms', category: 'greedy', difficulty: 'hard', title: '필요한 회의실 수',
      desc: '오늘 예정된 회의 `intervals` 의 각 원소는 `[시작, 끝)` 이에요 (끝나는 시각에 다른 회의가 시작해도 겹치지 않아요). 모든 회의를 진행하려면 회의실이 **최소 몇 개** 필요한지 return 하세요.',
      constraints: ['1 ≤ `intervals` 의 길이 ≤ 100,000', '0 ≤ 시작 < 끝 ≤ 1,000,000,000'],
      method: { name: 'solution', ret: 'int', params: [{ type: 'int[][]', name: 'intervals' }] },
      examples: [
        { args: [[[0, 30], [5, 10], [15, 20]]], expected: 2 },
        { args: [[[7, 10], [2, 4]]], expected: 1 },
      ],
      tests: [[[[1, 2]]], [[[1, 5], [5, 10]]], [[[1, 10], [2, 9], [3, 8]]], [[[1, 3], [2, 4], [3, 5], [4, 6]]], (R) => [range(200).map(() => { const s = R.int(0, 100); return [s, s + R.int(1, 30)]; })]],
      big: [{ label: 'n = 100,000', gen: (R) => [range(100000).map(() => { const s = R.int(0, 990000000); return [s, s + R.int(1, 10000000)]; })] }],
      ref: (iv) => { const s = iv.map((x) => x[0]).sort((a, b) => a - b), e = iv.map((x) => x[1]).sort((a, b) => a - b); let j = 0, cur = 0, best = 0; for (let i = 0; i < s.length; i++) { while (j < e.length && e[j] <= s[i]) { j++; cur--; } cur++; best = Math.max(best, cur); } return best; },
      hints: [
        '"동시에 진행 중인 회의 수의 최댓값"이 곧 필요한 회의실 수예요.',
        '방법 1: 시작 시각 순으로 정렬하고, 진행 중인 회의의 끝 시각을 `PriorityQueue` 에 넣어 가장 빨리 끝나는 회의실을 재사용해요.',
        '방법 2: 시작 배열과 끝 배열을 따로 정렬해 두 포인터로 훑어요.',
      ],
      concept: '구간 문제는 "이벤트(시작 +1, 끝 −1)를 시간 순으로 처리"하는 스위핑(sweep line)으로 바꾸면 쉬워져요. 같은 시각이면 끝을 먼저 처리해야 `[1,5)`, `[5,10)` 이 겹치지 않아요.',
      solution: String.raw`import java.util.*;

class Solution {
    public int solution(int[][] intervals) {
        int n = intervals.length;
        int[] starts = new int[n], ends = new int[n];
        for (int i = 0; i < n; i++) {
            starts[i] = intervals[i][0];
            ends[i] = intervals[i][1];
        }
        Arrays.sort(starts);
        Arrays.sort(ends);
        int rooms = 0, best = 0, j = 0;
        for (int i = 0; i < n; i++) {
            while (j < n && ends[j] <= starts[i]) {
                j++;
                rooms--;
            }
            rooms++;
            best = Math.max(best, rooms);
        }
        return best;
    }
}
`,
      explain: '회의가 시작될 때마다 그 전에 끝난 회의들을 빼고 하나를 더해, 동시에 진행 중인 회의 수의 최댓값을 구해요.',
    },

    /* ================= 이분 탐색 ================= */
    {
      id: 'search-count-range', category: 'search', difficulty: 'medium', title: '가격대별 상품 수 조회',
      desc: '쇼핑몰 상품 가격 배열 `prices` 가 있어요. 조회 요청 `queries` 의 각 원소 `[lo, hi]` 마다 가격이 **lo 이상 hi 이하**인 상품 수를 구해 배열로 return 하세요.',
      constraints: ['1 ≤ `prices` 의 길이 ≤ 100,000', '1 ≤ `queries` 의 길이 ≤ 100,000', '-1,000,000,000 ≤ `prices[i]`, lo ≤ hi ≤ 1,000,000,000'],
      method: { name: 'solution', ret: 'int[]', params: [{ type: 'int[]', name: 'prices' }, { type: 'int[][]', name: 'queries' }] },
      examples: [
        { args: [[5, 1, 9, 3, 7], [[2, 6], [1, 9], [10, 20]]], expected: [2, 5, 0] },
        { args: [[4, 4, 4], [[4, 4], [5, 5]]], expected: [3, 0] },
      ],
      tests: [[[1], [[1, 1], [0, 0], [2, 2]]], [[-5, 0, 5], [[-1000000000, 1000000000], [-5, -5], [1, 4]]], [[1000000000, -1000000000], [[1000000000, 1000000000]]], (R) => [R.arr(200, -50, 50), range(100).map(() => { const a = R.int(-60, 60); return [a, a + R.int(0, 30)]; })]],
      big: [{ label: 'n = 100,000, 조회 100,000 개', gen: (R) => [R.arr(100000, -1000000000, 1000000000), range(100000).map(() => { const a = R.int(-1000000000, 900000000); return [a, a + R.int(0, 100000000)]; })] }],
      ref: (prices, queries) => {
        const a = prices.slice().sort((x, y) => x - y);
        const lb = (x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; };
        return queries.map(([l, h]) => lb(h + 1) - lb(l));
      },
      hints: [
        '조회마다 전체를 훑으면 100,000 × 100,000 = 100억 번이에요.',
        '가격을 한 번 정렬해 두면, "x 이상인 첫 위치(lower bound)"를 이분 탐색으로 O(log n) 에 찾을 수 있어요.',
        '개수 = lowerBound(hi + 1) − lowerBound(lo). hi + 1 이 int 를 넘지 않게 `long` 으로 계산하세요.',
      ],
      concept: '`Arrays.binarySearch` 는 값이 여러 개일 때 어느 위치를 줄지 보장하지 않아요. 개수를 세려면 lower bound / upper bound 를 직접 구현하는 게 안전해요. 중간값은 `(lo + hi) >>> 1` 로 구하면 오버플로가 없어요.',
      solution: String.raw`import java.util.*;

class Solution {
    public int[] solution(int[] prices, int[][] queries) {
        int[] sorted = prices.clone();
        Arrays.sort(sorted);
        int[] answer = new int[queries.length];
        for (int i = 0; i < queries.length; i++) {
            answer[i] = lowerBound(sorted, queries[i][1] + 1L) - lowerBound(sorted, queries[i][0]);
        }
        return answer;
    }

    // x 이상인 값이 처음 나오는 위치
    private int lowerBound(int[] a, long x) {
        int lo = 0, hi = a.length;
        while (lo < hi) {
            int mid = (lo + hi) >>> 1;
            if (a[mid] < x) lo = mid + 1;
            else hi = mid;
        }
        return lo;
    }
}
`,
      explain: '정렬 O(n log n) + 조회마다 이분 탐색 두 번 O(log n).',
    },
    {
      id: 'search-cut-cables', category: 'search', difficulty: 'medium', title: '랜선 같은 길이로 자르기',
      desc: '길이가 제각각인 랜선 `cables` 를 모두 **같은 정수 길이 L** 로 잘라서 `n` 개 이상 만들려고 해요 (남는 자투리는 버려요). 만들 수 있는 **L 의 최댓값**을 return 하세요. L = 1 이면 항상 만들 수 있어요.',
      constraints: ['1 ≤ `cables` 의 길이 ≤ 10,000', '1 ≤ `cables[i]` ≤ 2,147,483,647 (int 최댓값)', '1 ≤ `n` ≤ 1,000,000, 랜선 길이의 합 ≥ n'],
      method: { name: 'solution', ret: 'int', params: [{ type: 'int[]', name: 'cables' }, { type: 'int', name: 'n' }] },
      examples: [
        { args: [[802, 743, 457, 539], 11], expected: 200 },
        { args: [[10], 3], expected: 3 },
      ],
      tests: [[[1], 1], [[2147483647], 1], [[2147483647, 2147483647], 2], [[5, 5, 5], 4], [[100, 1], 2], (R) => [R.arr(100, 1, 1000), 500]],
      big: [{ label: '랜선 10,000 개', gen: (R) => [R.arr(10000, 1, 2147483647), 1000000] }],
      ref: (cables, n) => { let lo = 1, hi = Math.max(...cables); while (lo < hi) { const mid = Math.floor((lo + hi + 1) / 2); let cnt = 0; for (const c of cables) cnt += Math.floor(c / mid); if (cnt >= n) lo = mid; else hi = mid - 1; } return lo; },
      hints: [
        'L 을 1 부터 하나씩 늘려 보면 최대 21억 번이라 안 돼요.',
        'L 이 커질수록 만들 수 있는 개수는 줄어들어요(단조성). "L 로 n 개 이상 만들 수 있나?"를 이분 탐색하세요.',
        '`lo + hi` 가 int 범위를 넘을 수 있어요. `long` 으로!',
      ],
      concept: '파라메트릭 서치(parametric search): "최댓값을 구하라"를 "이 값이 가능한가? (예/아니오)"로 바꾸고, 가능 여부가 단조로우면 답의 범위를 이분 탐색해요.',
      solution: String.raw`class Solution {
    public int solution(int[] cables, int n) {
        long lo = 1, hi = 0;
        for (int c : cables) hi = Math.max(hi, c);
        while (lo < hi) {
            long mid = (lo + hi + 1) / 2;
            long count = 0;
            for (int c : cables) count += c / mid;
            if (count >= n) lo = mid;
            else hi = mid - 1;
        }
        return (int) lo;
    }
}
`,
      explain: '가능하면 더 길게(lo = mid), 불가능하면 짧게(hi = mid − 1). 위쪽 중간값 `(lo + hi + 1) / 2` 를 써야 무한 루프가 안 생겨요.',
    },
    {
      id: 'search-build-servers', category: 'search', difficulty: 'hard', title: '빌드 서버 최소 시간',
      desc: '빌드 작업 `n` 개를 서버 여러 대에 나눠 처리해요. `times[i]` 는 i 번 서버가 작업 하나를 처리하는 데 걸리는 시간(분)이에요. 서버는 한 번에 작업 하나만 처리하고, 모든 서버가 동시에 일할 수 있어요. 모든 작업을 끝내는 **최소 시간**을 return 하세요.',
      constraints: ['1 ≤ `n` ≤ 1,000,000', '1 ≤ `times` 의 길이 ≤ 100,000', '1 ≤ `times[i]` ≤ 1,000,000', '답이 int 범위를 넘을 수 있어요.'],
      method: { name: 'solution', ret: 'long', params: [{ type: 'int', name: 'n' }, { type: 'int[]', name: 'times' }] },
      examples: [
        { args: [6, [7, 10]], expected: 28 },
        { args: [1, [5, 3]], expected: 3 },
      ],
      tests: [[1, [1]], [10, [1]], [1000000, [1000000]], [3, [1, 1, 1]], [5, [2, 3]], (R) => [R.int(1, 1000), R.arr(20, 1, 100)]],
      big: [{ label: '작업 1,000,000 개, 서버 100,000 대', gen: (R) => [1000000, R.arr(100000, 1, 1000000)] }],
      ref: (n, times) => { let lo = 1, hi = Math.max(...times) * n; while (lo < hi) { const mid = Math.floor((lo + hi) / 2); let done = 0; for (const t of times) { done += Math.floor(mid / t); if (done >= n) break; } if (done >= n) hi = mid; else lo = mid + 1; } return lo; },
      hints: [
        '시간 T 가 주어지면 i 번 서버는 `T / times[i]` 개를 처리해요. 모두 더해 n 이상이면 T 분 안에 끝낼 수 있어요.',
        'T 가 클수록 처리량도 늘어나니 T 를 이분 탐색하세요. 범위는 1 ~ (가장 느린 서버 × n).',
        '최대 10¹² 이라 `long` 이 필요해요.',
      ],
      concept: '"최소 시간"을 직접 계산하기 어렵다면, "T 분이면 충분한가?"를 판정하는 함수를 만들고 이분 탐색하세요. 판정이 O(m) 이면 전체는 O(m log(답의 범위)) 예요.',
      solution: String.raw`class Solution {
    public long solution(int n, int[] times) {
        long lo = 1, hi = 0;
        for (int t : times) hi = Math.max(hi, t);
        hi *= n;
        while (lo < hi) {
            long mid = (lo + hi) / 2;
            long done = 0;
            for (int t : times) {
                done += mid / t;
                if (done >= n) break;
            }
            if (done >= n) hi = mid;
            else lo = mid + 1;
        }
        return lo;
    }
}
`,
      explain: '가능하면 hi = mid 로 더 짧은 시간을, 아니면 lo = mid + 1 로 더 긴 시간을 봐요.',
    },

    /* ================= 투 포인터·누적합 ================= */
    {
      id: 'window-range-sum', category: 'window', difficulty: 'easy', title: '기간별 매출 합계',
      desc: '일별 매출 배열 `sales` 와 조회 요청 `queries` 가 있어요. 각 요청 `[l, r]` 마다 `sales[l] + … + sales[r]` 을 구해 배열로 return 하세요 (인덱스는 0 부터, 양 끝 포함).',
      constraints: ['1 ≤ `sales` 의 길이 ≤ 100,000', '0 ≤ `sales[i]` ≤ 100,000', '1 ≤ `queries` 의 길이 ≤ 100,000, 0 ≤ l ≤ r < n'],
      method: { name: 'solution', ret: 'long[]', params: [{ type: 'int[]', name: 'sales' }, { type: 'int[][]', name: 'queries' }] },
      examples: [
        { args: [[3, 1, 4, 1, 5], [[0, 2], [1, 4], [3, 3]]], expected: [8, 11, 1] },
      ],
      tests: [[[7], [[0, 0]]], [[0, 0, 0], [[0, 2]]], [[100000, 100000], [[0, 1], [1, 1]]], (R) => { const a = R.arr(100, 0, 100); return [a, range(50).map(() => { const l = R.int(0, 99); return [l, R.int(l, 99)]; })]; }],
      big: [{ label: 'n = 100,000, 조회 100,000 개', gen: (R) => [R.arr(100000, 0, 100000), range(100000).map(() => { const l = R.int(0, 50000); return [l, R.int(l, 99999)]; })] }],
      ref: (a, qs) => { const p = [0]; a.forEach((x, i) => { p[i + 1] = p[i] + x; }); return qs.map(([l, r]) => p[r + 1] - p[l]); },
      hints: [
        '요청마다 더하면 최악 100,000 × 100,000 번이에요.',
        '`prefix[i] = sales[0] + … + sales[i-1]` 을 미리 만들어 두면 구간 합은 `prefix[r + 1] - prefix[l]` 이에요.',
        '합이 최대 100억이라 `long[]` 을 써요.',
      ],
      concept: '누적합(prefix sum)은 O(n) 전처리로 모든 구간 합을 O(1) 에 답하게 해 줘요. 2차원 격자에도 그대로 확장돼요.',
      solution: String.raw`class Solution {
    public long[] solution(int[] sales, int[][] queries) {
        long[] prefix = new long[sales.length + 1];
        for (int i = 0; i < sales.length; i++) prefix[i + 1] = prefix[i] + sales[i];
        long[] answer = new long[queries.length];
        for (int i = 0; i < queries.length; i++) {
            answer[i] = prefix[queries[i][1] + 1] - prefix[queries[i][0]];
        }
        return answer;
    }
}
`,
      explain: '누적합 배열을 한 번 만들고, 각 요청을 뺄셈 한 번으로 답해요.',
    },
    {
      id: 'window-longest-unique', category: 'window', difficulty: 'medium', title: '중복 없는 가장 긴 세션',
      desc: '사용자 행동 로그 문자열 `s` 에서 **같은 문자가 두 번 나오지 않는** 가장 긴 연속 부분 문자열의 길이를 return 하세요.',
      constraints: ['1 ≤ `s` 의 길이 ≤ 100,000', '`s` 는 출력 가능한 ASCII 문자(공백 포함)로 이루어져 있어요.'],
      method: { name: 'solution', ret: 'int', params: [{ type: 'String', name: 's' }] },
      examples: [
        { args: ['abcabcbb'], expected: 3 },
        { args: ['bbbbb'], expected: 1 },
        { args: ['pwwkew'], expected: 3 },
      ],
      tests: [['a'], ['au'], ['dvdf'], ['abba'], [' a b'], ['tmmzuxt'], (R) => [R.str(300, 'abcdef')]],
      big: [{ label: '길이 100,000', gen: (R) => { let s = ''; for (let i = 0; i < 100000; i++) s += String.fromCharCode(R.int(32, 126)); return [s]; } }],
      ref: (s) => { const last = new Map(); let best = 0, left = 0; for (let r = 0; r < s.length; r++) { const c = s[r]; if (last.has(c) && last.get(c) >= left) left = last.get(c) + 1; last.set(c, r); best = Math.max(best, r - left + 1); } return best; },
      hints: [
        '오른쪽 끝 `right` 를 늘려 가면서, 구간 안에 중복이 생기면 왼쪽 끝 `left` 를 중복 문자 다음으로 옮겨요.',
        '각 문자가 마지막으로 나온 위치를 `Map<Character, Integer>` (또는 크기 128 배열)에 기억하세요.',
        '`"abba"` 처럼 이미 지나간 위치로 `left` 가 되돌아가면 안 돼요.',
      ],
      concept: '슬라이딩 윈도우: 두 포인터가 모두 앞으로만 움직이면 전체가 O(n) 이에요. "조건을 만족하는 가장 긴/짧은 구간" 문제에 자주 써요.',
      solution: String.raw`import java.util.*;

class Solution {
    public int solution(String s) {
        int[] last = new int[128];
        Arrays.fill(last, -1);
        int best = 0, left = 0;
        for (int right = 0; right < s.length(); right++) {
            char c = s.charAt(right);
            if (last[c] >= left) left = last[c] + 1;
            last[c] = right;
            best = Math.max(best, right - left + 1);
        }
        return best;
    }
}
`,
      explain: '문자별 마지막 위치를 배열로 기억하고, 중복이 구간 안에 있을 때만 left 를 앞으로 당겨요.',
    },
    {
      id: 'window-min-length', category: 'window', difficulty: 'medium', title: '목표 처리량을 넘는 가장 짧은 구간',
      desc: '초당 처리량 배열 `nums` (모두 양수) 에서 합이 `target` **이상**인 연속 구간 중 가장 짧은 구간의 길이를 return 하세요. 그런 구간이 없으면 0 이에요.',
      constraints: ['1 ≤ `nums` 의 길이 ≤ 100,000', '1 ≤ `nums[i]` ≤ 100', '1 ≤ `target` ≤ 1,000,000,000'],
      method: { name: 'solution', ret: 'int', params: [{ type: 'int[]', name: 'nums' }, { type: 'int', name: 'target' }] },
      examples: [
        { args: [[2, 3, 1, 2, 4, 3], 7], expected: 2 },
        { args: [[1, 1, 1], 5], expected: 0 },
      ],
      tests: [[[5], 5], [[5], 6], [[1, 4, 4], 4], [[1, 2, 3, 4, 5], 15], [[1, 2, 3, 4, 5], 11], (R) => [R.arr(300, 1, 100), 1000]],
      big: [{ label: 'n = 100,000', gen: (R) => [R.arr(100000, 1, 100), 1500000] }],
      ref: (nums, target) => { let left = 0, sum = 0, best = Infinity; for (let r = 0; r < nums.length; r++) { sum += nums[r]; while (sum >= target) { best = Math.min(best, r - left + 1); sum -= nums[left++]; } } return best === Infinity ? 0 : best; },
      hints: [
        '모든 값이 양수라서, 구간을 오른쪽으로 늘리면 합이 커지고 왼쪽을 줄이면 합이 작아져요.',
        '`right` 를 하나씩 늘리면서, 합이 target 이상인 동안 `left` 를 당겨 길이를 줄여 보세요.',
      ],
      concept: '양수 배열이라는 조건이 투 포인터를 가능하게 해요. 음수가 섞이면 이 단조성이 깨지니 누적합 + 다른 방법이 필요해요.',
      solution: String.raw`class Solution {
    public int solution(int[] nums, int target) {
        int left = 0, best = Integer.MAX_VALUE;
        long sum = 0;
        for (int right = 0; right < nums.length; right++) {
            sum += nums[right];
            while (sum >= target) {
                best = Math.min(best, right - left + 1);
                sum -= nums[left++];
            }
        }
        return best == Integer.MAX_VALUE ? 0 : best;
    }
}
`,
      explain: 'right 를 늘려 합을 키우고, 조건을 만족하는 동안 left 를 당기며 최소 길이를 갱신해요. O(n).',
    },

    /* ================= 그래프 탐색 ================= */
    {
      id: 'graph-network', category: 'graph', difficulty: 'easy', title: '사내 네트워크 그룹 수',
      desc: '사내 PC `n` 대(0 ~ n-1 번)가 케이블 `cables` 로 연결돼 있어요. 각 원소 `[a, b]` 는 a 와 b 가 직접 연결됐다는 뜻이에요 (양방향). 직접 또는 다른 PC 를 거쳐 서로 연결된 PC 들을 한 그룹으로 볼 때, **그룹의 수**를 return 하세요.',
      constraints: ['1 ≤ `n` ≤ 100,000', '0 ≤ `cables` 의 길이 ≤ 100,000', '0 ≤ a, b < n, a ≠ b'],
      method: { name: 'solution', ret: 'int', params: [{ type: 'int', name: 'n' }, { type: 'int[][]', name: 'cables' }] },
      examples: [
        { args: [5, [[0, 1], [1, 2], [3, 4]]], expected: 2 },
        { args: [3, []], expected: 3 },
      ],
      tests: [[1, []], [2, [[0, 1], [1, 0]]], [4, [[0, 1], [2, 3], [1, 2]]], [6, [[0, 5], [5, 4]]], (R) => [50, range(30).map(() => { const a = R.int(0, 49); let b = R.int(0, 49); if (b === a) b = (a + 1) % 50; return [a, b]; })]],
      big: [{ label: 'PC 100,000 대, 케이블 99,999 개 (일렬)', gen: (R) => { const p = R.shuffle(range(100000)); return [100000, range(99999).map((i) => [p[i], p[i + 1]])]; } }],
      ref: (n, edges) => { const par = range(n); const f = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; }; let c = n; for (const [a, b] of edges) { const x = f(a), y = f(b); if (x !== y) { par[x] = y; c--; } } return c; },
      hints: [
        '인접 리스트 `List<List<Integer>> graph` 를 만들고, 방문하지 않은 PC 에서 BFS/DFS 를 시작할 때마다 그룹 수를 1 늘려요.',
        '일렬로 10 만 대가 이어져 있으면 재귀 DFS 는 `StackOverflowError` 가 날 수 있어요. 큐(BFS)나 직접 만든 스택을 쓰세요.',
      ],
      concept: '그래프 입력은 대부분 간선 목록으로 주어져요. 인접 리스트로 바꾸는 코드는 코딩테스트에서 거의 매번 쓰니 손에 익혀 두세요. 유니온 파인드(Union-Find)로도 풀 수 있어요.',
      solution: String.raw`import java.util.*;

class Solution {
    public int solution(int n, int[][] cables) {
        List<List<Integer>> graph = new ArrayList<>();
        for (int i = 0; i < n; i++) graph.add(new ArrayList<>());
        for (int[] e : cables) {
            graph.get(e[0]).add(e[1]);
            graph.get(e[1]).add(e[0]);
        }
        boolean[] visited = new boolean[n];
        Deque<Integer> queue = new ArrayDeque<>();
        int groups = 0;
        for (int s = 0; s < n; s++) {
            if (visited[s]) continue;
            groups++;
            visited[s] = true;
            queue.offer(s);
            while (!queue.isEmpty()) {
                int cur = queue.poll();
                for (int next : graph.get(cur)) {
                    if (!visited[next]) {
                        visited[next] = true;
                        queue.offer(next);
                    }
                }
            }
        }
        return groups;
    }
}
`,
      explain: '방문하지 않은 정점마다 BFS 로 연결된 정점을 모두 방문 처리하고, 시작한 횟수를 세요. O(n + m).',
    },
    {
      id: 'graph-islands', category: 'graph', difficulty: 'medium', title: '데이터센터 구역 수',
      desc: '데이터센터 평면도 `grid` 에서 1 은 서버 랙, 0 은 빈 공간이에요. **상하좌우**로 붙어 있는 랙들은 하나의 구역이에요. 구역의 수를 return 하세요.',
      constraints: ['1 ≤ `grid` 의 행/열 개수 ≤ 300', '`grid[i][j]` 는 0 또는 1'],
      method: { name: 'solution', ret: 'int', params: [{ type: 'int[][]', name: 'grid' }] },
      examples: [
        { args: [[[1, 1, 0, 0, 0], [1, 1, 0, 0, 0], [0, 0, 1, 0, 0], [0, 0, 0, 1, 1]]], expected: 3 },
        { args: [[[1, 0, 1], [0, 1, 0], [1, 0, 1]]], expected: 5 },
      ],
      tests: [[[[0]]], [[[1]]], [[[1, 1, 1], [1, 0, 1], [1, 1, 1]]], [[[1, 0], [0, 1]]], (R) => [range(20).map(() => range(20).map(() => (R.next() < 0.45 ? 1 : 0)))]],
      big: [
        { label: '300 × 300 (무작위)', gen: (R) => [range(300).map(() => range(300).map(() => (R.next() < 0.6 ? 1 : 0)))] },
        { label: '300 × 300 (전부 1)', gen: () => [range(300).map(() => new Array(300).fill(1))] },
      ],
      ref: (g) => {
        const n = g.length, m = g[0].length; const seen = g.map((r) => r.map(() => false)); let cnt = 0;
        for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
          if (g[i][j] !== 1 || seen[i][j]) continue;
          cnt++; seen[i][j] = true; const st = [[i, j]];
          while (st.length) { const [r, c] = st.pop(); for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = r + dr, b = c + dc; if (a >= 0 && a < n && b >= 0 && b < m && g[a][b] === 1 && !seen[a][b]) { seen[a][b] = true; st.push([a, b]); } } }
        }
        return cnt;
      },
      hints: [
        '모든 칸을 돌면서, 아직 방문하지 않은 1 을 만나면 구역 수를 늘리고 BFS 로 붙어 있는 1 을 모두 방문 처리해요.',
        '300 × 300 이 전부 1 이면 재귀 DFS 깊이가 9 만이라 스택이 넘쳐요. `ArrayDeque<int[]>` 로 BFS 하세요.',
      ],
      concept: '격자 탐색은 "방향 배열 + 범위 검사 + 방문 배열" 세 가지로 이뤄져요. 큐에 넣을 때 방문 처리해야 같은 칸이 여러 번 들어가지 않아요.',
      solution: String.raw`import java.util.*;

class Solution {
    public int solution(int[][] grid) {
        int n = grid.length, m = grid[0].length;
        boolean[][] visited = new boolean[n][m];
        int[] dr = {-1, 1, 0, 0}, dc = {0, 0, -1, 1};
        Deque<int[]> queue = new ArrayDeque<>();
        int count = 0;
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < m; j++) {
                if (grid[i][j] != 1 || visited[i][j]) continue;
                count++;
                visited[i][j] = true;
                queue.offer(new int[]{i, j});
                while (!queue.isEmpty()) {
                    int[] cur = queue.poll();
                    for (int d = 0; d < 4; d++) {
                        int r = cur[0] + dr[d], c = cur[1] + dc[d];
                        if (r < 0 || r >= n || c < 0 || c >= m) continue;
                        if (grid[r][c] != 1 || visited[r][c]) continue;
                        visited[r][c] = true;
                        queue.offer(new int[]{r, c});
                    }
                }
            }
        }
        return count;
    }
}
`,
      explain: '새 구역의 시작점을 찾을 때마다 BFS 로 구역 전체를 칠해요. 모든 칸을 한 번씩 보므로 O(n·m).',
    },
    {
      id: 'graph-maze', category: 'graph', difficulty: 'medium', title: '물류 로봇 최단 경로',
      desc: '창고 지도 `maze` 에서 1 은 지나갈 수 있는 칸, 0 은 선반이에요. 로봇이 왼쪽 위 `(0, 0)` 에서 오른쪽 아래 `(n-1, m-1)` 까지 상하좌우로 이동할 때 **지나는 칸 수의 최솟값**(시작 칸과 도착 칸 포함)을 return 하세요. 도착할 수 없으면 -1 이에요.',
      constraints: ['1 ≤ `maze` 의 행/열 개수 ≤ 400', '`maze[i][j]` 는 0 또는 1'],
      method: { name: 'solution', ret: 'int', params: [{ type: 'int[][]', name: 'maze' }] },
      examples: [
        { args: [[[1, 0, 1, 1, 1], [1, 0, 1, 0, 1], [1, 0, 1, 1, 1], [1, 1, 1, 0, 1], [0, 0, 0, 0, 1]]], expected: 11 },
        { args: [[[1, 0], [0, 1]]], expected: -1 },
      ],
      tests: [[[[1]]], [[[0]]], [[[1, 1, 1]]], [[[1, 1], [1, 1]]], [[[1, 1, 1], [0, 0, 1], [1, 1, 1], [1, 0, 0], [1, 1, 1]]], (R) => { const g = range(15).map(() => range(15).map(() => (R.next() < 0.7 ? 1 : 0))); g[0][0] = 1; g[14][14] = 1; return [g]; }],
      big: [{
        label: '400 × 400', gen: (R) => {
          const n = 400; const g = range(n).map(() => range(n).map(() => (R.next() < 0.65 ? 1 : 0)));
          let r = 0, c = 0; g[0][0] = 1;
          while (r < n - 1 || c < n - 1) { if (c === n - 1 || (r < n - 1 && R.next() < 0.5)) r++; else c++; g[r][c] = 1; }
          return [g];
        },
      }],
      ref: (g) => {
        const n = g.length, m = g[0].length; if (!g[0][0] || !g[n - 1][m - 1]) return -1;
        const dist = g.map((r) => r.map(() => 0)); dist[0][0] = 1; const q = [[0, 0]];
        for (let h = 0; h < q.length; h++) {
          const [r, c] = q[h]; if (r === n - 1 && c === m - 1) return dist[r][c];
          for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = r + dr, b = c + dc; if (a >= 0 && a < n && b >= 0 && b < m && g[a][b] === 1 && !dist[a][b]) { dist[a][b] = dist[r][c] + 1; q.push([a, b]); } }
        }
        return -1;
      },
      hints: [
        '간선의 가중치가 모두 같을 때 최단 거리는 **BFS** 로 구해요. DFS 로 모든 경로를 보면 지수 시간이에요.',
        '`dist[r][c]` 에 시작부터의 칸 수를 기록하면 방문 여부도 함께 알 수 있어요 (0 이면 미방문).',
      ],
      concept: 'BFS 는 시작점에서 가까운 순서대로 방문하기 때문에, 처음 도착한 순간의 거리가 곧 최단 거리예요.',
      solution: String.raw`import java.util.*;

class Solution {
    public int solution(int[][] maze) {
        int n = maze.length, m = maze[0].length;
        if (maze[0][0] == 0 || maze[n - 1][m - 1] == 0) return -1;
        int[][] dist = new int[n][m];
        int[] dr = {-1, 1, 0, 0}, dc = {0, 0, -1, 1};
        Deque<int[]> queue = new ArrayDeque<>();
        dist[0][0] = 1;
        queue.offer(new int[]{0, 0});
        while (!queue.isEmpty()) {
            int[] cur = queue.poll();
            if (cur[0] == n - 1 && cur[1] == m - 1) return dist[cur[0]][cur[1]];
            for (int d = 0; d < 4; d++) {
                int r = cur[0] + dr[d], c = cur[1] + dc[d];
                if (r < 0 || r >= n || c < 0 || c >= m) continue;
                if (maze[r][c] == 0 || dist[r][c] != 0) continue;
                dist[r][c] = dist[cur[0]][cur[1]] + 1;
                queue.offer(new int[]{r, c});
            }
        }
        return -1;
    }
}
`,
      explain: '시작 칸에서 BFS 를 돌리며 거리를 기록하고, 도착 칸을 꺼내는 순간 그 거리를 return 해요.',
    },
    {
      id: 'graph-word-ladder', category: 'graph', difficulty: 'hard', title: '브랜치 이름 한 글자씩 바꾸기',
      desc: '브랜치 이름 `begin` 을 `target` 으로 바꾸려고 해요. 한 번에 **한 글자만** 바꿀 수 있고, 바꾼 결과는 반드시 허용 목록 `words` 에 있는 이름이어야 해요. 최소 몇 번 바꿔야 하는지 return 하세요. 바꿀 수 없으면 0 이에요.',
      constraints: ['모든 단어의 길이는 같고 2 ~ 10, 영어 소문자', '1 ≤ `words` 의 길이 ≤ 5,000, 중복 없음', '`begin` ≠ `target`, `begin` 은 `words` 에 없을 수도 있어요.'],
      method: { name: 'solution', ret: 'int', params: [{ type: 'String', name: 'begin' }, { type: 'String', name: 'target' }, { type: 'String[]', name: 'words' }] },
      examples: [
        { args: ['hit', 'cog', ['hot', 'dot', 'dog', 'lot', 'log', 'cog']], expected: 4 },
        { args: ['hit', 'cog', ['hot', 'dot', 'dog', 'lot', 'log']], expected: 0 },
      ],
      tests: [['ab', 'cb', ['cb']], ['ab', 'cd', ['ad', 'cd']], ['aaa', 'bbb', ['aab', 'abb']], ['aaa', 'bbb', ['aab', 'abb', 'bbb']], ['abc', 'xyz', ['xyz']]],
      big: [{
        label: '단어 5,000 개', gen: (R) => {
          const all = []; const al = 'abcd';
          (function rec(s) { if (s.length === 7) { all.push(s); return; } for (const c of al) rec(s + c); })('');
          const words = R.shuffle(all).slice(0, 5000);
          return ['aaaaaaa', words[0], words];
        },
      }],
      ref: (begin, target, words) => {
        const dict = new Set(words); if (!dict.has(target)) return 0;
        const dist = new Map([[begin, 0]]); const q = [begin];
        for (let h = 0; h < q.length; h++) {
          const cur = q[h]; if (cur === target) return dist.get(cur);
          for (let i = 0; i < cur.length; i++) for (const c of LOWER) {
            if (c === cur[i]) continue;
            const nx = cur.slice(0, i) + c + cur.slice(i + 1);
            if (dict.has(nx) && !dist.has(nx)) { dist.set(nx, dist.get(cur) + 1); q.push(nx); }
          }
        }
        return 0;
      },
      hints: [
        '단어를 정점, "한 글자 차이"를 간선으로 보면 최단 거리 문제 → BFS 예요.',
        '모든 단어 쌍을 비교하면 O(N²·L) 이에요. 대신 현재 단어의 각 자리를 a ~ z 로 바꿔 보고 `HashSet` 에 있는지 확인하면 O(N·L·26) 이에요.',
      ],
      concept: '그래프가 명시적으로 주어지지 않아도 "상태"와 "한 번에 갈 수 있는 상태"를 정의하면 BFS 를 쓸 수 있어요. 이웃을 만드는 방법에 따라 속도가 크게 달라져요.',
      solution: String.raw`import java.util.*;

class Solution {
    public int solution(String begin, String target, String[] words) {
        Set<String> dict = new HashSet<>(Arrays.asList(words));
        if (!dict.contains(target)) return 0;
        Map<String, Integer> dist = new HashMap<>();
        Deque<String> queue = new ArrayDeque<>();
        dist.put(begin, 0);
        queue.offer(begin);
        while (!queue.isEmpty()) {
            String cur = queue.poll();
            if (cur.equals(target)) return dist.get(cur);
            char[] cs = cur.toCharArray();
            for (int i = 0; i < cs.length; i++) {
                char orig = cs[i];
                for (char c = 'a'; c <= 'z'; c++) {
                    if (c == orig) continue;
                    cs[i] = c;
                    String next = new String(cs);
                    if (dict.contains(next) && !dist.containsKey(next)) {
                        dist.put(next, dist.get(cur) + 1);
                        queue.offer(next);
                    }
                }
                cs[i] = orig;
            }
        }
        return 0;
    }
}
`,
      explain: 'BFS 로 begin 에서 가까운 단어부터 방문해요. 이웃은 한 자리씩 a~z 로 바꿔 HashSet 에서 찾아요.',
    },

    /* ================= 동적 계획법 ================= */
    {
      id: 'dp-stairs', category: 'dp', difficulty: 'easy', title: '배포 단계 오르기',
      desc: '배포 파이프라인에 `n` 개의 단계가 있어요. 한 번에 **1 단계 또는 2 단계**씩 진행할 수 있을 때, 마지막 단계까지 가는 방법의 수를 **1,000,000,007 로 나눈 나머지**로 return 하세요.',
      constraints: ['1 ≤ `n` ≤ 100,000'],
      method: { name: 'solution', ret: 'int', params: [{ type: 'int', name: 'n' }] },
      examples: [
        { args: [3], expected: 3 },
        { args: [4], expected: 5 },
      ],
      tests: [[1], [2], [10], [45], [46], [1000]],
      big: [{ label: 'n = 100,000', gen: () => [100000] }],
      ref: (n) => { const MOD = 1000000007; let a = 1, b = 1; for (let i = 2; i <= n; i++) { const c = (a + b) % MOD; a = b; b = c; } return b; },
      hints: [
        '마지막 한 걸음이 1 단계였거나 2 단계였어요. 그래서 `f(n) = f(n-1) + f(n-2)` 예요.',
        '그냥 재귀로 부르면 같은 값을 수없이 다시 계산해서 지수 시간이에요. 배열이나 변수 두 개로 아래에서부터 쌓아 올리세요.',
        '더할 때마다 `% 1_000_000_007` 을 해야 int 를 넘지 않아요.',
      ],
      concept: 'DP 의 3 단계: ① 상태 정의 (f(i) = i 단계까지 가는 방법 수) ② 점화식 (f(i) = f(i-1) + f(i-2)) ③ 초기값 (f(0) = f(1) = 1). 메모이제이션 재귀도 되지만 n 이 크면 재귀 깊이 때문에 반복문(bottom-up)이 안전해요.',
      solution: String.raw`class Solution {
    public int solution(int n) {
        final int MOD = 1_000_000_007;
        long a = 1, b = 1; // a = f(i - 1), b = f(i)
        for (int i = 2; i <= n; i++) {
            long c = (a + b) % MOD;
            a = b;
            b = c;
        }
        return (int) b;
    }
}
`,
      explain: '직전 두 값만 있으면 되니 변수 두 개로 O(n) 시간, O(1) 공간이에요.',
    },
    {
      id: 'dp-coin', category: 'dp', difficulty: 'medium', title: '최소 개수 쿠폰 조합',
      desc: '여러 금액의 쿠폰 `coupons` 가 무제한으로 있어요. 금액 합이 정확히 `amount` 가 되도록 쿠폰을 고를 때 **최소 쿠폰 수**를 return 하세요. 만들 수 없으면 -1 이에요.',
      constraints: ['1 ≤ `coupons` 의 길이 ≤ 50', '1 ≤ `coupons[i]` ≤ 500', '0 ≤ `amount` ≤ 10,000'],
      method: { name: 'solution', ret: 'int', params: [{ type: 'int[]', name: 'coupons' }, { type: 'int', name: 'amount' }] },
      examples: [
        { args: [[1, 2, 5], 11], expected: 3 },
        { args: [[2], 3], expected: -1 },
        { args: [[1], 0], expected: 0 },
      ],
      tests: [[[1], 1], [[3, 7], 5], [[3, 7], 13], [[5, 9, 11], 27], [[186, 419, 83, 408], 6249], (R) => [R.arr(5, 1, 30), R.int(0, 500)]],
      big: [{ label: '쿠폰 50 종류, 금액 10,000', gen: (R) => [R.arr(50, 7, 500), 10000] }],
      ref: (coins, amount) => { const INF = 1e9; const dp = new Array(amount + 1).fill(INF); dp[0] = 0; for (let x = 1; x <= amount; x++) for (const c of coins) if (c <= x && dp[x - c] + 1 < dp[x]) dp[x] = dp[x - c] + 1; return dp[amount] >= INF ? -1 : dp[amount]; },
      hints: [
        '큰 쿠폰부터 욕심껏 쓰는 그리디는 틀려요: `[1, 3, 4]` 로 6 을 만들면 그리디는 4+1+1(3 개), 정답은 3+3(2 개).',
        '`dp[x]` = 금액 x 를 만드는 최소 쿠폰 수. `dp[x] = min(dp[x - c] + 1)` (모든 쿠폰 c 에 대해).',
        '만들 수 없는 금액은 아주 큰 값(INF)으로 두되, `INF + 1` 이 오버플로되지 않게 `Integer.MAX_VALUE / 2` 정도를 쓰세요.',
      ],
      concept: '그리디가 항상 최적이 아닐 때는 모든 선택지를 비교하는 DP 가 필요해요. 반례를 하나 떠올려 보는 습관이 중요해요.',
      solution: String.raw`import java.util.*;

class Solution {
    public int solution(int[] coupons, int amount) {
        final int INF = Integer.MAX_VALUE / 2;
        int[] dp = new int[amount + 1];
        Arrays.fill(dp, INF);
        dp[0] = 0;
        for (int x = 1; x <= amount; x++) {
            for (int c : coupons) {
                if (c <= x && dp[x - c] + 1 < dp[x]) dp[x] = dp[x - c] + 1;
            }
        }
        return dp[amount] >= INF ? -1 : dp[amount];
    }
}
`,
      explain: '금액 1 부터 amount 까지, 마지막에 쓴 쿠폰을 하나씩 가정해 최솟값을 구해요. O(amount × 쿠폰 수).',
    },
    {
      id: 'dp-knapsack', category: 'dp', difficulty: 'medium', title: '노트북 가방 챙기기',
      desc: '출장 가방에 최대 `capacity` 무게까지 담을 수 있어요. 물건 i 의 무게는 `weights[i]`, 가치는 `values[i]` 이고 각 물건은 **하나씩만** 있어요. 담을 수 있는 가치 합의 최댓값을 return 하세요.',
      constraints: ['1 ≤ 물건 수 ≤ 100', '1 ≤ `weights[i]` ≤ 50,000, 0 ≤ `values[i]` ≤ 1,000', '1 ≤ `capacity` ≤ 50,000'],
      method: { name: 'solution', ret: 'int', params: [{ type: 'int[]', name: 'weights' }, { type: 'int[]', name: 'values' }, { type: 'int', name: 'capacity' }] },
      examples: [
        { args: [[6, 4, 3, 5], [13, 8, 6, 12], 7], expected: 14 },
        { args: [[10], [5], 3], expected: 0 },
      ],
      tests: [[[1], [1], 1], [[1, 1, 1], [1, 2, 3], 2], [[5, 4, 6, 3], [10, 40, 30, 50], 10], [[3, 4, 5], [30, 50, 60], 8], (R) => [R.arr(20, 1, 30), R.arr(20, 0, 100), 100]],
      big: [{ label: '물건 100 개, 용량 50,000', gen: (R) => [R.arr(100, 100, 5000), R.arr(100, 0, 1000), 50000] }],
      ref: (w, v, cap) => { const dp = new Array(cap + 1).fill(0); for (let i = 0; i < w.length; i++) for (let x = cap; x >= w[i]; x--) dp[x] = Math.max(dp[x], dp[x - w[i]] + v[i]); return dp[cap]; },
      hints: [
        '모든 부분집합을 보면 2¹⁰⁰ 가지예요.',
        '`dp[x]` = 무게 x 이하로 담을 수 있는 최대 가치. 물건을 하나씩 보면서 `dp[x] = max(dp[x], dp[x - w] + v)`.',
        '1차원 배열로 할 때는 x 를 **큰 쪽에서 작은 쪽으로** 돌아야 같은 물건을 두 번 담지 않아요.',
      ],
      concept: '0/1 배낭 문제는 DP 의 대표 유형이에요. 2차원 `dp[i][x]` 에서 시작해 1차원으로 줄이는 과정을 이해하면 많은 변형 문제에 적용할 수 있어요.',
      solution: String.raw`class Solution {
    public int solution(int[] weights, int[] values, int capacity) {
        int[] dp = new int[capacity + 1]; // dp[x] = 무게 x 이하로 얻는 최대 가치
        for (int i = 0; i < weights.length; i++) {
            for (int x = capacity; x >= weights[i]; x--) {
                dp[x] = Math.max(dp[x], dp[x - weights[i]] + values[i]);
            }
        }
        return dp[capacity];
    }
}
`,
      explain: '물건마다 용량을 거꾸로 훑으며 "이 물건을 넣는 경우"와 비교해요. O(물건 수 × 용량).',
    },
    {
      id: 'dp-lcs', category: 'dp', difficulty: 'medium', title: '두 커밋 메시지의 공통 부분',
      desc: '두 문자열 `a`, `b` 의 **최장 공통 부분 수열(LCS)** 의 길이를 return 하세요. 부분 수열은 순서는 유지하되 연속하지 않아도 되는 문자들의 나열이에요. 예를 들어 `"ACAYKP"` 와 `"CAPCAK"` 의 LCS 는 `"ACAK"` (길이 4) 예요.',
      constraints: ['1 ≤ `a`, `b` 의 길이 ≤ 1,000', '영어 대문자'],
      method: { name: 'solution', ret: 'int', params: [{ type: 'String', name: 'a' }, { type: 'String', name: 'b' }] },
      examples: [
        { args: ['ACAYKP', 'CAPCAK'], expected: 4 },
        { args: ['ABC', 'DEF'], expected: 0 },
      ],
      tests: [['A', 'A'], ['A', 'B'], ['ABCBDAB', 'BDCABA'], ['AAAA', 'AA'], (R) => [R.str(50, 'ABC'), R.str(60, 'ABC')]],
      big: [{ label: '길이 1,000 × 1,000', gen: (R) => [R.str(1000, 'ACGT'), R.str(1000, 'ACGT')] }],
      ref: (a, b) => { const m = b.length; let prev = new Array(m + 1).fill(0); for (let i = 1; i <= a.length; i++) { const cur = new Array(m + 1).fill(0); for (let j = 1; j <= m; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]); prev = cur; } return prev[m]; },
      hints: [
        '`dp[i][j]` = a 의 앞 i 글자와 b 의 앞 j 글자의 LCS 길이.',
        '마지막 글자가 같으면 `dp[i-1][j-1] + 1`, 다르면 `max(dp[i-1][j], dp[i][j-1])`.',
      ],
      concept: '두 문자열을 비교하는 DP 는 대부분 2차원 표를 채우는 형태예요. 표의 의미를 정확히 말로 정의하는 것이 점화식을 세우는 지름길이에요.',
      solution: String.raw`class Solution {
    public int solution(String a, String b) {
        int n = a.length(), m = b.length();
        int[][] dp = new int[n + 1][m + 1];
        for (int i = 1; i <= n; i++) {
            for (int j = 1; j <= m; j++) {
                if (a.charAt(i - 1) == b.charAt(j - 1)) dp[i][j] = dp[i - 1][j - 1] + 1;
                else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
        return dp[n][m];
    }
}
`,
      explain: '표를 왼쪽 위에서부터 채우고, 오른쪽 아래 칸이 답이에요. O(n·m).',
    },
    {
      id: 'dp-lis', category: 'dp', difficulty: 'hard', title: '꾸준히 오른 최장 기간',
      desc: '일별 활성 사용자 수 배열 `nums` 에서 **최장 증가 부분 수열(LIS)** 의 길이를 return 하세요. 부분 수열은 순서를 유지한 채 일부를 고른 것이고, 증가는 엄격하게(같은 값은 안 됨) 커지는 것을 말해요.',
      constraints: ['1 ≤ `nums` 의 길이 ≤ 100,000', '-1,000,000,000 ≤ `nums[i]` ≤ 1,000,000,000'],
      method: { name: 'solution', ret: 'int', params: [{ type: 'int[]', name: 'nums' }] },
      examples: [
        { args: [[10, 9, 2, 5, 3, 7, 101, 18]], expected: 4 },
        { args: [[7, 7, 7, 7]], expected: 1 },
      ],
      tests: [[[1]], [[1, 2]], [[2, 1]], [[0, 1, 0, 3, 2, 3]], [[1, 3, 6, 7, 9, 4, 10, 5, 6]], (R) => [R.arr(300, 1, 100)]],
      big: [{ label: 'n = 100,000', gen: (R) => [R.arr(100000, -1000000000, 1000000000)] }],
      ref: (nums) => { const t = []; for (const x of nums) { let lo = 0, hi = t.length; while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < x) lo = m + 1; else hi = m; } t[lo] = x; } return t.length; },
      hints: [
        '기본 DP `dp[i] = max(dp[j] + 1) (j < i, nums[j] < nums[i])` 는 O(n²) 이라 n = 100,000 에서 느려요.',
        '`tails[k]` = 길이 k+1 인 증가 수열들의 끝값 중 **가장 작은 값**. 이 배열은 항상 정렬돼 있어요.',
        '새 수 x 가 들어오면 tails 에서 x 이상인 첫 위치를 이분 탐색으로 찾아 x 로 바꿔요. 맨 끝이면 길이가 늘어나요.',
      ],
      concept: 'DP 를 세운 뒤 "이 표에서 정말 필요한 정보만 남기면?"을 고민하면 자료구조(이분 탐색, 세그먼트 트리 등)로 더 빠르게 만들 수 있어요. LIS O(n log n) 은 그 대표 예예요.',
      solution: String.raw`import java.util.*;

class Solution {
    public int solution(int[] nums) {
        int[] tails = new int[nums.length]; // tails[k] = 길이 k+1 증가 수열의 가장 작은 끝값
        int len = 0;
        for (int x : nums) {
            int pos = Arrays.binarySearch(tails, 0, len, x);
            if (pos < 0) pos = -(pos + 1);
            tails[pos] = x;
            if (pos == len) len++;
        }
        return len;
    }
}
`,
      explain: '`Arrays.binarySearch` 는 값이 없으면 `-(삽입 위치) - 1` 을 돌려줘요. 그 위치를 x 로 바꾸며 tails 를 유지해요. O(n log n).',
    },
    {
      id: 'dp-edit-distance', category: 'dp', difficulty: 'hard', title: '오타 교정 최소 편집',
      desc: '검색어 자동 교정을 만들고 있어요. 문자열 `a` 를 `b` 로 바꾸는 데 필요한 **최소 편집 횟수**를 return 하세요. 한 번의 편집은 문자 하나를 **삽입**, **삭제**, 또는 **다른 문자로 교체**하는 거예요.',
      constraints: ['0 ≤ `a`, `b` 의 길이 ≤ 1,000', '영어 소문자'],
      method: { name: 'solution', ret: 'int', params: [{ type: 'String', name: 'a' }, { type: 'String', name: 'b' }] },
      examples: [
        { args: ['horse', 'ros'], expected: 3 },
        { args: ['intention', 'execution'], expected: 5 },
      ],
      tests: [['', ''], ['', 'abc'], ['abc', ''], ['same', 'same'], ['kitten', 'sitting'], ['ab', 'ba'], (R) => [R.str(40, 'abc'), R.str(30, 'abc')]],
      big: [{ label: '길이 1,000 × 1,000', gen: (R) => [R.str(1000, 'abcd'), R.str(1000, 'abcd')] }],
      ref: (a, b) => { const m = b.length; let prev = range(m + 1); for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= m; j++) cur[j] = Math.min(prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), prev[j] + 1, cur[j - 1] + 1); prev = cur; } return prev[m]; },
      hints: [
        '`dp[i][j]` = a 의 앞 i 글자를 b 의 앞 j 글자로 바꾸는 최소 편집 수.',
        '마지막 연산이 교체/유지 `dp[i-1][j-1] + (같으면 0, 다르면 1)`, 삭제 `dp[i-1][j] + 1`, 삽입 `dp[i][j-1] + 1` 중 최솟값.',
        '초기값: `dp[i][0] = i` (전부 삭제), `dp[0][j] = j` (전부 삽입).',
      ],
      concept: '편집 거리(레벤슈타인 거리)는 맞춤법 검사, DNA 비교, diff 도구의 기본 원리예요. 세 가지 선택지의 최솟값을 고르는 전형적인 2차원 DP 예요.',
      solution: String.raw`class Solution {
    public int solution(String a, String b) {
        int n = a.length(), m = b.length();
        int[][] dp = new int[n + 1][m + 1];
        for (int i = 0; i <= n; i++) dp[i][0] = i;
        for (int j = 0; j <= m; j++) dp[0][j] = j;
        for (int i = 1; i <= n; i++) {
            for (int j = 1; j <= m; j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                dp[i][j] = Math.min(dp[i - 1][j - 1] + cost, Math.min(dp[i - 1][j], dp[i][j - 1]) + 1);
            }
        }
        return dp[n][m];
    }
}
`,
      explain: '교체·삭제·삽입 세 경우의 최솟값으로 표를 채워요. O(n·m).',
    },

    /* ================= 힙·최단 경로·MST ================= */
    {
      id: 'adv-merge-cost', category: 'adv', difficulty: 'medium', title: '로그 파일 합치기 최소 비용',
      desc: '크기가 `sizes` 인 로그 파일들을 하나로 합치려고 해요. 두 파일(크기 a, b)을 합치면 비용이 **a + b** 들고, 합친 결과는 크기 a + b 인 파일 하나가 돼요. 모든 파일을 하나로 합치는 **최소 총비용**을 return 하세요. 파일이 하나면 0 이에요.',
      constraints: ['1 ≤ `sizes` 의 길이 ≤ 100,000', '1 ≤ `sizes[i]` ≤ 1,000', '답이 int 범위를 넘을 수 있어요.'],
      method: { name: 'solution', ret: 'long', params: [{ type: 'int[]', name: 'sizes' }] },
      examples: [
        { args: [[10, 20, 40]], expected: 100 },
        { args: [[5]], expected: 0 },
      ],
      tests: [[[1, 1]], [[3, 3, 3, 3]], [[40, 10, 20]], [[1, 2, 3, 4, 5]], (R) => [R.arr(200, 1, 1000)]],
      big: [{ label: 'n = 100,000', gen: (R) => [R.arr(100000, 1, 1000)] }],
      ref: (sizes) => { const h = new MinHeap(); sizes.forEach((x) => h.push(x)); let total = 0; while (h.size > 1) { const m = h.pop() + h.pop(); total += m; h.push(m); } return total; },
      hints: [
        '항상 **가장 작은 두 파일**을 먼저 합치는 게 최적이에요 (작은 값일수록 여러 번 더해지니까요).',
        '매번 정렬하면 O(n² log n). `PriorityQueue<Long>` 에 넣고 `poll()` 두 번, `offer()` 한 번을 반복하세요.',
        '합계가 int 를 넘으니 `long` 으로 다뤄요.',
      ],
      concept: '`PriorityQueue` 는 넣기/꺼내기 O(log n) 에 항상 최솟값을 꺼내 줘요. 최댓값이 필요하면 `new PriorityQueue<>(Collections.reverseOrder())` 를 써요. 허프만 코딩과 같은 원리예요.',
      solution: String.raw`import java.util.*;

class Solution {
    public long solution(int[] sizes) {
        PriorityQueue<Long> pq = new PriorityQueue<>();
        for (int s : sizes) pq.offer((long) s);
        long total = 0;
        while (pq.size() > 1) {
            long merged = pq.poll() + pq.poll();
            total += merged;
            pq.offer(merged);
        }
        return total;
    }
}
`,
      explain: '최소 힙에서 가장 작은 두 개를 꺼내 합치고 다시 넣기를 반복해요. O(n log n).',
    },
    {
      id: 'adv-dijkstra', category: 'adv', difficulty: 'hard', title: '배송 거점 최단 거리',
      desc: '배송 거점 `n` 개(0 ~ n-1)가 도로 `roads` 로 이어져 있어요. 각 원소 `[u, v, w]` 는 u 와 v 사이에 길이 w 인 양방향 도로가 있다는 뜻이에요. 거점 `start` 에서 각 거점까지의 **최단 거리**를 배열로 return 하세요. 갈 수 없는 거점은 -1 이에요.',
      constraints: ['1 ≤ `n` ≤ 20,000', '0 ≤ `roads` 의 길이 ≤ 100,000', '1 ≤ w ≤ 10,000, 같은 두 거점 사이에 도로가 여러 개일 수 있어요.'],
      method: { name: 'solution', ret: 'int[]', params: [{ type: 'int', name: 'n' }, { type: 'int[][]', name: 'roads' }, { type: 'int', name: 'start' }] },
      examples: [
        { args: [5, [[0, 1, 4], [0, 2, 1], [2, 1, 2], [1, 3, 1], [2, 3, 5]], 0], expected: [0, 3, 1, 4, -1] },
        { args: [3, [[0, 1, 7]], 2], expected: [-1, -1, 0] },
      ],
      tests: [[1, [], 0], [2, [[0, 1, 5], [0, 1, 3]], 1], [4, [[0, 1, 1], [1, 2, 1], [2, 3, 1], [0, 3, 10]], 0], (R) => [30, range(60).map(() => [R.int(0, 29), R.int(0, 29), R.int(1, 50)]), 0]],
      big: [{ label: '거점 20,000 개, 도로 100,000 개', gen: (R) => [20000, range(100000).map(() => [R.int(0, 19999), R.int(0, 19999), R.int(1, 10000)]), 0] }],
      ref: (n, roads, start) => {
        const g = range(n).map(() => []); for (const [u, v, w] of roads) { g[u].push([v, w]); g[v].push([u, w]); }
        const dist = new Array(n).fill(Infinity); dist[start] = 0; const h = new MinHeap((x, y) => x[0] < y[0]); h.push([0, start]);
        while (h.size) { const [d, u] = h.pop(); if (d > dist[u]) continue; for (const [v, w] of g[u]) if (d + w < dist[v]) { dist[v] = d + w; h.push([dist[v], v]); } }
        return dist.map((d) => (d === Infinity ? -1 : d));
      },
      hints: [
        '가중치가 있는 최단 거리는 BFS 로 안 돼요. **다익스트라**: 아직 확정되지 않은 거점 중 가장 가까운 것을 꺼내 이웃을 갱신해요.',
        '가장 가까운 거점을 매번 배열에서 찾으면 O(n²). `PriorityQueue<int[]>` 에 `{거점, 거리}` 를 넣으면 O(m log n).',
        '꺼낸 거리가 이미 기록된 최단 거리보다 크면 오래된 항목이니 건너뛰어요.',
      ],
      concept: '다익스트라는 "음수 가중치가 없을 때" 성립해요. 자바에서는 `PriorityQueue<int[]> pq = new PriorityQueue<>((x, y) -> Integer.compare(x[1], y[1]));` 형태가 정석이에요.',
      solution: String.raw`import java.util.*;

class Solution {
    public int[] solution(int n, int[][] roads, int start) {
        List<List<int[]>> graph = new ArrayList<>();
        for (int i = 0; i < n; i++) graph.add(new ArrayList<>());
        for (int[] r : roads) {
            graph.get(r[0]).add(new int[]{r[1], r[2]});
            graph.get(r[1]).add(new int[]{r[0], r[2]});
        }
        int[] dist = new int[n];
        Arrays.fill(dist, Integer.MAX_VALUE);
        dist[start] = 0;
        PriorityQueue<int[]> pq = new PriorityQueue<>((x, y) -> Integer.compare(x[1], y[1]));
        pq.offer(new int[]{start, 0});
        while (!pq.isEmpty()) {
            int[] cur = pq.poll();
            int u = cur[0];
            if (cur[1] > dist[u]) continue; // 이미 더 짧은 거리로 처리됨
            for (int[] e : graph.get(u)) {
                int nd = dist[u] + e[1];
                if (nd < dist[e[0]]) {
                    dist[e[0]] = nd;
                    pq.offer(new int[]{e[0], nd});
                }
            }
        }
        for (int i = 0; i < n; i++) if (dist[i] == Integer.MAX_VALUE) dist[i] = -1;
        return dist;
    }
}
`,
      explain: '우선순위 큐로 가장 가까운 거점부터 확정하며 이웃 거리를 줄여 나가요. O((n + m) log n).',
    },
    {
      id: 'adv-topo', category: 'adv', difficulty: 'hard', title: '마이그레이션 실행 순서',
      desc: 'DB 마이그레이션 `n` 개(0 ~ n-1)를 실행하려고 해요. `prereq` 의 각 원소 `[a, b]` 는 **a 를 먼저 실행해야 b 를 실행**할 수 있다는 뜻이에요. 가능한 실행 순서 중, 실행할 수 있는 것이 여러 개면 **번호가 작은 것부터** 실행한 순서를 return 하세요. 순환 의존이 있어서 모두 실행할 수 없으면 빈 배열을 return 해요.',
      constraints: ['1 ≤ `n` ≤ 100,000', '0 ≤ `prereq` 의 길이 ≤ 200,000', '0 ≤ a, b < n, a ≠ b'],
      method: { name: 'solution', ret: 'int[]', params: [{ type: 'int', name: 'n' }, { type: 'int[][]', name: 'prereq' }] },
      examples: [
        { args: [4, [[0, 1], [0, 2], [1, 3], [2, 3]]], expected: [0, 1, 2, 3] },
        { args: [3, [[2, 0], [2, 1]]], expected: [2, 0, 1] },
        { args: [2, [[0, 1], [1, 0]]], expected: [] },
      ],
      tests: [[1, []], [3, []], [3, [[1, 0]]], [5, [[4, 3], [3, 2], [2, 1], [1, 0]]], [4, [[0, 1], [1, 2], [2, 1], [0, 3]]], (R) => { const p = R.shuffle(range(30)); return [30, range(50).map(() => { const i = R.int(0, 28); return [p[i], p[R.int(i + 1, 29)]]; })]; }],
      big: [{ label: 'n = 100,000, 관계 200,000 개', gen: (R) => { const n = 100000; const p = R.shuffle(range(n)); return [n, range(200000).map(() => { const i = R.int(0, n - 2); return [p[i], p[R.int(i + 1, Math.min(n - 1, i + 50))]]; })]; } }],
      ref: (n, prereq) => {
        const nx = range(n).map(() => []); const indeg = new Array(n).fill(0);
        for (const [a, b] of prereq) { nx[a].push(b); indeg[b]++; }
        const h = new MinHeap(); for (let i = 0; i < n; i++) if (!indeg[i]) h.push(i);
        const out = []; while (h.size) { const u = h.pop(); out.push(u); for (const v of nx[u]) if (--indeg[v] === 0) h.push(v); }
        return out.length === n ? out : [];
      },
      hints: [
        '**위상 정렬**: 선행 작업 수(진입 차수)가 0 인 작업부터 실행하고, 실행한 작업이 풀어 주는 작업의 진입 차수를 줄여요.',
        '"번호가 작은 것부터" 조건 때문에 일반 큐 대신 `PriorityQueue<Integer>` 를 써요.',
        '끝까지 꺼낸 작업 수가 n 보다 적으면 순환이 있다는 뜻이에요.',
      ],
      concept: '의존 관계(빌드 순서, 선수 과목, 패키지 설치)는 방향 그래프의 위상 정렬로 풀어요. 칸 알고리즘(Kahn)은 진입 차수 배열과 큐만 있으면 돼요.',
      solution: String.raw`import java.util.*;

class Solution {
    public int[] solution(int n, int[][] prereq) {
        List<List<Integer>> next = new ArrayList<>();
        for (int i = 0; i < n; i++) next.add(new ArrayList<>());
        int[] indeg = new int[n];
        for (int[] p : prereq) {
            next.get(p[0]).add(p[1]);
            indeg[p[1]]++;
        }
        PriorityQueue<Integer> pq = new PriorityQueue<>();
        for (int i = 0; i < n; i++) if (indeg[i] == 0) pq.offer(i);
        int[] order = new int[n];
        int idx = 0;
        while (!pq.isEmpty()) {
            int cur = pq.poll();
            order[idx++] = cur;
            for (int nx : next.get(cur)) {
                if (--indeg[nx] == 0) pq.offer(nx);
            }
        }
        return idx == n ? order : new int[0];
    }
}
`,
      explain: '진입 차수 0 인 작업을 최소 힙에 넣고, 꺼낼 때마다 이웃의 진입 차수를 줄여요. O((n + m) log n).',
    },
    {
      id: 'adv-mst', category: 'adv', difficulty: 'hard', title: '최소 비용으로 지점 연결',
      desc: '회사 지점 `n` 개(0 ~ n-1)를 전용선으로 연결하려고 해요. `links` 의 각 원소 `[a, b, cost]` 는 a 와 b 를 잇는 비용이에요. 모든 지점이 (직접 또는 다른 지점을 거쳐) 연결되도록 할 때 **최소 총비용**을 return 하세요. 항상 모두 연결할 수 있게 주어져요.',
      constraints: ['1 ≤ `n` ≤ 20,000', 'n - 1 ≤ `links` 의 길이 ≤ 100,000', '1 ≤ cost ≤ 100,000', '답이 int 범위를 넘을 수 있어요.'],
      method: { name: 'solution', ret: 'long', params: [{ type: 'int', name: 'n' }, { type: 'int[][]', name: 'links' }] },
      examples: [
        { args: [4, [[0, 1, 1], [0, 2, 2], [1, 2, 5], [1, 3, 1], [2, 3, 8]]], expected: 4 },
        { args: [1, []], expected: 0 },
      ],
      tests: [[2, [[0, 1, 9]]], [3, [[0, 1, 1], [1, 2, 1], [0, 2, 1]]], [3, [[0, 1, 5], [0, 1, 2], [1, 2, 3]]], (R) => { const n = 30; const e = range(n - 1).map((i) => [i + 1, R.int(0, i), R.int(1, 100)]); range(40).forEach(() => e.push([R.int(0, n - 1), R.int(0, n - 1), R.int(1, 100)])); return [n, e]; }],
      big: [{ label: '지점 20,000 개, 전용선 100,000 개', gen: (R) => { const n = 20000; const e = range(n - 1).map((i) => [i + 1, R.int(0, i), R.int(1, 100000)]); while (e.length < 100000) e.push([R.int(0, n - 1), R.int(0, n - 1), R.int(1, 100000)]); return [n, R.shuffle(e)]; } }],
      ref: (n, links) => { const par = range(n); const f = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; }; let total = 0; for (const [a, b, c] of links.slice().sort((x, y) => x[2] - y[2])) { const x = f(a), y = f(b); if (x !== y) { par[x] = y; total += c; } } return total; },
      hints: [
        '**크루스칼**: 비용이 싼 전용선부터 보면서, 아직 연결되지 않은 두 지점을 잇는 선만 골라요.',
        '"이미 연결됐나?"는 유니온 파인드(`find`, `union`)로 거의 O(1) 에 확인해요.',
        '`find` 를 재귀로 짜면 깊이가 깊어질 수 있어요. 경로 압축을 반복문으로 구현하면 안전해요.',
      ],
      concept: '최소 신장 트리(MST)는 크루스칼(간선 정렬 + 유니온 파인드)이나 프림(우선순위 큐)으로 구해요. 유니온 파인드는 "같은 그룹인가?"를 빠르게 답하는 자료구조로, 그래프 문제 곳곳에 쓰여요.',
      solution: String.raw`import java.util.*;

class Solution {
    int[] parent;

    public long solution(int n, int[][] links) {
        parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        Arrays.sort(links, (a, b) -> Integer.compare(a[2], b[2]));
        long total = 0;
        int used = 0;
        for (int[] e : links) {
            int a = find(e[0]), b = find(e[1]);
            if (a == b) continue;
            parent[a] = b;
            total += e[2];
            if (++used == n - 1) break;
        }
        return total;
    }

    int find(int x) {
        while (parent[x] != x) {
            parent[x] = parent[parent[x]]; // 경로 압축
            x = parent[x];
        }
        return x;
    }
}
`,
      explain: '간선을 비용 순으로 정렬하고, 사이클을 만들지 않는 간선만 n − 1 개 골라요. O(m log m).',
    },

    /* ================= 완전 탐색·백트래킹 ================= */
    {
      id: 'brute-target-sum', category: 'brute', difficulty: 'medium', title: '부호를 붙여 목표 점수 만들기',
      desc: '숫자 배열 `numbers` 의 각 수 앞에 `+` 또는 `-` 를 붙여(순서는 그대로) 모두 더했을 때 `target` 이 되는 **방법의 수**를 return 하세요.',
      constraints: ['1 ≤ `numbers` 의 길이 ≤ 20', '1 ≤ `numbers[i]` ≤ 50', '-1,000 ≤ `target` ≤ 1,000'],
      method: { name: 'solution', ret: 'int', params: [{ type: 'int[]', name: 'numbers' }, { type: 'int', name: 'target' }] },
      examples: [
        { args: [[1, 1, 1, 1, 1], 3], expected: 5 },
        { args: [[4, 1, 2, 1], 4], expected: 2 },
      ],
      tests: [[[1], 1], [[1], 2], [[2, 2], 0], [[1, 2, 3], 7], (R) => [R.arr(15, 1, 10), R.int(-20, 20)], () => [new Array(20).fill(1), 0]],
      ref: (nums, target) => { let ways = new Map([[0, 1]]); for (const x of nums) { const nx = new Map(); for (const [s, c] of ways) { nx.set(s + x, (nx.get(s + x) || 0) + c); nx.set(s - x, (nx.get(s - x) || 0) + c); } ways = nx; } return ways.get(target) || 0; },
      hints: [
        '수가 최대 20 개라 경우는 2²⁰ ≈ 100만 가지 — 전부 봐도 충분해요.',
        '`dfs(인덱스, 지금까지의 합)` 재귀로, 각 수에서 + 와 − 두 갈래로 내려가요. 끝까지 갔을 때 합이 target 이면 1 을 돌려줘요.',
      ],
      concept: '입력이 작을 때(보통 n ≤ 20)는 모든 경우를 재귀로 다 보는 완전 탐색이 가장 단순하고 확실해요. 제한사항의 숫자 크기로 풀이 방향을 정하는 연습을 해 보세요.',
      solution: String.raw`class Solution {
    int[] numbers;
    int target;

    public int solution(int[] numbers, int target) {
        this.numbers = numbers;
        this.target = target;
        return dfs(0, 0);
    }

    int dfs(int i, int sum) {
        if (i == numbers.length) return sum == target ? 1 : 0;
        return dfs(i + 1, sum + numbers[i]) + dfs(i + 1, sum - numbers[i]);
    }
}
`,
      explain: '각 수마다 + / − 두 갈래로 재귀하고, 끝에서 합을 확인해요. O(2ⁿ).',
    },
    {
      id: 'brute-n-queen', category: 'brute', difficulty: 'hard', title: 'N-Queen 서버 배치',
      desc: 'n × n 격자에 서버 n 대를 배치하려고 해요. 간섭을 피하려면 어떤 두 서버도 **같은 행, 같은 열, 같은 대각선**에 있으면 안 돼요 (체스의 퀸처럼). 가능한 배치 방법의 수를 return 하세요.',
      constraints: ['1 ≤ `n` ≤ 11'],
      method: { name: 'solution', ret: 'int', params: [{ type: 'int', name: 'n' }] },
      examples: [
        { args: [4], expected: 2 },
        { args: [1], expected: 1 },
      ],
      tests: [[2], [3], [5], [6], [8], [9]],
      big: [{ label: 'n = 11', gen: () => [11] }],
      ref: (n) => { let cnt = 0; const col = [], d1 = [], d2 = []; (function place(r) { if (r === n) { cnt++; return; } for (let c = 0; c < n; c++) { if (col[c] || d1[r + c] || d2[r - c + n]) continue; col[c] = d1[r + c] = d2[r - c + n] = true; place(r + 1); col[c] = d1[r + c] = d2[r - c + n] = false; } })(0); return cnt; },
      hints: [
        '한 행에 서버는 정확히 한 대예요. 0 행부터 차례로 "이 행의 몇 번 열에 둘까"를 재귀로 정해요.',
        '열, ↘ 대각선(`행 + 열` 이 같음), ↙ 대각선(`행 − 열` 이 같음) 사용 여부를 boolean 배열로 기억하면 O(1) 에 검사할 수 있어요.',
        '놓았다가 재귀에서 돌아오면 다시 false 로 되돌리는 것이 백트래킹이에요.',
      ],
      concept: '백트래킹은 "조건을 어기는 순간 그 가지를 더 내려가지 않는" 완전 탐색이에요. 상태를 바꾸고 → 재귀 → 되돌리기 패턴을 기억하세요.',
      solution: String.raw`class Solution {
    int n, count;
    boolean[] col, diag1, diag2;

    public int solution(int n) {
        this.n = n;
        col = new boolean[n];
        diag1 = new boolean[2 * n];
        diag2 = new boolean[2 * n];
        place(0);
        return count;
    }

    void place(int row) {
        if (row == n) {
            count++;
            return;
        }
        for (int c = 0; c < n; c++) {
            if (col[c] || diag1[row + c] || diag2[row - c + n]) continue;
            col[c] = diag1[row + c] = diag2[row - c + n] = true;
            place(row + 1);
            col[c] = diag1[row + c] = diag2[row - c + n] = false;
        }
    }
}
`,
      explain: '행마다 가능한 열을 고르고, 열·대각선 사용 표시로 가지치기해요.',
    },
  ];

  root.ALGO_DATA = { CATEGORIES, PROBLEMS };
})(typeof window !== 'undefined' ? window : globalThis);
