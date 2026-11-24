package com.devquest.auth;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 만료된 자동 로그인 토큰과 시도 횟수 기록을 정리해요 (만료된 세션은 Spring Session 이 1분마다 지워요) */
@Component
class AuthHousekeeping {

    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final AttemptLimiter loginLimiter;
    private final AttemptLimiter signupLimiter;

    AuthHousekeeping(JdbcTemplate jdbc, Clock clock, @Qualifier("loginLimiter") AttemptLimiter loginLimiter,
            @Qualifier("signupLimiter") AttemptLimiter signupLimiter) {
        this.jdbc = jdbc;
        this.clock = clock;
        this.loginLimiter = loginLimiter;
        this.signupLimiter = signupLimiter;
    }

    @Scheduled(cron = "0 17 4 * * *") // 매일 새벽
    void deleteExpiredRememberMeTokens() {
        Instant cutoff = clock.instant().minus(SecurityConfig.REMEMBER_ME_VALIDITY);
        jdbc.update("delete from persistent_logins where last_used < ?", Timestamp.from(cutoff));
    }

    @Scheduled(fixedDelayString = "PT10M")
    void evictLimiterWindows() {
        loginLimiter.evictExpired();
        signupLimiter.evictExpired();
    }
}
