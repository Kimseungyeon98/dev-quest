package com.devquest.config;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

/**
 * Railway·Heroku 처럼 DB 주소를 DATABASE_URL 하나({@code postgresql://user:pass@host:port/db?sslmode=...})로 주는 곳에서
 * Spring 데이터소스 설정(spring.datasource.url / username / password)으로 바꿔 줘요.
 * SPRING_DATASOURCE_URL 을 직접 줬으면 그걸 써요. DATABASE_URL 이 없으면 application.yml 의 PG* 설정을 그대로 써요.
 */
public class DatabaseUrlEnvironmentPostProcessor implements EnvironmentPostProcessor {

    static final String SOURCE_NAME = "databaseUrl";

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        String databaseUrl = environment.getProperty("DATABASE_URL");
        if (databaseUrl == null || databaseUrl.isBlank() || environment.getProperty("SPRING_DATASOURCE_URL") != null) return;
        Map<String, Object> props = toDatasourceProperties(databaseUrl);
        if (props.isEmpty()) return;
        MapPropertySource source = new MapPropertySource(SOURCE_NAME, props);
        if (environment.getPropertySources().contains("commandLineArgs")) {
            environment.getPropertySources().addAfter("commandLineArgs", source); // 실행 인자로 준 값이 가장 우선
        } else {
            environment.getPropertySources().addFirst(source);
        }
    }

    /** postgres(ql)://user:pass@host:port/db?query → JDBC 설정. 형식이 다르면 빈 Map */
    static Map<String, Object> toDatasourceProperties(String databaseUrl) {
        URI uri;
        try {
            uri = URI.create(databaseUrl.trim());
        } catch (IllegalArgumentException e) {
            return Map.of();
        }
        String scheme = uri.getScheme();
        if (!"postgres".equals(scheme) && !"postgresql".equals(scheme) || uri.getHost() == null) return Map.of();
        int port = uri.getPort() > 0 ? uri.getPort() : 5432;
        String db = uri.getPath() == null ? "" : uri.getPath().replaceFirst("^/", "");
        String jdbc = "jdbc:postgresql://" + uri.getHost() + ":" + port + "/" + db
                + (uri.getRawQuery() == null ? "" : "?" + uri.getRawQuery());
        Map<String, Object> props = new LinkedHashMap<>();
        props.put("spring.datasource.url", jdbc);
        String userInfo = uri.getRawUserInfo();
        if (userInfo != null) {
            int colon = userInfo.indexOf(':');
            props.put("spring.datasource.username", decode(colon < 0 ? userInfo : userInfo.substring(0, colon)));
            if (colon >= 0) props.put("spring.datasource.password", decode(userInfo.substring(colon + 1)));
        }
        return props;
    }

    private static String decode(String s) {
        return URLDecoder.decode(s.replace("+", "%2B"), StandardCharsets.UTF_8);
    }
}
