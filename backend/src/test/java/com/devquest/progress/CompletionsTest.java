package com.devquest.progress;

import static org.assertj.core.api.Assertions.assertThat;

import com.devquest.TestcontainersConfiguration;
import com.devquest.support.WebClient;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.ObjectMapper;

/** 퀘스트 완료 기록(quest_completions): 저장할 때 새로 끝낸 퀘스트를 시각과 함께 남겨요 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfiguration.class)
@ActiveProfiles("test")
class CompletionsTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @LocalServerPort
    int port;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    QuestCatalog catalog;

    @Autowired
    ScoreService scores;

    @Autowired
    ObjectMapper json;

    record User(WebClient web, long id) {
    }

    private User user() throws Exception {
        WebClient web = new WebClient(port);
        String name = "cmp_" + (System.nanoTime() % 100000) + "_" + SEQ.incrementAndGet();
        assertThat(web.post("/api/auth/signup", WebClient.json(name, "secret123", false)).statusCode()).isEqualTo(201);
        return new User(web, jdbc.queryForObject("select id from users where username = ?", Long.class, name));
    }

    private List<String> ids(String course, int n) {
        return new ArrayList<>(catalog.course(course).questXp().keySet()).subList(0, n);
    }

    private void save(User u, String course, String data) throws Exception {
        long version = json.readTree(u.web().get("/api/progress/" + course).body()).get("version").asLong();
        var res = u.web().put("/api/progress/" + course, "{\"data\":" + data + ",\"version\":" + version + "}");
        assertThat(res.statusCode()).as(res.body()).isEqualTo(200);
    }

    private static String arr(List<String> ids) {
        return "[" + String.join(",", ids.stream().map(i -> "\"" + i + "\"").toList()) + "]";
    }

    private Map<String, Map<String, Object>> rows(long userId) {
        Map<String, Map<String, Object>> m = new java.util.TreeMap<>();
        jdbc.queryForList("select quest_id, xp, completed_at, live from quest_completions where user_id = ?", userId)
                .forEach(r -> m.put((String) r.get("quest_id"), r));
        return m;
    }

    @Test
    void 저장하면_새로_끝낸_퀘스트를_시각과_함께_기록() throws Exception {
        User u = user();
        List<String> q = ids("sql", 3);
        Instant before = Instant.now().minusSeconds(2);
        save(u, "sql", "{\"solved\":" + arr(q.subList(0, 2)) + "}");
        var r1 = rows(u.id());
        assertThat(r1).containsOnlyKeys(q.get(0), q.get(1));
        Timestamp first = (Timestamp) r1.get(q.get(0)).get("completed_at");
        assertThat(first.toInstant()).isAfter(before);
        assertThat(r1.get(q.get(0)).get("live")).isEqualTo(true);
        assertThat(r1.get(q.get(0)).get("xp")).isEqualTo(catalog.course("sql").questXp().get(q.get(0)));

        Thread.sleep(20);
        save(u, "sql", "{\"solved\":" + arr(q) + ",\"lastProblemId\":\"x\"}");
        var r2 = rows(u.id());
        assertThat(r2).containsOnlyKeys(q.toArray(String[]::new));
        assertThat(r2.get(q.get(0)).get("completed_at")).as("이미 기록된 완료 시각은 그대로").isEqualTo(first);
        assertThat(((Timestamp) r2.get(q.get(2)).get("completed_at")).toInstant()).isAfter(first.toInstant());
    }

    @Test
    void 초기화로_빠진_퀘스트는_지우고_카탈로그에_없는_id_는_무시() throws Exception {
        User u = user();
        List<String> q = ids("algo", 2);
        save(u, "algo", "{\"solved\":" + arr(q) + ",\"codes\":{}}");
        save(u, "algo", "{\"solved\":[\"" + q.get(1) + "\",\"not-a-quest\"],\"codes\":{}}");
        assertThat(rows(u.id())).containsOnlyKeys(q.get(1));
        save(u, "algo", "{\"solved\":[],\"codes\":{}}");
        assertThat(rows(u.id())).isEmpty();
    }

    @Test
    void 예전_기록은_시각을_추정해_live_false_로_채움_Git_은_저장된_시각() throws Exception {
        User u = user();
        List<String> g = ids("git", 2);
        Instant t = Instant.now().minus(Duration.ofDays(40)).truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
        Instant saved = Instant.now().minus(Duration.ofDays(3));
        String data = "{\"done\":{\"" + g.get(0) + "\":{\"t\":" + t.toEpochMilli() + "},\"" + g.get(1) + "\":true},\"seen\":true}";
        // 완료 기록 기능 전에 저장된 진행도처럼 직접 넣어요
        jdbc.update("insert into progress (user_id, course_id, data, version, updated_at) values (?, 'git', ?::jsonb, 1, ?)",
                u.id(), data, Timestamp.from(saved));
        scores.recomputeAll();
        var r = rows(u.id());
        assertThat(r).containsOnlyKeys(g.get(0), g.get(1));
        assertThat(r.get(g.get(0)).get("live")).isEqualTo(false);
        assertThat(((Timestamp) r.get(g.get(0)).get("completed_at")).toInstant()).isEqualTo(t);
        assertThat(((Timestamp) r.get(g.get(1)).get("completed_at")).toInstant()).as("진행도 저장 시각 (DB 는 마이크로초까지라 1ms 오차 허용)")
                .isBetween(saved.minusMillis(1), saved.plusMillis(1));

        // 다시 켜도 그대로, 이후 새로 끝낸 퀘스트만 live
        scores.recomputeAll();
        assertThat(rows(u.id())).hasSize(2);
        List<String> more = ids("git", 3);
        save(u, "git", "{\"done\":{\"" + more.get(0) + "\":{\"t\":1},\"" + more.get(1) + "\":true,\"" + more.get(2) + "\":{\"t\":2}},\"seen\":true}");
        var after = rows(u.id());
        assertThat(after.get(more.get(2)).get("live")).isEqualTo(true);
        assertThat(after.get(g.get(0)).get("live")).isEqualTo(false);
    }
}
