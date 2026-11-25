package com.devquest.auth;

import static com.devquest.support.WebClient.json;
import static org.assertj.core.api.Assertions.assertThat;

import com.devquest.TestcontainersConfiguration;
import com.devquest.support.WebClient;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
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

/** 비밀번호 변경 · 복구 코드 · 관리자 임시 비밀번호 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "devquest.admin-token=test-admin-token-0123456789abcdef")
@Import(TestcontainersConfiguration.class)
@ActiveProfiles("test")
class AccountApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String PW = "secret123";
    private static final String ADMIN = "test-admin-token-0123456789abcdef";

    @LocalServerPort
    int port;

    @Autowired
    ObjectMapper json;

    @Autowired
    JdbcTemplate jdbc;

    private String newName() {
        return "acc_" + (System.nanoTime() % 100000) + "_" + SEQ.incrementAndGet();
    }

    private JsonNode read(HttpResponse<String> res) {
        return json.readTree(res.body());
    }

    /** 가입하고 받은 복구 코드를 돌려줘요 */
    private String signup(WebClient web, String name, boolean remember) throws Exception {
        var res = web.post("/api/auth/signup", json(name, PW, remember));
        assertThat(res.statusCode()).as(res.body()).isEqualTo(201);
        return read(res).get("recoveryCode").asString();
    }

    private WebClient loggedIn(String name, String password, boolean remember) throws Exception {
        WebClient web = new WebClient(port);
        assertThat(web.post("/api/auth/login", json(name, password, remember)).statusCode()).isEqualTo(200);
        return web;
    }

    private static String body(String... kv) {
        StringBuilder sb = new StringBuilder("{");
        for (int i = 0; i < kv.length; i += 2) {
            if (i > 0) sb.append(',');
            sb.append('"').append(kv[i]).append("\":").append(kv[i + 1].equals("true") || kv[i + 1].equals("false") ? kv[i + 1] : "\"" + kv[i + 1] + "\"");
        }
        return sb.append('}').toString();
    }

    @Test
    void 가입하면_복구_코드를_한_번만_줌() throws Exception {
        WebClient web = new WebClient(port);
        String name = newName();
        String code = signup(web, name, false);
        assertThat(code).matches("[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}");
        JsonNode me = read(web.get("/api/me"));
        assertThat(me.get("hasRecoveryCode").asBoolean()).isTrue();
        assertThat(me.get("recoveryCode").isNull()).as("다시는 보여 주지 않아요").isTrue();
        String hash = jdbc.queryForObject("select recovery_code_hash from users where username = ?", String.class, name);
        assertThat(hash).startsWith("{bcrypt}").doesNotContain(code.replace("-", ""));
    }

    @Test
    void 비밀번호_변경하면_다른_기기는_끊기고_이_기기는_유지() throws Exception {
        WebClient me = new WebClient(port);
        String name = newName();
        signup(me, name, true);
        WebClient otherDevice = loggedIn(name, PW, false);
        WebClient remembered = loggedIn(name, PW, true);
        String oldToken = remembered.cookie("remember-me").orElseThrow();

        assertThat(me.put("/api/me/password", body("currentPassword", "wrong999", "newPassword", "newpass123")).statusCode()).isEqualTo(401);
        assertThat(read(me.put("/api/me/password", body("currentPassword", PW, "newPassword", PW))).get("field").asString())
                .isEqualTo("newPassword");
        assertThat(me.put("/api/me/password", body("currentPassword", PW, "newPassword", "short")).statusCode()).isEqualTo(400);

        var ok = me.put("/api/me/password", body("currentPassword", PW, "newPassword", "newpass123"));
        assertThat(ok.statusCode()).as(ok.body()).isEqualTo(200);
        assertThat(me.get("/api/me").statusCode()).as("이 기기는 그대로").isEqualTo(200);
        assertThat(ok.headers().allValues("Set-Cookie")).as("이 기기의 자동 로그인은 새 토큰으로").anyMatch(c -> c.startsWith("remember-me="));
        assertThat(otherDevice.get("/api/me").statusCode()).as("다른 기기 세션은 끊김").isEqualTo(401);

        WebClient stolen = new WebClient(port);
        stolen.putCookie("remember-me", oldToken);
        assertThat(stolen.get("/api/me").statusCode()).as("예전 자동 로그인 쿠키는 못 씀").isEqualTo(401);

        assertThat(new WebClient(port).post("/api/auth/login", json(name, PW, false)).statusCode()).isEqualTo(401);
        assertThat(new WebClient(port).post("/api/auth/login", json(name, "newpass123", false)).statusCode()).isEqualTo(200);
    }

    @Test
    void 복구_코드로_새_비밀번호를_정하고_코드는_새로_바뀜() throws Exception {
        WebClient first = new WebClient(port);
        String name = newName();
        String code = signup(first, name, false);

        WebClient anon = new WebClient(port);
        var bad = anon.post("/api/auth/recover", body("username", name, "recoveryCode", "AAAA-BBBB-CCCC-DDDD", "newPassword", "fresh1234"));
        assertThat(bad.statusCode()).as(bad.body()).isEqualTo(401);
        assertThat(bad.body()).contains("아이디 또는 복구 코드가 맞지 않아요");
        assertThat(anon.post("/api/auth/recover", body("username", "nobody_zz", "recoveryCode", code, "newPassword", "fresh1234")).statusCode())
                .as("없는 아이디도 같은 오류").isEqualTo(401);

        // 소문자·공백으로 넣어도 돼요
        String typed = " " + code.toLowerCase().replace("-", " ") + " ";
        var ok = anon.post("/api/auth/recover", body("username", name.toUpperCase(), "recoveryCode", typed, "newPassword", "fresh1234", "rememberMe", "true"));
        assertThat(ok.statusCode()).as(ok.body()).isEqualTo(200);
        String next = read(ok).get("recoveryCode").asString();
        assertThat(next).isNotEqualTo(code).hasSize(19);
        assertThat(anon.get("/api/me").statusCode()).as("복구하면 바로 로그인").isEqualTo(200);
        assertThat(anon.cookie("remember-me")).isPresent();
        assertThat(first.get("/api/me").statusCode()).as("원래 기기 세션은 끊김").isEqualTo(401);

        assertThat(new WebClient(port).post("/api/auth/recover", body("username", name, "recoveryCode", code, "newPassword", "again1234")).statusCode())
                .as("쓴 코드는 다시 못 씀").isEqualTo(401);
        assertThat(new WebClient(port).post("/api/auth/login", json(name, "fresh1234", false)).statusCode()).isEqualTo(200);
    }

    @Test
    void 복구_코드_새로_만들기는_비밀번호_확인() throws Exception {
        WebClient web = new WebClient(port);
        String name = newName();
        String code = signup(web, name, false);
        assertThat(web.post("/api/me/recovery-code", body("password", "wrong999")).statusCode()).isEqualTo(401);
        var res = web.post("/api/me/recovery-code", body("password", PW));
        assertThat(res.statusCode()).isEqualTo(200);
        String fresh = read(res).get("recoveryCode").asString();
        assertThat(fresh).isNotEqualTo(code);
        assertThat(new WebClient(port).post("/api/auth/recover", body("username", name, "recoveryCode", code, "newPassword", "x1234567")).statusCode())
                .as("예전 코드는 무효").isEqualTo(401);
        assertThat(new WebClient(port).post("/api/auth/recover", body("username", name, "recoveryCode", fresh, "newPassword", "x1234567")).statusCode())
                .isEqualTo(200);
    }

    @Test
    void 복구_코드가_없는_기존_계정() throws Exception {
        String name = newName();
        jdbc.update("insert into users (username, password_hash, nickname) values (?, '{noop}x', ?)", name, "old" + (System.nanoTime() % 1000000) + SEQ.incrementAndGet());
        assertThat(new WebClient(port).post("/api/auth/recover", body("username", name, "recoveryCode", "AAAA-BBBB-CCCC-DDDD", "newPassword", "x1234567")).statusCode())
                .isEqualTo(401);
    }

    @Test
    void rememberMe_가_빠져도_됨() throws Exception {
        String name = newName();
        assertThat(new WebClient(port).post("/api/auth/signup", "{\"username\":\"" + name + "\",\"password\":\"" + PW + "\"}").statusCode()).isEqualTo(201);
        assertThat(new WebClient(port).post("/api/auth/login", "{\"username\":\"" + name + "\",\"password\":\"" + PW + "\"}").statusCode()).isEqualTo(200);
    }

    @Test
    void 복구를_다섯_번_틀리면_잠시_막힘() throws Exception {
        WebClient web = new WebClient(port);
        String name = newName();
        String code = signup(web, name, false);
        WebClient anon = new WebClient(port);
        for (int i = 0; i < 5; i++) {
            assertThat(anon.post("/api/auth/recover", body("username", name, "recoveryCode", "AAAA-BBBB-CCCC-DDD" + (2 + i), "newPassword", "x1234567")).statusCode()).isEqualTo(401);
        }
        assertThat(anon.post("/api/auth/recover", body("username", name, "recoveryCode", code, "newPassword", "x1234567")).statusCode()).isEqualTo(429);
    }

    @Test
    void 회원_탈퇴하면_계정과_진행도가_지워지고_모든_기기에서_로그아웃() throws Exception {
        WebClient web = new WebClient(port);
        String name = newName();
        signup(web, name, true);
        Long id = jdbc.queryForObject("select id from users where username = ?", Long.class, name);
        assertThat(web.put("/api/progress/sql", "{\"data\":{\"solved\":[\"basics-vip\"]},\"version\":0}").statusCode()).isEqualTo(200);
        WebClient otherDevice = loggedIn(name, PW, true);
        String token = otherDevice.cookie("remember-me").orElseThrow();

        assertThat(web.delete("/api/me", body("password", "wrong999")).statusCode()).isEqualTo(401);
        assertThat(web.get("/api/me").statusCode()).as("틀리면 그대로").isEqualTo(200);

        var res = web.delete("/api/me", body("password", PW));
        assertThat(res.statusCode()).as(res.body()).isEqualTo(204);
        assertThat(res.headers().allValues("Set-Cookie")).as("자동 로그인 쿠키 지움").anyMatch(c -> c.startsWith("remember-me=;") && (c.contains("Max-Age=0") || c.contains("1970")));
        assertThat(web.get("/api/me").statusCode()).isEqualTo(401);
        assertThat(otherDevice.get("/api/me").statusCode()).isEqualTo(401);
        WebClient stolen = new WebClient(port);
        stolen.putCookie("remember-me", token);
        assertThat(stolen.get("/api/me").statusCode()).isEqualTo(401);

        for (String table : new String[] {"users where id = ?", "progress where user_id = ?", "course_scores where user_id = ?"}) {
            assertThat(jdbc.queryForObject("select count(*) from " + table, Integer.class, id)).as(table).isZero();
        }
        assertThat(jdbc.queryForObject("select count(*) from persistent_logins where username = ?", Integer.class, name)).isZero();
        assertThat(new WebClient(port).post("/api/auth/signup", json(name, PW, false)).statusCode()).as("같은 아이디로 다시 가입 가능").isEqualTo(201);
    }

    private HttpResponse<String> admin(String username, String token) throws Exception {
        HttpRequest.Builder req = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/api/admin/users/" + username + "/reset-password"))
                .POST(HttpRequest.BodyPublishers.noBody());
        if (token != null) req.header("X-Admin-Token", token);
        return HttpClient.newHttpClient().send(req.build(), HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void 관리자_임시_비밀번호() throws Exception {
        WebClient web = new WebClient(port);
        String name = newName();
        signup(web, name, false);
        assertThat(admin(name, null).statusCode()).isEqualTo(404);
        assertThat(admin(name, "wrong-token-0123456789abcdefgh").statusCode()).isEqualTo(404);
        assertThat(admin("nobody_zz", ADMIN).statusCode()).isEqualTo(404);

        var res = admin(name, ADMIN);
        assertThat(res.statusCode()).as(res.body()).isEqualTo(200);
        String temp = read(res).get("temporaryPassword").asString();
        assertThat(temp).matches("[a-z2-9]{12}");
        assertThat(web.get("/api/me").statusCode()).as("기존 로그인은 끊김").isEqualTo(401);
        assertThat(new WebClient(port).post("/api/auth/login", json(name, temp, false)).statusCode()).isEqualTo(200);
        assertThat(new WebClient(port).post("/api/auth/login", json(name, PW, false)).statusCode()).isEqualTo(401);
    }
}
