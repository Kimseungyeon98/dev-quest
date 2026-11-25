package com.devquest.progress;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * 랭킹 부정 방지. 진행도는 브라우저가 보내 주는 기록이라 마음먹고 고치면 막을 수 없어요.
 * 대신 사람이 풀 수 없는 속도의 기록을 찾아서 <b>랭킹에서만</b> 잠시 빼고(진행도·스트릭은 그대로) 관리자가 확인해요.
 * <ul>
 *   <li>한꺼번에 들어온 기록(한 번 저장에 새 완료가 bulk-limit 개 초과)은 ScoreService 가 live = false 로 남겨요.
 *       주간 랭킹·스트릭에는 안 들어가고 누적 점수에만 들어가요</li>
 *   <li>pace-window 동안 실제로 끝낸(live) 퀘스트가 pace-limit 개를 넘으면 → review</li>
 *   <li>가입한 지 new-account-window 안에 전체 XP 의 new-account-share 이상을 모으면 → review</li>
 * </ul>
 * review·hidden 인 계정은 랭킹 목록에서 빠지고, 본인에게는 그 이유가 보여요.
 * 관리자 API: GET /api/admin/ranking/review · PUT /api/admin/users/{아이디}/ranking { status: ok|hidden|trusted }
 */
@Service
public class RankingGuard {

    private static final Logger log = LoggerFactory.getLogger(RankingGuard.class);

    public static final String OK = "ok", REVIEW = "review", HIDDEN = "hidden", TRUSTED = "trusted";
    /** 랭킹에 보이는 상태 */
    public static final List<String> VISIBLE = List.of(OK, TRUSTED);

    private final JdbcTemplate jdbc;
    private final QuestCatalog catalog;
    private final Clock clock;
    private final Duration paceWindow;
    private final int paceLimit;
    private final Duration newAccountWindow;
    private final double newAccountShare;

    public RankingGuard(JdbcTemplate jdbc, QuestCatalog catalog, Clock clock,
            @Value("${devquest.ranking.pace-window:10m}") Duration paceWindow,
            @Value("${devquest.ranking.pace-limit:20}") int paceLimit,
            @Value("${devquest.ranking.new-account-window:24h}") Duration newAccountWindow,
            @Value("${devquest.ranking.new-account-share:0.5}") double newAccountShare) {
        this.jdbc = jdbc;
        this.catalog = catalog;
        this.clock = clock;
        this.paceWindow = paceWindow;
        this.paceLimit = paceLimit;
        this.newAccountWindow = newAccountWindow;
        this.newAccountShare = newAccountShare;
    }

    /** 진행도를 저장한 뒤 불러요. 의심스러우면 review 로 바꿔요 (ok 인 계정만) */
    public void check(long userId) {
        String status = jdbc.queryForObject("select ranking_status from users where id = ?", String.class, userId);
        if (!OK.equals(status)) return;
        Instant now = clock.instant();

        Integer recent = jdbc.queryForObject(
                "select count(*) from quest_completions where user_id = ? and live and completed_at >= ?",
                Integer.class, userId, Timestamp.from(now.minus(paceWindow)));
        if (recent != null && recent > paceLimit) {
            flag(userId, "%d분 동안 퀘스트 %d개 완료".formatted(paceWindow.toMinutes(), recent));
            return;
        }

        int threshold = (int) Math.ceil(catalog.maxXpAll() * newAccountShare);
        Integer xp = jdbc.queryForObject("""
                select coalesce(sum(s.xp), 0) from course_scores s join users u on u.id = s.user_id
                where s.user_id = ? and u.created_at >= ?""",
                Integer.class, userId, Timestamp.from(now.minus(newAccountWindow)));
        if (xp != null && threshold > 0 && xp >= threshold) {
            flag(userId, "가입 %d시간 안에 %,d XP (전체의 %d%%)".formatted(newAccountWindow.toHours(), xp, Math.round(100.0 * xp / catalog.maxXpAll())));
        }
    }

    private void flag(long userId, String note) {
        int n = jdbc.update("update users set ranking_status = ?, ranking_note = ?, ranking_status_at = ? where id = ? and ranking_status = ?",
                REVIEW, note, Timestamp.from(clock.instant()), userId, OK);
        if (n > 0) log.warn("랭킹 확인 필요: user {} — {}", userId, note);
    }

    /** 관리자가 상태를 바꿔요. 바꾼 계정이 없으면 false */
    public boolean set(String username, String status, String note) {
        if (!List.of(OK, HIDDEN, TRUSTED).contains(status)) throw new IllegalArgumentException(status);
        return jdbc.update("update users set ranking_status = ?, ranking_note = ?, ranking_status_at = ? where username = ?",
                status, note, Timestamp.from(clock.instant()), username) > 0;
    }

    public record Flagged(String username, String nickname, String status, String note, Instant at, int xp, int recentLive) {
    }

    /** 확인을 기다리거나 숨긴 계정 (최근 것부터) */
    public List<Flagged> flagged() {
        return jdbc.query("""
                select u.username, u.nickname, u.ranking_status, u.ranking_note, u.ranking_status_at,
                       (select coalesce(sum(xp), 0) from course_scores s where s.user_id = u.id) as xp,
                       (select count(*) from quest_completions c where c.user_id = u.id and c.live
                            and c.completed_at >= now() - interval '1 day') as recent
                from users u where u.ranking_status in ('review', 'hidden')
                order by u.ranking_status_at desc nulls last limit 200""",
                (rs, i) -> new Flagged(rs.getString("username"), rs.getString("nickname"), rs.getString("ranking_status"),
                        rs.getString("ranking_note"),
                        rs.getTimestamp("ranking_status_at") == null ? null : rs.getTimestamp("ranking_status_at").toInstant(),
                        rs.getInt("xp"), rs.getInt("recent")));
    }
}
