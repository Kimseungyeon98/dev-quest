package com.devquest.progress;

import com.devquest.progress.ProgressService.UnknownCourseException;
import com.devquest.user.UserRepository;
import java.util.ArrayList;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 랭킹. GET /api/ranking?course=all|linux|sql|git|algo&limit=50
 * <ul>
 *   <li>XP 가 높은 순, 같으면 그 XP 에 먼저 도달한 순 (등수는 겹치지 않아요)</li>
 *   <li>XP 가 0 인 사람은 빠져요. 다른 사람은 닉네임만 보여요 (로그인 아이디는 보여 주지 않아요)</li>
 *   <li>me: 내 순위 (상위 목록 밖이어도), 아직 XP 가 없으면 null</li>
 * </ul>
 * 티어·레벨은 프론트가 shared/dq.js 의 같은 규칙으로 xp / maxXp 에서 계산해요.
 */
@RestController
@RequestMapping("/api/ranking")
public class RankingController {

    public static final String ALL = "all";
    private static final int MAX_LIMIT = 100;

    private final JdbcTemplate jdbc;
    private final QuestCatalog catalog;
    private final UserRepository users;

    public RankingController(JdbcTemplate jdbc, QuestCatalog catalog, UserRepository users) {
        this.jdbc = jdbc;
        this.catalog = catalog;
        this.users = users;
    }

    public record Entry(int rank, String nickname, int xp, int done, boolean me) {
    }

    public record Ranking(String course, int maxXp, int totalQuests, int players, List<Entry> entries, Entry me) {
    }

    @GetMapping
    public Ranking ranking(@AuthenticationPrincipal UserDetails user,
            @RequestParam(defaultValue = ALL) String course,
            @RequestParam(defaultValue = "50") int limit) {
        int top = Math.max(1, Math.min(limit, MAX_LIMIT));
        long myId = users.findIdByUsername(user.getUsername()).orElse(-1L);

        String scores;
        Object[] params;
        int maxXp, totalQuests;
        if (ALL.equals(course)) {
            // 과목별 점수를 더해요. 도달 시각은 가장 마지막 과목의 시각
            scores = """
                    select user_id, sum(xp)::int as xp, sum(done_count)::int as done, max(reached_at) as reached_at
                    from course_scores group by user_id""";
            params = new Object[] {top, myId};
            maxXp = catalog.maxXpAll();
            totalQuests = catalog.questCountAll();
        } else {
            QuestCatalog.Course c = catalog.course(course);
            if (c == null) throw new UnknownCourseException(course);
            scores = "select user_id, xp, done_count as done, reached_at from course_scores where course_id = ?";
            params = new Object[] {course, top, myId};
            maxXp = c.maxXp();
            totalQuests = c.questXp().size();
        }

        List<Entry> entries = new ArrayList<>();
        Entry[] me = {null};
        int[] players = {0};
        jdbc.query("""
                with scores as (%s),
                ranked as (
                    select s.user_id, u.nickname, s.xp, s.done,
                           row_number() over (order by s.xp desc, s.reached_at asc, s.user_id asc) as rank,
                           count(*) over () as players
                    from scores s join users u on u.id = s.user_id
                    where s.xp > 0
                )
                select * from ranked where rank <= ? or user_id = ? order by rank""".formatted(scores),
                rs -> {
                    boolean mine = rs.getLong("user_id") == myId;
                    Entry e = new Entry(rs.getInt("rank"), rs.getString("nickname"), rs.getInt("xp"), rs.getInt("done"), mine);
                    players[0] = rs.getInt("players");
                    if (e.rank() <= top) entries.add(e);
                    if (mine) me[0] = e;
                }, params);
        return new Ranking(course, maxXp, totalQuests, players[0], entries, me[0]);
    }
}
