package com.devquest.auth;

import static com.devquest.support.WebClient.json;
import static org.assertj.core.api.Assertions.assertThat;

import com.devquest.TestcontainersConfiguration;
import com.devquest.support.WebClient;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

/** 실제 서버를 띄워 브라우저처럼 쿠키를 주고받으며 회원가입·로그인·자동 로그인·로그아웃을 확인해요 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfiguration.class)
@ActiveProfiles("test")
class AuthApiTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final String PW = "secret123";

    @LocalServerPort
    int port;

    @Autowired
    JdbcTemplate jdbc;

    WebClient web;

    @BeforeEach
    void setUp() {
        web = new WebClient(port);
    }

    private String newName() {
        return "user_" + System.nanoTime() % 100000 + "_" + SEQ.incrementAndGet();
    }

    private String signup(WebClient client, String name, boolean remember) throws Exception {
        var res = client.post("/api/auth/signup", json(name, PW, remember));
        assertThat(res.statusCode()).as(res.body()).isEqualTo(201);
        return name;
    }

    @Test
    void 회원가입하면_바로_로그인되고_아이디는_소문자로_저장() throws Exception {
        String name = "Mixed_" + SEQ.incrementAndGet() + "Ab";
        var res = web.post("/api/auth/signup", json(name, PW, false));
        assertThat(res.statusCode()).isEqualTo(201);
        assertThat(res.body()).contains("\"username\":\"" + name.toLowerCase() + "\"");

        var me = web.get("/api/me");
        assertThat(me.statusCode()).isEqualTo(200);
        assertThat(me.body()).contains(name.toLowerCase());
        String hash = jdbc.queryForObject("select password_hash from users where username = ?", String.class, name.toLowerCase());
        assertThat(hash).startsWith("{bcrypt}").doesNotContain(PW);
        assertThat(web.cookie("remember-me")).isEmpty();
    }

    @Test
    void 같은_아이디는_대소문자가_달라도_가입_불가() throws Exception {
        String name = signup(web, newName(), false);
        var res = new WebClient(port).post("/api/auth/signup", json(name.toUpperCase(), PW, false));
        assertThat(res.statusCode()).isEqualTo(409);
        assertThat(res.body()).contains("이미 사용 중인 아이디");
    }

    @Test
    void 가입_입력값_검사() throws Exception {
        assertThat(web.post("/api/auth/signup", json("ab", PW, false)).body()).contains("4~20자");
        assertThat(web.post("/api/auth/signup", json("한글아이디", PW, false)).statusCode()).isEqualTo(400);
        assertThat(web.post("/api/auth/signup", json(newName(), "short1", false)).body()).contains("8~64자");
        assertThat(web.post("/api/auth/signup", json(newName(), "onlyletters", false)).body()).contains("영문과 숫자");
        assertThat(web.post("/api/auth/signup", "{not json", true).statusCode()).isEqualTo(400);
    }

    @Test
    void 로그인과_실패() throws Exception {
        String name = signup(new WebClient(port), newName(), false);

        var bad = web.post("/api/auth/login", json(name, "wrong999", false));
        assertThat(bad.statusCode()).isEqualTo(401);
        assertThat(bad.body()).contains("아이디 또는 비밀번호가 맞지 않아요");
        assertThat(web.post("/api/auth/login", json("nobody_here", PW, false)).statusCode()).isEqualTo(401);

        var ok = web.post("/api/auth/login", json(name.toUpperCase(), PW, false)); // 대소문자 무시
        assertThat(ok.statusCode()).isEqualTo(200);
        assertThat(web.get("/api/me").body()).contains(name);
    }

    @Test
    void 다섯_번_틀리면_맞는_비밀번호도_잠시_막힘() throws Exception {
        String name = signup(new WebClient(port), newName(), false);
        for (int i = 0; i < 5; i++) {
            assertThat(web.post("/api/auth/login", json(name, "wrong999", false)).statusCode()).isEqualTo(401);
        }
        var locked = web.post("/api/auth/login", json(name, PW, false));
        assertThat(locked.statusCode()).isEqualTo(429);
        assertThat(locked.headers().firstValue("Retry-After")).isPresent();
        assertThat(locked.body()).contains("잠시 막혔어요");
    }

    @Test
    void 로그인하면_세션_ID_가_바뀜() throws Exception {
        String name = signup(new WebClient(port), newName(), false);
        web.get("/login/");
        web.post("/api/auth/login", json("nobody_here", PW, false)); // 로그인 전 세션을 하나 만들어 둬요
        String before = web.cookie("SESSION").orElse("");
        web.post("/api/auth/login", json(name, PW, false));
        assertThat(web.cookie("SESSION")).isPresent().get().isNotEqualTo(before);
    }

    @Test
    void 로그인_유지를_고르면_새_브라우저에서도_자동_로그인() throws Exception {
        String name = signup(web, newName(), true);
        String token = web.cookie("remember-me").orElseThrow();
        assertThat(jdbc.queryForObject("select count(*) from persistent_logins where username = ?", Integer.class, name)).isEqualTo(1);

        String sql = "select token from persistent_logins where username = ?";
        String before = jdbc.queryForObject(sql, String.class, name);

        WebClient other = new WebClient(port); // 세션 없이 자동 로그인 쿠키만 가진 브라우저
        other.putCookie("remember-me", token);
        var me = other.get("/api/me");
        assertThat(me.statusCode()).isEqualTo(200);
        assertThat(me.body()).contains(name);
        assertThat(me.headers().allValues("Set-Cookie")).anyMatch(c -> c.startsWith("remember-me=") && c.contains("HttpOnly"));
        assertThat(jdbc.queryForObject(sql, String.class, name)).as("쓸 때마다 토큰이 바뀌어요").isNotEqualTo(before);
    }

    @Test
    void 이미_쓴_자동_로그인_쿠키가_다시_오면_도용으로_보고_모두_끊음() throws Exception {
        String name = signup(web, newName(), true);
        String stolen = web.cookie("remember-me").orElseThrow();

        WebClient owner = new WebClient(port);
        owner.putCookie("remember-me", stolen);
        assertThat(owner.get("/api/me").statusCode()).isEqualTo(200); // 주인이 먼저 써서 토큰이 바뀜

        WebClient thief = new WebClient(port);
        thief.putCookie("remember-me", stolen);
        assertThat(thief.get("/api/me").statusCode()).isEqualTo(401);
        assertThat(jdbc.queryForObject("select count(*) from persistent_logins where username = ?", Integer.class, name)).isZero();
    }

    @Test
    void 로그아웃하면_세션과_자동_로그인_모두_끝남() throws Exception {
        String name = signup(web, newName(), true);
        String token = web.cookie("remember-me").orElseThrow();
        var out = web.post("/api/auth/logout", null);
        assertThat(out.statusCode()).isEqualTo(204);
        assertThat(web.get("/api/me").statusCode()).isEqualTo(401);
        assertThat(jdbc.queryForObject("select count(*) from persistent_logins where username = ?", Integer.class, name)).isZero();

        WebClient other = new WebClient(port);
        other.putCookie("remember-me", token);
        assertThat(other.get("/api/me").statusCode()).isEqualTo(401);
    }

    @Test
    void CSRF_토큰_없는_요청은_거절() throws Exception {
        String name = signup(new WebClient(port), newName(), false);
        assertThat(web.post("/api/auth/login", json(name, PW, false), false).statusCode()).isEqualTo(403);
        web.post("/api/auth/login", json(name, PW, false));
        assertThat(web.post("/api/auth/logout", null, false).statusCode()).isEqualTo(403);
        assertThat(web.get("/api/me").statusCode()).isEqualTo(200);
    }

    @Test
    void 로그인하지_않으면_API_는_401_페이지는_로그인_화면으로() throws Exception {
        var api = web.get("/api/me");
        assertThat(api.statusCode()).isEqualTo(401);
        assertThat(api.body()).contains("로그인이 필요해요");

        var page = web.get("/algo/?p=1");
        assertThat(page.statusCode()).isEqualTo(302);
        assertThat(page.headers().firstValue("Location").orElse("")).endsWith("/login/?next=%2Falgo%2F%3Fp%3D1");

        var root = web.get("/");
        assertThat(root.headers().firstValue("Location").orElse("")).endsWith("/login/");

        assertThat(web.get("/shared/dq.js").statusCode()).isEqualTo(200); // 로그인 화면에 필요
        assertThat(web.get("/algo/js/problems.js").statusCode()).isEqualTo(302);
    }

    @Test
    void 로그인_화면은_누구나_보고_CSRF_쿠키를_받음() throws Exception {
        var res = web.get("/login/");
        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(res.body()).contains("login.js");
        assertThat(web.cookie("XSRF-TOKEN")).isPresent();
        assertThat(web.get("/login").statusCode()).isEqualTo(302);
        assertThat(web.get("/login/login.js").statusCode()).isEqualTo(200);
    }
}
