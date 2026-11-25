package com.devquest.auth;

import com.devquest.progress.RankingGuard;
import com.devquest.user.AccountService;
import com.devquest.user.UserService;
import java.util.List;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 관리자 기능. ADMIN_TOKEN 환경 변수(24자 이상)가 있을 때만 켜지고, 요청마다 X-Admin-Token 헤더로 확인해요.
 * 쿠키를 쓰지 않는 API 라 CSRF 검사에서 빠져요. 토큰이 없거나 틀리면 기능이 없는 것처럼 404 를 돌려줘요.
 *
 * <pre>
 * curl -X POST https://주소/api/admin/users/아이디/reset-password -H "X-Admin-Token: $ADMIN_TOKEN"
 * </pre>
 */
@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private static final Logger log = LoggerFactory.getLogger(AdminController.class);
    private static final int MIN_TOKEN_LENGTH = 24;

    private final AccountService accounts;
    private final RankingGuard guard;
    private final byte[] token;

    public AdminController(AccountService accounts, RankingGuard guard, @Value("${devquest.admin-token:}") String token) {
        this.accounts = accounts;
        this.guard = guard;
        this.token = token.length() >= MIN_TOKEN_LENGTH ? token.getBytes(StandardCharsets.UTF_8) : null;
    }

    /** 임시 비밀번호를 만들어 돌려줘요. 그 계정의 모든 로그인·자동 로그인은 끊겨요 */
    @PostMapping("/users/{username}/reset-password")
    public ResponseEntity<Map<String, String>> resetPassword(@PathVariable String username,
            @RequestHeader(name = "X-Admin-Token", required = false) String given, HttpServletRequest request) {
        if (!allowed(given)) return notFound();
        String temp = accounts.adminResetPassword(username);
        accounts.endOtherLogins(UserService.normalize(username), null);
        log.warn("관리자가 {} 계정의 비밀번호를 임시 비밀번호로 바꿨어요 (요청 IP {})", username, request.getRemoteAddr());
        return ResponseEntity.ok(Map.of("username", UserService.normalize(username), "temporaryPassword", temp,
                "notice", "로그인한 뒤 계정 메뉴에서 비밀번호를 바꾸라고 알려 주세요."));
    }

    /** 랭킹 확인을 기다리는(review)·숨긴(hidden) 계정 목록 */
    @GetMapping("/ranking/review")
    public ResponseEntity<?> rankingReview(@RequestHeader(name = "X-Admin-Token", required = false) String given) {
        if (!allowed(given)) return notFound();
        return ResponseEntity.ok(Map.of("users", guard.flagged()));
    }

    public record RankingStatusRequest(String status, String note) {
    }

    /**
     * 랭킹 상태 바꾸기. status: ok(되돌리기, 다시 자동 검사 대상) · trusted(되돌리고 자동 검사 안 함) · hidden(숨기기)
     * <pre>curl -X PUT https://주소/api/admin/users/아이디/ranking -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"status":"hidden"}'</pre>
     */
    @PutMapping("/users/{username}/ranking")
    public ResponseEntity<?> setRankingStatus(@PathVariable String username, @RequestBody RankingStatusRequest body,
            @RequestHeader(name = "X-Admin-Token", required = false) String given, HttpServletRequest request) {
        if (!allowed(given)) return notFound();
        String status = body == null ? null : body.status();
        if (!List.of(RankingGuard.OK, RankingGuard.HIDDEN, RankingGuard.TRUSTED).contains(status)) {
            return ResponseEntity.badRequest().body(Map.of("error", "status 는 ok · trusted · hidden 중 하나예요."));
        }
        String name = UserService.normalize(username);
        String note = body.note() == null || body.note().isBlank() ? "관리자" : body.note().strip();
        if (note.length() > 200) note = note.substring(0, 200);
        if (!guard.set(name, status, note)) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "그런 아이디가 없어요."));
        log.warn("관리자가 {} 계정의 랭킹 상태를 {} 로 바꿨어요 (요청 IP {})", name, status, request.getRemoteAddr());
        return ResponseEntity.ok(Map.of("username", name, "status", status));
    }

    private boolean allowed(String given) {
        return token != null && given != null && MessageDigest.isEqual(token, given.getBytes(StandardCharsets.UTF_8));
    }

    private static ResponseEntity<Map<String, String>> notFound() {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "찾을 수 없어요."));
    }
}
