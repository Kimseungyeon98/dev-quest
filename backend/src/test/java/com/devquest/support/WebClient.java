package com.devquest.support;

import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.HttpCookie;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Optional;

/**
 * 브라우저처럼 쿠키를 기억하는 테스트용 HTTP 클라이언트. 리다이렉트는 따라가지 않아요.
 * POST 할 때는 XSRF-TOKEN 쿠키를 X-XSRF-TOKEN 헤더로 보내요 (shared/dq.js 의 DevQuest.api 와 같은 방식).
 */
public class WebClient {

    private final String base;
    private final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
    private final HttpClient http;

    public WebClient(int port) {
        this.base = "http://localhost:" + port;
        this.http = HttpClient.newBuilder().cookieHandler(cookies).build();
    }

    public HttpResponse<String> get(String path) throws Exception {
        return http.send(HttpRequest.newBuilder(URI.create(base + path)).build(), HttpResponse.BodyHandlers.ofString());
    }

    public HttpResponse<String> post(String path, String json) throws Exception {
        return post(path, json, true);
    }

    public HttpResponse<String> post(String path, String json, boolean withCsrf) throws Exception {
        if (withCsrf && cookie("XSRF-TOKEN").isEmpty()) get("/login/"); // 처음이면 토큰 쿠키부터 받아요
        HttpRequest.Builder req = HttpRequest.newBuilder(URI.create(base + path))
                .header("Content-Type", "application/json")
                .POST(json == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json));
        if (withCsrf) cookie("XSRF-TOKEN").ifPresent(t -> req.header("X-XSRF-TOKEN", t));
        return http.send(req.build(), HttpResponse.BodyHandlers.ofString());
    }

    public HttpResponse<String> put(String path, String json) throws Exception {
        if (cookie("XSRF-TOKEN").isEmpty()) get("/login/");
        HttpRequest.Builder req = HttpRequest.newBuilder(URI.create(base + path))
                .header("Content-Type", "application/json")
                .PUT(HttpRequest.BodyPublishers.ofString(json));
        cookie("XSRF-TOKEN").ifPresent(t -> req.header("X-XSRF-TOKEN", t));
        return http.send(req.build(), HttpResponse.BodyHandlers.ofString());
    }

    public Optional<String> cookie(String name) {
        return cookies.getCookieStore().getCookies().stream()
                .filter(c -> c.getName().equals(name) && !c.hasExpired())
                .map(HttpCookie::getValue)
                .findFirst();
    }

    /** 다른 브라우저(새 세션)에 쿠키 하나만 옮겨 담아요. 자동 로그인 확인용 */
    public void putCookie(String name, String value) {
        HttpCookie c = new HttpCookie(name, value);
        c.setPath("/");
        c.setVersion(0);
        cookies.getCookieStore().add(URI.create(base), c);
    }

    public void removeCookie(String name) {
        cookies.getCookieStore().getCookies().stream().filter(c -> c.getName().equals(name)).toList()
                .forEach(c -> cookies.getCookieStore().remove(null, c));
    }

    public static String json(String username, String password, boolean rememberMe) {
        return "{\"username\":\"" + username + "\",\"password\":\"" + password + "\",\"rememberMe\":" + rememberMe + "}";
    }
}
