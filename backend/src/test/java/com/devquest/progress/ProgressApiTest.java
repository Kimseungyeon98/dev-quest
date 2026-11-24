package com.devquest.progress;

import static org.assertj.core.api.Assertions.assertThat;

import com.devquest.TestcontainersConfiguration;
import com.devquest.support.WebClient;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfiguration.class)
@ActiveProfiles("test")
class ProgressApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();

    @LocalServerPort
    int port;

    @Autowired
    ObjectMapper json;

    WebClient web;

    @BeforeEach
    void login() throws Exception {
        web = signedIn();
    }

    private WebClient signedIn() throws Exception {
        WebClient c = new WebClient(port);
        String name = "prog_" + (System.nanoTime() % 100000) + "_" + SEQ.incrementAndGet();
        assertThat(c.post("/api/auth/signup", WebClient.json(name, "secret123", false)).statusCode()).isEqualTo(201);
        return c;
    }

    private JsonNode body(java.net.http.HttpResponse<String> res) {
        return json.readTree(res.body());
    }

    private String save(String data, long version) {
        return "{\"data\":" + data + ",\"version\":" + version + "}";
    }

    @Test
    void 처음에는_비어_있음() throws Exception {
        assertThat(body(web.get("/api/progress")).get("courses").size()).isZero();
        JsonNode one = body(web.get("/api/progress/algo"));
        assertThat(one.get("version").asLong()).isZero();
        assertThat(one.get("data").isNull()).isTrue();
    }

    @Test
    void 저장하면_version_이_오르고_그대로_읽힘() throws Exception {
        String data = "{\"solved\":[\"hash-1\",\"dp-2\"],\"lastId\":\"dp-2\",\"codes\":{\"dp-2\":\"class Solution { /* 한글 \\\"따옴표\\\" */ }\"}}";
        var first = web.put("/api/progress/algo", save(data, 0));
        assertThat(first.statusCode()).as(first.body()).isEqualTo(200);
        assertThat(body(first).get("version").asLong()).isEqualTo(1);
        assertThat(body(first).get("updatedAt").asString()).isNotBlank();

        var second = web.put("/api/progress/algo", save("{\"solved\":[\"hash-1\"]}", 1));
        assertThat(body(second).get("version").asLong()).isEqualTo(2);

        JsonNode all = body(web.get("/api/progress")).get("courses");
        assertThat(all.get("algo").get("data")).isEqualTo(json.readTree("{\"solved\":[\"hash-1\"]}"));
        assertThat(all.get("algo").get("version").asLong()).isEqualTo(2);

        web.put("/api/progress/sql", save("{\"solved\":[1]}", 0));
        JsonNode one = body(web.get("/api/progress/sql"));
        assertThat(one.get("data")).isEqualTo(json.readTree("{\"solved\":[1]}"));
        assertThat(body(web.get("/api/progress")).get("courses").size()).isEqualTo(2);
    }

    @Test
    void 한글과_특수문자가_그대로_보존() throws Exception {
        String data = "{\"codes\":{\"x\":\"System.out.println(\\\"안녕 😀 \\\\n\\\");\"}}";
        web.put("/api/progress/algo", save(data, 0));
        assertThat(body(web.get("/api/progress/algo")).get("data")).isEqualTo(json.readTree(data));
    }

    @Test
    void 옛_version_으로_저장하면_409_와_최신_기록() throws Exception {
        web.put("/api/progress/git", save("{\"done\":{\"a\":true}}", 0));     // 기기 A → version 1
        web.put("/api/progress/git", save("{\"done\":{\"a\":true,\"b\":true}}", 1)); // 기기 A → version 2

        var stale = web.put("/api/progress/git", save("{\"done\":{\"c\":true}}", 1)); // 기기 B 는 version 1 만 알아요
        assertThat(stale.statusCode()).isEqualTo(409);
        JsonNode current = body(stale).get("current");
        assertThat(current.get("version").asLong()).isEqualTo(2);
        assertThat(current.get("data")).isEqualTo(json.readTree("{\"done\":{\"a\":true,\"b\":true}}"));

        var fresh = web.put("/api/progress/git", save("{\"done\":{\"a\":true}}", 0)); // 이미 있는데 처음 저장이라고 하면
        assertThat(fresh.statusCode()).isEqualTo(409);
        assertThat(body(web.get("/api/progress/git")).get("version").asLong()).isEqualTo(2); // 아무것도 안 바뀜
    }

    @Test
    void 같은_version_으로_동시에_저장하면_하나만_성공() throws Exception {
        web.put("/api/progress/linux", save("{\"completed\":[]}", 0));
        var pool = Executors.newFixedThreadPool(8);
        List<Future<Integer>> results = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            int n = i;
            Callable<Integer> task = () -> web.put("/api/progress/linux", save("{\"completed\":[" + n + "]}", 1)).statusCode();
            results.add(pool.submit(task));
        }
        int ok = 0, conflict = 0;
        for (Future<Integer> r : results) {
            int code = r.get();
            if (code == 200) ok++;
            if (code == 409) conflict++;
        }
        pool.shutdown();
        assertThat(ok).isEqualTo(1);
        assertThat(conflict).isEqualTo(7);
        assertThat(body(web.get("/api/progress/linux")).get("version").asLong()).isEqualTo(2);
    }

    @Test
    void 다른_사람의_진행도는_보이지_않음() throws Exception {
        web.put("/api/progress/algo", save("{\"solved\":[\"mine\"]}", 0));
        WebClient other = signedIn();
        assertThat(body(other.get("/api/progress")).get("courses").size()).isZero();
        assertThat(body(other.get("/api/progress/algo")).get("version").asLong()).isZero();
        assertThat(other.put("/api/progress/algo", save("{\"solved\":[\"theirs\"]}", 0)).statusCode()).isEqualTo(200);
        assertThat(body(web.get("/api/progress/algo")).get("data").get("solved").get(0).asString()).isEqualTo("mine");
    }

    @Test
    void 잘못된_요청() throws Exception {
        assertThat(web.get("/api/progress/docker").statusCode()).isEqualTo(404);
        assertThat(web.put("/api/progress/docker", save("{}", 0)).statusCode()).isEqualTo(404);
        assertThat(web.put("/api/progress/algo", save("[1,2]", 0)).body()).contains("JSON 객체");
        assertThat(web.put("/api/progress/algo", save("\"text\"", 0)).statusCode()).isEqualTo(400);
        assertThat(web.put("/api/progress/algo", "{\"version\":0}").body()).contains("data 가 필요해요");
        assertThat(web.put("/api/progress/algo", save("{}", -1)).statusCode()).isEqualTo(400);
        assertThat(web.put("/api/progress/algo", "nope").statusCode()).isEqualTo(400);
    }

    @Test
    void 너무_큰_진행도는_413() throws Exception {
        String big = "{\"codes\":{\"x\":\"" + "a".repeat(600 * 1024) + "\"}}"; // 한도 512KB
        var res = web.put("/api/progress/algo", save(big, 0));
        assertThat(res.statusCode()).isEqualTo(413);
        assertThat(res.body()).contains("너무 커요");

        String huge = "{\"codes\":{\"x\":\"" + "a".repeat(2 * 1024 * 1024) + "\"}}"; // 본문 한도도 넘음
        assertThat(web.put("/api/progress/algo", save(huge, 0)).statusCode()).isEqualTo(413);
        assertThat(body(web.get("/api/progress/algo")).get("version").asLong()).isZero();
    }

    @Test
    void 로그인하지_않으면_401_CSRF_없으면_403() throws Exception {
        WebClient anon = new WebClient(port);
        assertThat(anon.get("/api/progress").statusCode()).isEqualTo(401);
        assertThat(anon.put("/api/progress/algo", save("{}", 0)).statusCode()).isIn(401, 403);

        web.removeCookie("XSRF-TOKEN");
        var noCsrf = web.post("/api/progress/algo", save("{}", 0), false);
        assertThat(noCsrf.statusCode()).isEqualTo(403);
    }
}
