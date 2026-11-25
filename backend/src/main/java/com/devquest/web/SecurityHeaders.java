package com.devquest.web;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.web.header.HeaderWriter;

/**
 * 보안 헤더. Spring Security 기본 헤더(X-Content-Type-Options · X-Frame-Options · HTTPS 일 때 HSTS 등)에 더해요.
 * <ul>
 *   <li><b>Content-Security-Policy</b>: 이 사이트(self)와 쓰는 CDN 에서 온 스크립트만 실행해요.
 *       HTML 안에 직접 쓴 스크립트(인라인)도 막아서, 누군가 글자에 스크립트를 끼워 넣어도(XSS) 실행되지 않아요.
 *       스타일은 화면 곳곳의 style 속성 때문에 인라인을 허용해요.</li>
 *   <li>SQL Quest 의 SQLite 는 WebAssembly 라 'wasm-unsafe-eval' 이 필요해요.</li>
 *   <li>Algorithm Quest(/algo/)는 브라우저에서 Java 를 돌리는 CheerpJ(cjrtnc.leaningtech.com)가 바이트코드를 JS 로 바꿔
 *       실행해서 'unsafe-eval'·blob: 워커 등이 더 필요해요. 그 페이지에만 넓혀요.</li>
 *   <li>Referrer-Policy · Permissions-Policy(카메라·마이크·위치 등 안 써요)</li>
 * </ul>
 */
public class SecurityHeaders implements HeaderWriter {

    private static final String COMMON = String.join("; ",
            "default-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
            "img-src 'self' data: blob:",
            "font-src 'self' data: https://fonts.gstatic.com",
            "manifest-src 'self'");

    static final String SITE = String.join("; ", COMMON,
            "script-src 'self' 'wasm-unsafe-eval'",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "connect-src 'self'",
            "worker-src 'self'",
            "frame-src 'none'");

    private static final String CHEERPJ = "https://cjrtnc.leaningtech.com https://*.leaningtech.com";
    private static final String CDN = "https://cdnjs.cloudflare.com";

    static final String ALGO = String.join("; ", COMMON,
            "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob: " + CDN + " " + CHEERPJ,
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com " + CDN,
            "connect-src 'self' blob: data: " + CHEERPJ,
            "worker-src 'self' blob: " + CHEERPJ,
            "frame-src 'self' blob: " + CHEERPJ);

    static final String PERMISSIONS = "camera=(), microphone=(), geolocation=(), payment=(), usb=()";

    @Override
    public void writeHeaders(HttpServletRequest request, HttpServletResponse response) {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        response.setHeader("Content-Security-Policy", path.equals("/algo") || path.startsWith("/algo/") ? ALGO : SITE);
        response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        response.setHeader("Permissions-Policy", PERMISSIONS);
        response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    }
}
