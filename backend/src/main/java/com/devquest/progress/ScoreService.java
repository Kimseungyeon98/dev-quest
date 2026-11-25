package com.devquest.progress;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 진행 기록 → 과목별 점수(course_scores)와 퀘스트 완료 기록(quest_completions).
 * 랭킹은 점수 표를, 연속 학습일·이번 주 기록·주간 랭킹은 완료 기록을 써요.
 */
@Service
public class ScoreService {

    private static final Logger log = LoggerFactory.getLogger(ScoreService.class);

    private final JdbcTemplate jdbc;
    private final QuestCatalog catalog;
    private final ObjectMapper json;
    private final int bulkLimit;

    public ScoreService(JdbcTemplate jdbc, QuestCatalog catalog, ObjectMapper json,
            @Value("${devquest.ranking.bulk-limit:5}") int bulkLimit) {
        this.jdbc = jdbc;
        this.catalog = catalog;
        this.json = json;
        this.bulkLimit = bulkLimit;
    }

    /** 진행도를 저장할 때 같이 불러요 (지금 막 저장한 기록이라 완료 시각이 정확해요) */
    public void update(long userId, String courseId, JsonNode data, Instant when) {
        update(userId, courseId, data, when, true);
    }

    /**
     * 점수와 완료 기록을 진행 기록에 맞춰요.
     * <ul>
     *   <li>점수: XP 가 바뀌었을 때만 reached_at(그 XP 에 도달한 때)을 갱신</li>
     *   <li>완료 기록: 새로 끝낸 퀘스트는 시각과 함께 추가, 진행 기록에서 빠진 퀘스트(초기화 등)는 삭제</li>
     * </ul>
     * live = false 는 시각을 모르는 예전 기록을 채울 때예요 (스트릭·주간 랭킹에서 빠져요).
     * 한 번 저장에 새로 끝낸 퀘스트가 bulk-limit 보다 많아도 live = false 로 기록해요. 오프라인에서 쌓인 기록이거나
     * 브라우저 저장소를 고친 기록이라 "지금 끝냈다"는 시각을 믿을 수 없어요 (누적 점수에는 들어가요).
     */
    public void update(long userId, String courseId, JsonNode data, Instant when, boolean live) {
        syncCompletions(userId, courseId, data, when, live);
        QuestCatalog.Score s = catalog.score(courseId, data);
        jdbc.update("""
                insert into course_scores (user_id, course_id, xp, done_count, reached_at) values (?, ?, ?, ?, ?)
                on conflict (user_id, course_id) do update set
                    reached_at = case when course_scores.xp <> excluded.xp then excluded.reached_at else course_scores.reached_at end,
                    xp = excluded.xp,
                    done_count = excluded.done_count""",
                userId, courseId, s.xp(), s.done(), Timestamp.from(when));
    }

    private void syncCompletions(long userId, String courseId, JsonNode data, Instant when, boolean live) {
        Set<String> done = catalog.doneIds(courseId, data);
        Set<String> recorded = new HashSet<>(jdbc.queryForList(
                "select quest_id from quest_completions where user_id = ? and course_id = ?", String.class, userId, courseId));
        long fresh = done.stream().filter(id -> !recorded.contains(id)).count();
        if (live && fresh > bulkLimit) {
            log.info("한 번에 새 완료 {}개 (user {}, {}): 완료 시각을 믿지 않고 live = false 로 기록", fresh, userId, courseId);
            live = false;
        }
        List<Object[]> added = new ArrayList<>();
        for (String id : done) {
            if (recorded.contains(id)) continue;
            // 지금 저장한 기록은 서버 시각. 예전 기록을 채울 때는 앱이 저장해 둔 시각(Git 의 t)이 있으면 그걸, 없으면 진행도 저장 시각
            Instant at = live ? when : Objects.requireNonNullElse(catalog.recordedAt(courseId, data, id), when);
            if (at.isAfter(when)) at = when;
            added.add(new Object[] {userId, courseId, id, catalog.course(courseId).questXp().get(id), Timestamp.from(at), live});
        }
        if (!added.isEmpty()) {
            jdbc.batchUpdate("""
                    insert into quest_completions (user_id, course_id, quest_id, xp, completed_at, live) values (?, ?, ?, ?, ?, ?)
                    on conflict (user_id, course_id, quest_id) do nothing""", added);
        }
        recorded.removeAll(done);
        if (!recorded.isEmpty()) {
            jdbc.update("delete from quest_completions where user_id = ? and course_id = ? and quest_id = any (?)",
                    userId, courseId, recorded.toArray(String[]::new));
        }
    }

    /**
     * 서버를 켤 때 모든 진행도로 점수를 다시 계산해요. 퀘스트가 추가·삭제돼 카탈로그가 바뀌었거나,
     * 랭킹 기능 전에 저장된 진행도도 점수가 생겨요. 처음 계산하는 점수의 도달 시각은 진행도를 저장한 시각이에요.
     * 완료 기록도 이때 빠진 것을 채워요 (시각을 정확히 모르니 live = false — 이미 있는 기록은 그대로예요).
     */
    @EventListener(ApplicationReadyEvent.class)
    public void recomputeAll() {
        int[] n = {0};
        jdbc.query("select user_id, course_id, data::text as data, updated_at from progress", rs -> {
            String course = rs.getString("course_id");
            if (catalog.course(course) == null) return;
            update(rs.getLong("user_id"), course, json.readTree(rs.getString("data")), rs.getTimestamp("updated_at").toInstant(), false);
            n[0]++;
        });
        String[] courses = catalog.courseIds().toArray(String[]::new);
        int removed = courses.length == 0 ? 0 : jdbc.update("delete from course_scores where course_id <> all (?)", (Object) courses);
        if (courses.length > 0) jdbc.update("delete from quest_completions where course_id <> all (?)", (Object) courses);
        log.info("랭킹 점수 다시 계산: 진행도 {}개{}", n[0], removed > 0 ? ", 없어진 과목 점수 " + removed + "개 삭제" : "");
    }
}
