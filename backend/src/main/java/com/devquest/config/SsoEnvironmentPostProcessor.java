package com.devquest.config;

import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.boot.EnvironmentPostProcessor;
import org.springframework.boot.SpringApplication;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

/**
 * SSO 제공자 켜기: 환경 변수에 키가 있는 제공자만 Spring OAuth2 로그인 설정(spring.security.oauth2.client.*)으로 바꿔 줘요.
 * 키가 하나도 없으면 아무것도 하지 않아서 SSO 없이(아이디·비밀번호만) 지금처럼 동작해요.
 * <ul>
 *   <li>Google: GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET (OpenID Connect, 이메일·이름)</li>
 *   <li>GitHub: GITHUB_CLIENT_ID · GITHUB_CLIENT_SECRET</li>
 *   <li>카카오: KAKAO_CLIENT_ID(REST API 키) · KAKAO_CLIENT_SECRET(선택, 카카오 콘솔에서 켰을 때만)</li>
 * </ul>
 * 각 서비스의 개발자 콘솔에 등록할 Redirect URI 는 {@code https://내주소/login/oauth2/code/google} (github · kakao 도 같은 꼴)이에요.
 * application.yml 이나 SPRING_SECURITY_OAUTH2_CLIENT_* 로 직접 설정한 값이 있으면 그게 우선이에요.
 */
public class SsoEnvironmentPostProcessor implements EnvironmentPostProcessor {

    static final String SOURCE_NAME = "devquestSso";
    private static final String REG = "spring.security.oauth2.client.registration.";
    private static final String PROV = "spring.security.oauth2.client.provider.";

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment env, SpringApplication application) {
        Map<String, Object> props = properties(env::getProperty);
        if (props.isEmpty()) return;
        env.getPropertySources().addLast(new MapPropertySource(SOURCE_NAME, props)); // 직접 준 설정보다 뒤 (덜 우선)
    }

    interface Env {
        String get(String key);
    }

    static Map<String, Object> properties(Env env) {
        Map<String, Object> p = new LinkedHashMap<>();
        String googleId = value(env, "GOOGLE_CLIENT_ID"), googleSecret = value(env, "GOOGLE_CLIENT_SECRET");
        if (googleId != null && googleSecret != null) {
            p.put(REG + "google.client-id", googleId);
            p.put(REG + "google.client-secret", googleSecret);
            p.put(REG + "google.scope", "openid,profile,email");
        }
        String githubId = value(env, "GITHUB_CLIENT_ID"), githubSecret = value(env, "GITHUB_CLIENT_SECRET");
        if (githubId != null && githubSecret != null) {
            p.put(REG + "github.client-id", githubId);
            p.put(REG + "github.client-secret", githubSecret);
            p.put(REG + "github.scope", "read:user,user:email");
        }
        String kakaoId = value(env, "KAKAO_CLIENT_ID");
        if (kakaoId != null) {
            String kakaoSecret = value(env, "KAKAO_CLIENT_SECRET");
            p.put(REG + "kakao.client-id", kakaoId);
            if (kakaoSecret != null) p.put(REG + "kakao.client-secret", kakaoSecret);
            p.put(REG + "kakao.client-authentication-method", kakaoSecret != null ? "client_secret_post" : "none");
            p.put(REG + "kakao.authorization-grant-type", "authorization_code");
            p.put(REG + "kakao.redirect-uri", "{baseUrl}/login/oauth2/code/{registrationId}");
            p.put(REG + "kakao.scope", "profile_nickname");
            p.put(REG + "kakao.client-name", "Kakao");
            p.put(PROV + "kakao.authorization-uri", "https://kauth.kakao.com/oauth/authorize");
            p.put(PROV + "kakao.token-uri", "https://kauth.kakao.com/oauth/token");
            p.put(PROV + "kakao.user-info-uri", "https://kapi.kakao.com/v2/user/me");
            p.put(PROV + "kakao.user-name-attribute", "id");
        }
        return p;
    }

    private static String value(Env env, String key) {
        String v = env.get(key);
        return v == null || v.isBlank() ? null : v.trim();
    }
}
