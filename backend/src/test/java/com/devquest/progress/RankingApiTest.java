package com.devquest.progress;

import static org.assertj.core.api.Assertions.assertThat;

import com.devquest.TestcontainersConfiguration;
import com.devquest.support.WebClient;
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
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfiguration.class)
@ActiveProfiles("test")
class RankingApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @LocalServerPort
    int port;

    @Autowired
    ObjectMapper json;

    @Autowired
    QuestCatalog catalog;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    ScoreService scores;

    record Player(WebClient web, String username, String nickname) {
    }

    private Player player() throws Exception {
        WebClient web = new WebClient(port);
        String username = "rank_" + (System.nanoTime() % 100000) + "_" + SEQ.incrementAndGet();
        var res = web.post("/api/auth/signup", WebClient.json(username, "secret123", false));
        assertThat(res.statusCode()).isEqualTo(201);
        return new Player(web, username, read(res).get("nickname").asString());
    }

    /** 실행마다 겹치지 않는 숫자 (DB 를 지우지 않고 여러 번 돌려도 닉네임이 겹치지 않게) */
    private static String uniq() {
        return String.valueOf(System.nanoTime() % 100000) + SEQ.incrementAndGet();
    }

    private JsonNode read(java.net.http.HttpResponse<String> res) {
        return json.readTree(res.body());
    }

    /** algo 퀘스트 id 를 XP 와 함께 (easy 100 · medium 150 · hard 250) */
    private List<String> algoIds(String difficultyXp, int n) {
        int xp = Integer.parseInt(difficultyXp);
        List<String> ids = new ArrayList<>();
        for (Map.Entry<String, Integer> e : catalog.course("algo").questXp().entrySet()) {
            if (e.getValue() == xp && ids.size() < n) ids.add(e.getKey());
        }
        assertThat(ids).hasSize(n);
        return ids;
    }

    private void save(Player p, String course, String dataJson) throws Exception {
        long version = read(p.web().get("/api/progress/" + course)).get("version").asLong();
        var res = p.web().put("/api/progress/" + course, "{\"data\":" + dataJson + ",\"version\":" + version + "}");
        assertThat(res.statusCode()).as(res.body()).isEqualTo(200);
    }

    private String ids(List<String> ids) {
        return ids.stream().map(i -> "\"" + i + "\"").reduce((a, b) -> a + "," + b).map(s -> "[" + s + "]").orElse("[]");
    }

    private JsonNode ranking(Player p, String course) throws Exception {
        var res = p.web().get("/api/ranking?course=" + course + "&limit=100");
        assertThat(res.statusCode()).as(res.body()).isEqualTo(200);
        return read(res);
    }

    @Test
    void 기본_닉네임과_닉네임_바꾸기() throws Exception {
        Player p = player();
        JsonNode me = read(p.web().get("/api/me"));
        assertThat(me.get("nickname").asString()).matches("모험가\\d+");
        assertThat(me.get("defaultNickname").asBoolean()).isTrue();

        String nick = "코딩왕" + uniq();
        var ok = p.web().put("/api/me/nickname", "{\"nickname\":\"" + nick + "\"}");
        assertThat(ok.statusCode()).as(ok.body()).isEqualTo(200);
        assertThat(read(ok).get("nickname").asString()).isEqualTo(nick);
        assertThat(read(ok).get("defaultNickname").asBoolean()).isFalse();
        assertThat(read(p.web().get("/api/me")).get("nickname").asString()).isEqualTo(nick);
        assertThat(p.web().put("/api/me/nickname", "{\"nickname\":\"" + nick + "\"}").statusCode()).isEqualTo(200); // 그대로면 통과

        Player other = player();
        var dup = other.web().put("/api/me/nickname", "{\"nickname\":\"" + nick + "\"}");
        assertThat(dup.statusCode()).isEqualTo(409);
        assertThat(dup.body()).contains("이미 사용 중인 닉네임");
        String mixed = "Nick_" + uniq();
        assertThat(other.web().put("/api/me/nickname", "{\"nickname\":\"" + mixed + "\"}").statusCode()).isEqualTo(200);
        assertThat(p.web().put("/api/me/nickname", "{\"nickname\":\"" + mixed.toLowerCase() + "\"}").statusCode())
                .as("대소문자만 다른 닉네임도 같은 닉네임").isEqualTo(409);
    }

    @Test
    void 닉네임_규칙() throws Exception {
        Player p = player();
        for (String bad : new String[] {"a", "열세글자가넘는아주긴닉네임", "공 백", "특수!문자", "모험가1234", "admin", "관리자"}) {
            var res = p.web().put("/api/me/nickname", "{\"nickname\":\"" + bad + "\"}");
            assertThat(res.statusCode()).as(bad).isEqualTo(400);
            assertThat(read(res).get("field").asString()).isEqualTo("nickname");
        }
        assertThat(p.web().put("/api/me/nickname", "{\"nickname\":\"\"}").statusCode()).isEqualTo(400);
        assertThat(p.web().put("/api/me/nickname", "{\"nickname\":\"한A_" + uniq() + "\"}").statusCode()).as("한글·영문·_·숫자").isEqualTo(200);
    }

    @Test
    void 진행도로_XP_를_계산하고_카탈로그에_없는_id_는_세지_않음() throws Exception {
        Player p = player();
        List<String> hard = algoIds("250", 2);
        List<String> withFake = new ArrayList<>(hard);
        withFake.add("not-a-real-quest");
        withFake.add(hard.get(0)); // 중복도 한 번만
        save(p, "algo", "{\"solved\":" + ids(withFake) + ",\"codes\":{}}");

        JsonNode me = ranking(p, "algo").get("me");
        assertThat(me.get("xp").asInt()).isEqualTo(500);
        assertThat(me.get("done").asInt()).isEqualTo(2);
        assertThat(me.get("nickname").asString()).isEqualTo(p.nickname());
        assertThat(me.get("me").asBoolean()).isTrue();
    }

    @Test
    void 과목별_순위와_전체_순위() throws Exception {
        Player a = player(), b = player(), c = player();
        List<String> medium = algoIds("150", 3);
        save(a, "algo", "{\"solved\":" + ids(medium.subList(0, 1)) + "}");   // 150
        save(b, "algo", "{\"solved\":" + ids(medium) + "}");                // 450
        save(c, "algo", "{\"solved\":" + ids(medium.subList(0, 2)) + "}");   // 300
        // git 은 { id: 완료 정보 } 객체 — 값이 있는 키만 완료
        String gitId = catalog.course("git").questXp().keySet().iterator().next();
        int gitXp = catalog.course("git").questXp().get(gitId);
        save(a, "git", "{\"done\":{\"" + gitId + "\":{\"t\":1},\"fake\":{\"t\":1}},\"seen\":true}");

        int rb = ranking(b, "algo").get("me").get("rank").asInt();
        int rc = ranking(c, "algo").get("me").get("rank").asInt();
        int ra = ranking(a, "algo").get("me").get("rank").asInt();
        assertThat(rb).isLessThan(rc);
        assertThat(rc).isLessThan(ra);

        JsonNode gitRank = ranking(a, "git").get("me");
        assertThat(gitRank.get("xp").asInt()).isEqualTo(gitXp);
        assertThat(ranking(b, "git").get("me").isNull()).as("XP 0 이면 순위 없음").isTrue();

        JsonNode all = ranking(a, "all");
        assertThat(all.get("me").get("xp").asInt()).isEqualTo(150 + gitXp);
        assertThat(all.get("maxXp").asInt()).isEqualTo(catalog.maxXpAll());
        assertThat(all.get("totalQuests").asInt()).isEqualTo(catalog.questCountAll());
        assertThat(all.get("players").asInt()).isGreaterThanOrEqualTo(3);

        // 목록에는 닉네임만 — 로그인 아이디는 나오지 않아요
        String body = a.web().get("/api/ranking?course=all&limit=100").body();
        assertThat(body).doesNotContain(a.username()).doesNotContain(b.username());
    }

    @Test
    void XP_가_같으면_먼저_도달한_사람이_위() throws Exception {
        Player first = player(), second = player();
        List<String> easy = algoIds("100", 1);
        save(first, "algo", "{\"solved\":" + ids(easy) + "}");
        Thread.sleep(20);
        save(second, "algo", "{\"solved\":" + ids(easy) + "}");
        assertThat(ranking(first, "algo").get("me").get("rank").asInt())
                .isLessThan(ranking(second, "algo").get("me").get("rank").asInt());

        // 첫 번째 사람이 같은 XP 로 다시 저장해도(다른 필드만 바뀜) 도달 시각은 그대로
        save(first, "algo", "{\"solved\":" + ids(easy) + ",\"lastId\":\"x\"}");
        assertThat(ranking(first, "algo").get("me").get("rank").asInt())
                .isLessThan(ranking(second, "algo").get("me").get("rank").asInt());
    }

    @Test
    void 상위_목록_밖이어도_내_순위는_보임() throws Exception {
        Player p = player();
        save(p, "sql", "{\"solved\":[\"" + catalog.course("sql").questXp().keySet().iterator().next() + "\"]}");
        JsonNode r = read(p.web().get("/api/ranking?course=sql&limit=1"));
        assertThat(r.get("entries").size()).isLessThanOrEqualTo(1);
        assertThat(r.get("me").get("rank").asInt()).isGreaterThanOrEqualTo(1);
    }

    @Test
    void 서버를_켤_때_예전_진행도로_점수를_다시_계산() throws Exception {
        Player p = player();
        Long id = jdbc.queryForObject("select id from users where username = ?", Long.class, p.username());
        String quest = algoIds("250", 1).get(0);
        // 랭킹 기능 전에 저장된 진행도처럼 점수 없이 넣어요
        jdbc.update("insert into progress (user_id, course_id, data, version) values (?, 'algo', ?::jsonb, 1)",
                id, "{\"solved\":[\"" + quest + "\"]}");
        assertThat(jdbc.queryForObject("select count(*) from course_scores where user_id = ?", Integer.class, id)).isZero();
        scores.recomputeAll();
        assertThat(jdbc.queryForObject("select xp from course_scores where user_id = ? and course_id = 'algo'", Integer.class, id))
                .isEqualTo(250);
    }

    @Test
    void 잘못된_요청() throws Exception {
        Player p = player();
        assertThat(p.web().get("/api/ranking?course=docker").statusCode()).isEqualTo(404);
        assertThat(new WebClient(port).get("/api/ranking").statusCode()).isEqualTo(401);
        assertThat(p.web().get("/api/ranking?limit=100000").statusCode()).isEqualTo(200);
    }
}
