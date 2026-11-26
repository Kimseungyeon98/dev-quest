package com.devquest.progress;

import com.devquest.progress.ProgressService.BadProgressException;
import com.devquest.progress.ProgressService.UnknownCourseException;
import com.devquest.user.UserRepository;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 오답 노트. 과목 화면이 퀘스트마다 일어난 일을 알려 주면(shared/dq.js 의 DevQuest.review) 모아 둬요.
 * <ul>
 *   <li>POST /api/review/events { course, quest, type, review }
 *     <ul>
 *       <li>type = wrong(틀린 시도) · hint(힌트 보기) · answer(정답 보기) → 오답 노트에 올라가요 (이미 졸업했으면 다시 올라가요)</li>
 *       <li>type = correct(맞힘) → 맞힌 시각을 남기고, review = true(오답 노트에서 열어 다시 맞힘)면 졸업</li>
 *     </ul>
 *   </li>
 *   <li>GET /api/review → 오답 노트(아직 졸업 안 한 것, 최근 것부터)와 지금까지 졸업한 수</li>
 *   <li>DELETE /api/review/{course}/{quest} → 오답 노트에서 빼기 (졸업 처리)</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/review")
public class ReviewController {

    private static final int MAX_COUNT = 9999;
    private static final int LIST_LIMIT = 100;

    private final JdbcTemplate jdbc;
    private final QuestCatalog catalog;
    private final UserRepository users;
    private final Clock clock;

    public ReviewController(JdbcTemplate jdbc, QuestCatalog catalog, UserRepository users, Clock clock) {
        this.jdbc = jdbc;
        this.catalog = catalog;
        this.users = users;
        this.clock = clock;
    }

    public record Event(String course, String quest, String type, Boolean review) {
    }

    public record Item(String course, String quest, int wrong, int hints, int answers, Instant firstAt, Instant lastAt,
            Instant solvedAt, boolean solved) {
    }

    public record Notes(List<Item> items, int open, int cleared) {
    }

    @PostMapping("/events")
    public ResponseEntity<Map<String, Object>> event(@AuthenticationPrincipal UserDetails user, @RequestBody Event e) {
        long userId = userId(user);
        String course = e == null ? null : e.course();
        String quest = e == null ? null : e.quest();
        if (course == null || catalog.course(course) == null) throw new UnknownCourseException(String.valueOf(course));
        if (quest == null || !catalog.course(course).questXp().containsKey(quest)) throw new BadProgressException("알 수 없는 퀘스트예요.");
        Timestamp now = Timestamp.from(clock.instant());
        String type = e.type() == null ? "" : e.type();
        boolean cleared = false;
        switch (type) {
            case "wrong", "hint", "answer" -> {
                String col = switch (type) { case "wrong" -> "wrong_count"; case "hint" -> "hint_count"; default -> "answer_count"; };
                jdbc.update("""
                        insert into quest_reviews (user_id, course_id, quest_id, %1$s, first_at, last_at) values (?, ?, ?, 1, ?, ?)
                        on conflict (user_id, course_id, quest_id) do update set
                            %1$s = least(quest_reviews.%1$s + 1, %2$d), last_at = excluded.last_at, cleared_at = null"""
                        .formatted(col, MAX_COUNT), userId, course, quest, now, now);
            }
            case "correct" -> {
                boolean review = Boolean.TRUE.equals(e.review());
                cleared = jdbc.update("""
                        update quest_reviews set solved_at = ?, cleared_at = case when ? then ? else cleared_at end
                        where user_id = ? and course_id = ? and quest_id = ?""",
                        now, review, now, userId, course, quest) > 0 && review;
            }
            default -> throw new BadProgressException("type 은 wrong · hint · answer · correct 중 하나예요.");
        }
        return ResponseEntity.ok(Map.of("ok", true, "cleared", cleared));
    }

    @GetMapping
    public Notes notes(@AuthenticationPrincipal UserDetails user) {
        long userId = userId(user);
        List<Item> items = jdbc.query("""
                select course_id, quest_id, wrong_count, hint_count, answer_count, first_at, last_at, solved_at
                from quest_reviews where user_id = ? and cleared_at is null order by last_at desc limit ?""",
                (rs, i) -> {
                    Timestamp solved = rs.getTimestamp("solved_at");
                    Instant last = rs.getTimestamp("last_at").toInstant();
                    return new Item(rs.getString("course_id"), rs.getString("quest_id"), rs.getInt("wrong_count"),
                            rs.getInt("hint_count"), rs.getInt("answer_count"), rs.getTimestamp("first_at").toInstant(), last,
                            solved == null ? null : solved.toInstant(), solved != null && !solved.toInstant().isBefore(last));
                }, userId, LIST_LIMIT)
                .stream().filter(it -> catalog.course(it.course()) != null && catalog.course(it.course()).questXp().containsKey(it.quest()))
                .toList();
        Integer open = jdbc.queryForObject("select count(*) from quest_reviews where user_id = ? and cleared_at is null", Integer.class, userId);
        Integer cleared = jdbc.queryForObject("select count(*) from quest_reviews where user_id = ? and cleared_at is not null", Integer.class, userId);
        return new Notes(items, open == null ? 0 : open, cleared == null ? 0 : cleared);
    }

    @DeleteMapping("/{course}/{quest}")
    public ResponseEntity<Map<String, Object>> dismiss(@AuthenticationPrincipal UserDetails user, @PathVariable String course,
            @PathVariable String quest) {
        int n = jdbc.update("update quest_reviews set cleared_at = ? where user_id = ? and course_id = ? and quest_id = ? and cleared_at is null",
                Timestamp.from(clock.instant()), userId(user), course, quest);
        return ResponseEntity.ok(Map.of("ok", true, "removed", n > 0));
    }

    private long userId(UserDetails user) {
        return users.findIdByUsername(user.getUsername()).orElseThrow(() -> new UsernameNotFoundException(user.getUsername()));
    }
}
