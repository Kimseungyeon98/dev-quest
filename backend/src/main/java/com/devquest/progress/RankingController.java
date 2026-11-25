package com.devquest.progress;

import com.devquest.progress.ProgressService.UnknownCourseException;
import com.devquest.user.UserRepository;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 랭킹. GET /api/ranking?course=all|linux|sql|git|algo&period=all|week&limit=50
 * <ul>
 *   <li>period=all(누적): 지금까지 모은 XP. period=week(이번 주): 이번 주 월요일 0시(devquest.timezone)부터
 *       새로 끝낸 퀘스트의 XP 만 더해요 (완료 시각을 추정한 예전 기록은 빼요)</li>
 *   <li>XP 가 높은 순, 같으면 그 XP 에 먼저 도달한 순 (등수는 겹치지 않아요)</li>
 *   <li>XP 가 0 인 사람은 빠져요. 다른 사람은 닉네임만 보여요 (로그인 아이디는 보여 주지 않아요)</li>
 *   <li>me: 내 순위 (상위 목록 밖이어도), 아직 XP 가 없으면 null</li>
 *   <li>랭킹 확인 중(review)이거나 숨긴(hidden) 계정은 빠져요 (RankingGuard). 본인에게는 myStatus 로 알려 줘요</li>
 * </ul>
 * 티어·레벨은 프론트가 shared/dq.js 의 같은 규칙으로 xp / maxXp 에서 계산해요.
 */
@RestController
@RequestMapping("/api/ranking")
public class RankingController {

    public static final String ALL = "all";
    public static final String WEEK = "week";
    private static final int MAX_LIMIT = 100;

    private final JdbcTemplate jdbc;
    private final QuestCatalog catalog;
    private final UserRepository users;
    private final Clock clock;
    private final ZoneId zone;

    public RankingController(JdbcTemplate jdbc, QuestCatalog catalog, UserRepository users, Clock clock,
            @Value("${devquest.timezone:Asia/Seoul}") String timezone) {
        this.jdbc = jdbc;
        this.catalog = catalog;
        this.users = users;
        this.clock = clock;
        this.zone = ZoneId.of(timezone);
    }

    public record Entry(int rank, String nickname, int xp, int done, boolean me) {
    }

    /** weekStart: period=week 일 때 이번 주 월요일 (아니면 null) */
    /** myStatus: 내 랭킹 상태 (ok · trusted 면 랭킹에 보이고, review · hidden 이면 빠져요) */
    public record Ranking(String course, String period, LocalDate weekStart, int maxXp, int totalQuests, int players,
            List<Entry> entries, Entry me, String myStatus) {
    }

    @GetMapping
    public Ranking ranking(@AuthenticationPrincipal UserDetails user,
            @RequestParam(defaultValue = ALL) String course,
            @RequestParam(defaultValue = ALL) String period,
            @RequestParam(defaultValue = "50") int limit) {
        int top = Math.max(1, Math.min(limit, MAX_LIMIT));
        long myId = users.findIdByUsername(user.getUsername()).orElse(-1L);
        if (!ALL.equals(period) && !WEEK.equals(period)) throw new ProgressService.BadProgressException("period 는 all 또는 week 예요.");
        if (!ALL.equals(course) && catalog.course(course) == null) throw new UnknownCourseException(course);

        String scores;
        Object[] params;
        int maxXp = ALL.equals(course) ? catalog.maxXpAll() : catalog.course(course).maxXp();
        int totalQuests = ALL.equals(course) ? catalog.questCountAll() : catalog.course(course).questXp().size();
        LocalDate weekStart = null;
        if (WEEK.equals(period)) {
            // 이번 주에 새로 끝낸 퀘스트만. 도달 시각은 이번 주 마지막 완료 시각
            weekStart = LocalDate.now(clock.withZone(zone)).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
            Timestamp from = Timestamp.from(weekStart.atStartOfDay(zone).toInstant());
            scores = "select user_id, sum(xp)::int as xp, count(*)::int as done, max(completed_at) as reached_at"
                    + " from quest_completions where live and completed_at >= ?"
                    + (ALL.equals(course) ? "" : " and course_id = ?") + " group by user_id";
            params = ALL.equals(course) ? new Object[] {from, top, myId} : new Object[] {from, course, top, myId};
        } else if (ALL.equals(course)) {
            // 과목별 점수를 더해요. 도달 시각은 가장 마지막 과목의 시각
            scores = """
                    select user_id, sum(xp)::int as xp, sum(done_count)::int as done, max(reached_at) as reached_at
                    from course_scores group by user_id""";
            params = new Object[] {top, myId};
        } else {
            scores = "select user_id, xp, done_count as done, reached_at from course_scores where course_id = ?";
            params = new Object[] {course, top, myId};
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
                    where s.xp > 0 and u.ranking_status in ('ok', 'trusted')
                )
                select * from ranked where rank <= ? or user_id = ? order by rank""".formatted(scores),
                rs -> {
                    boolean mine = rs.getLong("user_id") == myId;
                    Entry e = new Entry(rs.getInt("rank"), rs.getString("nickname"), rs.getInt("xp"), rs.getInt("done"), mine);
                    players[0] = rs.getInt("players");
                    if (e.rank() <= top) entries.add(e);
                    if (mine) me[0] = e;
                }, params);
        String myStatus = jdbc.query("select ranking_status from users where id = ?", (rs, i) -> rs.getString(1), myId)
                .stream().findFirst().orElse(RankingGuard.OK);
        return new Ranking(course, period, weekStart, maxXp, totalQuests, players[0], entries, me[0], myStatus);
    }
}
