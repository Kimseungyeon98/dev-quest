package com.devquest.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.web.authentication.rememberme.CookieTheftException;
import org.springframework.security.web.authentication.rememberme.PersistentTokenBasedRememberMeServices;
import org.springframework.security.web.authentication.rememberme.PersistentTokenRepository;

/**
 * DB 토큰 방식 자동 로그인. 쿠키를 도둑맞은 것이 감지되면(이미 쓴 토큰이 다시 들어오면) 부모 클래스가 그 계정의 토큰을
 * 모두 지우는데, 예외가 필터 밖으로 나가 500 이 되지 않도록 여기서 받아 "로그인 안 됨"으로 처리해요.
 */
public class SafeRememberMeServices extends PersistentTokenBasedRememberMeServices {

    private static final Logger log = LoggerFactory.getLogger(SafeRememberMeServices.class);

    public SafeRememberMeServices(String key, UserDetailsService userDetailsService, PersistentTokenRepository tokens) {
        super(key, userDetailsService, tokens);
    }

    @Override
    public Authentication autoLogin(HttpServletRequest request, HttpServletResponse response) {
        try {
            return super.autoLogin(request, response);
        } catch (CookieTheftException e) {
            log.warn("자동 로그인 쿠키 도용이 의심돼서 해당 계정의 자동 로그인을 모두 끊었어요: {}", e.getMessage());
            cancelCookie(request, response);
            return null;
        }
    }

    /** JSON 로그인 요청의 "로그인 유지" 값으로 토큰을 만들어요 (폼 파라미터 대신) */
    public void rememberLogin(HttpServletRequest request, HttpServletResponse response, Authentication auth) {
        onLoginSuccess(request, response, auth);
    }
}
