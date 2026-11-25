package com.devquest.progress;

import com.devquest.user.UserRepository;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 내 학습 기록: 연속 학습일(스트릭)과 이번 주 기록. GET /api/me/activity
 * <ul>
 *   <li>하루 = 설정한 시간대(기본 한국 시간)의 날짜, 한 주 = 월요일부터</li>
 *   <li>그날 퀘스트를 하나라도 새로 끝내면 "공부한 날"</li>
 *   <li>streak: 오늘(아직이면 어제)까지 이어진 날 수. activeToday 가 false 면 오늘 하나 깨면 이어져요</li>
 *   <li>예전 기록(완료 시각을 추정한 것, live = false)은 세지 않아요</li>
 * </ul>
 */
@RestController
public class ActivityController {

    private final JdbcTemplate jdbc;
    private final UserRepository users;
    private final Clock clock;
    private final ZoneId zone;

    public ActivityController(JdbcTemplate jdbc, UserRepository users, Clock clock,
            @Value("${devquest.timezone:Asia/Seoul}") String timezone) {
        this.jdbc = jdbc;
        this.users = users;
        this.clock = clock;
        this.zone = ZoneId.of(timezone);
    }

    public record Day(LocalDate date, int done, int xp) {
    }

    public record Week(LocalDate start, int done, int xp, List<Day> days) {
    }

    public record Activity(String timezone, LocalDate today, int streak, int bestStreak, boolean activeToday,
            int totalDays, Week week) {
    }

    @GetMapping("/api/me/activity")
    public Activity activity(@AuthenticationPrincipal UserDetails user) {
        long userId = users.findIdByUsername(user.getUsername()).orElseThrow(() -> new UsernameNotFoundException(user.getUsername()));
        LocalDate today = LocalDate.now(clock.withZone(zone));

        // 공부한 날 (최근 → 예전)
        List<LocalDate> days = jdbc.queryForList("""
                select distinct (completed_at at time zone ?)::date as d
                from quest_completions where user_id = ? and live order by d desc""",
                LocalDate.class, zone.getId(), userId);
        Set<LocalDate> set = new HashSet<>(days);
        boolean activeToday = set.contains(today);
        int streak = 0;
        for (LocalDate d = activeToday ? today : today.minusDays(1); set.contains(d); d = d.minusDays(1)) streak++;
        int best = 0, run = 0;
        LocalDate prev = null;
        for (LocalDate d : days) { // 내림차순
            run = prev != null && prev.minusDays(1).equals(d) ? run + 1 : 1;
            best = Math.max(best, run);
            prev = d;
        }

        // 이번 주 (월~일)
        LocalDate monday = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        Map<LocalDate, int[]> byDay = new HashMap<>();
        jdbc.query("""
                select (completed_at at time zone ?)::date as d, count(*) as n, sum(xp) as xp
                from quest_completions where user_id = ? and live and completed_at >= ?
                group by d""",
                rs -> { byDay.put(rs.getObject("d", LocalDate.class), new int[] {rs.getInt("n"), rs.getInt("xp")}); },
                zone.getId(), userId, Timestamp.from(monday.atStartOfDay(zone).toInstant()));
        List<Day> week = new ArrayList<>();
        int weekDone = 0, weekXp = 0;
        for (int i = 0; i < 7; i++) {
            LocalDate d = monday.plusDays(i);
            int[] v = byDay.getOrDefault(d, new int[] {0, 0});
            week.add(new Day(d, v[0], v[1]));
            weekDone += v[0];
            weekXp += v[1];
        }
        return new Activity(zone.getId(), today, streak, best, activeToday, days.size(), new Week(monday, weekDone, weekXp, week));
    }
}
