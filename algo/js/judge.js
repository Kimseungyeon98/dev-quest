/* Algorithm Quest 채점기.
 * - 사용자 코드의 반복문 조건과 메서드 시작에 시간 검사(__T.c())를 끼워 넣어 무한 루프·시간 초과를 잡는다
 * - 채점용 자바 코드를 만든다: 모든 문제가 같이 쓰는 JudgeCore.java (입력 JSON 을 읽어 케이스별로 실행하고 결과를 JSON 으로 쓴다)
 *   + 문제의 메서드 시그니처로 solution 을 부르는 짧은 Judge.java
 * - 채점 케이스(예제/정확성/효율성)를 만들고 결과를 비교한다
 * 브라우저(app.js)와 Node 검증 스크립트(tools/validate-problems.js)가 함께 써요. */
(function (root) {
  'use strict';

  /* ============================================================
   * 시드 난수 (큰 테스트 입력 생성용 — 매번 같은 입력이 나온다)
   * ========================================================== */
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRand(seed) {
    const next = mulberry32(seed);
    const R = {
      next,
      int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
      arr: (n, lo, hi) => Array.from({ length: n }, () => R.int(lo, hi)),
      str: (n, alphabet) => { let s = ''; for (let i = 0; i < n; i++) s += alphabet[Math.floor(next() * alphabet.length)]; return s; },
      pick: (a) => a[Math.floor(next() * a.length)],
      shuffle: (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
    };
    return R;
  }

  const clone = (v) => JSON.parse(JSON.stringify(v));

  /* 채점 케이스. mode: 'run' (예제만) | 'submit' (예제 + 정확성 + 효율성)
   * tests 항목은 인자 배열이거나, 시드 난수를 받아 인자 배열을 돌려주는 함수예요. */
  function buildCases(p, mode) {
    const limit = p.limitMs || DEFAULT_LIMIT_MS;
    const cases = p.examples.map((e, i) => ({ kind: 'example', label: `예제 ${i + 1}`, args: e.args, expected: e.expected, limit }));
    if (mode !== 'submit') return cases;
    (p.tests || []).forEach((t, i) => {
      const args = typeof t === 'function' ? t(makeRand(100 + i)) : t;
      cases.push({ kind: 'test', label: `정확성 ${i + 1}`, args, expected: p.ref(...clone(args)), limit });
    });
    (p.big || []).forEach((b, i) => {
      const args = b.gen(makeRand(1000 + i));
      cases.push({ kind: 'big', label: `효율성 ${i + 1}`, note: b.label, args, expected: p.ref(...clone(args)), limit: b.limitMs || limit });
    });
    return cases;
  }
  const DEFAULT_LIMIT_MS = 3000;

  function sameValue(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  /* 화면에 보여 줄 값 (너무 길면 자른다) */
  function formatValue(v, max) {
    const s = JSON.stringify(v, null, 0).replace(/,/g, ', ');
    const limit = max || 300;
    return s.length > limit ? s.slice(0, limit) + ` … (총 ${s.length.toLocaleString()}자)` : s;
  }

  /* ============================================================
   * 시그니처 → 시작 코드 / Judge.java
   * ========================================================== */
  const CONV = {
    int: 'J.i', long: 'J.l', double: 'J.d', boolean: 'J.z', char: 'J.c', String: 'J.s',
    'int[]': 'J.i1', 'long[]': 'J.l1', 'double[]': 'J.d1', 'boolean[]': 'J.z1', 'char[]': 'J.c1', 'String[]': 'J.s1',
    'int[][]': 'J.i2', 'long[][]': 'J.l2', 'char[][]': 'J.c2', 'String[][]': 'J.s2',
  };
  function defaultValue(type) {
    if (type === 'boolean') return 'false';
    if (type === 'String') return '""';
    if (type === 'char') return "' '";
    if (type === 'double') return '0.0';
    if (type.endsWith('[][]')) return `new ${type.slice(0, -4)}[0][0]`;
    if (type.endsWith('[]')) return `new ${type.slice(0, -2)}[0]`;
    return '0';
  }
  function starterCode(p) {
    const m = p.method;
    const params = m.params.map((x) => `${x.type} ${x.name}`).join(', ');
    return `import java.util.*;

class Solution {
    public ${m.ret} ${m.name}(${params}) {
        ${m.ret} answer = ${defaultValue(m.ret)};
        return answer;
    }
}
`;
  }

  /* 모든 문제가 같이 쓰는 채점 코드 JudgeCore.java (입력 JSON 읽기, 케이스별 실행·시간 검사, 결과 JSON 쓰기).
   * 브라우저에서는 한 번만 컴파일해서 저장해 두고, 매번은 사용자 코드와 짧은 Judge.java 만 컴파일해요.
   * 내용을 고치면 JUDGE_LIB_VERSION 을 올려야 저장된 옛 .class 대신 새로 컴파일돼요.
   * String.raw 라서 역슬래시가 그대로 들어가요 (자바 코드 안에 ${ 를 쓰지 않도록 주의). */
  const JUDGE_LIB_VERSION = 1;
  const JUDGE_LIB = String.raw`import java.io.*;
import java.lang.reflect.Array;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public final class JudgeCore {
    /* 문제마다 만드는 Judge.java 가 넘겨주는 호출: 인자 목록 → new Solution().solution(...) 의 결과 */
    public interface Call { Object call(List<Object> a) throws Throwable; }

    @SuppressWarnings("unchecked")
    public static void run(String[] args, Call call) throws Exception {
        String text = new String(Files.readAllBytes(Paths.get(args[0])), StandardCharsets.UTF_8);
        Map<String, Object> input = (Map<String, Object>) new J(text).value();
        List<Object> cases = (List<Object>) input.get("cases");
        PrintStream orig = System.out;
        StringBuilder sb = new StringBuilder("{\"token\":");
        J.str(sb, (String) input.get("token"));
        sb.append(",\"results\":[");
        int timeouts = 0;
        for (int t = 0; t < cases.size(); t++) {
            if (t > 0) sb.append(',');
            if (timeouts >= 2) { // 무한 루프일 가능성이 높아서 나머지는 기다리지 않는다
                sb.append("{\"s\":\"skip\",\"v\":null,\"ms\":0,\"out\":\"\",\"err\":null}");
                continue;
            }
            Map<String, Object> c = (Map<String, Object>) cases.get(t);
            List<Object> a = (List<Object>) c.get("a");
            long limit = ((Number) c.get("t")).longValue();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            System.setOut(new PrintStream(buf, true, "UTF-8"));
            String st = "ok", val = "null", err = null;
            long t0 = System.nanoTime();
            __T.arm(limit);
            try {
                Object r = call.call(a);
                __T.disarm();
                val = J.json(r);
            } catch (__T.Timeout e) {
                st = "timeout";
            } catch (StackOverflowError e) {
                __T.disarm(); st = "error"; err = "StackOverflowError: 재귀 호출이 너무 깊어요" + where(e);
            } catch (OutOfMemoryError e) {
                __T.disarm(); st = "error"; err = "OutOfMemoryError: 메모리가 부족해요";
            } catch (Throwable e) {
                __T.disarm(); st = "error"; err = e.toString() + where(e);
            }
            double ms = (System.nanoTime() - t0) / 1e6;
            if (st.equals("ok") && ms > limit) st = "timeout";
            if (st.equals("timeout")) timeouts++;
            System.out.flush();
            System.setOut(orig);
            String out = new String(buf.toByteArray(), StandardCharsets.UTF_8);
            if (out.length() > 4000) out = out.substring(0, 4000) + "\n... (출력이 너무 길어서 잘랐어요)";
            sb.append("{\"s\":\"").append(st).append("\",\"v\":").append(val).append(",\"ms\":").append(Math.round(ms * 100) / 100.0);
            sb.append(",\"out\":"); J.str(sb, out);
            sb.append(",\"err\":"); if (err == null) sb.append("null"); else J.str(sb, err);
            sb.append('}');
        }
        sb.append("]}");
        Files.write(Paths.get(args[1]), sb.toString().getBytes(StandardCharsets.UTF_8));
    }

    /* 예외가 난 사용자 코드 위치 (Solution.java 의 첫 번째 줄) */
    static String where(Throwable e) {
        for (StackTraceElement f : e.getStackTrace()) {
            if ("Solution.java".equals(f.getFileName()) && f.getLineNumber() > 0) return " (Solution.java " + f.getLineNumber() + "번째 줄, " + f.getMethodName() + ")";
        }
        return "";
    }
}

/* 시간 검사: 반복문 조건과 메서드 시작에 끼워 넣은 __T.c() 가 제한 시간을 넘기면 Timeout 을 던진다 */
final class __T {
    static final class Timeout extends Error {
        Timeout() { super("time limit exceeded", null, false, false); }
    }
    static long deadline = Long.MAX_VALUE;
    static int n;
    static void arm(long ms) { n = 0; deadline = System.nanoTime() + ms * 1_000_000L; }
    static void disarm() { deadline = Long.MAX_VALUE; }
    static boolean c() {
        if ((++n & 1023) == 0 && System.nanoTime() > deadline) throw new Timeout();
        return true;
    }
}

/* 아주 작은 JSON 읽기/쓰기 + 매개변수 타입 변환 */
final class J {
    private final String s;
    private int p;
    J(String s) { this.s = s; }

    Object value() {
        ws();
        char ch = s.charAt(p);
        if (ch == '{') {
            p++;
            Map<String, Object> m = new LinkedHashMap<>();
            ws();
            if (s.charAt(p) == '}') { p++; return m; }
            while (true) {
                String k = (String) value();
                ws(); p++; // ':'
                m.put(k, value());
                ws();
                if (s.charAt(p++) == '}') return m;
            }
        }
        if (ch == '[') {
            p++;
            List<Object> l = new ArrayList<>();
            ws();
            if (s.charAt(p) == ']') { p++; return l; }
            while (true) {
                l.add(value());
                ws();
                if (s.charAt(p++) == ']') return l;
            }
        }
        if (ch == '"') {
            p++;
            StringBuilder b = new StringBuilder();
            while (true) {
                char c = s.charAt(p++);
                if (c == '"') return b.toString();
                if (c != '\\') { b.append(c); continue; }
                char e = s.charAt(p++);
                switch (e) {
                    case 'n': b.append('\n'); break;
                    case 't': b.append('\t'); break;
                    case 'r': b.append('\r'); break;
                    case 'b': b.append('\b'); break;
                    case 'f': b.append('\f'); break;
                    case 'u': b.append((char) Integer.parseInt(s.substring(p, p + 4), 16)); p += 4; break;
                    default: b.append(e);
                }
            }
        }
        if (s.startsWith("true", p)) { p += 4; return Boolean.TRUE; }
        if (s.startsWith("false", p)) { p += 5; return Boolean.FALSE; }
        if (s.startsWith("null", p)) { p += 4; return null; }
        int st = p;
        while (p < s.length() && "+-0123456789.eE".indexOf(s.charAt(p)) >= 0) p++;
        String num = s.substring(st, p);
        if (num.indexOf('.') >= 0 || num.indexOf('e') >= 0 || num.indexOf('E') >= 0) return Double.parseDouble(num);
        return Long.parseLong(num);
    }
    private void ws() { while (p < s.length() && s.charAt(p) <= ' ') p++; }

    @SuppressWarnings("unchecked")
    static List<Object> list(Object o) { return (List<Object>) o; }
    static int i(Object o) { return ((Number) o).intValue(); }
    static long l(Object o) { return ((Number) o).longValue(); }
    static double d(Object o) { return ((Number) o).doubleValue(); }
    static boolean z(Object o) { return (Boolean) o; }
    static char c(Object o) { return ((String) o).charAt(0); }
    static String s(Object o) { return (String) o; }
    static int[] i1(Object o) { List<Object> l = list(o); int[] r = new int[l.size()]; for (int k = 0; k < r.length; k++) r[k] = i(l.get(k)); return r; }
    static long[] l1(Object o) { List<Object> l = list(o); long[] r = new long[l.size()]; for (int k = 0; k < r.length; k++) r[k] = l(l.get(k)); return r; }
    static double[] d1(Object o) { List<Object> l = list(o); double[] r = new double[l.size()]; for (int k = 0; k < r.length; k++) r[k] = d(l.get(k)); return r; }
    static boolean[] z1(Object o) { List<Object> l = list(o); boolean[] r = new boolean[l.size()]; for (int k = 0; k < r.length; k++) r[k] = z(l.get(k)); return r; }
    static char[] c1(Object o) {
        if (o instanceof String) return ((String) o).toCharArray();
        List<Object> l = list(o); char[] r = new char[l.size()]; for (int k = 0; k < r.length; k++) r[k] = c(l.get(k)); return r;
    }
    static String[] s1(Object o) { List<Object> l = list(o); String[] r = new String[l.size()]; for (int k = 0; k < r.length; k++) r[k] = s(l.get(k)); return r; }
    static int[][] i2(Object o) { List<Object> l = list(o); int[][] r = new int[l.size()][]; for (int k = 0; k < r.length; k++) r[k] = i1(l.get(k)); return r; }
    static long[][] l2(Object o) { List<Object> l = list(o); long[][] r = new long[l.size()][]; for (int k = 0; k < r.length; k++) r[k] = l1(l.get(k)); return r; }
    static char[][] c2(Object o) { List<Object> l = list(o); char[][] r = new char[l.size()][]; for (int k = 0; k < r.length; k++) r[k] = c1(l.get(k)); return r; }
    static String[][] s2(Object o) { List<Object> l = list(o); String[][] r = new String[l.size()][]; for (int k = 0; k < r.length; k++) r[k] = s1(l.get(k)); return r; }

    static String json(Object o) { StringBuilder b = new StringBuilder(); w(b, o); return b.toString(); }
    static void w(StringBuilder b, Object o) {
        if (o == null) b.append("null");
        else if (o instanceof String || o instanceof Character) str(b, o.toString());
        else if (o instanceof Boolean || o instanceof Integer || o instanceof Long || o instanceof Short || o instanceof Byte
                || o instanceof java.math.BigInteger || o instanceof java.math.BigDecimal) b.append(o);
        else if (o instanceof Number) {
            double v = ((Number) o).doubleValue();
            if (Double.isNaN(v) || Double.isInfinite(v)) str(b, String.valueOf(v)); else b.append(v);
        } else if (o.getClass().isArray()) {
            b.append('[');
            int n = Array.getLength(o);
            for (int k = 0; k < n; k++) { if (k > 0) b.append(','); w(b, Array.get(o, k)); }
            b.append(']');
        } else if (o instanceof Collection) {
            b.append('[');
            boolean first = true;
            for (Object x : (Collection<?>) o) { if (!first) b.append(','); first = false; w(b, x); }
            b.append(']');
        } else if (o instanceof Map) {
            b.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) {
                if (!first) b.append(',');
                first = false;
                str(b, String.valueOf(e.getKey())); b.append(':'); w(b, e.getValue());
            }
            b.append('}');
        } else str(b, o.toString());
    }
    static void str(StringBuilder b, String s) {
        b.append('"');
        for (int k = 0; k < s.length(); k++) {
            char c = s.charAt(k);
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c == '\n') b.append("\\n");
            else if (c == '\r') b.append("\\r");
            else if (c == '\t') b.append("\\t");
            else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        b.append('"');
    }
}
`;

  /* 문제마다 만드는 짧은 Judge.java: 인자를 매개변수 타입으로 바꿔 solution 을 부르고 나머지는 JudgeCore 에 맡긴다 */
  function judgeSource(p) {
    const m = p.method;
    const args = m.params.map((x, i) => {
      if (!CONV[x.type]) throw new Error(`지원하지 않는 매개변수 타입: ${x.type} (${p.id})`);
      return `${CONV[x.type]}(a.get(${i}))`;
    }).join(', ');
    return `public class Judge {
    public static void main(String[] args) throws Exception {
        JudgeCore.run(args, a -> new Solution().${m.name}(${args}));
    }
}
`;
  }

  /* 채점 입력 파일 내용 */
  function judgeInput(cases, token) {
    return JSON.stringify({ token, cases: cases.map((c) => ({ a: c.args, t: c.limit })) });
  }

  /* 채점 결과(Judge 가 쓴 JSON)와 케이스를 맞춰 통과 여부를 정한다 */
  function grade(cases, results) {
    return cases.map((c, i) => {
      const r = results[i] || { s: 'error', v: null, ms: 0, out: '', err: '결과가 없어요' };
      const pass = r.s === 'ok' && sameValue(r.v, c.expected);
      const status = r.s === 'ok' ? (pass ? 'pass' : 'fail') : r.s; // pass | fail | timeout | error | skip
      return { ...c, status, pass, actual: r.v, ms: r.ms, out: r.out, err: r.err };
    });
  }

  /* ============================================================
   * 자바 소스 계측 (시간 검사 끼워 넣기)
   * ========================================================== */
  /* 문자열·문자·주석은 건너뛰고 식별자/기호 토큰과 위치(s~e)를 돌려준다 */
  function lexJava(src) {
    const toks = [];
    const n = src.length;
    let i = 0;
    while (i < n) {
      const ch = src[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
      if (ch === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (ch === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
      if (src.startsWith('"""', i)) { const e = src.indexOf('"""', i + 3); const end = e < 0 ? n : e + 3; toks.push({ v: '"', type: 'lit', s: i, e: end }); i = end; continue; }
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < n && src[j] !== ch && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
        toks.push({ v: ch, type: 'lit', s: i, e: j + 1 });
        i = j + 1;
        continue;
      }
      if (/[A-Za-z_$]/.test(ch)) {
        let j = i + 1;
        while (j < n && /[\w$]/.test(src[j])) j++;
        toks.push({ v: src.slice(i, j), type: 'id', s: i, e: j });
        i = j;
        continue;
      }
      if (/[0-9]/.test(ch)) {
        let j = i + 1;
        while (j < n && /[\w.]/.test(src[j])) j++;
        toks.push({ v: src.slice(i, j), type: 'num', s: i, e: j });
        i = j;
        continue;
      }
      const two = src.slice(i, i + 2);
      if (two === '->' || two === '::') { toks.push({ v: two, type: 'op', s: i, e: i + 2 }); i += 2; continue; }
      toks.push({ v: ch, type: 'op', s: i, e: i + 1 });
      i++;
    }
    return toks;
  }

  const CHECK = '__T.c()';
  const NOT_METHOD = new Set(['if', 'for', 'while', 'switch', 'catch', 'synchronized', 'try', 'return', 'new', 'throw', 'else', 'case', 'assert', 'super', 'this']);

  /* 반복문·메서드·생성자 본문 시작에 `__T.c();` 를 끼워 넣는다. 본문이 { 로 시작하지 않는 반복문
   * (for (...) for (...) if ... 처럼) 은 조건에 `__T.c() && (...)` 를 넣는다. while (true) / for (;;) 의 조건은
   * 건드리지 않는다 — 조건이 상수가 아니게 되면 javac 가 "missing return statement" 를 내기 때문이에요.
   * 줄바꿈은 넣지 않아서 줄 번호는 원본과 같다. 돌려주는 inserts 로 컴파일 오류의 열 위치를 원본 기준으로 되돌린다. */
  function instrument(src) {
    const toks = lexJava(src);
    const ins = [];
    const matchParen = (k) => {
      let d = 0;
      for (let j = k; j < toks.length; j++) {
        if (toks[j].v === '(') d++;
        else if (toks[j].v === ')' && --d === 0) return j;
      }
      return -1;
    };
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.type === 'id' && t.v === 'do' && toks[k + 1] && toks[k + 1].v === '{') {
        ins.push({ at: toks[k + 1].e, text: ' ' + CHECK + ';' });
        continue;
      }
      if (t.type === 'id' && (t.v === 'while' || t.v === 'for') && toks[k + 1] && toks[k + 1].v === '(') {
        const open = k + 1;
        const close = matchParen(open);
        if (close < 0) continue;
        const body = toks[close + 1];
        if (body && body.v === '{') { ins.push({ at: body.e, text: ' ' + CHECK + ';' }); continue; }
        // 본문이 블록이 아니면 조건에 넣는다 (do-while 의 끝 while (...); 도 여기로 와요)
        let condFrom = open + 1, condTo = close; // 조건 토큰 범위 [condFrom, condTo)
        if (t.v === 'for') {
          const semis = [];
          let d = 0;
          for (let j = open + 1; j < close; j++) {
            const v = toks[j].v;
            if (v === '(' || v === '[' || v === '{') d++;
            else if (v === ')' || v === ']' || v === '}') d--;
            else if (v === ';' && d === 0) semis.push(j);
          }
          if (semis.length !== 2) continue; // for-each 는 끝이 정해져 있어요
          [condFrom, condTo] = [semis[0] + 1, semis[1]];
        }
        const cond = toks.slice(condFrom, condTo).map((x) => x.v).join('');
        if (cond === '' || cond === 'true') continue;
        ins.push({ at: toks[condFrom - 1].e, text: (t.v === 'for' ? ' ' : '') + CHECK + ' && (' }, { at: toks[condTo].s, text: ')' });
        continue;
      }
      // 메서드·생성자 선언: 이름 ( ... ) [throws A, B] {
      if (t.v === '(' && k > 0 && toks[k - 1].type === 'id' && !NOT_METHOD.has(toks[k - 1].v)) {
        const close = matchParen(k);
        if (close < 0) continue;
        let j = close + 1;
        if (toks[j] && toks[j].v === 'throws') {
          j++;
          while (toks[j] && (toks[j].type === 'id' || toks[j].v === '.' || toks[j].v === ',')) j++;
        }
        if (!toks[j] || toks[j].v !== '{') continue;
        let b = k - 1;
        while (b > 1 && toks[b - 1].v === '.') b -= 2;
        const before = toks[b - 1];
        if (before && (before.v === 'new' || before.v === 'record' || before.v === '.')) continue; // 익명 클래스, record 헤더
        const n1 = toks[j + 1], n2 = toks[j + 2];
        if (n1 && (n1.v === 'this' || n1.v === 'super') && n2 && n2.v === '(') continue; // this(...)/super(...) 는 첫 문장이어야 해요
        ins.push({ at: toks[j].e, text: ' ' + CHECK + ';' });
      }
    }
    ins.sort((x, y) => x.at - y.at);
    let out = '';
    let last = 0;
    ins.forEach((x) => { out += src.slice(last, x.at) + x.text; last = x.at; });
    out += src.slice(last);
    // 줄별 삽입 위치 (원본 열 기준)
    const byLine = {};
    ins.forEach((x) => {
      const before = src.slice(0, x.at);
      const line = before.split('\n').length;
      const col = x.at - (before.lastIndexOf('\n') + 1);
      (byLine[line] = byLine[line] || []).push({ col, len: x.text.length });
    });
    return { code: out, inserts: byLine };
  }

  /* 계측된 줄의 열 위치를 원본 열 위치로 바꾼다 */
  function originalCol(lineIns, col) {
    let shift = 0;
    for (const x of lineIns || []) {
      const s = x.col + shift;
      if (col < s) break;
      if (col < s + x.len) return x.col;
      shift += x.len;
    }
    return col - shift;
  }

  /* javac 출력 정리: 경로를 떼고, 계측된 소스 줄과 ^ 위치를 원본 기준으로 되돌린다.
   * Judge.java 쪽 오류(메서드 이름·매개변수를 바꾼 경우)는 알아보기 쉬운 안내로 바꾼다. */
  function cleanCompilerOutput(text, original, inserts, p) {
    const srcLines = original.split('\n');
    const lines = text.replace(/\r/g, '').split('\n');
    const out = [];
    let judgeError = false;
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].replace(/(^|\s)\/?(?:str|files\/algo)\//g, '$1');
      const m = /^Solution\.java:(\d+): /.exec(line);
      if (/^Judge\.java:\d+: /.test(line)) judgeError = true;
      out.push(line);
      if (m && i + 2 < lines.length && /^\s*\^\s*$/.test(lines[i + 2])) {
        const ln = Number(m[1]);
        const caret = lines[i + 2].indexOf('^');
        out.push(srcLines[ln - 1] !== undefined ? srcLines[ln - 1] : lines[i + 1]);
        out.push(' '.repeat(originalCol(inserts[ln], caret)) + '^');
        i += 2;
      }
    }
    let msg = out.join('\n').trim();
    if (judgeError) {
      const sig = `${p.method.ret} ${p.method.name}(${p.method.params.map((x) => `${x.type} ${x.name}`).join(', ')})`;
      msg = `⚠️ 채점용 코드가 Solution 을 호출하지 못했어요.\n클래스 이름(Solution)과 메서드 모양을 바꾸지 마세요:  ${sig}\n\n` + msg;
    }
    return msg;
  }

  root.AlgoJudge = {
    makeRand, buildCases, sameValue, formatValue, starterCode, judgeSource, judgeInput, grade,
    instrument, cleanCompilerOutput, lexJava, DEFAULT_LIMIT_MS, JUDGE_LIB, JUDGE_LIB_VERSION,
  };
})(typeof window !== 'undefined' ? window : globalThis);
