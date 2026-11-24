package com.devquest.auth;

import com.devquest.auth.AuthDtos.LoginRequest;
import com.devquest.auth.AuthDtos.MeResponse;
import com.devquest.auth.AuthDtos.SignupRequest;
import com.devquest.user.User;
import com.devquest.user.UserService;
import jakarta.servlet.http.HttpServletRequest;
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
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 회원가입·로그인·내 정보. 로그아웃은 Spring Security 의 LogoutFilter 가 POST /api/auth/logout 으로 처리해요.
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
    private final SecurityContextHolderStrategy contextHolder = SecurityContextHolder.getContextHolderStrategy();

    public AuthController(AuthenticationManager authenticationManager, UserService userService,
            UserDetailsService userDetailsService, SafeRememberMeServices rememberMe,
            SecurityContextRepository contextRepository, SessionAuthenticationStrategy sessionStrategy,
            @Qualifier("loginLimiter") AttemptLimiter loginLimiter,
            @Qualifier("signupLimiter") AttemptLimiter signupLimiter) {
        this.authenticationManager = authenticationManager;
        this.userService = userService;
        this.userDetailsService = userDetailsService;
        this.rememberMe = rememberMe;
        this.contextRepository = contextRepository;
        this.sessionStrategy = sessionStrategy;
        this.loginLimiter = loginLimiter;
        this.signupLimiter = signupLimiter;
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
        startSession(auth, body.rememberMe(), request, response);
        return new MeResponse(user.getUsername());
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
        startSession(auth, body.rememberMe(), request, response);
        return new MeResponse(auth.getName());
    }

    @GetMapping("/me")
    public MeResponse me(@AuthenticationPrincipal UserDetails user) {
        return new MeResponse(user.getUsername());
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
