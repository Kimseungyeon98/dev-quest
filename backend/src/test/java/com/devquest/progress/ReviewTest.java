package com.devquest.progress;

import static org.assertj.core.api.Assertions.assertThat;

import com.devquest.TestcontainersConfiguration;
import com.devquest.support.WebClient;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** 오답 노트: 틀린 시도·힌트·정답 보기 → 노트에 올라가고, 노트에서 다시 맞히면 졸업 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfiguration.class)
@ActiveProfiles("test")
class ReviewTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @LocalServerPort
    int port;

    @Autowired
    QuestCatalog catalog;

    @Autowired
    ObjectMapper json;

    private WebClient user() throws Exception {
        WebClient web = new WebClient(port);
        String name = "rev_" + (System.nanoTime() % 100000) + "_" + SEQ.incrementAndGet();
        assertThat(web.post("/api/auth/signup", WebClient.json(name, "secret123", false)).statusCode()).isEqualTo(201);
        return web;
    }

    private List<String> sql(int n) {
        return new ArrayList<>(catalog.course("sql").questXp().keySet()).subList(0, n);
    }

    private int event(WebClient web, String course, String quest, String type, boolean review) throws Exception {
        return web.post("/api/review/events",
                "{\"course\":\"" + course + "\",\"quest\":\"" + quest + "\",\"type\":\"" + type + "\",\"review\":" + review + "}").statusCode();
    }

    private JsonNode notes(WebClient web) throws Exception {
        var res = web.get("/api/review");
        assertThat(res.statusCode()).as(res.body()).isEqualTo(200);
        return json.readTree(res.body());
    }

    @Test
    void 틀리거나_힌트_정답을_보면_오답_노트에_올라감() throws Exception {
        WebClient web = user();
        List<String> q = sql(3);
        assertThat(notes(web).get("items").size()).isZero();

        assertThat(event(web, "sql", q.get(0), "wrong", false)).isEqualTo(200);
        event(web, "sql", q.get(0), "wrong", false);
        event(web, "sql", q.get(0), "hint", false);
        Thread.sleep(5);
        event(web, "sql", q.get(1), "answer", false);
        event(web, "sql", q.get(2), "correct", false); // 실수 없이 맞힌 퀘스트는 노트에 없어요

        JsonNode n = notes(web);
        assertThat(n.get("open").asInt()).isEqualTo(2);
        JsonNode items = n.get("items");
        assertThat(items.size()).isEqualTo(2);
        assertThat(items.get(0).get("quest").asString()).as("최근 것부터").isEqualTo(q.get(1));
        assertThat(items.get(0).get("answers").asInt()).isEqualTo(1);
        assertThat(items.get(1).get("wrong").asInt()).isEqualTo(2);
        assertThat(items.get(1).get("hints").asInt()).isEqualTo(1);
        assertThat(items.get(1).get("solved").asBoolean()).isFalse();
    }

    @Test
    void 노트에서_열어_다시_맞히면_졸업_다시_틀리면_돌아옴() throws Exception {
        WebClient web = user();
        String q = sql(1).get(0);
        event(web, "sql", q, "wrong", false);
        event(web, "sql", q, "correct", false); // 그냥 맞힌 건 졸업이 아니에요 (맞힌 표시만)
        JsonNode item = notes(web).get("items").get(0);
        assertThat(item.get("solved").asBoolean()).isTrue();

        var res = web.post("/api/review/events", "{\"course\":\"sql\",\"quest\":\"" + q + "\",\"type\":\"correct\",\"review\":true}");
        assertThat(json.readTree(res.body()).get("cleared").asBoolean()).isTrue();
        JsonNode n = notes(web);
        assertThat(n.get("items").size()).isZero();
        assertThat(n.get("cleared").asInt()).isEqualTo(1);

        event(web, "sql", q, "wrong", false);
        assertThat(notes(web).get("items").get(0).get("wrong").asInt()).as("횟수는 이어서").isEqualTo(2);
    }

    @Test
    void 노트에서_빼기와_잘못된_요청() throws Exception {
        WebClient web = user();
        String q = sql(1).get(0);
        event(web, "sql", q, "hint", false);
        assertThat(web.delete("/api/review/sql/" + q, "{}").statusCode()).isEqualTo(200);
        assertThat(notes(web).get("items").size()).isZero();

        assertThat(event(web, "docker", q, "wrong", false)).isEqualTo(404);
        assertThat(event(web, "sql", "no-such-quest", "wrong", false)).isEqualTo(400);
        assertThat(event(web, "sql", q, "explode", false)).isEqualTo(400);
        assertThat(new WebClient(port).get("/api/review").statusCode()).isEqualTo(401);

        // 다른 사람의 노트는 보이지 않아요
        WebClient other = user();
        event(web, "sql", q, "wrong", false);
        assertThat(notes(other).get("items").size()).isZero();
    }
}
