package com.devquest.progress;

import static org.assertj.core.api.Assertions.assertThat;

import com.devquest.TestcontainersConfiguration;
import com.devquest.support.WebClient;
import java.sql.Timestamp;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
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

/** GET /api/me/activity: 연속 학습일 · 최고 기록 · 이번 주 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfiguration.class)
@ActiveProfiles("test")
class ActivityTest {

    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final AtomicInteger SEQ = new AtomicInteger();

    @LocalServerPort
    int port;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    ObjectMapper json;

    record User(WebClient web, long id) {
    }

    private User user() throws Exception {
        WebClient web = new WebClient(port);
        String name = "act_" + (System.nanoTime() % 100000) + "_" + SEQ.incrementAndGet();
        assertThat(web.post("/api/auth/signup", WebClient.json(name, "secret123", false)).statusCode()).isEqualTo(201);
        return new User(web, jdbc.queryForObject("select id from users where username = ?", Long.class, name));
    }

    private final AtomicInteger quest = new AtomicInteger();

    /** daysAgo 일 전(한국 날짜) 0시 1분에 끝낸 퀘스트 하나 */
    private void done(User u, int daysAgo, int xp, boolean live) {
        LocalDate d = LocalDate.now(SEOUL).minusDays(daysAgo);
        jdbc.update("insert into quest_completions (user_id, course_id, quest_id, xp, completed_at, live) values (?, 'sql', ?, ?, ?, ?)",
                u.id(), "q" + quest.incrementAndGet(), xp, Timestamp.from(d.atTime(0, 1).atZone(SEOUL).toInstant()), live);
    }

    private JsonNode activity(User u) throws Exception {
        var res = u.web().get("/api/me/activity");
        assertThat(res.statusCode()).as(res.body()).isEqualTo(200);
        return json.readTree(res.body());
    }

    @Test
    void 처음엔_모두_0() throws Exception {
        JsonNode a = activity(user());
        assertThat(a.get("streak").asInt()).isZero();
        assertThat(a.get("bestStreak").asInt()).isZero();
        assertThat(a.get("activeToday").asBoolean()).isFalse();
        assertThat(a.get("timezone").asString()).isEqualTo("Asia/Seoul");
        assertThat(a.get("week").get("days").size()).isEqualTo(7);
        assertThat(a.get("week").get("start").asString())
                .isEqualTo(LocalDate.now(SEOUL).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).toString());
    }

    @Test
    void 연속_학습일과_최고_기록_예전_기록은_세지_않음() throws Exception {
        User u = user();
        done(u, 0, 100, true);
        done(u, 0, 150, true); // 같은 날 두 개
        done(u, 1, 100, true);
        done(u, 2, 250, true);
        done(u, 3, 100, false); // 예전 기록(추정 시각)은 잇지 않아요
        for (int i = 5; i <= 8; i++) done(u, i, 100, true); // 4일 연속
        JsonNode a = activity(u);
        assertThat(a.get("streak").asInt()).isEqualTo(3);
        assertThat(a.get("bestStreak").asInt()).isEqualTo(4);
        assertThat(a.get("activeToday").asBoolean()).isTrue();
        assertThat(a.get("totalDays").asInt()).isEqualTo(7);

        // 이번 주(월요일부터) 기록만 더해요
        LocalDate today = LocalDate.now(SEOUL), monday = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        int[][] live = {{0, 100}, {0, 150}, {1, 100}, {2, 250}, {5, 100}, {6, 100}, {7, 100}, {8, 100}};
        int xp = 0, n = 0;
        for (int[] l : live) if (!today.minusDays(l[0]).isBefore(monday)) { xp += l[1]; n++; }
        assertThat(a.get("week").get("xp").asInt()).isEqualTo(xp);
        assertThat(a.get("week").get("done").asInt()).isEqualTo(n);
        JsonNode todayCell = null;
        for (JsonNode d : a.get("week").get("days")) if (d.get("date").asString().equals(today.toString())) todayCell = d;
        assertThat(todayCell.get("done").asInt()).isEqualTo(2);
        assertThat(todayCell.get("xp").asInt()).isEqualTo(250);
    }

    @Test
    void 오늘_아직이면_어제까지의_연속을_보여_줌() throws Exception {
        User u = user();
        done(u, 1, 100, true);
        done(u, 2, 100, true);
        JsonNode a = activity(u);
        assertThat(a.get("streak").asInt()).isEqualTo(2);
        assertThat(a.get("activeToday").asBoolean()).isFalse();
    }

    @Test
    void 하루라도_빠지면_끊김() throws Exception {
        User u = user();
        done(u, 2, 100, true);
        done(u, 3, 100, true);
        assertThat(activity(u).get("streak").asInt()).isZero();
    }

    @Test
    void 진행도를_저장하면_오늘_기록이_생김() throws Exception {
        User u = user();
        var res = u.web().put("/api/progress/sql", "{\"data\":{\"solved\":[\"basics-vip\"]},\"version\":0}");
        assertThat(res.statusCode()).isEqualTo(200);
        JsonNode a = activity(u);
        assertThat(a.get("streak").asInt()).isEqualTo(1);
        assertThat(a.get("activeToday").asBoolean()).isTrue();
        assertThat(a.get("week").get("done").asInt()).isEqualTo(1);
    }
}
