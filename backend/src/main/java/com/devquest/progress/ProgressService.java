package com.devquest.progress;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 과목별 진행도 저장소. 각 과목 앱이 쓰던 JSON 을 그대로 보관하고, version 으로 동시 저장을 막아요 (낙관적 잠금).
 * <ul>
 *   <li>저장할 때 내가 마지막으로 받은 version 을 같이 보내요. DB 의 version 과 같을 때만 저장되고 version 이 1 오른다</li>
 *   <li>다르면(다른 기기에서 먼저 저장했으면) 저장하지 않고 최신 기록을 돌려줘요 → 프론트가 합쳐서 다시 저장</li>
 * </ul>
 * 조건 검사와 저장을 SQL 한 문장으로 해서, 동시에 들어와도 하나만 성공해요.
 */
@Service
public class ProgressService {

    /** 아직 저장한 적 없는 과목의 version */
    public static final long NEW = 0;

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final Set<String> courses;
    private final ScoreService scores;
    private final int maxBytes;

    public ProgressService(JdbcTemplate jdbc, ObjectMapper json, QuestCatalog catalog, ScoreService scores,
            @Value("${devquest.progress.max-bytes}") int maxBytes) {
        this.jdbc = jdbc;
        this.json = json;
        this.courses = Set.copyOf(catalog.courseIds()); // 저장할 수 있는 과목 = 퀘스트 카탈로그의 과목
        this.scores = scores;
        this.maxBytes = maxBytes;
    }

    public record CourseProgress(JsonNode data, long version, Instant updatedAt) {
        static CourseProgress empty() {
            return new CourseProgress(null, NEW, null);
        }
    }

    public Map<String, CourseProgress> getAll(long userId) {
        Map<String, CourseProgress> all = new LinkedHashMap<>();
        jdbc.query("select course_id, data::text as data, version, updated_at from progress where user_id = ? order by course_id",
                rs -> { all.put(rs.getString("course_id"), map(rs)); }, userId);
        return all;
    }

    public CourseProgress get(long userId, String course) {
        checkCourse(course);
        List<CourseProgress> rows = jdbc.query(
                "select data::text as data, version, updated_at from progress where user_id = ? and course_id = ?",
                (rs, i) -> map(rs), userId, course);
        return rows.isEmpty() ? CourseProgress.empty() : rows.getFirst();
    }

    /** 진행도와 랭킹 점수를 한 트랜잭션으로 저장해요 */
    @Transactional
    public CourseProgress save(long userId, String course, JsonNode data, long expectedVersion) {
        checkCourse(course);
        if (data == null || !data.isObject()) throw new BadProgressException("진행도(data)는 JSON 객체여야 해요.");
        String text = json.writeValueAsString(data);
        if (text.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > maxBytes) throw new ProgressTooLargeException(maxBytes);

        List<CourseProgress> saved = expectedVersion == NEW
                ? jdbc.query("""
                        insert into progress (user_id, course_id, data, version, updated_at)
                        values (?, ?, ?::jsonb, 1, now())
                        on conflict (user_id, course_id) do nothing
                        returning data::text as data, version, updated_at""",
                        (rs, i) -> map(rs), userId, course, text)
                : jdbc.query("""
                        update progress set data = ?::jsonb, version = version + 1, updated_at = now()
                        where user_id = ? and course_id = ? and version = ?
                        returning data::text as data, version, updated_at""",
                        (rs, i) -> map(rs), text, userId, course, expectedVersion);
        if (saved.isEmpty()) throw new VersionConflictException(get(userId, course));
        CourseProgress result = saved.getFirst();
        scores.update(userId, course, result.data(), result.updatedAt());
        return result;
    }

    private CourseProgress map(ResultSet rs) throws SQLException {
        return new CourseProgress(json.readTree(rs.getString("data")), rs.getLong("version"),
                rs.getTimestamp("updated_at").toInstant());
    }

    private void checkCourse(String course) {
        if (!courses.contains(course)) throw new UnknownCourseException(course);
    }

    public static class UnknownCourseException extends RuntimeException {
        public UnknownCourseException(String course) {
            super("알 수 없는 과목이에요: " + course);
        }
    }

    public static class BadProgressException extends RuntimeException {
        public BadProgressException(String message) {
            super(message);
        }
    }

    public static class ProgressTooLargeException extends RuntimeException {
        public ProgressTooLargeException(int maxBytes) {
            super("진행도가 너무 커요 (최대 " + (maxBytes / 1024) + "KB).");
        }
    }

    /** 다른 기기에서 먼저 저장해서 version 이 달라요. current 가 지금 DB 에 있는 최신 기록이에요 */
    public static class VersionConflictException extends RuntimeException {
        private final CourseProgress current;

        public VersionConflictException(CourseProgress current) {
            super("다른 곳에서 먼저 저장한 기록이 있어요.");
            this.current = current;
        }

        public CourseProgress getCurrent() {
            return current;
        }
    }
}
