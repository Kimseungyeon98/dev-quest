package com.devquest.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * API 요청 본문이 너무 크면 읽기 전에 413 으로 끊어요 (JSON 을 다 읽어 메모리에 올리기 전에).
 * 진행도 하나의 최대 크기(devquest.progress.max-bytes)에 여유를 더한 값이 한도예요.
 */
@Component
@Order(1)
public class RequestSizeLimitFilter extends OncePerRequestFilter {

    private final long limit;

    public RequestSizeLimitFilter(@Value("${devquest.progress.max-bytes}") int maxProgressBytes) {
        this.limit = maxProgressBytes * 2L + 4096; // JSON 이스케이프 등으로 늘어나는 만큼 여유
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith(request.getContextPath() + "/api/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (request.getContentLengthLong() > limit) {
            response.setStatus(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            response.getWriter().write("{\"error\":\"요청이 너무 커요.\"}");
            return;
        }
        chain.doFilter(request, response);
    }
}
