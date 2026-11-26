package com.devquest.user;

import com.devquest.user.AccountService.AccountException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * SSO 로그인 연결 (user_identities). 계정 하나에 여러 로그인 방식(구글·깃허브·카카오 …)을 붙일 수 있어요.
 * <ul>
 *   <li>같은 사람 = 같은 (provider, subject). subject 는 그 서비스가 주는 바뀌지 않는 사용자 id 예요</li>
 *   <li>이메일이 같다고 다른 계정에 자동으로 붙이지 않아요 (이메일을 확인하지 않는 서비스도 있어서 계정 탈취 위험)</li>
 *   <li>로그인 방법이 하나도 없는 계정이 생기지 않게, 비밀번호 없는 계정의 마지막 연결은 끊을 수 없어요</li>
 * </ul>
 */
@Service
public class IdentityService {

    private final JdbcTemplate jdbc;
    private final UserService users;
    private final Clock clock;

    public IdentityService(JdbcTemplate jdbc, UserService users, Clock clock) {
        this.jdbc = jdbc;
        this.users = users;
        this.clock = clock;
    }

    /** SSO 서비스가 알려 준 사용자 정보 */
    public record Profile(String provider, String subject, String email, String displayName) {
    }

    public record Identity(String provider, String email, String displayName, Instant createdAt, Instant lastLoginAt) {
    }

    /** SSO 로그인 결과. created 면 이번에 새로 만든 계정이에요 */
    public record Login(User user, boolean created) {
    }

    /** SSO 로 로그인해요. 연결된 계정이 있으면 그 계정, 없으면 새 계정을 만들어 연결해요 */
    @Transactional
    public Login login(Profile p) {
        check(p);
        Long userId = userIdOf(p);
        if (userId != null) {
            touch(p);
            return new Login(users.findById(userId), false);
        }
        User user = users.createSsoUser(p.provider());
        insert(user.getId(), p);
        return new Login(user, true);
    }

    /** 로그인한 계정에 SSO 로그인을 연결해요 (계정 메뉴의 [연결하기]) */
    @Transactional
    public void link(String username, Profile p) {
        check(p);
        User user = users.find(username);
        Long owner = userIdOf(p);
        if (owner != null) {
            if (!owner.equals(user.getId())) throw new AccountException("이 " + label(p.provider()) + " 계정은 이미 다른 Dev Quest 계정에 연결돼 있어요.", "provider");
            touch(p);
            return;
        }
        Integer same = jdbc.queryForObject("select count(*) from user_identities where user_id = ? and provider = ?", Integer.class, user.getId(), p.provider());
        if (same != null && same > 0) throw new AccountException("이미 다른 " + label(p.provider()) + " 계정이 연결돼 있어요. 먼저 연결을 끊어 주세요.", "provider");
        insert(user.getId(), p);
    }

    /** 연결 끊기. 비밀번호가 없는 계정의 마지막 로그인 방법은 끊을 수 없어요 */
    @Transactional
    public void unlink(String username, String provider) {
        User user = users.find(username);
        List<Identity> mine = list(user.getId());
        if (mine.stream().noneMatch(i -> i.provider().equals(provider))) throw new AccountException("연결돼 있지 않아요.", "provider");
        if (user.getPasswordHash() == null && mine.size() <= 1) {
            throw new AccountException("로그인할 방법이 하나는 남아 있어야 해요. 먼저 비밀번호를 만들거나 다른 로그인을 연결해 주세요.", "provider");
        }
        jdbc.update("delete from user_identities where user_id = ? and provider = ?", user.getId(), provider);
    }

    public List<Identity> list(long userId) {
        return jdbc.query("""
                select provider, email, display_name, created_at, last_login_at from user_identities
                where user_id = ? order by created_at""",
                (rs, i) -> new Identity(rs.getString("provider"), rs.getString("email"), rs.getString("display_name"),
                        rs.getTimestamp("created_at").toInstant(),
                        rs.getTimestamp("last_login_at") == null ? null : rs.getTimestamp("last_login_at").toInstant()),
                userId);
    }

    /** 화면에 보여 줄 서비스 이름 */
    public static String label(String provider) {
        return switch (provider) {
            case "google" -> "Google";
            case "github" -> "GitHub";
            case "kakao" -> "카카오";
            case "naver" -> "네이버";
            default -> provider;
        };
    }

    private Long userIdOf(Profile p) {
        return jdbc.query("select user_id from user_identities where provider = ? and subject = ?",
                (rs, i) -> rs.getLong(1), p.provider(), p.subject()).stream().findFirst().orElse(null);
    }

    private void insert(long userId, Profile p) {
        Timestamp now = Timestamp.from(clock.instant());
        jdbc.update("""
                insert into user_identities (user_id, provider, subject, email, display_name, created_at, last_login_at)
                values (?, ?, ?, ?, ?, ?, ?)""", userId, p.provider(), p.subject(), cut(p.email(), 200), cut(p.displayName(), 100), now, now);
    }

    private void touch(Profile p) {
        jdbc.update("update user_identities set last_login_at = ?, email = coalesce(?, email), display_name = coalesce(?, display_name) where provider = ? and subject = ?",
                Timestamp.from(clock.instant()), cut(p.email(), 200), cut(p.displayName(), 100), p.provider(), p.subject());
    }

    private static void check(Profile p) {
        if (p == null || p.provider() == null || p.provider().isBlank() || p.subject() == null || p.subject().isBlank()) {
            throw new IllegalArgumentException("SSO 사용자 정보에 provider·subject 가 없어요.");
        }
    }

    private static String cut(String s, int max) {
        return s == null ? null : s.length() <= max ? s : s.substring(0, max);
    }
}
