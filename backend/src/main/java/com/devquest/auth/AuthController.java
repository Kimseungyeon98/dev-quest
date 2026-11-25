package com.devquest.auth;

import com.devquest.auth.AuthDtos.LoginRequest;
import com.devquest.auth.AuthDtos.MeResponse;
import com.devquest.auth.AuthDtos.NicknameRequest;
import com.devquest.auth.AuthDtos.PasswordChangeRequest;
import com.devquest.auth.AuthDtos.PasswordConfirmRequest;
import com.devquest.auth.AuthDtos.RecoverRequest;
import com.devquest.user.AccountService;
import com.devquest.user.AccountService.AccountException;
import com.devquest.auth.AuthDtos.SignupRequest;
import com.devquest.user.User;
import com.devquest.user.UserService;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.context.SecurityContextHolderStrategy;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 회원가입·로그인·내 정보·비밀번호 변경·복구. 로그아웃은 Spring Security 의 LogoutFilter 가 POST /api/auth/logout 으로 처리해요.
 */
@RestController
@RequestMapping("/api")
public class AuthController {

    private final AuthenticationManager authenticationManager;
    private final UserService userService;
    private final UserDetailsService userDetailsService;
    private final SafeRememberMeServices rememberMe;
    private final SecurityContextRepository contextRepository;
    private final SessionAuthenticationStrategy sessionStrategy;
    private final AttemptLimiter loginLimiter;
    private final AttemptLimiter signupLimiter;
    private final AccountService accounts;
    private final SecurityContextHolderStrategy contextHolder = SecurityContextHolder.getContextHolderStrategy();

    public AuthController(AuthenticationManager authenticationManager, UserService userService,
            UserDetailsService userDetailsService, SafeRememberMeServices rememberMe,
            SecurityContextRepository contextRepository, SessionAuthenticationStrategy sessionStrategy,
            @Qualifier("loginLimiter") AttemptLimiter loginLimiter,
            @Qualifier("signupLimiter") AttemptLimiter signupLimiter, AccountService accounts) {
        this.authenticationManager = authenticationManager;
        this.userService = userService;
        this.userDetailsService = userDetailsService;
        this.rememberMe = rememberMe;
        this.contextRepository = contextRepository;
        this.sessionStrategy = sessionStrategy;
        this.loginLimiter = loginLimiter;
        this.signupLimiter = signupLimiter;
        this.accounts = accounts;
    }

    @PostMapping("/auth/signup")
    @ResponseStatus(HttpStatus.CREATED)
    public MeResponse signup(@Valid @RequestBody SignupRequest body, HttpServletRequest request,
            HttpServletResponse response) {
        String key = request.getRemoteAddr();
        Duration blocked = signupLimiter.blockedFor(key);
        if (!blocked.isZero()) throw new TooManyAttemptsException("가입 요청이 너무 많아요. 잠시 후 다시 시도해 주세요.", blocked);
        User user = userService.signUp(body.username(), body.password());
        signupLimiter.record(key);
        // 가입하면 바로 로그인한 상태로 만들어요
        UserDetails details = userDetailsService.loadUserByUsername(user.getUsername());
        Authentication auth = UsernamePasswordAuthenticationToken.authenticated(details, null, details.getAuthorities());
        startSession(auth, Boolean.TRUE.equals(body.rememberMe()), request, response);
        // 비밀번호를 잊었을 때 쓸 복구 코드 — 이번 응답에서 한 번만 보여 줘요
        String code = accounts.issueRecoveryCode(user.getUsername());
        return me(userService.find(user.getUsername()), code);
    }

    @PostMapping("/auth/login")
    public MeResponse login(@Valid @RequestBody LoginRequest body, HttpServletRequest request,
            HttpServletResponse response) {
        String username = UserService.normalize(body.username());
        String key = username + "|" + request.getRemoteAddr();
        Duration blocked = loginLimiter.blockedFor(key);
        if (!blocked.isZero()) {
            throw new TooManyAttemptsException("로그인에 여러 번 실패해서 잠시 막혔어요. " + minutes(blocked) + "분 뒤에 다시 시도해 주세요.", blocked);
        }
        Authentication auth;
        try {
            auth = authenticationManager.authenticate(
                    UsernamePasswordAuthenticationToken.unauthenticated(username, body.password()));
        } catch (AuthenticationException e) {
            loginLimiter.record(key);
            throw new BadLoginException();
        }
        loginLimiter.reset(key);
        startSession(auth, Boolean.TRUE.equals(body.rememberMe()), request, response);
        return me(userService.find(auth.getName()));
    }

    @GetMapping("/me")
    public MeResponse me(@AuthenticationPrincipal UserDetails user) {
        return me(userService.find(user.getUsername()));
    }

    @PutMapping("/me/nickname")
    public MeResponse changeNickname(@AuthenticationPrincipal UserDetails user, @Valid @RequestBody NicknameRequest body) {
        return me(userService.changeNickname(user.getUsername(), body.nickname()));
    }

    /** 비밀번호 변경: 다른 기기의 로그인·자동 로그인은 모두 끊고, 이 기기는 그대로 둬요 */
    @PutMapping("/me/password")
    public MeResponse changePassword(@AuthenticationPrincipal UserDetails user, @Valid @RequestBody PasswordChangeRequest body,
            HttpServletRequest request, HttpServletResponse response) {
        String key = "password:" + user.getUsername() + "|" + request.getRemoteAddr();
        guard(loginLimiter, key);
        try {
            accounts.changePassword(user.getUsername(), body.currentPassword(), body.newPassword());
        } catch (AccountException e) {
            if ("currentPassword".equals(e.getField())) loginLimiter.record(key);
            throw e;
        }
        loginLimiter.reset(key);
        boolean remembered = hasCookie(request, "remember-me");
        HttpSession session = request.getSession(false);
        accounts.endOtherLogins(user.getUsername(), session == null ? null : session.getId());
        if (session != null) request.changeSessionId();
        Authentication auth = contextHolder.getContext().getAuthentication();
        if (remembered && auth != null) rememberMe.rememberLogin(request, response, auth); // 이 기기의 자동 로그인은 새 토큰으로 유지
        return me(userService.find(user.getUsername()), null);
    }

    /** 복구 코드 새로 만들기 (전에 만든 코드는 더는 못 써요). 비밀번호를 한 번 더 확인해요 */
    @PostMapping("/me/recovery-code")
    public MeResponse reissueRecoveryCode(@AuthenticationPrincipal UserDetails user, @Valid @RequestBody PasswordConfirmRequest body,
            HttpServletRequest request) {
        String key = "password:" + user.getUsername() + "|" + request.getRemoteAddr();
        guard(loginLimiter, key);
        String code;
        try {
            code = accounts.reissueRecoveryCode(user.getUsername(), body.password());
        } catch (AccountException e) {
            loginLimiter.record(key);
            throw e;
        }
        loginLimiter.reset(key);
        return me(userService.find(user.getUsername()), code);
    }

    /** 회원 탈퇴: 비밀번호를 확인하고 계정·진행도·랭킹 점수를 지운 뒤, 모든 기기에서 로그아웃해요 */
    @DeleteMapping("/me")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteAccount(@AuthenticationPrincipal UserDetails user, @Valid @RequestBody PasswordConfirmRequest body,
            HttpServletRequest request, HttpServletResponse response) {
        String key = "password:" + user.getUsername() + "|" + request.getRemoteAddr();
        guard(loginLimiter, key);
        try {
            accounts.deleteAccount(user.getUsername(), body.password());
        } catch (AccountException e) {
            loginLimiter.record(key);
            throw e;
        }
        loginLimiter.reset(key);
        accounts.endOtherLogins(user.getUsername(), null); // 이 기기를 포함한 모든 세션·자동 로그인 토큰
        HttpSession session = request.getSession(false);
        if (session != null) session.invalidate();
        contextHolder.clearContext();
        rememberMe.logout(request, response, null); // 자동 로그인 쿠키 지우기
    }

    /** 비밀번호를 잊었을 때: 아이디 + 복구 코드로 새 비밀번호를 정하고 바로 로그인. 다른 기기 로그인은 모두 끊고 새 복구 코드를 줘요 */
    @PostMapping("/auth/recover")
    public MeResponse recover(@Valid @RequestBody RecoverRequest body, HttpServletRequest request, HttpServletResponse response) {
        String username = UserService.normalize(body.username());
        String key = "recover:" + username + "|" + request.getRemoteAddr();
        guard(loginLimiter, key);
        String code;
        try {
            code = accounts.recover(username, body.recoveryCode(), body.newPassword());
        } catch (AccountException e) {
            loginLimiter.record(key);
            throw e;
        }
        loginLimiter.reset(key);
        accounts.endOtherLogins(username, null);
        UserDetails details = userDetailsService.loadUserByUsername(username);
        Authentication auth = UsernamePasswordAuthenticationToken.authenticated(details, null, details.getAuthorities());
        startSession(auth, Boolean.TRUE.equals(body.rememberMe()), request, response);
        return me(userService.find(username), code);
    }

    private static void guard(AttemptLimiter limiter, String key) {
        Duration blocked = limiter.blockedFor(key);
        if (!blocked.isZero()) {
            throw new TooManyAttemptsException("여러 번 틀려서 잠시 막혔어요. " + minutes(blocked) + "분 뒤에 다시 시도해 주세요.", blocked);
        }
    }

    private static boolean hasCookie(HttpServletRequest request, String name) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) return false;
        for (Cookie c : cookies) if (name.equals(c.getName()) && c.getValue() != null && !c.getValue().isEmpty()) return true;
        return false;
    }

    private static MeResponse me(User user) {
        return me(user, null);
    }

    private static MeResponse me(User user, String newRecoveryCode) {
        return new MeResponse(user.getUsername(), user.getNickname(), UserService.isDefaultNickname(user.getNickname()),
                user.getRecoveryCodeHash() != null, newRecoveryCode);
    }

    /** 세션 ID 를 바꾸고 로그인 정보를 세션에 저장한 뒤, 원하면 자동 로그인 쿠키를 줘요 */
    private void startSession(Authentication auth, boolean remember, HttpServletRequest request,
            HttpServletResponse response) {
        sessionStrategy.onAuthentication(auth, request, response);
        SecurityContext context = contextHolder.createEmptyContext();
        context.setAuthentication(auth);
        contextHolder.setContext(context);
        contextRepository.saveContext(context, request, response);
        if (remember) rememberMe.rememberLogin(request, response, auth);
    }

    private static long minutes(Duration d) {
        return Math.max(1, (d.toSeconds() + 59) / 60);
    }

    public static class BadLoginException extends RuntimeException {
        public BadLoginException() {
            super("아이디 또는 비밀번호가 맞지 않아요.");
        }
    }

    public static class TooManyAttemptsException extends RuntimeException {
        private final Duration retryAfter;

        public TooManyAttemptsException(String message, Duration retryAfter) {
            super(message);
            this.retryAfter = retryAfter;
        }

        public Duration getRetryAfter() {
            return retryAfter;
        }
    }
}
