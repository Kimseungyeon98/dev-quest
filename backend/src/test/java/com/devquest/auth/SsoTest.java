package com.devquest.auth;

import static org.assertj.core.api.Assertions.assertThat;

import com.devquest.TestcontainersConfiguration;
import com.devquest.support.WebClient;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * SSO 전체 흐름: 가짜 OAuth2 서비스(이 테스트가 띄워요)로 로그인 시작 → 서비스 로그인 → 돌아오기 → 우리 계정 세션까지.
 * 실제 제공자(구글 등)도 똑같은 흐름이라, 키만 넣으면 같은 코드로 동작해요.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfiguration.class)
@ActiveProfiles("test")
class SsoTest {

    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final HttpServer FAKE;
    /** 가짜 서비스에서 "로그인"할 사람 (code → 사용자) */
    private static final Map<String, Map<String, Object>> CODES = new ConcurrentHashMap<>();
    private static volatile Map<String, Object> nextUser;

    static {
        try {
            FAKE = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        FAKE.createContext("/authorize", ex -> {
            Map<String, String> q = query(ex.getRequestURI().getRawQuery());
            String code = "code-" + SEQ.incrementAndGet();
            CODES.put(code, nextUser);
            ex.getResponseHeaders().add("Location", q.get("redirect_uri") + "?code=" + code + "&state=" + java.net.URLEncoder.encode(q.get("state"), StandardCharsets.UTF_8));
            ex.sendResponseHeaders(302, -1);
            ex.close();
        });
        FAKE.createContext("/token", ex -> {
            Map<String, String> form = query(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            String body = CODES.containsKey(form.get("code"))
                    ? "{\"access_token\":\"tok-" + form.get("code") + "\",\"token_type\":\"Bearer\",\"expires_in\":3600}"
                    : "{\"error\":\"invalid_grant\"}";
            send(ex, CODES.containsKey(form.get("code")) ? 200 : 400, body);
        });
        FAKE.createContext("/userinfo", ex -> {
            String auth = ex.getRequestHeaders().getFirst("Authorization");
            Map<String, Object> u = auth == null ? null : CODES.get(auth.replace("Bearer tok-", ""));
            if (u == null) { send(ex, 401, "{}"); return; }
            StringBuilder sb = new StringBuilder("{");
            u.forEach((k, v) -> sb.append(sb.length() > 1 ? "," : "").append('"').append(k).append("\":\"").append(v).append('"'));
            send(ex, 200, sb.append('}').toString());
        });
        FAKE.start();
    }

    @AfterAll
    static void stop() {
        FAKE.stop(0);
    }

    @DynamicPropertySource
    static void sso(DynamicPropertyRegistry r) {
        String base = "http://localhost:" + FAKE.getAddress().getPort();
        r.add("spring.security.oauth2.client.registration.test.client-id", () -> "dq-test");
        r.add("spring.security.oauth2.client.registration.test.client-secret", () -> "dq-secret");
        r.add("spring.security.oauth2.client.registration.test.authorization-grant-type", () -> "authorization_code");
        r.add("spring.security.oauth2.client.registration.test.client-authentication-method", () -> "client_secret_post");
        r.add("spring.security.oauth2.client.registration.test.redirect-uri", () -> "{baseUrl}/login/oauth2/code/{registrationId}");
        r.add("spring.security.oauth2.client.registration.test.scope", () -> "profile");
        r.add("spring.security.oauth2.client.provider.test.authorization-uri", () -> base + "/authorize");
        r.add("spring.security.oauth2.client.provider.test.token-uri", () -> base + "/token");
        r.add("spring.security.oauth2.client.provider.test.user-info-uri", () -> base + "/userinfo");
        r.add("spring.security.oauth2.client.provider.test.user-name-attribute", () -> "id");
    }

    @LocalServerPort
    int port;

    @Autowired
    ObjectMapper json;

    @Autowired
    JdbcTemplate jdbc;

    private final HttpClient plain = HttpClient.newHttpClient();

    /** 가짜 서비스에 subject 로 로그인해서 돌아온 마지막 응답 (우리 서버의 리다이렉트) */
    private HttpResponse<String> ssoAs(WebClient web, String startPath, String subject, String email, String name) throws Exception {
        Map<String, Object> u = new HashMap<>();
        u.put("id", subject);
        if (email != null) u.put("email", email);
        if (name != null) u.put("name", name);
        nextUser = u;
        HttpResponse<String> r = web.get(startPath);
        String location = loc(r);
        if (location.startsWith("/oauth2/")) { // 로그인 시작 → 우리 서버의 OAuth2 시작 주소
            r = web.get(location);
            location = r.headers().firstValue("Location").orElseThrow();
        }
        assertThat(location).startsWith("http://localhost:" + FAKE.getAddress().getPort() + "/authorize");
        HttpResponse<String> provider = plain.send(HttpRequest.newBuilder(URI.create(location)).build(), HttpResponse.BodyHandlers.ofString());
        String callback = provider.headers().firstValue("Location").orElseThrow();
        assertThat(callback).startsWith("http://localhost:" + port + "/login/oauth2/code/test?");
        return web.get(callback.substring(("http://localhost:" + port).length()));
    }

    /** 리다이렉트 주소 (우리 서버 주소면 경로만) */
    private String loc(HttpResponse<String> r) {
        String l = r.headers().firstValue("Location").orElseThrow();
        String base = "http://localhost:" + port;
        return l.startsWith(base) ? l.substring(base.length()) : l;
    }

    private JsonNode me(WebClient web) throws Exception {
        var r = web.get("/api/me");
        assertThat(r.statusCode()).as(r.body()).isEqualTo(200);
        return json.readTree(r.body());
    }

    private static String uniq() {
        return System.nanoTime() + "-" + SEQ.incrementAndGet();
    }

    @Test
    void 켜진_제공자_목록과_꺼진_제공자() throws Exception {
        WebClient web = new WebClient(port);
        JsonNode list = json.readTree(web.get("/api/auth/providers").body());
        assertThat(list.findValuesAsString("id")).containsExactly("test");
        // 켜지지 않은 제공자로 시작하면 로그인 화면으로
        assertThat(loc(web.get("/api/auth/sso/google"))).isEqualTo("/login/");
    }

    @Test
    void 처음_SSO_로그인하면_새_계정_다음엔_같은_계정() throws Exception {
        String sub = "u-" + uniq();
        WebClient first = new WebClient(port);
        var done = ssoAs(first, "/api/auth/sso/test?next=/sql/", sub, "me@example.com", "Kim");
        assertThat(done.statusCode()).isEqualTo(302);
        assertThat(loc(done)).isEqualTo("/?sso=new");
        JsonNode me = me(first);
        String username = me.get("username").asString();
        assertThat(username).matches("t_[a-z0-9]{8}");
        assertThat(me.get("hasPassword").asBoolean()).isFalse();
        assertThat(me.get("defaultNickname").asBoolean()).isTrue();

        // 다른 브라우저에서 같은 사람으로 다시 로그인 → 같은 계정, 원래 가려던 주소로
        WebClient second = new WebClient(port);
        var again = ssoAs(second, "/api/auth/sso/test?next=/sql/", sub, "me@example.com", "Kim");
        assertThat(loc(again)).isEqualTo("/sql/");
        assertThat(me(second).get("username").asString()).isEqualTo(username);

        // 다른 사이트로 보내는 next 는 무시
        var evil = ssoAs(new WebClient(port), "/api/auth/sso/test?next=//evil.example.com", sub, null, null);
        assertThat(loc(evil)).isEqualTo("/");

        // 비밀번호가 없어서 비밀번호 로그인은 안 되고, 진행도 저장 같은 API 는 똑같이 동작
        assertThat(new WebClient(port).post("/api/auth/login", WebClient.json(username, "anything1", false)).statusCode()).isEqualTo(401);
        long v = json.readTree(second.get("/api/progress/sql").body()).get("version").asLong();
        assertThat(second.put("/api/progress/sql", "{\"data\":{\"solved\":[]},\"version\":" + v + "}").statusCode()).isEqualTo(200);
    }

    @Test
    void SSO_계정이_비밀번호를_만들면_아이디로도_로그인() throws Exception {
        WebClient web = new WebClient(port);
        ssoAs(web, "/api/auth/sso/test", "u-" + uniq(), null, "Lee");
        String username = me(web).get("username").asString();
        // 비밀번호가 없으면 복구 코드 대신 먼저 비밀번호를 만들어요
        assertThat(web.post("/api/me/recovery-code", "{}").statusCode()).isEqualTo(400);
        var res = web.put("/api/me/password", "{\"newPassword\":\"newpass123\"}");
        assertThat(res.statusCode()).as(res.body()).isEqualTo(200);
        assertThat(json.readTree(res.body()).get("hasPassword").asBoolean()).isTrue();
        assertThat(new WebClient(port).post("/api/auth/login", WebClient.json(username, "newpass123", false)).statusCode()).isEqualTo(200);
        // 이제 바꿀 때는 지금 비밀번호가 필요해요
        assertThat(web.put("/api/me/password", "{\"newPassword\":\"other123x\"}").statusCode()).isEqualTo(401);
    }

    @Test
    void 비밀번호_계정에_SSO_연결하고_끊기() throws Exception {
        WebClient web = new WebClient(port);
        String name = "sso_" + (System.nanoTime() % 100000) + SEQ.incrementAndGet();
        assertThat(web.post("/api/auth/signup", WebClient.json(name, "secret123", false)).statusCode()).isEqualTo(201);
        assertThat(json.readTree(web.get("/api/me/identities").body()).get("identities").size()).isZero();

        // 연결 시작은 CSRF 토큰이 있는 POST 로만
        assertThat(web.post("/api/me/identities/test/link", null, false).statusCode()).isEqualTo(403);
        var start = web.post("/api/me/identities/test/link", null);
        assertThat(json.readTree(start.body()).get("url").asString()).isEqualTo("/oauth2/authorization/test");
        String sub = "u-" + uniq();
        var done = ssoAs(web, "/oauth2/authorization/test", sub, "kim@example.com", "Kim");
        assertThat(loc(done)).isEqualTo("/?sso=linked&provider=test#account");
        assertThat(me(web).get("username").asString()).as("연결한 계정 그대로").isEqualTo(name);
        JsonNode ids = json.readTree(web.get("/api/me/identities").body());
        assertThat(ids.get("identities").get(0).get("provider").asString()).isEqualTo("test");
        assertThat(ids.get("identities").get(0).get("email").asString()).isEqualTo("kim@example.com");

        // 이제 SSO 로 로그인하면 이 계정
        WebClient other = new WebClient(port);
        ssoAs(other, "/api/auth/sso/test", sub, null, null);
        assertThat(me(other).get("username").asString()).isEqualTo(name);

        // 같은 SSO 계정을 다른 계정에 연결할 수는 없어요
        WebClient someone = new WebClient(port);
        String name2 = "sso_" + (System.nanoTime() % 100000) + SEQ.incrementAndGet();
        someone.post("/api/auth/signup", WebClient.json(name2, "secret123", false));
        someone.post("/api/me/identities/test/link", null);
        var dup = ssoAs(someone, "/oauth2/authorization/test", sub, null, null);
        assertThat(URLDecoder.decode(loc(dup), StandardCharsets.UTF_8)).contains("이미 다른 Dev Quest 계정에 연결돼 있어요");
        assertThat(me(someone).get("username").asString()).isEqualTo(name2);

        // 비밀번호가 있으니 끊을 수 있어요
        assertThat(web.delete("/api/me/identities/test", "{}").statusCode()).isEqualTo(200);
        assertThat(jdbc.queryForObject("select count(*) from user_identities where subject = ?", Integer.class, sub)).isZero();
    }

    @Test
    void 비밀번호_없는_계정의_마지막_로그인은_끊을_수_없고_탈퇴는_확인만으로() throws Exception {
        WebClient web = new WebClient(port);
        ssoAs(web, "/api/auth/sso/test", "u-" + uniq(), null, null);
        var r = web.delete("/api/me/identities/test", "{}");
        assertThat(r.statusCode()).isEqualTo(400);
        assertThat(r.body()).contains("로그인할 방법이 하나는 남아 있어야 해요");
        assertThat(web.delete("/api/me", "{}").statusCode()).isEqualTo(204);
        assertThat(web.get("/api/me").statusCode()).isEqualTo(401);
    }

    private static Map<String, String> query(String raw) {
        Map<String, String> m = new HashMap<>();
        if (raw == null || raw.isEmpty()) return m;
        for (String kv : raw.split("&")) {
            int i = kv.indexOf('=');
            if (i > 0) m.put(URLDecoder.decode(kv.substring(0, i), StandardCharsets.UTF_8), URLDecoder.decode(kv.substring(i + 1), StandardCharsets.UTF_8));
        }
        return m;
    }

    private static void send(com.sun.net.httpserver.HttpExchange ex, int status, String body) throws IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().add("Content-Type", "application/json");
        ex.sendResponseHeaders(status, b.length);
        ex.getResponseBody().write(b);
        ex.close();
    }
}
