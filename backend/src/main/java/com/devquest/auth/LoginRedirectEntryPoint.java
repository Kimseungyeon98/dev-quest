package com.devquest.auth;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.springframework.http.MediaType;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;

/**
 * 로그인하지 않은 요청: API 는 401 JSON, 페이지는 로그인 화면으로 보내면서 원래 주소를 next 로 넘겨요.
 */
public class LoginRedirectEntryPoint implements AuthenticationEntryPoint {

    public static final String LOGIN_PAGE = "/login/";

    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response, AuthenticationException e)
            throws IOException {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        if (path.startsWith("/api/")) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            response.getWriter().write("{\"error\":\"로그인이 필요해요.\"}");
            return;
        }
        String query = request.getQueryString();
        String next = path + (query == null ? "" : "?" + query);
        String target = request.getContextPath() + LOGIN_PAGE
                + ("/".equals(next) ? "" : "?next=" + URLEncoder.encode(next, StandardCharsets.UTF_8));
        response.sendRedirect(target);
    }
}
