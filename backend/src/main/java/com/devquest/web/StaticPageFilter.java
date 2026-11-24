package com.devquest.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 과목 폴더 주소를 그 폴더의 index.html 로 연결해요.
 * <ul>
 *   <li>{@code /algo/} → {@code /algo/index.html} 로 forward</li>
 *   <li>{@code /algo} → {@code /algo/} 로 redirect. 페이지 안의 {@code ../shared/dq.css} 같은 상대 경로가
 *       맞게 풀리려면 주소가 / 로 끝나야 해요.</li>
 * </ul>
 * Spring 의 정적 리소스 처리는 폴더 주소를 index.html 로 바꿔 주지 않아서 필요해요. (루트 / 만 예외)
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class StaticPageFilter extends OncePerRequestFilter {

    private static final String STATIC_ROOT = "static";
    private final Map<String, Boolean> pageExists = new ConcurrentHashMap<>();

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String method = request.getMethod();
        if (!"GET".equals(method) && !"HEAD".equals(method)) return true;
        String path = pathOf(request);
        return path.startsWith("/api/") || path.startsWith("/actuator") || path.contains("..");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String path = pathOf(request);
        if (path.endsWith("/")) {
            if (hasIndex(path)) {
                request.getRequestDispatcher(path + "index.html").forward(request, response);
                return;
            }
        } else if (!lastSegment(path).contains(".") && hasIndex(path + "/")) {
            String query = request.getQueryString();
            response.sendRedirect(request.getContextPath() + path + "/" + (query == null ? "" : "?" + query));
            return;
        }
        chain.doFilter(request, response);
    }

    private boolean hasIndex(String dirPath) {
        return pageExists.computeIfAbsent(dirPath,
                p -> new ClassPathResource(STATIC_ROOT + p + "index.html").exists());
    }

    private static String pathOf(HttpServletRequest request) {
        return request.getRequestURI().substring(request.getContextPath().length());
    }

    private static String lastSegment(String path) {
        return path.substring(path.lastIndexOf('/') + 1);
    }
}
