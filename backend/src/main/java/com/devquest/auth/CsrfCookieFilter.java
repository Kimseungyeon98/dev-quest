package com.devquest.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * CSRF 토큰은 필요할 때 만들어지는데(지연 생성), 정적 페이지는 토큰을 쓰지 않아서 XSRF-TOKEN 쿠키가 안 생겨요.
 * 매 요청마다 토큰을 한 번 읽어서 쿠키가 항상 내려가게 해요. 그래야 페이지의 JS 가 헤더에 담아 보낼 수 있어요.
 */
class CsrfCookieFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        CsrfToken token = (CsrfToken) request.getAttribute(CsrfToken.class.getName());
        if (token != null) token.getToken();
        chain.doFilter(request, response);
    }
}
