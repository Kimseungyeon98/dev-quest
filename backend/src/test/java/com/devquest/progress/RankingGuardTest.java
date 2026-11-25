package com.devquest.progress;

import static org.assertj.core.api.Assertions.assertThat;

import com.devquest.TestcontainersConfiguration;
import com.devquest.support.WebClient;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** 랭킹 부정 방지: 한꺼번에 들어온 기록 · 너무 빠른 완료 · 새 계정의 급격한 XP · 관리자 확인 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "devquest.admin-token=" + RankingGuardTest.ADMIN,
        "devquest.ranking.bulk-limit=5",
        "devquest.ranking.pace-limit=6",
        "devquest.ranking.new-account-share=0.05"})
@Import(TestcontainersConfiguration.class)
@ActiveProfiles("test")
class RankingGuardTest {

    static final String ADMIN = "test-admin-token-ranking-0123456789";
    private static final AtomicInteger SEQ = new AtomicInteger();

    @LocalServerPort
    int port;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    QuestCatalog catalog;

    @Autowired
    ObjectMapper json;

    record User(WebClient web, String name, long id) {
    }

    private User user() throws Exception {
        WebClient web = new WebClient(port);
        String name = "grd_" + (System.nanoTime() % 100000) + "_" + SEQ.incrementAndGet();
        assertThat(web.post("/api/auth/signup", WebClient.json(name, "secret123", false)).statusCode()).isEqualTo(201);
        return new User(web, name, jdbc.queryForObject("select id from users where username = ?", Long.class, name));
    }

    /** sql 쉬움(100 XP) 퀘스트 n개 */
    private List<String> easySql(int n) {
        List<String> ids = new ArrayList<>();
        catalog.course("sql").questXp().forEach((id, xp) -> { if (xp == 100 && ids.size() < n) ids.add(id); });
        assertThat(ids).hasSize(n);
        return ids;
    }

    private void saveSql(User u, List<String> solved) throws Exception {
        long version = json.readTree(u.web().get("/api/progress/sql").body()).get("version").asLong();
        String arr = "[" + String.join(",", solved.stream().map(i -> "\"" + i + "\"").toList()) + "]";
        var res = u.web().put("/api/progress/sql", "{\"data\":{\"solved\":" + arr + "},\"version\":" + version + "}");
        assertThat(res.statusCode()).as(res.body()).isEqualTo(200);
    }

    private String status(User u) {
        return jdbc.queryForObject("select ranking_status from users where id = ?", String.class, u.id());
    }

    private JsonNode ranking(User u, String query) throws Exception {
        var res = u.web().get("/api/ranking?limit=100&" + query);
        assertThat(res.statusCode()).as(res.body()).isEqualTo(200);
        return json.readTree(res.body());
    }

    private HttpResponse<String> admin(String method, String path, String body, String token) throws Exception {
        HttpRequest.Builder req = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/admin" + path))
                .header("Content-Type", "application/json")
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        if (token != null) req.header("X-Admin-Token", token);
        return HttpClient.newHttpClient().send(req.build(), HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void 한꺼번에_들어온_기록은_주간_랭킹_스트릭에서_빠지고_누적에는_들어감() throws Exception {
        User u = user();
        List<String> q = easySql(8);
        saveSql(u, q.subList(0, 6)); // 6개 > bulk-limit 5
        assertThat(jdbc.queryForObject("select count(*) from quest_completions where user_id = ? and live", Integer.class, u.id())).isZero();
        saveSql(u, q.subList(0, 8)); // 2개 더 → 지금 끝낸 기록
        assertThat(jdbc.queryForObject("select count(*) from quest_completions where user_id = ? and live", Integer.class, u.id())).isEqualTo(2);

        assertThat(status(u)).isEqualTo("ok");
        assertThat(ranking(u, "course=sql").get("me").get("xp").asInt()).isEqualTo(800);
        assertThat(ranking(u, "course=sql&period=week").get("me").get("xp").asInt()).isEqualTo(200);
    }

    @Test
    void 너무_빠르게_끝내면_확인_전까지_랭킹에서_빠짐() throws Exception {
        User u = user();
        List<String> q = easySql(9);
        saveSql(u, q.subList(0, 3));
        saveSql(u, q.subList(0, 6));
        assertThat(status(u)).isEqualTo("ok"); // 6개 = pace-limit
        JsonNode before = ranking(u, "course=sql");
        assertThat(before.get("me").get("xp").asInt()).isEqualTo(600);
        assertThat(before.get("myStatus").asString()).isEqualTo("ok");

        saveSql(u, q.subList(0, 9)); // 10분 안에 9개
        assertThat(status(u)).isEqualTo("review");
        JsonNode after = ranking(u, "course=sql");
        assertThat(after.get("me").isNull()).isTrue();
        assertThat(after.get("myStatus").asString()).isEqualTo("review");
        assertThat(after.get("entries").findValuesAsString("nickname"))
                .doesNotContain(jdbc.queryForObject("select nickname from users where id = ?", String.class, u.id()));
        // 진행도는 그대로 저장돼요
        assertThat(json.readTree(u.web().get("/api/progress/sql").body()).get("data").get("solved").size()).isEqualTo(9);

        // 관리자가 확인
        JsonNode list = json.readTree(admin("GET", "/ranking/review", null, ADMIN).body()).get("users");
        JsonNode mine = null;
        for (JsonNode x : list) if (x.get("username").asString().equals(u.name())) mine = x;
        assertThat(mine).isNotNull();
        assertThat(mine.get("note").asString()).contains("10분 동안 퀘스트 9개");
        assertThat(mine.get("xp").asInt()).isEqualTo(900);

        var res = admin("PUT", "/users/" + u.name() + "/ranking", "{\"status\":\"trusted\"}", ADMIN);
        assertThat(res.statusCode()).as(res.body()).isEqualTo(200);
        assertThat(ranking(u, "course=sql").get("me").get("xp").asInt()).isEqualTo(900);
        List<String> more = new ArrayList<>(q);
        catalog.course("sql").questXp().keySet().stream().filter(id -> !q.contains(id)).limit(3).forEach(more::add);
        saveSql(u, more); // 믿을 수 있는 계정은 다시 빠지지 않아요
        assertThat(status(u)).isEqualTo("trusted");

        assertThat(admin("PUT", "/users/" + u.name() + "/ranking", "{\"status\":\"hidden\",\"note\":\"기록 조작\"}", ADMIN).statusCode()).isEqualTo(200);
        JsonNode hidden = ranking(u, "course=all");
        assertThat(hidden.get("me").isNull()).isTrue();
        assertThat(hidden.get("myStatus").asString()).isEqualTo("hidden");
    }

    @Test
    void 새_계정이_짧은_시간에_전체_XP_의_큰_비율을_모으면_확인() throws Exception {
        User u = user();
        // 다른 과목에서 이미 많이 모은 것처럼 (전체의 5% = 1,710 XP 이상)
        jdbc.update("insert into course_scores (user_id, course_id, xp, done_count, reached_at) values (?, 'linux', 1700, 10, now())", u.id());
        saveSql(u, easySql(1));
        assertThat(status(u)).isEqualTo("review");
        assertThat(jdbc.queryForObject("select ranking_note from users where id = ?", String.class, u.id())).contains("가입 24시간 안에 1,800 XP");
    }

    @Test
    void 관리자_API_는_토큰이_있어야_하고_상태를_확인() throws Exception {
        User u = user();
        assertThat(admin("GET", "/ranking/review", null, null).statusCode()).isEqualTo(404);
        assertThat(admin("GET", "/ranking/review", null, "wrong-token-wrong-token-wrong").statusCode()).isEqualTo(404);
        assertThat(admin("PUT", "/users/" + u.name() + "/ranking", "{\"status\":\"review\"}", ADMIN).statusCode()).isEqualTo(400);
        assertThat(admin("PUT", "/users/nobody_zzz/ranking", "{\"status\":\"ok\"}", ADMIN).statusCode()).isEqualTo(404);
        assertThat(admin("PUT", "/users/" + u.name().toUpperCase() + "/ranking", "{\"status\":\"hidden\"}", ADMIN).statusCode()).isEqualTo(200);
        assertThat(status(u)).isEqualTo("hidden");
        assertThat(admin("PUT", "/users/" + u.name() + "/ranking", "{\"status\":\"ok\"}", ADMIN).statusCode()).isEqualTo(200);
        assertThat(status(u)).isEqualTo("ok");
    }
}
