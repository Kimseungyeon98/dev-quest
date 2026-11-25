package com.devquest.auth;

import com.devquest.user.AccountService;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
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
    private final byte[] token;

    public AdminController(AccountService accounts, @Value("${devquest.admin-token:}") String token) {
        this.accounts = accounts;
        this.token = token.length() >= MIN_TOKEN_LENGTH ? token.getBytes(StandardCharsets.UTF_8) : null;
    }

    /** 임시 비밀번호를 만들어 돌려줘요. 그 계정의 모든 로그인·자동 로그인은 끊겨요 */
    @PostMapping("/users/{username}/reset-password")
    public ResponseEntity<Map<String, String>> resetPassword(@PathVariable String username,
            @RequestHeader(name = "X-Admin-Token", required = false) String given, HttpServletRequest request) {
        if (token == null || given == null || !MessageDigest.isEqual(token, given.getBytes(StandardCharsets.UTF_8))) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "찾을 수 없어요."));
        }
        String temp = accounts.adminResetPassword(username);
        accounts.endOtherLogins(com.devquest.user.UserService.normalize(username), null);
        log.warn("관리자가 {} 계정의 비밀번호를 임시 비밀번호로 바꿨어요 (요청 IP {})", username, request.getRemoteAddr());
        return ResponseEntity.ok(Map.of("username", com.devquest.user.UserService.normalize(username), "temporaryPassword", temp,
                "notice", "로그인한 뒤 계정 메뉴에서 비밀번호를 바꾸라고 알려 주세요."));
    }
}
