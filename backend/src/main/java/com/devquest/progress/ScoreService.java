package com.devquest.progress;

import java.sql.Timestamp;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** 진행 기록 → 과목별 점수(course_scores). 랭킹은 이 표를 정렬해서 만들어요 */
@Service
public class ScoreService {

    private static final Logger log = LoggerFactory.getLogger(ScoreService.class);

    private final JdbcTemplate jdbc;
    private final QuestCatalog catalog;
    private final ObjectMapper json;

    public ScoreService(JdbcTemplate jdbc, QuestCatalog catalog, ObjectMapper json) {
        this.jdbc = jdbc;
        this.catalog = catalog;
        this.json = json;
    }

    /** 진행도를 저장할 때 같이 불러요. XP 가 바뀌었을 때만 reached_at 을 갱신해요 */
    public void update(long userId, String courseId, JsonNode data, Instant when) {
        QuestCatalog.Score s = catalog.score(courseId, data);
        jdbc.update("""
                insert into course_scores (user_id, course_id, xp, done_count, reached_at) values (?, ?, ?, ?, ?)
                on conflict (user_id, course_id) do update set
                    reached_at = case when course_scores.xp <> excluded.xp then excluded.reached_at else course_scores.reached_at end,
                    xp = excluded.xp,
                    done_count = excluded.done_count""",
                userId, courseId, s.xp(), s.done(), Timestamp.from(when));
    }

    /**
     * 서버를 켤 때 모든 진행도로 점수를 다시 계산해요. 퀘스트가 추가·삭제돼 카탈로그가 바뀌었거나,
     * 랭킹 기능 전에 저장된 진행도도 점수가 생겨요. 처음 계산하는 점수의 도달 시각은 진행도를 저장한 시각이에요.
     */
    @EventListener(ApplicationReadyEvent.class)
    public void recomputeAll() {
        int[] n = {0};
        jdbc.query("select user_id, course_id, data::text as data, updated_at from progress", rs -> {
            String course = rs.getString("course_id");
            if (catalog.course(course) == null) return;
            update(rs.getLong("user_id"), course, json.readTree(rs.getString("data")), rs.getTimestamp("updated_at").toInstant());
            n[0]++;
        });
        int removed = catalog.courseIds().isEmpty() ? 0
                : jdbc.update("delete from course_scores where course_id <> all (?)",
                        (Object) catalog.courseIds().toArray(String[]::new));
        log.info("랭킹 점수 다시 계산: 진행도 {}개{}", n[0], removed > 0 ? ", 없어진 과목 점수 " + removed + "개 삭제" : "");
    }
}
