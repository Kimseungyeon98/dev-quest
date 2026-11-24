package com.devquest.auth;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 시간 창 안의 시도 횟수를 세서, 한도를 넘으면 창이 끝날 때까지 막아요. (서버 한 대 기준, 메모리에 보관)
 * <ul>
 *   <li>로그인: 아이디+IP 별로 실패를 세고, 성공하면 초기화</li>
 *   <li>회원가입: IP 별로 가입 횟수를 세요</li>
 * </ul>
 */
public class AttemptLimiter {

    private record Window(int count, Instant startedAt) {
    }

    private final int max;
    private final Duration window;
    private final Clock clock;
    private final Map<String, Window> windows = new ConcurrentHashMap<>();

    public AttemptLimiter(int max, Duration window, Clock clock) {
        this.max = max;
        this.window = window;
        this.clock = clock;
    }

    /** 막혀 있으면 남은 시간, 아니면 Duration.ZERO */
    public Duration blockedFor(String key) {
        Window w = windows.get(key);
        if (w == null || w.count() < max) return Duration.ZERO;
        Duration left = Duration.between(clock.instant(), w.startedAt().plus(window));
        return left.isNegative() ? Duration.ZERO : left;
    }

    public void record(String key) {
        Instant now = clock.instant();
        windows.compute(key, (k, w) -> w == null || !now.isBefore(w.startedAt().plus(window))
                ? new Window(1, now)
                : new Window(w.count() + 1, w.startedAt()));
    }

    public void reset(String key) {
        windows.remove(key);
    }

    /** 끝난 창을 지워서 메모리가 계속 늘지 않게 해요 */
    public void evictExpired() {
        Instant now = clock.instant();
        windows.entrySet().removeIf(e -> !now.isBefore(e.getValue().startedAt().plus(window)));
    }
}
