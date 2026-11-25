package com.devquest.web;

import static org.assertj.core.api.Assertions.assertThat;

import com.devquest.TestcontainersConfiguration;
import com.devquest.support.WebClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;

/** 로그인한 사용자 기준으로 학습 사이트 파일이 잘 나가는지 확인해요 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfiguration.class)
@ActiveProfiles("test")
class StaticPagesTest {

    @LocalServerPort
    int port;

    WebClient web;

    @BeforeEach
    void login() throws Exception {
        web = new WebClient(port);
        String name = "static_" + (System.nanoTime() % 1_000_000);
        assertThat(web.post("/api/auth/signup", WebClient.json(name, "secret123", false)).statusCode()).isEqualTo(201);
    }

    @Test
    void 허브_페이지() throws Exception {
        var res = web.get("/");
        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(res.body()).contains("courses.js").contains("shared/dq.js");
    }

    @Test
    void 과목_폴더는_index_html_로_연결() throws Exception {
        for (String course : new String[] {"linux", "sql", "git", "algo"}) {
            var res = web.get("/" + course + "/");
            assertThat(res.statusCode()).as(course).isEqualTo(200);
            assertThat(res.headers().firstValue("Content-Type").orElse("")).startsWith("text/html");
            assertThat(res.body()).as(course).contains("../shared/dq.js");
        }
    }

    @Test
    void 끝에_슬래시가_없으면_슬래시_주소로_리다이렉트() throws Exception {
        var res = web.get("/algo?x=1");
        assertThat(res.statusCode()).isEqualTo(302);
        assertThat(res.headers().firstValue("Location").orElse("")).endsWith("/algo/?x=1");
    }

    @Test
    void 정적_파일() throws Exception {
        var res = web.get("/shared/dq.js");
        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(res.body()).contains("window.DevQuest");
        assertThat(web.get("/algo/js/judge.js").statusCode()).isEqualTo(200);
    }

    @Test
    void 사이트가_아닌_파일은_나가지_않음() throws Exception {
        assertThat(web.get("/algo/tools/serve.js").statusCode()).isEqualTo(404);
        assertThat(web.get("/README.md").statusCode()).isEqualTo(404);
        assertThat(web.get("/backend/build.gradle.kts").statusCode()).isEqualTo(404);
        assertThat(web.get("/.git/config").statusCode()).isEqualTo(404);
        assertThat(web.get("/application.yml").statusCode()).isEqualTo(404);
    }

    @Test
    void 서비스_워커는_로그인_없이_사이트_맨_위에서() throws Exception {
        // 로그인 화면에서도 등록해야 하고, 사이트 전체를 맡으려면 맨 위 주소(/sw.js)여야 해요
        var res = new WebClient(port).get("/sw.js");
        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(res.headers().firstValue("Content-Type").orElse("")).contains("javascript");
        assertThat(res.body()).contains("addEventListener('fetch'");
    }

    @Test
    void 보안_헤더() throws Exception {
        var hub = web.get("/");
        String csp = hub.headers().firstValue("Content-Security-Policy").orElse("");
        assertThat(csp).contains("script-src 'self' 'wasm-unsafe-eval';").contains("frame-ancestors 'none'").contains("object-src 'none'");
        assertThat(csp).doesNotContain("'unsafe-eval'").doesNotContain("script-src 'self' 'unsafe-inline'");
        assertThat(hub.headers().firstValue("X-Content-Type-Options")).hasValue("nosniff");
        assertThat(hub.headers().firstValue("Referrer-Policy")).hasValue("strict-origin-when-cross-origin");
        assertThat(hub.headers().firstValue("Permissions-Policy").orElse("")).contains("camera=()");
        // 로그인 화면과 API 응답에도
        assertThat(new WebClient(port).get("/login/").headers().firstValue("Content-Security-Policy")).isPresent();
        assertThat(web.get("/api/me").headers().firstValue("Content-Security-Policy")).isPresent();
        // Algorithm Quest 만 CheerpJ 때문에 넓혀요
        String algo = web.get("/algo/").headers().firstValue("Content-Security-Policy").orElse("");
        assertThat(algo).contains("'unsafe-eval'").contains("https://cjrtnc.leaningtech.com").contains("https://cdnjs.cloudflare.com");
    }

    @Test
    void 사이트_HTML_에는_인라인_스크립트가_없음() throws Exception {
        // CSP 가 인라인 스크립트를 막아서, 있으면 그 페이지가 동작하지 않아요
        var resolver = new org.springframework.core.io.support.PathMatchingResourcePatternResolver();
        var pages = resolver.getResources("classpath:static/**/*.html");
        assertThat(pages).hasSizeGreaterThanOrEqualTo(6);
        var inline = java.util.regex.Pattern.compile("<script(?![^>]*\\bsrc=)[^>]*>", java.util.regex.Pattern.CASE_INSENSITIVE);
        var handler = java.util.regex.Pattern.compile("\\son[a-z]+\\s*=\\s*[\"']", java.util.regex.Pattern.CASE_INSENSITIVE);
        for (var page : pages) {
            String html = page.getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
            assertThat(inline.matcher(html).find()).as(page.getURL() + " 인라인 <script>").isFalse();
            assertThat(handler.matcher(html).find()).as(page.getURL() + " onclick= 같은 인라인 이벤트").isFalse();
        }
    }

    @Test
    void 헬스체크는_로그인_없이() throws Exception {
        var res = new WebClient(port).get("/actuator/health");
        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(res.body()).contains("\"UP\"");
    }
}
