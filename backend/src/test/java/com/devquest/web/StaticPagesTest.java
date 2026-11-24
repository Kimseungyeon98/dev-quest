package com.devquest.web;

import static org.assertj.core.api.Assertions.assertThat;

import com.devquest.TestcontainersConfiguration;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfiguration.class)
class StaticPagesTest {

    @LocalServerPort
    int port;

    private final HttpClient http = HttpClient.newHttpClient(); // 리다이렉트는 따라가지 않아요

    private HttpResponse<String> get(String path) throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).build(),
                HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void 허브_페이지() throws Exception {
        var res = get("/");
        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(res.body()).contains("courses.js").contains("shared/dq.js");
    }

    @Test
    void 과목_폴더는_index_html_로_연결() throws Exception {
        for (String course : new String[] {"linux", "sql", "git", "algo"}) {
            var res = get("/" + course + "/");
            assertThat(res.statusCode()).as(course).isEqualTo(200);
            assertThat(res.headers().firstValue("Content-Type").orElse("")).startsWith("text/html");
            assertThat(res.body()).as(course).contains("../shared/dq.js");
        }
    }

    @Test
    void 끝에_슬래시가_없으면_슬래시_주소로_리다이렉트() throws Exception {
        var res = get("/algo?x=1");
        assertThat(res.statusCode()).isEqualTo(302);
        assertThat(res.headers().firstValue("Location").orElse("")).endsWith("/algo/?x=1");
    }

    @Test
    void 정적_파일() throws Exception {
        var res = get("/shared/dq.js");
        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(res.body()).contains("window.DevQuest");
        assertThat(get("/algo/js/judge.js").statusCode()).isEqualTo(200);
    }

    @Test
    void 사이트가_아닌_파일은_나가지_않음() throws Exception {
        assertThat(get("/algo/tools/serve.js").statusCode()).isEqualTo(404);
        assertThat(get("/README.md").statusCode()).isEqualTo(404);
        assertThat(get("/backend/build.gradle.kts").statusCode()).isEqualTo(404);
        assertThat(get("/.git/config").statusCode()).isEqualTo(404);
        assertThat(get("/application.yml").statusCode()).isEqualTo(404);
    }

    @Test
    void 헬스체크() throws Exception {
        var res = get("/actuator/health");
        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(res.body()).contains("\"UP\"");
    }
}
