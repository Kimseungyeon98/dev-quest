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
    void 헬스체크는_로그인_없이() throws Exception {
        var res = new WebClient(port).get("/actuator/health");
        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(res.body()).contains("\"UP\"");
    }
}
